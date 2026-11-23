import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { buildUpstreamHeaders, sanitizeUpstreamPayload } from "../server/router.js";
import { normalizeBaseUrl } from "../server/presets.js";
import { createMockUpstream } from "./mock-upstream.js";

function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

describe("001Router v2.0 — 9Router Full Parity Suite", () => {
  let tmpDir;
  let webDistDir;
  let mock;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;
  let textProvider;
  let visionProvider;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-v2-"));
    webDistDir = path.join(tmpDir, "web-dist");
    await fs.mkdir(webDistDir, { recursive: true });
    await fs.writeFile(path.join(webDistDir, "index.html"), "<html>001Router</html>", "utf8");

    mock = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128, webDistDir });
    // Allow loopback upstream mock servers in test environment
    await app.locals.storage.update((data) => {
      data.settings.allowPrivateUpstreams = true;
    });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(loginRes.status, 200);
    sessionCookie = extractCookie(loginRes);

    // Create a primary router key for /v1/* tests
    const keyRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "Parity Master Key" }
    });
    assert.equal(keyRes.status, 201);
    routerKey = (await keyRes.json()).key.key;

    // Seed two mock OpenAI-compatible providers
    const p1Res = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Text Only Provider",
        slug: "text-only",
        baseUrl: `${mock.baseUrl}/openai/v1`,
        formatType: "openai",
        apiKeys: [{ label: "k1", key: "sk-mock-text-1", enabled: true }],
        models: ["deepseek-chat", "llama-3.3-70b"],
        enabled: true
      }
    });
    assert.equal(p1Res.status, 201);
    textProvider = (await p1Res.json()).provider;

    const p2Res = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Vision Provider",
        slug: "vision-prov",
        baseUrl: `${mock.baseUrl}/openai/v1`,
        formatType: "openai",
        apiKeys: [{ label: "k1", key: "sk-mock-vis-1", enabled: true }],
        models: ["gpt-4o", "gemini-2.5-flash"],
        enabled: true
      }
    });
    assert.equal(p2Res.status, 201);
    visionProvider = (await p2Res.json()).provider;
  });

  after(async () => {
    server?.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await mock.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mock.reset();
  });

  async function apiFetch(urlPath, opts = {}) {
    const headers = {
      "x-requested-with": "001router",
      ...(opts.headers || {})
    };
    if (sessionCookie) headers.cookie = sessionCookie;
    if (opts.body && typeof opts.body !== "string") {
      headers["content-type"] = "application/json";
    }
    return fetch(`${baseUrl}${urlPath}`, {
      ...opts,
      headers,
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
    });
  }

  async function v1Fetch(urlPath, opts = {}, key = routerKey) {
    const headers = {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(opts.headers || {})
    };
    if (opts.body && typeof opts.body !== "string") {
      headers["content-type"] = "application/json";
    }
    return fetch(`${baseUrl}${urlPath}`, {
      ...opts,
      headers,
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
    });
  }

  it("1. runs 12-filter RTK auto-detection on git-diff, git-status, git-log, grep, find, ls, build-output", async () => {
    const samples = [
      {
        expected: "git-diff",
        text: [
          "diff --git a/src/server/router.js b/src/server/router.js",
          "index 1111111..2222222 100644",
          "--- a/src/server/router.js",
          "+++ b/src/server/router.js",
          "@@ -1,18 +1,22 @@",
          " const configLine1 = 'default-router-configuration-value-one';",
          " const configLine2 = 'default-router-configuration-value-two';",
          " const configLine3 = 'default-router-configuration-value-three';",
          " const configLine4 = 'default-router-configuration-value-four';",
          " const configLine5 = 'default-router-configuration-value-five';",
          "+const addedLine1 = 'new-rtk-auto-detect-filter-enabled';",
          "+const addedLine2 = 'new-ponytail-and-headroom-support';",
          " const configLine6 = 'default-router-configuration-value-six';",
          " const configLine7 = 'default-router-configuration-value-seven';",
          " const configLine8 = 'default-router-configuration-value-eight';"
        ].join("\n")
      },
      {
        expected: "git-status",
        text: [
          "On branch main",
          "Your branch is up to date with 'origin/main'.",
          "",
          "Changes not staged for commit:",
          "  (use \"git add <file>...\" to update what will be committed)",
          "  (use \"git restore <file>...\" to discard changes in working directory)",
          "\tmodified:   src/server/router.js",
          "\tmodified:   src/server/tokenSaver.js",
          "\tmodified:   src/server/storage.js",
          "\tmodified:   src/server/routes/dashboard.js",
          "Untracked files:",
          "  (use \"git add <file>...\" to include in what will be committed)",
          "\tsrc/server/rtkFilters.js",
          "\tsrc/server/pricing.js",
          "\tsrc/server/liveEvents.js"
        ].join("\n")
      },
      {
        expected: "grep",
        text: Array.from(
          { length: 14 },
          (_, i) =>
            `src/server/very/deeply/nested/modules/routerService.js:${(i + 1) * 10}:const matchLine${i} = applyRtkStructuredFilter(payload);`
        ).join("\n")
      },
      {
        expected: "ls",
        text: [
          "total 96",
          "drwxr-xr-x 2 developer staff 4096 Nov 22 10:00 src",
          "drwxr-xr-x 2 developer staff 4096 Nov 22 10:00 node_modules",
          "drwxr-xr-x 2 developer staff 4096 Nov 22 10:00 dist",
          "-rw-r--r-- 1 developer staff 1204 Nov 22 10:00 package.json",
          "-rw-r--r-- 1 developer staff 8421 Nov 22 10:00 README.md",
          "-rw-r--r-- 1 developer staff  512 Nov 22 10:00 .gitignore",
          "-rw-r--r-- 1 developer staff 2048 Nov 22 10:00 vite.config.js",
          "-rw-r--r-- 1 developer staff 4096 Nov 22 10:00 index.html"
        ].join("\n")
      }
    ];

    for (const s of samples) {
      const res = await apiFetch("/api/token-saver/test", {
        method: "POST",
        body: { text: s.text, maxChars: 10000 }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.filter, s.expected, `Expected filter ${s.expected}, got ${data.filter}`);
      assert.ok(Array.isArray(data.filters) && data.filters.length >= 12);
    }
  });

  it("2. injects Ponytail + Wenyan Caveman + Custom Global Prompt and honors X-9Router-Token-Saver: off", async () => {
    const upd = await apiFetch("/api/settings", {
      method: "PUT",
      body: {
        cavemanEnabled: true,
        cavemanLevel: "wenyan",
        ponytailEnabled: true,
        ponytailLevel: "full",
        customPromptEnabled: true,
        customPrompt: "ALWAYS_INCLUDE_CUSTOM_MARKER_XYZ"
      }
    });
    assert.equal(upd.status, 200);

    // Normal request -> all 3 directives injected
    const res1 = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      body: {
        model: "text-only/deepseek-chat",
        messages: [{ role: "user", content: "Hello" }]
      }
    });
    assert.equal(res1.status, 200);
    assert.equal(mock.requests.length, 1);
    const sys1 = mock.requests[0].body.messages.find((m) => m.role === "system")?.content || "";
    assert.match(sys1, /ALWAYS_INCLUDE_CUSTOM_MARKER_XYZ/);
    assert.match(sys1, /YAGNI|simplest|minimum|Ponytail|Lazy/i);
    assert.match(sys1, /文言|Classical Chinese|Wenyan/i);

    // Bypassed request -> none injected
    mock.reset();
    const res2 = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "X-9Router-Token-Saver": "off" },
      body: {
        model: "text-only/deepseek-chat",
        messages: [{ role: "user", content: "Hello untouched" }]
      }
    });
    assert.equal(res2.status, 200);
    assert.equal(mock.requests.length, 1);
    const sys2 = mock.requests[0].body.messages.find((m) => m.role === "system");
    assert.equal(sys2, undefined, "System prompt should not be injected when bypassed");

    // Reset prompt toggles
    await apiFetch("/api/settings", {
      method: "PUT",
      body: {
        cavemanEnabled: false,
        ponytailEnabled: false,
        customPromptEnabled: false,
        customPrompt: ""
      }
    });
  });

  it("3. supports Headroom external proxy compression and fails open when Headroom is unreachable", async () => {
    let compressCalls = 0;
    const hrServer = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.url === "/v1/compress" && req.method === "POST") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          compressCalls += 1;
          const parsed = JSON.parse(raw || "{}");
          const msgs = Array.isArray(parsed.messages)
            ? parsed.messages.map((m) => ({
                ...m,
                content: typeof m.content === "string" ? "HEADROOM_COMPRESSED" : m.content
              }))
            : [];
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ messages: msgs }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => hrServer.listen(0, "127.0.0.1", resolve));
    const hrPort = hrServer.address().port;
    const hrUrl = `http://127.0.0.1:${hrPort}`;

    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: { headroomEnabled: true, headroomUrl: hrUrl, headroomTimeoutMs: 2000 }
      });

      const statusRes = await apiFetch(`/api/headroom/status?url=${encodeURIComponent(hrUrl)}`);
      assert.equal(statusRes.status, 200);
      const statusJson = await statusRes.json();
      assert.equal(statusJson.online, true);

      const chat1 = await v1Fetch("/v1/chat/completions", {
        method: "POST",
        body: {
          model: "text-only/deepseek-chat",
          messages: [{ role: "user", content: "Long verbose text ".repeat(30) }]
        }
      });
      assert.equal(chat1.status, 200);
      assert.ok(compressCalls >= 1);
      assert.equal(mock.requests[0].body.messages[0].content, "HEADROOM_COMPRESSED");

      // Shut down Headroom -> verify fail-open keeps routing working
      hrServer.closeAllConnections?.();
      await new Promise((resolve) => hrServer.close(resolve));
      mock.reset();

      const chat2 = await v1Fetch("/v1/chat/completions", {
        method: "POST",
        body: {
          model: "text-only/deepseek-chat",
          messages: [{ role: "user", content: "Still works when Headroom is down" }]
        }
      });
      assert.equal(chat2.status, 200);
      assert.equal(mock.requests[0].body.messages[0].content, "Still works when Headroom is down");
    } finally {
      hrServer.closeAllConnections?.();
      if (hrServer.listening) {
        await new Promise((resolve) => hrServer.close(resolve));
      }
      await apiFetch("/api/settings", { method: "PUT", body: { headroomEnabled: false } });
    }
  });

  it("4. Capacity Adapter automatically re-routes vision requests to configured vision model", async () => {
    const upd = await apiFetch("/api/settings", {
      method: "PUT",
      body: {
        capacityAdapter: {
          vision: { enabled: true, roundRobin: false, models: ["vision-prov/gpt-4o"] },
          audioInput: { enabled: false, roundRobin: false, models: [] }
        }
      }
    });
    assert.equal(upd.status, 200);

    const res = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      body: {
        model: "text-only/deepseek-chat",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this picture?" },
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }
            ]
          }
        ]
      }
    });
    assert.equal(res.status, 200);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].body.model, "gpt-4o");
    assert.equal(mock.requests[0].headers.authorization, "Bearer sk-mock-vis-1");

    await apiFetch("/api/settings", {
      method: "PUT",
      body: {
        capacityAdapter: {
          vision: { enabled: false, roundRobin: false, models: [] },
          audioInput: { enabled: false, roundRobin: false, models: [] }
        }
      }
    });
  });

  it("5. resolves Model Aliases and hides/blocks Disabled Models", async () => {
    const putAlias = await apiFetch("/api/models/alias", {
      method: "PUT",
      body: { alias: "my-fast", model: "vision-prov/gpt-4o" }
    });
    assert.equal(putAlias.status, 200);

    const modelsRes1 = await v1Fetch("/v1/models");
    const modelsJson1 = await modelsRes1.json();
    assert.ok(modelsJson1.data.some((m) => m.id === "my-fast"));

    const chatAlias = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      body: { model: "my-fast", messages: [{ role: "user", content: "hi" }] }
    });
    assert.equal(chatAlias.status, 200);
    assert.equal(mock.requests[0].body.model, "gpt-4o");

    // Disable gpt-4o on vision-prov
    const disRes = await apiFetch("/api/models/disabled", {
      method: "POST",
      body: { provider: "vision-prov", ids: ["gpt-4o"] }
    });
    assert.equal(disRes.status, 200);

    const modelsRes2 = await v1Fetch("/v1/models");
    const modelsJson2 = await modelsRes2.json();
    assert.ok(!modelsJson2.data.some((m) => m.id === "vision-prov/gpt-4o"));

    // Direct call to disabled model returns 404/403/502 error (cannot route)
    const blockedRes = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      body: { model: "vision-prov/gpt-4o", messages: [{ role: "user", content: "blocked" }] }
    });
    assert.ok(blockedRes.status >= 400);

    // Re-enable and clean up alias
    await apiFetch("/api/models/disabled?provider=vision-prov&id=gpt-4o", { method: "DELETE" });
    await apiFetch("/api/models/alias?alias=my-fast", { method: "DELETE" });
  });

  it("6. enforces Per-Key Access Controls (403 on disallowed models, 200 on allowed)", async () => {
    const kRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "Scoped Key" }
    });
    const created = (await kRes.json()).key;

    const patchRes = await apiFetch(`/api/keys/${created.id}`, {
      method: "PATCH",
      body: {
        access: { restricted: true, allow: ["text-only/deepseek-chat"] }
      }
    });
    assert.equal(patchRes.status, 200);
    const patched = (await patchRes.json()).key;
    assert.equal(patched.access.restricted, true);
    assert.deepEqual(patched.access.allow, ["text-only/deepseek-chat"]);

    // Disallowed model -> 403
    const denied = await v1Fetch(
      "/v1/chat/completions",
      {
        method: "POST",
        body: { model: "vision-prov/gpt-4o", messages: [{ role: "user", content: "deny" }] }
      },
      created.key
    );
    assert.equal(denied.status, 403);

    // Allowed model -> 200
    const allowed = await v1Fetch(
      "/v1/chat/completions",
      {
        method: "POST",
        body: { model: "text-only/deepseek-chat", messages: [{ role: "user", content: "allow" }] }
      },
      created.key
    );
    assert.equal(allowed.status, 200);

    // /v1/models filtered for scoped key
    const scopedModels = await (await v1Fetch("/v1/models", {}, created.key)).json();
    assert.ok(scopedModels.data.every((m) => m.id === "text-only/deepseek-chat"));
  });

  it("7. computes custom pricing costs and exposes enhanced /api/usage?range=today breakdowns", async () => {
    const putPrice = await apiFetch("/api/pricing", {
      method: "PUT",
      body: {
        provider: "text-only",
        model: "deepseek-chat",
        rate: { input: 10, output: 30, cached: 1, reasoning: 30 }
      }
    });
    assert.equal(putPrice.status, 200);

    const chatRes = await v1Fetch("/v1/chat/completions", {
      method: "POST",
      body: { model: "text-only/deepseek-chat", messages: [{ role: "user", content: "cost test" }] }
    });
    assert.equal(chatRes.status, 200);

    const usageRes = await apiFetch("/api/usage?range=today");
    assert.equal(usageRes.status, 200);
    const usage = await usageRes.json();
    assert.equal(usage.range, "today");
    assert.ok(usage.summary.totalCost > 0, "Expected non-zero totalCost");
    assert.ok(Array.isArray(usage.byKey) && usage.byKey.length > 0);
    assert.ok(Array.isArray(usage.byEndpoint) && usage.byEndpoint.length > 0);

    const delPrice = await apiFetch(
      "/api/pricing?provider=text-only&model=deepseek-chat",
      { method: "DELETE" }
    );
    assert.equal(delPrice.status, 200);
  });

  it("8. serves Skills, Provider Details, Combo reorder/bulk-delete, Console Logs, and Gemini/Ollama/Compact/Voices endpoints", async () => {
    // Public Skills API
    const skillsRes = await fetch(`${baseUrl}/api/skills`);
    assert.equal(skillsRes.status, 200);
    const skillsJson = await skillsRes.json();
    assert.ok(skillsJson.skills.length >= 8);

    const mdRes = await fetch(`${baseUrl}/api/skills/001router/SKILL.md`);
    assert.equal(mdRes.status, 200);
    const mdText = await mdRes.text();
    assert.match(mdText, /001Router/i);
    assert.match(mdText, /\/v1\/chat\/completions/);

    // Provider detail + custom model + reset cooldown
    const detailRes = await apiFetch(`/api/providers/${textProvider.id}`);
    assert.equal(detailRes.status, 200);
    const addM = await apiFetch(`/api/providers/${textProvider.id}/custom-models`, {
      method: "POST",
      body: { modelId: "custom-v2-model" }
    });
    assert.equal(addM.status, 201);
    assert.ok((await addM.json()).provider.models.includes("custom-v2-model"));

    const delM = await apiFetch(
      `/api/providers/${textProvider.id}/custom-models/custom-v2-model`,
      { method: "DELETE" }
    );
    assert.equal(delM.status, 200);
    assert.ok(!(await delM.json()).provider.models.includes("custom-v2-model"));

    const resetCd = await apiFetch(`/api/providers/${textProvider.id}/reset-cooldown`, {
      method: "POST",
      body: {}
    });
    assert.equal(resetCd.status, 200);

    // Combos reorder + bulk-delete
    const c1 = (
      await (
        await apiFetch("/api/combos", {
          method: "POST",
          body: { name: "combo-a", targets: ["text-only/deepseek-chat"] }
        })
      ).json()
    ).combo;
    const c2 = (
      await (
        await apiFetch("/api/combos", {
          method: "POST",
          body: { name: "combo-b", targets: ["vision-prov/gpt-4o"] }
        })
      ).json()
    ).combo;

    const reord = await apiFetch("/api/combos/reorder", {
      method: "POST",
      body: { ids: [c2.id, c1.id] }
    });
    assert.equal(reord.status, 200);
    assert.equal((await reord.json()).combos[0].id, c2.id);

    const bdel = await apiFetch("/api/combos/bulk-delete", {
      method: "POST",
      body: { ids: [c1.id, c2.id] }
    });
    assert.equal(bdel.status, 200);
    assert.equal((await bdel.json()).deletedCount, 2);

    // Console Logs
    const clRes = await apiFetch("/api/console-logs");
    assert.equal(clRes.status, 200);
    assert.ok(Array.isArray((await clRes.json()).logs));

    // Expanded /v1 & /v1beta endpoints
    const infoRes = await v1Fetch("/v1/models/info");
    assert.equal(infoRes.status, 200);
    const infoJson = await infoRes.json();
    assert.ok(Array.isArray(infoJson.models) || Array.isArray(infoJson.data));

    const voicesRes = await v1Fetch("/v1/audio/voices");
    assert.equal(voicesRes.status, 200);
    const voicesJson = await voicesRes.json();
    assert.ok(
      Array.isArray(voicesJson.voices) ||
        (voicesJson.voices && Array.isArray(voicesJson.voices.openai))
    );

    const compactRes = await v1Fetch("/v1/responses/compact", {
      method: "POST",
      body: {
        input: [
          { role: "user", content: "line\nline\nline\nline\nline\nline" }
        ]
      }
    });
    assert.equal(compactRes.status, 200);

    const tagsRes = await v1Fetch("/v1/api/tags");
    assert.equal(tagsRes.status, 200);
    assert.ok(Array.isArray((await tagsRes.json()).models));

    const gemList = await v1Fetch("/v1beta/models");
    assert.equal(gemList.status, 200);
    assert.ok(Array.isArray((await gemList.json()).models));

    const gemGen = await v1Fetch("/v1beta/models/text-only/deepseek-chat:generateContent", {
      method: "POST",
      body: {
        contents: [{ role: "user", parts: [{ text: "Hello Gemini format" }] }]
      }
    });
    assert.equal(gemGen.status, 200);
    const gemJson = await gemGen.json();
    assert.ok(Array.isArray(gemJson.candidates) && gemJson.candidates.length > 0);
  });

  it("9. sanitizes Cline/OpenRouter/OpenAI payloads across Gemini, OpenAI o3/gpt-5, Mistral, and Groq", () => {
    const clinePayload = {
      model: "gemini-2.5-flash",
      messages: [
        { role: "developer", content: [{ type: "text", text: "Sys 1", cache_control: { type: "ephemeral" } }] },
        { role: "system", content: "Sys 2" },
        { role: "user", content: [{ type: "text", text: "Hi", cache_control: { type: "ephemeral" } }] },
        { role: "assistant", content: null }
      ],
      max_completion_tokens: 2048,
      stream: false,
      stream_options: { include_usage: true },
      frequency_penalty: 0.2,
      store: true,
      transforms: ["middle-out"],
      tools: [],
      tool_choice: "auto"
    };

    // Gemini OpenAI-compat
    const gemOut = sanitizeUpstreamPayload(
      clinePayload,
      { preset: "gemini", formatType: "gemini-openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
      "gemini-2.5-flash"
    );
    assert.equal(gemOut.max_tokens, 2048);
    assert.equal(gemOut.max_completion_tokens, undefined);
    assert.equal(gemOut.stream_options, undefined);
    assert.equal(gemOut.frequency_penalty, undefined);
    assert.equal(gemOut.store, undefined);
    assert.equal(gemOut.transforms, undefined);
    assert.equal(gemOut.tools, undefined);
    assert.equal(gemOut.tool_choice, undefined);
    assert.equal(gemOut.messages[0].role, "system");
    assert.match(gemOut.messages[0].content, /Sys 1[\s\S]*Sys 2/);
    assert.equal(gemOut.messages[1].content[0].cache_control, undefined);
    assert.equal(gemOut.messages[2].content, "");

    // Official OpenAI o3 reasoning model
    const o3Out = sanitizeUpstreamPayload(
      { model: "o3", messages: [{ role: "developer", content: "Rules" }], max_tokens: 1024, temperature: 0.7 },
      { preset: "openai", formatType: "openai", baseUrl: "https://api.openai.com/v1" },
      "o3"
    );
    assert.equal(o3Out.max_completion_tokens, 1024);
    assert.equal(o3Out.max_tokens, undefined);
    assert.equal(o3Out.temperature, undefined);
    assert.equal(o3Out.messages[0].role, "developer");

    // Mistral streaming drops stream_options & maps developer -> system
    const misOut = sanitizeUpstreamPayload(
      { model: "codestral-latest", messages: [{ role: "developer", content: "Code" }], stream: true, stream_options: { include_usage: true } },
      { preset: "mistral", formatType: "openai", baseUrl: "https://api.mistral.ai/v1" },
      "codestral-latest"
    );
    assert.equal(misOut.stream_options, undefined);
    assert.equal(misOut.messages[0].role, "system");
  });

  it("10. auto-retries transient HTTP 503 on single-key provider and converts JSON fallback when stream: true", async () => {
    let attempts = 0;
    const flakeServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        attempts += 1;
        if (attempts === 1) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify([{ error: { code: 503, message: "High demand, retry soon" } }]));
          return;
        }
        // Return application/json even though client asked for stream: true
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-fallback-1",
            object: "chat.completion",
            model: "flake-model",
            choices: [{ index: 0, message: { role: "assistant", content: "Recovered OK!" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          })
        );
      });
    });
    await new Promise((resolve) => flakeServer.listen(0, "127.0.0.1", resolve));
    const flakePort = flakeServer.address().port;

    try {
      const pRes = await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "custom",
          name: "Flaky Provider",
          slug: "flaky-prov",
          baseUrl: `http://127.0.0.1:${flakePort}/v1`,
          formatType: "openai",
          apiKeys: [{ label: "k1", key: "sk-flake-1", enabled: true }],
          models: ["flake-model"],
          enabled: true
        }
      });
      assert.equal(pRes.status, 201);

      const chatRes = await v1Fetch("/v1/chat/completions", {
        method: "POST",
        body: {
          model: "flaky-prov/flake-model",
          stream: true,
          messages: [{ role: "user", content: "xin chao" }]
        }
      });
      assert.equal(chatRes.status, 200);
      assert.match(chatRes.headers.get("content-type") || "", /text\/event-stream/);
      const sseText = await chatRes.text();
      assert.equal(attempts, 2, "Should have auto-retried once after transient 503");
      assert.match(sseText, /Recovered OK!/);
      assert.match(sseText, /data: \[DONE\]/);
    } finally {
      flakeServer.closeAllConnections?.();
      if (flakeServer.listening) {
        await new Promise((resolve) => flakeServer.close(resolve));
      }
    }
  });

  it("11. inspects official account tier, organization, and early billing status via POST /api/providers/:id/inspect-account", async () => {
    let billingActive = true;
    const inspectServer = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, {
          "content-type": "application/json",
          "openai-organization": "org-test-123"
        });
        res.end(
          JSON.stringify({
            data: [
              { id: "gpt-4o" },
              { id: "gpt-4o-mini" },
              { id: "gpt-5" }
            ]
          })
        );
        return;
      }
      if (req.url === "/v1/chat/completions") {
        if (billingActive) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "chatcmpl-probe",
              choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
            })
          );
        } else {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "Your account is not active, please check your billing details." }
            })
          );
        }
        return;
      }
      if (req.url === "/or/auth/key") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: { label: "My OR Key", is_free_tier: true, usage: 0.25, limit: 10, limit_remaining: 9.75 }
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => inspectServer.listen(0, "127.0.0.1", resolve));
    const port = inspectServer.address().port;

    try {
      const oaRes = await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "openai",
          name: "OpenAI Test",
          slug: "openai-inspect",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          formatType: "openai",
          apiKeys: [{ label: "k1", key: "sk-proj-secret-test-999", enabled: true }],
          models: ["gpt-4o-mini"],
          enabled: true
        }
      });
      assert.equal(oaRes.status, 201);
      const oaProv = (await oaRes.json()).provider;

      // Active billing
      const r1 = await apiFetch(`/api/providers/${oaProv.id}/inspect-account`, {
        method: "POST",
        body: { checkBilling: true }
      });
      assert.equal(r1.status, 200);
      const j1 = await r1.json();
      assert.equal(j1.ok, true);
      assert.equal(j1.billingStatus, "active");
      assert.equal(j1.organization, "org-test-123");
      assert.equal(j1.modelsCount, 3);
      assert.equal(j1.hasFlagship, true);

      // Inactive billing (early warning)
      billingActive = false;
      const r2 = await apiFetch(`/api/providers/${oaProv.id}/inspect-account`, {
        method: "POST",
        body: { checkBilling: true }
      });
      assert.equal(r2.status, 200);
      const j2 = await r2.json();
      assert.equal(j2.ok, false);
      assert.equal(j2.billingStatus, "inactive");
      assert.match(j2.billingMessage, /not active|billing/i);
      assert.ok(!JSON.stringify(j2).includes("sk-proj-secret-test-999"));

      // OpenRouter /auth/key inspection
      const orRes = await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "openrouter",
          name: "OpenRouter Test",
          slug: "or-inspect",
          baseUrl: `http://127.0.0.1:${port}/or`,
          formatType: "openai",
          apiKeys: [{ label: "k1", key: "sk-or-v1-secret-888", enabled: true }],
          models: ["google/gemini-2.5-flash"],
          enabled: true
        }
      });
      const orProv = (await orRes.json()).provider;
      const r3 = await apiFetch(`/api/providers/${orProv.id}/inspect-account`, {
        method: "POST",
        body: {}
      });
      assert.equal(r3.status, 200);
      const j3 = await r3.json();
      assert.equal(j3.ok, true);
      assert.equal(j3.isFreeTier, true);
      assert.equal(j3.billingStatus, "free_tier");
      assert.equal(j3.limitRemaining, 9.75);
    } finally {
      inspectServer.closeAllConnections?.();
      if (inspectServer.listening) {
        await new Promise((resolve) => inspectServer.close(resolve));
      }
    }
  });

  it("12. persists Google OAuth client encrypted at rest and enables 1-click select_account sign-in", async () => {
    // Initially unconfigured
    const st0Res = await apiFetch("/api/providers/oauth/google/client-status");
    assert.equal(st0Res.status, 200);
    const st0 = await st0Res.json();
    assert.equal(st0.ok, true);
    assert.equal(st0.configured, false);
    assert.equal(st0.source, "none");

    // First-time start with explicit client credentials persists encrypted client
    const secretVal = "mock-saved-oneclick-secret-445566";
    const start1 = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        clientId: "mock-oneclick-client.example.invalid",
        clientSecret: secretVal,
        projectId: "gcp-oneclick-proj",
        selectAccount: true,
        callbackUrl: "http://127.0.0.1:20128/providers"
      }
    });
    assert.equal(start1.status, 200);
    const s1 = await start1.json();
    assert.equal(s1.ok, true);
    assert.equal(new URL(s1.authUrl).searchParams.get("prompt"), "consent select_account");

    // Client status reports configured without leaking secret
    const st1Res = await apiFetch("/api/providers/oauth/google/client-status");
    assert.equal(st1Res.status, 200);
    const st1Text = await st1Res.text();
    assert.ok(!st1Text.includes(secretVal), "client-status must never leak clientSecret");
    const st1 = JSON.parse(st1Text);
    assert.equal(st1.configured, true);
    assert.equal(st1.source, "saved");
    assert.equal(st1.projectId, "gcp-oneclick-proj");

    // 1-Click start using saved client without resending clientId/clientSecret
    const start2 = await apiFetch("/api/providers/oauth/google/start", {
      method: "POST",
      body: {
        useSavedClient: true,
        callbackUrl: "http://127.0.0.1:20128/providers"
      }
    });
    assert.equal(start2.status, 200);
    const s2 = await start2.json();
    assert.equal(s2.ok, true);
    assert.equal(s2.usedSavedClient, true);
    const url2 = new URL(s2.authUrl);
    assert.equal(url2.searchParams.get("client_id"), "mock-oneclick-client.example.invalid");
    assert.equal(url2.searchParams.get("prompt"), "consent select_account");

    // Verify db.json on disk contains zero plaintext clientSecret and passes security scan
    const rawDb = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    assert.ok(!rawDb.includes(secretVal), "db.json must encrypt saved Google OAuth client");
    const scanRes = await apiFetch("/api/security/scan", { method: "POST", body: {} });
    assert.equal(scanRes.status, 200);
    const scan = await scanRes.json();
    assert.equal(scan.ok, true);
    assert.equal(scan.encryptionAtRest, true);
  });

  it("13. decrypts secrets on refreshFromPostgres and handles custom relays with switched Wire Format & auth-header retry", async () => {
    // 13a. Verify Storage.refreshFromPostgres() decrypts encrypted API keys & proxy URLs
    const encryptedPayload = app.storage._prepareDiskPayload();
    const parsedDisk = JSON.parse(encryptedPayload);
    assert.ok(
      parsedDisk.providers.some((p) =>
        (p.apiKeys || []).some((k) => typeof k.key === "string" && k.key.startsWith("enc:v1:"))
      ),
      "Disk/Postgres payload must store encrypted enc:v1: keys"
    );
    const originalPgPool = app.storage.pgPool;
    const originalPgTs = app.storage._pgUpdatedAt;
    try {
      app.storage._pgUpdatedAt = 0;
      app.storage.pgPool = {
        async query() {
          return { rows: [{ payload: encryptedPayload, ts: 9999999 }] };
        }
      };
      await app.storage.refreshFromPostgres();
      for (const p of app.storage.getProviders()) {
        for (const k of p.apiKeys || []) {
          assert.ok(
            !String(k.key || "").startsWith("enc:v1:"),
            `Provider '${p.slug}' key must be decrypted after refreshFromPostgres()`
          );
        }
      }
    } finally {
      app.storage.pgPool = originalPgPool;
      app.storage._pgUpdatedAt = originalPgTs;
    }

    // 13b. normalizeBaseUrl strips accidental pasted endpoint suffixes
    assert.equal(normalizeBaseUrl("https://relay.example/v1/messages/"), "https://relay.example/v1");
    assert.equal(
      normalizeBaseUrl("https://relay.example/v1/chat/completions"),
      "https://relay.example/v1"
    );
    assert.equal(normalizeBaseUrl("https://relay.example/v1/responses"), "https://relay.example/v1");

    // 13c. Switching preset Wire Format overrides preset's default authStyle
    const dsAnthropicHeaders = buildUpstreamHeaders(
      { preset: "deepseek", formatType: "anthropic", baseUrl: "https://relay.example/v1" },
      "sk-relay-test-key"
    );
    assert.equal(dsAnthropicHeaders["x-api-key"], "sk-relay-test-key");
    assert.equal(dsAnthropicHeaders["anthropic-version"], "2023-06-01");
    assert.equal(dsAnthropicHeaders.authorization, undefined);

    const antOpenAiHeaders = buildUpstreamHeaders(
      { preset: "anthropic", formatType: "openai", baseUrl: "https://relay.example/v1" },
      "sk-relay-test-key"
    );
    assert.equal(antOpenAiHeaders.authorization, "Bearer sk-relay-test-key");
    assert.equal(antOpenAiHeaders["x-api-key"], undefined);

    // 13d. End-to-end custom relay under deepseek preset switched to Anthropic format:
    // mock relay requires Bearer on /v1/models and Bearer on /v1/messages (rejects x-api-key with 401)
    const relayKey = "sk-relay-valid-9999";
    const relayServer = http.createServer((req, res) => {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${relayKey}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "invalid_api_key", message: "API key invalid", type: "invalid_api_key" }
          })
        );
        return;
      }
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "claude-sonnet-4-5" }] }));
        return;
      }
      if (req.url === "/v1/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_relay_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text: "Relay OK" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 }
          })
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise((resolve) => relayServer.listen(0, "127.0.0.1", resolve));
    const relayPort = relayServer.address().port;
    try {
      const createRes = await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "deepseek",
          name: "DeepSeek Relay",
          slug: "deepseek-relay",
          baseUrl: `http://127.0.0.1:${relayPort}/v1/messages`,
          formatType: "anthropic",
          apiKeys: [{ label: "Primary", key: relayKey }],
          models: ["claude-sonnet-4-5"]
        }
      });
      assert.equal(createRes.status, 201);
      const relayProv = (await createRes.json()).provider;
      assert.equal(relayProv.baseUrl, `http://127.0.0.1:${relayPort}/v1`);

      // Test connection & inspect-account & model discovery & live chat routing all succeed via auth-header fallback
      const testRes = await apiFetch(`/api/providers/${relayProv.id}/test`, {
        method: "POST",
        body: {}
      });
      const testJson = await testRes.json();
      assert.equal(testJson.ok, true, `Expected test ok, got: ${JSON.stringify(testJson)}`);
      assert.equal(testJson.modelsCount, 2);

      const inspectRes = await apiFetch(`/api/providers/${relayProv.id}/inspect-account`, {
        method: "POST",
        body: { checkBilling: true }
      });
      const inspectJson = await inspectRes.json();
      assert.equal(inspectJson.ok, true);
      assert.equal(inspectJson.modelsCount, 2);

      const modelsRes = await apiFetch(`/api/providers/${relayProv.id}/models`, {
        method: "POST",
        body: {}
      });
      const modelsJson = await modelsRes.json();
      assert.equal(modelsJson.ok, true);
      assert.ok(modelsJson.models.includes("claude-sonnet-4-5"));

      const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${routerKey}`
        },
        body: JSON.stringify({
          model: "deepseek-relay/claude-sonnet-4-5",
          messages: [{ role: "user", content: "hi" }]
        })
      });
      assert.equal(chatRes.status, 200);
      const chatJson = await chatRes.json();
      assert.equal(chatJson.choices[0].message.content, "Relay OK");

      // 13e. Verify GET /api/usage?range=today returns 12 hourly series buckets and
      // GET /api/usage/live returns persisted requests even if in-memory liveEvents is empty
      const usageTodayRes = await apiFetch("/api/usage?range=today");
      assert.equal(usageTodayRes.status, 200);
      const usageToday = await usageTodayRes.json();
      assert.ok(Array.isArray(usageToday.series) && usageToday.series.length === 12);
      assert.ok(usageToday.series.some((b) => b.requests > 0));
      assert.ok(Array.isArray(usageToday.recentRequests) && usageToday.recentRequests.length > 0);

      // Simulate serverless cold instance where in-memory liveEvents.recentRequests is empty
      app.liveEvents.recentRequests = [];
      const liveRes = await apiFetch("/api/usage/live?limit=50");
      assert.equal(liveRes.status, 200);
      const liveJson = await liveRes.json();
      assert.ok(
        Array.isArray(liveJson.recentRequests) && liveJson.recentRequests.length > 0,
        "GET /api/usage/live must hydrate persisted logs when in-memory liveEvents is empty"
      );
      const relayEntry = liveJson.recentRequests.find((r) => r.provider === "deepseek-relay");
      assert.ok(relayEntry, "Persisted deepseek-relay request must appear in /api/usage/live");
      assert.equal(relayEntry.httpStatus, 200);
      assert.equal(relayEntry.promptTokens, 5);
      assert.equal(relayEntry.completionTokens, 2);
    } finally {
      await new Promise((resolve) => relayServer.close(resolve));
    }
  });
});
