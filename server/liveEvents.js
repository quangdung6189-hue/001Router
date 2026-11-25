/**
 * Real-time SSE event hub for:
 * 1) Live Usage & Provider Topology stream (`/api/usage/stream`)
 * 2) Live Server Console Log ring buffer & stream (`/api/console-logs`, `/api/console-logs/stream`)
 *
 * Hardened against SSE connection floods (global + per-IP caps), slow-client memory exhaustion
 * (writableLength drop guard), and broadcast CPU amplification (coalesced snapshot timer + shared heartbeat).
 */

import { nanoid } from "nanoid";
import { extractClientIp } from "./security/ratelimit.js";
import { redactSecrets } from "./security/redact.js";

const MAX_CONSOLE_LOGS = 500;
const MAX_RECENT_REQUESTS = 100;
const MAX_SSE_CLIENTS_GLOBAL = Number(process.env.ROUTER001_MAX_SSE_CLIENTS) || 50;
const MAX_SSE_CLIENTS_PER_IP = Number(process.env.ROUTER001_MAX_SSE_PER_IP) || 8;
const MAX_CLIENT_BUFFER_BYTES = 256 * 1024;
const USAGE_BROADCAST_COALESCE_MS = 120;

export class LiveEventsHub {
  constructor(options = {}) {
    /** @type {Map<string, number>} providerSlug -> active in-flight count */
    this.activeRequests = new Map();
    /** @type {Map<string, string[]>} providerSlug -> active in-flight model ids */
    this.activeModels = new Map();
    /** @type {Array<any>} */
    this.recentRequests = [];
    /** @type {{ provider: string, message: string, at: string } | null} */
    this.errorProvider = null;
    /** @type {Set<import("express").Response>} */
    this.usageClients = new Set();

    /** @type {Array<{ id: string, timestamp: string, level: string, scope: string, message: string }>} */
    this.consoleLogs = [];
    /** @type {Set<import("express").Response>} */
    this.consoleClients = new Set();

    /** @type {Map<string, number>} */
    this._ipCounts = new Map();
    /** @type {WeakMap<import("express").Response, string>} */
    this._clientIp = new WeakMap();
    this.maxClientsGlobal = Math.max(2, Number(options.maxClientsGlobal) || MAX_SSE_CLIENTS_GLOBAL);
    this.maxClientsPerIp = Math.max(1, Number(options.maxClientsPerIp) || MAX_SSE_CLIENTS_PER_IP);
    this._heartbeatTimer = null;
    this._broadcastTimer = null;
  }

  _totalClients() {
    return this.usageClients.size + this.consoleClients.size;
  }

  _ensureHeartbeat() {
    if (this._heartbeatTimer || this._totalClients() === 0) return;
    this._heartbeatTimer = setInterval(() => {
      this._writeToSet(this.usageClients, ": heartbeat\n\n");
      this._writeToSet(this.consoleClients, ": heartbeat\n\n");
      if (this._totalClients() === 0 && this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }, 20_000);
    this._heartbeatTimer.unref?.();
  }

  _registerClient(req, res, targetSet) {
    const ip = extractClientIp(req);
    const ipCount = this._ipCounts.get(ip) || 0;
    if (this._totalClients() >= this.maxClientsGlobal || ipCount >= this.maxClientsPerIp) {
      res.status(429).json({
        error: "Too many concurrent live event streams. Close unused dashboard tabs and retry."
      });
      return false;
    }
    this._ipCounts.set(ip, ipCount + 1);
    this._clientIp.set(res, ip);
    targetSet.add(res);
    this._ensureHeartbeat();
    return true;
  }

  _unregisterClient(res, targetSet) {
    if (!targetSet.delete(res)) return;
    const ip = this._clientIp.get(res);
    if (ip) {
      const next = (this._ipCounts.get(ip) || 1) - 1;
      if (next <= 0) this._ipCounts.delete(ip);
      else this._ipCounts.set(ip, next);
      this._clientIp.delete(res);
    }
    if (this._totalClients() === 0 && this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _writeToSet(clientSet, payload) {
    for (const res of clientSet) {
      if (res.writableEnded || res.destroyed || res.writableLength > MAX_CLIENT_BUFFER_BYTES) {
        this._unregisterClient(res, clientSet);
        try {
          res.end();
        } catch {
          // ignore
        }
        continue;
      }
      try {
        res.write(payload);
      } catch {
        this._unregisterClient(res, clientSet);
      }
    }
  }

  /**
   * Append a sanitized log line to the console ring buffer and broadcast over SSE.
   * @param {"info" | "warn" | "error" | "debug"} level
   * @param {string} scope
   * @param {string} message
   * @param {string[]} [secrets]
   * @param {{ skipRedact?: boolean }} [opts]
   */
  log(level, scope, message, secrets = [], opts = null) {
    const entry = {
      id: nanoid(10),
      timestamp: new Date().toISOString(),
      level: ["info", "warn", "error", "debug"].includes(level) ? level : "info",
      scope: String(scope || "router"),
      message: opts?.skipRedact
        ? String(message || "")
        : redactSecrets(String(message || ""), secrets)
    };
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_CONSOLE_LOGS) {
      this.consoleLogs.splice(0, this.consoleLogs.length - MAX_CONSOLE_LOGS);
    }

    if (this.consoleClients.size > 0) {
      const payload = `data: ${JSON.stringify(entry)}\n\n`;
      this._writeToSet(this.consoleClients, payload);
    }
    return entry;
  }

  getConsoleLogs(limit = 200) {
    const n = Math.max(1, Math.min(Number(limit) || 200, MAX_CONSOLE_LOGS));
    return this.consoleLogs.slice(-n);
  }

  clearConsoleLogs() {
    this.consoleLogs = [];
    if (this.consoleClients.size > 0) {
      const payload = `data: ${JSON.stringify({ type: "clear" })}\n\n`;
      this._writeToSet(this.consoleClients, payload);
    }
  }

  clearRecentRequests() {
    this.recentRequests = [];
    this.errorProvider = null;
    this._broadcastUsageSnapshot(true);
  }

  /**
   * Record that an upstream request has started on `providerSlug`.
   * @param {string} providerSlug
   * @param {{ model?: string } | null} [meta]
   */
  markRequestStart(providerSlug, meta = null) {
    if (!providerSlug) return;
    this.activeRequests.set(providerSlug, (this.activeRequests.get(providerSlug) || 0) + 1);
    const rawModel = typeof meta?.model === "string" ? meta.model.trim() : "";
    if (rawModel) {
      const cleanModel = rawModel.startsWith(`${providerSlug}/`)
        ? rawModel.slice(providerSlug.length + 1)
        : rawModel;
      const list = this.activeModels.get(providerSlug) || [];
      list.push(cleanModel);
      if (list.length > 16) list.splice(0, list.length - 16);
      this.activeModels.set(providerSlug, list);
    }
    this._broadcastUsageSnapshot();
  }

  /**
   * Record that an upstream request has ended on `providerSlug`.
   * @param {string} providerSlug
   * @param {{ model?: string, status?: number, promptTokens?: number, completionTokens?: number, cost?: number, latencyMs?: number, error?: string }} [summary]
   */
  markRequestEnd(providerSlug, summary = null) {
    if (providerSlug) {
      const current = this.activeRequests.get(providerSlug) || 0;
      if (current <= 1) {
        this.activeRequests.delete(providerSlug);
        this.activeModels.delete(providerSlug);
      } else {
        this.activeRequests.set(providerSlug, current - 1);
        const list = this.activeModels.get(providerSlug);
        if (list && list.length > 0) {
          const rawModel = String(summary?.model || summary?.resolvedModel || "").trim();
          const cleanModel = rawModel.startsWith(`${providerSlug}/`)
            ? rawModel.slice(providerSlug.length + 1)
            : rawModel;
          const idx = cleanModel ? list.indexOf(cleanModel) : -1;
          if (idx >= 0) list.splice(idx, 1);
          else list.shift();
          if (list.length === 0) this.activeModels.delete(providerSlug);
        }
      }
    }

    if (summary) {
      const ok = !summary.status || (summary.status >= 200 && summary.status < 400);
      const errSnippet = !ok
        ? redactSecrets(String(summary.error || `HTTP ${summary.status || 500}`)).slice(0, 140)
        : undefined;
      const entryId = summary.id || nanoid(10);
      const entry = {
        id: entryId,
        timestamp: summary.timestamp || new Date().toISOString(),
        provider: providerSlug || "unknown",
        model: summary.model || summary.resolvedModel || summary.requestedModel || "unknown",
        requestedModel: summary.requestedModel || summary.model || "",
        resolvedModel: summary.resolvedModel || summary.model || "",
        endpoint: summary.endpoint || "/v1/chat/completions",
        keyName: summary.keyName || "Anonymous",
        status: ok ? "ok" : "error",
        httpStatus: summary.status || 200,
        promptTokens: Number(summary.promptTokens) || 0,
        completionTokens: Number(summary.completionTokens) || 0,
        cachedTokens: Number(summary.cachedTokens) || 0,
        cost: Number(summary.cost) || 0,
        savedChars: Number(summary.savedChars) || 0,
        latencyMs: Number(summary.latencyMs) || 0,
        fallbackHops: Number(summary.fallbackHops) || 0,
        stream: Boolean(summary.stream),
        ...(errSnippet ? { error: errSnippet } : {})
      };
      const existingIdx = this.recentRequests.findIndex((item) => item.id === entryId);
      if (existingIdx !== -1) {
        this.recentRequests[existingIdx] = { ...this.recentRequests[existingIdx], ...entry };
      } else {
        this.recentRequests.unshift(entry);
      }
      if (this.recentRequests.length > MAX_RECENT_REQUESTS) {
        this.recentRequests.length = MAX_RECENT_REQUESTS;
      }

      if (!ok && providerSlug) {
        this.errorProvider = {
          provider: providerSlug,
          message: redactSecrets(summary.error || `HTTP ${summary.status}`),
          at: new Date().toISOString()
        };
      } else if (ok && this.errorProvider?.provider === providerSlug) {
        this.errorProvider = null;
      }
    }

    this._broadcastUsageSnapshot();
  }

  getUsageSnapshot(limit = 50) {
    const active = {};
    const activeModels = {};
    for (const [k, v] of this.activeRequests.entries()) {
      if (v > 0) {
        active[k] = v;
        const models = this.activeModels.get(k);
        if (models && models.length > 0) {
          activeModels[k] = [...new Set(models)];
        }
      }
    }
    const maxItems = Math.max(1, Math.min(Number(limit) || 50, MAX_RECENT_REQUESTS));
    return {
      activeRequests: active,
      activeModels,
      recentRequests: this.recentRequests.slice(0, maxItems),
      errorProvider: this.errorProvider,
      timestamp: new Date().toISOString()
    };
  }

  _broadcastUsageSnapshot(immediate = false) {
    if (this.usageClients.size === 0) return;
    if (immediate) {
      if (this._broadcastTimer) {
        clearTimeout(this._broadcastTimer);
        this._broadcastTimer = null;
      }
      const payload = `data: ${JSON.stringify(this.getUsageSnapshot())}\n\n`;
      this._writeToSet(this.usageClients, payload);
      return;
    }
    if (this._broadcastTimer) return;
    this._broadcastTimer = setTimeout(() => {
      this._broadcastTimer = null;
      if (this.usageClients.size === 0) return;
      const payload = `data: ${JSON.stringify(this.getUsageSnapshot())}\n\n`;
      this._writeToSet(this.usageClients, payload);
    }, USAGE_BROADCAST_COALESCE_MS);
    this._broadcastTimer.unref?.();
  }

  /**
   * Attach an Express SSE client for `/api/usage/stream`.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  attachUsageStream(req, res, initialSnapshot = null) {
    if (!this._registerClient(req, res, this.usageClients)) return;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.socket?.setTimeout?.(0);
    res.flushHeaders?.();

    const snap = initialSnapshot || this.getUsageSnapshot();
    res.write(`data: ${JSON.stringify(snap)}\n\n`);

    req.on("close", () => {
      this._unregisterClient(res, this.usageClients);
    });
  }

  /**
   * Attach an Express SSE client for `/api/console-logs/stream`.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  attachConsoleStream(req, res) {
    if (!this._registerClient(req, res, this.consoleClients)) return;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.socket?.setTimeout?.(0);
    res.flushHeaders?.();

    // Send initial buffered history
    res.write(`event: history\ndata: ${JSON.stringify(this.getConsoleLogs(200))}\n\n`);

    req.on("close", () => {
      this._unregisterClient(res, this.consoleClients);
    });
  }
}
