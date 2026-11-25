/**
 * Real-time SSE event hub for:
 * 1) Live Usage & Provider Topology stream (`/api/usage/stream`)
 * 2) Live Server Console Log ring buffer & stream (`/api/console-logs`, `/api/console-logs/stream`)
 */

import { nanoid } from "nanoid";
import { redactSecrets } from "./security/redact.js";

const MAX_CONSOLE_LOGS = 500;
const MAX_RECENT_REQUESTS = 100;

export class LiveEventsHub {
  constructor() {
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
  }

  /**
   * Append a sanitized log line to the console ring buffer and broadcast over SSE.
   * @param {"info" | "warn" | "error" | "debug"} level
   * @param {string} scope
   * @param {string} message
   * @param {string[]} [secrets]
   */
  log(level, scope, message, secrets = []) {
    const entry = {
      id: nanoid(10),
      timestamp: new Date().toISOString(),
      level: ["info", "warn", "error", "debug"].includes(level) ? level : "info",
      scope: String(scope || "router"),
      message: redactSecrets(String(message || ""), secrets)
    };
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_CONSOLE_LOGS) {
      this.consoleLogs.splice(0, this.consoleLogs.length - MAX_CONSOLE_LOGS);
    }

    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.consoleClients) {
      if (res.writableEnded) {
        this.consoleClients.delete(res);
        continue;
      }
      try {
        res.write(payload);
      } catch {
        this.consoleClients.delete(res);
      }
    }
    return entry;
  }

  getConsoleLogs(limit = 200) {
    const n = Math.max(1, Math.min(Number(limit) || 200, MAX_CONSOLE_LOGS));
    return this.consoleLogs.slice(-n);
  }

  clearConsoleLogs() {
    this.consoleLogs = [];
  }

  clearRecentRequests() {
    this.recentRequests = [];
    this.errorProvider = null;
    this._broadcastUsageSnapshot();
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

  _broadcastUsageSnapshot() {
    if (this.usageClients.size === 0) return;
    const payload = `data: ${JSON.stringify(this.getUsageSnapshot())}\n\n`;
    for (const res of this.usageClients) {
      if (res.writableEnded) {
        this.usageClients.delete(res);
        continue;
      }
      try {
        res.write(payload);
      } catch {
        this.usageClients.delete(res);
      }
    }
  }

  /**
   * Attach an Express SSE client for `/api/usage/stream`.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  attachUsageStream(req, res, initialSnapshot = null) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    this.usageClients.add(res);
    const snap = initialSnapshot || this.getUsageSnapshot();
    res.write(`data: ${JSON.stringify(snap)}\n\n`);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        this.usageClients.delete(res);
        return;
      }
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
        this.usageClients.delete(res);
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.usageClients.delete(res);
    });
  }

  /**
   * Attach an Express SSE client for `/api/console-logs/stream`.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  attachConsoleStream(req, res) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    this.consoleClients.add(res);
    // Send initial buffered history
    res.write(`event: history\ndata: ${JSON.stringify(this.getConsoleLogs(200))}\n\n`);

    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        this.consoleClients.delete(res);
        return;
      }
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
        this.consoleClients.delete(res);
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.consoleClients.delete(res);
    });
  }
}
