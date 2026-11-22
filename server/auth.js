import crypto from "node:crypto";
import { constantTimeEqual, hashRouterKey } from "./security/crypto.js";
import { isLoopbackHost } from "./security/headers.js";
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
 * Determine whether the incoming request arrived over HTTPS or behind an HTTPS reverse proxy.
 * @param {import("express").Request} [req]
 * @returns {boolean}
 */
export function isSecureRequest(req) {
  if (!req) return false;
  if (req.secure === true) return true;
  const proto = req.headers?.["x-forwarded-proto"];
  if (typeof proto === "string") {
    const first = proto.split(",")[0].trim().toLowerCase();
    if (first === "https") return true;
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
 * Determine whether dashboard authentication is enforced.
 * On non-loopback hosts, login is ALWAYS enforced regardless of `settings.requireLogin`.
 * @param {import("./storage.js").Storage} storage
 * @returns {boolean}
 */
export function isDashboardLoginRequired(storage) {
  if (!storage || typeof storage !== "object") return true;
  if (!isLoopbackHost(storage.bindHost || "127.0.0.1")) return true;
  const settings = storage.getSettings?.();
  return settings?.requireLogin !== false;
}

/**
 * Express middleware protecting dashboard `/api/*` endpoints.
 * @param {import("./storage.js").Storage} storage
 */
export function createDashboardAuthMiddleware(storage) {
  return (req, res, next) => {
    if (!isDashboardLoginRequired(storage)) {
      return next();
    }
    const secret = storage.getSessionSecret();
    const version = storage.getSessionVersion?.();
    if (!isDashboardAuthenticated(req, secret, version)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}

/**
 * Check whether a router API key's per-key access restriction permits calling `requestedModel`.
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
  return allowList.some((entry) => String(entry || "").trim().toLowerCase() === reqNorm);
}

/**
 * Extract a router API token from Authorization Bearer or x-api-key headers.
 * @param {import("express").Request} req
 * @returns {string}
 */
export function extractRouterApiKey(req) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  const xApiKey = req.headers?.["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim()) {
    return xApiKey.trim();
  }
  return "";
}

/**
 * Match an incoming plaintext router API key against stored hashed (or legacy) router keys
 * using constant-time SHA-256 hash comparison.
 * @param {string} token
 * @param {any[]} keys
 * @returns {any | null}
 */
export function matchRouterApiKey(token, keys) {
  if (typeof token !== "string" || !token || !Array.isArray(keys)) {
    return null;
  }
  const incomingHash = hashRouterKey(token);
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
 * @param {import("./storage.js").Storage} storage
 */
export function createRouterAuthMiddleware(storage) {
  return (req, res, next) => {
    const settings = storage.getSettings();
    const token = extractRouterApiKey(req);
    const keys = storage.getKeys();
    const matched = token ? matchRouterApiKey(token, keys) : null;

    if (settings.requireKey !== false) {
      if (!matched) {
        return res.status(401).json({
          error: {
            message: "Invalid or missing router API key",
            type: "authentication_error"
          }
        });
      }
    }

    req.routerKey = matched;
    next();
  };
}
