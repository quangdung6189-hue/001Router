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

/** @type {Map<string, ProxyAgent>} */
const dispatcherCache = new Map();
/** @type {Agent | null} */
let defaultUpstreamAgent = null;

/**
 * Return a tuned default undici Agent for direct upstream requests:
 * - Fast IPv4/IPv6 Happy Eyeballs (500ms attempt timeout) + 15s connect timeout to prevent 120s Windows IPv6 stalls
 * - Disabled bodyTimeout (0) so long SSE streams never get killed mid-generation
 * - Clean keepAlive bounds to avoid stale half-open sockets
 * @returns {Agent}
 */
export function getDefaultUpstreamDispatcher() {
  if (!defaultUpstreamAgent) {
    defaultUpstreamAgent = new Agent({
      connect: {
        timeout: 15_000,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 500
      },
      headersTimeout: 120_000,
      bodyTimeout: 0,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000
    });
  }
  return defaultUpstreamAgent;
}

/** @type {Map<string, Agent>} */
const guardedAgents = new Map();

/**
 * Create an undici Agent that validates the DESTINATION ADDRESS of every outbound connection:
 * - hostnames are resolved here and every returned address is checked (defeats `*.nip.io`, wildcard DNS
 *   and DNS-rebinding style names pointing at 169.254.169.254 / private ranges),
 * - IP literals are checked too, which also covers HTTP redirects to `http://169.254.169.254/`.
 * Cloud-metadata / link-local is always blocked; private LAN / loopback follow `policy`.
 * @param {{ blockPrivate: boolean, blockLoopback: boolean }} policy
 */
export function createGuardedAgent(policy) {
  const lookup = (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return callback(err);
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
    autoSelectFamilyAttemptTimeout: 500,
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
    headersTimeout: 120_000,
    bodyTimeout: 0,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000
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
 * Wrap an undici handler (both the legacy `onConnect/onHeaders` API used by Node's built-in `fetch`
 * and the new `onResponseStart` API used by the npm `undici.fetch`) so that cross-origin redirects are refused.
 * LLM provider APIs do not need them, and following one would forward provider credentials sent in custom
 * headers (`x-api-key`, `api-key`, `x-goog-api-key`; fetch only strips `Authorization`) to another host.
 * Same-origin redirects (e.g. `/v1/x` -> `/v1/y`) are still followed.
 */
function guardRedirectHandler(handler, requestOrigin) {
  let legacyAbort = null;
  return new Proxy(handler, {
    get(target, prop) {
      if (prop === "onConnect") {
        return (abort, ...rest) => {
          legacyAbort = abort;
          return target.onConnect?.(abort, ...rest);
        };
      }
      if (prop === "onHeaders") {
        if (typeof target.onHeaders !== "function") return undefined;
        return (statusCode, rawHeaders, ...rest) => {
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
          return target.onHeaders(statusCode, rawHeaders, ...rest);
        };
      }
      if (prop === "onResponseStart") {
        if (typeof target.onResponseStart !== "function") return undefined;
        return (controller, statusCode, headers, statusMessage) => {
          const location = headers && (headers.location || headers.Location);
          if (REDIRECT_STATUSES.has(statusCode) && location && isCrossOriginRedirect(requestOrigin, location)) {
            controller.abort(redirectRefusedError());
            return;
          }
          return target.onResponseStart(controller, statusCode, headers, statusMessage);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    }
  });
}

class GuardedAgent extends Agent {
  dispatch(opts, handler) {
    return super.dispatch(opts, guardRedirectHandler(handler, String(opts.origin || "")));
  }
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
  const key = `${policy.blockPrivate ? 1 : 0}${policy.blockLoopback ? 1 : 0}`;
  let agent = guardedAgents.get(key);
  if (!agent) {
    agent = createGuardedAgent(policy);
    guardedAgents.set(key, agent);
  }
  return agent;
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
 * Return an `undici` `ProxyAgent` dispatcher for a provider when `provider.proxyPoolId`
 * references an enabled proxy pool; otherwise returns the SSRF-guarded direct dispatcher.
 * @param {any} provider
 * @param {any} storage
 * @returns {import("undici").Dispatcher}
 */
export function getProxyDispatcher(provider, storage) {
  const poolId = provider?.proxyPoolId;
  if (!poolId || typeof poolId !== "string") return getGuardedUpstreamDispatcher(provider, storage);
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
      agent = new ProxyAgent(effectiveUrl);
      dispatcherCache.set(effectiveUrl, agent);
    } catch {
      return getFailClosedDispatcher("Proxy pool could not be initialised");
    }
  }
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
}

/**
 * Test connectivity to a proxy pool endpoint via TCP handshake (and optional target fetch).
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

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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
