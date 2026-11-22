import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import { maskKey } from "../server/auth.js";
import { runSecurityScan } from "../server/security/scan.js";
import {
  clearOAuthFlowsStore,
  validateOAuthEndpointUrl
} from "../server/oauthFlows.js";

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

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

describe("001Router CLI Tools 1-Click, OAuth 2.0 / Device Code Flows & /v1/responses", () => {
  let tmpDir;
  let cliHomeDir;
  let mockUpstream;
  let mockOAuth;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;

  let oauthState = {
    expectedChallenge: "",
    gitlabRefreshCount: 0,
    kiloPollCount: 0,
    nousPollCount: 0
  };

  async function apiFetch(routePath, opts = {}) {
    const headers = {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.skipCookie ? {} : { cookie: sessionCookie }),
      ...(opts.csrf !== false ? { "x-requested-with": "001router" } : {}),
      ...(opts.headers || {})
    };
    return fetch(`${baseUrl}${routePath}`, {
      method: opts.method || "GET",
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
    });
  }

  before(async () => {
    clearOAuthFlowsStore();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-cli-oauth-"));
    cliHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-cli-home-"));
    mockUpstream = await createMockUpstream();

    mockOAuth = await createLocalHttpMock(async (req, res, rawBody) => {
      const urlObj = new URL(req.url, "http://127.0.0.1");

      // --- GitLab / Custom OAuth Token & Userinfo ---
      if (urlObj.pathname === "/oauth/token" && req.method === "POST") {
        const params = new URLSearchParams(rawBody);
        const grantType = params.get("grant_type");
        if (grantType === "authorization_code") {
          const verifier = params.get("code_verifier") || "";
          const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
          if (oauthState.expectedChallenge && challenge !== oauthState.expectedChallenge) {
            res.writeHead(400, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "invalid_grant" }));
          }
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              access_token: "gl_access_token_initial_secret",
              refresh_token: "gl_refresh_token_secret_1",
              expires_in: 3600,
              token_type: "Bearer"
            })
          );
        }
        if (grantType === "refresh_token") {
          oauthState.gitlabRefreshCount += 1;
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              access_token: `gl_access_refreshed_${oauthState.gitlabRefreshCount}_secret`,
              refresh_token: `gl_refresh_rotated_${oauthState.gitlabRefreshCount}_secret`,
              expires_in: 7200,
              token_type: "Bearer"
            })
          );
        }
      }

      if (urlObj.pathname === "/api/v4/user" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: 42,
            username: "duo_dev",
            email: "duo@example.com",
            name: "Duo Developer"
          })
        );
      }

      // --- Kilo Code Device Auth ---
      if (urlObj.pathname === "/api/device-auth/codes" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            code: "KILO-8421",
            verificationUrl: `${mockOAuth.baseUrl}/verify-kilo?code=KILO-8421`,
            expiresIn: 300
          })
        );
      }

      if (urlObj.pathname === "/api/device-auth/codes/KILO-8421" && req.method === "GET") {
        oauthState.kiloPollCount += 1;
        if (oauthState.kiloPollCount === 1) {
          res.writeHead(202, { "content-type": "application/json" });
          return res.end(JSON.stringify({ status: "pending" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            status: "approved",
            token: "kilo_live_device_secret_token_999",
            userEmail: "kilo.user@example.com"
          })
        );
      }

      if (urlObj.pathname === "/api/profile" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            organizations: [{ id: "org_kilo_team_77", name: "Kilo Team" }]
          })
        );
      }

      // --- Nous Research RFC 8628 Device Flow ---
      if (urlObj.pathname === "/api/oauth/device/code" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            device_code: "nous_dev_code_123",
            user_code: "NOUS-4567",
            verification_uri: `${mockOAuth.baseUrl}/device`,
            verification_uri_complete: `${mockOAuth.baseUrl}/device?user_code=NOUS-4567`,
            expires_in: 600,
            interval: 1
          })
        );
      }

      if (urlObj.pathname === "/api/oauth/token" && req.method === "POST") {
        oauthState.nousPollCount += 1;
        if (oauthState.nousPollCount === 1) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "authorization_pending" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            access_token: "nous_oauth_access_secret",
            refresh_token: "nous_oauth_refresh_secret",
            expires_in: 3600
          })
        );
      }

      if (urlObj.pathname === "/api/oauth/agent-key" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            api_key: "nous_agent_minted_secret_key",
            expires_at: "2030-01-01T00:00:00Z"
          })
        );
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    app = await createApp({
      dataDir: tmpDir,
      port: 20128,
      cliToolsHomeDir: cliHomeDir,
      cliToolsEnvPath: "",
      oauthAllowLoopback: true,
      allowLoopbackTokenUri: true,
      oauthGitLabBaseUrl: mockOAuth.baseUrl,
      oauthKiloApiBaseUrl: mockOAuth.baseUrl,
      oauthNousPortalBaseUrl: mockOAuth.baseUrl
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Allow mockUpstream loopback for provider baseUrl tests
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

    const settingsRes = await apiFetch("/api/settings", {
      method: "PUT",
      body: { allowPrivateUpstreams: true }
    });
    assert.equal(settingsRes.status, 200);

    const revealRes = await apiFetch("/api/keys/reveal-initial");
    assert.equal(revealRes.status, 200);
    routerKey = (await revealRes.json()).key;
  });

  after(async () => {
    clearOAuthFlowsStore();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mockOAuth) await mockOAuth.close();
    if (mockUpstream) await mockUpstream.close();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (cliHomeDir) await fs.rm(cliHomeDir, { recursive: true, force: true }).catch(() => {});
  });

  it("1. GitLab OAuth 2.0 PKCE + refresh rotation + Custom pasted callback + SSRF guard + single-key test", async () => {
    // SSRF guard rejects cloud metadata / private IP when loopback disallowed
    assert.throws(
      () => validateOAuthEndpointUrl("http://169.254.169.254/latest/meta-data", "tokenUrl"),
      /metadata|link-local|https/i
    );

    // Start GitLab PKCE
    const startRes = await apiFetch("/api/providers/oauth/gitlab/start", {
      method: "POST",
      body: {
        clientId: "gitlab_app_id_123",
        clientSecret: "gitlab_app_secret_xyz",
        callbackUrl: `${baseUrl}/providers?oauth=gitlab`
      }
    });
    assert.equal(startRes.status, 200);
    const startJson = await startRes.json();
    assert.equal(startJson.ok, true);
    const parsedAuth = new URL(startJson.authUrl);
    assert.equal(parsedAuth.searchParams.get("code_challenge_method"), "S256");
    oauthState.expectedChallenge = parsedAuth.searchParams.get("code_challenge");

    // Exchange authorization code + state
    const exRes = await apiFetch("/api/providers/oauth/gitlab/exchange", {
      method: "POST",
      body: { code: "gl_auth_code_1", state: startJson.state }
    });
    assert.equal(exRes.status, 200);
    const exJson = await exRes.json();
    assert.equal(exJson.ok, true);
    assert.equal(exJson.oauthMeta.email, "duo@example.com");
    assert.equal(exJson.provider.preset, "gitlab");
    const gitlabProvId = exJson.provider.id;
    const gitlabKeyId = exJson.keyId;

    // Replay same state must fail
    const replayRes = await apiFetch("/api/providers/oauth/gitlab/exchange", {
      method: "POST",
      body: { code: "gl_auth_code_1", state: startJson.state }
    });
    assert.equal(replayRes.status, 400);

    // Public GET must mask token and never expose oauthCredentials
    const listRes = await apiFetch("/api/providers");
    const listJson = await listRes.json();
    const publicGitlab = listJson.providers.find((p) => p.id === gitlabProvId);
    assert.equal(publicGitlab.apiKeys[0].maskedKey, "oauth:duo@example.com");
    assert.equal(publicGitlab.apiKeys[0].oauthCredentials, undefined);

    // Per-key Refresh must rotate tokens and update db
    const refreshRes = await apiFetch(`/api/providers/${gitlabProvId}/keys/${gitlabKeyId}/refresh`, {
      method: "POST"
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.equal(refreshJson.ok, true);
    assert.equal(oauthState.gitlabRefreshCount, 1);

    // Point GitLab provider baseUrl at mockUpstream and run single-key test
    const putGitlab = await apiFetch(`/api/providers/${gitlabProvId}`, {
      method: "PUT",
      body: { baseUrl: `${mockUpstream.baseUrl}/v1` }
    });
    assert.equal(putGitlab.status, 200);
    const keyTestRes = await apiFetch(`/api/providers/${gitlabProvId}/keys/${gitlabKeyId}/test`, {
      method: "POST"
    });
    assert.equal(keyTestRes.status, 200);
    const keyTestJson = await keyTestRes.json();
    assert.equal(keyTestJson.ok, true);

    // Custom BYO OAuth 2.0 PKCE with pasted full callback URL
    const customProvRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        name: "My OAuth Upstream",
        slug: "my-oauth",
        baseUrl: `${mockUpstream.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: []
      }
    });
    assert.equal(customProvRes.status, 201);
    const customProvId = (await customProvRes.json()).provider.id;

    oauthState.expectedChallenge = "";
    const custStart = await apiFetch("/api/providers/oauth/custom_oauth/start", {
      method: "POST",
      body: {
        providerId: customProvId,
        authorizeUrl: `${mockOAuth.baseUrl}/oauth/authorize`,
        tokenUrl: `${mockOAuth.baseUrl}/oauth/token`,
        userinfoUrl: `${mockOAuth.baseUrl}/api/v4/user`,
        clientId: "custom_client_1",
        callbackUrl: `${baseUrl}/providers?oauth=custom_oauth`
      }
    });
    assert.equal(custStart.status, 200);
    const custStartJson = await custStart.json();

    const custExRes = await apiFetch("/api/providers/oauth/custom_oauth/exchange", {
      method: "POST",
      body: {
        providerId: customProvId,
        pastedUrl: `${baseUrl}/providers?code=custom_code_ok&state=${encodeURIComponent(custStartJson.state)}`
      }
    });
    assert.equal(custExRes.status, 200);
    const custExJson = await custExRes.json();
    assert.equal(custExJson.provider.id, customProvId);
    assert.equal(custExJson.provider.apiKeys.length, 1);
  });

  it("2. Kilo Code & Nous Device Code flows + x-kilocode-organizationid header forwarding + encryption", async () => {
    // --- Kilo Code ---
    const kiloStart = await apiFetch("/api/providers/oauth/kilocode/device-code", {
      method: "POST",
      body: {}
    });
    assert.equal(kiloStart.status, 200);
    const kiloStartJson = await kiloStart.json();
    assert.equal(kiloStartJson.userCode, "KILO-8421");

    const pollPending = await apiFetch("/api/providers/oauth/kilocode/poll", {
      method: "POST",
      body: { flowId: kiloStartJson.flowId }
    });
    assert.equal(pollPending.status, 200);
    assert.equal((await pollPending.json()).status, "pending");

    const pollApproved = await apiFetch("/api/providers/oauth/kilocode/poll", {
      method: "POST",
      body: { flowId: kiloStartJson.flowId }
    });
    assert.equal(pollApproved.status, 200);
    const kiloDone = await pollApproved.json();
    assert.equal(kiloDone.status, "approved");
    assert.equal(kiloDone.oauthMeta.orgId, "org_kilo_team_77");

    // Redirect Kilo provider to mockUpstream & verify header forwarding + Bearer token
    const putKilo = await apiFetch(`/api/providers/${kiloDone.provider.id}`, {
      method: "PUT",
      body: { baseUrl: `${mockUpstream.baseUrl}/v1` }
    });
    assert.equal(putKilo.status, 200);

    const kiloChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: `${kiloDone.provider.slug}/anthropic/claude-sonnet-4`,
        messages: [{ role: "user", content: "Ping Kilo" }]
      })
    });
    assert.equal(kiloChat.status, 200);
    const kiloReqSeen = mockUpstream.requests.at(-1);
    assert.equal(kiloReqSeen.headers["authorization"], "Bearer kilo_live_device_secret_token_999");
    assert.equal(kiloReqSeen.headers["x-kilocode-organizationid"], "org_kilo_team_77");

    // --- Nous Research ---
    const nousStart = await apiFetch("/api/providers/oauth/nous/device-code", {
      method: "POST",
      body: {}
    });
    assert.equal(nousStart.status, 200);
    const nousStartJson = await nousStart.json();
    assert.equal(nousStartJson.userCode, "NOUS-4567");

    const nousPending = await apiFetch("/api/providers/oauth/nous/poll", {
      method: "POST",
      body: { flowId: nousStartJson.flowId }
    });
    assert.equal((await nousPending.json()).status, "pending");

    const nousApproved = await apiFetch("/api/providers/oauth/nous/poll", {
      method: "POST",
      body: { flowId: nousStartJson.flowId }
    });
    const nousDone = await nousApproved.json();
    assert.equal(nousDone.status, "approved");
    assert.equal(nousDone.provider.preset, "nous");

    const putNous = await apiFetch(`/api/providers/${nousDone.provider.id}`, {
      method: "PUT",
      body: { baseUrl: `${mockUpstream.baseUrl}/v1` }
    });
    assert.equal(putNous.status, 200);
    const nousChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: `${nousDone.provider.slug}/Hermes-4-405B`,
        messages: [{ role: "user", content: "Ping Nous" }]
      })
    });
    assert.equal(nousChat.status, 200);
    assert.equal(mockUpstream.requests.at(-1).headers["authorization"], "Bearer nous_agent_minted_secret_key");

    // Security scan verifies all stored tokens/secrets are encrypted at rest
    const rawDbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.equal(rawDbText.includes("kilo_live_device_secret_token_999"), false);
    assert.equal(rawDbText.includes("nous_agent_minted_secret_key"), false);
    assert.equal(rawDbText.includes("gl_access_refreshed_1_secret"), false);
  });

  it("3. OpenAI /v1/responses (non-stream, SSE stream & tool calls) + /v1/v1 mount", async () => {
    const oaiRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        name: "Resp OpenAI",
        slug: "resp-oai",
        baseUrl: `${mockUpstream.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: [{ key: "sk-resp-oai-test", label: "default" }],
        models: ["gpt-5.4"]
      }
    });
    assert.equal(oaiRes.status, 201);

    const antRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        name: "Resp Anthropic",
        slug: "resp-ant",
        baseUrl: mockUpstream.baseUrl,
        formatType: "anthropic",
        apiKeys: [{ key: "sk-ant-resp-test", label: "default" }],
        models: ["claude-sonnet-4-6"]
      }
    });
    assert.equal(antRes.status, 201);

    // Non-streaming /v1/responses -> OpenAI upstream
    const r1 = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "resp-oai/gpt-5.4",
        instructions: "Be concise.",
        input: "Say hello",
        tools: [
          {
            type: "function",
            name: "read_file",
            description: "Read workspace file",
            parameters: { type: "object", properties: { path: { type: "string" } } }
          }
        ]
      })
    });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.object, "response");
    assert.equal(j1.status, "completed");
    assert.ok(typeof j1.output_text === "string" && j1.output_text.length > 0);
    assert.equal(mockUpstream.requests.at(-1).body.messages[0].role, "system");
    assert.equal(mockUpstream.requests.at(-1).body.tools[0].function.name, "read_file");

    // Non-streaming /v1/responses -> Anthropic upstream
    const r2 = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "resp-ant/claude-sonnet-4-6",
        instructions: "System rule",
        input: "Ping Anthropic"
      })
    });
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.equal(j2.object, "response");
    assert.ok(j2.output_text.includes("Mock Anthropic reply"));

    // Streaming SSE /v1/responses -> OpenAI & Anthropic upstreams
    for (const modelRef of ["resp-oai/gpt-5.4", "resp-ant/claude-sonnet-4-6"]) {
      const sRes = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${routerKey}`
        },
        body: JSON.stringify({
          model: modelRef,
          input: "Stream hello",
          stream: true
        })
      });
      assert.equal(sRes.status, 200);
      const sseText = await sRes.text();
      assert.match(sseText, /event: response\.created/);
      assert.match(sseText, /event: response\.output_text\.delta/);
      assert.match(sseText, /event: response\.completed/);
    }

    // /v1/v1/messages alias works when Anthropic SDK base URL already ends with /v1
    const v1v1Res = await fetch(`${baseUrl}/v1/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": routerKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "resp-ant/claude-sonnet-4-6",
        max_tokens: 32,
        messages: [{ role: "user", content: "Double v1 check" }]
      })
    });
    assert.equal(v1v1Res.status, 200);
  });

  it("4. CLI Tools statuses, 1-click apply (all 8 tools), masking, injection guard & backup/reset", async () => {
    // Unauthenticated request rejected
    const unauth = await apiFetch("/api/cli-tools/statuses", { skipCookie: true });
    assert.equal(unauth.status, 401);

    // Seed pre-existing user configs for claude, codex & continue to test backup/restore
    await fs.mkdir(path.join(cliHomeDir, ".claude"), { recursive: true });
    const origClaudeText = JSON.stringify({
      theme: "dark",
      env: { ANTHROPIC_BASE_URL: "https://other.example.com", ANTHROPIC_AUTH_TOKEN: "sk-other-secret-9999" }
    }, null, 2);
    await fs.writeFile(path.join(cliHomeDir, ".claude", "settings.json"), origClaudeText, "utf8");

    await fs.mkdir(path.join(cliHomeDir, ".codex"), { recursive: true });
    const origCodexText = 'model_provider = "openai"\n\n[projects."D:/demo"]\ntrusted = true\n';
    await fs.writeFile(path.join(cliHomeDir, ".codex", "config.toml"), origCodexText, "utf8");

    await fs.mkdir(path.join(cliHomeDir, ".continue"), { recursive: true });
    const origContinueYaml = 'name: MySetup\nmodels:\n  - name: "Existing"\n    provider: "ollama"\n    model: "qwen"\n';
    await fs.writeFile(path.join(cliHomeDir, ".continue", "config.yaml"), origContinueYaml, "utf8");

    // Inspect statuses: pre-configured tools detected as "other", keys masked
    const stRes = await apiFetch("/api/cli-tools/statuses");
    assert.equal(stRes.status, 200);
    const { statuses } = await stRes.json();
    assert.equal(statuses.claude.status, "other");
    assert.equal(statuses.claude.summary.maskedKey, maskKey("sk-other-secret-9999"));
    assert.equal(JSON.stringify(statuses).includes("sk-other-secret-9999"), false);
    assert.equal(statuses.codex.status, "other");
    assert.equal(statuses.opencode.status, "not_detected");

    // Injection guard rejects TOML/newline attempts
    const badCodex = await apiFetch("/api/cli-tools/codex/apply", {
      method: "POST",
      body: { apiKey: routerKey, model: 'gpt-5"\nevil_key = "1' }
    });
    assert.equal(badCodex.status, 400);

    // Apply all 8 tools
    const allTools = ["claude", "codex", "opencode", "cline", "kilo", "droid", "continue", "aider"];
    for (const tool of allTools) {
      const applyRes = await apiFetch(`/api/cli-tools/${tool}/apply`, {
        method: "POST",
        body: {
          apiKey: routerKey,
          baseUrl: `http://127.0.0.1:20128`,
          model: "openai/gpt-5.4",
          ...(tool === "claude" ? { opusModel: "anthropic/claude-opus-4-6", haikuModel: "gemini/gemini-2.5-flash" } : {}),
          ...(tool === "codex" ? { wireApi: "responses" } : {})
        }
      });
      assert.equal(applyRes.status, 200, `Expected 200 applying ${tool}`);
      const applyJson = await applyRes.json();
      assert.equal(applyJson.ok, true);
      assert.equal(applyJson.status.status, "configured");
      assert.equal(applyJson.status.hasBackup, true);
      assert.equal(applyJson.status.summary.maskedKey, maskKey(routerKey));
      assert.equal(JSON.stringify(applyJson).includes(routerKey), false);
    }

    // Verify re-applying without apiKey or with masked preview preserves real routerKey
    const claudeReapply = await apiFetch("/api/cli-tools/claude/apply", {
      method: "POST",
      body: { apiKey: maskKey(routerKey), model: "anthropic/claude-sonnet-4-6" }
    });
    assert.equal(claudeReapply.status, 200);
    const writtenClaude = JSON.parse(
      await fs.readFile(path.join(cliHomeDir, ".claude", "settings.json"), "utf8")
    );
    assert.equal(writtenClaude.theme, "dark");
    assert.equal(writtenClaude.env.ANTHROPIC_AUTH_TOKEN, routerKey);
    assert.equal(writtenClaude.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "anthropic/claude-opus-4-6");

    // Verify Codex TOML preserved [projects."D:/demo"] & wrote wire_api = "responses" + auth.json
    const writtenCodex = await fs.readFile(path.join(cliHomeDir, ".codex", "config.toml"), "utf8");
    assert.match(writtenCodex, /wire_api = "responses"/);
    assert.match(writtenCodex, /\[projects\."D:\/demo"\]/);
    const writtenCodexAuth = JSON.parse(
      await fs.readFile(path.join(cliHomeDir, ".codex", "auth.json"), "utf8")
    );
    assert.equal(writtenCodexAuth.OPENAI_API_KEY, routerKey);

    // Reset claude, codex, continue, and opencode; verify exact restoration & cleanup
    for (const tool of ["claude", "codex", "continue", "opencode"]) {
      const resetRes = await apiFetch(`/api/cli-tools/${tool}/reset`, { method: "DELETE" });
      assert.equal(resetRes.status, 200);
    }
    assert.equal(await fs.readFile(path.join(cliHomeDir, ".claude", "settings.json"), "utf8"), origClaudeText);
    assert.equal(await fs.readFile(path.join(cliHomeDir, ".codex", "config.toml"), "utf8"), origCodexText);
    assert.equal(await fs.readFile(path.join(cliHomeDir, ".continue", "config.yaml"), "utf8"), origContinueYaml);
    await assert.rejects(() => fs.stat(path.join(cliHomeDir, ".config", "opencode", "opencode.json")));

    // Security scan across temp dir & server modules passes completely
    const scanReport = await runSecurityScan({
      dataDir: tmpDir,
      serverDir: path.resolve(import.meta.dirname, "../server"),
      bindHost: "127.0.0.1"
    });
    assert.equal(scanReport.ok, true);
    assert.equal(scanReport.codeClean, true);
    assert.equal(scanReport.encryptionAtRest, true);
  });
});
