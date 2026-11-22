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
import { runSecurityScan } from "../server/security/scan.js";
import {
  clearGoogleOAuthStore,
  clearGoogleOAuthTokenCache,
  GOOGLE_OAUTH_SCOPES,
  inspectGoogleAccountAndPlan,
  parseGoogleClientSecretJson
} from "../server/googleOAuth.js";

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

/**
 * Create a lightweight local HTTP server with a custom async handler for offline Google OAuth mocks.
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

describe("001Router Official Google OAuth 2.0 + PKCE (BYO Client & Billing/Tier Detection)", () => {
  let tmpDir;
  let mockUpstream;
  let mockGoogle;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;

  // Programmable mock Google OAuth & Cloud state
  let googleState;

  before(async () => {
    clearGoogleOAuthStore();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-google-oauth-"));
    mockUpstream = await createMockUpstream();

    googleState = {
      tokenHits: 0,
      refreshHits: 0,
      userinfoHits: 0,
      modelsHits: 0,
      billingHits: 0,
      lastTokenParams: null,
      lastModelsHeaders: null,
      lastBillingPath: "",
      expectedChallenge: "",
      expectedRedirectUri: "",
      accessToken: "ya29.mock-google-oauth-initial-token-112233",
      refreshedAccessToken: "ya29.mock-google-oauth-refreshed-token-445566",
      refreshToken: "1//0gMockGoogleRefreshTokenSecret99887766",
      userinfo: {
        email: "dev@example-cloud.com",
        name: "Gemini Developer",
        picture: "https://lh3.googleusercontent.com/mock-avatar"
      },
      models: [
        { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" }
      ],
      billingStatus: 200,
      billingEnabled: true
    };

    mockGoogle = await createLocalHttpMock((req, res, rawBody) => {
      const reqUrl = new URL(req.url, "http://127.0.0.1");

      // 1. Official Google OAuth2 Token endpoint (/token)
      if (req.method === "POST" && reqUrl.pathname === "/token") {
        assert.match(
          String(req.headers["content-type"] || ""),
          /application\/x-www-form-urlencoded/i
        );
        const params = new URLSearchParams(rawBody);
        googleState.lastTokenParams = Object.fromEntries(params.entries());
        const grantType = params.get("grant_type");

        if (grantType === "authorization_code") {
          googleState.tokenHits += 1;
          const verifier = params.get("code_verifier") || "";
          assert.ok(verifier.length >= 43, "PKCE code_verifier must be >= 43 chars");

          if (googleState.expectedChallenge) {
            const computed = crypto
              .createHash("sha256")
              .update(verifier, "ascii")
              .digest("base64url");
            assert.equal(
              computed,
              googleState.expectedChallenge,
              "S256 code_challenge must match SHA-256(code_verifier)"
            );
          }
          if (googleState.expectedRedirectUri) {
            assert.equal(
              params.get("redirect_uri"),
              googleState.expectedRedirectUri,
              "redirect_uri during exchange must exactly match redirect_uri from authUrl"
            );
          }
          assert.ok(params.get("client_id"));
          assert.ok(params.get("client_secret"));

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: googleState.accessToken,
              refresh_token: googleState.refreshToken,
              token_type: "Bearer",
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPES
            })
          );
          return;
        }

        if (grantType === "refresh_token") {
          googleState.refreshHits += 1;
          assert.ok(params.get("client_id"));
          assert.ok(params.get("client_secret"));
          assert.equal(params.get("refresh_token"), googleState.refreshToken);

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: googleState.refreshedAccessToken,
              token_type: "Bearer",
              expires_in: 3600
            })
          );
          return;
        }

        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        return;
      }

      // 2. Google UserInfo endpoint (/oauth2/v3/userinfo)
      if (req.method === "GET" && reqUrl.pathname === "/oauth2/v3/userinfo") {
        googleState.userinfoHits += 1;
        assert.match(String(req.headers.authorization || ""), /^Bearer ya29\./);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(googleState.userinfo));
        return;
      }

      // 3. Gemini API Models endpoint (/v1beta/models)
      if (req.method === "GET" && reqUrl.pathname === "/v1beta/models") {
        googleState.modelsHits += 1;
        googleState.lastModelsHeaders = { ...req.headers };
        assert.match(String(req.headers.authorization || ""), /^Bearer ya29\./);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: googleState.models }));
        return;
      }

      // 4. Google Cloud Billing endpoint (/v1/projects/:projectId/billingInfo)
      if (
        req.method === "GET" &&
        reqUrl.pathname.startsWith("/v1/projects/") &&
        reqUrl.pathname.endsWith("/billingInfo")
      ) {
        googleState.billingHits += 1;
        googleState.lastBillingPath = reqUrl.pathname;
        assert.match(String(req.headers.authorization || ""), /^Bearer ya29\./);

        if (googleState.billingStatus !== 200) {
          res.writeHead(googleState.billingStatus, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                code: googleState.billingStatus,
                message: "Cloud Billing API has not been used in project"
              }
            })
          );
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: `${reqUrl.pathname.slice(4)}`,
            projectId: decodeURIComponent(
              reqUrl.pathname.slice("/v1/projects/".length, -"/billingInfo".length)
            ),
            billingEnabled: googleState.billingEnabled,
            ...(googleState.billingEnabled
              ? { billingAccountName: "billingAccounts/012345-6789AB-CDEF01" }
              : {})
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    app = await createApp({
      dataDir: tmpDir,
      port: 20128,
      googleOAuthTokenUrl: `${mockGoogle.baseUrl}/token`,
      googleOAuthUserinfoUrl: `${mockGoogle.baseUrl}/oauth2/v3/userinfo`,
      googleOAuthModelsUrl: `${mockGoogle.baseUrl}/v1beta/models`,
      googleOAuthBillingBaseUrl: `${mockGoogle.baseUrl}/v1`
    });
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

    // Reveal initial router key
    const revealRes = await apiFetch("/api/keys/reveal-initial");
    assert.equal(revealRes.status, 200);
    routerKey = (await revealRes.json()).key;
    assert.match(routerKey, /^sk-001r-/);
  });

  after(async () => {
    clearGoogleOAuthStore();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mockGoogle) {
      await mockGoogle.close();
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

  it("1. parses Google Cloud Console client_secret_*.json (web, installed, flat), strips prototype pollution, and starts PKCE S256 with clean redirect_uri", async () => {
    // Web client JSON with prototype pollution attempt
    const mockWebClientId = "mock-web-client-id.example.invalid";
    const mockWebClientSecret = "mock-web-client-secret-value-1234";
    const mockDesktopClientId = "mock-desktop-client-id.example.invalid";
    const mockDesktopClientSecret = "mock-desktop-secret-5678";
    const mockFlatClientId = "flat-client.example.invalid";
    const mockFlatClientSecret = "mock-flat-secret-9999";

    const pollutedWebJson = JSON.stringify({
      web: {
        client_id: mockWebClientId,
        project_id: "my-paid-gemini-project",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        client_secret: mockWebClientSecret,
        redirect_uris: ["http://127.0.0.1:20128/providers"]
      }
    }).replace(
      "{",
      '{"__proto__":{"pollutedGoogleOAuth":true},"constructor":{"prototype":{"pollutedGoogleCtor":true}},'
    );

    const parsedWeb = parseGoogleClientSecretJson(pollutedWebJson);
    assert.equal(parsedWeb.clientId, mockWebClientId);
    assert.equal(parsedWeb.clientSecret, mockWebClientSecret);
    assert.equal(parsedWeb.projectId, "my-paid-gemini-project");
    assert.equal(({}).pollutedGoogleOAuth, undefined);
    assert.equal(({}).pollutedGoogleCtor, undefined);

    // Installed/Desktop client JSON
    const parsedInstalled = parseGoogleClientSecretJson({
      installed: {
        client_id: mockDesktopClientId,
        project_id: "desktop-proj-01",
        client_secret: mockDesktopClientSecret
      }
    });
    assert.equal(parsedInstalled.clientId, mockDesktopClientId);
    assert.equal(parsedInstalled.clientSecret, mockDesktopClientSecret);
    assert.equal(parsedInstalled.projectId, "desktop-proj-01");

    // Flat client JSON
    const parsedFlat = parseGoogleClientSecretJson({
      client_id: mockFlatClientId,
      client_secret: mockFlatClientSecret,
      project_id: "flat-proj-02"
    });
    assert.equal(parsedFlat.clientId, mockFlatClientId);
    assert.equal(parsedFlat.clientSecret, mockFlatClientSecret);
    assert.equal(parsedFlat.projectId, "flat-proj-02");

    // Reject malformed/incomplete JSON
    assert.throws(() => parseGoogleClientSecretJson("{bad json"), /Invalid Google OAuth/i);
    assert.throws(
      () => parseGoogleClientSecretJson({ web: { client_id: "only-id" } }),
      /client_secret/i
    );

    // Unauthenticated POST /api/providers/oauth/google/start must be rejected (401)
    const unauthRes = await fetch(`${baseUrl}/api/providers/oauth/google/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "001router"
      },
      body: JSON.stringify({
        clientSecretJson: pollutedWebJson,
        callbackUrl: "http://127.0.0.1:20128/providers"
      })
    });
    assert.equal(unauthRes.status, 401);

    // Cross-origin CSRF request must be blocked (403)
    const csrfRes = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: {
        clientSecretJson: pollutedWebJson,
        callbackUrl: "http://127.0.0.1:20128/providers"
      }
    });
    assert.equal(csrfRes.status, 403);

    // Non-loopback cross-origin callbackUrl must be rejected (400)
    const badCbRes = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        clientSecretJson: pollutedWebJson,
        callbackUrl: "https://attacker.example/callback"
      }
    });
    assert.equal(badCbRes.status, 400);

    // Start Google OAuth PKCE with query params on callbackUrl -> redirect_uri MUST strip query & hash!
    const startRes = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        clientSecretJson: pollutedWebJson,
        callbackUrl: "http://127.0.0.1:20128/providers?tab=oauth&from=gemini#section"
      }
    });
    assert.equal(startRes.status, 200);
    const startData = await startRes.json();
    assert.equal(startData.ok, true);
    assert.equal(startData.expiresInSec, 600);
    assert.equal(startData.redirectUri, "http://127.0.0.1:20128/providers");
    assert.match(startData.state, /^google_[0-9a-f]{40}$/);

    const authUrl = new URL(startData.authUrl);
    assert.equal(authUrl.origin, "https://accounts.google.com");
    assert.equal(authUrl.pathname, "/o/oauth2/v2/auth");
    assert.equal(
      authUrl.searchParams.get("client_id"),
      mockWebClientId
    );
    assert.equal(
      authUrl.searchParams.get("redirect_uri"),
      "http://127.0.0.1:20128/providers"
    );
    assert.equal(authUrl.searchParams.get("response_type"), "code");
    assert.equal(authUrl.searchParams.get("scope"), GOOGLE_OAUTH_SCOPES);
    assert.equal(authUrl.searchParams.get("access_type"), "offline");
    assert.equal(authUrl.searchParams.get("prompt"), "consent");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authUrl.searchParams.get("state"), startData.state);
    assert.ok((authUrl.searchParams.get("code_challenge") || "").length >= 43);

    // Client secret must NEVER appear in authUrl or start response
    assert.ok(!JSON.stringify(startData).includes(mockWebClientSecret));
  });

  it("2. exchanges code+state for paid (billingEnabled: true), free (billingEnabled: false), and 403-fallback tiers; encrypts oauthCredentials at rest; hides secrets in GET /api/providers", async () => {
    const clientSecret = "mock-paid-project-secret-889900";
    const paidProjectId = "gcp-paid-gemini-proj";

    // --- Case A: billingEnabled === true -> Pay-as-you-go (Cloud Billing Active) ---
    googleState.billingStatus = 200;
    googleState.billingEnabled = true;

    const startPaid = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        clientSecretJson: JSON.stringify({
          web: {
            client_id: "paid-client.example.invalid",
            client_secret: clientSecret,
            project_id: paidProjectId
          }
        }),
        callbackUrl: "http://127.0.0.1:20128/providers?oauth=google"
      }
    });
    assert.equal(startPaid.status, 200);
    const startPaidData = await startPaid.json();
    const authUrlPaid = new URL(startPaidData.authUrl);
    googleState.expectedChallenge = authUrlPaid.searchParams.get("code_challenge") || "";
    googleState.expectedRedirectUri = startPaidData.redirectUri;

    // Invalid state must be rejected with 400
    const badStateRes = await apiFetch("/api/providers/oauth/google/exchange", {
      method: "POST",
      body: { code: "4/0MockAuthCodePaid", state: "google_invalid_nonexistent_state" }
    });
    assert.equal(badStateRes.status, 400);
    assert.equal(googleState.tokenHits, 0);

    // Valid exchange succeeds and detects Paid billing tier
    const exPaidRes = await apiFetch("/api/providers/oauth/google/exchange", {
      method: "POST",
      body: { code: "4/0MockAuthCodePaid", state: startPaidData.state }
    });
    assert.equal(exPaidRes.status, 200);
    const exPaidText = await exPaidRes.text();
    // NEVER leak refreshToken, clientSecret, or accessToken in API response!
    assert.ok(!exPaidText.includes(clientSecret));
    assert.ok(!exPaidText.includes(googleState.refreshToken));
    assert.ok(!exPaidText.includes(googleState.accessToken));
    assert.ok(!exPaidText.includes("oauthCredentials"));

    const exPaidData = JSON.parse(exPaidText);
    assert.equal(exPaidData.ok, true);
    assert.equal(googleState.tokenHits, 1);
    assert.equal(googleState.lastModelsHeaders["x-goog-user-project"], paidProjectId);
    assert.equal(googleState.lastBillingPath, `/v1/projects/${paidProjectId}/billingInfo`);

    assert.equal(exPaidData.provider.preset, "gemini");
    assert.equal(exPaidData.provider.slug, "gemini");
    assert.equal(exPaidData.provider.apiKeys.length, 1);

    const paidKey = exPaidData.provider.apiKeys[0];
    assert.equal(paidKey.authMethod, "google_oauth");
    assert.equal(paidKey.maskedKey, "oauth:dev@example-cloud.com");
    assert.equal(paidKey.oauthCredentials, undefined);
    assert.equal(paidKey.key, undefined);
    assert.equal(paidKey.oauthMeta.email, "dev@example-cloud.com");
    assert.equal(paidKey.oauthMeta.name, "Gemini Developer");
    assert.equal(paidKey.oauthMeta.projectId, paidProjectId);
    assert.equal(paidKey.oauthMeta.billingEnabled, true);
    assert.equal(paidKey.oauthMeta.tier, "paid");
    assert.equal(paidKey.oauthMeta.tierLabel, "Pay-as-you-go (Cloud Billing Active)");
    assert.equal(paidKey.oauthMeta.modelsCount, 3);
    assert.ok(paidKey.oauthMeta.topModels.includes("gemini-2.5-pro"));
    assert.ok(typeof paidKey.oauthMeta.checkedAt === "string");

    // Replayed state MUST be rejected with 400 and NOT hit token endpoint again
    const replayRes = await apiFetch("/api/providers/oauth/google/exchange", {
      method: "POST",
      body: { code: "4/0MockAuthCodePaid", state: startPaidData.state }
    });
    assert.equal(replayRes.status, 400);
    assert.equal(googleState.tokenHits, 1, "Replayed state must not reach token endpoint");

    // --- Verify db.json encryption at rest & GET /api/providers ---
    const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.ok(rawDbText.includes("enc:v1:"), "db.json must store encrypted enc:v1: ciphertext");
    assert.ok(
      !rawDbText.includes(googleState.refreshToken),
      "db.json must NEVER contain plaintext refreshToken"
    );
    assert.ok(
      !rawDbText.includes(clientSecret),
      "db.json must NEVER contain plaintext clientSecret"
    );
    assert.ok(
      !rawDbText.includes(googleState.accessToken),
      "db.json must NEVER contain plaintext accessToken"
    );
    assert.ok(!rawDbText.includes('"refreshToken"'));
    assert.ok(!rawDbText.includes('"clientSecret"'));

    const diskDb = JSON.parse(rawDbText);
    const diskGemini = diskDb.providers.find((p) => p.preset === "gemini");
    assert.ok(diskGemini);
    const cipherCreds = diskGemini.apiKeys[0].oauthCredentials;
    assert.ok(isEncrypted(cipherCreds), "oauthCredentials on disk must be enc:v1: encrypted");

    const masterKey = await loadOrCreateMasterKey(tmpDir);
    const decryptedCreds = JSON.parse(decryptSecret(cipherCreds, masterKey));
    assert.equal(decryptedCreds.clientId, "paid-client.example.invalid");
    assert.equal(decryptedCreds.clientSecret, clientSecret);
    assert.equal(decryptedCreds.refreshToken, googleState.refreshToken);
    assert.equal(decryptedCreds.projectId, paidProjectId);

    // Fresh Storage reload decrypts oauthCredentials transparently and keeps oauthMeta
    const reloadedStorage = await createStorage({ dataDir: tmpDir });
    const reloadedGemini = reloadedStorage.getProviderById(exPaidData.provider.id);
    assert.equal(reloadedGemini.apiKeys[0].authMethod, "google_oauth");
    assert.equal(
      JSON.parse(reloadedGemini.apiKeys[0].oauthCredentials).refreshToken,
      googleState.refreshToken
    );
    assert.equal(
      reloadedGemini.apiKeys[0].oauthMeta.tierLabel,
      "Pay-as-you-go (Cloud Billing Active)"
    );

    // GET /api/providers exposes oauthMeta cleanly without any secrets
    const listRes = await apiFetch("/api/providers");
    assert.equal(listRes.status, 200);
    const listText = await listRes.text();
    assert.ok(!listText.includes(clientSecret));
    assert.ok(!listText.includes(googleState.refreshToken));
    assert.ok(!listText.includes(googleState.accessToken));
    assert.ok(!listText.includes("oauthCredentials"));
    const listedGemini = JSON.parse(listText).providers.find((p) => p.preset === "gemini");
    assert.equal(listedGemini.apiKeys[0].oauthMeta.email, "dev@example-cloud.com");
    assert.equal(
      listedGemini.apiKeys[0].oauthMeta.tierLabel,
      "Pay-as-you-go (Cloud Billing Active)"
    );
    assert.equal(listedGemini.apiKeys[0].oauthMeta.modelsCount, 3);
    assert.equal(listedGemini.apiKeys[0].oauthMeta.projectId, paidProjectId);

    // Security scan MUST PASS on encrypted Google OAuth storage
    const scanRes = await apiFetch("/api/security/scan", { method: "POST", body: {} });
    assert.equal(scanRes.status, 200);
    const scanData = await scanRes.json();
    assert.equal(scanData.ok, true);
    assert.equal(scanData.encryptionAtRest, true);

    // --- Case B: billingEnabled === false -> Gemini API Free Tier ---
    const freeProjectId = "gcp-free-tier-proj";
    const freeClientSecret = "mock-free-project-secret-112233";
    googleState.billingStatus = 200;
    googleState.billingEnabled = false;
    googleState.userinfo = {
      email: "hobbyist@gmail.com",
      name: "Hobbyist Dev",
      picture: ""
    };

    const startFree = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        clientId: "free-client.example.invalid",
        clientSecret: freeClientSecret,
        projectId: freeProjectId,
        callbackUrl: "http://127.0.0.1:20128/providers"
      }
    });
    assert.equal(startFree.status, 200);
    const startFreeData = await startFree.json();
    const authUrlFree = new URL(startFreeData.authUrl);
    googleState.expectedChallenge = authUrlFree.searchParams.get("code_challenge") || "";
    googleState.expectedRedirectUri = startFreeData.redirectUri;

    const exFreeRes = await apiFetch("/api/providers/oauth/google/exchange", {
      method: "POST",
      body: { code: "4/0MockAuthCodeFree", state: startFreeData.state }
    });
    assert.equal(exFreeRes.status, 200);
    const exFreeData = await exFreeRes.json();
    assert.equal(exFreeData.ok, true);
    assert.equal(exFreeData.oauthMeta.email, "hobbyist@gmail.com");
    assert.equal(exFreeData.oauthMeta.projectId, freeProjectId);
    assert.equal(exFreeData.oauthMeta.billingEnabled, false);
    assert.equal(exFreeData.oauthMeta.tier, "free");
    assert.equal(exFreeData.oauthMeta.tierLabel, "Gemini API Free Tier");
    assert.equal(exFreeData.provider.apiKeys.length, 2);

    // --- Case C: Cloud Billing API 403 -> graceful fallback (never throws) ---
    googleState.billingStatus = 403;
    const fallbackMeta = await inspectGoogleAccountAndPlan(googleState.accessToken, {
      projectId: "restricted-billing-proj",
      userinfoUrl: `${mockGoogle.baseUrl}/oauth2/v3/userinfo`,
      modelsUrl: `${mockGoogle.baseUrl}/v1beta/models`,
      billingBaseUrl: `${mockGoogle.baseUrl}/v1`
    });
    assert.equal(fallbackMeta.tier, "standard");
    assert.equal(fallbackMeta.tierLabel, "Gemini API · Google Account Connected");
    assert.equal(fallbackMeta.billingEnabled, null);
    assert.equal(fallbackMeta.modelsCount, 3);

    // Verify security scanner FAILS if unencrypted oauthCredentials / refreshToken / clientSecret exist on disk
    const badScanDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-bad-oauth-scan-"));
    try {
      await fs.writeFile(path.join(badScanDir, ".master.key"), "b".repeat(64), "utf8");
      await fs.writeFile(
        path.join(badScanDir, "db.json"),
        JSON.stringify({
          providers: [
            {
              id: "bad-gem",
              apiKeys: [
                {
                  id: "bad-oauth-key",
                  key: "",
                  authMethod: "google_oauth",
                  oauthCredentials: JSON.stringify({
                    clientId: "x",
                    clientSecret: "mock-leaked-secret-value",
                    refreshToken: "mock-leaked-refresh-token"
                  })
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
  });

  it("3. routes /v1/chat/completions through gemini/... with Bearer token + x-goog-user-project, refreshes expired token, preserves creds on PUT, and refreshes plan via /refresh-plan", async () => {
    // Retrieve Gemini provider & keep only the primary paid Google OAuth key enabled while pointing baseUrl to mockUpstream
    const listRes = await apiFetch("/api/providers");
    const gemini = (await listRes.json()).providers.find((p) => p.preset === "gemini");
    assert.ok(gemini);
    const paidKey = gemini.apiKeys.find((k) => k.oauthMeta?.projectId === "gcp-paid-gemini-proj");
    assert.ok(paidKey);

    // PUT /api/providers/:id pointing baseUrl to local mockUpstream must preserve oauthCredentials + oauthMeta!
    const putRes = await apiFetch(`/api/providers/${gemini.id}`, {
      method: "PUT",
      body: {
        baseUrl: `${mockUpstream.baseUrl}/v1`,
        apiKeys: [
          {
            id: paidKey.id,
            label: "Primary Paid Google OAuth",
            key: paidKey.maskedKey,
            enabled: true
          }
        ]
      }
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.provider.apiKeys.length, 1);
    assert.equal(putData.provider.apiKeys[0].authMethod, "google_oauth");
    assert.equal(putData.provider.apiKeys[0].label, "Primary Paid Google OAuth");
    assert.equal(
      putData.provider.apiKeys[0].oauthMeta.tierLabel,
      "Pay-as-you-go (Cloud Billing Active)"
    );

    // 1. First /v1/chat/completions call uses cached minted Bearer token + x-goog-user-project header
    mockUpstream.reset();
    const initialRefreshHits = googleState.refreshHits;
    const chatRes1 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "gemini/gemini-2.5-pro",
        messages: [{ role: "user", content: "Hello Gemini via Google OAuth" }]
      })
    });
    assert.equal(chatRes1.status, 200);
    const chatJson1 = await chatRes1.json();
    assert.equal(chatJson1.choices[0].message.content, "Mock OpenAI reply");
    assert.equal(googleState.refreshHits, initialRefreshHits, "Cached access token should be reused");
    assert.equal(mockUpstream.requests.length, 1);
    assert.equal(
      mockUpstream.requests[0].headers.authorization,
      `Bearer ${googleState.accessToken}`
    );
    assert.equal(
      mockUpstream.requests[0].headers["x-goog-user-project"],
      "gcp-paid-gemini-proj"
    );

    // 2. Simulate token expiration by clearing in-memory token cache -> next call MUST refresh via refresh_token!
    clearGoogleOAuthTokenCache();
    const chatRes2 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "gemini/gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello after token refresh" }]
      })
    });
    assert.equal(chatRes2.status, 200);
    assert.equal(
      googleState.refreshHits,
      initialRefreshHits + 1,
      "Expired token must refresh via grant_type=refresh_token"
    );
    assert.equal(
      mockUpstream.requests[1].headers.authorization,
      `Bearer ${googleState.refreshedAccessToken}`
    );
    assert.equal(
      mockUpstream.requests[1].headers["x-goog-user-project"],
      "gcp-paid-gemini-proj"
    );

    // 3. Provider connection test and live model fetch also pass Bearer + x-goog-user-project
    const testRes = await apiFetch(`/api/providers/${gemini.id}/test`, {
      method: "POST",
      body: {}
    });
    assert.equal(testRes.status, 200);
    const testData = await testRes.json();
    assert.equal(testData.ok, true);
    const lastTestReq = mockUpstream.requests[mockUpstream.requests.length - 1];
    assert.equal(lastTestReq.headers.authorization, `Bearer ${googleState.refreshedAccessToken}`);
    assert.equal(lastTestReq.headers["x-goog-user-project"], "gcp-paid-gemini-proj");

    const modelsRes = await apiFetch(`/api/providers/${gemini.id}/models`, {
      method: "POST",
      body: {}
    });
    assert.equal(modelsRes.status, 200);
    const modelsData = await modelsRes.json();
    assert.equal(modelsData.ok, true);
    const lastModelsReq = mockUpstream.requests[mockUpstream.requests.length - 1];
    assert.equal(
      lastModelsReq.headers.authorization,
      `Bearer ${googleState.refreshedAccessToken}`
    );
    assert.equal(lastModelsReq.headers["x-goog-user-project"], "gcp-paid-gemini-proj");

    // 4. POST /api/providers/:id/oauth/google/refresh-plan forces fresh token + updates oauthMeta
    googleState.billingStatus = 200;
    googleState.billingEnabled = false;
    googleState.userinfo = {
      email: "dev@example-cloud.com",
      name: "Gemini Developer Updated",
      picture: ""
    };
    googleState.models = [
      { name: "models/gemini-2.5-pro" },
      { name: "models/gemini-2.5-flash" },
      { name: "models/gemini-2.5-flash-lite" },
      { name: "models/gemini-2.0-flash" }
    ];

    const refreshPlanHitsBefore = googleState.refreshHits;
    const refreshPlanRes = await apiFetch(
      `/api/providers/${gemini.id}/oauth/google/refresh-plan`,
      {
        method: "POST",
        body: { keyId: paidKey.id }
      }
    );
    assert.equal(refreshPlanRes.status, 200);
    const refreshPlanText = await refreshPlanRes.text();
    assert.ok(!refreshPlanText.includes(googleState.refreshToken));
    assert.ok(!refreshPlanText.includes(googleState.refreshedAccessToken));
    assert.ok(!refreshPlanText.includes("oauthCredentials"));

    const refreshPlanData = JSON.parse(refreshPlanText);
    assert.equal(refreshPlanData.ok, true);
    assert.equal(
      googleState.refreshHits,
      refreshPlanHitsBefore + 1,
      "refresh-plan must mint a fresh access token"
    );
    assert.equal(refreshPlanData.oauthMeta.name, "Gemini Developer Updated");
    assert.equal(refreshPlanData.oauthMeta.billingEnabled, false);
    assert.equal(refreshPlanData.oauthMeta.tier, "free");
    assert.equal(refreshPlanData.oauthMeta.tierLabel, "Gemini API Free Tier");
    assert.equal(refreshPlanData.oauthMeta.modelsCount, 4);
    assert.equal(
      refreshPlanData.provider.apiKeys[0].oauthMeta.tierLabel,
      "Gemini API Free Tier"
    );

    // 5. Redacted export masks oauthCredentials while preserving oauthMeta
    const exportRes = await apiFetch("/api/export");
    assert.equal(exportRes.status, 200);
    const exportText = await exportRes.text();
    assert.ok(!exportText.includes(googleState.refreshToken));
    assert.ok(!exportText.includes("mock-paid-project-secret-889900"));
    const exportJson = JSON.parse(exportText);
    const exportedGem = exportJson.providers.find((p) => p.id === gemini.id);
    assert.equal(exportedGem.apiKeys[0].oauthCredentials, "***redacted***");
    assert.equal(exportedGem.apiKeys[0].oauthMeta.modelsCount, 4);

    // 6. Final security scan passes 100%
    const finalScanRes = await apiFetch("/api/security/scan", { method: "POST", body: {} });
    assert.equal(finalScanRes.status, 200);
    const finalScan = await finalScanRes.json();
    assert.equal(finalScan.ok, true);
    assert.equal(finalScan.encryptionAtRest, true);
    assert.equal(finalScan.noSecretsInLogs, true);
  });
});
