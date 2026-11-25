export const LOCKOUT_5_FAILURES_MS = 60 * 1000; // 1 minute
export const LOCKOUT_10_FAILURES_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_LOCKOUT_MS = 60 * 60 * 1000; // 60 minutes
export const GLOBAL_WINDOW_MS = 60 * 1000;
export const GLOBAL_MAX_FAILURES_PER_WINDOW = 50;
export const MAX_TRACKED_IPS = 10_000;

/**
 * Extract normalized client IP address from Express request.
 * @param {import("express").Request} req
 * @returns {string}
 */
export function extractClientIp(req) {
  if (process.env.VERCEL) {
    const vercelFwd = req?.headers?.["x-vercel-forwarded-for"];
    const realIp = req?.headers?.["x-real-ip"];
    const candidate =
      (typeof vercelFwd === "string" && vercelFwd.split(",")[0].trim()) ||
      (typeof realIp === "string" && realIp.trim()) ||
      "";
    if (candidate) {
      return candidate.replace(/^::ffff:/, "");
    }
  }
  const raw = req?.ip || req?.socket?.remoteAddress || "127.0.0.1";
  return String(raw).replace(/^::ffff:/, "") || "127.0.0.1";
}

/**
 * Compute lockout duration in milliseconds for a given failure count.
 * - < 5 failures: 0 ms
 * - 5..9 failures: 1 minute (60,000 ms)
 * - >= 10 failures: 15 minutes (900,000 ms) scaling exponentially up to 60 minutes
 * @param {number} failures
 * @returns {number}
 */
export function computeLockoutDurationMs(failures) {
  if (failures < 5) return 0;
  if (failures < 10) return LOCKOUT_5_FAILURES_MS;
  const tier = Math.floor((failures - 10) / 5);
  return Math.min(LOCKOUT_10_FAILURES_MS * Math.pow(2, tier), MAX_LOCKOUT_MS);
}

export class LoginRateLimiter {
  constructor(options = {}) {
    /** @type {Map<string, { failures: number, lockedUntil: number, lastFailureAt: number }>} */
    this.byIp = new Map();
    /** @type {number[]} */
    this.globalFailureTimestamps = [];
    this.globalLockedUntil = 0;
    this.maxEntries = Math.max(100, Number(options.maxEntries) || MAX_TRACKED_IPS);
    this._lastPruneAt = 0;
  }

  _prune(now) {
    if (this.byIp.size <= this.maxEntries && now - this._lastPruneAt < 60_000) {
      return;
    }
    this._lastPruneAt = now;
    const staleCutoff = now - MAX_LOCKOUT_MS;
    for (const [ip, entry] of this.byIp.entries()) {
      if (entry.lockedUntil <= now && entry.lastFailureAt < staleCutoff) {
        this.byIp.delete(ip);
      }
    }
    while (this.byIp.size > this.maxEntries) {
      const oldestKey = this.byIp.keys().next().value;
      if (oldestKey === undefined) break;
      this.byIp.delete(oldestKey);
    }
  }

  /**
   * Check whether a login attempt from `ip` is currently permitted.
   * @param {string} ip
   * @param {number} [now]
   * @returns {{ allowed: boolean, retryAfterSec: number, lockedUntil: number, failures: number, reason?: string }}
   */
  check(ip, now = Date.now()) {
    const key = String(ip || "127.0.0.1");

    if (this.globalLockedUntil > now) {
      const retryAfterSec = Math.max(1, Math.ceil((this.globalLockedUntil - now) / 1000));
      return {
        allowed: false,
        retryAfterSec,
        lockedUntil: this.globalLockedUntil,
        failures: this.globalFailureTimestamps.length,
        reason: "global_rate_limit"
      };
    }

    const entry = this.byIp.get(key);
    if (!entry) {
      return { allowed: true, retryAfterSec: 0, lockedUntil: 0, failures: 0 };
    }

    if (entry.lockedUntil > now) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      return {
        allowed: false,
        retryAfterSec,
        lockedUntil: entry.lockedUntil,
        failures: entry.failures,
        reason: "ip_lockout"
      };
    }

    return {
      allowed: true,
      retryAfterSec: 0,
      lockedUntil: 0,
      failures: entry.failures
    };
  }

  /**
   * Record a failed login attempt for `ip` and apply exponential lockout when thresholds are reached.
   * @param {string} ip
   * @param {number} [now]
   * @returns {{ failures: number, lockedUntil: number, retryAfterSec: number }}
   */
  recordFailure(ip, now = Date.now()) {
    this._prune(now);
    const key = String(ip || "127.0.0.1");
    const existing = this.byIp.get(key) || {
      failures: 0,
      lockedUntil: 0,
      lastFailureAt: 0
    };

    existing.failures += 1;
    existing.lastFailureAt = now;

    const lockoutMs = computeLockoutDurationMs(existing.failures);
    if (lockoutMs > 0) {
      existing.lockedUntil = Math.max(existing.lockedUntil, now + lockoutMs);
    }

    // Refresh insertion order for LRU eviction
    this.byIp.delete(key);
    this.byIp.set(key, existing);

    // Track global failure rate within sliding 60s window
    const cutoff = now - GLOBAL_WINDOW_MS;
    this.globalFailureTimestamps = this.globalFailureTimestamps.filter((ts) => ts >= cutoff);
    this.globalFailureTimestamps.push(now);
    if (this.globalFailureTimestamps.length >= GLOBAL_MAX_FAILURES_PER_WINDOW) {
      this.globalLockedUntil = Math.max(this.globalLockedUntil, now + LOCKOUT_5_FAILURES_MS);
    }

    const retryAfterSec =
      existing.lockedUntil > now
        ? Math.max(1, Math.ceil((existing.lockedUntil - now) / 1000))
        : 0;

    return {
      failures: existing.failures,
      lockedUntil: existing.lockedUntil,
      retryAfterSec
    };
  }

  /**
   * Clear failure counter and lockout state for `ip` upon successful login.
   * @param {string} ip
   */
  recordSuccess(ip) {
    const key = String(ip || "127.0.0.1");
    this.byIp.delete(key);
  }

  /**
   * Reset all rate limiter state.
   */
  reset() {
    this.byIp.clear();
    this.globalFailureTimestamps = [];
    this.globalLockedUntil = 0;
  }
}

export function createLoginRateLimiter(options = {}) {
  return new LoginRateLimiter(options);
}

/**
 * Bounded fixed-window + sliding-carryover rate limiter for DoS/flood protection across
 * `/v1/*`, `/api/*`, and expensive amplification routes.
 * Guarantees O(1) memory upper bound (`maxEntries`) and O(1) check/consume latency.
 */
export class BoundedRateLimiter {
  /**
   * @param {{ windowMs?: number, maxRequests?: number, maxEntries?: number }} [options]
   */
  constructor(options = {}) {
    this.windowMs = Math.max(1000, Number(options.windowMs) || 60_000);
    this.maxRequests = Math.max(1, Number(options.maxRequests) || 120);
    this.maxEntries = Math.max(100, Number(options.maxEntries) || MAX_TRACKED_IPS);
    /** @type {Map<string, { windowStart: number, count: number, prevCount: number }>} */
    this.buckets = new Map();
    this._lastSweep = 0;
  }

  _sweep(now) {
    if (this.buckets.size < this.maxEntries && now - this._lastSweep < this.windowMs) {
      return;
    }
    this._lastSweep = now;
    const expireBefore = now - this.windowMs * 2;
    for (const [k, b] of this.buckets.entries()) {
      if (b.windowStart < expireBefore) {
        this.buckets.delete(k);
      }
    }
    while (this.buckets.size > this.maxEntries) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  /**
   * Consume `weight` unit(s) for `key` and return allowance + remaining quota.
   * @param {string} key
   * @param {number} [now]
   * @param {number} [weight]
   */
  consume(key, now = Date.now(), weight = 1) {
    this._sweep(now);
    const k = String(key || "127.0.0.1");
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = { windowStart: now, count: 0, prevCount: 0 };
    } else {
      const elapsed = now - bucket.windowStart;
      if (elapsed >= this.windowMs * 2) {
        bucket.windowStart = now;
        bucket.prevCount = 0;
        bucket.count = 0;
      } else if (elapsed >= this.windowMs) {
        bucket.windowStart += this.windowMs;
        bucket.prevCount = bucket.count;
        bucket.count = 0;
      }
      // Refresh LRU position
      this.buckets.delete(k);
    }
    this.buckets.set(k, bucket);

    const elapsedInWindow = Math.max(0, Math.min(this.windowMs, now - bucket.windowStart));
    const prevWeight = (this.windowMs - elapsedInWindow) / this.windowMs;
    const effectiveCount = bucket.count + bucket.prevCount * prevWeight;

    if (effectiveCount + weight > this.maxRequests) {
      const retryAfterMs = Math.max(1000, this.windowMs - elapsedInWindow);
      return {
        allowed: false,
        remaining: 0,
        limit: this.maxRequests,
        retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000))
      };
    }

    bucket.count += weight;
    const remaining = Math.max(0, Math.floor(this.maxRequests - (effectiveCount + weight)));
    return {
      allowed: true,
      remaining,
      limit: this.maxRequests,
      retryAfterSec: 0
    };
  }

  reset() {
    this.buckets.clear();
  }
}

/**
 * Create an Express rate-limiting middleware backed by `BoundedRateLimiter`.
 * @param {{
 *   windowMs?: number,
 *   maxRequests?: number,
 *   maxEntries?: number,
 *   message?: string,
 *   keyGenerator?: (req: import("express").Request) => string,
 *   skip?: (req: import("express").Request) => boolean
 * }} [options]
 */
export function createRateLimitMiddleware(options = {}) {
  const limiter = new BoundedRateLimiter(options);
  const message = options.message || "Too many requests. Please slow down and try again shortly.";
  const keyGen = options.keyGenerator || ((req) => extractClientIp(req));
  const skip = options.skip || null;

  const middleware = (req, res, next) => {
    if (skip && skip(req)) return next();
    const result = limiter.consume(keyGen(req));
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      const p = String(req.originalUrl || req.path || "");
      if (p.startsWith("/v1")) {
        return res.status(429).json({
          error: {
            message,
            type: "rate_limit_error",
            retryAfterSec: result.retryAfterSec
          }
        });
      }
      return res.status(429).json({
        error: message,
        retryAfterSec: result.retryAfterSec
      });
    }
    return next();
  };
  middleware.limiter = limiter;
  return middleware;
}
