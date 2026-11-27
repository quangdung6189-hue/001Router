import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../server/storage.js";

export function getCliTokenFilePath(dataDir = resolveDataDir()) {
  return path.join(dataDir, ".cli-token");
}

export function readCliToken(dataDir = resolveDataDir()) {
  const tokenPath = getCliTokenFilePath(dataDir);
  try {
    if (!fs.existsSync(tokenPath)) return "";
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

export class LocalCliClient {
  constructor({ port = 20128, dataDir = resolveDataDir() } = {}) {
    this.port = Number(port) || 20128;
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    this.dataDir = dataDir;
  }

  getHeaders(extra = {}) {
    const token = readCliToken(this.dataDir);
    return {
      "Content-Type": "application/json",
      ...(token ? { "X-001R-CLI-Token": token } : {}),
      ...extra,
    };
  }

  async request(method, apiPath, body) {
    const res = await fetch(`${this.baseUrl}${apiPath}`, {
      method,
      headers: this.getHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text };
      }
    }
    if (!res.ok) {
      const err = new Error(json?.error || json?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json;
  }

  async isHealthy() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getProviders() {
    return this.request("GET", "/api/providers");
  }

  testProvider(id) {
    return this.request("POST", `/api/providers/${encodeURIComponent(id)}/test`);
  }

  getKeys() {
    return this.request("GET", "/api/keys");
  }

  createKey(name) {
    return this.request("POST", "/api/keys", { name });
  }

  deleteKey(id) {
    return this.request("DELETE", `/api/keys/${encodeURIComponent(id)}`);
  }

  getCombos() {
    return this.request("GET", "/api/combos");
  }

  getCliToolStatuses() {
    return this.request("GET", "/api/cli-tools/statuses");
  }

  applyCliTool(toolId, payload) {
    return this.request("POST", `/api/cli-tools/${encodeURIComponent(toolId)}/apply`, payload);
  }

  resetCliTool(toolId) {
    return this.request("DELETE", `/api/cli-tools/${encodeURIComponent(toolId)}/reset`);
  }

  getTunnelStatus() {
    return this.request("GET", "/api/tunnel/status");
  }

  enableTunnel() {
    return this.request("POST", "/api/tunnel/enable");
  }

  disableTunnel() {
    return this.request("POST", "/api/tunnel/disable");
  }

  enableTailscale() {
    return this.request("POST", "/api/tunnel/tailscale-enable");
  }

  disableTailscale() {
    return this.request("POST", "/api/tunnel/tailscale-disable");
  }

  resetDashboardPassword() {
    return this.request("POST", "/api/auth/reset-password");
  }

  shutdown() {
    return this.request("POST", "/api/version/shutdown");
  }
}
