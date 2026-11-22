import net from "node:net";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import { maskProxyUrl, redactSecrets } from "./security/redact.js";

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
 * references an enabled proxy pool. Returns `undefined` when no proxy pool is active.
 * @param {any} provider
 * @param {any} storage
 * @returns {ProxyAgent | undefined}
 */
export function getProxyDispatcher(provider, storage) {
  const poolId = provider?.proxyPoolId;
  if (!poolId || typeof poolId !== "string") return undefined;
  const pool = getProxyPoolById(storage, poolId);
  if (!pool || pool.enabled === false) return undefined;

  const plainUrl = getPlainProxyUrl(pool, storage);
  if (!plainUrl) return undefined;

  const parsed = parseProxyUrl(plainUrl);
  if (!parsed.ok) return undefined;

  let agent = dispatcherCache.get(plainUrl);
  if (!agent) {
    try {
      agent = new ProxyAgent(plainUrl);
      dispatcherCache.set(plainUrl, agent);
    } catch {
      return undefined;
    }
  }
  return agent;
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
