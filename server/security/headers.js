export const CSP_HEADER_VALUE =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h.startsWith("127.")
  );
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
