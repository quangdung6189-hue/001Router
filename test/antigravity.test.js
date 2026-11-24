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
  explainCloudCode429,
  fetchCloudCodeUsage,
  fetchGeminiCliQuota,
  getCloudCodeFlavor,
  getCloudCodeFlavorForKey,
  parseAntigravityModelCatalog,
  parseAntigravityQuotaSummary,
  parseCloudCodeRateLimit,
  resolveCatalogModel,
  startGeminiCliOAuth
} from "../server/geminiCliOAuth.js";
import {
  aggregateCloudCodeStream,
  buildCloudCodeRequest,
  cloudCodeToOpenAIResponse,
  isGemini4Model,
  rewriteAntigravitySystemText,
  systemPromptIdentity
} from "../server/geminiCliTranslator.js";

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

/** SSE body of a `streamGenerateContent` answer, one `data:` line per frame. */
function sseText(frames) {
  return frames.map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join("");
}

/** makeGoogle-style answer of the streaming chat RPC. */
function sse(frames) {
  return { ok: true, status: 200, text: async () => sseText(frames) };
}

/** Stream frames of a short text answer. */
const OK_FRAMES = [
  { response: { candidates: [{ content: { role: "model", parts: [{ text: "O" }] } }] } },
  {
    response: {
      candidates: [{ content: { role: "model", parts: [{ text: "K" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 }
    }
  }
];

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
  }),
  retrieveUserQuotaSummary: json(200, {
    groups: [
      {
        displayName: "Gemini Models",
        buckets: [
          { window: "WEEKLY", remainingFraction: 0.6, resetTime: "2026-11-30T00:00:00Z" },
          { window: "5H", remainingFraction: 1, resetTime: "2026-11-24T10:00:00Z" }
        ]
      },
      {
        displayName: "Claude and GPT Models",
        buckets: [{ window: "weekly", remainingFraction: 0.25, resetTime: "2026-11-30T00:00:00Z" }]
      }
    ]
  }),
  generateContent: json(200, {
    response: {
      candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }]
    }
  }),
  // Antigravity chat (and its diagnostics) use the streaming RPC, like the IDE.
  streamGenerateContent: sse(OK_FRAMES)
};

/** loadCodeAssist answer of a paid (Google AI Pro) account. */
const LOAD_PAID = json(200, {
  cloudaicompanionProject: "ag-project-1",
  currentTier: { id: "standard-tier", name: "Gemini Code Assist" },
  paidTier: { id: "g1-pro-tier", name: "Google AI Pro" }
});

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
    assert.equal(quota.init.headers["x-client-name"], "antigravity");

    const summary = google.calls.find((c) => c.rpc === "retrieveUserQuotaSummary");
    assert.match(summary.url, /^https:\/\/daily-cloudcode-pa\.googleapis\.com\/v1internal:retrieveUserQuotaSummary$/);
    assert.deepEqual(summary.body, { project: "ag-project-1" });

    assert.equal(out.flavor, "antigravity");
    assert.equal(out.oauthCredentials.flow, "antigravity");
    assert.equal(out.oauthCredentials.clientId, ANTIGRAVITY_CLIENT_ID);
    assert.equal(out.oauthCredentials.projectId, "ag-project-1");
    assert.equal(out.oauthMeta.flow, "antigravity");
    assert.equal(out.oauthMeta.email, "ag@example.com");
    // Free tier: Google's per-model numbers are not the limit, the weekly / 5h windows are.
    assert.deepEqual(out.oauthMeta.quotaBuckets, []);
    assert.equal(out.oauthMeta.perModelHidden, true);
    assert.deepEqual(
      out.oauthMeta.quotaWindows.map((w) => [w.id, w.remainingFraction]),
      [
        ["gemini_weekly", 0.6],
        ["gemini_5h", 1],
        ["claude_gpt_weekly", 0.25]
      ]
    );
  });

  it("3b. a paid plan keeps the per-model quota and labels the plan", async () => {
    const google = makeGoogle({ ...GOOGLE_OK, loadCodeAssist: LOAD_PAID });
    const usage = await fetchCloudCodeUsage("ya29.x", {
      flavor: "antigravity",
      projectId: "ag-project-1",
      fetchImpl: google.fetchImpl
    });
    assert.equal(usage.tier, "paid");
    assert.match(usage.tierLabel, /Google AI Pro/);
    assert.deepEqual(usage.buckets.map((b) => b.modelId), ["claude-sonnet-5-5"]);
    assert.equal(usage.perModelHidden, false);
    assert.equal(usage.windows.length, 3);
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

  it("5a. quota summary: Argon before Gemini, disabled weekly skipped, missing fraction + reset = empty", () => {
    const windows = parseAntigravityQuotaSummary({
      quotaSummary: {
        groups: [
          {
            displayName: "Gemini 4 Argon",
            buckets: [{ bucketId: "argon-weekly", remainingFraction: 0.3, resetTime: "R1" }]
          },
          {
            displayName: "Gemini",
            buckets: [
              { window: "weekly", disabled: true, remainingFraction: 1 },
              { displayName: "Five hour limit", disabled: true },
              { window: "weekly", resetTime: "R2" }
            ]
          },
          { displayName: "Claude & GPT", buckets: [{ window: "5h" }, { window: "minute", remainingFraction: 1 }] },
          { displayName: "Imagen", buckets: [{ window: "weekly", remainingFraction: 1 }] }
        ]
      }
    });
    assert.deepEqual(
      windows.map((w) => [w.id, w.remainingFraction, w.resetTime]),
      [
        ["gemini_argon_weekly", 0.3, "R1"],
        ["gemini_5h", 0, ""],
        ["gemini_weekly", 0, "R2"]
      ]
    );
    assert.deepEqual(parseAntigravityQuotaSummary(null), []);
  });

  it("5b. rate-limit hints: retryDelay, quotaResetTimeStamp and 'reset after' text", () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    const body = (details, message = "x") => JSON.stringify({ error: { message, details } });
    assert.equal(parseCloudCodeRateLimit(body([{ retryDelay: "12.5s" }]), now).resetAtMs, now + 12_500);
    assert.equal(
      parseCloudCodeRateLimit(
        body([{ reason: "QUOTA_EXHAUSTED", metadata: { quotaResetTimeStamp: "2026-11-24T05:00:00Z" } }]),
        now
      ).resetAtMs,
      Date.parse("2026-11-24T05:00:00Z")
    );
    const text = parseCloudCodeRateLimit(
      body([], "You have exhausted your capacity. Your quota will reset after 2h7m23s."),
      now
    );
    assert.equal(text.resetAtMs, now + (2 * 3600 + 7 * 60 + 23) * 1000);
    const bare = parseCloudCodeRateLimit(body([], "Resource has been exhausted (e.g. check quota)."), now);
    assert.deepEqual(bare, { reason: "", message: "Resource has been exhausted (e.g. check quota).", resetAtMs: null });
  });

  it("5c. 429 verdicts: capacity, explicit reset, unreadable quota", async () => {
    const capacity = await explainCloudCode429({
      flavor: "antigravity",
      errText: JSON.stringify({ error: { message: "x", details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }] } })
    });
    assert.equal(capacity.cause, "capacity");

    const explicit = await explainCloudCode429({
      flavor: "antigravity",
      nowMs: 0,
      errText: JSON.stringify({ error: { message: "x", details: [{ retryDelay: "60s" }] } })
    });
    assert.deepEqual([explicit.cause, explicit.resetAtMs], ["quota", 60_000]);

    let called = 0;
    const unreadable = await explainCloudCode429({
      flavor: "antigravity",
      accessToken: "ya29.x",
      model: "gemini-3.8-flash-medium",
      errText: "{}",
      fetchImpl: async () => {
        called += 1;
        return json(403, { error: { message: "denied" } });
      }
    });
    assert.equal(unreadable.cause, "unknown");
    assert.match(unreadable.note, /Chẩn đoán kết nối/);
    assert.equal(called, 2, "quota summary + per-model catalog, read in parallel");

    // Gemini CLI has no summary endpoint: nothing is fetched.
    const cli = await explainCloudCode429({ flavor: "gemini_cli", accessToken: "ya29.x", errText: "{}" });
    assert.deepEqual([cli.cause, cli.note], ["unknown", ""]);
  });

  it("5d. model catalog: agent order, image / tab / internal split, default model", () => {
    const { models, defaultModelId } = parseAntigravityModelCatalog({
      models: {
        "gemini-2.5-flash": { quotaInfo: { remainingFraction: 1 } },
        "gemini-4-neon-medium": { displayName: "Gemini 4 Neon (Medium)", quotaInfo: { remainingFraction: 0.99, resetTime: "R" } },
        "claude-sonnet-5-5-medium": { quotaInfo: {} },
        "gemini-3.1-flash-image": { quotaInfo: { remainingFraction: 1 } },
        tab_flash_lite_preview: { quotaInfo: { remainingFraction: 1 } },
        chat_20706: {},
        "internal-x": { isInternal: true }
      },
      defaultAgentModelId: "gemini-4-neon-medium",
      agentModelSorts: [{ groups: [{ modelIds: ["claude-sonnet-5-5-medium", "gemini-4-neon-medium"] }] }]
    });
    assert.deepEqual(
      models.map((m) => [m.id, m.kind, m.remainingFraction]),
      [
        ["claude-sonnet-5-5-medium", "chat", 0],
        ["gemini-4-neon-medium", "chat", 0.99],
        ["gemini-2.5-flash", "other", 1],
        ["gemini-3.1-flash-image", "image", 1]
      ]
    );
    assert.equal(models[1].label, "Gemini 4 Neon (Medium)");
    assert.equal(defaultModelId, "gemini-4-neon-medium");
    assert.deepEqual(parseAntigravityModelCatalog(null), { models: [], defaultModelId: "" });
  });

  it("5e. requested ids resolve onto the plan: exact, alias, effort tier, default tier", () => {
    const plan = ["gemini-3.8-flash-medium", "gemini-3.8-flash-high", "gemini-4-neon-medium", "claude-sonnet-5-5"].map((id) => ({ id }));
    assert.equal(resolveCatalogModel("claude-sonnet-5-5", plan), "claude-sonnet-5-5", "a plan id is never re-aliased");
    assert.equal(resolveCatalogModel("gemini-3.8-flash", plan), "gemini-3.8-flash-medium");
    assert.equal(resolveCatalogModel("gemini-3.8-flash", plan, { reasoning_effort: "high" }), "gemini-3.8-flash-high");
    assert.equal(resolveCatalogModel("gemini-4-neon", plan), "gemini-4-neon-medium");
    assert.equal(resolveCatalogModel("gemini-4-argon-medium", plan), "");
    assert.equal(resolveCatalogModel("anything", []), "");
  });

  it("5f. a 429 for a model missing from the live catalog is blamed on the plan, not the quota", async () => {
    const verdict = await explainCloudCode429({
      flavor: "antigravity",
      accessToken: "ya29.x",
      model: "gemini-3.8-flash-medium",
      errText: "{}",
      fetchImpl: makeGoogle(GOOGLE_OK).fetchImpl
    });
    assert.equal(verdict.cause, "model");
    assert.match(verdict.note, /not on this account's plan/);
    assert.match(verdict.note, /claude-sonnet-5-5/);
    assert.deepEqual(verdict.catalog.models.map((m) => m.id), ["claude-sonnet-5-5", "no-quota-model"]);
  });

  it("5g. quota left: the bare test chat decides account vs request (and capacity), or is reused", async () => {
    /** Quota reads answer "quota left"; the test chat answers `probeAnswer`. */
    const host = (probeAnswer) => {
      const sent = [];
      const google = makeGoogle({
        ...GOOGLE_OK,
        retrieveUserQuotaSummary: json(200, {
          groups: [{ displayName: "Gemini", buckets: [{ window: "weekly", remainingFraction: 0.9 }] }]
        }),
        fetchAvailableModels: json(200, { models: { "gemini-4-neon-low": { quotaInfo: { remainingFraction: 1 } } } }),
        streamGenerateContent: (body) => {
          sent.push(body);
          return probeAnswer;
        }
      });
      return { fetchImpl: google.fetchImpl, sent, calls: google.calls };
    };
    const base = {
      flavor: "antigravity",
      accessToken: "ya29.x",
      projectId: "ag-project-1",
      model: "gemini-4-neon-low",
      errText: "{}",
      hasSystemPrompt: true,
      systemText: "You are FlaggedApp, a terminal agent. Follow the rules.",
      // Deliberately not what the model name implies: the test chat must copy what was sent.
      thinking: { thinkingLevel: "high", includeThoughts: true }
    };
    const refused = json(429, { error: { code: 429, message: "Resource has been exhausted (e.g. check quota)." } });

    const account = host(refused);
    const a = await explainCloudCode429({ ...base, isolate: true, fetchImpl: account.fetchImpl });
    assert.equal(a.cause, "account");
    assert.equal(a.probeFresh, true);
    assert.deepEqual(a.probe, { ok: false, status: 429, error: "Resource has been exhausted (e.g. check quota)." });
    assert.match(a.note, /Gemini \(Weekly\) 90%/);
    assert.match(a.note, /refused a bare test request to 'gemini-4-neon-low'/);
    // The test chat: same model + thinking, nothing of the request's own, on the streaming RPC.
    assert.equal(account.sent.length, 1);
    assert.equal(account.sent[0].model, "gemini-4-neon-low");
    assert.deepEqual(account.sent[0].request.generationConfig.thinkingConfig, base.thinking);
    const noThinking = host(refused);
    await explainCloudCode429({ ...base, thinking: null, isolate: true, fetchImpl: noThinking.fetchImpl });
    assert.equal(noThinking.sent[0].request.generationConfig.thinkingConfig, undefined);
    assert.equal(account.sent[0].request.systemInstruction, undefined);
    assert.equal(account.sent[0].project, "ag-project-1");
    assert.match(account.calls.find((c) => c.rpc === "streamGenerateContent").url, /\?alt=sse$/);

    const works = host(sse(OK_FRAMES));
    const r = await explainCloudCode429({ ...base, isolate: true, fetchImpl: works.fetchImpl });
    assert.equal(r.cause, "request");
    assert.match(r.note, /just worked/);
    assert.match(r.note, /this one starts "You are FlaggedApp, a terminal agent"/);

    const busy = host(json(429, { error: { code: 429, message: "High traffic: no capacity for this model." } }));
    assert.equal((await explainCloudCode429({ ...base, isolate: true, fetchImpl: busy.fetchImpl })).cause, "capacity");

    // A cached result is reused: no second test chat.
    const cached = host(sse(OK_FRAMES));
    const again = await explainCloudCode429({ ...base, isolate: a.probe, fetchImpl: cached.fetchImpl });
    assert.equal(again.cause, "account");
    assert.equal(again.probeFresh, false);
    assert.equal(cached.sent.length, 0);

    // No test asked for: the old wording, the prompt named as the known trigger.
    const plain = host(sse(OK_FRAMES));
    const p = await explainCloudCode429({ ...base, fetchImpl: plain.fetchImpl });
    assert.equal(p.cause, "request");
    assert.match(p.note, /system prompt that identifies another client/);
    assert.match(p.note, /this one starts "You are FlaggedApp, a terminal agent"/);
    assert.equal(plain.sent.length, 0);
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
    // "(high)" is an effort tag, not part of the model name: sent verbatim Google answers 404.
    assert.equal(env.model, "claude-sonnet-5-5-high");
    // Claude via Antigravity carries its tier in the name; the reference client sends no thinking config.
    assert.equal(env.request.generationConfig.thinkingConfig, undefined);
    assert.equal(env.project, "ag-project-1");
    assert.equal("requestType" in env, false, "requestType triggers a detail-free 429");
    // Google: "Invalid value at 'request.session_id' (TYPE_STRING)" when this is a number.
    assert.equal(typeof env.request.sessionId, "string");
    assert.match(env.request.sessionId, /^-\d+$/);
    assert.ok(env.request.generationConfig.maxOutputTokens <= ANTIGRAVITY_MAX_OUTPUT_TOKENS);
  });

  it("7a. gemini-3.8-flash -> gemini-3.8-flash-medium + thinkingLevel medium; reasoning_effort picks the tier", () => {
    const flavor = getCloudCodeFlavor("antigravity");
    const plain = buildCloudCodeRequest(
      "gemini-3.8-flash",
      { messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
      "p",
      { flavor }
    );
    assert.equal(plain.model, "gemini-3.8-flash-medium");
    // Gemini 3+/4 take a thinking LEVEL (reference client); a budget is the Gemini 2.x format.
    assert.deepEqual(plain.request.generationConfig.thinkingConfig, {
      thinkingLevel: "medium",
      includeThoughts: true
    });
    // Thoughts count toward output: a 100-token cap would leave no room for the answer.
    assert.ok(plain.request.generationConfig.maxOutputTokens >= 16384);

    const high = buildCloudCodeRequest(
      "gemini-3.8-flash",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
      "p",
      { flavor }
    );
    assert.equal(high.model, "gemini-3.8-flash-high");
    assert.equal(high.request.generationConfig.thinkingConfig.thinkingLevel, "high");
    assert.equal(high.request.generationConfig.maxOutputTokens, ANTIGRAVITY_MAX_OUTPUT_TOKENS);

    // A catalog id carries its tier in the name; an unknown tier sends no thinking config.
    const neon = buildCloudCodeRequest("gemini-4-neon-low", { messages: [{ role: "user", content: "hi" }] }, "p", { flavor });
    assert.equal(neon.model, "gemini-4-neon-low");
    assert.equal(neon.request.generationConfig.thinkingConfig.thinkingLevel, "low");
    const xhigh = buildCloudCodeRequest("gemini-4-hydrogen-xhigh", { messages: [{ role: "user", content: "hi" }] }, "p", { flavor });
    assert.equal(xhigh.request.generationConfig.thinkingConfig, undefined);

    // An explicitly tiered id is not re-tiered by reasoning_effort.
    const low = buildCloudCodeRequest(
      "gemini-3.8-flash-low",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
      "p",
      { flavor }
    );
    assert.equal(low.model, "gemini-3.8-flash-low");
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
      assert.equal(env.request.generationConfig.thinkingConfig, undefined);
    }
  });

  it("8b. competing-client markers are removed from Antigravity system prompts only", () => {
    const header = "x-anthropic-billing-header: cc_version=2.1.275.f15; cc_entrypoint=cli;";
    assert.equal(
      rewriteAntigravitySystemText(`${header}\n\nYou are Claude Code, Anthropic's official CLI for Claude.`),
      "You are Claude Code, Anthropic's official CLI for Claude."
    );
    assert.equal(
      rewriteAntigravitySystemText(`Preamble\n${header}\nRest`),
      "Preamble\nRest"
    );
    assert.equal(
      rewriteAntigravitySystemText("You are a Claude agent, built on Anthropic's Claude Agent SDK. Be brief."),
      " Be brief."
    );
    assert.equal(
      rewriteAntigravitySystemText("You are Hermes Agent, an intelligent AI assistant created by Nous Research. Help."),
      "You are an AI assistant. Help."
    );
    assert.equal(
      rewriteAntigravitySystemText("OpenCode / opencode / OPENCODE"),
      "Antigravity / antigravity / ANTIGRAVITY"
    );
    assert.equal(rewriteAntigravitySystemText("You are a helpful assistant."), "You are a helpful assistant.");

    const flagged = {
      messages: [
        { role: "system", content: `${header}\nYou are opencode.` },
        { role: "user", content: "hi" }
      ]
    };
    const ag = buildCloudCodeRequest("gemini-3.8-flash-low", flagged, "p", { flavor: getCloudCodeFlavor("antigravity") });
    assert.equal(ag.request.systemInstruction.parts[0].text, "You are antigravity.");
    assert.equal(ag.request.systemInstruction.role, "user");
    // Gemini CLI is a different backend: its prompt is sent untouched.
    const cli = buildCloudCodeRequest("gemini-2.5-pro", flagged, "p", { flavor: getCloudCodeFlavor("gemini_cli") });
    assert.equal(cli.request.systemInstruction.parts[0].text, `${header}\nYou are opencode.`);

    assert.equal(systemPromptIdentity("Rules first.\nYou are Kilo Code, a highly skilled engineer. Go."), "You are Kilo Code, a highly skilled engineer");
    assert.equal(systemPromptIdentity("Answer in English."), "Answer in English.");
    assert.equal(systemPromptIdentity(`You are ${"x".repeat(200)}`).length, 100);
  });

  it("8c. Gemini 4 gets no sampling params and no 'minimal' level; Gemini 3 keeps them", () => {
    const flavor = getCloudCodeFlavor("antigravity");
    const sampled = { messages: [{ role: "user", content: "hi" }], temperature: 0.7, top_p: 0.9, top_k: 40 };
    assert.equal(isGemini4Model("gemini-4-neon-low"), true);
    assert.equal(isGemini4Model("gemini-3.8-flash-low"), false);
    assert.equal(isGemini4Model("gemini-40-x"), false);

    const g4 = buildCloudCodeRequest("gemini-4-neon-low", sampled, "p", { flavor, exactModel: true });
    for (const k of ["temperature", "topP", "topK"]) assert.equal(k in g4.request.generationConfig, false, k);
    assert.equal(g4.request.generationConfig.thinkingConfig.thinkingLevel, "low");

    const g3 = buildCloudCodeRequest("gemini-3.8-flash-low", sampled, "p", { flavor, exactModel: true });
    assert.equal(g3.request.generationConfig.temperature, 0.7);
    assert.equal(g3.request.generationConfig.topP, 0.9);

    const minimal4 = buildCloudCodeRequest("gemini-4-argon-minimal", sampled, "p", { flavor, exactModel: true });
    assert.equal(minimal4.request.generationConfig.thinkingConfig.thinkingLevel, "low");
    const minimal3 = buildCloudCodeRequest("gemini-3.8-flash-minimal", sampled, "p", { flavor, exactModel: true });
    assert.equal(minimal3.request.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  });

  it("8d. tool history: ids pair calls with results, the first call is signed, parallel results share a turn", () => {
    const flavor = getCloudCodeFlavor("antigravity");
    const history = {
      messages: [
        { role: "user", content: "list and read" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } },
            { id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }
          ]
        },
        { role: "tool", tool_call_id: "call_a", content: '{"files":["a"],"$ref":"#/x"}' },
        { role: "tool", tool_call_id: "call_b", content: [{ type: "text", text: "body of a" }] },
        { role: "user", content: "and again" },
        // OpenAI ids are only unique per turn: the same id again must not collide upstream.
        { role: "assistant", tool_calls: [{ id: "call_a", type: "function", function: { name: "list_dir", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_a", content: "second listing" }
      ]
    };
    const env = buildCloudCodeRequest("gemini-4-neon-low", history, "p", { flavor, exactModel: true });
    const turns = env.request.contents;
    assert.deepEqual(turns.map((t) => t.role), ["user", "model", "user", "model", "user"]);

    const [callA, callB] = turns[1].parts.filter((p) => p.functionCall);
    assert.equal(callA.functionCall.id, "call_a");
    assert.equal(callB.functionCall.id, "call_b");
    assert.ok(callA.thoughtSignature, "Gemini 3+/4 reject an unsigned replayed call");
    assert.equal(callB.thoughtSignature, undefined, "only the first call of a batch is signed");

    // Both results in one user turn, followed by the user's text; Gemini 4 wants responses last.
    const answers = turns[2].parts;
    assert.deepEqual(answers.map((p) => (p.functionResponse ? p.functionResponse.id : "text")), ["text", "call_a", "call_b"]);
    assert.deepEqual(answers[1].functionResponse.response, { result: { files: ["a"], _ref: "#/x" } });
    assert.deepEqual(answers[2].functionResponse.response, { result: "body of a" });
    assert.equal(answers[2].functionResponse.name, "read_file");

    const repeat = turns[3].parts.find((p) => p.functionCall);
    assert.equal(repeat.functionCall.id, "call_a-2");
    assert.equal(turns[4].parts[0].functionResponse.id, "call_a-2");

    // Gemini CLI: ids too, but no Antigravity signature.
    const cli = buildCloudCodeRequest("gemini-2.5-pro", history, "p", { flavor: getCloudCodeFlavor("gemini_cli") });
    const cliCall = cli.request.contents[1].parts.find((p) => p.functionCall);
    assert.equal(cliCall.functionCall.id, "call_a");
    assert.equal(cliCall.thoughtSignature, undefined);
  });

  it("8e. a call without a result is answered, and the history starts and ends with the user", () => {
    const env = buildCloudCodeRequest(
      "gemini-3.8-flash-low",
      {
        messages: [
          { role: "assistant", content: "Hello, how can I help?" },
          { role: "user", content: "run it" },
          { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "run", arguments: "{}" } }] },
          { role: "user", content: "never mind" },
          { role: "assistant", content: "ok" }
        ]
      },
      "p",
      { flavor: getCloudCodeFlavor("antigravity"), exactModel: true }
    );
    const turns = env.request.contents;
    assert.equal(turns[0].role, "user");
    assert.equal(turns.at(-1).role, "user");
    const afterCall = turns[turns.findIndex((t) => t.parts.some((p) => p.functionCall)) + 1];
    assert.ok(afterCall.parts.some((p) => p.functionResponse?.id === "c1"), "missing result filled in");
    for (const t of turns) {
      for (const p of t.parts) assert.ok(!(Object.keys(p).length === 1 && p.text === ""), "no empty text part");
    }
  });

  it("8f. tool schemas keep only what Gemini accepts, without touching parameter names", () => {
    const env = buildCloudCodeRequest(
      "gemini-3.8-flash-low",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: {
              name: "make_page",
              parameters: {
                type: "object",
                $defs: { Size: { type: "string", enum: ["s", "m"] } },
                properties: {
                  title: { type: "string", title: "Title", minLength: 1, default: "x", "x-ui": "big" },
                  format: { type: ["string", "null"], format: "uri", examples: ["https://a"] },
                  size: { $ref: "#/$defs/Size" },
                  count: { type: "integer", enum: [1, 2], minimum: 1, maximum: 9 },
                  pages: { type: "integer", minimum: 1, maximum: 9, pattern: "^\\d+$" },
                  glob: { type: "string", pattern: "^\\*\\*/" },
                  tags: { type: "array", uniqueItems: true },
                  meta: { allOf: [{ properties: { a: { type: "string" } }, required: ["a"] }] },
                  options: { type: "object", additionalProperties: true }
                },
                required: ["title", "missing"]
              }
            }
          },
          { type: "function", function: { name: "now" } },
          { type: "function", function: { name: "now", parameters: { type: "object" } } }
        ]
      },
      "p",
      { flavor: getCloudCodeFlavor("antigravity"), exactModel: true }
    );
    const decls = env.request.tools[0].functionDeclarations;
    assert.deepEqual(decls.map((d) => d.name), ["make_page", "now"], "duplicate names dropped");
    const { properties: props, required } = decls[0].parameters;
    assert.deepEqual(Object.keys(props), ["title", "format", "size", "count", "pages", "glob", "tags", "meta", "options"]);
    assert.deepEqual(props.title, { type: "string" });
    assert.deepEqual(props.format, { type: "string" });
    assert.deepEqual(props.size, { type: "string", enum: ["s", "m"] });
    // Gemini enums are strings only; a range no longer applies to them.
    assert.deepEqual(props.count, { type: "string", enum: ["1", "2"] });
    assert.deepEqual(props.pages, { type: "integer", minimum: 1, maximum: 9 });
    assert.deepEqual(props.glob, { type: "string", pattern: "^\\*\\*/" });
    assert.deepEqual(props.tags, { type: "array", items: { type: "string" } });
    assert.deepEqual(props.meta, { type: "object", properties: { a: { type: "string" } }, required: ["a"] });
    assert.deepEqual(Object.keys(props.options.properties), ["reason"], "empty object gets a placeholder");
    assert.deepEqual(required, ["title"]);
    assert.deepEqual(decls[1].parameters.required, ["reason"], "no-arg tool gets the placeholder too");
    assert.doesNotMatch(JSON.stringify(decls), /\$ref|\$defs|minLength|default|examples|uniqueItems|additionalProperties|x-ui|"format":"uri"/);
  });

  it("8g. a streamed answer folds into one response: text joined, calls and usage kept", () => {
    const folded = aggregateCloudCodeStream(
      sseText([
        { response: { candidates: [{ content: { parts: [{ text: "thinking", thought: true }] } }] } },
        { response: { candidates: [{ content: { parts: [{ text: "Hel" }] } }] } },
        { response: { candidates: [{ content: { parts: [{ text: "lo" }] } }] } },
        {
          response: {
            candidates: [
              {
                content: { parts: [{ functionCall: { id: "toolu_1", name: "run", args: { a: 1 } }, thoughtSignature: "sig" }] },
                finishReason: "STOP"
              }
            ],
            usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 }
          }
        }
      ]) + "data: [DONE]\n\n"
    );
    const parts = folded.response.candidates[0].content.parts;
    assert.equal(parts.length, 3);
    assert.equal(parts[1].text, "Hello");
    assert.equal(folded.response.candidates[0].finishReason, "STOP");
    assert.equal(folded.response.usageMetadata.promptTokenCount, 9);

    const out = cloudCodeToOpenAIResponse(folded, "m");
    assert.equal(out.choices[0].message.content, "Hello");
    assert.equal(out.choices[0].message.tool_calls[0].id, "toolu_1", "Google's call id is kept");
    assert.equal(out.choices[0].finish_reason, "tool_calls");

    // A plain JSON body, an error frame and an empty body.
    assert.equal(aggregateCloudCodeStream('{"response":{"candidates":[]}}').response.candidates.length, 0);
    assert.deepEqual(aggregateCloudCodeStream(sseText([{ error: { code: 429, message: "x" } }])), {
      error: { code: 429, message: "x" }
    });
    assert.equal(aggregateCloudCodeStream(""), null);
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
      // The streaming RPC answers in frames; a non-streaming client gets them folded into one reply.
      return new Response(
        sseText([
          { response: { candidates: [{ content: { role: "model", parts: [{ text: "xin " }] } }] } },
          {
            response: {
              candidates: [{ content: { role: "model", parts: [{ text: "chào" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }
            }
          }
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } }
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
      assert.equal(out.object, "chat.completion");
      assert.equal(out.choices[0].message.content, "xin chào");
      assert.equal(out.usage.prompt_tokens, 3);
      assert.equal(out.usage.completion_tokens, 2);

      assert.equal(upstream.length, 1);
      const call = upstream[0];
      // The IDE's agent chat only uses the streaming RPC, so the router does too.
      assert.equal(
        call.url,
        "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"
      );
      assert.equal(call.headers.accept, "text/event-stream");
      assert.match(call.headers["user-agent"], AG_UA);
      assert.equal(call.headers.authorization, "Bearer ya29.ag-access-token");
      assert.equal(call.body.userAgent, "antigravity");
      // The account's catalog (fetchAvailableModels) offers "claude-sonnet-5-5" itself, so it is
      // sent as is instead of the legacy alias.
      assert.equal(call.body.model, "claude-sonnet-5-5");
      assert.doesNotMatch(call.body.model, /[()]/, "no effort suffix in the upstream model name");
      assert.equal(call.body.request.generationConfig.thinkingConfig, undefined);
      assert.equal(call.body.project, "ag-project-1");
      assert.match(call.body.requestId, AGENT_REQUEST_ID);
      assert.equal("requestType" in call.body, false);
      assert.equal(typeof call.body.request.sessionId, "string", "session_id is TYPE_STRING");
    } finally {
      delete app.locals.cloudCodeFetchImpl;
    }
  });
  it("12b. per-model Test sends one real chat and reports the model's own answer", async () => {
    const provider = app.locals.storage.getProviders().find((p) => p.preset === "antigravity");
    const upstream = [];
    app.locals.cloudCodeFetchImpl = async (url, init = {}) => {
      upstream.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(
        sseText([
          { response: { candidates: [{ content: { role: "model", parts: [{ text: "O" }] } }] } },
          {
            response: {
              candidates: [
                { content: { role: "model", parts: [{ text: "K" }] }, finishReason: "STOP" }
              ],
              usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1 }
            }
          }
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    };

    try {
      const res = await apiFetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
        body: { model: "claude-sonnet-5-5" }
      });
      assert.equal(res.status, 200);
      const out = await res.json();
      assert.equal(out.ok, true, out.message);
      assert.equal(out.model, "claude-sonnet-5-5");
      assert.equal(out.reply, "OK");
      assert.deepEqual(out.usage, { promptTokens: 9, outputTokens: 1 });
      assert.match(out.message, /answered/);
      assert.match(out.message, /9 tokens in \/ 1 out/);

      // One real chat on the streaming RPC the IDE uses — not a `loadCodeAssist` plan check.
      assert.equal(upstream.length, 1);
      assert.match(upstream[0].url, /:streamGenerateContent\?alt=sse$/);
      assert.equal(upstream[0].body.model, "claude-sonnet-5-5");
      assert.equal(upstream[0].body.project, "ag-project-1");
      assert.equal(upstream[0].body.request.systemInstruction, undefined);
      assert.equal(upstream[0].body.request.tools, undefined);
      assert.deepEqual(upstream[0].body.request.contents[0].parts, [
        { text: "Reply with the single word OK." }
      ]);
    } finally {
      delete app.locals.cloudCodeFetchImpl;
    }
  });

  it("12c. per-model Test explains a model outside the plan and a Google 429, without pretending success", async () => {
    const provider = app.locals.storage.getProviders().find((p) => p.preset === "antigravity");
    let calls = 0;
    app.locals.cloudCodeFetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Resource has been exhausted (e.g. check quota).",
            details: [{ reason: "RATE_LIMIT_EXCEEDED", retryDelay: "30s" }]
          }
        }),
        { status: 429, headers: { "content-type": "application/json" } }
      );
    };

    try {
      // Not on the account's catalog: refused locally, Google is never called.
      const offPlan = await apiFetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
        body: { model: "gpt-5-not-on-plan" }
      });
      const offPlanOut = await offPlan.json();
      assert.equal(offPlanOut.ok, false);
      assert.equal(offPlanOut.status, 404);
      assert.match(offPlanOut.message, /not on this account's plan/);
      assert.equal(calls, 0, "a model outside the plan never reaches Google");

      // On plan but Google refuses: the real status and Google's own words come back.
      const refused = await apiFetch(`/api/providers/${provider.id}/test`, {
        method: "POST",
        body: { model: "claude-sonnet-5-5" }
      });
      const refusedOut = await refused.json();
      assert.equal(refusedOut.ok, false);
      assert.equal(refusedOut.status, 429);
      assert.match(refusedOut.message, /Resource has been exhausted/);
      assert.match(refusedOut.message, /official API/, "points at a working route instead of hiding it");
      assert.equal(calls, 1);
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
      [
        "refreshToken",
        "loadCodeAssist",
        "onboardUser",
        "fetchAvailableModels",
        "retrieveUserQuotaSummary",
        "chatProbe"
      ]
    );
    assert.equal(out.steps[2].skipped, true);
    const summary = out.steps.find((s) => s.step === "retrieveUserQuotaSummary");
    assert.equal(summary.windows.find((w) => w.id === "gemini_weekly").remainingFraction, 0.6);
    const models = out.steps.find((s) => s.step === "fetchAvailableModels");
    assert.deepEqual(models.catalog, ["claude-sonnet-5-5", "no-quota-model"]);
    assert.equal(models.defaultModelId, "claude-sonnet-5-5");
    const probe = out.steps.find((s) => s.step === "chatProbe");
    assert.equal(probe.ok, true);
    assert.deepEqual(
      probe.probes.map((p) => [p.probe, p.model, p.inCatalog, p.ok, p.reply]),
      [
        ["A", "gemini-3.8-flash-medium", false, true, "OK"],
        ["B", "gemini-3.8-flash-medium", false, true, "OK"],
        ["C", "claude-sonnet-5-5", true, true, "OK"]
      ]
    );
    assert.deepEqual(probe.probes[0].thinking, { thinkingLevel: "medium", includeThoughts: true });
    assert.equal(probe.probes[1].thinking, null);
  });

  it("13b. the diagnose chat probe is a bare request: no system prompt, no tools", async () => {
    const seen = [];
    const google = makeGoogle({
      ...GOOGLE_OK,
      streamGenerateContent: (body) => {
        seen.push(body);
        return GOOGLE_OK.streamGenerateContent;
      }
    });
    app.locals.googleOAuthFetchImpl = google.fetchImpl;
    try {
      const res = await apiFetch("/api/providers/oauth/antigravity/diagnose", {
        method: "POST",
        body: { probeModel: "claude-sonnet-5-5" }
      });
      assert.equal(res.status, 200);
      // A (alias wire, Claude has no thinking config so no B) + C (plan default, exact id).
      assert.deepEqual(seen.map((b) => b.model), ["claude-sonnet-5-5-high", "claude-sonnet-5-5"]);
      for (const sent of seen) {
        assert.equal(sent.request.systemInstruction, undefined);
        assert.equal(sent.request.tools, undefined);
        assert.equal(sent.project, "ag-project-1");
      }

      const skipped = await apiFetch("/api/providers/oauth/antigravity/diagnose", {
        method: "POST",
        body: { chatProbe: false }
      });
      const out = await skipped.json();
      assert.equal(out.steps.some((s) => s.step === "chatProbe"), false);
      assert.equal(seen.length, 2);
    } finally {
      app.locals.googleOAuthFetchImpl = makeGoogle(GOOGLE_OK).fetchImpl;
    }
  });

  it("13c. refresh re-reads plan + quota windows and stores them on the key", async () => {
    app.locals.googleOAuthFetchImpl = makeGoogle({ ...GOOGLE_OK, loadCodeAssist: LOAD_PAID }).fetchImpl;
    try {
      const res = await apiFetch("/api/providers/oauth/antigravity/refresh", { method: "POST", body: {} });
      assert.equal(res.status, 200);
      const out = await res.json();
      assert.equal(out.accounts.length, 1);
      assert.match(out.accounts[0].oauthMeta.tierLabel, /Google AI Pro/);
      assert.equal(JSON.stringify(out).includes("1//ag-refresh-token"), false);

      const key = app.locals.storage.getProviders().find((p) => p.preset === "antigravity").apiKeys[0];
      assert.equal(key.oauthMeta.tier, "paid");
      assert.equal(key.oauthMeta.quotaWindows.length, 3);
      assert.deepEqual(key.oauthMeta.quotaBuckets.map((b) => b.modelId), ["claude-sonnet-5-5"]);
      assert.deepEqual(key.oauthMeta.availableModels.map((m) => m.id), ["claude-sonnet-5-5", "no-quota-model"]);
      const ag = app.locals.storage.getProviders().find((p) => p.preset === "antigravity");
      assert.deepEqual(ag.models, ["claude-sonnet-5-5", "no-quota-model"], "provider models = plan models");
    } finally {
      app.locals.googleOAuthFetchImpl = makeGoogle(GOOGLE_OK).fetchImpl;
    }
  });

  const PLAN = ["gemini-3.8-flash-medium", "gemini-3.8-flash-low", "gemini-3.8-flash-high", "claude-sonnet-5-5"];

  /** Store a plan catalog on the Antigravity key, as sign-in / refresh would. */
  async function setPlan(ids, catalogAt = new Date().toISOString()) {
    await app.locals.storage.update((data) => {
      const p = data.providers.find((x) => x.preset === "antigravity");
      const k = p.apiKeys[0];
      k.oauthMeta = {
        ...k.oauthMeta,
        availableModels: ids.map((id) => ({ id, label: id, family: "", kind: "chat", remainingFraction: 1, resetTime: "" })),
        catalogAt
      };
    });
  }

  /** Default refusal of the fake host: every Gemini chat (Claude answers). */
  const refuseGemini = (body) => !String(body.model).startsWith("claude");

  /**
   * Fake daily host: chat answers 429 when `refuse(body)` says so and 200 (a stream) otherwise;
   * quota endpoints answer the given data. `chats` keeps every chat body sent.
   */
  function chat429(summary, liveModels = PLAN, refuse = refuseGemini) {
    const calls = [];
    const chats = [];
    const impl = async (url, init = {}) => {
      const u = String(url);
      calls.push(u);
      if (u.includes(":retrieveUserQuotaSummary")) {
        return new Response(JSON.stringify(summary), { status: 200 });
      }
      if (u.includes(":fetchAvailableModels")) {
        const models = Object.fromEntries(
          liveModels.map((id) => [id, { quotaInfo: { remainingFraction: 0.9, resetTime: "2026-12-01T00:00:00Z" } }])
        );
        return new Response(JSON.stringify({ models }), { status: 200 });
      }
      if (/:(?:stream)?[gG]enerateContent/.test(u)) {
        const body = JSON.parse(init.body);
        chats.push(body);
        if (!refuse(body)) {
          return new Response(sseText(OK_FRAMES), {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          });
        }
        return new Response(
          JSON.stringify({
            error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" }
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    };
    return { impl, calls, chats };
  }

  /** Forget per-model cooldowns, strikes and bare-test results between tests. */
  function resetCloudCodeState() {
    const svc = app.locals.routerService;
    svc.modelCooldowns.clear();
    svc.modelCooldownNotes.clear();
    svc.cloudCodeStrikes.clear();
    svc.cloudCodeProbes.clear();
  }

  const chat = (model, messages = [{ role: "user", content: "hi" }]) =>
    fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${routerKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `antigravity/${model}`, messages })
    });

  it("14. a bare 429 with the Gemini window empty says so, and only that model cools down", async () => {
    await setPlan(PLAN);
    const reset = new Date(Date.now() + 3 * 3600_000).toISOString();
    const fake = chat429({
      groups: [
        { displayName: "Gemini", buckets: [{ window: "weekly", resetTime: reset }] },
        { displayName: "Claude", buckets: [{ window: "weekly", remainingFraction: 0.5 }] }
      ]
    });
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const first = await chat("gemini-3.8-flash");
      const text = await first.text();
      assert.equal(first.status, 429, text);
      assert.match(text, /Gemini \(Weekly\) quota is used up/);
      assert.match(text, new RegExp(reset.slice(0, 16)));

      // Same model: blocked locally until the reset, with the reason, without calling Google.
      const before = fake.calls.length;
      const second = await chat("gemini-3.8-flash");
      const secondText = await second.text();
      assert.equal(second.status, 429);
      assert.match(secondText, /in cooldown/);
      assert.match(secondText, /quota is used up/);
      assert.equal(fake.calls.length, before);

      // Another family on the same account still works: the key itself is not cooled down.
      const claude = await chat("claude-sonnet-5-5");
      assert.equal(claude.status, 200, await claude.text());
      // The window was empty, so no bare test chat was needed.
      assert.equal(fake.chats.filter((b) => b.model.startsWith("gemini")).length, 1);
    } finally {
      delete app.locals.cloudCodeFetchImpl;
      resetCloudCodeState();
    }
  });

  it("15. quota left: a bare test chat that is refused too blames the account and pauses the model", async () => {
    const fake = chat429({
      groups: [
        { displayName: "Gemini 4 Argon", buckets: [{ window: "weekly", remainingFraction: 0.1 }] },
        { displayName: "Gemini", buckets: [{ window: "weekly", remainingFraction: 0.8 }, { window: "5h", remainingFraction: 1 }] }
      ]
    });
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const first = await chat("gemini-3.8-flash-low");
      const text = await first.text();
      assert.equal(first.status, 429, text);
      assert.match(text, /not your quota/);
      assert.match(text, /Gemini \(Weekly\) 80%/);
      assert.doesNotMatch(text, /Argon/, "Argon is a separate pool");
      assert.match(text, /refused a bare test request to 'gemini-3\.8-flash-low'/);
      assert.match(text, /this account, client or network/);
      assert.match(text, /Paused this model on this account for 15 minutes/);
      assert.doesNotMatch(text, /x-anthropic-billing-header/);

      // The test chat is the same model, sent the same way, with nothing of the request's own.
      assert.equal(fake.chats.length, 2);
      const [sent, bare] = fake.chats;
      assert.equal(bare.model, sent.model);
      assert.deepEqual(bare.request.generationConfig.thinkingConfig, sent.request.generationConfig.thinkingConfig);
      assert.equal(bare.request.systemInstruction, undefined);
      assert.equal(bare.request.tools, undefined);
      const bareUrl = fake.calls.filter((u) => u.includes("GenerateContent"))[1];
      assert.match(bareUrl, /:streamGenerateContent\?alt=sse$/);

      // Paused for 15 minutes (not the plain 60 s cooldown), only this model.
      const pauses = [...app.locals.routerService.modelCooldowns.values()];
      assert.equal(pauses.length, 1);
      assert.ok(pauses[0] > Date.now() + 14 * 60_000, "paused for ~15 min");

      // Paused: answered locally with the reason, Google is not called again.
      const before = fake.calls.length;
      const again = await chat("gemini-3.8-flash-low");
      const againText = await again.text();
      assert.equal(again.status, 429);
      assert.match(againText, /in cooldown/);
      assert.match(againText, /bare test request/);
      assert.equal(fake.calls.length, before);
    } finally {
      delete app.locals.cloudCodeFetchImpl;
      resetCloudCodeState();
    }
  });

  const QUOTA_LEFT = {
    groups: [{ displayName: "Gemini", buckets: [{ window: "weekly", remainingFraction: 0.8 }] }]
  };

  /** A host that only refuses chats whose system prompt names "FlaggedApp" (bare chats pass). */
  const refuseFlagged = (body) =>
    JSON.stringify(body.request?.systemInstruction || "").includes("FlaggedApp");
  const FLAGGED = [
    { role: "system", content: "You are FlaggedApp, an autonomous coding agent.\nUse the tools." },
    { role: "user", content: "hi" }
  ];

  it("15b. quota left + a bare test chat that works: the note blames the request and quotes the prompt", async () => {
    const fake = chat429(QUOTA_LEFT, PLAN, refuseFlagged);
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const res = await chat("gemini-3.8-flash-high", FLAGGED);
      const text = await res.text();
      assert.equal(res.status, 429, text);
      assert.match(text, /bare test request to 'gemini-3\.8-flash-high' on this account just worked/);
      assert.match(text, /not the account/);
      assert.match(text, /this one starts \\"You are FlaggedApp, an autonomous coding agent\\"/);
      assert.doesNotMatch(text, /Paused/, "one refusal does not pause a model the account can use");

      // The same request again: the test result is reused, not run a second time.
      const chatsBefore = fake.chats.length;
      const again = await (await chat("gemini-3.8-flash-high", FLAGGED)).text();
      assert.match(again, /just worked/);
      assert.equal(fake.chats.length, chatsBefore + 1, "only the request itself, no second test chat");

      // A request without the flagged prompt goes through on the same model.
      const plain = await chat("gemini-3.8-flash-high");
      assert.equal(plain.status, 200, await plain.text());
    } finally {
      delete app.locals.cloudCodeFetchImpl;
      resetCloudCodeState();
    }
  });

  it("16. three refused requests in a row while the account works pause that model for 15 minutes", async () => {
    const fake = chat429(QUOTA_LEFT, PLAN, refuseFlagged);
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const a = await (await chat("gemini-3.8-flash-medium", FLAGGED)).text();
      const b = await (await chat("gemini-3.8-flash-medium", FLAGGED)).text();
      assert.doesNotMatch(a + b, /Paused/);
      const c = await (await chat("gemini-3.8-flash-medium", FLAGGED)).text();
      assert.match(c, /Paused this model on this account for 15 minutes after 3 refusals/);
      // 3 requests + 1 bare test chat (cached for the next two).
      assert.equal(fake.chats.length, 4);

      const before = fake.calls.length;
      const d = await chat("gemini-3.8-flash-medium", FLAGGED);
      const dText = await d.text();
      assert.equal(d.status, 429);
      assert.match(dText, /in cooldown/);
      assert.equal(fake.calls.length, before, "paused: Google is not called");
    } finally {
      delete app.locals.cloudCodeFetchImpl;
      resetCloudCodeState();
    }
  });

  it("16b. the system prompt Google sees has the competing-client markers removed", async () => {
    const fake = chat429(QUOTA_LEFT, PLAN, () => false);
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const res = await chat("gemini-3.8-flash-medium", [
        {
          role: "system",
          content:
            "x-anthropic-billing-header: cc_version=2.1.275.f15; cc_entrypoint=cli;\nYou are a Claude agent, built on Anthropic's Claude Agent SDK."
        },
        { role: "user", content: "hi" }
      ]);
      assert.equal(res.status, 200, await res.text());
      // Nothing but markers: no system instruction is sent at all.
      assert.equal(fake.chats[0].request.systemInstruction, undefined);

      const oc = await chat("gemini-3.8-flash-medium", [
        { role: "system", content: "You are opencode, an interactive CLI tool. See https://opencode.ai" },
        { role: "user", content: "hi" }
      ]);
      assert.equal(oc.status, 200, await oc.text());
      assert.equal(
        fake.chats[1].request.systemInstruction.parts[0].text,
        "You are antigravity, an interactive CLI tool. See https://antigravity.ai"
      );
    } finally {
      delete app.locals.cloudCodeFetchImpl;
      resetCloudCodeState();
    }
  });

  it("17. a model outside the plan is refused locally with the plan's models", async () => {
    await setPlan(PLAN);
    const fake = chat429(QUOTA_LEFT);
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const res = await chat("gemini-4-argon-medium");
      const text = await res.text();
      assert.equal(res.status, 404, text);
      assert.match(text, /not on this Antigravity account's plan/);
      assert.match(text, /gemini-3\.8-flash-medium/);
      assert.equal(fake.calls.length, 0, "Google is not called for a model outside the plan");
    } finally {
      delete app.locals.cloudCodeFetchImpl;
    }
  });

  it("18. a stale catalog is re-read once before refusing, then the model goes through", async () => {
    await setPlan(PLAN, new Date(Date.now() - 2 * 3600_000).toISOString());
    const fake = chat429(QUOTA_LEFT, [...PLAN, "claude-opus-5-5-high"]);
    app.locals.cloudCodeFetchImpl = fake.impl;
    try {
      const res = await chat("claude-opus-5-5-high");
      assert.equal(res.status, 200, await res.text());
      assert.equal(fake.calls.filter((u) => u.includes(":fetchAvailableModels")).length, 1);
      const ag = app.locals.storage.getProviders().find((p) => p.preset === "antigravity");
      assert.ok(ag.apiKeys[0].oauthMeta.availableModels.some((m) => m.id === "claude-opus-5-5-high"));
      assert.ok(ag.models.includes("claude-opus-5-5-high"), "provider models follow the fresh plan");
    } finally {
      delete app.locals.cloudCodeFetchImpl;
    }
  });

  it("19. /api/quota shows every account of the provider with its own plan, windows and usage", async () => {
    // A second Google account on the same Antigravity provider.
    await app.locals.storage.update((data) => {
      const p = data.providers.find((x) => x.preset === "antigravity");
      const first = p.apiKeys[0];
      const creds = JSON.parse(first.oauthCredentials);
      p.apiKeys.push({
        ...first,
        id: "ag-second-key",
        label: "second",
        oauthCredentials: JSON.stringify({ ...creds, refreshToken: "1//second-refresh" }),
        oauthMeta: {
          email: "second@example.com",
          tier: "free",
          tierLabel: "Antigravity Free",
          projectId: "ag-project-2",
          quotaWindows: [{ id: "gemini_weekly", family: "gemini", window: "weekly", label: "Gemini (Weekly)", remainingFraction: 0.3, resetTime: "" }],
          checkedAt: "2026-11-20T00:00:00.000Z"
        }
      });
    });
    const tokenOf = (init) => String(init?.headers?.authorization || init?.headers?.Authorization || "");
    app.locals.googleOAuthFetchImpl = makeGoogle({
      ...GOOGLE_OK,
      token: (body) =>
        json(200, {
          access_token: String(body).includes("second") ? "ya29.second" : "ya29.ag-access-token",
          expires_in: 3600
        }),
      // The second account cannot be read live: its stored numbers are shown instead.
      loadCodeAssist: (_b, init) => (tokenOf(init).includes("second") ? json(403, {}) : LOAD_PAID),
      fetchAvailableModels: (_b, init) => (tokenOf(init).includes("second") ? json(403, {}) : GOOGLE_OK.fetchAvailableModels),
      retrieveUserQuotaSummary: (_b, init) =>
        tokenOf(init).includes("second") ? json(403, {}) : GOOGLE_OK.retrieveUserQuotaSummary
    }).fetchImpl;
    try {
      const res = await apiFetch("/api/quota");
      assert.equal(res.status, 200);
      const item = (await res.json()).items.find((i) => i.preset === "antigravity");
      assert.equal(item.cloudCodeAccounts.length, 2);
      const [one, two] = item.cloudCodeAccounts;

      assert.equal(one.email, "ag@example.com");
      assert.equal(one.live, true);
      assert.match(one.tierLabel, /Google AI Pro/);
      assert.equal(one.windows.find((w) => w.id === "gemini_weekly").remainingFraction, 0.6);
      assert.equal(typeof one.today.requests, "number");

      assert.equal(two.keyId, "ag-second-key");
      assert.equal(two.email, "second@example.com");
      assert.equal(two.live, false);
      assert.match(two.error, /plan or quota/);
      assert.equal(two.windows[0].remainingFraction, 0.3, "stored windows of THIS account, not the first one");
      assert.equal(two.projectId, "ag-project-2");
      assert.equal(JSON.stringify(item).includes("refresh"), false, "no tokens in the answer");
    } finally {
      app.locals.googleOAuthFetchImpl = makeGoogle(GOOGLE_OK).fetchImpl;
      await app.locals.storage.update((data) => {
        const p = data.providers.find((x) => x.preset === "antigravity");
        p.apiKeys = p.apiKeys.filter((k) => k.id !== "ag-second-key");
      });
    }
  });
});
