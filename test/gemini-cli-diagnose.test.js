import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import {
  diagnoseGeminiCliConnection,
  pickOnboardTierId
} from "../server/geminiCliOAuth.js";

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

/** Fake fetch: `routes` maps an RPC name to a response (or a function / array of responses). */
function makeFetch(routes) {
  const calls = [];
  const counters = {};
  const fetchImpl = async (url, init = {}) => {
    const rpc =
      String(url).match(/v1internal:(\w+)/)?.[1] ||
      (/oauth2\.googleapis\.com\/token/.test(String(url)) ? "token" : String(url));
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = null; // form-encoded token request
    }
    calls.push({ url: String(url), rpc, init, body });
    let handler = routes[rpc];
    if (Array.isArray(handler)) {
      const i = counters[rpc] || 0;
      counters[rpc] = i + 1;
      handler = handler[Math.min(i, handler.length - 1)];
    }
    if (typeof handler === "function") handler = await handler(body, init);
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler;
  };
  return { fetchImpl, calls };
}

const FAST = { retryDelayMs: 0 };
const TOKEN = "ya29.diagnose-token-value";

describe("diagnoseGeminiCliConnection — replays the real handshake, returns Google verbatim", () => {
  it("1. onboards with the default tier from allowedTiers, not a hardcoded legacy-tier", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, {
        allowedTiers: [
          { id: "standard-tier", isDefault: false },
          { id: "free-tier", isDefault: true }
        ]
      }),
      onboardUser: json(200, {
        done: true,
        response: { cloudaicompanionProject: { id: "proj-free-1" } }
      }),
      retrieveUserQuota: json(200, { buckets: [] })
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    const onboardCall = calls.find((c) => c.rpc === "onboardUser");
    assert.equal(onboardCall.body.tierId, "free-tier");
    assert.equal(out.tierId, "free-tier");
    assert.equal(out.projectId, "proj-free-1");

    const onboardStep = out.steps.find((s) => s.step === "onboardUser");
    assert.equal(onboardStep.tierId, "free-tier");
    assert.equal(onboardStep.attempts.length, 1);
    assert.equal(onboardStep.attempts[0].hasProject, true);
  });

  it("2. falls back to legacy-tier only when allowedTiers has no default", async () => {
    assert.equal(pickOnboardTierId({ allowedTiers: [{ id: "x", isDefault: false }] }), "legacy-tier");
    assert.equal(pickOnboardTierId(null), "legacy-tier");

    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { allowedTiers: [] }),
      onboardUser: json(200, { done: false }),
      retrieveUserQuota: json(200, {})
    });
    await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, maxAttempts: 1, ...FAST });
    assert.equal(calls.find((c) => c.rpc === "onboardUser").body.tierId, "legacy-tier");
  });

  it("3. skips onboardUser (no mutation) when loadCodeAssist already returned a project", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { cloudaicompanionProject: "proj-existing" }),
      retrieveUserQuota: json(200, { buckets: [] })
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.equal(
      calls.some((c) => c.rpc === "onboardUser"),
      false
    );
    const step = out.steps.find((s) => s.step === "onboardUser");
    assert.equal(step.skipped, true);
    assert.equal(out.projectId, "proj-existing");
  });

  it("4. forceOnboard and an explicit tierId override both reach Google", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { cloudaicompanionProject: "proj-existing" }),
      onboardUser: json(200, { done: true, response: { cloudaicompanionProject: "proj-existing" } }),
      retrieveUserQuota: json(200, {})
    });

    await diagnoseGeminiCliConnection(TOKEN, {
      fetchImpl,
      forceOnboard: true,
      tierId: "standard-tier",
      ...FAST
    });
    const onboardCall = calls.find((c) => c.rpc === "onboardUser");
    assert.ok(onboardCall, "forceOnboard must call onboardUser even with a project");
    assert.equal(onboardCall.body.tierId, "standard-tier");
  });

  it("5. polls through done:false until the project shows up", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { allowedTiers: [{ id: "free-tier", isDefault: true }] }),
      onboardUser: [
        json(200, { done: false }),
        json(200, { done: false }),
        json(200, { done: true, response: { cloudaicompanionProject: { id: "proj-late" } } })
      ],
      retrieveUserQuota: json(200, {})
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.equal(calls.filter((c) => c.rpc === "onboardUser").length, 3);
    assert.equal(out.projectId, "proj-late");
    const step = out.steps.find((s) => s.step === "onboardUser");
    assert.deepEqual(
      step.attempts.map((a) => [a.done, a.hasProject]),
      [
        [false, false],
        [false, false],
        [true, true]
      ]
    );
  });

  it("6. gives up after maxAttempts when Google keeps answering done:false", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { allowedTiers: [{ id: "free-tier", isDefault: true }] }),
      onboardUser: json(200, { done: false }),
      retrieveUserQuota: json(200, {})
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, maxAttempts: 4, ...FAST });
    assert.equal(calls.filter((c) => c.rpc === "onboardUser").length, 4);
    assert.equal(out.projectId, "");
  });

  it("7. stops at once on a deterministic 4xx and keeps Google's error body verbatim", async () => {
    const googleError = {
      error: { code: 403, message: "Permission denied on resource", status: "PERMISSION_DENIED" }
    };
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { allowedTiers: [{ id: "standard-tier", isDefault: true }] }),
      onboardUser: json(403, googleError),
      retrieveUserQuota: json(200, {})
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.equal(calls.filter((c) => c.rpc === "onboardUser").length, 1);
    const step = out.steps.find((s) => s.step === "onboardUser");
    assert.equal(step.ok, false);
    assert.equal(step.status, 403);
    assert.deepEqual(step.response, googleError);
  });

  it("8. retrieveUserQuota sends { project } with the CLI headers, like the real quota call", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, { cloudaicompanionProject: "proj-q" }),
      retrieveUserQuota: json(403, { error: { code: 403, status: "PERMISSION_DENIED" } })
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    const quotaCall = calls.find((c) => c.rpc === "retrieveUserQuota");
    assert.deepEqual(quotaCall.body, { project: "proj-q" });
    assert.match(quotaCall.init.headers["user-agent"], /^GeminiCLI\//);

    const loadCall = calls.find((c) => c.rpc === "loadCodeAssist");
    assert.match(loadCall.init.headers["user-agent"], /^google-api-nodejs-client\//);

    const step = out.steps.find((s) => s.step === "retrieveUserQuota");
    assert.equal(step.status, 403);
    assert.equal(step.projectSent, "proj-q");
  });

  it("9. sends an empty quota body when no project could be found", async () => {
    const { fetchImpl, calls } = makeFetch({
      loadCodeAssist: json(200, {}),
      onboardUser: json(200, { done: true }),
      retrieveUserQuota: json(200, {})
    });
    await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.deepEqual(calls.find((c) => c.rpc === "retrieveUserQuota").body, {});
  });

  it("10. a failing step is recorded and the remaining steps still run", async () => {
    const { fetchImpl } = makeFetch({
      loadCodeAssist: () => {
        throw new Error("socket hang up");
      },
      onboardUser: json(200, { done: true }),
      retrieveUserQuota: json(200, {})
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.deepEqual(
      out.steps.map((s) => s.step),
      ["loadCodeAssist", "onboardUser", "retrieveUserQuota"]
    );
    assert.equal(out.steps[0].ok, false);
    assert.match(out.steps[0].error, /socket hang up/);
  });

  it("11. never echoes the access token back, even if Google reflects it", async () => {
    const { fetchImpl } = makeFetch({
      loadCodeAssist: json(200, { debug: `Authorization: Bearer ${TOKEN}` }),
      onboardUser: json(200, { done: true }),
      retrieveUserQuota: json(200, {})
    });

    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.equal(JSON.stringify(out).includes(TOKEN), false);
  });

  it("12. non-JSON bodies are surfaced as _raw instead of crashing", async () => {
    const { fetchImpl } = makeFetch({
      loadCodeAssist: {
        ok: false,
        status: 502,
        text: async () => "<html>Bad Gateway</html>"
      },
      onboardUser: json(200, { done: true }),
      retrieveUserQuota: json(200, {})
    });
    const out = await diagnoseGeminiCliConnection(TOKEN, { fetchImpl, ...FAST });
    assert.match(out.steps[0].response._raw, /Bad Gateway/);
  });

  it("13. rejects an empty token", async () => {
    await assert.rejects(
      () => diagnoseGeminiCliConnection("  ", { fetchImpl: async () => json(200, {}) }),
      (err) => err.status === 400
    );
  });
});

describe("POST /api/providers/oauth/gemini-cli/diagnose", () => {
  let tmpDir;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let fake;

  async function apiFetch(urlPath, opts = {}) {
    const headers = { "x-requested-with": "001router", ...(opts.headers || {}) };
    if (sessionCookie && !opts.anonymous) headers.cookie = sessionCookie;
    if (opts.body && typeof opts.body !== "string") headers["content-type"] = "application/json";
    return fetch(`${baseUrl}${urlPath}`, {
      method: opts.method,
      headers,
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
    });
  }

  async function seedGeminiCliConnection() {
    await app.locals.storage.update((data) => {
      data.providers = data.providers.filter((p) => p.slug !== "gemini");
      data.providers.push({
        id: "prov-gemini",
        slug: "gemini",
        preset: "gemini",
        name: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        formatType: "gemini-openai",
        apiKeys: [
          {
            id: "key-cli",
            label: "cli@example.com",
            key: "",
            authMethod: "gemini_cli",
            oauthCredentials: JSON.stringify({
              clientId: "client-id",
              clientSecret: "client-secret",
              refreshToken: "refresh-token-value",
              projectId: "",
              flow: "gemini_cli"
            }),
            oauthMeta: { email: "cli@example.com", projectId: "", tier: "standard" },
            enabled: true,
            cooldownUntil: null
          }
        ],
        models: [],
        proxyPoolId: null,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
  }

  function tokenOk() {
    return json(200, { access_token: "ya29.route-token", expires_in: 3600 });
  }

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-gcli-diag-"));
    const webDistDir = path.join(tmpDir, "web-dist");
    await fs.mkdir(webDistDir, { recursive: true });
    await fs.writeFile(path.join(webDistDir, "index.html"), "<html>001Router</html>", "utf8");

    app = await createApp({ dataDir: tmpDir, port: 20128, webDistDir });
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
  });

  after(async () => {
    delete app.locals.googleOAuthFetchImpl;
    server?.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("14. requires a dashboard session", async () => {
    const res = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: {},
      anonymous: true
    });
    assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`);
  });

  it("15. answers 404 when no Gemini CLI connection exists", async () => {
    const res = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: {}
    });
    assert.equal(res.status, 404);
  });

  it("16. runs all four steps against Google and returns the raw bodies (no ReferenceError)", async () => {
    await seedGeminiCliConnection();
    fake = makeFetch({
      token: tokenOk(),
      loadCodeAssist: json(200, { allowedTiers: [{ id: "free-tier", isDefault: true }] }),
      onboardUser: json(200, {
        done: true,
        response: { cloudaicompanionProject: { id: "proj-route-1" } }
      }),
      retrieveUserQuota: json(200, { buckets: [{ modelId: "gemini-2.5-pro", remainingFraction: 1 }] })
    });
    app.locals.googleOAuthFetchImpl = fake.fetchImpl;

    const res = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: { forceRefresh: true }
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.email, "cli@example.com");
    assert.equal(body.discoveredProjectId, "proj-route-1");
    assert.equal(body.onboardTierId, "free-tier");
    assert.deepEqual(
      body.steps.map((s) => s.step),
      ["refreshToken", "loadCodeAssist", "onboardUser", "retrieveUserQuota"]
    );
    // The original bug: `upstreamFetch is not defined` surfaced as `error` on every step.
    for (const s of body.steps) assert.equal(s.error, undefined, `${s.step} errored: ${s.error}`);
    assert.equal(body.steps[1].status, 200);
    assert.equal(body.steps[3].response.buckets[0].modelId, "gemini-2.5-pro");

    const quotaCall = fake.calls.find((c) => c.rpc === "retrieveUserQuota");
    assert.deepEqual(quotaCall.body, { project: "proj-route-1" });
    assert.equal(JSON.stringify(body).includes("ya29.route-token"), false);
    assert.equal(JSON.stringify(body).includes("refresh-token-value"), false);
  });

  it("17. honours a requested tierId and rejects a malformed one", async () => {
    await seedGeminiCliConnection();
    // The retry delay is real at route level, so answer onboardUser with a terminal 4xx.
    fake = makeFetch({
      token: tokenOk(),
      loadCodeAssist: json(200, { allowedTiers: [{ id: "free-tier", isDefault: true }] }),
      onboardUser: json(400, { error: { code: 400, message: "bad tier" } }),
      retrieveUserQuota: json(200, {})
    });
    app.locals.googleOAuthFetchImpl = fake.fetchImpl;

    const ok = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: { tierId: "standard-tier" }
    });
    assert.equal((await ok.json()).onboardTierId, "standard-tier");
    assert.equal(fake.calls.find((c) => c.rpc === "onboardUser").body.tierId, "standard-tier");

    fake.calls.length = 0;
    const bad = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: { tierId: "evil tier\"; drop" }
    });
    assert.equal((await bad.json()).onboardTierId, "free-tier");
  });

  it("18. a refresh-token failure returns 400 with the failing step, without leaking secrets", async () => {
    await seedGeminiCliConnection();
    fake = makeFetch({
      token: json(400, { error: "invalid_grant", error_description: "Token has been revoked." })
    });
    app.locals.googleOAuthFetchImpl = fake.fetchImpl;

    const res = await apiFetch("/api/providers/oauth/gemini-cli/diagnose", {
      method: "POST",
      body: { forceRefresh: true }
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.steps[0].step, "refreshToken");
    assert.equal(body.steps[0].ok, false);
    assert.equal(JSON.stringify(body).includes("refresh-token-value"), false);
    assert.equal(fake.calls.some((c) => c.rpc === "loadCodeAssist"), false);
  });
});
