import net from "node:net";

export const CSP_HEADER_VALUE =
  "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const PERMISSIONS_POLICY_VALUE =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

export const CUSTOM_CSRF_HEADER = "x-requested-with";
export const CUSTOM_CSRF_VALUE = "001router";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Determine whether a bind host is a loopback address (`127.0.0.0/8`, `::1`, `localhost`).
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = String(host || "127.0.0.1")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  // `127.` prefix is only loopback for a real IPv4 literal; `127.0.0.1.evil.com` is a public DNS name.
  return h === "localhost" || h === "::1" || (net.isIPv4(h) && h.startsWith("127."));
}

/**
 * Extract the lowercase hostname (no port, no IPv6 brackets) from a raw `Host` header value.
 * @param {unknown} rawHost
 * @returns {string}
 */
export function parseHostHeaderName(rawHost) {
  const v = String(rawHost || "").trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end > 0 ? v.slice(1, end) : "";
  }
  const colon = v.lastIndexOf(":");
  return (colon > -1 ? v.slice(0, colon) : v).replace(/\.+$/, "");
}

/**
 * Parse a comma-separated list of extra allowed Host names (e.g. `ROUTER001_ALLOWED_HOSTS`).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseAllowedHosts(raw) {
  return String(raw || "")
    .split(",")
    .map((h) => parseHostHeaderName(h.trim()))
    .filter(Boolean);
}

/**
 * DNS-rebinding guard. When the server is bound to a loopback address, only accept requests whose
 * `Host` header is itself a loopback name (`localhost`, `127.x.x.x`, `::1`) or is explicitly listed in
 * `allowedHosts` / `ROUTER001_ALLOWED_HOSTS`. This stops a malicious web page that rebinds its DNS name to
 * 127.0.0.1 from talking to the dashboard/API as if it were same-origin.
 * Not enforced for non-loopback binds or managed platforms (Vercel/Render/Railway), where a public Host is expected.
 * @param {{ bindHost?: string, allowedHosts?: string[] }} [options]
 */
export function createHostGuardMiddleware(options = {}) {
  const managed = Boolean(
    process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT
  );
  const enforced = !managed && isLoopbackHost(options.bindHost || "127.0.0.1");
  const extra = new Set(
    [...(options.allowedHosts || []), ...parseAllowedHosts(process.env.ROUTER001_ALLOWED_HOSTS)].map(
      (h) => parseHostHeaderName(h)
    )
  );
  return (req, res, next) => {
    if (!enforced) return next();
    const name = parseHostHeaderName(req.headers?.host);
    if (name && (isLoopbackHost(name) || extra.has(name))) return next();
    const message =
      "Host header not allowed. Access 001Router via localhost/127.0.0.1, or add this host to ROUTER001_ALLOWED_HOSTS.";
    if (req.path === "/v1" || req.path.startsWith("/v1/") || req.path.startsWith("/v1beta/")) {
      return res.status(403).json({ error: { message, type: "invalid_request_error" } });
    }
    return res.status(403).json({ error: message });
  };
}

/**
 * Check whether an Origin or Referer URL matches the current request's Host header.
 * @param {string} originOrReferer
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function isSameOriginUrl(originOrReferer, req) {
  if (typeof originOrReferer !== "string" || !originOrReferer.trim()) {
    return false;
  }
  const reqHost = String(req.headers?.host || "").trim().toLowerCase();
  if (!reqHost) return false;
  try {
    const parsed = new URL(originOrReferer.trim());
    return parsed.host.toLowerCase() === reqHost;
  } catch {
    return false;
  }
}

/**
 * Express middleware setting mandatory security headers on all responses (Section 9.8 #7).
 */
export function createSecurityHeadersMiddleware() {
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP_HEADER_VALUE);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY_VALUE);

    if (req.path === "/api" || req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }

    next();
  };
}

/**
 * Express middleware implementing CORS lockdown (Section 9.8 #4):
 * - `/api/*`: same-origin only (never reflects cross-origin Origin or sets Access-Control-Allow-Origin: *)
 * - `/v1/*`: allows `*` WITHOUT credentials (Bearer-token / x-api-key auth only)
 */
export function createCorsMiddleware() {
  return (req, res, next) => {
    const isApi = req.path === "/api" || req.path.startsWith("/api/");
    const isV1 = req.path === "/v1" || req.path.startsWith("/v1/");

    if (isV1) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, x-api-key, anthropic-version"
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      if (req.method === "OPTIONS") {
        return res.status(204).end();
      }
      return next();
    }

    if (isApi) {
      const origin = req.headers?.origin;
      res.setHeader("Vary", "Origin");
      if (origin) {
        if (!isSameOriginUrl(origin, req)) {
          // Cross-origin request to /api/*: never grant CORS headers; block preflight with 403
          if (req.method === "OPTIONS") {
            return res.status(403).json({
              error: "CORS policy: cross-origin access to /api/* is forbidden"
            });
          }
          return next();
        }
        // Same-origin
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, X-Requested-With, X-Confirm-Password, X-Export-Passphrase, X-Import-Passphrase"
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        );
      }
      if (req.method === "OPTIONS") {
        return res.status(204).end();
      }
      return next();
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  };
}

/**
 * Express middleware enforcing CSRF / Origin check on state-changing `/api/*` requests (Section 9.8 #5).
 * Blocks any cross-origin `Origin`, `Sec-Fetch-Site: cross-site`, or cross-origin `Referer` with 403.
 */
export function createCsrfMiddleware() {
  return (req, res, next) => {
    const method = String(req.method || "").toUpperCase();
    if (!STATE_CHANGING_METHODS.has(method)) {
      return next();
    }

    const origin = req.headers?.origin;
    if (typeof origin === "string" && origin.trim()) {
      if (!isSameOriginUrl(origin, req)) {
        return res.status(403).json({
          error: "CSRF protection: cross-origin request blocked"
        });
      }
    }

    const secFetchSite =
      typeof req.headers?.["sec-fetch-site"] === "string"
        ? req.headers["sec-fetch-site"].trim().toLowerCase()
        : "";
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
      return res.status(403).json({
        error: "CSRF protection: cross-site request blocked"
      });
    }

    const referer = req.headers?.referer;
    if (!origin && typeof referer === "string" && referer.trim()) {
      if (!isSameOriginUrl(referer, req)) {
        return res.status(403).json({
          error: "CSRF protection: cross-origin referer blocked"
        });
      }
    }

    next();
  };
}
