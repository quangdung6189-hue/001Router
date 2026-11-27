import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createStorage } from "../server/storage.js";
import { createMockUpstream } from "./mock-upstream.js";
import { decryptSecret, isEncrypted, loadOrCreateMasterKey } from "../server/security/crypto.js";
import { maskKey } from "../server/auth.js";
import { runSecurityScan } from "../server/security/scan.js";
import {
  buildVertexOpenAiBaseUrl,
  clearServiceAccountTokenCache,
  coerceFlexibleJsonInput,
  parseProviderCredentialJson,
  validateGoogleServiceAccountJson
} from "../server/serviceAccountAuth.js";
import { PRESETS } from "../server/presets.js";
import { clearOpenRouterPkceStore } from "../server/oauthPkce.js";

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

/**
 * Create a lightweight local HTTP server with a custom async handler for offline OAuth / token tests.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string) => void | Promise<void>} handler
 */
async function createLocalHttpMock(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        await handler(req, res, Buffer.concat(chunks).toString("utf8"));
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: err?.message || "Mock server error" }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

describe("001Router Official Provider Connection Modes (API Key, JSON/Vertex SA, OpenRouter OAuth PKCE)", () => {
  let tmpDir;
  let mockUpstream;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;

  before(async () => {
    clearServiceAccountTokenCache();
    clearOpenRouterPkceStore();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-connect-modes-"));
    mockUpstream = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Login with default password
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "001router"
      },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(loginRes.status, 200);
    sessionCookie = extractCookie(loginRes);

    // Reveal initial router key for /v1/* routing verification
    const revealRes = await apiFetch("/api/keys/reveal-initial");
    assert.equal(revealRes.status, 200);
    routerKey = (await revealRes.json()).key;
    assert.match(routerKey, /^sk-001r-/);
  });

  after(async () => {
    clearServiceAccountTokenCache();
    clearOpenRouterPkceStore();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mockUpstream) {
      await mockUpstream.close();
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
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

  it("1. connects Google Vertex AI Service Account JSON, encrypts at rest, mints & caches RS256 JWT Bearer token, and routes to mock upstream", async () => {
    // Generate ephemeral 2048-bit RSA keypair offline
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    const clientEmail = "vertex-router-bot@vertex-demo-proj.iam.gserviceaccount.com";
    const projectId = "vertex-demo-proj";
    const mintedToken = "ya29.mock-vertex-access-token-99887766aabbcc";

    // Unit-check buildVertexOpenAiBaseUrl for regional & global endpoints
    assert.equal(
      buildVertexOpenAiBaseUrl(projectId, "us-central1"),
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/endpoints/openapi`
    );
    assert.equal(
      buildVertexOpenAiBaseUrl(projectId, "global"),
      `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi`
    );

    const saPayload = {
      type: "service_account",
      project_id: projectId,
      private_key_id: "key-id-vertex-001",
      private_key: privateKey,
      client_email: clientEmail,
      client_id: "100000000000000000001",
      token_uri: "https://oauth2.googleapis.com/token"
    };

    // Unit-check SSRF guards on service account token_uri
    assert.throws(
      () =>
        validateGoogleServiceAccountJson({
          ...saPayload,
          token_uri: "http://169.254.169.254/latest/meta-data"
        }),
      /SSRF guard/i
    );
    assert.throws(
      () =>
        validateGoogleServiceAccountJson(
          {
            ...saPayload,
            token_uri: "http://169.254.169.254/latest/meta-data"
          },
          { allowLoopbackTokenUri: true }
        ),
      /SSRF guard/i
    );
    assert.throws(
      () =>
        validateGoogleServiceAccountJson({
          ...saPayload,
          token_uri: "http://127.0.0.1:9999/token"
        }),
      /https/i
    );
    assert.throws(
      () =>
        validateGoogleServiceAccountJson({
          ...saPayload,
          token_uri: "https://10.0.0.5/token"
        }),
      /SSRF guard/i
    );

    // Local mock OAuth2 token server verifying RS256 JWT assertion
    let tokenExchangeCount = 0;
    const mockTokenServer = await createLocalHttpMock((req, res, rawBody) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/token");
      assert.match(
        String(req.headers["content-type"] || ""),
        /application\/x-www-form-urlencoded/i
      );

      const params = new URLSearchParams(rawBody);
      assert.equal(
        params.get("grant_type"),
        "urn:ietf:params:oauth:grant-type:jwt-bearer"
      );
      const jwt = params.get("assertion") || "";
      const parts = jwt.split(".");
      assert.equal(parts.length, 3, "JWT assertion must have 3 dot-separated parts");

      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      assert.equal(header.alg, "RS256");
      assert.equal(header.typ, "JWT");
      assert.equal(header.kid, "key-id-vertex-001");
      assert.equal(claims.iss, clientEmail);
      assert.equal(claims.sub, clientEmail);
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
      assert.ok(claims.exp > claims.iat);

      // Cryptographically verify RS256 signature with public key
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(`${parts[0]}.${parts[1]}`);
      verifier.end();
      const sigOk = verifier.verify(publicKey, Buffer.from(parts[2], "base64url"));
      assert.equal(sigOk, true, "RS256 JWT signature must verify with RSA public key");

      tokenExchangeCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: mintedToken,
          token_type: "Bearer",
          expires_in: 3600
        })
      );
    });

    try {
      // Unauthenticated request to /api/providers/connect-json must be rejected (401)
      const unauthRes = await fetch(`${baseUrl}/api/providers/connect-json`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "001router"
        },
        body: JSON.stringify({ preset: "vertex", jsonText: JSON.stringify(saPayload) })
      });
      assert.equal(unauthRes.status, 401);

      // Cross-origin CSRF request must be blocked (403)
      const csrfRes = await apiFetch("/api/providers/connect-json", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: { preset: "vertex", jsonText: JSON.stringify(saPayload) }
      });
      assert.equal(csrfRes.status, 403);

      // Authenticated Vertex Service Account JSON upload
      const connectRes = await apiFetch("/api/providers/connect-json", {
        method: "POST",
        body: {
          preset: "vertex",
          location: "us-central1",
          jsonText: JSON.stringify(saPayload)
        }
      });
      assert.equal(connectRes.status, 200);
      const connectBody = await connectRes.json();
      assert.equal(connectBody.ok, true);
      assert.equal(connectBody.mode, "service_account");
      assert.equal(connectBody.provider.preset, "vertex");
      assert.equal(
        connectBody.provider.baseUrl,
        `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/endpoints/openapi`
      );

      const pubKeyEntry = connectBody.provider.apiKeys[0];
      assert.equal(pubKeyEntry.authMethod, "service_account");
      assert.equal(pubKeyEntry.serviceAccountJson, undefined);
      assert.equal(pubKeyEntry.key, undefined);
      assert.deepEqual(pubKeyEntry.serviceAccountMeta, {
        clientEmail,
        projectId,
        location: "us-central1",
        tokenUri: "https://oauth2.googleapis.com/token"
      });
      assert.ok(!JSON.stringify(connectBody).includes("PRIVATE KEY"));

      // Verify GET /api/providers hides serviceAccountJson and exposes authMethod + serviceAccountMeta
      const listRes = await apiFetch("/api/providers");
      assert.equal(listRes.status, 200);
      const listText = await listRes.text();
      assert.ok(!listText.includes("PRIVATE KEY"));
      assert.ok(!listText.includes("serviceAccountJson"));
      const listData = JSON.parse(listText);
      const listedVertex = listData.providers.find((p) => p.id === connectBody.provider.id);
      assert.ok(listedVertex);
      assert.equal(listedVertex.apiKeys[0].authMethod, "service_account");
      assert.equal(listedVertex.apiKeys[0].serviceAccountMeta.projectId, projectId);
      assert.equal(listedVertex.apiKeys[0].serviceAccountMeta.clientEmail, clientEmail);

      // Verify db.json on disk contains enc:v1: and ZERO PRIVATE KEY / raw client_email key leak
      const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
      assert.ok(rawDbText.includes("enc:v1:"), "db.json must store encrypted enc:v1: ciphertext");
      assert.ok(!rawDbText.includes("PRIVATE KEY"), "db.json must NEVER contain plaintext PRIVATE KEY");
      assert.ok(!rawDbText.includes('"client_email"'), "db.json must NEVER contain unencrypted SA client_email JSON field");
      assert.ok(!rawDbText.includes(privateKey.slice(40, 80)), "db.json must NEVER contain private key body");

      const diskDb = JSON.parse(rawDbText);
      const diskVertex = diskDb.providers.find((p) => p.id === connectBody.provider.id);
      const diskSaCipher = diskVertex.apiKeys[0].serviceAccountJson;
      assert.ok(isEncrypted(diskSaCipher), "serviceAccountJson on disk must be enc:v1: encrypted");
      const masterKey = await loadOrCreateMasterKey(tmpDir);
      const decryptedSa = JSON.parse(decryptSecret(diskSaCipher, masterKey));
      assert.equal(decryptedSa.client_email, clientEmail);
      assert.equal(decryptedSa.private_key, privateKey.trim());

      // Verify fresh Storage boot decrypts serviceAccountJson transparently
      const reloadedStorage = await createStorage({ dataDir: tmpDir });
      const reloadedVertex = reloadedStorage.getProviderById(connectBody.provider.id);
      assert.equal(reloadedVertex.apiKeys[0].authMethod, "service_account");
      assert.equal(
        JSON.parse(reloadedVertex.apiKeys[0].serviceAccountJson).project_id,
        projectId
      );

      // Verify security scan PASSES on encrypted service account storage
      const scanRes = await apiFetch("/api/security/scan", { method: "POST", body: {} });
      assert.equal(scanRes.status, 200);
      const scanData = await scanRes.json();
      assert.equal(scanData.ok, true);
      assert.equal(scanData.encryptionAtRest, true);

      // Update Vertex provider baseUrl to local mock OpenAI-compatible upstream via PUT
      // and verify PUT preserves serviceAccountJson, authMethod, and serviceAccountMeta!
      const putRes = await apiFetch(`/api/providers/${connectBody.provider.id}`, {
        method: "PUT",
        body: {
          baseUrl: `${mockUpstream.baseUrl}/v1`,
          apiKeys: [
            {
              id: pubKeyEntry.id,
              label: "Vertex Primary SA",
              key: pubKeyEntry.maskedKey,
              enabled: true
            }
          ]
        }
      });
      assert.equal(putRes.status, 200);
      const putData = await putRes.json();
      assert.equal(putData.provider.apiKeys[0].authMethod, "service_account");
      assert.equal(putData.provider.apiKeys[0].label, "Vertex Primary SA");
      assert.equal(putData.provider.apiKeys[0].serviceAccountMeta.projectId, projectId);

      // Point token exchange override to our local mock OAuth2 token server (100% offline)
      app.locals.serviceAccountTokenUri = `${mockTokenServer.baseUrl}/token`;

      // Route /v1/chat/completions through RouterService -> verifies RS256 JWT exchange + Bearer header
      mockUpstream.reset();
      const chatRes1 = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${routerKey}`
        },
        body: JSON.stringify({
          model: `${connectBody.provider.slug}/gemini-2.5-pro`,
          messages: [{ role: "user", content: "Hello Vertex AI" }]
        })
      });
      assert.equal(chatRes1.status, 200);
      const chatJson1 = await chatRes1.json();
      assert.equal(chatJson1.choices[0].message.content, "Mock OpenAI reply");
      assert.equal(tokenExchangeCount, 1);
      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(
        mockUpstream.requests[0].headers.authorization,
        `Bearer ${mintedToken}`
      );

      // Second request reuses cached Bearer token (no extra token exchange!)
      const chatRes2 = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${routerKey}`
        },
        body: JSON.stringify({
          model: `${connectBody.provider.slug}/gemini-2.5-flash`,
          messages: [{ role: "user", content: "Cached token check" }]
        })
      });
      assert.equal(chatRes2.status, 200);
      assert.equal(tokenExchangeCount, 1, "Service account access token must be cached in memory");
      assert.equal(
        mockUpstream.requests[1].headers.authorization,
        `Bearer ${mintedToken}`
      );

      // Connection test and live model fetch also resolve the Vertex Bearer token
      const testConnRes = await apiFetch(`/api/providers/${connectBody.provider.id}/test`, {
        method: "POST",
        body: {}
      });
      assert.equal(testConnRes.status, 200);
      const testConnData = await testConnRes.json();
      assert.equal(testConnData.ok, true);
      assert.equal(
        mockUpstream.requests[mockUpstream.requests.length - 1].headers.authorization,
        `Bearer ${mintedToken}`
      );

      const modelsRes = await apiFetch(`/api/providers/${connectBody.provider.id}/models`, {
        method: "POST",
        body: {}
      });
      assert.equal(modelsRes.status, 200);
      const modelsData = await modelsRes.json();
      assert.equal(modelsData.ok, true);
      assert.ok(modelsData.live.includes("gpt-4o"));

      // Verify security scanner FAILS if an unencrypted serviceAccountJson / PRIVATE KEY exists in a raw db.json
      const badScanDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-bad-sa-scan-"));
      try {
        await fs.writeFile(path.join(badScanDir, ".master.key"), "a".repeat(64), "utf8");
        await fs.writeFile(
          path.join(badScanDir, "db.json"),
          JSON.stringify({
            providers: [
              {
                id: "bad-p",
                apiKeys: [
                  {
                    id: "bad-k",
                    key: "",
                    authMethod: "service_account",
                    serviceAccountJson: JSON.stringify(saPayload)
                  }
                ]
              }
            ],
            keys: [],
            proxyPools: [],
            logs: []
          }),
          "utf8"
        );
        const badScan = await runSecurityScan({ dataDir: badScanDir });
        assert.equal(badScan.encryptionAtRest, false);
        assert.equal(badScan.ok, false);
      } finally {
        await fs.rm(badScanDir, { recursive: true, force: true });
      }
    } finally {
      delete app.locals.serviceAccountTokenUri;
      await mockTokenServer.close();
    }
  });

  it("2. imports Generic Provider Config JSON, strips prototype pollution, encrypts key at rest, and rejects invalid/SSRF configs", async () => {
    const importedSecret = "sk-json-config-secret-11223344aabbccdd";
    const maliciousJsonText = JSON.stringify({
      apiKey: importedSecret,
      baseUrl: `${mockUpstream.baseUrl}/v1`,
      models: ["gpt-4o", "custom-json-model"],
      name: "JSON Config OpenAI",
      slug: "json-config-openai"
    }).replace(
      "{",
      '{"__proto__":{"pollutedJsonConnect":true},"constructor":{"prototype":{"pollutedJsonCtor":true}},'
    );

    const connectRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "custom",
        jsonText: maliciousJsonText
      }
    });
    assert.equal(connectRes.status, 200);
    const body = await connectRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.mode, "config_json");
    assert.equal(body.provider.slug, "json-config-openai");
    assert.equal(body.provider.name, "JSON Config OpenAI");
    assert.equal(body.provider.baseUrl, `${mockUpstream.baseUrl}/v1`);
    assert.deepEqual(body.provider.models, ["gpt-4o", "custom-json-model"]);
    assert.equal(body.provider.apiKeys.length, 1);
    assert.equal(body.provider.apiKeys[0].authMethod, "api_key");
    assert.equal(body.provider.apiKeys[0].maskedKey, maskKey(importedSecret));
    assert.equal(body.provider.apiKeys[0].key, undefined);
    assert.ok(!JSON.stringify(body).includes(importedSecret));

    // Prototype pollution must NOT occur
    assert.equal(({}).pollutedJsonConnect, undefined);
    assert.equal(({}).pollutedJsonCtor, undefined);

    // Verify encrypted at rest in db.json
    const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.ok(!rawDbText.includes(importedSecret), "Imported JSON API key must not appear in plaintext in db.json");
    const diskDb = JSON.parse(rawDbText);
    const diskProv = diskDb.providers.find((p) => p.slug === "json-config-openai");
    assert.ok(isEncrypted(diskProv.apiKeys[0].key));

    // Route through the imported JSON provider
    mockUpstream.reset();
    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "json-config-openai/custom-json-model",
        messages: [{ role: "user", content: "Hello JSON config" }]
      })
    });
    assert.equal(chatRes.status, 200);
    assert.equal(
      mockUpstream.requests[0].headers.authorization,
      `Bearer ${importedSecret}`
    );

    // Reject unusable JSON without service_account or key/baseUrl
    const emptyCfgRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: { preset: "custom", jsonText: JSON.stringify({ hello: "world" }) }
    });
    assert.equal(emptyCfgRes.status, 400);

    // Reject malformed JSON syntax
    const badSyntaxRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: { preset: "custom", jsonText: "{not valid json" }
    });
    assert.equal(badSyntaxRes.status, 400);

    // Reject SSRF metadata baseUrl in JSON config
    const ssrfRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "custom",
        jsonText: JSON.stringify({
          apiKey: "sk-ssrf-test-12345678",
          baseUrl: "http://169.254.169.254/latest/meta-data"
        })
      }
    });
    assert.equal(ssrfRes.status, 400);
    assert.match((await ssrfRes.json()).error, /SSRF guard/i);
  });

  it("3. completes OpenRouter Official OAuth PKCE (S256) flow, rejects invalid/replayed state, encrypts key, and sets authMethod: oauth_pkce", async () => {
    const mintedOrKey = "sk-or-v1-pkce-official-minted-key-9876543210abcd";
    let expectedChallenge = "";
    let exchangeHits = 0;

    const mockOpenRouter = await createLocalHttpMock((req, res, rawBody) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/api/v1/auth/keys");
      const payload = JSON.parse(rawBody);
      assert.equal(payload.code, "or_pkce_auth_code_xyz");
      assert.equal(payload.code_challenge_method, "S256");
      assert.equal(typeof payload.code_verifier, "string");
      assert.ok(payload.code_verifier.length >= 43);

      // Verify S256 PKCE challenge === base64url(SHA-256(code_verifier))
      const computedChallenge = crypto
        .createHash("sha256")
        .update(payload.code_verifier, "ascii")
        .digest("base64url");
      assert.equal(
        computedChallenge,
        expectedChallenge,
        "S256 code_challenge in authUrl must match SHA-256(code_verifier)"
      );

      exchangeHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ key: mintedOrKey }));
    });

    app.locals.oauthExchangeUrl = `${mockOpenRouter.baseUrl}/api/v1/auth/keys`;

    try {
      // Reject non-loopback / cross-origin callbackUrl with 400
      const badCbRes = await apiFetch("/api/providers/oauth/openrouter/start", {
        method: "POST",
        body: { callbackUrl: "https://evil.example/steal" }
      });
      assert.equal(badCbRes.status, 400);

      // Start official OpenRouter PKCE flow with loopback callbackUrl (preserving query params)
      const startRes = await apiFetch("/api/providers/oauth/openrouter/start", {
        method: "POST",
        body: { callbackUrl: "http://127.0.0.1:20128/providers?tab=oauth" }
      });
      assert.equal(startRes.status, 200);
      const startData = await startRes.json();
      assert.equal(startData.ok, true);
      assert.equal(startData.expiresInSec, 600);
      assert.match(startData.state, /^[0-9a-f]{48}$/);

      const authUrl = new URL(startData.authUrl);
      assert.equal(authUrl.origin, "https://openrouter.ai");
      assert.equal(authUrl.pathname, "/auth");
      assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
      expectedChallenge = authUrl.searchParams.get("code_challenge") || "";
      assert.ok(expectedChallenge.length >= 43);

      const callbackParam = new URL(authUrl.searchParams.get("callback_url") || "");
      assert.equal(callbackParam.searchParams.get("tab"), "oauth");
      assert.equal(callbackParam.searchParams.get("oauth"), "openrouter");
      assert.equal(callbackParam.searchParams.get("state"), startData.state);

      // Reject exchange with invalid state (400)
      const invalidStateRes = await apiFetch("/api/providers/oauth/openrouter/exchange", {
        method: "POST",
        body: { code: "or_pkce_auth_code_xyz", state: "nonexistent-state-1234" }
      });
      assert.equal(invalidStateRes.status, 400);
      assert.equal(exchangeHits, 0);

      // Exchange with valid code + state succeeds
      const exchangeRes = await apiFetch("/api/providers/oauth/openrouter/exchange", {
        method: "POST",
        body: { code: "or_pkce_auth_code_xyz", state: startData.state }
      });
      assert.equal(exchangeRes.status, 200);
      const exchangeData = await exchangeRes.json();
      assert.equal(exchangeData.ok, true);
      assert.equal(exchangeHits, 1);
      assert.equal(exchangeData.provider.preset, "openrouter");
      assert.equal(exchangeData.provider.slug, "openrouter");
      assert.equal(exchangeData.provider.apiKeys.length, 1);
      assert.equal(exchangeData.provider.apiKeys[0].authMethod, "oauth_pkce");
      assert.equal(exchangeData.provider.apiKeys[0].label, "OpenRouter OAuth PKCE");
      assert.equal(exchangeData.provider.apiKeys[0].maskedKey, maskKey(mintedOrKey));
      assert.equal(exchangeData.provider.apiKeys[0].key, undefined);
      assert.ok(!JSON.stringify(exchangeData).includes(mintedOrKey));

      // Replay attack using the same state MUST be rejected with 400
      const replayRes = await apiFetch("/api/providers/oauth/openrouter/exchange", {
        method: "POST",
        body: { code: "or_pkce_auth_code_xyz", state: startData.state }
      });
      assert.equal(replayRes.status, 400);
      assert.equal(exchangeHits, 1, "Replayed state must not hit exchange endpoint");

      // Verify GET /api/providers masks the minted key and preserves authMethod: oauth_pkce
      const listRes = await apiFetch("/api/providers");
      assert.equal(listRes.status, 200);
      const listText = await listRes.text();
      assert.ok(!listText.includes(mintedOrKey));
      const orProv = JSON.parse(listText).providers.find((p) => p.preset === "openrouter");
      assert.ok(orProv);
      assert.equal(orProv.apiKeys[0].authMethod, "oauth_pkce");
      assert.equal(orProv.apiKeys[0].maskedKey, maskKey(mintedOrKey));

      // Verify db.json on disk encrypts the minted sk-or-v1-... key as enc:v1:...
      const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
      assert.ok(!rawDbText.includes(mintedOrKey), "Minted OpenRouter key must be encrypted in db.json");
      const diskDb = JSON.parse(rawDbText);
      const diskOr = diskDb.providers.find((p) => p.preset === "openrouter");
      assert.ok(isEncrypted(diskOr.apiKeys[0].key));
      const masterKey = await loadOrCreateMasterKey(tmpDir);
      assert.equal(decryptSecret(diskOr.apiKeys[0].key, masterKey), mintedOrKey);

      // Final full security scan check passes 100%
      const finalScan = await apiFetch("/api/security/scan", { method: "POST", body: {} });
      assert.equal(finalScan.status, 200);
      const finalScanData = await finalScan.json();
      assert.equal(finalScanData.ok, true);
      assert.equal(finalScanData.encryptionAtRest, true);
    } finally {
      delete app.locals.oauthExchangeUrl;
      await mockOpenRouter.close();
    }
  });

  it("4. Full-Catalog All-AI-Providers JSON Sweep Test across all 56+ presets, JSONC/markdown fences/.env/nested tool configs, Google ADC authorized_user, and Google OAuth client_secret.json", async () => {
    const nonCustomPresets = PRESETS.filter(
      (p) =>
        p.preset !== "custom" &&
        p.preset !== "custom-openai" &&
        p.preset !== "custom-anthropic"
    );
    assert.ok(
      nonCustomPresets.length >= 56,
      `Expected at least 56 non-custom presets in catalog, found ${nonCustomPresets.length}`
    );

    // 1. Connect EVERY non-custom preset in PRESETS via POST /api/providers/connect-json
    for (const presetDef of nonCustomPresets) {
      const presetId = presetDef.preset;
      const syntheticKey = `sk-sweep-${presetId}-1234567890abcdef`;
      let payload;

      if (presetId === "cloudflare") {
        payload = {
          apiKey: syntheticKey,
          accountId: "cf_acc_998877665544"
        };
      } else if (presetId === "azure") {
        payload = {
          apiKey: syntheticKey,
          resourceName: "contoso-ai-prod",
          deployment: "gpt-4o-deploy"
        };
      } else if (presetId === "vertex") {
        payload = {
          apiKey: syntheticKey,
          projectId: "gcp-vertex-sweep-proj",
          location: "us-east5"
        };
      } else if (presetId === "bedrock") {
        payload = {
          apiKey: syntheticKey,
          region: "us-west-2"
        };
      } else if (presetDef.keyOptional) {
        // Test keyless local/optional presets with empty keys or model-only config JSON
        payload = {
          models: presetDef.models?.length ? [presetDef.models[0]] : ["local-test-model"]
        };
      } else {
        payload = {
          apiKey: syntheticKey
        };
      }

      const res = await apiFetch("/api/providers/connect-json", {
        method: "POST",
        body: {
          preset: presetId,
          slug: `sweep-${presetId}`,
          jsonText: JSON.stringify(payload)
        }
      });
      const body = await res.json();
      assert.equal(
        res.status,
        200,
        `Expected 200 for preset '${presetId}', got ${res.status}: ${JSON.stringify(body)}`
      );
      assert.equal(body.ok, true, `Expected ok: true for preset '${presetId}'`);
      assert.equal(body.mode, "config_json");
      assert.equal(body.provider.preset, presetId);

      // Verify smart provider-specific baseUrl resolution
      if (presetId === "cloudflare") {
        assert.equal(
          body.provider.baseUrl,
          "https://api.cloudflare.com/client/v4/accounts/cf_acc_998877665544/ai/v1"
        );
      } else if (presetId === "azure") {
        assert.equal(
          body.provider.baseUrl,
          "https://contoso-ai-prod.openai.azure.com/openai/deployments/gpt-4o-deploy"
        );
      } else if (presetId === "vertex") {
        assert.equal(
          body.provider.baseUrl,
          "https://us-east5-aiplatform.googleapis.com/v1/projects/gcp-vertex-sweep-proj/locations/us-east5/endpoints/openapi"
        );
      } else if (presetId === "bedrock") {
        assert.equal(
          body.provider.baseUrl,
          "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1"
        );
      }

      if (!presetDef.keyOptional) {
        assert.ok(body.provider.apiKeys.length >= 1);
        assert.equal(body.provider.apiKeys[0].maskedKey, maskKey(syntheticKey));
        assert.ok(
          !JSON.stringify(body).includes(syntheticKey),
          `Response for '${presetId}' must never leak plaintext key`
        );
      }
    }

    // Also test connecting Cloudflare with ONLY { "apiKey": "..." } (no accountId) to ensure default preset baseUrl passes isValidHttpUrl
    const cfMinimalRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "cloudflare",
        slug: "cloudflare-minimal-key-only",
        jsonText: JSON.stringify({ apiKey: "sk-cf-minimal-1234567890" })
      }
    });
    assert.equal(cfMinimalRes.status, 200);
    assert.equal((await cfMinimalRes.json()).ok, true);

    // 2. Test JSONC with // single-line comments, /* block comments */, trailing commas, and ```json markdown fences
    const jsoncSecret = "sk-jsonc-fenced-key-9988776655443322";
    const jsoncFencedText = [
      "```json",
      "{",
      "  // OpenAI provider config with comments & trailing commas",
      "  /* Multi-line block comment */",
      `  "apiKey": "${jsoncSecret}",`,
      '  "models": ["gpt-4o", "gpt-4.1",],',
      "}",
      "```"
    ].join("\n");

    const jsoncRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "openai",
        slug: "openai-jsonc-fenced",
        jsonText: jsoncFencedText
      }
    });
    assert.equal(jsoncRes.status, 200);
    const jsoncBody = await jsoncRes.json();
    assert.equal(jsoncBody.ok, true);
    assert.equal(jsoncBody.provider.apiKeys[0].maskedKey, maskKey(jsoncSecret));
    assert.deepEqual(jsoncBody.provider.models, ["gpt-4o", "gpt-4.1"]);

    // 3. Test .env / KEY=VALUE lines and bare API key token coercion
    const envCoerced = coerceFlexibleJsonInput(
      "OPENAI_API_KEY=sk-env-line-key-1234567890\nOPENAI_BASE_URL=https://api.openai.com/v1"
    );
    assert.equal(envCoerced.env.OPENAI_API_KEY, "sk-env-line-key-1234567890");
    const bareCoerced = coerceFlexibleJsonInput("gsk_bareGroqToken1234567890abcdef");
    assert.equal(bareCoerced.apiKey, "gsk_bareGroqToken1234567890abcdef");

    // 4. Test Nested Tool Configs:
    // 4a. Claude Code / desktop env style: { env: { ANTHROPIC_API_KEY: "..." } }
    const claudeEnvKey = "sk-ant-env-nested-1122334455667788";
    const claudeEnvRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "anthropic",
        slug: "anthropic-env-nested",
        jsonText: JSON.stringify({
          env: {
            ANTHROPIC_API_KEY: claudeEnvKey
          }
        })
      }
    });
    assert.equal(claudeEnvRes.status, 200);
    const claudeEnvBody = await claudeEnvRes.json();
    assert.equal(claudeEnvBody.ok, true);
    assert.equal(claudeEnvBody.provider.apiKeys[0].maskedKey, maskKey(claudeEnvKey));

    // 4b. OpenCode config style: { provider: { anthropic: { options: { apiKey: "..." }, models: { "claude-sonnet-4-20250514": {} } } } }
    const openCodeKey = "sk-opencode-nested-key-aabbccddeeff0011";
    const openCodeRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "anthropic",
        slug: "anthropic-opencode-cfg",
        jsonText: JSON.stringify({
          provider: {
            options: {
              apiKey: openCodeKey
            },
            models: {
              "claude-sonnet-4-20250514": { name: "Claude Sonnet 4" }
            }
          }
        })
      }
    });
    assert.equal(openCodeRes.status, 200);
    const openCodeBody = await openCodeRes.json();
    assert.equal(openCodeBody.ok, true);
    assert.equal(openCodeBody.provider.apiKeys[0].maskedKey, maskKey(openCodeKey));
    assert.ok(openCodeBody.provider.models.includes("claude-sonnet-4-20250514"));

    // 4c. Continue config style: { models: [{ title: "Groq Llama", model: "llama-3.3-70b-versatile", apiKey: "..." }] }
    const continueKey = "gsk_continueNestedModelKey1234567890";
    const continueRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "groq",
        slug: "groq-continue-cfg",
        jsonText: JSON.stringify({
          models: [
            {
              title: "Groq Llama",
              model: "llama-3.3-70b-versatile",
              apiKey: continueKey
            }
          ]
        })
      }
    });
    assert.equal(continueRes.status, 200);
    const continueBody = await continueRes.json();
    assert.equal(continueBody.ok, true);
    assert.equal(continueBody.provider.apiKeys[0].maskedKey, maskKey(continueKey));
    assert.ok(continueBody.provider.models.includes("llama-3.3-70b-versatile"));

    // 4d. Custom headers style: { headers: { Authorization: "Bearer sk-..." } }
    const headerBearerKey = "sk-header-bearer-token-998877665544";
    const headerRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "deepseek",
        slug: "deepseek-headers-cfg",
        jsonText: JSON.stringify({
          headers: {
            Authorization: `Bearer ${headerBearerKey}`
          }
        })
      }
    });
    assert.equal(headerRes.status, 200);
    const headerBody = await headerRes.json();
    assert.equal(headerBody.ok, true);
    assert.equal(headerBody.provider.apiKeys[0].maskedKey, maskKey(headerBearerKey));

    // 4e. Placeholder private_key in Service Account JSON throws friendly 400 error
    const placeholderSaRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "vertex",
        jsonText: JSON.stringify({
          type: "service_account",
          project_id: "demo-project",
          client_email: "bot@demo-project.iam.gserviceaccount.com",
          private_key: "-----BEGIN PRIVATE KEY-----\nREPLACE_WITH_YOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
        })
      }
    });
    assert.equal(placeholderSaRes.status, 400);
    assert.match(
      (await placeholderSaRes.json()).error,
      /sample placeholder/i
    );

    // 5. Google ADC Authorized User JSON (`type: "authorized_user"`)
    const adcRefreshToken = "mock-adc-authorized-user-refresh-token-secret-xyz987";
    const adcClientSecret = "mock-adc-authorized-user-client-secret-123456";
    const adcRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "vertex",
        slug: "vertex-adc-authorized-user",
        location: "us-central1",
        jsonText: JSON.stringify({
          type: "authorized_user",
          client_id: "mock-adc-client.example.invalid",
          client_secret: adcClientSecret,
          refresh_token: adcRefreshToken,
          quota_project_id: "adc-vertex-proj-01"
        })
      }
    });
    assert.equal(adcRes.status, 200);
    const adcBody = await adcRes.json();
    assert.equal(adcBody.ok, true);
    assert.equal(adcBody.mode, "google_authorized_user");
    assert.equal(adcBody.provider.preset, "vertex");
    assert.equal(
      adcBody.provider.baseUrl,
      "https://us-central1-aiplatform.googleapis.com/v1/projects/adc-vertex-proj-01/locations/us-central1/endpoints/openapi"
    );
    assert.equal(adcBody.provider.apiKeys[0].authMethod, "google_oauth");
    assert.equal(adcBody.provider.apiKeys[0].oauthCredentials, undefined);
    assert.equal(adcBody.provider.apiKeys[0].oauthMeta.projectId, "adc-vertex-proj-01");
    assert.equal(
      adcBody.provider.apiKeys[0].oauthMeta.tierLabel,
      "Google ADC (Authorized User JSON)"
    );
    assert.ok(!JSON.stringify(adcBody).includes(adcRefreshToken));
    assert.ok(!JSON.stringify(adcBody).includes(adcClientSecret));

    // 6. Google OAuth `client_secret.json` ({ web: { client_id, client_secret } }) kicks off OAuth PKCE redirect!
    const oauthClientSecret = "mock-web-client-secret-from-json-tab-998877";
    const oauthClientRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "gemini",
        callbackUrl: "http://127.0.0.1:20128/providers",
        jsonText: JSON.stringify({
          web: {
            client_id: "mock-web-client.example.invalid",
            project_id: "gemini-oauth-json-proj",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            client_secret: oauthClientSecret,
            redirect_uris: ["http://127.0.0.1:20128/providers"]
          }
        })
      }
    });
    assert.equal(oauthClientRes.status, 200);
    const oauthClientBody = await oauthClientRes.json();
    assert.equal(oauthClientBody.ok, true);
    assert.equal(oauthClientBody.mode, "google_oauth_client");
    assert.equal(oauthClientBody.requiresOAuthRedirect, true);
    assert.match(oauthClientBody.state, /^google_[0-9a-f]{40}$/);
    const parsedAuthUrl = new URL(oauthClientBody.authUrl);
    assert.equal(parsedAuthUrl.origin, "https://accounts.google.com");
    assert.equal(
      parsedAuthUrl.searchParams.get("client_id"),
      "mock-web-client.example.invalid"
    );
    assert.equal(parsedAuthUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(!JSON.stringify(oauthClientBody).includes(oauthClientSecret));

    // 7. Verify Cline v4 providers.json import extracts lastUsedProvider cleanly + auto-syncs package models + Coding Plan bare tokens
    const codingPlanBare = coerceFlexibleJsonInput("ak-codingplan-1234567890abcdef");
    assert.equal(codingPlanBare.apiKey, "ak-codingplan-1234567890abcdef");
    const jwtBare = coerceFlexibleJsonInput("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.sig_123456");
    assert.equal(jwtBare.apiKey, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.sig_123456");

    const clineAgentKey = "sk-cline-agentrouter-key-only-11223344";
    const unrelatedOpenRouterKey = "sk-or-unrelated-key-must-not-mix-99887766";
    const clineProvidersRes = await apiFetch("/api/providers/connect-json", {
      method: "POST",
      body: {
        preset: "custom",
        slug: "cline-v4-imported",
        autoSyncModels: true,
        jsonText: JSON.stringify({
          version: 1,
          lastUsedProvider: "agentrouter",
          providers: {
            sapaicore: { settings: { provider: "sapaicore", model: "anthropic--claude-3.5-sonnet" } },
            openrouter: { settings: { provider: "openrouter", apiKey: unrelatedOpenRouterKey } },
            agentrouter: {
              settings: {
                provider: "agentrouter",
                apiKey: clineAgentKey,
                model: "gpt-4o",
                baseUrl: `${mockUpstream.baseUrl}/v1`
              }
            }
          }
        })
      }
    });
    assert.equal(clineProvidersRes.status, 200);
    const clineProvidersBody = await clineProvidersRes.json();
    assert.equal(clineProvidersBody.provider.apiKeys.length, 1);
    assert.equal(clineProvidersBody.provider.apiKeys[0].maskedKey, maskKey(clineAgentKey));
    assert.equal(clineProvidersBody.provider.baseUrl, `${mockUpstream.baseUrl}/v1`);
    assert.ok(clineProvidersBody.provider.apiKeys[0].oauthMeta.packageModels.includes("gpt-4o-mini"));

    // 8. Verify all secrets stored during the full-catalog sweep are encrypted at rest and pass security scan
    const finalScanRes = await apiFetch("/api/security/scan", {
      method: "POST",
      body: {}
    });
    assert.equal(finalScanRes.status, 200);
    const finalScan = await finalScanRes.json();
    assert.equal(finalScan.ok, true);
    assert.equal(finalScan.encryptionAtRest, true);
    assert.equal(finalScan.noSecretsInLogs, true);
  });
});
