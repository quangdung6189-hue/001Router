import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_MAX_OUTPUT_TOKENS,
  GEMINI_CLI_CLIENT_ID,
  exchangeGeminiCliOAuth,
  fetchGeminiCliQuota,
  getCloudCodeFlavor,
  getCloudCodeFlavorForKey,
  startGeminiCliOAuth
} from "../server/geminiCliOAuth.js";
import { buildCloudCodeRequest } from "../server/geminiCliTranslator.js";

const AG_UA = /^antigravity\/hub\/\d+\.\d+\.\d+ /;
const AGENT_REQUEST_ID = /^agent\/[0-9a-f-]{36}\/\d+\/[0-9a-f-]{36}\/\d+$/;

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

/** Fake Google: routes by RPC name (`loadCodeAssist`, …), `token` and `userinfo`. */
function makeGoogle(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const rpc =
      u.match(/v1internal:(\w+)/)?.[1] ||
      (u.includes("oauth2.googleapis.com/token") ? "token" : u.includes("userinfo") ? "userinfo" : u);
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = String(init.body || "");
    }
    calls.push({ url: u, rpc, init, body });
    let handler = routes[rpc];
    if (typeof handler === "function") handler = await handler(body, init);
    if (!handler) throw new Error(`unexpected fetch: ${u}`);
    return handler;
  };
  return { fetchImpl, calls };
}

const GOOGLE_OK = {
  token: json(200, {
    access_token: "ya29.ag-access-token",
    refresh_token: "1//ag-refresh-token",
    expires_in: 3600
  }),
  loadCodeAssist: json(200, {
    cloudaicompanionProject: "ag-project-1",
    currentTier: { id: "free-tier", name: "Antigravity Free" },
    allowedTiers: [{ id: "free-tier", isDefault: true }]
  }),
  userinfo: json(200, { email: "ag@example.com", name: "AG User" }),
  fetchAvailableModels: json(200, {
    models: {
      "claude-sonnet-5-5": { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-11-25T00:00:00Z" } },
      "internal-model": { isInternal: true, quotaInfo: { remainingFraction: 1 } },
      "no-quota-model": {}
    }
  })
};

describe("Antigravity flavor — OAuth + discovery", () => {
  it("1. flavor lookup: antigravity and gemini_cli keys resolve, other auth methods do not", () => {
    assert.equal(getCloudCodeFlavorForKey({ authMethod: "antigravity" }).id, "antigravity");
    assert.equal(getCloudCodeFlavorForKey({ authMethod: "gemini_cli" }).id, "gemini_cli");
    assert.equal(getCloudCodeFlavorForKey({ authMethod: "google_oauth" }), null);
    assert.equal(getCloudCodeFlavorForKey({ authMethod: "constructor" }), null);
    assert.equal(getCloudCodeFlavor("nope").id, "gemini_cli");
  });

  it("2. start uses the Antigravity client, its 5 scopes, PKCE S256 and a loopback redirect", () => {
    const started = startGeminiCliOAuth({ flavor: "antigravity" });
    const url = new URL(started.authUrl);
    assert.equal(url.searchParams.get("client_id"), ANTIGRAVITY_CLIENT_ID);
    assert.notEqual(ANTIGRAVITY_CLIENT_ID, GEMINI_CLI_CLIENT_ID);
    const scopes = url.searchParams.get("scope").split(" ");
    assert.equal(scopes.length, 5);
    assert.ok(scopes.includes("https://www.googleapis.com/auth/cclog"));
    assert.ok(scopes.includes("https://www.googleapis.com/auth/experimentsandconfigs"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(url.searchParams.get("redirect_uri"), /^http:\/\/localhost:\d+\//);
    assert.equal(started.flavor, "antigravity");
  });

  it("3. exchange discovers the project with Antigravity headers and reads quota from the daily host", async () => {
    const started = startGeminiCliOAuth({ flavor: "antigravity" });
    const google = makeGoogle(GOOGLE_OK);
    const out = await exchangeGeminiCliOAuth({
      flavor: "antigravity",
      code: "4/0A-code",
      state: started.state,
      fetchImpl: google.fetchImpl
    });

    const tokenCall = google.calls.find((c) => c.rpc === "token");
    assert.match(tokenCall.body, new RegExp(`client_id=${encodeURIComponent(ANTIGRAVITY_CLIENT_ID)}`));

    const load = google.calls.find((c) => c.rpc === "loadCodeAssist");
    assert.match(load.url, /^https:\/\/cloudcode-pa\.googleapis\.com\//, "discovery stays on prod");
    assert.match(load.init.headers["user-agent"], AG_UA);
    assert.equal(load.init.headers["x-goog-api-client"], undefined);
    assert.equal(load.init.headers["client-metadata"], undefined);
    assert.equal("mode" in load.body, false);

    const quota = google.calls.find((c) => c.rpc === "fetchAvailableModels");
    assert.match(quota.url, /^https:\/\/daily-cloudcode-pa\.googleapis\.com\/v1internal:fetchAvailableModels$/);
    assert.deepEqual(quota.body, { project: "ag-project-1" });

    assert.equal(out.flavor, "antigravity");
    assert.equal(out.oauthCredentials.flow, "antigravity");
    assert.equal(out.oauthCredentials.clientId, ANTIGRAVITY_CLIENT_ID);
    assert.equal(out.oauthCredentials.projectId, "ag-project-1");
    assert.equal(out.oauthMeta.flow, "antigravity");
    assert.equal(out.oauthMeta.email, "ag@example.com");
    assert.deepEqual(
      out.oauthMeta.quotaBuckets.map((b) => b.modelId),
      ["claude-sonnet-5-5"]
    );
  });

  it("4. a state started for one flavor cannot be finished as the other (no token call made)", async () => {
    const started = startGeminiCliOAuth({ flavor: "antigravity" });
    const google = makeGoogle(GOOGLE_OK);
    await assert.rejects(
      () =>
        exchangeGeminiCliOAuth({
          flavor: "gemini_cli",
          code: "4/0A-code",
          state: started.state,
          fetchImpl: google.fetchImpl
        }),
      (err) => err.status === 400 && /Antigravity/.test(err.message)
    );
    assert.equal(google.calls.length, 0);
  });

  it("5. fetchAvailableModels quota skips internal models and models without quotaInfo", async () => {
    const google = makeGoogle(GOOGLE_OK);
    const quota = await fetchGeminiCliQuota("ya29.x", {
      flavor: "antigravity",
      fetchImpl: google.fetchImpl
    });
    assert.deepEqual(quota.buckets, [
      { modelId: "claude-sonnet-5-5", remainingFraction: 0.75, resetTime: "2026-11-25T00:00:00Z" }
    ]);
  });
});

describe("Antigravity flavor — chat envelope", () => {
  const body = {
    model: "claude-sonnet-5-5",
    max_tokens: 200000,
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" }
    ]
  };

  it("6. uses the antigravity dialect: userAgent, agent/ requestId, mapped model, capped tokens", () => {
    const env = buildCloudCodeRequest("claude-sonnet-5-5", body, "ag-project-1", {
      flavor: getCloudCodeFlavor("antigravity")
    });
    assert.equal(env.userAgent, "antigravity");
    assert.match(env.requestId, AGENT_REQUEST_ID);
    assert.equal(env.model, "claude-sonnet-5-5-high(high)");
    assert.equal(env.project, "ag-project-1");
    assert.equal("requestType" in env, false, "requestType triggers a detail-free 429");
    assert.equal(typeof env.request.sessionId, "number");
    assert.ok(env.request.generationConfig.maxOutputTokens <= ANTIGRAVITY_MAX_OUTPUT_TOKENS);
  });

  it("7. unknown Antigravity model ids pass through unchanged", () => {
    const env = buildCloudCodeRequest("gpt-oss-120b-medium", body, "p", {
      flavor: getCloudCodeFlavor("antigravity")
    });
    assert.equal(env.model, "gpt-oss-120b-medium");
  });

  it("8. the Gemini CLI dialect is unchanged when no flavor or gemini_cli is passed", () => {
    for (const options of [undefined, { flavor: getCloudCodeFlavor("gemini_cli") }]) {
      const env = buildCloudCodeRequest("gemini-2.5-pro", body, "cli-p", options);
      assert.equal(env.userAgent, "gemini-cli");
      assert.match(env.requestId, /^req-/);
      assert.equal(env.model, "gemini-2.5-pro");
    }
  });
});

describe("Antigravity routes + /v1 chat", () => {
  let tmpDir;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;

  async function apiFetch(urlPath, opts = {}) {
    const headers = { "x-requested-with": "001router", ...(opts.headers || {}) };
    if (sessionCookie) headers.cookie = sessionCookie;
    if (opts.body && typeof opts.body !== "string") headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${urlPath}`, {
      method: opts.method,
      headers,
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
    });
  }

  async function signIn() {
    const startRes = await apiFetch("/api/providers/oauth/antigravity/start", {
      method: "POST",
      body: {}
    });
    assert.equal(startRes.status, 200);
    const started = await startRes.json();
    const pastedUrl = `${started.redirectUri}?state=${started.state}&code=4/0A-route-code&scope=x`;
    return apiFetch("/api/providers/oauth/antigravity/exchange", {
      method: "POST",
      body: { pastedUrl }
    });
  }

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-ag-"));
    const webDistDir = path.join(tmpDir, "web-dist");
    await fs.mkdir(webDistDir, { recursive: true });
    await fs.writeFile(path.join(webDistDir, "index.html"), "<html>001Router</html>", "utf8");

    app = await createApp({ dataDir: tmpDir, port: 20128, webDistDir });
    app.locals.googleOAuthFetchImpl = makeGoogle(GOOGLE_OK).fetchImpl;
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(loginRes.status, 200);
    sessionCookie = loginRes.headers.get("set-cookie").split(";")[0];

    const keyRes = await apiFetch("/api/keys", { method: "POST", body: { name: "ag test" } });
    assert.equal(keyRes.status, 201);
    routerKey = (await keyRes.json()).key.key;
  });

  after(async () => {
    server?.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("9. start returns an Antigravity authorization URL", async () => {
    const res = await apiFetch("/api/providers/oauth/antigravity/start", { method: "POST", body: {} });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(new URL(out.authUrl).searchParams.get("client_id"), ANTIGRAVITY_CLIENT_ID);
    assert.equal(out.flavor, "antigravity");
  });

  it("10. exchange creates a separate Antigravity provider and leaves Gemini untouched", async () => {
    const res = await signIn();
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.flavor, "antigravity");
    assert.equal(out.provider.preset, "antigravity");
    assert.ok(out.provider.models.includes("claude-sonnet-5-5"));
    assert.equal(JSON.stringify(out).includes("1//ag-refresh-token"), false);

    const providers = app.locals.storage.getProviders();
    const ag = providers.find((p) => p.preset === "antigravity");
    assert.equal(ag.apiKeys.length, 1);
    assert.equal(ag.apiKeys[0].authMethod, "antigravity");
    assert.equal(ag.apiKeys[0].oauthMeta.projectId, "ag-project-1");
    assert.equal(providers.some((p) => p.preset === "gemini"), false);

    // Signing in again with the same account updates the key instead of duplicating it.
    assert.equal((await signIn()).status, 200);
    const again = app.locals.storage.getProviders().find((p) => p.preset === "antigravity");
    assert.equal(again.apiKeys.length, 1);
  });

  it("11. the Gemini CLI exchange route refuses an Antigravity state", async () => {
    const startRes = await apiFetch("/api/providers/oauth/antigravity/start", {
      method: "POST",
      body: {}
    });
    const started = await startRes.json();
    const res = await apiFetch("/api/providers/oauth/gemini-cli/exchange", {
      method: "POST",
      body: { pastedUrl: `${started.redirectUri}?state=${started.state}&code=4/0A-x` }
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Antigravity/);
  });

  it("12. /v1 chat goes to the daily host with the Antigravity envelope and comes back as OpenAI", async () => {
    const upstream = [];
    app.locals.cloudCodeFetchImpl = async (url, init = {}) => {
      upstream.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: "xin chào" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${routerKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "antigravity/claude-sonnet-5-5",
          messages: [{ role: "user", content: "hi" }]
        })
      });
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const out = JSON.parse(text);
      assert.equal(out.choices[0].message.content, "xin chào");

      assert.equal(upstream.length, 1);
      const call = upstream[0];
      assert.equal(call.url, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
      assert.match(call.headers["user-agent"], AG_UA);
      assert.equal(call.headers.authorization, "Bearer ya29.ag-access-token");
      assert.equal(call.body.userAgent, "antigravity");
      assert.equal(call.body.model, "claude-sonnet-5-5-high(high)");
      assert.equal(call.body.project, "ag-project-1");
      assert.match(call.body.requestId, AGENT_REQUEST_ID);
      assert.equal("requestType" in call.body, false);
    } finally {
      delete app.locals.cloudCodeFetchImpl;
    }
  });

  it("13. diagnose runs against the Antigravity key", async () => {
    const res = await apiFetch("/api/providers/oauth/antigravity/diagnose", {
      method: "POST",
      body: { forceRefresh: true }
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.flavor, "antigravity");
    assert.deepEqual(
      out.steps.map((s) => s.step),
      ["refreshToken", "loadCodeAssist", "onboardUser", "fetchAvailableModels"]
    );
    assert.equal(out.steps[2].skipped, true);
  });
});
