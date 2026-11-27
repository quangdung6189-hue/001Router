import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import { compressText, applyTokenSaver } from "../server/tokenSaver.js";
import { createSSEParser, claudeToOpenAIRequest, openaiToClaudeRequest } from "../server/translator.js";
import { MAX_LOGS } from "../server/storage.js";
import { maskKey } from "../server/auth.js";
import { buildUpstreamUrl } from "../server/presets.js";

/**
 * Helper to parse all SSE frames from raw SSE response text.
 * @param {string} rawText
 */
function parseAllSSE(rawText) {
  const frames = [];
  const parser = createSSEParser((evt) => frames.push(evt));
  parser.feed(rawText);
  parser.flush();
  return frames;
}

/**
 * Helper to extract cookie string from Set-Cookie header.
 * @param {Response} res
 */
function extractCookie(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0];
}

describe("001Router Backend & Gateway Test Suite", () => {
  let tmpDir;
  let webDistDir;
  let mock;
  let app;
  let server;
  let baseUrl;
  let sessionCookie;
  let defaultRouterKey;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-test-"));
    webDistDir = path.join(tmpDir, "web-dist");
    await fs.mkdir(webDistDir, { recursive: true });
    await fs.writeFile(
      path.join(webDistDir, "index.html"),
      "<!doctype html><html><body>001Router UI</body></html>",
      "utf8"
    );

    mock = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128, webDistDir });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mock.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mock.reset();
  });

  // Helper for authenticated dashboard fetch
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

  // Scenario 1: Auth & 401 checks (Dashboard session + /v1/* router key auth)
  it("1. enforces dashboard session auth and /v1/* router key auth", async () => {
    // Health endpoint is public
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.deepEqual(healthJson, { ok: true, service: "001router", port: 20128 });

    // SPA static serving works
    const spaRes = await fetch(`${baseUrl}/some/dashboard/route`);
    assert.equal(spaRes.status, 200);
    assert.match(await spaRes.text(), /001Router UI/);

    // Unauthenticated /api/* returns 401
    const unauthMe = await fetch(`${baseUrl}/api/me`);
    assert.equal(unauthMe.status, 401);
    assert.deepEqual(await unauthMe.json(), { authenticated: false, error: "Unauthorized" });

    const unauthProv = await fetch(`${baseUrl}/api/providers`);
    assert.equal(unauthProv.status, 401);
    assert.deepEqual(await unauthProv.json(), { error: "Unauthorized" });

    // Wrong password returns 401
    const badLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" })
    });
    assert.equal(badLogin.status, 401);

    // Default password "1234" logs in and sets HttpOnly r001_session cookie
    const goodLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(goodLogin.status, 200);
    const setCookie = goodLogin.headers.get("set-cookie") || "";
    assert.match(setCookie, /r001_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    sessionCookie = extractCookie(goodLogin);

    // Authenticated /api/me returns 200 with defaultPassword flag
    const meRes = await apiFetch("/api/me");
    assert.equal(meRes.status, 200);
    assert.deepEqual(await meRes.json(), { authenticated: true, defaultPassword: true });

    // Default enabled router key exists on first boot (hashed at rest; revealed once via /api/keys/reveal-initial)
    const keysRes = await apiFetch("/api/keys");
    assert.equal(keysRes.status, 200);
    const keysData = await keysRes.json();
    assert.equal(keysData.keys.length, 1);
    assert.equal(keysData.keys[0].name, "Default Key");
    assert.equal(keysData.keys[0].key, undefined);
    assert.match(keysData.keys[0].keyPreview, /^sk-/);
    assert.equal(keysData.keys[0].enabled, true);

    const revealRes = await apiFetch("/api/keys/reveal-initial");
    assert.equal(revealRes.status, 200);
    const revealData = await revealRes.json();
    assert.match(revealData.key, /^sk-001r-/);
    defaultRouterKey = revealData.key;

    // Missing or invalid router key on /v1/* returns 401
    const noKeyV1 = await fetch(`${baseUrl}/v1/models`);
    assert.equal(noKeyV1.status, 401);
    const noKeyJson = await noKeyV1.json();
    assert.equal(noKeyJson.error.type, "authentication_error");

    const badKeyV1 = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: "Bearer sk-001r-invalid" }
    });
    assert.equal(badKeyV1.status, 401);

    // Valid key via Authorization Bearer and via x-api-key both succeed
    const bearerRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${defaultRouterKey}` }
    });
    assert.equal(bearerRes.status, 200);

    const xApiKeyRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { "x-api-key": defaultRouterKey }
    });
    assert.equal(xApiKeyRes.status, 200);

    // Logout clears session
    const logoutRes = await apiFetch("/api/logout", { method: "POST" });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get("set-cookie") || "", /r001_session=;/);

    // Re-login for remaining tests
    const relogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    sessionCookie = extractCookie(relogin);
  });

  // Scenario 2: Masked keys, PUT preservation, Ollama keyless support & secret redaction
  it("2. masks upstream provider keys, preserves existing keys on PUT, and allows keyless Ollama", async () => {
    const secretKey1 = "sk-provider-secret-1111abcd";
    const secretKey2 = "sk-provider-secret-2222efgh";

    // Create OpenAI-style provider with string key
    const createRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "My OpenAI",
        slug: "my-openai",
        baseUrl: `${mock.baseUrl}/v1/`, // trailing slash should normalize cleanly
        formatType: "openai",
        apiKeys: [{ key: secretKey1, label: "Primary" }],
        models: ["gpt-4o", "gpt-4o-mini"]
      }
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.provider.baseUrl, `${mock.baseUrl}/v1`);
    assert.equal(created.provider.apiKeys[0].maskedKey, maskKey(secretKey1));
    assert.equal(created.provider.apiKeys[0].key, undefined);
    assert.ok(!JSON.stringify(created).includes(secretKey1));

    const providerId = created.provider.id;
    const key1Id = created.provider.apiKeys[0].id;

    // GET /api/providers returns 32+ presets and never exposes plaintext key
    const listRes = await apiFetch("/api/providers");
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.presets.length >= 32);
    assert.ok(!JSON.stringify(listData.providers).includes(secretKey1));

    // Duplicate slug rejected with 400
    const dupRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "Dup",
        slug: "my-openai",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: ["sk-dup"]
      }
    });
    assert.equal(dupRes.status, 400);

    // PUT /api/providers/:id with maskedKey + omitted key preserves stored plaintext key
    const putRes = await apiFetch(`/api/providers/${providerId}`, {
      method: "PUT",
      body: {
        apiKeys: [
          { id: key1Id, label: "Primary Renamed", key: maskKey(secretKey1), enabled: true },
          { label: "Secondary", key: secretKey2, enabled: true }
        ]
      }
    });
    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.provider.apiKeys.length, 2);
    assert.equal(updated.provider.apiKeys[0].maskedKey, maskKey(secretKey1));
    assert.equal(updated.provider.apiKeys[1].maskedKey, maskKey(secretKey2));
    assert.ok(!JSON.stringify(updated).includes(secretKey1));
    assert.ok(!JSON.stringify(updated).includes(secretKey2));

    // Verify stored plaintext key1 is still intact when routing
    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        messages: [{ role: "user", content: "ping" }]
      })
    });
    assert.equal(chatRes.status, 200);
    assert.equal(mock.requests[0].headers.authorization, `Bearer ${secretKey1}`);

    // Create Ollama with 0 keys (local URL) -> succeeds & routes without Authorization header
    const ollamaRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "ollama",
        name: "Local Ollama",
        slug: "local-ollama",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: [],
        models: ["llama3.2"]
      }
    });
    assert.equal(ollamaRes.status, 201);

    mock.reset();
    const ollamaChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "local-ollama/llama3.2",
        messages: [{ role: "user", content: "hello local" }]
      })
    });
    assert.equal(ollamaChat.status, 200);
    assert.equal(mock.requests[0].headers.authorization, undefined);

    // Test /api/providers/:id/test and /api/providers/:id/models
    const testProvRes = await apiFetch(`/api/providers/${providerId}/test`, {
      method: "POST",
      body: {}
    });
    assert.equal(testProvRes.status, 200);
    const testProvJson = await testProvRes.json();
    assert.equal(testProvJson.ok, true);
    assert.equal(testProvJson.modelsCount, 3);

    const fetchModelsRes = await apiFetch(`/api/providers/${providerId}/models`, {
      method: "POST",
      body: {}
    });
    assert.equal(fetchModelsRes.status, 200);
    const fetchModelsJson = await fetchModelsRes.json();
    assert.equal(fetchModelsJson.ok, true);
    assert.ok(fetchModelsJson.models.includes("claude-sonnet-4-20250514"));

    // Upstream error containing plaintext secret is redacted from response and logs
    mock.setHandler(({ res }) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: `Invalid token ${secretKey2}` } })
      );
      return true;
    });
    const errChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        messages: [{ role: "user", content: "trigger error" }]
      })
    });
    assert.equal(errChat.status, 400);
    const errText = await errChat.text();
    assert.ok(!errText.includes(secretKey2));
    assert.ok(errText.includes(maskKey(secretKey2)));
  });

  // Scenario 3: OpenAI non-stream, stream SSE, embeddings, and first-slash OpenRouter model split
  it("3. handles OpenAI non-stream, SSE stream, embeddings, and OpenRouter slash models", async () => {
    const orRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openrouter",
        name: "OpenRouter",
        slug: "openrouter",
        baseUrl: `${mock.baseUrl}/v1`,
        formatType: "openai",
        apiKeys: ["sk-or-test-key-9999"],
        models: ["anthropic/claude-3.5-sonnet"]
      }
    });
    assert.equal(orRes.status, 201);

    // /v1/models lists openrouter/anthropic/claude-3.5-sonnet
    const modelsRes = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${defaultRouterKey}` }
    });
    const modelsData = await modelsRes.json();
    assert.ok(modelsData.data.some((m) => m.id === "openrouter/anthropic/claude-3.5-sonnet"));

    // Non-stream split on FIRST `/`
    const nonStreamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "openrouter/anthropic/claude-3.5-sonnet",
        messages: [{ role: "user", content: "Hi" }]
      })
    });
    assert.equal(nonStreamRes.status, 200);
    const nonStreamJson = await nonStreamRes.json();
    assert.equal(nonStreamJson.choices[0].message.content, "Mock OpenAI reply");
    assert.equal(mock.requests[0].body.model, "anthropic/claude-3.5-sonnet");

    // Stream SSE passthrough
    const streamRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "openrouter/anthropic/claude-3.5-sonnet",
        stream: true,
        messages: [{ role: "user", content: "Stream hi" }]
      })
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get("content-type") || "", /text\/event-stream/);
    assert.equal(streamRes.headers.get("x-accel-buffering"), "no");
    const sseText = await streamRes.text();
    const frames = parseAllSSE(sseText);
    assert.ok(frames.some((f) => f.data === "[DONE]"));
    const contentText = frames
      .filter((f) => f.data !== "[DONE]")
      .map((f) => JSON.parse(f.data).choices?.[0]?.delta?.content || "")
      .join("");
    assert.equal(contentText, "Hello world!");

    // Embeddings passthrough
    const embRes = await fetch(`${baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "my-openai/text-embedding-3-small",
        input: "hello"
      })
    });
    assert.equal(embRes.status, 200);
    const embJson = await embRes.json();
    assert.deepEqual(embJson.data[0].embedding, [0.1, 0.2, 0.3]);
  });

  // Scenario 4: Combo 429 fallback + 1 hop logged + usage stats
  it("4. falls back across combo targets on 429 and logs 1 fallback hop", async () => {
    const p1Res = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "groq",
        name: "Primary Groq",
        slug: "primary-groq",
        baseUrl: `${mock.baseUrl}/groq/v1`,
        formatType: "openai",
        apiKeys: ["gsk_primary_1111"],
        models: ["llama-3.3-70b"]
      }
    });
    assert.equal(p1Res.status, 201);

    const p2Res = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "deepseek",
        name: "Backup DeepSeek",
        slug: "backup-deepseek",
        baseUrl: `${mock.baseUrl}/deepseek/v1`,
        formatType: "openai",
        apiKeys: ["sk-backup-2222"],
        models: ["deepseek-chat"]
      }
    });
    assert.equal(p2Res.status, 201);

    const comboRes = await apiFetch("/api/combos", {
      method: "POST",
      body: {
        name: "fast-combo",
        description: "Primary Groq then Backup DeepSeek",
        targets: ["primary-groq/llama-3.3-70b", "backup-deepseek/deepseek-chat"]
      }
    });
    assert.equal(comboRes.status, 201);

    // Clear previous logs so assertions are crystal clear
    await apiFetch("/api/logs", { method: "DELETE" });

    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/groq/")) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
        return true;
      }
      return false; // deepseek falls through to default 200 handler
    });

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "fast-combo",
        messages: [{ role: "user", content: "Fallback test" }]
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].message.content, "Mock OpenAI reply");

    const logsRes = await apiFetch("/api/logs?limit=10");
    const logsData = await logsRes.json();
    assert.equal(logsData.logs.length, 1);
    const entry = logsData.logs[0];
    assert.equal(entry.requestedModel, "fast-combo");
    assert.equal(entry.resolvedModel, "backup-deepseek/deepseek-chat");
    assert.equal(entry.providerSlug, "backup-deepseek");
    assert.equal(entry.status, 200);
    assert.equal(entry.fallbackHops, 1);
    assert.equal(entry.attemptTrail.length, 2);
    assert.equal(entry.attemptTrail[0].status, 429);
    assert.equal(entry.attemptTrail[1].status, 200);

    // Check usage summary
    const usageRes = await apiFetch("/api/usage?range=24h");
    const usageData = await usageRes.json();
    assert.equal(usageData.summary.totalRequests, 1);
    assert.equal(usageData.summary.successRequests, 1);
    assert.equal(usageData.summary.totalTokens, 18);
    assert.equal(usageData.byProvider[0].provider, "backup-deepseek");
  });

  // Scenario 5: Key round-robin + 60s cooldown on 429/401
  it("5. rotates keys round-robin and puts failing 429/401 key into 60s cooldown", async () => {
    const kA = "sk-rr-alpha-1111";
    const kB = "sk-rr-bravo-2222";
    const provRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "openai",
        name: "RR Provider",
        slug: "rr-provider",
        baseUrl: `${mock.baseUrl}/rr/v1`,
        formatType: "openai",
        apiKeys: [kA, kB],
        models: ["gpt-4o"]
      }
    });
    const prov = (await provRes.json()).provider;

    // Requests 1, 2, 3 alternate kA -> kB -> kA
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${defaultRouterKey}`
        },
        body: JSON.stringify({
          model: "rr-provider/gpt-4o",
          messages: [{ role: "user", content: `rr ${i}` }]
        })
      });
      assert.equal(r.status, 200);
    }
    assert.equal(mock.requests[0].headers.authorization, `Bearer ${kA}`);
    assert.equal(mock.requests[1].headers.authorization, `Bearer ${kB}`);
    assert.equal(mock.requests[2].headers.authorization, `Bearer ${kA}`);

    // Now next request would pick kB first; configure kB to return 429 -> falls back to kA within same request
    mock.reset();
    mock.setHandler(({ headers, res }) => {
      if (headers.authorization === `Bearer ${kB}`) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Quota hit on B" } }));
        return true;
      }
      return false;
    });

    const r4 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "rr-provider/gpt-4o",
        messages: [{ role: "user", content: "trigger cooldown on B" }]
      })
    });
    assert.equal(r4.status, 200);
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].headers.authorization, `Bearer ${kB}`);
    assert.equal(mock.requests[1].headers.authorization, `Bearer ${kA}`);

    // Verify kB has ~60s cooldownUntil in GET /api/providers
    const listProv = await (await apiFetch("/api/providers")).json();
    const updatedRR = listProv.providers.find((p) => p.id === prov.id);
    const keyBStatus = updatedRR.apiKeys[1];
    assert.ok(keyBStatus.cooldownUntil > Date.now() + 50_000);

    // Subsequent requests skip kB completely without hitting mock with kB
    mock.reset();
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${defaultRouterKey}`
        },
        body: JSON.stringify({
          model: "rr-provider/gpt-4o",
          messages: [{ role: "user", content: `skip B ${i}` }]
        })
      });
      assert.equal(r.status, 200);
    }
    assert.equal(mock.requests.length, 3);
    assert.ok(mock.requests.every((r) => r.headers.authorization === `Bearer ${kA}`));
  });

  // Scenario 6: /v1/messages translation (Anthropic -> OpenAI) with tool_use & Anthropic SSE event order
  it("6. translates /v1/messages <-> OpenAI including tools, images, thinking, and exact Anthropic SSE order", async () => {
    // Non-streaming tool_use round-trip
    mock.setHandler(({ body, res }) => {
      // Verify translated OpenAI request structure
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[0].content, "Be concise.");
      assert.equal(body.tools[0].function.name, "read_file");
      assert.deepEqual(body.tool_choice, {
        type: "function",
        function: { name: "read_file" }
      });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-tool-1",
          object: "chat.completion",
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                reasoning_content: "I should read package.json",
                content: "Let me check that file.",
                tool_calls: [
                  {
                    id: "call_read_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "package.json" })
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 40, completion_tokens: 18 }
        })
      );
      return true;
    });

    const msgRes = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": defaultRouterKey
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        max_tokens: 512,
        system: [{ type: "text", text: "Be concise." }],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"]
            }
          }
        ],
        tool_choice: { type: "tool", name: "read_file" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Inspect package.json and image" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "iVBORw0KGgo="
                }
              }
            ]
          }
        ]
      })
    });
    assert.equal(msgRes.status, 200);
    const msgJson = await msgRes.json();
    assert.equal(msgJson.type, "message");
    assert.equal(msgJson.role, "assistant");
    assert.equal(msgJson.stop_reason, "tool_use");
    assert.equal(msgJson.usage.input_tokens, 40);
    assert.equal(msgJson.usage.output_tokens, 18);
    assert.deepEqual(msgJson.content, [
      { type: "thinking", thinking: "I should read package.json" },
      { type: "text", text: "Let me check that file." },
      {
        type: "tool_use",
        id: "call_read_1",
        name: "read_file",
        input: { path: "package.json" }
      }
    ]);
    assert.equal(
      mock.requests[0].body.messages[1].content[1].image_url.url,
      "data:image/png;base64,iVBORw0KGgo="
    );

    // Streaming SSE translation: verify exact Anthropic event order with thinking + text + tool_use
    mock.reset();
    mock.setHandler(({ res }) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = [
        {
          id: "chatcmpl-s1",
          choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Thinking..." }, finish_reason: null }]
        },
        {
          id: "chatcmpl-s1",
          choices: [{ index: 0, delta: { content: "Working " }, finish_reason: null }]
        },
        {
          id: "chatcmpl-s1",
          choices: [{ index: 0, delta: { content: "on it." }, finish_reason: null }]
        },
        {
          id: "chatcmpl-s1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_t1", type: "function", function: { name: "run_cmd", arguments: '{"cmd":' } }
                ]
              },
              finish_reason: null
            }
          ]
        },
        {
          id: "chatcmpl-s1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }]
              },
              finish_reason: "tool_calls"
            }
          ]
        },
        {
          id: "chatcmpl-s1",
          choices: [],
          usage: { prompt_tokens: 25, completion_tokens: 19 }
        }
      ];
      for (const c of chunks) {
        res.write(`data: ${JSON.stringify(c)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    });

    const streamMsgRes = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": defaultRouterKey
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        max_tokens: 512,
        stream: true,
        messages: [{ role: "user", content: "Run ls" }]
      })
    });
    assert.equal(streamMsgRes.status, 200);
    assert.equal(streamMsgRes.headers.get("x-accel-buffering"), "no");
    const rawSse = await streamMsgRes.text();
    const events = parseAllSSE(rawSse);
    const eventNames = events.map((e) => e.event);

    assert.deepEqual(eventNames, [
      "message_start",
      "content_block_start", // index 0: thinking
      "content_block_delta", // thinking_delta
      "content_block_stop",  // stop index 0
      "content_block_start", // index 1: text
      "content_block_delta", // text_delta "Working "
      "content_block_delta", // text_delta "on it."
      "content_block_stop",  // stop index 1
      "content_block_start", // index 2: tool_use
      "content_block_delta", // input_json_delta '{"cmd":'
      "content_block_delta", // input_json_delta '"ls"}'
      "content_block_stop",  // stop index 2
      "message_delta",
      "message_stop"
    ]);

    const parsedEvents = events.map((e) => JSON.parse(e.data));
    assert.equal(parsedEvents[1].content_block.type, "thinking");
    assert.equal(parsedEvents[2].delta.type, "thinking_delta");
    assert.equal(parsedEvents[4].content_block.type, "text");
    assert.equal(parsedEvents[5].delta.type, "text_delta");
    assert.equal(parsedEvents[8].content_block.type, "tool_use");
    assert.equal(parsedEvents[8].content_block.name, "run_cmd");
    assert.equal(parsedEvents[9].delta.type, "input_json_delta");
    assert.equal(parsedEvents[12].delta.stop_reason, "tool_use");
    assert.equal(parsedEvents[12].usage.output_tokens, 19);

    // /v1/messages/count_tokens returns approximate input_tokens
    const countRes = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": defaultRouterKey
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        system: "Hello system",
        messages: [{ role: "user", content: "Count my tokens please" }]
      })
    });
    assert.equal(countRes.status, 200);
    const countJson = await countRes.json();
    assert.ok(countJson.input_tokens > 0);
  });

  // Scenario 7: Reverse OpenAI -> Anthropic translation (non-stream & stream) + official headers only
  it("7. translates OpenAI /v1/chat/completions to Anthropic official API (non-stream & stream)", async () => {
    const antRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "anthropic",
        name: "Official Anthropic",
        slug: "official-anthropic",
        baseUrl: `${mock.baseUrl}/anthropic`, // without trailing /v1 -> routes to /anthropic/v1/messages
        formatType: "anthropic",
        apiKeys: ["sk-ant-official-test-1234"],
        models: ["claude-sonnet-4-20250514"]
      }
    });
    assert.equal(antRes.status, 201);

    // Non-stream OpenAI client -> Anthropic upstream (including merging consecutive tool results)
    mock.setHandler(({ url, headers, body, res }) => {
      assert.equal(url, "/anthropic/v1/messages");
      assert.equal(headers["x-api-key"], "sk-ant-official-test-1234");
      assert.equal(headers["anthropic-version"], "2023-06-01");
      assert.equal(headers.authorization, undefined);
      // Consecutive tool messages merged into a single alternating user message
      assert.equal(body.system, "You are helpful.");
      assert.equal(body.messages.length, 3); // user -> assistant -> user(2 tool_results)
      assert.equal(body.messages[2].role, "user");
      assert.equal(body.messages[2].content.length, 2);
      assert.equal(body.messages[2].content[0].type, "tool_result");
      assert.equal(body.messages[2].content[1].type, "tool_result");

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_ant_1",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [
            { type: "text", text: "Combined results look good." }
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 33, output_tokens: 11 }
        })
      );
      return true;
    });

    const openaiNonStream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "official-anthropic/claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Run tools" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "t1", arguments: "{}" } },
              { id: "c2", type: "function", function: { name: "t2", arguments: "{}" } }
            ]
          },
          { role: "tool", tool_call_id: "c1", content: "out1" },
          { role: "tool", tool_call_id: "c2", content: "out2" }
        ]
      })
    });
    assert.equal(openaiNonStream.status, 200);
    const oaiJson = await openaiNonStream.json();
    assert.equal(oaiJson.object, "chat.completion");
    assert.equal(oaiJson.choices[0].message.content, "Combined results look good.");
    assert.equal(oaiJson.choices[0].finish_reason, "stop");
    assert.deepEqual(oaiJson.usage, {
      prompt_tokens: 33,
      completion_tokens: 11,
      total_tokens: 44
    });

    // Streaming OpenAI client -> Anthropic upstream
    mock.reset();
    const openaiStream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "official-anthropic/claude-sonnet-4-20250514",
        stream: true,
        messages: [{ role: "user", content: "Stream from Claude" }]
      })
    });
    assert.equal(openaiStream.status, 200);
    const streamFrames = parseAllSSE(await openaiStream.text());
    assert.ok(streamFrames.some((f) => f.data === "[DONE]"));
    const joined = streamFrames
      .filter((f) => f.data !== "[DONE]")
      .map((f) => JSON.parse(f.data).choices?.[0]?.delta?.content || "")
      .join("");
    assert.equal(joined, "Mock Anthropic stream");
  });

  // Scenario 8: Token Saver truncation, line normalization, dedupe, and savedChars logged
  it("8. compresses tool & long user messages via Token Saver and logs savedChars", async () => {
    // Set smaller tokenSaverMaxChars so truncation triggers cleanly
    const setRes = await apiFetch("/api/settings", {
      method: "PUT",
      body: { tokenSaverEnabled: true, tokenSaverMaxChars: 1200 }
    });
    assert.equal(setRes.status, 200);

    await apiFetch("/api/logs", { method: "DELETE" });

    // Unit verify compressText details
    const sample =
      "header   \r\n\r\n\r\n\r\n\r\nline\r\nline\r\nline\r\nline\r\nline\r\n" +
      "A".repeat(2500);
    const unitCompressed = compressText(sample, 1200);
    assert.ok(unitCompressed.text.length <= 1200);
    assert.ok(unitCompressed.text.includes("... (3 similar lines)"));
    assert.ok(unitCompressed.text.includes("001Router Token Saver"));
    assert.ok(unitCompressed.savedChars > 1000);

    // End-to-end request through /v1/chat/completions
    const longToolOut = "WARN: retrying   \r\n".repeat(10) + "\r\n\r\n\r\n\r\n" + "X".repeat(3000);
    const longUserText = "U".repeat(2500);

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        messages: [
          { role: "user", content: longUserText },
          { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function", function: { name: "log", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "tc1", content: longToolOut }
        ]
      })
    });
    assert.equal(res.status, 200);

    // Verify upstream received compressed messages
    const sentUser = mock.requests[0].body.messages[0].content;
    const sentTool = mock.requests[0].body.messages[2].content;
    assert.ok(sentUser.length <= 1200);
    assert.ok(sentTool.length <= 1200);
    assert.ok(sentTool.includes("... (8 similar lines)"));
    assert.ok(sentTool.includes("001Router Token Saver"));

    const logsJson = await (await apiFetch("/api/logs?limit=5")).json();
    assert.ok(logsJson.logs[0].savedChars > 3000);

    const usageJson = await (await apiFetch("/api/usage?range=24h")).json();
    assert.ok(usageJson.summary.savedChars > 3000);

    // Disable tokenSaver and verify zero compression
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { tokenSaverEnabled: false, tokenSaverMaxChars: 20000 }
    });
    mock.reset();
    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "my-openai/gpt-4o",
        messages: [{ role: "tool", tool_call_id: "tc2", content: "exact   \r\n\r\n\r\n\r\nkeep" }]
      })
    });
    assert.equal(mock.requests[0].body.messages[0].content, "exact   \r\n\r\n\r\n\r\nkeep");

    // Re-enable tokenSaver default
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { tokenSaverEnabled: true, tokenSaverMaxChars: 20000 }
    });
  });

  // Scenario 9: Client abort cancellation & no post-first-byte fallback (+ pre-first-byte fallback)
  it("9. aborts upstream cleanly on client disconnect and never falls back after first SSE byte", async () => {
    // Use dedicated providers/combo so earlier 60s cooldown tests never affect Scenario 9
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Stream Primary",
        slug: "stream-primary",
        baseUrl: `${mock.baseUrl}/sp/v1`,
        formatType: "openai",
        apiKeys: ["sk-sp-1111"],
        models: ["m1"]
      }
    });
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Stream Backup",
        slug: "stream-backup",
        baseUrl: `${mock.baseUrl}/sb/v1`,
        formatType: "openai",
        apiKeys: ["sk-sb-2222"],
        models: ["m2"]
      }
    });
    await apiFetch("/api/combos", {
      method: "POST",
      body: {
        name: "stream-combo",
        targets: ["stream-primary/m1", "stream-backup/m2"]
      }
    });

    // Part A: Client aborts while upstream delays -> upstream sees abort and backup is NOT called
    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/sp/")) {
        const t = setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: "late" } }] }));
          }
        }, 1000);
        res.on("close", () => clearTimeout(t));
        return true;
      }
      return false;
    });

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(
      fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${defaultRouterKey}`
        },
        body: JSON.stringify({
          model: "stream-combo",
          messages: [{ role: "user", content: "abort me" }]
        }),
        signal: ac.signal
      })
    );

    // Wait briefly so close handler settles
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].aborted, true);

    // Part B: Primary sends 200 + first SSE chunk then destroys socket -> NO fallback to backup!
    mock.reset();
    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/sp/")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({
            id: "partial-1",
            choices: [{ index: 0, delta: { content: "FirstChunk" }, finish_reason: null }]
          })}\n\n`
        );
        setTimeout(() => {
          res.socket?.destroy();
        }, 20);
        return true;
      }
      return false;
    });

    const partialRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "stream-combo",
        stream: true,
        messages: [{ role: "user", content: "mid stream failure" }]
      })
    });
    assert.equal(partialRes.status, 200);
    const partialText = await partialRes.text().catch(() => "");
    assert.ok(partialText.includes("FirstChunk"));
    // Backup must NEVER have been called!
    assert.equal(mock.requests.filter((r) => r.url.startsWith("/sb/")).length, 0);

    // Part C: Primary fails BEFORE first byte (drops 200 with 0 bytes) -> DOES fall back to backup!
    mock.reset();
    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/sp/")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(); // 0 bytes sent!
        return true;
      }
      return false;
    });

    const recoveredStream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "stream-combo",
        stream: true,
        messages: [{ role: "user", content: "pre-first-byte failure" }]
      })
    });
    assert.equal(recoveredStream.status, 200);
    const recoveredText = await recoveredStream.text();
    assert.ok(recoveredText.includes("Hello "));
    assert.ok(recoveredText.includes("world!"));
    assert.equal(mock.requests.filter((r) => r.url.startsWith("/sb/")).length, 1);
  });

  // Scenario 10: Import/Export, Router key CRUD, Password change, and Log retention cap (5000)
  it("10. supports export/import, key CRUD, password change, and enforces 5000-log retention", async () => {
    // Export full config (includes unmasked upstream keys per API.md)
    const expRes = await apiFetch("/api/export");
    assert.equal(expRes.status, 200);
    const exported = await expRes.json();
    assert.equal(exported.version, 1);
    assert.ok(exported.providers.length >= 4);
    assert.ok(exported.combos.length >= 1);
    assert.ok(exported.keys.length >= 1);

    // Create a second router key and toggle it disabled
    const newKeyRes = await apiFetch("/api/keys", {
      method: "POST",
      body: { name: "Temp Key" }
    });
    assert.equal(newKeyRes.status, 201);
    const tempKey = (await newKeyRes.json()).key;
    assert.match(tempKey.key, /^sk-001r-/);

    const patchKeyRes = await apiFetch(`/api/keys/${tempKey.id}`, {
      method: "PATCH",
      body: { enabled: false, name: "Disabled Temp" }
    });
    assert.equal(patchKeyRes.status, 200);
    assert.equal((await patchKeyRes.json()).key.enabled, false);

    // Disabled router key gets 401 on /v1/models
    const disabledCheck = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${tempKey.key}` }
    });
    assert.equal(disabledCheck.status, 401);

    // Delete temp key
    const delKeyRes = await apiFetch(`/api/keys/${tempKey.id}`, { method: "DELETE" });
    assert.equal(delKeyRes.status, 200);

    // Import in replace mode restores exact exported snapshot
    const impReplace = await apiFetch("/api/import", {
      method: "POST",
      body: { ...exported, mode: "replace" }
    });
    assert.equal(impReplace.status, 200);
    const impCounts = (await impReplace.json()).counts;
    assert.equal(impCounts.providers, exported.providers.length);
    assert.equal(impCounts.combos, exported.combos.length);

    // Import in merge mode adds a new combo without dropping existing ones
    const impMerge = await apiFetch("/api/import", {
      method: "POST",
      body: {
        mode: "merge",
        combos: [
          {
            name: "merged-combo",
            description: "Added via merge",
            targets: ["my-openai/gpt-4o"]
          }
        ]
      }
    });
    assert.equal(impMerge.status, 200);
    const mergeCounts = (await impMerge.json()).counts;
    assert.equal(mergeCounts.combos, exported.combos.length + 1);

    // Password change
    const badPwChange = await apiFetch("/api/settings/password", {
      method: "POST",
      body: { currentPassword: "wrong", newPassword: "new-secret-pass" }
    });
    assert.equal(badPwChange.status, 401);

    const shortPwChange = await apiFetch("/api/settings/password", {
      method: "POST",
      body: { currentPassword: "1234", newPassword: "12" }
    });
    assert.equal(shortPwChange.status, 400);

    const okPwChange = await apiFetch("/api/settings/password", {
      method: "POST",
      body: { currentPassword: "1234", newPassword: "new-secret-pass" }
    });
    assert.equal(okPwChange.status, 200);

    // Old password fails, new password succeeds
    const oldLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "new-secret-pass" })
    });
    assert.equal(newLogin.status, 200);
    sessionCookie = extractCookie(newLogin);

    // Verify requireKey=false allows keyless /v1/* access
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { requireKey: false }
    });
    const keylessModels = await fetch(`${baseUrl}/v1/models`);
    assert.equal(keylessModels.status, 200);
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { requireKey: true }
    });

    // Verify 5000 log cap in storage
    await app.storage.update((data) => {
      data.logs = Array.from({ length: 5000 }, (_, i) => ({
        id: `seed-${i}`,
        timestamp: new Date().toISOString(),
        status: 200,
        latencyMs: 1,
        promptTokens: 0,
        completionTokens: 0,
        savedChars: 0,
        fallbackHops: 0,
        attemptTrail: []
      }));
    });
    await app.storage.recordRequestLog({
      id: "newest-entry",
      timestamp: new Date().toISOString(),
      status: 200,
      latencyMs: 5,
      promptTokens: 1,
      completionTokens: 1,
      savedChars: 0,
      fallbackHops: 0,
      attemptTrail: []
    });
    assert.equal(app.storage.getLogs().length, MAX_LOGS);
    assert.equal(app.storage.getLogs()[0].id, "newest-entry");

    // Verify translator helpers handle edge cases directly
    const oaiReq = claudeToOpenAIRequest(
      {
        system: "sys",
        messages: [
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "ok" },
              { type: "text", text: "next step" }
            ]
          }
        ]
      },
      "gpt-4o"
    );
    assert.equal(oaiReq.messages.length, 3);
    assert.equal(oaiReq.messages[1].role, "tool");
    assert.equal(oaiReq.messages[2].role, "user");

    const claudeReq = openaiToClaudeRequest(
      {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hi" }]
      },
      "claude-sonnet-4-20250514"
    );
    assert.equal(claudeReq.max_tokens, 4096);

    // Verify applyTokenSaver respects disabled flag cleanly
    const untouched = applyTokenSaver(
      { messages: [{ role: "tool", content: "a\r\n" }] },
      "openai",
      { tokenSaverEnabled: false }
    );
    assert.equal(untouched.savedChars, 0);
  });

  // Scenario 11: Anthropic passthrough + tool_result Token Saver, 401/timeout fallback, omitted key preservation, CRUD & concurrent writes
  it("11. covers Anthropic passthrough, tool_result Token Saver, 401/timeout fallback, omitted key PUT, CRUD, and concurrent writes", async () => {
    // URL normalization with and without trailing /v1 for Anthropic
    assert.equal(
      buildUpstreamUrl("https://api.anthropic.com", "anthropic", "messages"),
      "https://api.anthropic.com/v1/messages"
    );
    assert.equal(
      buildUpstreamUrl("https://api.anthropic.com/v1/", "anthropic", "messages"),
      "https://api.anthropic.com/v1/messages"
    );

    // Anthropic passthrough (/v1/messages -> formatType: "anthropic") + tool_result Token Saver
    await apiFetch("/api/logs", { method: "DELETE" });
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { tokenSaverEnabled: true, tokenSaverMaxChars: 800 }
    });

    const antPassthrough = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": defaultRouterKey
      },
      body: JSON.stringify({
        model: "official-anthropic/claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "dup line\r\n".repeat(6) + "Z".repeat(1500)
              }
            ]
          }
        ]
      })
    });
    assert.equal(antPassthrough.status, 200);
    const antJson = await antPassthrough.json();
    assert.equal(antJson.content[0].text, "Mock Anthropic reply");
    const sentBlock = mock.requests[0].body.messages[0].content[0].content;
    assert.ok(sentBlock.length <= 800);
    assert.ok(sentBlock.includes("... (4 similar lines)"));

    // Anthropic passthrough SSE stream
    mock.reset();
    const antStream = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": defaultRouterKey
      },
      body: JSON.stringify({
        model: "official-anthropic/claude-sonnet-4-20250514",
        max_tokens: 256,
        stream: true,
        messages: [{ role: "user", content: "stream passthrough" }]
      })
    });
    assert.equal(antStream.status, 200);
    const antStreamEvents = parseAllSSE(await antStream.text());
    assert.equal(antStreamEvents[0].event, "message_start");
    assert.equal(antStreamEvents[antStreamEvents.length - 1].event, "message_stop");

    // 401 key cooldown + timeout fallback in combo
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { timeoutMs: 120, tokenSaverMaxChars: 20000 }
    });
    const slowProvRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "Slow Prov",
        slug: "slow-prov",
        baseUrl: `${mock.baseUrl}/slow/v1`,
        formatType: "openai",
        apiKeys: ["sk-slow-1111", "sk-slow-2222"],
        models: ["m1"]
      }
    });
    const slowProv = (await slowProvRes.json()).provider;

    // PUT omitting `key` preserves stored plaintext keys
    const omitPutRes = await apiFetch(`/api/providers/${slowProv.id}`, {
      method: "PUT",
      body: {
        apiKeys: [
          { id: slowProv.apiKeys[0].id, label: "Kept", enabled: true },
          { id: slowProv.apiKeys[1].id, label: "Kept2", enabled: true }
        ]
      }
    });
    assert.equal(omitPutRes.status, 200);
    assert.equal((await omitPutRes.json()).provider.apiKeys[0].maskedKey, maskKey("sk-slow-1111"));

    const timeoutComboRes = await apiFetch("/api/combos", {
      method: "POST",
      body: {
        name: "timeout-combo",
        targets: ["slow-prov/m1", "my-openai/gpt-4o"]
      }
    });
    const timeoutCombo = (await timeoutComboRes.json()).combo;

    mock.reset();
    mock.setHandler(({ url, headers, res }) => {
      if (url.startsWith("/slow/")) {
        if (headers.authorization === "Bearer sk-slow-1111") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Invalid key 1" } }));
          return true;
        }
        // Key 2 hangs past 120ms timeoutMs
        const t = setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end("{}");
          }
        }, 500);
        res.on("close", () => clearTimeout(t));
        return true;
      }
      return false;
    });

    const fallbackRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "timeout-combo",
        messages: [{ role: "user", content: "401 then timeout fallback" }]
      })
    });
    assert.equal(fallbackRes.status, 200);

    // Verify logs filtering works (?status=, ?provider=, ?model=)
    const filteredLogs = await (
      await apiFetch("/api/logs?status=200&provider=my-openai&model=gpt-4o")
    ).json();
    assert.ok(filteredLogs.total >= 1);
    assert.equal(filteredLogs.logs[0].fallbackHops, 2); // 401 on k1 + 504 timeout on k2 + 200 on my-openai
    assert.equal(filteredLogs.logs[0].attemptTrail[0].status, 401);
    assert.equal(filteredLogs.logs[0].attemptTrail[1].status, 504);
    assert.equal(filteredLogs.logs[0].attemptTrail[2].status, 200);

    // Verify Combo PUT & DELETE, Provider DELETE
    const putCombo = await apiFetch(`/api/combos/${timeoutCombo.id}`, {
      method: "PUT",
      body: { description: "Updated desc", enabled: false }
    });
    assert.equal(putCombo.status, 200);
    assert.equal((await putCombo.json()).combo.enabled, false);

    const delCombo = await apiFetch(`/api/combos/${timeoutCombo.id}`, {
      method: "DELETE"
    });
    assert.equal(delCombo.status, 200);

    const delProv = await apiFetch(`/api/providers/${slowProv.id}`, {
      method: "DELETE"
    });
    assert.equal(delProv.status, 200);

    // Concurrent serialized atomic writes never lose updates or corrupt db.json
    await Promise.all(
      Array.from({ length: 15 }, (_, idx) =>
        app.storage.recordRequestLog({
          id: `concurrent-${idx}`,
          timestamp: new Date().toISOString(),
          status: 200,
          latencyMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: []
        })
      )
    );
    // Request logs are visible in memory immediately and coalesced to disk on a short timer.
    assert.ok(app.storage.data.logs.some((l) => l.id === "concurrent-14"));
    await app.storage.flushDeferred();
    const dbText = await fs.readFile(path.join(tmpDir, "db.json"), "utf8");
    const parsedDb = JSON.parse(dbText);
    for (let i = 0; i < 15; i++) {
      assert.ok(parsedDb.logs.some((l) => l.id === `concurrent-${i}`));
    }
  });

  // Scenario 12 (v1.1): 32+ official presets catalog with categories, metadata & keyless local LLMs
  it("12. returns 32+ ToS-compliant presets with categories/metadata and supports keyless vllm/llamacpp", async () => {
    const res = await apiFetch("/api/providers");
    assert.equal(res.status, 200);
    const { presets } = await res.json();
    assert.ok(presets.length >= 32, `Expected >= 32 presets, got ${presets.length}`);

    const byPreset = new Map(presets.map((p) => [p.preset, p]));
    const categories = new Set(presets.map((p) => p.category));
    for (const requiredCat of ["apikey", "custom", "free-tier", "local"]) {
      assert.ok(categories.has(requiredCat), `Missing preset category '${requiredCat}'`);
    }

    // Verify required free-tier, apikey, local, and custom presets
    for (const key of [
      "gemini", "groq", "cerebras", "openrouter", "nvidia", "sambanova", "huggingface", "mistral", "cloudflare",
      "openai", "anthropic", "deepseek", "xai", "together", "fireworks", "perplexity", "cohere", "glm",
      "kimi", "minimax", "alibaba", "siliconflow", "nebius", "hyperbolic", "chutes", "venice", "vercel", "featherless",
      "ollama", "lmstudio", "vllm", "llamacpp",
      "custom-openai", "custom-anthropic", "custom"
    ]) {
      const p = byPreset.get(key);
      assert.ok(p, `Missing preset '${key}'`);
      assert.equal(typeof p.name, "string");
      assert.ok(p.name.length > 0);
      assert.equal(typeof p.color, "string");
      assert.match(p.color, /^#[0-9a-fA-F]{6}$/);
      assert.equal(typeof p.monogram, "string");
      assert.ok(p.monogram.length >= 2);
      assert.ok(Array.isArray(p.models));
      assert.ok(["openai", "anthropic", "gemini-openai"].includes(p.formatType));
    }

    // All local presets have keyOptional: true
    for (const localKey of ["ollama", "lmstudio", "vllm", "llamacpp"]) {
      assert.equal(byPreset.get(localKey).category, "local");
      assert.equal(byPreset.get(localKey).keyOptional, true);
    }

    // Keyless vLLM provider works even when baseUrl isn't checked via preset-only hardcoding
    const vllmRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "vllm",
        name: "Local vLLM",
        slug: "local-vllm",
        baseUrl: `${mock.baseUrl}/vllm/v1`,
        formatType: "openai",
        apiKeys: [],
        models: ["default"]
      }
    });
    assert.equal(vllmRes.status, 201);
    const vllmChat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "local-vllm/default",
        messages: [{ role: "user", content: "hi vllm" }]
      })
    });
    assert.equal(vllmChat.status, 200);
    assert.equal(mock.requests[0].headers.authorization, undefined);
  });

  // Scenario 13 (v1.1): Batch provider connection test (POST /api/providers/test-all)
  it("13. runs batch connection tests via POST /api/providers/test-all with filters", async () => {
    // Restore comfortable timeoutMs after Scenario 11 lowered it
    await apiFetch("/api/settings", {
      method: "PUT",
      body: { timeoutMs: 30000 }
    });

    const pGoodRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "nvidia",
        name: "NVIDIA Good",
        slug: "nvidia-good",
        baseUrl: `${mock.baseUrl}/nv-ok/v1`,
        formatType: "openai",
        apiKeys: ["nvapi-good-1111"],
        models: ["meta/llama-3.3-70b-instruct"]
      }
    });
    assert.equal(pGoodRes.status, 201);
    const pGood = (await pGoodRes.json()).provider;

    const pFailRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "sambanova",
        name: "SambaNova Bad",
        slug: "sambanova-bad",
        baseUrl: `${mock.baseUrl}/sn-fail/v1`,
        formatType: "openai",
        apiKeys: ["sn-bad-2222"],
        models: ["Meta-Llama-3.3-70B-Instruct"]
      }
    });
    assert.equal(pFailRes.status, 201);
    const pFail = (await pFailRes.json()).provider;

    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/sn-fail/")) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid key sn-bad-2222" } }));
        return true;
      }
      return false;
    });

    // Test with providerIds filter
    const subsetRes = await apiFetch("/api/providers/test-all", {
      method: "POST",
      body: { providerIds: [pGood.id, pFail.id] }
    });
    assert.equal(subsetRes.status, 200);
    const subsetData = await subsetRes.json();
    assert.equal(subsetData.results.length, 2);

    const goodResult = subsetData.results.find((r) => r.providerId === pGood.id);
    const failResult = subsetData.results.find((r) => r.providerId === pFail.id);
    assert.equal(goodResult.ok, true);
    assert.equal(goodResult.status, 200);
    assert.equal(goodResult.modelsCount, 3);
    assert.equal(goodResult.slug, "nvidia-good");

    assert.equal(failResult.ok, false);
    assert.equal(failResult.status, 401);
    assert.ok(!failResult.message.includes("sn-bad-2222"));

    // Test with category filter ("free-tier")
    const catRes = await apiFetch("/api/providers/test-all", {
      method: "POST",
      body: { category: "free-tier" }
    });
    assert.equal(catRes.status, 200);
    const catData = await catRes.json();
    assert.ok(catData.results.length >= 2);
    assert.ok(catData.results.some((r) => r.providerId === pGood.id));
    assert.ok(catData.results.some((r) => r.providerId === pFail.id));
    // Non-free-tier provider (my-openai) must not be in free-tier results
    assert.ok(!catData.results.some((r) => r.slug === "my-openai"));
  });

  // Scenario 14 (v1.1): Combo round-robin strategy + circular 429 fallback
  it("14. supports combo strategy 'round-robin' rotating targets and falling back on 429", async () => {
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "RR Target A",
        slug: "rr-target-a",
        baseUrl: `${mock.baseUrl}/rra/v1`,
        formatType: "openai",
        apiKeys: ["sk-rra-1111"],
        models: ["model-a"]
      }
    });
    await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "custom",
        name: "RR Target B",
        slug: "rr-target-b",
        baseUrl: `${mock.baseUrl}/rrb/v1`,
        formatType: "openai",
        apiKeys: ["sk-rrb-2222"],
        models: ["model-b"]
      }
    });

    // Reject invalid strategy
    const badComboRes = await apiFetch("/api/combos", {
      method: "POST",
      body: {
        name: "invalid-strat-combo",
        strategy: "random",
        targets: ["rr-target-a/model-a", "rr-target-b/model-b"]
      }
    });
    assert.equal(badComboRes.status, 400);

    // Create round-robin combo
    const rrComboRes = await apiFetch("/api/combos", {
      method: "POST",
      body: {
        name: "rr-combo",
        description: "Round robin A/B",
        strategy: "round-robin",
        targets: ["rr-target-a/model-a", "rr-target-b/model-b"]
      }
    });
    assert.equal(rrComboRes.status, 201);
    const rrCombo = (await rrComboRes.json()).combo;
    assert.equal(rrCombo.strategy, "round-robin");

    // 3 requests should rotate: A -> B -> A
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${defaultRouterKey}`
        },
        body: JSON.stringify({
          model: "rr-combo",
          messages: [{ role: "user", content: `turn ${i}` }]
        })
      });
      assert.equal(r.status, 200);
    }
    assert.equal(mock.requests.length, 3);
    assert.ok(mock.requests[0].url.startsWith("/rra/"));
    assert.ok(mock.requests[1].url.startsWith("/rrb/"));
    assert.ok(mock.requests[2].url.startsWith("/rra/"));

    // Next request starts at B; make B return 429 -> should fall back circularly to A!
    mock.reset();
    mock.setHandler(({ url, res }) => {
      if (url.startsWith("/rrb/")) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limited on B" } }));
        return true;
      }
      return false;
    });

    const fallbackRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "rr-combo",
        messages: [{ role: "user", content: "rr fallback" }]
      })
    });
    assert.equal(fallbackRes.status, 200);
    assert.equal(mock.requests.length, 2);
    assert.ok(mock.requests[0].url.startsWith("/rrb/"));
    assert.ok(mock.requests[1].url.startsWith("/rra/"));

    // Can switch strategy via PUT /api/combos/:id
    const putStrat = await apiFetch(`/api/combos/${rrCombo.id}`, {
      method: "PUT",
      body: { strategy: "fallback" }
    });
    assert.equal(putStrat.status, 200);
    assert.equal((await putStrat.json()).combo.strategy, "fallback");
  });

  // Scenario 15 (v1.1): Quota & Budget Tracker (/api/quota & PUT /api/quota/:providerId + migration safety)
  it("15. tracks per-provider usage/cooldowns and persists budgets via /api/quota", async () => {
    await apiFetch("/api/logs", { method: "DELETE" });

    const qProvRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "gemini",
        name: "Quota Gemini",
        slug: "quota-gemini",
        baseUrl: `${mock.baseUrl}/qgem/v1`,
        formatType: "gemini-openai",
        apiKeys: ["AIza-key-1111", "AIza-key-2222"],
        models: ["gemini-2.5-flash"]
      }
    });
    assert.equal(qProvRes.status, 201);
    const qProv = (await qProvRes.json()).provider;

    // Make key 1 return 429 so key 1 enters cooldown and key 2 succeeds
    mock.setHandler(({ headers, res }) => {
      if (headers.authorization === "Bearer AIza-key-1111") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Quota exceeded" } }));
        return true;
      }
      return false;
    });

    const okReq = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "quota-gemini/gemini-2.5-flash",
        messages: [{ role: "user", content: "count my quota" }]
      })
    });
    assert.equal(okReq.status, 200);

    // Also trigger 1 error request (400) for error counting
    mock.setHandler(({ res }) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bad prompt" } }));
      return true;
    });
    const errReq = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "quota-gemini/gemini-2.5-flash",
        messages: [{ role: "user", content: "trigger err" }]
      })
    });
    assert.equal(errReq.status, 400);

    // Set budget limits via PUT /api/quota/:providerId
    const badQuota = await apiFetch(`/api/quota/${qProv.id}`, {
      method: "PUT",
      body: { dailyTokenLimit: -5 }
    });
    assert.equal(badQuota.status, 400);

    const missingQuota = await apiFetch("/api/quota/nonexistent-id", {
      method: "PUT",
      body: { dailyTokenLimit: 1000 }
    });
    assert.equal(missingQuota.status, 404);

    const setQuota = await apiFetch(`/api/quota/${qProv.id}`, {
      method: "PUT",
      body: {
        dailyTokenLimit: 100000,
        dailyRequestLimit: 500,
        monthlyTokenLimit: 2000000
      }
    });
    assert.equal(setQuota.status, 200);
    const setQuotaJson = await setQuota.json();
    assert.equal(setQuotaJson.ok, true);
    assert.deepEqual(setQuotaJson.budget, {
      dailyTokenLimit: 100000,
      dailyRequestLimit: 500,
      monthlyTokenLimit: 2000000
    });

    // Verify GET /api/quota returns accurate stats, cooldowns, and budget
    const quotaRes = await apiFetch("/api/quota");
    assert.equal(quotaRes.status, 200);
    const quotaJson = await quotaRes.json();
    const item = quotaJson.items.find((i) => i.providerId === qProv.id);
    assert.ok(item);
    assert.equal(item.slug, "quota-gemini");
    assert.equal(item.preset, "gemini");
    assert.equal(item.activeKeys, 1);
    assert.equal(item.cooldownKeys, 1);
    assert.ok(item.maxCooldownRemainingMs > 40_000);
    assert.equal(item.today.requests, 2);
    assert.equal(item.today.tokens, 18); // 10 prompt + 8 completion from mock default
    assert.equal(item.today.errors, 1);
    assert.equal(item.month.requests, 2);
    assert.equal(item.month.tokens, 18);
    assert.equal(item.month.errors, 1);
    assert.deepEqual(item.budget, {
      dailyTokenLimit: 100000,
      dailyRequestLimit: 500,
      monthlyTokenLimit: 2000000
    });

    // Verify export includes quotas and migration works on legacy db.json without quotas
    const expJson = await (await apiFetch("/api/export")).json();
    assert.deepEqual(expJson.quotas[qProv.id], {
      dailyTokenLimit: 100000,
      dailyRequestLimit: 500,
      monthlyTokenLimit: 2000000
    });

    // Migration test: legacy db.json missing `quotas` initializes cleanly to `{}`
    const migDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-mig-"));
    try {
      await fs.writeFile(
        path.join(migDir, "db.json"),
        JSON.stringify({ version: 1, providers: [], combos: [], logs: [] }),
        "utf8"
      );
      const migApp = await createApp({ dataDir: migDir, port: 20129, webDistDir });
      assert.deepEqual(migApp.storage.getQuotas(), {});
    } finally {
      await fs.rm(migDir, { recursive: true, force: true });
    }
  });

  // Scenario 16 (v1.1): Live Token Saver Tester (POST /api/token-saver/test)
  it("16. tests live Token Saver compression via POST /api/token-saver/test", async () => {
    const badRes = await apiFetch("/api/token-saver/test", {
      method: "POST",
      body: { text: 12345 }
    });
    assert.equal(badRes.status, 400);

    const sample =
      "INFO: starting build   \r\n" +
      "WARN: cache miss   \r\n".repeat(12) +
      "\r\n\r\n\r\n\r\n" +
      "X".repeat(2000);

    const testRes = await apiFetch("/api/token-saver/test", {
      method: "POST",
      body: { text: sample, maxChars: 600 }
    });
    assert.equal(testRes.status, 200);
    const data = await testRes.json();
    assert.equal(data.originalChars, sample.length);
    assert.ok(data.compressedChars <= 600);
    assert.equal(data.savedChars, data.originalChars - data.compressedChars);
    assert.ok(data.savedPercent > 50);
    assert.equal(data.estTokensSaved, Math.round(data.savedChars / 4));
    assert.ok(data.compressedText.includes("... (10 similar lines)"));
    assert.ok(data.compressedText.includes("001Router Token Saver"));
  });

  // Scenario 17 (v1.1): Live Translator Debugger (POST /api/debug/translate)
  it("17. translates payloads live via POST /api/debug/translate in both directions", async () => {
    const badDir = await apiFetch("/api/debug/translate", {
      method: "POST",
      body: { direction: "invalid", payload: {} }
    });
    assert.equal(badDir.status, 400);

    // claude-to-openai
    const c2oRes = await apiFetch("/api/debug/translate", {
      method: "POST",
      body: {
        direction: "claude-to-openai",
        payload: {
          model: "gpt-4o",
          max_tokens: 256,
          system: "You are a debugger.",
          tools: [
            {
              name: "get_time",
              description: "Get current time",
              input_schema: { type: "object", properties: {} }
            }
          ],
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: "What time is it?" }]
        }
      }
    });
    assert.equal(c2oRes.status, 200);
    const c2o = await c2oRes.json();
    assert.equal(c2o.ok, true);
    assert.equal(c2o.direction, "claude-to-openai");
    assert.equal(c2o.translated.model, "gpt-4o");
    assert.equal(c2o.translated.messages[0].role, "system");
    assert.equal(c2o.translated.messages[0].content, "You are a debugger.");
    assert.equal(c2o.translated.tools[0].function.name, "get_time");
    assert.equal(c2o.translated.tool_choice, "required");

    // openai-to-claude
    const o2cRes = await apiFetch("/api/debug/translate", {
      method: "POST",
      body: {
        direction: "openai-to-claude",
        payload: {
          model: "claude-sonnet-4-20250514",
          messages: [
            { role: "system", content: "Be brief." },
            { role: "user", content: "Hello Claude" }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "ping",
                description: "Ping host",
                parameters: { type: "object", properties: { host: { type: "string" } } }
              }
            }
          ],
          tool_choice: "auto"
        }
      }
    });
    assert.equal(o2cRes.status, 200);
    const o2c = await o2cRes.json();
    assert.equal(o2c.ok, true);
    assert.equal(o2c.direction, "openai-to-claude");
    assert.equal(o2c.translated.model, "claude-sonnet-4-20250514");
    assert.equal(o2c.translated.system, "Be brief.");
    assert.equal(o2c.translated.messages.length, 1);
    assert.equal(o2c.translated.messages[0].role, "user");
    assert.equal(o2c.translated.tools[0].name, "ping");
    assert.deepEqual(o2c.translated.tool_choice, { type: "auto" });
  });

  // Scenario 18: Package / Token-Plan 403 error ("không nằm trong gói token") triggers model-scoped cooldown + auto fallback
  it("18. falls back automatically when a provider key rejects a model as not in its token package, while preserving disabled-model/ACL blocks", async () => {
    const pkgProvRes = await apiFetch("/api/providers", {
      method: "POST",
      body: {
        preset: "deepseek",
        name: "Package DeepSeek",
        slug: "pkg-deepseek",
        baseUrl: `${mock.baseUrl}/pkg-ds/v1`,
        formatType: "openai",
        apiKeys: [
          { label: "pkg-only-ds", key: "sk-pkg-ds-only-1111", enabled: true }
        ],
        models: ["claude-fable-5.1", "deepseek-v4.1-flash"],
        autoSyncModels: true
      }
    });
    assert.equal(pkgProvRes.status, 201);
    const pkgProv = (await pkgProvRes.json()).provider;

    mock.reset();
    mock.setHandler(({ url, body, res }) => {
      if (url.startsWith("/pkg-ds/") && body?.model === "claude-fable-5.1") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Model claude-fable-5.1 không nằm trong gói token của key này.",
              type: "api_error"
            }
          })
        );
        return true;
      }
      return false;
    });

    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "pkg-deepseek/claude-fable-5.1",
        messages: [{ role: "user", content: "Package fallback check" }]
      })
    });
    assert.equal(chatRes.status, 200);
    const chatJson = await chatRes.json();
    assert.ok(chatJson.choices?.[0]?.message?.content);
    assert.ok(
      mock.requests.length >= 2,
      `Expected upstream fallback attempt after package 403, got ${mock.requests.length}`
    );

    // Key itself must NOT be put in whole-key cooldown for package-model 403 (only model-scoped cooldown!)
    const afterList = await (await apiFetch("/api/providers")).json();
    const updatedPkg = afterList.providers.find((p) => p.id === pkgProv.id);
    assert.equal(updatedPkg.apiKeys[0].cooldownUntil, null);

    // A supported model in the same key's package STILL works immediately on pkg-deepseek
    mock.reset();
    const directPkgRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "pkg-deepseek/gpt-4o",
        messages: [{ role: "user", content: "Supported package model check" }]
      })
    });
    assert.equal(directPkgRes.status, 200);
    assert.equal(mock.requests[0].headers.authorization, "Bearer sk-pkg-ds-only-1111");

    // Disabled model check MUST remain strictly enforced (never bypassed by package fallback)
    await apiFetch("/api/models/disabled", {
      method: "POST",
      body: { provider: "pkg-deepseek", ids: ["deepseek-v4.1-flash"] }
    });
    const disabledRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${defaultRouterKey}`
      },
      body: JSON.stringify({
        model: "pkg-deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "Should remain blocked" }]
      })
    });
    assert.equal(disabledRes.status, 403);
    await apiFetch("/api/models/disabled?provider=pkg-deepseek&id=deepseek-v4.1-flash", {
      method: "DELETE"
    });
  });
});
