import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { createApp } from "../server/index.js";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(import.meta.dirname, "..");

function httpRawRequest({ port, method = "GET", reqPath = "/", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: reqPath,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // non-JSON response
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
        });
      }
    );
    req.on("error", reject);
    if (body !== null && body !== undefined) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe("001Router Local UI & CLI Parity", () => {
  let tmpDir;
  let server;
  let port;
  let baseUrl;
  let cookie = "";
  let cliToken = "test-cli-token-001router-parity";
  let mockTunnelUrl = "";

  const mockTunnelManager = {
    async getTunnelStatus(storage) {
      const s = storage.getSettings();
      return {
        enabled: Boolean(s.tunnelEnabled && mockTunnelUrl),
        settingsEnabled: Boolean(s.tunnelEnabled),
        tunnelUrl: s.tunnelEnabled ? mockTunnelUrl : "",
        publicUrl: s.tunnelEnabled ? mockTunnelUrl : "",
        running: Boolean(s.tunnelEnabled && mockTunnelUrl),
        installed: true,
      };
    },
    async enableTunnel(storage) {
      mockTunnelUrl = "https://demo-test.trycloudflare.com";
      await storage.updateSettings({ tunnelEnabled: true, tunnelUrl: mockTunnelUrl });
      return {
        success: true,
        tunnelUrl: mockTunnelUrl,
        publicUrl: mockTunnelUrl,
      };
    },
    async disableTunnel(storage) {
      mockTunnelUrl = "";
      await storage.updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
      return { success: true };
    },
    async getTailscaleStatus(storage) {
      const s = storage.getSettings();
      return {
        installed: false,
        loggedIn: false,
        running: false,
        enabled: false,
        settingsEnabled: Boolean(s.tailscaleEnabled),
        tunnelUrl: "",
      };
    },
    async enableTailscale() {
      return { success: false, error: "Tailscale CLI is not installed" };
    },
    async disableTailscale(storage) {
      await storage.updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
      return { success: true };
    },
  };

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-local-parity-"));
    const app = await createApp({
      dataDir: tmpDir,
      port: 20128,
      cliToken,
      allowProcessExit: false,
      tunnelManagerOverride: mockTunnelManager,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get("set-cookie") || "";
    cookie = setCookie.split(";")[0];
    assert.ok(cookie, "Session cookie must be issued after login");
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("blocks /api/tunnel/enable while default password 1234 is active, then succeeds after password change", async () => {
    const blockedRes = await fetch(`${baseUrl}/api/tunnel/enable`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(blockedRes.status, 400);

    const statusBefore = await fetch(`${baseUrl}/api/tunnel/status`, {
      headers: { cookie },
    }).then((r) => r.json());
    assert.equal(statusBefore.tunnel.enabled, false);
    assert.equal(statusBefore.tailscale.installed, false);

    // Change default password so tunnel security gate passes
    const pwdRes = await fetch(`${baseUrl}/api/settings/password`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: "1234",
        newPassword: "StrongLocalPassword!99",
      }),
    });
    assert.equal(pwdRes.status, 200);

    // Update cookie in case session rotated or remains valid
    const relogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "StrongLocalPassword!99" }),
    });
    assert.equal(relogin.status, 200);
    const rotated = relogin.headers.get("set-cookie") || "";
    if (rotated) cookie = rotated.split(";")[0];

    const enableRes = await fetch(`${baseUrl}/api/tunnel/enable`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(enableRes.status, 200);
    const enableJson = await enableRes.json();
    assert.equal(enableJson.tunnelUrl, "https://demo-test.trycloudflare.com");
  });

  it("isolates tunnel Host requests: 403 on dashboard until tunnelDashboardAccess=true, and enforces /v1 key even if requireKey=false", async () => {
    // By default tunnelDashboardAccess is false -> dashboard route on tunnel host returns 403
    const blockedDash = await httpRawRequest({
      port,
      method: "GET",
      reqPath: "/api/me",
      headers: { Host: "demo-test.trycloudflare.com" },
    });
    assert.equal(blockedDash.status, 403);

    // Disable requireKey locally, then verify /v1/models on tunnel host STILL returns 401 without Bearer key
    const reqKeyOff = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ requireKey: false, tunnelDashboardAccess: false }),
    });
    assert.equal(reqKeyOff.status, 200);

    const noKeyTunnelV1 = await httpRawRequest({
      port,
      method: "GET",
      reqPath: "/v1/models",
      headers: { Host: "demo-test.trycloudflare.com" },
    });
    assert.equal(noKeyTunnelV1.status, 401);

    // Create a router API key and verify /v1/models succeeds on tunnel host with Bearer token
    const createKeyRes = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Tunnel Parity Key" }),
    });
    assert.equal(createKeyRes.status, 201);
    const { key: createdKeyObj } = await createKeyRes.json();
    assert.ok(createdKeyObj?.key);

    const okTunnelV1 = await httpRawRequest({
      port,
      method: "GET",
      reqPath: "/v1/models",
      headers: {
        Host: "demo-test.trycloudflare.com",
        Authorization: `Bearer ${createdKeyObj.key}`,
      },
    });
    assert.equal(okTunnelV1.status, 200);

    // Enable tunnelDashboardAccess=true -> dashboard route on tunnel host now returns 200
    const allowDashRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ requireKey: true, tunnelDashboardAccess: true }),
    });
    assert.equal(allowDashRes.status, 200);

    const allowedDash = await httpRawRequest({
      port,
      method: "GET",
      reqPath: "/api/me",
      headers: { Host: "demo-test.trycloudflare.com", Cookie: cookie },
    });
    assert.equal(allowedDash.status, 200);

    const disableRes = await fetch(`${baseUrl}/api/tunnel/disable`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(disableRes.status, 200);
  });

  it("blocks metadata SSRF on /api/settings/proxy-test and enforces CLI token on /api/auth/reset-password", async () => {
    const ssrfProxyRes = await fetch(`${baseUrl}/api/settings/proxy-test`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ proxyUrl: "http://169.254.169.254:8080" }),
    });
    assert.equal(ssrfProxyRes.status, 400);

    const unauthReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.ok(unauthReset.status === 401 || unauthReset.status === 403);

    const cliReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-001R-CLI-Token": cliToken,
      },
    });
    assert.equal(cliReset.status, 200);
    const resetJson = await cliReset.json();
    assert.equal(resetJson.ok, true);

    // Confirm password was indeed reset back to "1234" and capture rotated session cookie
    const verifyLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" }),
    });
    assert.equal(verifyLogin.status, 200);
    const nextCookie = (verifyLogin.headers.get("set-cookie") || "").split(";")[0];
    if (nextCookie) cookie = nextCookie;
  });

  it("serves /api/version and handles /api/version/shutdown cleanly without exiting test process", async () => {
    const verRes = await fetch(`${baseUrl}/api/version`, { headers: { cookie } });
    assert.equal(verRes.status, 200);
    const verJson = await verRes.json();
    assert.equal(verJson.version, "2.0.0");

    const shutRes = await fetch(`${baseUrl}/api/version/shutdown`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(shutRes.status, 200);
    const shutJson = await shutRes.json();
    assert.equal(shutJson.success, true);
  });

  it("CLI entry supports --help, --version, and offline show --json", async () => {
    const { stdout: helpOut } = await execFileAsync(
      process.execPath,
      [path.join(APP_ROOT, "cli", "index.js"), "--help"],
      { windowsHide: true }
    );
    assert.match(helpOut, /001Router/);
    assert.match(helpOut, /--tray/);

    const { stdout: verOut } = await execFileAsync(
      process.execPath,
      [path.join(APP_ROOT, "cli", "index.js"), "--version"],
      { windowsHide: true }
    );
    assert.match(verOut, /2\.0\.0/);

    const { stdout: showOut } = await execFileAsync(
      process.execPath,
      [path.join(APP_ROOT, "cli", "index.js"), "show", "--json", "--port", "29999"],
      { windowsHide: true, env: { ...process.env, ROUTER001_DATA_DIR: tmpDir } }
    );
    const parsedShow = JSON.parse(showOut);
    assert.equal(parsedShow.version, "2.0.0");
    assert.equal(parsedShow.port, 29999);
  });
});
