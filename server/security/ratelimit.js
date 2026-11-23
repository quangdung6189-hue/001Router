export const LOCKOUT_5_FAILURES_MS = 60 * 1000; // 1 minute
export const LOCKOUT_10_FAILURES_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_LOCKOUT_MS = 60 * 60 * 1000; // 60 minutes
export const GLOBAL_WINDOW_MS = 60 * 1000;
export const GLOBAL_MAX_FAILURES_PER_WINDOW = 50;

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
  constructor() {
    /** @type {Map<string, { failures: number, lockedUntil: number, lastFailureAt: number }>} */
    this.byIp = new Map();
    /** @type {number[]} */
    this.globalFailureTimestamps = [];
    this.globalLockedUntil = 0;
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

export function createLoginRateLimiter() {
  return new LoginRateLimiter();
}
