import crypto from "node:crypto";
import { constantTimeEqual, hashRouterKey } from "./security/crypto.js";
import { isLoopbackHost, parseHostHeaderName } from "./security/headers.js";
import { BoundedRateLimiter, extractClientIp } from "./security/ratelimit.js";
import { maskKey as redactMaskKey, redactSecrets } from "./security/redact.js";

export const SESSION_COOKIE_NAME = "r001_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mask an API key so plaintext secrets are never returned in API responses or logs.
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  return redactMaskKey(key);
}

/**
 * Redact any known secret strings and global secret patterns (`sk-…`, `AIza…`, `Bearer …`, etc.)
 * from a log or error message.
 * @param {string} message
 * @param {string[]} [secrets]
 * @returns {string}
 */
export function sanitizeSecrets(message, secrets = []) {
  return redactSecrets(message, secrets);
}

/**
 * Parse HTTP Cookie header into key/value map.
 * @param {string | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (typeof cookieHeader !== "string" || !cookieHeader) return cookies;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawVal);
    } catch {
      cookies[name] = rawVal;
    }
  }
  return cookies;
}

/**
 * Determine whether the incoming request arrived over HTTPS or behind a trusted HTTPS reverse proxy.
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
export function isSecureRequest(req) {
  if (!req) return false;
  if (req.secure === true || req.socket?.encrypted === true) return true;
  // Trust X-Forwarded-Proto when Express `trust proxy` is enabled, on Vercel, or when forwarded
  // from a local loopback reverse proxy (127.0.0.1 / ::1); refuse spoofed headers from external IPs.
  const hasApp = Boolean(req.app && typeof req.app.get === "function");
  const remoteAddr = String(req.socket?.remoteAddress || "");
  const isLoopbackPeer =
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1";
  const trustForwarded = Boolean(
    process.env.VERCEL ||
      isLoopbackPeer ||
      (hasApp ? req.app.get("trust proxy") : true)
  );
  if (trustForwarded) {
    const proto = req.headers?.["x-forwarded-proto"];
    if (typeof proto === "string") {
      const first = proto.split(",")[0].trim().toLowerCase();
      if (first === "https") return true;
    }
  }
  return false;
}

/**
 * Build standard hardened session cookie attributes (`HttpOnly; SameSite=Strict; Path=/` + `Secure` on HTTPS).
 * @param {import("express").Request} [req]
 * @param {number} [maxAge]
 */
export function buildSessionCookieOptions(req, maxAge = SESSION_TTL_MS) {
  const opts = {
    httpOnly: true,
    sameSite: "strict",
    path: "/"
  };
  if (typeof maxAge === "number") {
    opts.maxAge = maxAge;
  }
  if (isSecureRequest(req)) {
    opts.secure = true;
  }
  return opts;
}

/**
 * Sign an HMAC-SHA256 session cookie token with rotation ID (`jti`) and server-side `ver`.
 * @param {string} secret
 * @param {number} [ttlMs]
 * @param {number} [sessionVersion]
 * @returns {string}
 */
export function signSessionToken(secret, ttlMs = SESSION_TTL_MS, sessionVersion = 1) {
  const now = Date.now();
  const payload = {
    sub: "dashboard",
    iat: now,
    exp: now + ttlMs,
    jti: crypto.randomBytes(12).toString("hex"),
    ver: Number(sessionVersion) || 1
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify an HMAC-SHA256 signed session cookie token and optional server-side session version.
 * @param {string | undefined} token
 * @param {string} secret
 * @param {number} [expectedVersion]
 * @returns {{ valid: boolean, payload?: { sub: string, iat: number, exp: number, jti?: string, ver?: number } }}
 */
export function verifySessionToken(token, secret, expectedVersion) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) {
    return { valid: false };
  }
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return { valid: false };

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return { valid: false };

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest();

  let actualSig;
  try {
    actualSig = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false };
  }

  if (actualSig.length !== expectedSig.length) {
    return { valid: false };
  }
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload || typeof payload.exp !== "number" || payload.exp <= Date.now()) {
      return { valid: false };
    }
    if (
      typeof expectedVersion === "number" &&
      typeof payload.ver === "number" &&
      payload.ver !== expectedVersion
    ) {
      return { valid: false };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

/**
 * Check whether an incoming dashboard request carries a valid r001_session cookie.
 * @param {import("express").Request} req
 * @param {string | import("./storage.js").Storage} secretOrStorage
 * @param {number} [expectedVersion]
 * @returns {boolean}
 */
export function isDashboardAuthenticated(req, secretOrStorage, expectedVersion) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (secretOrStorage && typeof secretOrStorage === "object") {
    const secret = secretOrStorage.getSessionSecret?.() || "";
    const ver = secretOrStorage.getSessionVersion?.();
    return verifySessionToken(token, secret, ver).valid;
  }
  return verifySessionToken(token, String(secretOrStorage || ""), expectedVersion).valid;
}

/**
 * Whether this instance is reachable beyond the local machine: a cloud host (Vercel, Render,
 * Railway) or a non-loopback bind address. Safety switches are forced on there.
 * @param {import("./storage.js").Storage} [storage]
 * @returns {boolean}
 */
export function isPublicDeployment(storage) {
  if (process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) return true;
  return !isLoopbackHost(storage?.bindHost || "127.0.0.1");
}

/**
 * Determine whether an incoming request carries a non-loopback tunnel/remote `Host` header.
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
function isRemoteRequestHost(req) {
  if (!req) return false;
  if (req._isTunnelRequest) return true;
  const hostName = parseHostHeaderName(req.headers?.host);
  return Boolean(hostName && !isLoopbackHost(hostName));
}

/**
 * Determine whether the request carries the local host-only CLI authentication token
 * over loopback with zero browser cross-site markers.
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
export function isValidLocalCliRequest(req) {
  if (!req) return false;
  const expectedToken = req.app?.locals?.cliToken;
  const providedToken = req.headers?.["x-001r-cli-token"];
  if (typeof expectedToken !== "string" || !expectedToken || typeof providedToken !== "string" || !providedToken) {
    return false;
  }
  if (!constantTimeEqual(providedToken, expectedToken)) {
    return false;
  }
  const hostName = parseHostHeaderName(req.headers?.host);
  if (!hostName || !isLoopbackHost(hostName)) return false;
  const remoteAddr = String(req.socket?.remoteAddress || "");
  if (
    remoteAddr !== "127.0.0.1" &&
    remoteAddr !== "::1" &&
    remoteAddr !== "::ffff:127.0.0.1"
  ) {
    return false;
  }
  if (req.headers?.origin || req.headers?.referer) return false;
  return true;
}

/**
 * Determine whether dashboard authentication is enforced.
 * On non-loopback hosts or tunnel requests, login is ALWAYS enforced regardless of `settings.requireLogin`.
 * @param {import("./storage.js").Storage} storage
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
export function isDashboardLoginRequired(storage, req) {
  if (!storage || typeof storage !== "object") return true;
  if (isPublicDeployment(storage) || isRemoteRequestHost(req)) return true;
  const settings = storage.getSettings?.();
  return settings?.requireLogin !== false;
}

/**
 * Whether `/v1/*` requires a router API key. Fail-closed: only an explicit `requireKey: false` on a
 * local (loopback) install turns it off. Public deployments and tunnel requests ALWAYS require a key.
 * @param {import("./storage.js").Storage} storage
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
export function isRouterKeyRequired(storage, req) {
  if (!storage || typeof storage !== "object") return true;
  if (isPublicDeployment(storage) || isRemoteRequestHost(req)) return true;
  return storage.getSettings?.()?.requireKey !== false;
}

/**
 * Express middleware protecting dashboard `/api/*` endpoints.
 * @param {import("./storage.js").Storage} storage
 */
export function createDashboardAuthMiddleware(storage) {
  return (req, res, next) => {
    if (isValidLocalCliRequest(req)) {
      return next();
    }
    if (!isDashboardLoginRequired(storage, req)) {
      return next();
    }
    const secret = storage.getSessionSecret();
    const version = storage.getSessionVersion?.();
    if (!isDashboardAuthenticated(req, secret, version)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (isPasswordChangeRequired(storage) && !isPasswordChangeAllowedPath(req)) {
      return res.status(403).json({
        error: "Default dashboard password must be changed before using the dashboard",
        code: "PASSWORD_CHANGE_REQUIRED"
      });
    }
    next();
  };
}

/**
 * True when the server enforces replacing the shipped default password (`1234`) and it is still active.
 * Only meaningful when dashboard login is enforced.
 * @param {import("./storage.js").Storage} storage
 */
export function isPasswordChangeRequired(storage) {
  if (!storage || storage.enforcePasswordChange !== true) return false;
  if (!isDashboardLoginRequired(storage)) return false;
  return Boolean(storage.isDefaultPasswordSync?.());
}

/** Endpoints a session may still use while a password change is pending. */
function isPasswordChangeAllowedPath(req) {
  const pathname = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "");
  return pathname === "/api/settings/password";
}

/** @type {WeakMap<any, Set<string>>} */
const allowListSetCache = new WeakMap();

/**
 * Check whether a router API key's per-key access restriction permits calling `requestedModel`.
 * Uses cached lowercase Set for O(1) lookup on hot path.
 * @param {any} routerKey
 * @param {string} requestedModel
 * @returns {boolean}
 */
export function isRouterKeyModelAllowed(routerKey, requestedModel) {
  if (!routerKey || !routerKey.access || routerKey.access.restricted !== true) {
    return true;
  }
  const allowList = Array.isArray(routerKey.access.allow) ? routerKey.access.allow : [];
  if (allowList.length === 0) return false;
  const reqNorm = String(requestedModel || "").trim().toLowerCase();
  if (!reqNorm) return false;

  let set = allowListSetCache.get(allowList);
  if (!set) {
    set = new Set();
    for (let i = 0; i < allowList.length; i++) {
      const s = String(allowList[i] || "").trim().toLowerCase();
      if (s) set.add(s);
    }
    allowListSetCache.set(allowList, set);
  }
  return set.has(reqNorm);
}

function cleanExtractedToken(val) {
  if (typeof val !== "string") return "";
  return val.trim().replace(/^["']+|["']+$/g, "").trim();
}

/**
 * Extract a router API token from Authorization Bearer/bare, x-api-key, api-key,
 * x-goog-api-key headers, or query params (`?key=` / `?api_key=`).
 * @param {import("express").Request} req
 * @returns {string}
 */
export function extractRouterApiKey(req) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      const cleaned = cleanExtractedToken(match[1]);
      if (cleaned) return cleaned;
    } else {
      const bare = cleanExtractedToken(authHeader);
      if (bare && !/\s/.test(bare)) {
        return bare;
      }
    }
  }
  const xApiKey = cleanExtractedToken(req.headers?.["x-api-key"]);
  if (xApiKey) return xApiKey;
  const apiKeyHeader = cleanExtractedToken(req.headers?.["api-key"]);
  if (apiKeyHeader) return apiKeyHeader;
  const xGoogApiKey = cleanExtractedToken(req.headers?.["x-goog-api-key"]);
  if (xGoogApiKey) return xGoogApiKey;
  const queryKey = cleanExtractedToken(req.query?.key ?? req.query?.api_key);
  if (queryKey) return queryKey;
  return "";
}

/**
 * Match an incoming plaintext router API key against stored hashed (or legacy) router keys
 * using O(1) hash-index lookup (when available) + constant-time SHA-256 comparison.
 * @param {string} token
 * @param {any[]} keys
 * @param {Map<string, any>} [keysByHash]
 * @returns {any | null}
 */
export function matchRouterApiKey(token, keys, keysByHash = null) {
  if (typeof token !== "string" || !token || !Array.isArray(keys)) {
    return null;
  }
  const incomingHash = hashRouterKey(token);
  if (keysByHash && keysByHash.size > 0) {
    const candidate = keysByHash.get(incomingHash);
    if (
      candidate &&
      candidate.enabled !== false &&
      typeof candidate.keyHash === "string" &&
      constantTimeEqual(incomingHash, candidate.keyHash)
    ) {
      return candidate;
    }
  }
  let matched = null;
  for (const k of keys) {
    if (!k || k.enabled === false) continue;
    const storedHash =
      typeof k.keyHash === "string" && k.keyHash
        ? k.keyHash
        : typeof k.key === "string" && k.key
          ? hashRouterKey(k.key)
          : "";
    if (storedHash && constantTimeEqual(incomingHash, storedHash)) {
      matched = k;
    }
  }
  return matched;
}

/**
 * Express middleware authenticating external CLI/IDE requests to `/v1/*`.
 * Skips redundant re-verification if already verified on this request, and throttles repeated
 * invalid-key brute-force attempts per IP.
 * @param {import("./storage.js").Storage} storage
 * @param {{ authFailureLimiter?: BoundedRateLimiter }} [options]
 */
export function createRouterAuthMiddleware(storage, options = {}) {
  const failureLimiter =
    options.authFailureLimiter ||
    new BoundedRateLimiter({
      windowMs: 60_000,
      maxRequests: Number(process.env.ROUTER001_V1_AUTH_FAIL_RPM) || 60
    });

  return async (req, res, next) => {
    if (req._routerAuthVerified) {
      return next();
    }
    const token = extractRouterApiKey(req);
    let keys = storage.getKeys();
    let keysByHash = storage.getKeysByHashIndex?.() || null;
    let matched = token ? matchRouterApiKey(token, keys, keysByHash) : null;

    if (!matched && token && storage.pgPool && typeof storage.refreshFromPostgres === "function") {
      await storage.refreshFromPostgres(true).catch(() => {});
      keys = storage.getKeys();
      keysByHash = storage.getKeysByHashIndex?.() || null;
      matched = matchRouterApiKey(token, keys, keysByHash);
    }

    if (isRouterKeyRequired(storage, req)) {
      if (!matched) {
        const ip = extractClientIp(req);
        const failCheck = failureLimiter.consume(ip);
        if (!failCheck.allowed) {
          res.setHeader("Retry-After", String(failCheck.retryAfterSec));
          return res.status(429).json({
            error: {
              message: "Too many failed authentication attempts. Please retry later.",
              type: "rate_limit_error"
            }
          });
        }
        return res.status(401).json({
          error: {
            message: "Invalid or missing router API key",
            type: "authentication_error"
          }
        });
      }
    }

    req.routerKey = matched;
    req._routerAuthVerified = true;
    next();
  };
}
