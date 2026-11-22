import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, DEFAULT_HOST, assertSafeNetworkBind } from "../server/index.js";
import { createStorage } from "../server/storage.js";
import { isEncrypted } from "../server/security/crypto.js";
import { formatScanTable, runSecurityScan } from "../server/security/scan.js";

const APP_DATA_DIR = path.resolve(import.meta.dirname, "../data");

async function verifyLiveHttpControls() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-secscan-"));
  let server = null;
  try {
    const app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Verify Security Headers on /api/me
    const meRes = await fetch(`${baseUrl}/api/me`);
    const csp = meRes.headers.get("content-security-policy") || "";
    const xcto = meRes.headers.get("x-content-type-options") || "";
    const xfo = meRes.headers.get("x-frame-options") || "";
    const ref = meRes.headers.get("referrer-policy") || "";
    const coop = meRes.headers.get("cross-origin-opener-policy") || "";
    const perm = meRes.headers.get("permissions-policy") || "";
    const cc = meRes.headers.get("cache-control") || "";

    const headersOk =
      csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'") &&
      xcto === "nosniff" &&
      xfo === "DENY" &&
      ref === "no-referrer" &&
      coop === "same-origin" &&
      perm.includes("camera=()") &&
      cc === "no-store";

    // 2. Verify CORS & CSRF lockdown on /api/* and credential-less CORS on /v1/*
    const csrfRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example"
      },
      body: JSON.stringify({ password: "1234" })
    });
    const apiAllowOrigin = csrfRes.headers.get("access-control-allow-origin");

    const v1OptRes = await fetch(`${baseUrl}/v1/models`, {
      method: "OPTIONS",
      headers: { origin: "https://cli-client.example" }
    });
    const v1AllowOrigin = v1OptRes.headers.get("access-control-allow-origin");
    const v1AllowCreds = v1OptRes.headers.get("access-control-allow-credentials");

    const corsOk =
      csrfRes.status === 403 &&
      !apiAllowOrigin &&
      v1AllowOrigin === "*" &&
      !v1AllowCreds;

    // 3. Verify non-loopback bind refusal while default password is active
    let nonLoopbackRefused = false;
    try {
      assertSafeNetworkBind("0.0.0.0", app.storage);
    } catch {
      nonLoopbackRefused = true;
    }

    // 4. Verify encrypted provider key at rest in db.json
    const testSecret = "sk-scan-test-secret-9999abcd";
    await app.storage.update((data) => {
      data.providers.push({
        id: "scan-prov",
        slug: "scan-prov",
        preset: "openai",
        name: "Scan OpenAI",
        baseUrl: "https://api.openai.com/v1",
        formatType: "openai",
        apiKeys: [{ id: "k1", label: "main", key: testSecret, enabled: true }],
        models: ["gpt-4o"],
        enabled: true
      });
    });
    const rawDiskText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    const rawDiskJson = JSON.parse(rawDiskText);
    const diskKeyVal = rawDiskJson.providers?.[0]?.apiKeys?.[0]?.key || "";
    const diskEncryptedOk =
      !rawDiskText.includes(testSecret) && isEncrypted(diskKeyVal);

    return {
      headersOk,
      corsOk,
      bindDefaultOk: DEFAULT_HOST === "127.0.0.1" && nonLoopbackRefused,
      diskEncryptedOk
    };
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const storage = await createStorage({ dataDir: APP_DATA_DIR });
  const scanResult = await runSecurityScan({
    storage,
    dataDir: APP_DATA_DIR,
    bindHost: process.env.HOST || DEFAULT_HOST
  });

  const live = await verifyLiveHttpControls();

  for (const check of scanResult.checks) {
    if (check.id === "headers" && !live.headersOk) {
      check.status = "FAIL";
      check.detail = "Live HTTP response missing one or more required security headers";
      scanResult.ok = false;
    }
    if (check.id === "corsLocked" && !live.corsOk) {
      check.status = "FAIL";
      check.detail = "Live CORS/CSRF verification failed";
      scanResult.ok = false;
    }
    if (check.id === "bindAddress" && !live.bindDefaultOk) {
      check.status = "FAIL";
      check.detail = "Default bind host or non-loopback password guard check failed";
      scanResult.ok = false;
    }
    if (check.id === "encryptionAtRest" && !live.diskEncryptedOk) {
      check.status = "FAIL";
      check.detail = "Live AES-256-GCM encryption-at-rest verification failed";
      scanResult.ok = false;
    }
  }

  console.log(formatScanTable(scanResult));

  if (!scanResult.ok) {
    process.exitCode = 1;
  }
}

await main();
