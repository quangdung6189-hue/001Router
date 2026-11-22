import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import { CAVEMAN_PROMPTS, applyCavemanMode } from "../server/tokenSaver.js";
import { maskProxyUrl } from "../server/proxy.js";
import { syncCatalogFromLiveSources } from "../server/catalog/updater.js";

const PROVIDERS_LOGO_DIR = path.resolve(
  import.meta.dirname,
  "../web/public/providers"
);

/**
 * Extract cookie string from Set-Cookie header.
 * @param {Response} res
 */
function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

describe("001Router v1.2 — Catalog, Logos, Combo Templates, Caveman Mode, Media/Search/Fetch & Proxy Pools", () => {
  let tmpDir;
  let mock;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let routerKey;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-features-"));
    mock = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

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

    // Create a fresh router key for /v1/* tests
    const keyRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "Features Test Key" }
    });
    assert.equal(keyRes.status, 201);
    const keyData = await keyRes.json();
    routerKey = keyData.key.key;
    assert.match(routerKey, /^sk-001r-/);
  });

  after(async () => {
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
    if (sessionCookie) {
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

  it("1. serves /api/catalog and /api/catalog/models with 45+ providers, verified logos, and 9 service kinds", async () => {
    const catRes = await apiFetch("/api/catalog");
    assert.equal(catRes.status, 200);
    const cat = await catRes.json();

    assert.equal(typeof cat.generatedAt, "string");
    assert.equal(cat.kinds.length, 9);
    const kindIds = cat.kinds.map((k) => k.id).sort();
    assert.deepEqual(
      kindIds,
      ["chat", "embedding", "fetch", "image", "search", "stt", "tts", "video", "vision"]
    );

    assert.ok(
      cat.providers.length >= 45,
      `Expected >= 45 catalog providers, got ${cat.providers.length}`
    );

    for (const p of cat.providers) {
      assert.equal(typeof p.preset, "string");
      assert.equal(typeof p.name, "string");
      assert.ok(["premium", "cheap", "free", "local"].includes(p.tier));
      assert.equal(typeof p.logo, "string");
      assert.ok(["png", "svg"].includes(p.logoExt));
      const logoFile = path.join(PROVIDERS_LOGO_DIR, `${p.logo}.${p.logoExt}`);
      assert.ok(
        fsSync.existsSync(logoFile),
        `Missing logo file on disk for ${p.preset}: ${logoFile}`
      );
      assert.ok(Array.isArray(p.serviceKinds) && p.serviceKinds.length >= 1);
      assert.ok(Array.isArray(p.models) && p.models.length >= 1);
    }

    // Verify GET /api/providers presets include v1.2 catalog enrichment
    const provRes = await apiFetch("/api/providers");
    assert.equal(provRes.status, 200);
    const { presets } = await provRes.json();
    assert.ok(presets.length >= 55);
    const openaiPreset = presets.find((p) => p.preset === "openai");
    assert.ok(openaiPreset);
    assert.equal(openaiPreset.logo, "openai");
    assert.equal(openaiPreset.logoExt, "png");
    assert.equal(openaiPreset.tier, "premium");
    assert.ok(Array.isArray(openaiPreset.modelCatalog));
    assert.ok(openaiPreset.modelCatalog.length >= 15);
    assert.ok(openaiPreset.serviceKinds.includes("chat"));
    assert.ok(openaiPreset.serviceKinds.includes("embedding"));
    assert.ok(openaiPreset.serviceKinds.includes("image"));
    assert.ok(openaiPreset.serviceKinds.includes("tts"));
    assert.ok(openaiPreset.serviceKinds.includes("stt"));

    // Verify /api/catalog/models filters (?kind= & ?q=)
    const allModelsRes = await apiFetch("/api/catalog/models");
    assert.equal(allModelsRes.status, 200);
    const allModels = (await allModelsRes.json()).models;
    assert.ok(
      allModels.length >= 450,
      `Expected >= 450 catalog models, got ${allModels.length}`
    );

    const chatModelsRes = await apiFetch("/api/catalog/models?kind=chat&q=claude");
    assert.equal(chatModelsRes.status, 200);
    const chatModels = (await chatModelsRes.json()).models;
    assert.ok(chatModels.length >= 5);
    assert.ok(chatModels.every((m) => m.kind === "chat"));
    assert.ok(chatModels.some((m) => m.fullId.startsWith("anthropic/claude-")));

    const searchModelsRes = await apiFetch("/api/catalog/models?kind=search");
    assert.equal(searchModelsRes.status, 200);
    const searchModels = (await searchModelsRes.json()).models;
    assert.ok(searchModels.length >= 6);
    assert.ok(searchModels.some((m) => m.preset === "tavily"));
  });

  it("2. merges live and catalog models on POST /api/providers/:id/models returning live and catalogOnly arrays", async () => {
    const createRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "Catalog OpenAI",
        slug: "catalog-openai",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: ["sk-cat-openai-1111"],
        models: ["gpt-4o"]
      }
    });
    assert.equal(createRes.status, 201);
    const prov = (await createRes.json()).provider;

    const syncRes = await apiFetch(`/api/providers/${prov.id}/models`, {
      method: "POST",
      body: {}
    });
    assert.equal(syncRes.status, 200);
    const syncData = await syncRes.json();
    assert.equal(syncData.ok, true);
    assert.ok(Array.isArray(syncData.live));
    assert.ok(syncData.live.includes("gpt-4o"));
    assert.ok(Array.isArray(syncData.catalogOnly));
    assert.ok(syncData.catalogOnly.includes("gpt-6.2-astra-pro"));
    assert.ok(syncData.models.includes("gpt-4o"));
    assert.ok(syncData.models.includes("gpt-6.2-astra-pro"));

    await apiFetch(`/api/providers/${prov.id}`, { method: "DELETE" });
  });

  it("3. lists combo tier templates and generates a 3-tier combo ordered premium -> cheap -> free", async () => {
    const tplRes = await apiFetch("/api/combos/templates");
    assert.equal(tplRes.status, 200);
    const { templates } = await tplRes.json();
    const tplIds = templates.map((t) => t.id);
    assert.ok(tplIds.includes("3-tier"));
    assert.ok(tplIds.includes("free-only"));
    assert.ok(tplIds.includes("fast-coding"));

    // With 0 providers connected, generating 3-tier returns 409
    const emptyGen = await apiFetch("/api/combos/templates/3-tier/generate", {
      method: "POST",
      body: { name: "empty-3-tier" }
    });
    assert.equal(emptyGen.status, 409);

    // Connect a free, a cheap, and a premium provider
    const pFree = await (
      await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "groq",
          name: "Groq Free",
          slug: "groq",
          baseUrl: `${mock.baseUrl}/groq/v1`,
          formatType: "openai",
          apiKeys: ["gsk_free_key_12345"]
        }
      })
    ).json();

    const pCheap = await (
      await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "deepseek",
          name: "DeepSeek Cheap",
          slug: "deepseek",
          baseUrl: `${mock.baseUrl}/deepseek/v1`,
          formatType: "openai",
          apiKeys: ["sk-deepseek-cheap-12345"]
        }
      })
    ).json();

    const pPrem = await (
      await apiFetch("/api/providers", {
        method: "POST",
        body: {
          preset: "openai",
          name: "OpenAI Premium",
          slug: "openai",
          baseUrl: `${mock.baseUrl}/openai/v1`,
          formatType: "openai",
          apiKeys: ["sk-openai-prem-12345"]
        }
      })
    ).json();

    const genRes = await apiFetch("/api/combos/templates/3-tier/generate", {
      method: "POST",
      body: { name: "smart-3-tier" }
    });
    assert.equal(genRes.status, 201);
    const { combo } = await genRes.json();
    assert.equal(combo.name, "smart-3-tier");
    assert.ok(combo.targets.length >= 3);

    // First target must be premium (openai), then cheap (deepseek), then free (groq)
    const firstProv = combo.targets[0].split("/")[0];
    const lastProv = combo.targets[combo.targets.length - 1].split("/")[0];
    assert.equal(firstProv, "openai");
    assert.equal(lastProv, "groq");
    assert.ok(combo.targets.some((t) => t.startsWith("deepseek/")));

    // Clean up combo and providers for subsequent tests
    await apiFetch(`/api/combos/${combo.id}`, { method: "DELETE" });
    await apiFetch(`/api/providers/${pFree.provider.id}`, { method: "DELETE" });
    await apiFetch(`/api/providers/${pCheap.provider.id}`, { method: "DELETE" });
    await apiFetch(`/api/providers/${pPrem.provider.id}`, { method: "DELETE" });
  });

  it("4. injects Caveman Mode terse system instruction for OpenAI and Anthropic without altering tools and logs caveman: true", async () => {
    // Unit-check applyCavemanMode helper across levels
    const unitOai = applyCavemanMode(
      {
        messages: [{ role: "user", content: "Explain recursion" }],
        tools: [{ type: "function", function: { name: "test_tool" } }]
      },
      "openai",
      { cavemanEnabled: true, cavemanLevel: "ultra" }
    );
    assert.equal(unitOai.cavemanApplied, true);
    assert.equal(unitOai.body.messages[0].role, "system");
    assert.equal(unitOai.body.messages[0].content, CAVEMAN_PROMPTS.ultra);
    assert.equal(unitOai.body.tools[0].function.name, "test_tool");

    // Create OpenAI and Anthropic providers
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "Caveman OpenAI",
        slug: "caveman-oai",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: ["sk-caveman-oai-1111"],
        models: ["gpt-4o", "gpt-image-1", "tts-1", "whisper-1", "text-embedding-3-small"]
      }
    });

    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "anthropic",
        name: "Caveman Anthropic",
        slug: "caveman-ant",
        baseUrl: `${mock.baseUrl}`,
        formatType: "anthropic",
        apiKeys: ["sk-ant-caveman-2222"],
        models: ["claude-sonnet-4-20250514"]
      }
    });

    // Enable Caveman Mode via PUT /api/settings
    const putSet = await apiFetch("/api/settings", {
      method: "PUT",
      body: { cavemanEnabled: true, cavemanLevel: "full" }
    });
    assert.equal(putSet.status, 200);
    const updatedSettings = (await putSet.json()).settings;
    assert.equal(updatedSettings.cavemanEnabled, true);
    assert.equal(updatedSettings.cavemanLevel, "full");

    await apiFetch("/api/logs", { method: "DELETE" });

    const toolsSchema = [
      {
        type: "function",
        function: {
          name: "run_linter",
          description: "Run linter on file",
          parameters: { type: "object", properties: { file: { type: "string" } } }
        }
      }
    ];

    // 1. OpenAI chat completions with Caveman enabled
    const oaiRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "caveman-oai/gpt-4o",
        messages: [
          { role: "system", content: "You are a senior engineer." },
          { role: "user", content: "How do I fix a null pointer?" }
        ],
        tools: toolsSchema
      })
    });
    assert.equal(oaiRes.status, 200);
    assert.equal(mock.requests.length, 1);
    const sentOaiBody = mock.requests[0].body;
    assert.equal(sentOaiBody.messages[0].role, "system");
    assert.ok(sentOaiBody.messages[0].content.startsWith(CAVEMAN_PROMPTS.full));
    assert.ok(sentOaiBody.messages[0].content.includes("You are a senior engineer."));
    assert.deepEqual(sentOaiBody.tools, toolsSchema);

    // 2. Anthropic messages with Caveman enabled
    mock.reset();
    const antTools = [
      {
        name: "read_config",
        description: "Read config file",
        input_schema: { type: "object", properties: { path: { type: "string" } } }
      }
    ];
    const antRes = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": routerKey
      },
      body: JSON.stringify({
        model: "caveman-ant/claude-sonnet-4-20250514",
        max_tokens: 256,
        system: "Stay focused.",
        messages: [{ role: "user", content: "Review config" }],
        tools: antTools
      })
    });
    assert.equal(antRes.status, 200);
    assert.equal(mock.requests.length, 1);
    const sentAntBody = mock.requests[0].body;
    assert.ok(sentAntBody.system.startsWith(CAVEMAN_PROMPTS.full));
    assert.ok(sentAntBody.system.includes("Stay focused."));
    assert.deepEqual(sentAntBody.tools, antTools);

    // 3. Verify LogEntry records caveman: true on both requests
    const logsRes = await apiFetch("/api/logs?limit=5");
    const { logs } = await logsRes.json();
    assert.equal(logs.length, 2);
    assert.equal(logs[0].caveman, true);
    assert.equal(logs[1].caveman, true);

    // Disable Caveman Mode after test
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { cavemanEnabled: false }
    });
  });

  it("5. routes /v1/images/generations, /v1/audio/speech, /v1/audio/transcriptions, /v1/search, /v1/web/fetch, and GET /v1/models?kind=", async () => {
    // 1. POST /v1/images/generations
    const imgRes = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "caveman-oai/gpt-image-1",
        prompt: "A minimalist geometric router logo",
        n: 1,
        size: "1024x1024"
      })
    });
    assert.equal(imgRes.status, 200);
    const imgJson = await imgRes.json();
    assert.equal(imgJson.data[0].url, "https://example.com/mock-generated-image.png");
    assert.equal(mock.requests[0].body.model, "gpt-image-1");

    // 2. POST /v1/audio/speech (binary audio stream passthrough)
    mock.reset();
    const ttsRes = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "caveman-oai/tts-1",
        input: "Hello from 001Router TTS",
        voice: "alloy"
      })
    });
    assert.equal(ttsRes.status, 200);
    assert.match(ttsRes.headers.get("content-type") || "", /audio\/mpeg/);
    const audioBytes = Buffer.from(await ttsRes.arrayBuffer());
    assert.equal(audioBytes.toString("utf8"), "ID3-MOCK-MP3-AUDIO-BINARY-STREAM");

    // 3. POST /v1/audio/transcriptions (multipart/form-data passthrough)
    mock.reset();
    const boundary = "----001RouterTestBoundary987654";
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `caveman-oai/whisper-1\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="sample.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      `RIFF_FAKE_WAV_DATA\r\n` +
      `--${boundary}--\r\n`;

    const sttRes = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${routerKey}`
      },
      body: multipartBody
    });
    assert.equal(sttRes.status, 200);
    const sttJson = await sttRes.json();
    assert.equal(sttJson.text, "Mock transcribed audio text");
    assert.match(
      mock.requests[0].headers["content-type"] || "",
      new RegExp(`multipart/form-data; boundary=${boundary}`)
    );
    assert.ok(String(mock.requests[0].body).includes("whisper-1"));

    // 4. POST /v1/search (Tavily & Brave)
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "tavily",
        name: "Tavily Search",
        slug: "tavily",
        baseUrl: `${mock.baseUrl}/tavily`,
        formatType: "openai",
        apiKeys: ["tvly-secret-key-1111"]
      }
    });
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "brave",
        name: "Brave Search",
        slug: "brave",
        baseUrl: `${mock.baseUrl}/brave`,
        formatType: "openai",
        apiKeys: ["BSA-brave-secret-2222"]
      }
    });

    mock.reset();
    const searchRes = await fetch(`${baseUrl}/v1/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        query: "001Router AI gateway",
        provider: "tavily",
        max_results: 2
      })
    });
    assert.equal(searchRes.status, 200);
    const searchJson = await searchRes.json();
    assert.equal(searchJson.provider, "tavily");
    assert.equal(searchJson.results.length, 2);
    assert.deepEqual(searchJson.results[0], {
      title: "Mock Search Result 1",
      url: "https://example.com/result-1",
      snippet: "Mock search snippet one"
    });

    // Test Brave search uses X-Subscription-Token header and GET /web/search
    mock.reset();
    const braveRes = await fetch(`${baseUrl}/v1/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        query: "Brave search test",
        provider: "brave",
        max_results: 1
      })
    });
    assert.equal(braveRes.status, 200);
    const braveJson = await braveRes.json();
    assert.equal(braveJson.provider, "brave");
    assert.equal(braveJson.results.length, 1);
    assert.equal(
      mock.requests[0].headers["x-subscription-token"],
      "BSA-brave-secret-2222"
    );

    // 5. POST /v1/web/fetch (Firecrawl)
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "firecrawl",
        name: "Firecrawl",
        slug: "firecrawl",
        baseUrl: `${mock.baseUrl}/firecrawl/v1`,
        formatType: "openai",
        apiKeys: ["fc-secret-key-3333"]
      }
    });

    mock.reset();
    const fetchRes = await fetch(`${baseUrl}/v1/web/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        url: "https://example.com/docs",
        provider: "firecrawl"
      })
    });
    assert.equal(fetchRes.status, 200);
    const fetchJson = await fetchRes.json();
    assert.equal(fetchJson.provider, "firecrawl");
    assert.equal(fetchJson.url, "https://example.com/docs");
    assert.equal(fetchJson.title, "Mock Fetched Page");
    assert.match(fetchJson.content, /# Mock Fetched Page/);

    // 6. GET /v1/models?kind=image and ?kind=search
    const imgModelsRes = await fetch(`${baseUrl}/v1/models?kind=image`, {
      headers: { authorization: `Bearer ${routerKey}` }
    });
    assert.equal(imgModelsRes.status, 200);
    const imgModels = (await imgModelsRes.json()).data;
    assert.ok(imgModels.some((m) => m.id === "caveman-oai/gpt-image-1"));
    assert.ok(!imgModels.some((m) => m.id === "caveman-oai/gpt-4o"));
  });

  it("6. supports /api/proxy-pools CRUD, masks proxy URL credentials, and tests proxy connectivity", async () => {
    const rawProxyUrl = `http://proxyUser:superSecretPass99@${mock.baseUrl.replace(
      "http://",
      ""
    )}`;
    const expectedMasked = maskProxyUrl(rawProxyUrl);
    assert.ok(!expectedMasked.includes("proxyUser"));
    assert.ok(!expectedMasked.includes("superSecretPass99"));
    assert.match(expectedMasked, /^http:\/\/\*\*\*:\*\*\*@127\.0\.0\.1:\d+$/);

    // Create proxy pool
    const createRes = await apiFetch("/api/proxy-pools", {
      method: "POST",
      body: {
        name: "US East Proxy",
        url: rawProxyUrl
      }
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()).pool;
    assert.equal(created.name, "US East Proxy");
    assert.equal(created.type, "http");
    assert.equal(created.urlMasked, expectedMasked);
    assert.equal(created.url, undefined);
    assert.ok(!JSON.stringify(created).includes("superSecretPass99"));

    // List proxy pools
    const listRes = await apiFetch("/api/proxy-pools");
    assert.equal(listRes.status, 200);
    const { pools } = await listRes.json();
    assert.equal(pools.length, 1);
    assert.equal(pools[0].urlMasked, expectedMasked);
    assert.equal(pools[0].url, undefined);

    // Test proxy pool connectivity against running mock listener port
    const testRes = await apiFetch(`/api/proxy-pools/${created.id}/test`, {
      method: "POST",
      body: {}
    });
    assert.equal(testRes.status, 200);
    const testData = await testRes.json();
    assert.equal(testData.ok, true);
    assert.equal(typeof testData.latencyMs, "number");
    assert.ok(!testData.message.includes("superSecretPass99"));

    // Update proxy pool preserving credentials when masked URL is sent back
    const putRes = await apiFetch(`/api/proxy-pools/${created.id}`, {
      method: "PUT",
      body: {
        name: "US East Proxy Renamed",
        url: expectedMasked,
        enabled: false
      }
    });
    assert.equal(putRes.status, 200);
    const updated = (await putRes.json()).pool;
    assert.equal(updated.name, "US East Proxy Renamed");
    assert.equal(updated.enabled, false);
    assert.equal(updated.urlMasked, expectedMasked);

    // Delete proxy pool
    const delRes = await apiFetch(`/api/proxy-pools/${created.id}`, {
      method: "DELETE"
    });
    assert.equal(delRes.status, 200);
    const afterList = (await (await apiFetch("/api/proxy-pools")).json()).pools;
    assert.equal(afterList.length, 0);
  });

  it("7. includes muse, xiaomi, byteplus, baidu, tencent, nous presets with verified logos, catalog sorting/filtering, and sync-status", async () => {
    const provRes = await apiFetch("/api/providers");
    assert.equal(provRes.status, 200);
    const { presets } = await provRes.json();

    const expectedNewPresets = [
      { preset: "muse", logo: "muse", tier: "premium", baseUrl: "https://api.meta.ai/v1" },
      { preset: "byteplus", logo: "byteplus", tier: "free", baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3" },
      { preset: "xiaomi", logo: "xiaomi-mimo", tier: "cheap", baseUrl: "https://api.xiaomimimo.com/v1" },
      { preset: "baidu", logo: "baidu", tier: "cheap", baseUrl: "https://qianfan.baidubce.com/v2" },
      { preset: "tencent", logo: "tencent", tier: "cheap", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1" },
      { preset: "nous", logo: "nous", tier: "cheap", baseUrl: "https://inference-api.nousresearch.com/v1" }
    ];

    for (const exp of expectedNewPresets) {
      const found = presets.find((p) => p.preset === exp.preset);
      assert.ok(found, `Expected preset '${exp.preset}' to exist`);
      assert.equal(found.logo, exp.logo);
      assert.equal(found.tier, exp.tier);
      assert.equal(found.baseUrl, exp.baseUrl);
      assert.equal(found.formatType, "openai");
      assert.ok(Array.isArray(found.models) && found.models.length >= 1);
      const logoFile = path.join(PROVIDERS_LOGO_DIR, `${found.logo}.${found.logoExt}`);
      assert.ok(
        fsSync.existsSync(logoFile),
        `Missing verified logo file on disk for ${exp.preset}: ${logoFile}`
      );
    }

    // Verify Muse models include newest Meta Model API entries
    const musePreset = presets.find((p) => p.preset === "muse");
    assert.ok(musePreset.models.includes("muse-ember"));

    // Verify GET /api/catalog/models default newest-first sort & ?days=30 filter
    const newestRes = await apiFetch("/api/catalog/models?kind=chat&days=30");
    assert.equal(newestRes.status, 200);
    const newestModels = (await newestRes.json()).models;
    assert.ok(newestModels.length >= 1, "Expected recent chat models within 30 days");
    for (let i = 1; i < newestModels.length; i++) {
      assert.ok(
        newestModels[i - 1].released >= newestModels[i].released,
        `Expected newest-first ordering: ${newestModels[i - 1].released} >= ${newestModels[i].released}`
      );
    }

    // Verify ?sort=context ordering
    const ctxRes = await apiFetch("/api/catalog/models?kind=chat&sort=context");
    assert.equal(ctxRes.status, 200);
    const ctxModels = (await ctxRes.json()).models;
    assert.ok(ctxModels.length >= 2);
    assert.ok((ctxModels[0].contextWindow || 0) >= (ctxModels[1].contextWindow || 0));

    // Verify GET /api/catalog/sync-status and catalogAutoSync setting toggle
    const statusRes = await apiFetch("/api/catalog/sync-status");
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(typeof status.lastSyncedAt, "string");
    assert.equal(status.autoSyncEnabled, true);
    assert.equal(status.isSyncing, false);
    assert.ok(status.totalProviders >= 50);
    assert.ok(status.totalModels >= 500);

    const disableRes = await apiFetch("/api/settings", {
      method: "PUT",
      body: { catalogAutoSync: false }
    });
    assert.equal(disableRes.status, 200);
    assert.equal((await disableRes.json()).settings.catalogAutoSync, false);

    const statusAfterDisable = await (await apiFetch("/api/catalog/sync-status")).json();
    assert.equal(statusAfterDisable.autoSyncEnabled, false);

    // Restore default catalogAutoSync: true
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { catalogAutoSync: true }
    });
  });

  it("8. syncs live models via syncCatalogFromLiveSources with injected mock fetchImpl (offline-safe)", async () => {
    const mockCatalogPath = path.join(tmpDir, "mock-modelCatalog.json");

    // Seed with an existing non-chat embedding model + local provider to verify preservation
    await fs.writeFile(
      mockCatalogPath,
      JSON.stringify(
        {
          generatedAt: "2026-01-01T00:00:00.000Z",
          sources: [],
          providers: {
            openai: {
              models: [
                {
                  id: "text-embedding-3-large",
                  name: "Text Embedding 3 Large",
                  kind: "embedding",
                  contextWindow: 8191
                }
              ]
            },
            ollama: {
              models: [{ id: "llama3.2", name: "Llama 3.2", kind: "chat" }]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const mockFetchImpl = async (url) => {
      assert.equal(url, "https://openrouter.ai/api/v1/models");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: "meta/muse-ember",
                name: "Meta: Muse Ember",
                created: 1794182400, // 2026-11-09
                context_length: 262144,
                top_provider: { max_completion_tokens: 32768 },
                pricing: { prompt: "0.000002", completion: "0.000008" },
                architecture: { input_modalities: ["text", "image"] },
                supported_parameters: ["tools", "reasoning"]
              },
              {
                id: "meta/muse-ember:batch",
                name: "Meta: Muse Ember (Batch)",
                created: 1794182400,
                context_length: 262144
              },
              {
                id: "xiaomi/mimo-v2.6-pro",
                name: "Xiaomi: MiMo V2.6 Pro",
                created: 1790000000,
                context_length: 131072,
                pricing: { prompt: "0.0000005", completion: "0.0000015" },
                supported_parameters: ["tools"]
              },
              {
                id: "bytedance-seed/seed-2-1-turbo",
                name: "ByteDance: Seed 2.1 Turbo",
                created: 1786500000,
                context_length: 256000,
                pricing: { prompt: "0", completion: "0" }
              },
              {
                id: "baidu/ernie-light-dt-1.0-intl",
                name: "Baidu: ERNIE Light DT 1.0",
                created: 1794268800,
                context_length: 128000
              },
              {
                id: "tencent/hy4-flash",
                name: "Tencent: HY4 Flash",
                created: 1794787200,
                context_length: 128000
              },
              {
                id: "nousresearch/hermes-4-405b",
                name: "Nous: Hermes 4 405B",
                created: 1756166400,
                context_length: 131072
              },
              {
                id: "openai/gpt-6.2-astra-pro",
                name: "OpenAI: GPT-6.2 Astra Pro",
                created: 1794873600,
                context_length: 1050000,
                pricing: { prompt: "0.000008", completion: "0.00004" },
                architecture: { input_modalities: ["text", "image"] },
                supported_parameters: ["tools", "reasoning"]
              }
            ]
          };
        }
      };
    };

    const result = await syncCatalogFromLiveSources({
      fetchImpl: mockFetchImpl,
      catalogPath: mockCatalogPath,
      reload: false
    });

    assert.equal(result.ok, true);
    assert.equal(typeof result.generatedAt, "string");
    assert.ok(result.totalProviders >= 9);
    assert.ok(result.addedCount >= 7);
    assert.ok(Array.isArray(result.newestModels) && result.newestModels.length >= 1);

    const written = JSON.parse(await fs.readFile(mockCatalogPath, "utf8"));
    // :batch variant must be filtered out
    assert.equal(written.providers.muse.models.length, 1);
    assert.equal(written.providers.muse.models[0].id, "muse-ember");
    assert.equal(written.providers.muse.models[0].vision, true);
    assert.equal(written.providers.muse.models[0].reasoning, true);
    assert.equal(written.providers.muse.models[0].tools, true);
    assert.equal(written.providers.muse.models[0].inputPrice, 2);
    assert.equal(written.providers.muse.models[0].outputPrice, 8);

    // Other 5 new vendor mappings
    assert.equal(written.providers.xiaomi.models[0].id, "mimo-v2.6-pro");
    assert.equal(written.providers.byteplus.models[0].id, "seed-2-1-turbo");
    assert.equal(written.providers.byteplus.models[0].free, true);
    assert.equal(written.providers.baidu.models[0].id, "ernie-light-dt-1.0-intl");
    assert.equal(written.providers.tencent.models[0].id, "hy4-flash");
    assert.equal(written.providers.nous.models[0].id, "hermes-4-405b");

    // Curated non-chat model and local provider preserved
    assert.ok(
      written.providers.openai.models.some((m) => m.id === "text-embedding-3-large" && m.kind === "embedding")
    );
    assert.ok(
      written.providers.openai.models.some((m) => m.id === "gpt-6.2-astra-pro" && m.kind === "chat")
    );
    assert.equal(written.providers.ollama.models[0].id, "llama3.2");
    assert.ok(written.providers.openrouter.models.length >= 1);
  });
});
