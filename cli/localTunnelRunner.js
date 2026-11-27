import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { registerActiveHost, unregisterKindHosts } from "../server/localTunnel.js";

const execFileAsync = promisify(execFile);

const IS_WINDOWS = process.platform === "win32";
const CLOUDFLARED_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";
const MIN_BINARY_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 3000;

const CLOUDFLARED_ASSETS = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-amd64.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

const TAILSCALE_UNIX_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/sbin/tailscale",
  "/usr/bin/tailscale",
  "/snap/bin/tailscale"
];

/**
 * Local CLI/desktop process runner for Cloudflare Quick Tunnel (`cloudflared`)
 * and Tailscale Funnel. Kept outside `server/` so the core HTTP gateway runtime
 * stays completely free of process-execution imports.
 */
export function createLocalTunnelRunner() {
  const state = {
    downloading: false,
    progress: 0,
    child: null
  };
  let downloadPromise = null;

  function getBinDir(storage) {
    return path.join(storage?.dataDir || path.resolve(import.meta.dirname, "../data"), "bin");
  }

  function getCloudflaredLocalPath(storage) {
    return path.join(getBinDir(storage), IS_WINDOWS ? "cloudflared.exe" : "cloudflared");
  }

  async function commandExistsOnPath(binName) {
    const probe = IS_WINDOWS ? "where" : "which";
    try {
      const { stdout } = await execFileAsync(probe, [binName], {
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS
      });
      const first = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      return first || null;
    } catch {
      return null;
    }
  }

  function isValidExecutableHeader(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < MIN_BINARY_BYTES) return false;
      const fd = fs.openSync(filePath, "r");
      try {
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        const magic = buf.toString("hex");
        if (IS_WINDOWS) return magic.startsWith("4d5a");
        if (process.platform === "darwin") {
          return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
        }
        return magic.startsWith("7f454c46");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  function downloadWithProgress(url, dest, depth = 0) {
    if (depth > 5) return Promise.reject(new Error("Too many redirects while downloading cloudflared"));
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadWithProgress(nextUrl, dest, depth + 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`cloudflared download failed (HTTP ${res.statusCode})`));
          return;
        }

        const file = fs.createWriteStream(dest);
        const total = parseInt(res.headers["content-length"] || "0", 10) || 0;
        let received = 0;
        state.downloading = true;
        state.progress = 0;

        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            state.progress = Math.min(99, Math.round((received / total) * 100));
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          state.downloading = false;
          state.progress = 100;
          file.close(() => resolve(dest));
        });
        file.on("error", (err) => {
          state.downloading = false;
          state.progress = 0;
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            // ignore
          }
          reject(err);
        });
      });

      req.on("error", (err) => {
        state.downloading = false;
        state.progress = 0;
        reject(err);
      });
    });
  }

  async function resolveOrInstallCloudflared(storage) {
    const fromPath = await commandExistsOnPath(IS_WINDOWS ? "cloudflared.exe" : "cloudflared");
    if (fromPath) return fromPath;

    const localPath = getCloudflaredLocalPath(storage);
    if (fs.existsSync(localPath) && isValidExecutableHeader(localPath)) {
      if (!IS_WINDOWS) fs.chmodSync(localPath, 0o755);
      return localPath;
    }

    if (downloadPromise) return downloadPromise;
    downloadPromise = (async () => {
      const platMap = CLOUDFLARED_ASSETS[process.platform];
      const asset = platMap?.[os.arch()] || platMap?.x64;
      if (!asset) {
        throw new Error(`Unsupported platform/arch for automatic cloudflared install: ${process.platform}/${os.arch()}`);
      }
      const binDir = getBinDir(storage);
      await fsp.mkdir(binDir, { recursive: true });
      const tmpDest = path.join(binDir, asset.endsWith(".tgz") ? "cloudflared.tgz.tmp" : "cloudflared.tmp");
      await downloadWithProgress(`${CLOUDFLARED_BASE_URL}/${asset}`, tmpDest);
      if (asset.endsWith(".tgz")) {
        await execFileAsync("tar", ["-xzf", tmpDest, "-C", binDir], { windowsHide: true });
        await fsp.unlink(tmpDest).catch(() => {});
      } else {
        await fsp.rename(tmpDest, localPath);
      }
      if (!isValidExecutableHeader(localPath)) {
        await fsp.unlink(localPath).catch(() => {});
        throw new Error("Downloaded cloudflared binary failed verification");
      }
      if (!IS_WINDOWS) fs.chmodSync(localPath, 0o755);
      return localPath;
    })().finally(() => {
      downloadPromise = null;
    });

    return downloadPromise;
  }

  function getDownloadStatus() {
    return {
      downloading: state.downloading,
      progress: state.progress
    };
  }

  async function resolveTailscaleBin(storage) {
    const fromPath = await commandExistsOnPath(IS_WINDOWS ? "tailscale.exe" : "tailscale");
    if (fromPath) return fromPath;

    const localBin = path.join(getBinDir(storage), IS_WINDOWS ? "tailscale.exe" : "tailscale");
    if (fs.existsSync(localBin)) return localBin;

    if (IS_WINDOWS) {
      const winDefault = "C:\\Program Files\\Tailscale\\tailscale.exe";
      if (fs.existsSync(winDefault)) return winDefault;
      return null;
    }
    return TAILSCALE_UNIX_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  }

  async function disableTunnelProcessOnly() {
    const child = state.child;
    state.child = null;
    if (!child || child.killed) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  async function getTunnelStatus(storage) {
    const s = storage?.getSettings?.() || {};
    const settingsEnabled = s.tunnelEnabled === true;
    const tunnelUrl = typeof s.tunnelUrl === "string" ? s.tunnelUrl : "";
    const running = Boolean(state.child && !state.child.killed && state.child.exitCode === null);
    const localExists = fs.existsSync(getCloudflaredLocalPath(storage));
    const installed = localExists || Boolean(await commandExistsOnPath(IS_WINDOWS ? "cloudflared.exe" : "cloudflared"));

    if (settingsEnabled && tunnelUrl) {
      registerActiveHost(tunnelUrl, "cloudflare");
    }

    return {
      enabled: settingsEnabled && (running || Boolean(tunnelUrl)),
      settingsEnabled,
      tunnelUrl,
      publicUrl: tunnelUrl,
      running,
      installed
    };
  }

  async function enableTunnel(storage, port = 20128) {
    if (state.child && !state.child.killed && state.child.exitCode === null) {
      const existingUrl = storage?.getSettings?.()?.tunnelUrl || "";
      if (existingUrl) {
        registerActiveHost(existingUrl, "cloudflare");
        return {
          success: true,
          tunnelUrl: existingUrl,
          publicUrl: existingUrl,
          alreadyRunning: true
        };
      }
    }

    await disableTunnelProcessOnly();
    const binPath = await resolveOrInstallCloudflared(storage);
    const localPort = Number(port) || 20128;

    const tunnelUrl = await new Promise((resolve, reject) => {
      const child = spawn(
        binPath,
        ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      state.child = child;
      let settled = false;
      let outputTail = "";

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Timed out waiting for Cloudflare Quick Tunnel URL"));
      }, 30_000);

      const onData = (chunk) => {
        outputTail = (outputTail + chunk.toString("utf8")).slice(-4096);
        const match = outputTail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
      child.once("exit", (code) => {
        state.child = null;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited unexpectedly (code ${code ?? "null"})`));
        }
      });
    });

    registerActiveHost(tunnelUrl, "cloudflare");
    await storage.updateSettings({ tunnelEnabled: true, tunnelUrl });

    return {
      success: true,
      tunnelUrl,
      publicUrl: tunnelUrl
    };
  }

  async function disableTunnel(storage) {
    await disableTunnelProcessOnly();
    unregisterKindHosts("cloudflare");
    await storage.updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
    return { success: true };
  }

  async function getTailscaleStatus(storage) {
    const s = storage?.getSettings?.() || {};
    const settingsEnabled = s.tailscaleEnabled === true;
    const savedUrl = typeof s.tailscaleUrl === "string" ? s.tailscaleUrl : "";
    const bin = await resolveTailscaleBin(storage);

    if (!bin) {
      return {
        installed: false,
        loggedIn: false,
        running: false,
        enabled: false,
        settingsEnabled,
        tunnelUrl: ""
      };
    }

    let loggedIn = false;
    let dnsHost = "";
    let running = false;

    try {
      const { stdout } = await execFileAsync(bin, ["status", "--json"], {
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS
      });
      const parsed = JSON.parse(stdout || "{}");
      loggedIn = parsed.BackendState === "Running" && parsed.Self?.Online === true;
      const rawDns = String(parsed.Self?.DNSName || "").replace(/\.$/, "");
      if (rawDns) dnsHost = rawDns;
    } catch {
      loggedIn = false;
    }

    if (loggedIn) {
      try {
        const { stdout } = await execFileAsync(bin, ["funnel", "status", "--json"], {
          windowsHide: true,
          timeout: PROBE_TIMEOUT_MS
        });
        const parsed = JSON.parse(stdout || "{}");
        running = Object.keys(parsed.AllowFunnel || {}).length > 0;
      } catch {
        running = false;
      }
    }

    const tunnelUrl = dnsHost && running ? `https://${dnsHost}` : running ? savedUrl : "";
    if (settingsEnabled && tunnelUrl) {
      registerActiveHost(tunnelUrl, "tailscale");
    }

    return {
      installed: true,
      loggedIn,
      running,
      enabled: settingsEnabled && running,
      settingsEnabled,
      tunnelUrl
    };
  }

  async function enableTailscale(storage, port = 20128) {
    const bin = await resolveTailscaleBin(storage);
    if (!bin) {
      return {
        success: false,
        error: "Tailscale CLI is not installed on this machine. Install Tailscale from https://tailscale.com/download first."
      };
    }

    const status = await getTailscaleStatus(storage);
    if (!status.loggedIn) {
      return {
        success: false,
        needsLogin: true,
        authUrl: "https://login.tailscale.com/",
        error: "Tailscale daemon is not logged in. Run `tailscale up` or sign in via Tailscale tray first."
      };
    }

    const localPort = Number(port) || 20128;
    try {
      await execFileAsync(bin, ["funnel", "--bg", String(localPort)], {
        windowsHide: true,
        timeout: 15_000
      });
    } catch (err) {
      const msg = String(err?.stderr || err?.message || "");
      const funnelMatch = msg.match(/https:\/\/login\.tailscale\.com\/f\/funnel[^\s]*/i);
      if (funnelMatch) {
        return {
          success: false,
          funnelNotEnabled: true,
          enableUrl: funnelMatch[0],
          error: "Enable Tailscale Funnel on your tailnet and retry."
        };
      }
      return {
        success: false,
        error: msg || "Failed to start Tailscale Funnel"
      };
    }

    const updated = await getTailscaleStatus(storage);
    if (!updated.tunnelUrl) {
      return {
        success: false,
        error: "Tailscale Funnel started, but MagicDNS hostname is unavailable."
      };
    }

    registerActiveHost(updated.tunnelUrl, "tailscale");
    await storage.updateSettings({
      tailscaleEnabled: true,
      tailscaleUrl: updated.tunnelUrl
    });

    return {
      success: true,
      tunnelUrl: updated.tunnelUrl
    };
  }

  async function disableTailscale(storage) {
    const bin = await resolveTailscaleBin(storage);
    if (bin) {
      try {
        await execFileAsync(bin, ["funnel", "--https=443", "off"], {
          windowsHide: true,
          timeout: 10_000
        });
      } catch {
        // best-effort cleanup
      }
    }
    unregisterKindHosts("tailscale");
    await storage.updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
    return { success: true };
  }

  async function cleanup() {
    await disableTunnelProcessOnly();
    unregisterKindHosts("cloudflare");
  }

  return {
    getDownloadStatus,
    resolveTailscaleBin,
    getTunnelStatus,
    enableTunnel,
    disableTunnel,
    getTailscaleStatus,
    enableTailscale,
    disableTailscale,
    cleanup
  };
}
