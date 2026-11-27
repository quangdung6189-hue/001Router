import fs from "node:fs";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const TAILSCALE_UNIX_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/sbin/tailscale",
  "/usr/bin/tailscale",
  "/snap/bin/tailscale"
];

/** @type {Map<string, "cloudflare" | "tailscale">} */
const activeHosts = new Map();
let registeredRunner = null;

function normalizeHostname(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function registerActiveHost(urlStr, kind) {
  const host = normalizeHostname(urlStr);
  if (host) activeHosts.set(host, kind);
}

export function unregisterKindHosts(kind) {
  for (const [host, k] of activeHosts.entries()) {
    if (k === kind) activeHosts.delete(host);
  }
}

export function registerLocalTunnelRunner(runner) {
  registeredRunner = runner && typeof runner === "object" ? runner : null;
}

function syncHostsFromStorage(storage) {
  const s = storage?.getSettings?.() || {};
  if (s.tunnelEnabled && s.tunnelUrl) {
    registerActiveHost(s.tunnelUrl, "cloudflare");
  }
  if (s.tailscaleEnabled && s.tailscaleUrl) {
    registerActiveHost(s.tailscaleUrl, "tailscale");
  }
}

function getBinDir(storage) {
  return path.join(storage?.dataDir || path.resolve(import.meta.dirname, "../data"), "bin");
}

function findBinaryOnPathSync(binName) {
  const rawPath = process.env.PATH || "";
  if (!rawPath) return null;
  for (const dir of rawPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, binName);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore unreadable PATH directory
    }
  }
  return null;
}

/**
 * Check whether an incoming HTTP `Host` matches an active Cloudflare or Tailscale tunnel URL,
 * enforcing endpoint-only vs dashboard access policy.
 * @param {string} hostName
 * @param {import("express").Request} req
 * @param {import("./storage.js").Storage} storage
 * @returns {boolean | { allowed: false, status: number, message: string }}
 */
export function checkTunnelHostAccess(hostName, req, storage) {
  if (!hostName) return false;
  syncHostsFromStorage(storage);
  const normalized = String(hostName).trim().toLowerCase();
  const kind = activeHosts.get(normalized);
  if (!kind) return false;

  const s = storage?.getSettings?.() || {};
  if (kind === "cloudflare" && s.tunnelEnabled !== true) return false;
  if (kind === "tailscale" && s.tailscaleEnabled !== true) return false;

  req._isTunnelRequest = true;
  const reqPath = String(req.path || "/");
  const isApiEndpoint =
    reqPath === "/health" ||
    reqPath === "/v1" ||
    reqPath.startsWith("/v1/") ||
    reqPath === "/v1beta" ||
    reqPath.startsWith("/v1beta/") ||
    reqPath === "/api/skills" ||
    reqPath.startsWith("/api/skills/");
  if (isApiEndpoint) {
    return true;
  }

  const dashboardAllowed =
    s.tunnelDashboardAccess === true && !storage?.isDefaultPasswordSync?.();
  if (dashboardAllowed) {
    return true;
  }

  return {
    allowed: false,
    status: 403,
    message:
      "Dashboard access via tunnel is disabled. Enable 'Allow dashboard access via tunnel' after changing the default password."
  };
}

export function getDownloadStatus() {
  if (registeredRunner?.getDownloadStatus) {
    return registeredRunner.getDownloadStatus();
  }
  return { downloading: false, progress: 0 };
}

export async function resolveTailscaleBin(storage) {
  if (registeredRunner?.resolveTailscaleBin) {
    return registeredRunner.resolveTailscaleBin(storage);
  }
  const fromPath = findBinaryOnPathSync(IS_WINDOWS ? "tailscale.exe" : "tailscale");
  if (fromPath) return fromPath;
  const localBin = path.join(getBinDir(storage), IS_WINDOWS ? "tailscale.exe" : "tailscale");
  if (fs.existsSync(localBin)) return localBin;
  if (IS_WINDOWS) {
    const winDefault = "C:\\Program Files\\Tailscale\\tailscale.exe";
    return fs.existsSync(winDefault) ? winDefault : null;
  }
  return TAILSCALE_UNIX_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

export async function getTunnelStatus(storage) {
  if (registeredRunner?.getTunnelStatus) {
    return registeredRunner.getTunnelStatus(storage);
  }
  const s = storage?.getSettings?.() || {};
  const settingsEnabled = s.tunnelEnabled === true;
  const tunnelUrl = typeof s.tunnelUrl === "string" ? s.tunnelUrl : "";
  const localPath = path.join(getBinDir(storage), IS_WINDOWS ? "cloudflared.exe" : "cloudflared");
  const installed =
    fs.existsSync(localPath) ||
    Boolean(findBinaryOnPathSync(IS_WINDOWS ? "cloudflared.exe" : "cloudflared"));
  if (settingsEnabled && tunnelUrl) {
    registerActiveHost(tunnelUrl, "cloudflare");
  }
  return {
    enabled: settingsEnabled && Boolean(tunnelUrl),
    settingsEnabled,
    tunnelUrl,
    publicUrl: tunnelUrl,
    running: false,
    installed
  };
}

export async function enableTunnel(storage, port = 20128) {
  if (registeredRunner?.enableTunnel) {
    return registeredRunner.enableTunnel(storage, port);
  }
  throw new Error("Local tunnel process runner requires starting 001Router via 'start.bat' or 'npm run cli'");
}

export async function disableTunnel(storage) {
  if (registeredRunner?.disableTunnel) {
    return registeredRunner.disableTunnel(storage);
  }
  unregisterKindHosts("cloudflare");
  await storage.updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  return { success: true };
}

export async function getTailscaleStatus(storage) {
  if (registeredRunner?.getTailscaleStatus) {
    return registeredRunner.getTailscaleStatus(storage);
  }
  const s = storage?.getSettings?.() || {};
  const bin = await resolveTailscaleBin(storage);
  return {
    installed: Boolean(bin),
    loggedIn: false,
    running: false,
    enabled: false,
    settingsEnabled: s.tailscaleEnabled === true,
    tunnelUrl: ""
  };
}

export async function enableTailscale(storage, port = 20128) {
  if (registeredRunner?.enableTailscale) {
    return registeredRunner.enableTailscale(storage, port);
  }
  return {
    success: false,
    error: "Local Tailscale runner requires starting 001Router via 'start.bat' or 'npm run cli'."
  };
}

export async function disableTailscale(storage) {
  if (registeredRunner?.disableTailscale) {
    return registeredRunner.disableTailscale(storage);
  }
  unregisterKindHosts("tailscale");
  await storage.updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

export async function cleanupLocalTunnels() {
  if (registeredRunner?.cleanup) {
    await registeredRunner.cleanup().catch(() => {});
  }
  activeHosts.clear();
}
