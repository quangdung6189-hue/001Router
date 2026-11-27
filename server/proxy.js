import dns from "node:dns";
import net from "node:net";
import { Agent, ProxyAgent, buildConnector, fetch as undiciFetch } from "undici";
import { getPreset } from "./presets.js";
import {
  checkAddressAgainstPolicy,
  maskProxyUrl,
  redactSecrets,
  resolveUpstreamPolicy
} from "./security/redact.js";

export { undiciFetch as upstreamFetch };
import {
  decryptSecret,
  isEncrypted,
  loadOrCreateMasterKeySync
} from "./security/crypto.js";

export { maskProxyUrl };

const VALID_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks5h:"]);
const DNS_CACHE_TTL_MS = 30_000;
const DNS_CACHE_MAX_ENTRIES = 512;

/** @type {Map<string, { addrs: Array<{ address: string, family: number }>, expiresAt: number }>} */
const dnsCache = new Map();

/** @type {Map<string, ProxyAgent>} */
const dispatcherCache = new Map();
/** @type {Map<string, import("undici").Dispatcher>} */
const poolIdDispatcherCache = new Map();
/** @type {Agent | null} */
let defaultUpstreamAgent = null;

/**
 * Return a tuned default undici Agent for direct upstream requests:
 * - Fast IPv4/IPv6 Happy Eyeballs (250ms attempt timeout) + 15s connect timeout
 * - Disabled bodyTimeout (0) so long SSE streams never get killed mid-generation
 * - Extended keepAlive (90s / 300s) so multi-turn coding agent sessions reuse warm TLS sockets
 * @returns {Agent}
 */
export function getDefaultUpstreamDispatcher() {
  if (!defaultUpstreamAgent) {
    defaultUpstreamAgent = new Agent({
      connect: {
        timeout: 15_000,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 250
      },
      headersTimeout: 240_000,
      bodyTimeout: 0,
      keepAliveTimeout: 90_000,
      keepAliveMaxTimeout: 300_000
    });
  }
  return defaultUpstreamAgent;
}

/** @type {Map<string, Agent>} */
const guardedAgents = new Map();

function lookupWithShortCache(hostname, options, callback) {
  const key = `${String(hostname).toLowerCase()}:${options?.family || 0}`;
  const now = Date.now();
  const cached = dnsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return callback(null, cached.addrs);
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!Array.isArray(addrs) || addrs.length === 0) {
      const noAddrErr = new Error(`DNS lookup returned no addresses for '${hostname}'`);
      noAddrErr.code = "ENOTFOUND";
      return callback(noAddrErr);
    }
    dnsCache.delete(key);
    dnsCache.set(key, { addrs, expiresAt: now + DNS_CACHE_TTL_MS });
    while (dnsCache.size > DNS_CACHE_MAX_ENTRIES) {
      const oldest = dnsCache.keys().next().value;
      if (oldest === undefined) break;
      dnsCache.delete(oldest);
    }
    return callback(null, addrs);
  });
}

/**
 * Create an undici Agent that validates the DESTINATION ADDRESS of every outbound connection:
 * - hostnames are resolved (with short 30s cache) and every returned address is ALWAYS checked
 *   against `policy` (defeats `*.nip.io`, wildcard DNS, and DNS-rebinding),
 * - IP literals are checked too, covering redirects to `http://169.254.169.254/`.
 * Cloud-metadata / link-local is always blocked; private LAN / loopback follow `policy`.
 * @param {{ blockPrivate: boolean, blockLoopback: boolean }} policy
 */
export function createGuardedAgent(policy) {
  const lookup = (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    lookupWithShortCache(hostname, options, (err, addrs) => {
      if (err) return callback(err);
      if (!Array.isArray(addrs) || addrs.length === 0) {
        const noAddrErr = new Error(`SSRF guard: '${hostname}' resolved to no addresses`);
        noAddrErr.code = "ENOTFOUND";
        return callback(noAddrErr);
      }
      for (const a of addrs) {
        const reason = checkAddressAgainstPolicy(a.address, policy);
        if (reason) {
          const e = new Error(`SSRF guard: '${hostname}' resolves to a blocked address (${reason})`);
          e.code = "ESSRFBLOCKED";
          return callback(e);
        }
      }
      if (options && options.all) return callback(null, addrs);
      return callback(null, addrs[0].address, addrs[0].family);
    });
  };
  const connector = buildConnector({
    timeout: 15_000,
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    lookup
  });
  return new GuardedAgent({
    connect: (opts, callback) => {
      const host = String(opts.hostname || opts.host || "");
      if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
        const reason = checkAddressAgainstPolicy(host, policy);
        if (reason) {
          const e = new Error(`SSRF guard: connection to ${host} blocked (${reason})`);
          e.code = "ESSRFBLOCKED";
          return callback(e, null);
        }
      }
      return connector(opts, callback);
    },
    headersTimeout: 240_000,
    bodyTimeout: 0,
    keepAliveTimeout: 90_000,
    keepAliveMaxTimeout: 300_000
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Decide whether an upstream redirect leaves the origin of the original request.
 * @param {string} requestOrigin
 * @param {string} location
 */
function isCrossOriginRedirect(requestOrigin, location) {
  try {
    return new URL(String(location), requestOrigin).origin !== new URL(requestOrigin).origin;
  } catch {
    return true;
  }
}

function redirectRefusedError() {
  const e = new Error("SSRF guard: cross-origin redirect from upstream refused");
  e.code = "ESSRFREDIRECT";
  return e;
}

/**
 * Lightweight zero-Proxy wrapper around an undici handler (supporting both legacy `onConnect/onHeaders`
 * and undici v7+ `onResponseStart`) so cross-origin redirects are refused without ES6 Proxy trap or
 * per-chunk `.bind()` allocations on `onResponseData`.
 */
function guardRedirectHandler(handler, requestOrigin) {
  let legacyAbort = null;
  const wrapped = Object.create(handler);

  if (typeof handler.onConnect === "function") {
    wrapped.onConnect = function (abort, ...rest) {
      legacyAbort = abort;
      return handler.onConnect(abort, ...rest);
    };
  }
  if (typeof handler.onHeaders === "function") {
    wrapped.onHeaders = function (statusCode, rawHeaders, ...rest) {
      if (REDIRECT_STATUSES.has(statusCode) && Array.isArray(rawHeaders)) {
        for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
          if (String(rawHeaders[i]).toLowerCase() === "location") {
            if (isCrossOriginRedirect(requestOrigin, String(rawHeaders[i + 1])) && legacyAbort) {
              legacyAbort(redirectRefusedError());
              return true;
            }
            break;
          }
        }
      }
      return handler.onHeaders(statusCode, rawHeaders, ...rest);
    };
  }
  if (typeof handler.onResponseStart === "function") {
    wrapped.onResponseStart = function (controller, statusCode, headers, statusMessage) {
      const location = headers && (headers.location || headers.Location);
      if (
        REDIRECT_STATUSES.has(statusCode) &&
        location &&
        isCrossOriginRedirect(requestOrigin, location)
      ) {
        controller.abort(redirectRefusedError());
        return;
      }
      return handler.onResponseStart(controller, statusCode, headers, statusMessage);
    };
  }
  if (typeof handler.onResponseData === "function") {
    wrapped.onResponseData = function (controller, chunk) {
      return handler.onResponseData(controller, chunk);
    };
  }
  if (typeof handler.onData === "function") {
    wrapped.onData = function (chunk) {
      return handler.onData(chunk);
    };
  }
  if (typeof handler.onResponseEnd === "function") {
    wrapped.onResponseEnd = function (controller, trailers) {
      return handler.onResponseEnd(controller, trailers);
    };
  }
  if (typeof handler.onComplete === "function") {
    wrapped.onComplete = function (trailers) {
      return handler.onComplete(trailers);
    };
  }
  if (typeof handler.onResponseError === "function") {
    wrapped.onResponseError = function (controller, err) {
      return handler.onResponseError(controller, err);
    };
  }
  if (typeof handler.onError === "function") {
    wrapped.onError = function (err) {
      return handler.onError(err);
    };
  }
  return wrapped;
}

class GuardedAgent extends Agent {
  dispatch(opts, handler) {
    return super.dispatch(opts, guardRedirectHandler(handler, String(opts.origin || "")));
  }
}

class GuardedProxyAgent extends ProxyAgent {
  dispatch(opts, handler) {
    return super.dispatch(opts, guardRedirectHandler(handler, String(opts.origin || "")));
  }
}

/**
 * Return a cached `GuardedAgent` for an explicit SSRF policy `{ blockPrivate, blockLoopback }`.
 * @param {{ blockPrivate: boolean, blockLoopback: boolean }} policy
 */
export function getPolicyGuardedDispatcher(policy) {
  const key = `${policy.blockPrivate ? 1 : 0}${policy.blockLoopback ? 1 : 0}`;
  let agent = guardedAgents.get(key);
  if (!agent) {
    agent = createGuardedAgent(policy);
    guardedAgents.set(key, agent);
  }
  return agent;
}

/**
 * Strict outbound dispatcher blocking cloud metadata, private LAN, and loopback addresses.
 * Suitable for OAuth token exchanges, catalog sync, and external public APIs.
 */
export function getStrictGuardedDispatcher() {
  return getPolicyGuardedDispatcher({ blockPrivate: true, blockLoopback: true });
}

/**
 * Direct (non-proxied) dispatcher for a provider, guarded according to that provider's SSRF policy.
 * @param {any} provider
 * @param {any} storage
 */
export function getGuardedUpstreamDispatcher(provider, storage) {
  const presetKey = typeof provider?.preset === "string" ? provider.preset : "";
  const policy = resolveUpstreamPolicy({
    preset: presetKey,
    category: getPreset(presetKey)?.category,
    allowPrivateUpstreams: storage?.getSettings?.()?.allowPrivateUpstreams
  });
  return getPolicyGuardedDispatcher(policy);
}

/**
 * Read a Fetch `Response` body as UTF-8 text with a hard byte cap and optional idle timeout
 * so hostile or misbehaving upstreams cannot OOM the process via decompression bombs or huge bodies.
 * @param {Response} res
 * @param {number} [maxBytes]
 * @param {number} [idleTimeoutMs]
 * @returns {Promise<string>}
 */
export async function readResponseTextBounded(
  res,
  maxBytes = 10 * 1024 * 1024,
  idleTimeoutMs = 30_000
) {
  if (!res) return "";
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Upstream response exceeded ${maxBytes} byte safety limit`);
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      let timer = null;
      const readPromise = reader.read();
      const result =
        idleTimeoutMs > 0
          ? await Promise.race([
              readPromise,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Upstream response body read timed out")), idleTimeoutMs);
              })
            ])
          : await readPromise;
      if (timer) clearTimeout(timer);
      const { value, done } = result;
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`Upstream response exceeded ${maxBytes} byte safety limit`);
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
}

/**
 * Resolve the master key Buffer for a Storage instance.
 * @param {any} storage
 * @returns {Buffer | null}
 */
function getStorageMasterKey(storage) {
  if (!storage) return null;
  if (Buffer.isBuffer(storage.masterKey)) return storage.masterKey;
  if (typeof storage.getMasterKey === "function") {
    const k = storage.getMasterKey();
    if (Buffer.isBuffer(k)) return k;
  }
  if (storage.dataDir) {
    try {
      return loadOrCreateMasterKeySync(storage.dataDir);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Retrieve the decrypted plaintext proxy URL for a pool record.
 * Works regardless of whether `pool.url` is stored in-memory as plaintext or `enc:v1:...`.
 * @param {any} pool
 * @param {any} [storage]
 * @returns {string}
 */
export function getPlainProxyUrl(pool, storage) {
  const raw = typeof pool?.url === "string" ? pool.url.trim() : "";
  if (!raw) return "";
  if (!isEncrypted(raw)) return raw;
  const masterKey = getStorageMasterKey(storage);
  if (!masterKey) return raw;
  try {
    return decryptSecret(raw, masterKey);
  } catch {
    return "";
  }
}

/**
 * Validate and parse a proxy URL (`http://`, `https://`, `socks5://`).
 * @param {string} rawUrl
 * @returns {{ ok: boolean, url?: string, type?: "http" | "https" | "socks5", host?: string, port?: number, error?: string }}
 */
export function parseProxyUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, error: "Proxy URL is required" };
  }
  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid proxy URL format" };
  }

  if (!VALID_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: "Proxy URL must use http://, https://, or socks5:// protocol"
    };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "Proxy URL is missing a hostname" };
  }

  const type =
    parsed.protocol === "socks5:" || parsed.protocol === "socks5h:"
      ? "socks5"
      : parsed.protocol === "https:"
        ? "https"
        : "http";

  const defaultPort = type === "https" ? 443 : type === "socks5" ? 1080 : 8080;
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Invalid proxy port" };
  }

  return {
    ok: true,
    url: trimmed.replace(/\/+$/, ""),
    type,
    host: parsed.hostname,
    port
  };
}

/**
 * Convert an internal proxy pool record into its public representation with masked credentials.
 * @param {any} pool
 * @param {any} [storage]
 */
export function toPublicProxyPool(pool, storage) {
  const plainUrl = getPlainProxyUrl(pool, storage);
  const parsed = parseProxyUrl(plainUrl);
  return {
    id: pool.id,
    name: pool.name,
    type: pool.type || parsed.type || "http",
    urlMasked: maskProxyUrl(plainUrl),
    enabled: pool.enabled !== false,
    createdAt: pool.createdAt,
    ...(pool.updatedAt ? { updatedAt: pool.updatedAt } : {})
  };
}

/**
 * List all proxy pools from storage.
 * @param {any} storage
 * @returns {any[]}
 */
export function getProxyPools(storage) {
  if (!storage) return [];
  if (typeof storage.getProxyPools === "function") {
    return storage.getProxyPools();
  }
  if (!Array.isArray(storage.data?.proxyPools)) {
    return [];
  }
  return storage.data.proxyPools;
}

/**
 * Look up a single proxy pool by id from storage.
 * @param {any} storage
 * @param {string} poolId
 */
export function getProxyPoolById(storage, poolId) {
  if (!poolId) return null;
  const pools = getProxyPools(storage);
  return pools.find((p) => p.id === poolId) || null;
}

/**
 * Return a tuned, redirect-guarded `undici` `ProxyAgent` dispatcher for a provider when
 * `provider.proxyPoolId` references an enabled proxy pool; otherwise returns the SSRF-guarded direct dispatcher.
 * @param {any} provider
 * @param {any} storage
 * @returns {import("undici").Dispatcher}
 */
export function getProxyDispatcher(provider, storage) {
  const poolId = provider?.proxyPoolId;
  if (!poolId || typeof poolId !== "string") return getGuardedUpstreamDispatcher(provider, storage);

  const cachedByPoolId = poolIdDispatcherCache.get(poolId);
  if (cachedByPoolId) return cachedByPoolId;

  const pool = getProxyPoolById(storage, poolId);
  if (!pool || pool.enabled === false) return getGuardedUpstreamDispatcher(provider, storage);

  // An enabled proxy pool is a hard requirement: if it cannot be used, FAIL CLOSED instead of
  // silently sending the request directly (which would leak the server's real IP / bypass the proxy).
  const plainUrl = getPlainProxyUrl(pool, storage);
  if (!plainUrl) return getFailClosedDispatcher("Proxy pool URL is unavailable");

  const parsed = parseProxyUrl(plainUrl);
  if (!parsed.ok) return getFailClosedDispatcher(parsed.error || "Invalid proxy pool URL");

  // undici's ProxyAgent understands `socks5:` but rejects `socks5h:`; both resolve DNS via the proxy.
  const effectiveUrl = plainUrl.replace(/^socks5h:/i, "socks5:");

  let agent = dispatcherCache.get(effectiveUrl);
  if (!agent) {
    try {
      agent = new GuardedProxyAgent({
        uri: effectiveUrl,
        headersTimeout: 240_000,
        bodyTimeout: 0,
        keepAliveTimeout: 90_000,
        keepAliveMaxTimeout: 300_000,
        connectTimeout: 15_000,
        proxyTls: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 },
        requestTls: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 }
      });
      dispatcherCache.set(effectiveUrl, agent);
    } catch {
      return getFailClosedDispatcher("Proxy pool could not be initialised");
    }
  }
  poolIdDispatcherCache.set(poolId, agent);
  return agent;
}

/** @type {Agent | null} */
let failClosedAgent = null;

/**
 * A dispatcher that refuses every connection. Used when a configured proxy is unusable so traffic
 * never silently bypasses it.
 * @param {string} reason
 */
function getFailClosedDispatcher(reason) {
  if (!failClosedAgent) {
    failClosedAgent = new Agent({
      connect: (_opts, callback) => {
        callback(new Error(`Blocked: ${failClosedAgent?.reason || reason}`), null);
      }
    });
  }
  failClosedAgent.reason = reason;
  return failClosedAgent;
}

/**
 * Clear cached ProxyAgent dispatchers (e.g. when a proxy pool is updated or deleted).
 */
export function clearProxyDispatcherCache() {
  for (const agent of dispatcherCache.values()) {
    try {
      agent.close?.();
    } catch {
      // ignore close error
    }
  }
  dispatcherCache.clear();
  poolIdDispatcherCache.clear();
}

/**
 * Test connectivity to a proxy pool endpoint via DNS-validated TCP handshake.
 * Resolves all DNS addresses and validates them against SSRF policy before connecting.
 * Never exposes credentials in returned messages.
 * @param {any} pool
 * @param {any} [storage]
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, latencyMs: number, message: string }>}
 */
export async function testProxyPoolConnection(pool, storage, timeoutMs = 5000) {
  const plainUrl = getPlainProxyUrl(pool, storage);
  const parsed = parseProxyUrl(plainUrl);
  if (!parsed.ok) {
    return {
      ok: false,
      latencyMs: 0,
      message: parsed.error || "Invalid proxy URL"
    };
  }

  const started = Date.now();
  const host = parsed.host.replace(/^\[|\]$/g, "");
  const port = parsed.port;
  const allowPrivate = storage?.getSettings?.()?.allowPrivateUpstreams;
  const policy = {
    blockPrivate: allowPrivate !== true,
    blockLoopback: allowPrivate === false
  };

  let targetIp = host;
  if (net.isIP(host)) {
    const reason = checkAddressAgainstPolicy(host, policy);
    if (reason) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `SSRF guard: proxy connection blocked (${reason})`
      };
    }
  } else {
    let addrs;
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `Proxy DNS resolution failed: ${err?.message || "host not found"}`
      };
    }
    if (!Array.isArray(addrs) || addrs.length === 0) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: "Proxy DNS resolution returned no addresses"
      };
    }
    for (const a of addrs) {
      const reason = checkAddressAgainstPolicy(a.address, policy);
      if (reason) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: `SSRF guard: proxy host resolves to blocked address (${reason})`
        };
      }
    }
    targetIp = addrs[0].address;
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: targetIp, port });
    let settled = false;

    const finish = (ok, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ok,
        latencyMs: Date.now() - started,
        message: redactSecrets(message, [plainUrl])
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish(
        true,
        `Connected to ${parsed.type.toUpperCase()} proxy ${maskProxyUrl(plainUrl)}`
      );
    });
    socket.once("timeout", () => {
      finish(false, `Proxy connection timed out after ${timeoutMs}ms`);
    });
    socket.once("error", (err) => {
      finish(false, `Proxy connection failed: ${err?.message || "unreachable"}`);
    });
  });
}
