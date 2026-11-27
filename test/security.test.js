import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, DEFAULT_HOST, assertSafeNetworkBind } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import {
  decryptSecret,
  encryptSecret,
  hashRouterKey,
  isEncrypted,
  loadOrCreateMasterKey
} from "../server/security/crypto.js";
import {
  redactSecrets,
  stripPrototypePollution,
  validateProviderBaseUrl
} from "../server/security/redact.js";
import { runSecurityScan } from "../server/security/scan.js";

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

describe("001Router Section 9.8 Security Hardening Test Suite", () => {
  let tmpDir;
  let mock;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let initialRouterKey;
  let prevMasterKey;

  before(async () => {
    prevMasterKey = process.env.ROUTER001_MASTER_KEY;
    delete process.env.ROUTER001_MASTER_KEY;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-security-test-"));
    mock = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mock) {
      await mock.close();
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    if (prevMasterKey === undefined) delete process.env.ROUTER001_MASTER_KEY;
    else process.env.ROUTER001_MASTER_KEY = prevMasterKey;
  });

  async function apiFetch(urlPath, opts = {}) {
    const headers = {
      "x-requested-with": "001router",
      ...(opts.headers || {})
    };
    if (sessionCookie && headers.cookie === undefined) {
      headers.cookie = sessionCookie;
    }
    if (opts.body && typeof opts.body !== "string") {
      headers["content-type"] = "application/json";
    }
    return fetch(`${baseUrl}${urlPath}`, {
      ...opts,
      headers,
      body:
        opts.body && typeof opts.body !== "string"
          ? JSON.stringify(opts.body)
          : opts.body
    });
  }

  it("1. verifies default bind host 127.0.0.1 and refuses non-loopback bind with default password", async () => {
    assert.equal(DEFAULT_HOST, "127.0.0.1");
    assert.equal(app.bindHost, "127.0.0.1");

    // Loopback hosts are permitted even with default password
    assert.doesNotThrow(() => assertSafeNetworkBind("127.0.0.1", app.storage));
    assert.doesNotThrow(() => assertSafeNetworkBind("localhost", app.storage));
    assert.doesNotThrow(() => assertSafeNetworkBind("::1", app.storage));

    // Non-loopback host must be refused while default password ("1234") is active
    assert.throws(
      () => assertSafeNetworkBind("0.0.0.0", app.storage),
      /Refusing to bind non-loopback host/
    );
    await assert.rejects(
      () => createApp({ dataDir: tmpDir, host: "0.0.0.0", enforceBindCheck: true }),
      /Refusing to bind non-loopback host/
    );
  });

  it("2. sets mandatory security headers on all responses and Cache-Control: no-store on /api/*", async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const csp = healthRes.headers.get("content-security-policy") || "";
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("img-src 'self' data:"));
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(csp.includes("connect-src 'self'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("base-uri 'none'"));
    assert.ok(csp.includes("form-action 'self'"));
    assert.equal(healthRes.headers.get("x-content-type-options"), "nosniff");
    assert.equal(healthRes.headers.get("x-frame-options"), "DENY");
    assert.equal(healthRes.headers.get("referrer-policy"), "no-referrer");
    assert.equal(healthRes.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.ok((healthRes.headers.get("permissions-policy") || "").includes("camera=()"));

    const apiRes = await fetch(`${baseUrl}/api/me`);
    assert.equal(apiRes.status, 401);
    assert.equal(apiRes.headers.get("cache-control"), "no-store");
    assert.equal(apiRes.headers.get("x-frame-options"), "DENY");
    assert.equal(apiRes.headers.get("x-content-type-options"), "nosniff");
  });

  it("3. enforces login lockout after 5 failed attempts and sets SameSite=Strict session cookie", async () => {
    // 5 failed login attempts from a specific IP
    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: `wrong-attempt-${i}` })
      });
      assert.equal(res.status, 401);
      if (i === 5) {
        const body = await res.json();
        assert.equal(body.locked, true);
        assert.ok(body.retryAfterSec >= 50);
      }
    }

    // 6th attempt must be locked out with HTTP 429 even if the password is correct
    const lockedRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(lockedRes.status, 429);
    assert.ok(Number(lockedRes.headers.get("retry-after")) > 0);
    const lockedBody = await lockedRes.json();
    assert.match(lockedBody.error, /Too many failed login attempts/i);

    // Spin up a fresh app instance (preserving first-boot in-memory initial key) to continue authenticated tests cleanly
    const savedInitial = app.storage.peekInitialRouterKey();
    await new Promise((resolve) => server.close(resolve));
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    app.storage._initialRouterKey = savedInitial;
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Login with default password "1234" and X-Forwarded-Proto: https to verify Secure + SameSite=Strict cookie
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get("set-cookie") || "";
    assert.match(setCookie, /r001_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    sessionCookie = extractCookie(loginRes);

    // GET /api/me reports defaultPassword: true
    const meRes = await apiFetch("/api/me");
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.deepEqual(meJson, { authenticated: true, defaultPassword: true });
  });

  it("4. enforces CORS lockdown and blocks cross-origin CSRF POST/PUT/DELETE on /api/* with 403", async () => {
    // Cross-origin state-changing POST to /api/providers with valid session cookie MUST be rejected with 403
    const evilOriginPost = await apiFetch("/api/providers", {
      method: "POST",
      headers: {
        origin: "https://evil.example"
      },
      body: {
        preset: "openai",
        name: "Evil Provider",
        baseUrl: "https://api.openai.com/v1",
        formatType: "openai",
        apiKeys: ["sk-evil-12345678"]
      }
    });
    assert.equal(evilOriginPost.status, 403);
    assert.equal(evilOriginPost.headers.get("access-control-allow-origin"), null);

    // Sec-Fetch-Site: cross-site without Origin header MUST also be rejected with 403
    const crossSitePost = await apiFetch("/api/keys", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site"
      },
      body: { name: "CSRF Key" }
    });
    assert.equal(crossSitePost.status, 403);

    // Cross-origin Referer without Origin MUST also be rejected with 403
    const evilRefererDelete = await apiFetch("/api/logs", {
      method: "DELETE",
      headers: {
        referer: "https://attacker.example/exploit.html"
      }
    });
    assert.equal(evilRefererDelete.status, 403);

    // Cross-origin OPTIONS preflight to /api/* is rejected with 403 and no Access-Control-Allow-Origin
    const evilOptions = await fetch(`${baseUrl}/api/providers`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST"
      }
    });
    assert.equal(evilOptions.status, 403);
    assert.equal(evilOptions.headers.get("access-control-allow-origin"), null);

    // Same-origin Origin with X-Requested-With: 001router succeeds
    const sameOriginDelete = await apiFetch("/api/logs", {
      method: "DELETE",
      headers: {
        origin: baseUrl,
        "x-requested-with": "001router"
      }
    });
    assert.equal(sameOriginDelete.status, 200);

    // /v1/* allows Access-Control-Allow-Origin: * WITHOUT Access-Control-Allow-Credentials
    const v1Preflight = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        origin: "https://some-ide-client.example"
      }
    });
    assert.equal(v1Preflight.status, 204);
    assert.equal(v1Preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(v1Preflight.headers.get("access-control-allow-credentials"), null);
  });

  it("5. stores router keys as SHA-256 hashes, reveals initial key once, and shows new key once on creation", async () => {
    // 1. One-time initial key reveal succeeds on first call
    const reveal1 = await apiFetch("/api/keys/reveal-initial");
    assert.equal(reveal1.status, 200);
    const reveal1Data = await reveal1.json();
    assert.equal(reveal1Data.ok, true);
    assert.equal(reveal1Data.revealed, true);
    assert.match(reveal1Data.key, /^sk-001r-/);
    initialRouterKey = reveal1Data.key;

    // 2. Second call to /api/keys/reveal-initial returns 404 (one-time only; deleted from memory)
    const reveal2 = await apiFetch("/api/keys/reveal-initial");
    assert.equal(reveal2.status, 404);
    const reveal2Data = await reveal2.json();
    assert.equal(reveal2Data.revealed, false);
    assert.equal(reveal2Data.key, null);

    // 3. Create a new router key: full plaintext key returned ONCE on POST /api/keys
    const createKeyRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "CLI Agent Key" }
    });
    assert.equal(createKeyRes.status, 201);
    const createdKeyObj = (await createKeyRes.json()).key;
    assert.match(createdKeyObj.key, /^sk-001r-/);
    const newPlainRouterKey = createdKeyObj.key;

    // 4. GET /api/keys returns metadata & keyPreview only — NEVER plaintext key or keyHash
    const listKeysRes = await apiFetch("/api/keys");
    assert.equal(listKeysRes.status, 200);
    const listKeysData = await listKeysRes.json();
    for (const k of listKeysData.keys) {
      assert.equal(k.key, undefined);
      assert.equal(k.keyHash, undefined);
      assert.equal(typeof k.keyPreview, "string");
      assert.ok(k.keyPreview.length > 0);
    }

    // 5. On-disk db.json stores SHA-256 keyHash and NEVER plaintext router keys
    const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.ok(!rawDbText.includes(initialRouterKey), "db.json must not contain initialRouterKey");
    assert.ok(!rawDbText.includes(newPlainRouterKey), "db.json must not contain newPlainRouterKey");
    const diskDb = JSON.parse(rawDbText);
    for (const k of diskDb.keys) {
      assert.equal(k.key, undefined);
      assert.match(k.keyHash, /^[0-9a-f]{64}$/);
    }
    assert.ok(diskDb.keys.some((k) => k.keyHash === hashRouterKey(newPlainRouterKey)));

    // 6. Created router key authenticates against /v1/models via SHA-256 hash comparison
    const v1Res = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${newPlainRouterKey}` }
    });
    assert.equal(v1Res.status, 200);
  });

  it("6. encrypts upstream provider API keys at rest in db.json as enc:v1:<iv>:<tag>:<ciphertext> (AES-256-GCM)", async () => {
    const plainApiKey1 = "sk-proj-" + "supersecret-openai-key-1234567890abcdef";
    const plainApiKey2 = "AI" + "zaSySuperSecretGeminiKey9876543210xyz";

    const createProv = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "Encrypted OpenAI",
        slug: "enc-openai",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: [
          { key: plainApiKey1, label: "Key1" },
          { key: plainApiKey2, label: "Key2" }
        ],
        models: ["gpt-4o"]
      }
    });
    assert.equal(createProv.status, 201);
    const createdBody = await createProv.json();
    assert.ok(!JSON.stringify(createdBody).includes(plainApiKey1));
    assert.ok(!JSON.stringify(createdBody).includes(plainApiKey2));

    // Verify .master.key exists in dataDir
    const masterKeyStat = await fs.stat(path.join(tmpDir, ".master.key"));
    assert.ok(masterKeyStat.isFile());
    assert.ok(masterKeyStat.size >= 32);

    // Read raw db.json from disk and verify zero plaintext keys and valid enc:v1:<iv>:<tag>:<ciphertext>
    const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.ok(!rawDbText.includes(plainApiKey1), "Plaintext key 1 leaked to db.json!");
    assert.ok(!rawDbText.includes(plainApiKey2), "Plaintext key 2 leaked to db.json!");

    const diskDb = JSON.parse(rawDbText);
    const diskProvider = diskDb.providers.find((p) => p.slug === "enc-openai");
    assert.ok(diskProvider);
    assert.equal(diskProvider.apiKeys.length, 2);

    const masterKey = await loadOrCreateMasterKey(tmpDir);
    for (const [idx, expectedPlain] of [plainApiKey1, plainApiKey2].entries()) {
      const diskCipher = diskProvider.apiKeys[idx].key;
      assert.ok(isEncrypted(diskCipher), `Expected enc:v1:... format, got ${diskCipher}`);
      const parts = diskCipher.split(":");
      assert.equal(parts.length, 5);
      assert.equal(parts[0], "enc");
      assert.equal(parts[1], "v1");
      assert.equal(decryptSecret(diskCipher, masterKey), expectedPlain);
    }

    // Verify router still decrypts and sends the real key to upstream when routing a request
    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initialRouterKey}`
      },
      body: JSON.stringify({
        model: "enc-openai/gpt-4o",
        messages: [{ role: "user", content: "hello encrypted world" }]
      })
    });
    assert.equal(chatRes.status, 200);
    assert.equal(mock.requests[0].headers.authorization, `Bearer ${plainApiKey1}`);
  });

  it("7. transparently migrates a legacy plaintext db.json on boot to encrypted keys and hashed router keys", async () => {
    const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-legacy-mig-"));
    try {
      const legacyProviderSecret = "sk-ant-legacy-plaintext-key-9988776655";
      const legacyRouterSecret = "sk-001r-legacy-router-plaintext-11223344";
      const legacyProxyUrl = "http://proxyuser:proxypass@198.51.100.10:8080";

      const legacyDb = {
        version: 1,
        providers: [
          {
            id: "leg-p1",
            slug: "legacy-anthropic",
            preset: "anthropic",
            name: "Legacy Anthropic",
            baseUrl: "https://api.anthropic.com",
            formatType: "anthropic",
            apiKeys: [
              {
                id: "leg-k1",
                label: "Legacy Key",
                key: legacyProviderSecret,
                enabled: true,
                cooldownUntil: null
              }
            ],
            models: ["claude-sonnet-4-20250514"],
            enabled: true
          }
        ],
        proxyPools: [
          {
            id: "leg-pool-1",
            name: "Legacy Proxy",
            type: "http",
            url: legacyProxyUrl,
            enabled: true
          }
        ],
        combos: [],
        quotas: {},
        keys: [
          {
            id: "leg-rk1",
            name: "Legacy Router Key",
            key: legacyRouterSecret,
            keyPreview: "sk-…3344",
            enabled: true,
            requestCount: 3,
            lastUsedAt: null,
            createdAt: new Date().toISOString()
          }
        ],
        logs: []
      };

      await fs.writeFile(
        path.join(legacyDir, "db.json"),
        JSON.stringify(legacyDb, null, 2),
        "utf8"
      );

      // Boot createApp on legacyDir -> triggers transparent migration
      const migratedApp = await createApp({ dataDir: legacyDir, port: 20130 });

      const diskTextAfterBoot = await fs.readFile(path.join(legacyDir, "db.json"), "utf8");
      assert.ok(
        !diskTextAfterBoot.includes(legacyProviderSecret),
        "Legacy provider secret must be encrypted on disk after boot"
      );
      assert.ok(
        !diskTextAfterBoot.includes(legacyRouterSecret),
        "Legacy router key must be hashed on disk after boot"
      );
      assert.ok(
        !diskTextAfterBoot.includes("proxypass"),
        "Legacy proxy URL must be encrypted on disk after boot"
      );

      const migratedDisk = JSON.parse(diskTextAfterBoot);
      assert.ok(isEncrypted(migratedDisk.providers[0].apiKeys[0].key));
      assert.ok(isEncrypted(migratedDisk.proxyPools[0].url));
      assert.equal(migratedDisk.keys[0].key, undefined);
      assert.equal(migratedDisk.keys[0].keyHash, hashRouterKey(legacyRouterSecret));

      // In-memory provider still has decrypted key ready for routing
      assert.equal(
        migratedApp.storage.getProviders()[0].apiKeys[0].key,
        legacyProviderSecret
      );
      // Migrated router key can still be revealed once via consumeInitialRouterKey
      const revealed = migratedApp.storage.consumeInitialRouterKey();
      assert.equal(revealed?.key, legacyRouterSecret);
    } finally {
      await fs.rm(legacyDir, { recursive: true, force: true });
    }
  });

  it("8. blocks SSRF targets (169.254.169.254, fd00:ec2::254, private LAN IPs) on provider create, update, and import", async () => {
    // Direct unit checks
    assert.equal(
      validateProviderBaseUrl("http://169.254.169.254/latest/meta-data", {
        preset: "custom",
        category: "custom",
        allowPrivateUpstreams: true
      }).valid,
      false
    );
    assert.equal(
      validateProviderBaseUrl("http://[fd00:ec2::254]/latest/meta-data", {
        preset: "local",
        category: "local",
        allowPrivateUpstreams: true
      }).valid,
      false
    );
    assert.equal(
      validateProviderBaseUrl("http://10.0.0.1/v1", {
        preset: "openai",
        category: "apikey"
      }).valid,
      false
    );
    assert.equal(
      validateProviderBaseUrl("http://192.168.1.50:11434/v1", {
        preset: "ollama",
        category: "local"
      }).valid,
      true
    );

    // 1. POST /api/providers with AWS/cloud metadata IP 169.254.169.254 -> 400
    const ssrfCreate = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Metadata SSRF",
        slug: "ssrf-meta",
        baseUrl: "http://169.254.169.254/latest/meta-data",
        formatType: "openai",
        apiKeys: ["sk-test-123456"]
      }
    });
    assert.equal(ssrfCreate.status, 400);
    const ssrfCreateErr = await ssrfCreate.json();
    assert.match(ssrfCreateErr.error, /SSRF guard/i);

    // 2. POST /api/providers with IPv6 metadata fd00:ec2::254 -> 400
    const ssrfIpv6 = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "IPv6 Metadata SSRF",
        slug: "ssrf-ipv6",
        baseUrl: "http://[fd00:ec2::254]/latest",
        formatType: "openai",
        apiKeys: []
      }
    });
    assert.equal(ssrfIpv6.status, 400);

    // 3. POST /api/providers with private RFC1918 IP on non-local/non-custom preset -> 400
    const ssrfPrivate = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "Private LAN OpenAI",
        slug: "private-lan-openai",
        baseUrl: "http://10.20.30.40/v1",
        formatType: "openai",
        apiKeys: ["sk-test-123456"]
      }
    });
    assert.equal(ssrfPrivate.status, 400);
    assert.match((await ssrfPrivate.json()).error, /SSRF guard/i);

    // 4. PUT /api/providers/:id updating baseUrl to 169.254.169.254 -> 400
    const existingProv = app.storage.getProviderBySlug("enc-openai");
    const ssrfUpdate = await apiFetch(`/api/providers/${existingProv.id}`, {
      method: "PUT",
      body: {
        baseUrl: "http://169.254.169.254/latest/meta-data"
      }
    });
    assert.equal(ssrfUpdate.status, 400);

    // 5. POST /api/import with SSRF baseUrl -> 400
    const ssrfImport = await apiFetch("/api/import", {
      method: "POST",
      body: {
        mode: "merge",
        providers: [
          {
            preset: "custom",
            name: "Imported SSRF",
            slug: "imported-ssrf",
            baseUrl: "http://169.254.169.254/latest/meta-data",
            formatType: "openai"
          }
        ]
      }
    });
    assert.equal(ssrfImport.status, 400);
  });

  it("9. supports export modes (redacted default, encrypted with passphrase, plain requiring X-Confirm-Password)", async () => {
    const knownKey = "sk-proj-supersecret-openai-key-1234567890abcdef";

    // 1. Default GET /api/export (?secrets=redacted) omits plaintext keys -> "***redacted***"
    const redactedRes = await apiFetch("/api/export");
    assert.equal(redactedRes.status, 200);
    const redactedText = await redactedRes.text();
    assert.ok(!redactedText.includes(knownKey), "Default export must not contain plaintext key");
    const redactedBundle = JSON.parse(redactedText);
    assert.equal(redactedBundle.secretsMode, "redacted");
    const exportedProv = redactedBundle.providers.find((p) => p.slug === "enc-openai");
    assert.equal(exportedProv.apiKeys[0].key, "***redacted***");

    // 2. GET /api/export?secrets=plain WITHOUT X-Confirm-Password -> 401
    const plainNoPw = await apiFetch("/api/export?secrets=plain");
    assert.equal(plainNoPw.status, 401);

    // 3. GET /api/export?secrets=plain with wrong X-Confirm-Password -> 401
    const plainBadPw = await apiFetch("/api/export?secrets=plain", {
      headers: { "x-confirm-password": "wrong-password" }
    });
    assert.equal(plainBadPw.status, 401);

    // 4. GET /api/export?secrets=plain with valid X-Confirm-Password -> 200 with plaintext key
    const plainOk = await apiFetch("/api/export?secrets=plain", {
      headers: { "x-confirm-password": "1234" }
    });
    assert.equal(plainOk.status, 200);
    const plainBundle = await plainOk.json();
    assert.equal(plainBundle.secretsMode, "plain");
    const plainProv = plainBundle.providers.find((p) => p.slug === "enc-openai");
    assert.equal(plainProv.apiKeys[0].key, knownKey);

    // 5. GET /api/export?secrets=encrypted without passphrase -> 400
    const encNoPass = await apiFetch("/api/export?secrets=encrypted");
    assert.equal(encNoPass.status, 400);

    // 6. GET /api/export?secrets=encrypted&passphrase=... -> encrypted AES-256-GCM scrypt bundle
    const passphrase = "correct-horse-battery-staple";
    const encRes = await apiFetch(
      `/api/export?secrets=encrypted&passphrase=${encodeURIComponent(passphrase)}`
    );
    assert.equal(encRes.status, 200);
    const encRawText = await encRes.text();
    assert.ok(!encRawText.includes(knownKey), "Encrypted bundle must not expose plaintext key");
    const encEnvelope = JSON.parse(encRawText);
    assert.equal(encEnvelope.encrypted, true);
    assert.equal(encEnvelope.kdf, "scrypt");
    assert.equal(encEnvelope.cipher, "aes-256-gcm");

    // 7. Import encrypted bundle with wrong passphrase fails with 400
    const badImportEnc = await apiFetch("/api/import", {
      method: "POST",
      body: { ...encEnvelope, passphrase: "wrong-passphrase" }
    });
    assert.equal(badImportEnc.status, 400);

    // 8. Import encrypted bundle with correct passphrase succeeds and restores keys
    const goodImportEnc = await apiFetch("/api/import", {
      method: "POST",
      body: { ...encEnvelope, passphrase, mode: "replace" }
    });
    assert.equal(goodImportEnc.status, 200);
    assert.equal(
      app.storage.getProviderBySlug("enc-openai").apiKeys[0].key,
      knownKey
    );
  });

  it("10. strips prototype-pollution keys (__proto__, constructor, prototype) on import and JSON bodies", async () => {
    // Unit check on stripPrototypePollution
    const rawMalicious = JSON.parse(
      '{"__proto__":{"pollutedUnit":true},"constructor":{"prototype":{"pollutedCtor":true}},"nested":{"__proto__":{"pollutedNested":true},"safe":42}}'
    );
    const cleaned = stripPrototypePollution(rawMalicious);
    assert.equal(({}).pollutedUnit, undefined);
    assert.equal(({}).pollutedCtor, undefined);
    assert.equal(({}).pollutedNested, undefined);
    assert.equal(cleaned.nested.safe, 42);
    assert.equal(Object.prototype.hasOwnProperty.call(cleaned, "__proto__"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleaned, "constructor"), false);

    // Live HTTP POST /api/import with raw JSON containing __proto__, constructor, prototype
    const maliciousImportJson =
      '{"mode":"merge","__proto__":{"isAdmin":true,"polluted":true},"constructor":{"prototype":{"polluted":true}},"combos":[{"name":"proto-safe-combo","targets":["enc-openai/gpt-4o"],"__proto__":{"pollutedCombo":true},"prototype":{"bad":1}}]}';

    const importRes = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
        "x-requested-with": "001router"
      },
      body: maliciousImportJson
    });
    assert.equal(importRes.status, 200);
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).isAdmin, undefined);
    assert.equal(({}).pollutedCombo, undefined);
  });

  it("11. strips sk-..., AIza..., gsk_..., xai-..., sk-ant-..., and Bearer ... from error messages and logs", async () => {
    const fakeOpenAi = "sk-proj-" + "1234567890abcdefgh";
    const fakeGemini = "AI" + "zaSyD-9876543210abcdef";
    const fakeGroq = "gsk_" + "groqsecret12345678";
    const fakeXai = "xai-" + "groksecret12345678";
    const fakeAnthropic = "sk-ant-" + "api03-claude987654321";
    const fakeLeakedSk = "sk-leaked-" + "unconfigured-key-1122334455";
    const fakeLeakedGem = "AI" + "zaSyLeakedGeminiKey11223344";

    const sampleError =
      `Upstream failed with keys ${fakeOpenAi}, ${fakeGemini}, ${fakeGroq}, ${fakeXai}, ${fakeAnthropic}, and Authorization: Bearer my_secret_bearer_token_999999`;

    const redacted = redactSecrets(sampleError);
    assert.ok(!redacted.includes(fakeOpenAi));
    assert.ok(!redacted.includes(fakeGemini));
    assert.ok(!redacted.includes(fakeGroq));
    assert.ok(!redacted.includes(fakeXai));
    assert.ok(!redacted.includes(fakeAnthropic));
    assert.ok(!redacted.includes("my_secret_bearer_token_999999"));

    // Verify end-to-end request log sanitization when upstream error leaks an unconfigured key + Bearer token
    mock.setHandler(({ res }) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message:
              `Upstream error: rejected key ${fakeLeakedSk} and ${fakeLeakedGem} and Bearer secret_jwt_token_abcdef123456`
          }
        })
      );
      return true;
    });

    await apiFetch("/api/logs", { method: "DELETE" });

    const failChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${initialRouterKey}`
      },
      body: JSON.stringify({
        model: "enc-openai/gpt-4o",
        messages: [{ role: "user", content: "secret prompt body that must not be logged" }]
      })
    });
    assert.equal(failChat.status, 500);
    const failBodyText = await failChat.text();
    assert.ok(!failBodyText.includes(fakeLeakedSk));
    assert.ok(!failBodyText.includes(fakeLeakedGem));
    assert.ok(!failBodyText.includes("secret_jwt_token_abcdef123456"));

    const logsRes = await apiFetch("/api/logs");
    const logsData = await logsRes.json();
    assert.equal(logsData.logs.length, 1);
    const logStr = JSON.stringify(logsData.logs[0]);
    assert.ok(!logStr.includes(fakeLeakedSk));
    assert.ok(!logStr.includes(fakeLeakedGem));
    assert.ok(!logStr.includes("secret_jwt_token_abcdef123456"));
    assert.ok(!logStr.includes("secret prompt body that must not be logged"));
    assert.equal(logsData.logs[0].messages, undefined);
    assert.equal(logsData.logs[0].prompt, undefined);
  });

  it("12. invalidates old sessions on password change, updates defaultPassword flag, and passes /api/security/status & scan", async () => {
    const oldSessionCookie = sessionCookie;

    // Change password from default "1234" to a strong custom password
    const pwRes = await apiFetch("/api/settings/password", {
      method: "POST",
      body: {
        currentPassword: "1234",
        newPassword: "StrongPassword!2026"
      }
    });
    assert.equal(pwRes.status, 200);
    const pwJson = await pwRes.json();
    assert.equal(pwJson.ok, true);
    assert.equal(pwJson.defaultPassword, false);

    const rotatedCookie = extractCookie(pwRes);
    assert.ok(rotatedCookie);
    assert.notEqual(rotatedCookie, oldSessionCookie);

    // Old session cookie before password change must now be rejected with 401 (sessionVersion bumped)
    const oldCookieCheck = await fetch(`${baseUrl}/api/providers`, {
      headers: { cookie: oldSessionCookie }
    });
    assert.equal(oldCookieCheck.status, 401);

    // Rotated session cookie works and /api/me now reports defaultPassword: false
    sessionCookie = rotatedCookie;
    const meRes = await apiFetch("/api/me");
    assert.equal(meRes.status, 200);
    assert.deepEqual(await meRes.json(), {
      authenticated: true,
      defaultPassword: false
    });

    // Non-loopback bind is now permitted since default password was changed
    assert.doesNotThrow(() => assertSafeNetworkBind("0.0.0.0", app.storage));

    // Verify GET /api/security/status and POST /api/security/scan
    const statusRes = await apiFetch("/api/security/status");
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.encryptionAtRest, true);
    assert.equal(statusData.routerKeysHashed, true);
    assert.equal(statusData.corsLocked, true);
    assert.equal(statusData.headers, true);
    assert.equal(statusData.defaultPassword, false);
    assert.equal(statusData.bindHost, "127.0.0.1");

    const scanRes = await apiFetch("/api/security/scan", {
      method: "POST",
      body: {}
    });
    assert.equal(scanRes.status, 200);
    const scanData = await scanRes.json();
    assert.equal(scanData.ok, true);
    assert.equal(scanData.encryptionAtRest, true);
    assert.equal(scanData.routerKeysHashed, true);
    assert.equal(scanData.noSecretsInLogs, true);
    assert.ok(Array.isArray(scanData.checks));
    // masterKeyLocation is advisory (WARN while the key file sits next to db.json); everything else must PASS
    assert.ok(
      scanData.checks.every((c) => c.status === "PASS" || c.id === "masterKeyLocation"),
      JSON.stringify(scanData.checks.filter((c) => c.status !== "PASS"))
    );
  });

  it("13. blocks simulated attacker probes (unauthenticated scraping, proxy/headroom/fetch SSRF, key enumeration, host header injection, cloud auth lock)", async () => {
    // 1. Unauthenticated scraping attempts across all sensitive endpoints must return 401
    for (const ep of [
      "/api/providers",
      "/api/keys",
      "/api/keys/reveal-initial",
      "/api/export",
      "/api/logs",
      "/api/console-logs",
      "/api/proxy-pools",
      "/api/settings",
      "/api/security/status"
    ]) {
      const r = await fetch(`${baseUrl}${ep}`);
      assert.equal(r.status, 401, `Unauthenticated ${ep} must be rejected with 401`);
    }

    // 2. Host Header Injection on public /api/skills must sanitize malicious Host headers
    const hostInjRes = await fetch(`${baseUrl}/api/skills/001router/SKILL.md`, {
      headers: { host: "attacker.example/..@127.0.0.1" }
    });
    assert.equal(hostInjRes.status, 200);
    const mdText = await hostInjRes.text();
    assert.ok(!mdText.includes("evil.example"), "Must reject invalid characters in Host header");

    // 3. SSRF blocking on Proxy Pools & Headroom URL & /v1/web/fetch
    const proxySsrf1 = await apiFetch("/api/proxy-pools", {
      method: "POST",
      body: { name: "Meta Probe", url: "http://169.254.169.254:80" }
    });
    assert.equal(proxySsrf1.status, 400);

    const proxySsrf2 = await apiFetch("/api/proxy-pools", {
      method: "POST",
      body: { name: "LAN Probe", url: "http://10.0.0.1:8080" }
    });
    assert.equal(proxySsrf2.status, 400);

    const hrSsrf1 = await apiFetch(
      "/api/headroom/status?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data")
    );
    assert.equal(hrSsrf1.status, 400);

    const hrSsrf2 = await apiFetch("/api/settings", {
      method: "PUT",
      body: { headroomUrl: "http://192.168.1.1:8787" }
    });
    assert.equal(hrSsrf2.status, 400);

    // 4. Restricted /v1 router key cannot enumerate disallowed models via /v1/models/info or /v1/api/tags or probe localhost via /v1/web/fetch
    const newKeyRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "Restricted Probe Key" }
    });
    assert.equal(newKeyRes.status, 201);
    const createdKey = (await newKeyRes.json()).key;
    const patchRes = await apiFetch(`/api/keys/${createdKey.id}`, {
      method: "PATCH",
      body: { access: { restricted: true, allow: ["enc-openai/allowed-only"] } }
    });
    assert.equal(patchRes.status, 200);

    const infoRes = await fetch(`${baseUrl}/v1/models/info`, {
      headers: { authorization: `Bearer ${createdKey.key}` }
    });
    assert.equal(infoRes.status, 200);
    const infoJson = await infoRes.json();
    assert.ok(
      infoJson.models.every((m) => m.id === "enc-openai/allowed-only"),
      "Restricted key must not see disallowed models in /v1/models/info"
    );

    const tagsRes = await fetch(`${baseUrl}/v1/api/tags`, {
      headers: { authorization: `Bearer ${createdKey.key}` }
    });
    assert.equal(tagsRes.status, 200);
    const tagsJson = await tagsRes.json();
    assert.ok(
      tagsJson.models.every((m) => m.name === "enc-openai/allowed-only"),
      "Restricted key must not see disallowed models in /v1/api/tags"
    );

    const fetchSsrfLoopback = await fetch(`${baseUrl}/v1/web/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${createdKey.key}`
      },
      body: JSON.stringify({ url: "http://127.0.0.1:20128/api/me" })
    });
    assert.equal(fetchSsrfLoopback.status, 400);

    const fetchSsrfLan = await fetch(`${baseUrl}/v1/web/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${createdKey.key}`
      },
      body: JSON.stringify({ url: "http://192.168.0.1/admin" })
    });
    assert.equal(fetchSsrfLan.status, 400);

    // 5. Public cloud deployments (Vercel) refuse disabling dashboard login or router API key enforcement
    const prevVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const disableLoginRes = await apiFetch("/api/settings", {
        method: "PUT",
        body: { requireLogin: false }
      });
      assert.equal(disableLoginRes.status, 400);

      const disableKeyRes = await apiFetch("/api/settings", {
        method: "PUT",
        body: { requireKey: false }
      });
      assert.equal(disableKeyRes.status, 400);
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
  });
});
describe("Router API key enforcement is fail-closed (a backup cannot open /v1)", () => {
  let tmpDir;
  let app;
  let server;
  let baseUrl;
  let cookie = "";
  let routerKey = "";

  const api = (urlPath, opts = {}) =>
    fetch(`${baseUrl}${urlPath}`, {
      method: opts.method || "GET",
      headers: {
        "x-requested-with": "001router",
        ...(cookie ? { cookie } : {}),
        ...(opts.body ? { "content-type": "application/json" } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  const v1 = (withKey) =>
    fetch(`${baseUrl}/v1/models`, {
      headers: withKey ? { authorization: `Bearer ${routerKey}` } : {}
    });

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-keyenforce-"));
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(login.status, 200);
    cookie = extractCookie(login);
    const created = await api("/api/keys", { method: "POST", body: { name: "enforce test" } });
    assert.equal(created.status, 201);
    routerKey = (await created.json()).key.key;
  });

  after(async () => {
    server?.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("a. settings without a requireKey field still require a key", async () => {
    await app.locals.storage.update((data) => {
      delete data.settings.requireKey;
    });
    assert.equal((await v1(false)).status, 401);
    assert.equal((await v1(true)).status, 200);
  });

  it("b. importing a backup with requireKey:false leaves the key required", async () => {
    const res = await api("/api/import", {
      method: "POST",
      body: { settings: { requireKey: false, requireLogin: false, timeoutMs: 4321 } }
    });
    assert.equal(res.status, 200, await res.text());
    assert.notEqual(app.locals.storage.getSettings().requireKey, false);
    assert.notEqual(app.locals.storage.getSettings().requireLogin, false);
    assert.equal((await v1(false)).status, 401);
  });

  it("c. a valid import still updates ordinary settings", async () => {
    assert.equal(app.locals.storage.getSettings().timeoutMs, 4321);
  });

  it("d. on a public deployment a stored requireKey:false is overridden", async () => {
    await app.locals.storage.update((data) => {
      data.settings.requireKey = false;
    });
    assert.equal((await v1(false)).status, 200, "a loopback install may make the key optional");

    const prevVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      assert.equal((await v1(false)).status, 401);
      assert.equal((await v1(true)).status, 200);
      const settings = await (await api("/api/settings")).json();
      assert.equal(settings.publicDeployment, true);
      assert.equal(settings.effective.requireKey, true);
      const scan = await runSecurityScan({ storage: app.locals.storage });
      const check = scan.checks.find((c) => c.id === "routerKeyEnforced");
      assert.equal(check.status, "PASS");
      assert.match(check.detail, /overrides a stored requireKey=false/);
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
  });
});
