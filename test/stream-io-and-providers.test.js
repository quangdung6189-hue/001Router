import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import { buildUpstreamHeaders } from "../server/router.js";
import { PRESETS } from "../server/presets.js";
import {
  createOpenAIToClaudeStreamTransformer,
  createOpenAIToResponsesStreamTransformer,
  createSSEParser
} from "../server/translator.js";
import { openAIToGeminiContents } from "../server/geminiCliTranslator.js";

function parseSSE(rawText) {
  const frames = [];
  const parser = createSSEParser((evt) => frames.push(evt));
  parser.feed(rawText);
  parser.flush();
  return frames;
}

describe("Streaming I/O, Fail-Fast Errors, Disconnect Logging & Cross-Provider Verification", () => {
  let tmpDir;
  let mock;
  let app;
  let server;
  let baseUrl;
  let routerKey;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-stream-io-"));
    mock = await createMockUpstream();
    app = await createApp({ dataDir: tmpDir, port: 20128 });
    routerKey = app.storage.peekInitialRouterKey()?.key;
    assert.ok(routerKey, "Expected initial router key");

    await app.storage.update((d) => {
      d.settings.allowPrivateUpstreams = true;
      d.providers.push(
        {
          id: "p-oai",
          name: "Test OpenAI",
          slug: "test-oai",
          preset: "openai",
          formatType: "openai",
          baseUrl: `${mock.baseUrl}/v1`,
          apiKeys: [{ id: "k-oai", label: "K1", key: "sk-test-oai-1", enabled: true }],
          models: ["gpt-4o", "gpt-4o-mini"],
          enabled: true
        },
        {
          id: "p-ant",
          name: "Test Anthropic",
          slug: "test-ant",
          preset: "anthropic",
          formatType: "anthropic",
          baseUrl: mock.baseUrl,
          apiKeys: [{ id: "k-ant", label: "K1", key: "sk-ant-test-1", enabled: true }],
          models: ["claude-sonnet-4-20250514"],
          enabled: true
        },
        {
          id: "p-ag",
          name: "Test Antigravity",
          slug: "test-ag",
          preset: "antigravity",
          formatType: "gemini-openai",
          baseUrl: "https://daily-cloudcode-pa.googleapis.com/v1internal",
          apiKeys: [
            {
              id: "k-ag",
              label: "AG1",
              authMethod: "antigravity",
              key: "ya29.mock-ag-token",
              oauthMeta: {
                projectId: "proj-ag-1",
                tier: "pro",
                tierLabel: "Pro",
                availableModels: [
                  { id: "gemini-4-neon-xhigh", kind: "chat" },
                  { id: "gemini-4-hydrogen-high", kind: "chat" }
                ]
              },
              enabled: true
            }
          ],
          models: ["gemini-4-neon-xhigh", "gemini-4-hydrogen-high"],
          enabled: true
        },
        {
          id: "p-codex",
          name: "Test Codex",
          slug: "test-codex",
          preset: "openai",
          formatType: "openai",
          baseUrl: `${mock.baseUrl}/v1`,
          apiKeys: [
            {
              id: "k-codex",
              label: "Codex1",
              authMethod: "oauth2",
              key: "codex-oauth-access-token",
              oauthMeta: { provider: "codex", accountId: "acc-codex-1" },
              enabled: true
            }
          ],
          models: ["gpt-5.3-codex"],
          enabled: true
        }
      );
    });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (app?.storage?.flushDeferred) {
      await app.storage.flushDeferred().catch(() => {});
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mock) {
      await mock.close();
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    mock.reset();
    app.locals.cloudCodeFetchImpl = null;
    delete app.locals.streamHeartbeatMs;
    await app.storage.update((d) => {
      d.settings.timeoutMs = 120000;
    });
  });

  function postV1(endpoint, body, headers = {}) {
    return fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`,
        ...headers
      },
      body: JSON.stringify(body)
    });
  }

  it("1. OpenAI passthrough guarantees finish_reason before [DONE] and on EOF without [DONE]", async () => {
    // Case A: [DONE] sent without finish_reason
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-nofinish-1",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }]
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    });

    const resA = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "hi" }]
    });
    assert.equal(resA.status, 200);
    const framesA = parseSSE(await resA.text());
    assert.equal(framesA.at(-1)?.data, "[DONE]");
    const parsedA = framesA.slice(0, -1).map((f) => JSON.parse(f.data));
    assert.equal(parsedA.at(-1)?.choices?.[0]?.finish_reason, "stop");

    // Case B: tool_calls emitted, then EOF without finish_reason and without [DONE]
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-nofinish-2",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "ping", arguments: "{}" } }]
              },
              finish_reason: null
            }
          ]
        })}\n\n`
      );
      res.end();
      return true;
    });

    const resB = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "call tool" }]
    });
    assert.equal(resB.status, 200);
    const framesB = parseSSE(await resB.text());
    assert.equal(framesB.at(-1)?.data, "[DONE]");
    const parsedB = framesB.slice(0, -1).map((f) => JSON.parse(f.data));
    assert.equal(parsedB.at(-1)?.choices?.[0]?.finish_reason, "tool_calls");
  });

  it("2. multi-byte UTF-8 Vietnamese split across TCP chunk boundaries decodes cleanly", async () => {
    const vnText = "Xin chào Việt Nam! Tiếng Việt có dấu đầy đủ 100%.";
    mock.setHandler(async ({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const rawFrame = Buffer.from(
        `data: ${JSON.stringify({
          id: "chatcmpl-utf8",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: vnText }, finish_reason: "stop" }]
        })}\n\ndata: [DONE]\n\n`,
        "utf8"
      );
      // Split deliberately at 3-byte steps right inside UTF-8 multibyte characters
      for (let i = 0; i < rawFrame.length; i += 3) {
        res.write(rawFrame.subarray(i, i + 3));
        await new Promise((r) => setTimeout(r, 1));
      }
      res.end();
      return true;
    });

    const res = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "vn" }]
    });
    assert.equal(res.status, 200);
    const frames = parseSSE(await res.text());
    const content = frames
      .filter((f) => f.data !== "[DONE]")
      .map((f) => JSON.parse(f.data)?.choices?.[0]?.delta?.content || "")
      .join("");
    assert.equal(content, vnText);
    assert.equal(content.includes("\uFFFD"), false);
  });

  it("3. client disconnect mid-stream records status 499, stream: true, and 'Client disconnected'", async () => {
    let upstreamResRef = null;
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      upstreamResRef = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-disc",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: "part1 " }, finish_reason: null }]
        })}\n\n`
      );
      return true;
    });

    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${routerKey}`
      },
      body: JSON.stringify({
        model: "test-oai/gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "disconnect test" }]
      })
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.ok(!first.done && first.value.length > 0);
    ac.abort();
    await reader.cancel().catch(() => {});

    // Give server event loop a brief moment to record request log
    await new Promise((r) => setTimeout(r, 80));
    if (upstreamResRef && !upstreamResRef.writableEnded) upstreamResRef.end();

    const latestLog = app.storage.getLogs()[0];
    assert.equal(latestLog.status, 499);
    assert.equal(latestLog.stream, true);
    assert.equal(latestLog.error, "Client disconnected");
    assert.notEqual(latestLog.error, "No available upstream targets");
  });

  it("4. fail-fast on red/in-band SSE errors (pre-first-byte, mid-stream OpenAI, mid-stream Anthropic)", async () => {
    // 4a: Pre-first-byte SSE error must NOT flush HTTP 200; must fail with 502 JSON and stop reading
    let tailSent = false;
    mock.setHandler(({ url, res, record }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ error: { message: "Quota exceeded upfront" } })}\n\n`);
      res.flushHeaders?.();
      const t = setTimeout(() => {
        if (!res.writableEnded && !res.destroyed && !record.aborted) {
          tailSent = true;
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "should never send" } }] })}\n\n`);
          res.end();
        }
      }, 150);
      res.on("close", () => clearTimeout(t));
      return true;
    });

    const preErrRes = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "fail fast pre" }]
    });
    assert.equal(preErrRes.status, 502);
    const preErrJson = await preErrRes.json();
    assert.match(preErrJson.error.message, /Quota exceeded upfront/);
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(mock.requests.at(-1).aborted, true, "Upstream socket must be aborted on pre-first-byte error");
    assert.equal(tailSent, false, "Upstream connection must be aborted immediately on pre-first-byte error");

    // 4b: Mid-stream OpenAI error must abort upstream immediately and NOT emit [DONE]
    let midTailSent = false;
    mock.setHandler(({ url, res, record }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-miderr",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }]
        })}\n\n`
      );
      const t1 = setTimeout(() => {
        if (!res.writableEnded && !res.destroyed && !record.aborted) {
          res.write(`data: ${JSON.stringify({ error: { message: "Mid-stream red failure" } })}\n\n`);
        }
      }, 20);
      const t2 = setTimeout(() => {
        if (!res.writableEnded && !res.destroyed && !record.aborted) {
          midTailSent = true;
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 200);
      res.on("close", () => {
        clearTimeout(t1);
        clearTimeout(t2);
      });
      return true;
    });

    const midErrRes = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "fail fast mid" }]
    });
    assert.equal(midErrRes.status, 200);
    const midFrames = parseSSE(await midErrRes.text());
    assert.equal(midFrames.some((f) => f.data === "[DONE]"), false, "Must NOT emit [DONE] after error");
    assert.ok(
      midFrames.some((f) => {
        try {
          return JSON.parse(f.data)?.error?.message?.includes("Mid-stream red failure");
        } catch {
          return false;
        }
      })
    );
    assert.equal(app.storage.getLogs()[0].status, 502);
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(midTailSent, false, "Upstream must be aborted before trailing frames");

    // 4c: Translated SSE (OpenAI client -> Anthropic upstream) mid-stream `event: error`
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/messages")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { id: "msg_1", usage: { input_tokens: 10 } }
        })}\n\n`
      );
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hi " }
        })}\n\n`
      );
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "Anthropic overloaded mid-stream" }
        })}\n\n`
      );
      res.end();
      return true;
    });

    const transErrRes = await postV1("/v1/chat/completions", {
      model: "test-ant/claude-sonnet-4-20250514",
      stream: true,
      messages: [{ role: "user", content: "translate err" }]
    });
    assert.equal(transErrRes.status, 200);
    const transFrames = parseSSE(await transErrRes.text());
    assert.equal(transFrames.some((f) => f.data === "[DONE]"), false);
    assert.ok(
      transFrames.some((f) => {
        try {
          return JSON.parse(f.data)?.error?.message?.includes("Anthropic overloaded mid-stream");
        } catch {
          return false;
        }
      })
    );
    assert.equal(app.storage.getLogs()[0].status, 502);
  });

  it("5. Antigravity Cloud Code SSE streams thinking deltas, preserves tool_calls finish_reason, synthesizes missing finish_reason, and fails fast on error", async () => {
    const makeStreamRes = (lines, { hangAfter = false } = {}) => {
      const enc = new TextEncoder();
      let aborted = false;
      const body = new ReadableStream({
        start(controller) {
          for (const l of lines) controller.enqueue(enc.encode(l));
          if (!hangAfter) controller.close();
        },
        cancel() {
          aborted = true;
        }
      });
      const r = new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
      r._wasAborted = () => aborted;
      return r;
    };

    // 5a: thought -> reasoning_content + tool_call -> finish_reason: "tool_calls"
    app.locals.cloudCodeFetchImpl = async () =>
      makeStreamRes([
        `data: ${JSON.stringify({
          response: { candidates: [{ content: { parts: [{ text: "Deep thinking...", thought: true }] } }] }
        })}\n\n`,
        `data: ${JSON.stringify({
          response: {
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { id: "fc_1", name: "read_file", args: { path: "a.js" } } }]
                }
              }
            ]
          }
        })}\n\n`,
        `data: ${JSON.stringify({
          response: {
            candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15, cachedContentTokenCount: 5 }
          }
        })}\n\n`
      ]);

    const agRes1 = await postV1("/v1/chat/completions", {
      model: "test-ag/gemini-4-neon-xhigh",
      stream: true,
      messages: [{ role: "user", content: "think and call" }]
    });
    assert.equal(agRes1.status, 200);
    const agFrames1 = parseSSE(await agRes1.text());
    assert.equal(agFrames1.at(-1)?.data, "[DONE]");
    const agObjs1 = agFrames1.slice(0, -1).map((f) => JSON.parse(f.data));
    assert.equal(agObjs1[0].choices[0].delta.reasoning_content, "Deep thinking...");
    assert.equal(agObjs1.at(-1).choices[0].finish_reason, "tool_calls");
    assert.equal(app.storage.getLogs()[0].cachedTokens, 5);

    // 5b: Missing finishReason on EOF -> synthesizes stop before [DONE]
    app.locals.cloudCodeFetchImpl = async () =>
      makeStreamRes([
        `data: ${JSON.stringify({
          response: { candidates: [{ content: { parts: [{ text: "Partial reply" }] } }] }
        })}\n\n`
      ]);

    const agRes2 = await postV1("/v1/chat/completions", {
      model: "test-ag/gemini-4-neon-xhigh",
      stream: true,
      messages: [{ role: "user", content: "no finish" }]
    });
    assert.equal(agRes2.status, 200);
    const agFrames2 = parseSSE(await agRes2.text());
    assert.equal(agFrames2.at(-1)?.data, "[DONE]");
    const agObjs2 = agFrames2.slice(0, -1).map((f) => JSON.parse(f.data));
    assert.equal(agObjs2.at(-1).choices[0].finish_reason, "stop");

    // 5c: Mid-stream error -> cancels stream immediately, emits error frame, NO [DONE]
    let streamRef = null;
    app.locals.cloudCodeFetchImpl = async () => {
      streamRef = makeStreamRes(
        [
          `data: ${JSON.stringify({
            response: { candidates: [{ content: { parts: [{ text: "Started " }] } }] }
          })}\n\n`,
          `data: ${JSON.stringify({ error: { code: 500, message: "Cloud Code internal error" } })}\n\n`
        ],
        { hangAfter: true }
      );
      return streamRef;
    };

    const agRes3 = await postV1("/v1/chat/completions", {
      model: "test-ag/gemini-4-neon-xhigh",
      stream: true,
      messages: [{ role: "user", content: "ag error" }]
    });
    assert.equal(agRes3.status, 200);
    const agFrames3 = parseSSE(await agRes3.text());
    assert.equal(streamRef._wasAborted(), true);
    assert.equal(agFrames3.some((f) => f.data === "[DONE]"), false);
    assert.ok(
      agFrames3.some((f) => {
        try {
          return JSON.parse(f.data)?.error?.message?.includes("Cloud Code internal error");
        } catch {
          return false;
        }
      })
    );
  });

  it("6. Codex OAuth Responses SSE handles output_item.done args, missing response.completed, and response.failed", async () => {
    // 6a: output_item.done args + missing response.completed -> synthesizes tool_calls finish_reason before [DONE]
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/responses")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `event: response.output_item.added\ndata: ${JSON.stringify({
          type: "response.output_item.added",
          item: { id: "fc_1", call_id: "call_codex_1", type: "function_call", name: "run_cmd" }
        })}\n\n`
      );
      res.write(
        `event: response.output_item.done\ndata: ${JSON.stringify({
          type: "response.output_item.done",
          item: {
            id: "fc_1",
            call_id: "call_codex_1",
            type: "function_call",
            name: "run_cmd",
            arguments: '{"cmd":"ls"}'
          }
        })}\n\n`
      );
      res.end();
      return true;
    });

    const codexRes1 = await postV1("/v1/chat/completions", {
      model: "test-codex/gpt-5.3-codex",
      stream: true,
      messages: [{ role: "user", content: "codex tool" }]
    });
    assert.equal(codexRes1.status, 200);
    const codexFrames1 = parseSSE(await codexRes1.text());
    assert.equal(codexFrames1.at(-1)?.data, "[DONE]");
    const codexObjs1 = codexFrames1.slice(0, -1).map((f) => JSON.parse(f.data));
    const argsCombined = codexObjs1
      .map((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments || "")
      .join("");
    assert.equal(argsCombined, '{"cmd":"ls"}');
    assert.equal(codexObjs1.at(-1).choices[0].finish_reason, "tool_calls");

    // 6b: response.failed mid-stream -> fail-fast immediately, no [DONE]
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/responses")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "Partial codex "
        })}\n\n`
      );
      res.write(
        `event: response.failed\ndata: ${JSON.stringify({
          type: "response.failed",
          response: { error: { message: "Codex execution failed" } }
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    });

    const codexRes2 = await postV1("/v1/chat/completions", {
      model: "test-codex/gpt-5.3-codex",
      stream: true,
      messages: [{ role: "user", content: "codex fail" }]
    });
    assert.equal(codexRes2.status, 200);
    const codexFrames2 = parseSSE(await codexRes2.text());
    assert.equal(codexFrames2.some((f) => f.data === "[DONE]"), false);
    assert.ok(
      codexFrames2.some((f) => {
        try {
          return JSON.parse(f.data)?.error?.message?.includes("Codex execution failed");
        } catch {
          return false;
        }
      })
    );
  });

  it("7. Anthropic/OpenAI/Responses transformers handle reasoning, parallel tools, and valueless message_delta", async () => {
    // 7a: message_delta without stop_reason does not finish stream prematurely
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/messages")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { id: "msg_md", usage: { input_tokens: 5 } }
        })}\n\n`
      );
      res.write(
        `event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta",
          delta: {},
          usage: { output_tokens: 2 }
        })}\n\n`
      );
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "After empty delta" }
        })}\n\n`
      );
      res.write(
        `event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 6 }
        })}\n\n`
      );
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      res.end();
      return true;
    });

    const resA = await postV1("/v1/chat/completions", {
      model: "test-ant/claude-sonnet-4-20250514",
      stream: true,
      messages: [{ role: "user", content: "md test" }]
    });
    assert.equal(resA.status, 200);
    const framesA = parseSSE(await resA.text());
    const objsA = framesA.filter((f) => f.data !== "[DONE]").map((f) => JSON.parse(f.data));
    assert.equal(
      objsA.map((c) => c.choices?.[0]?.delta?.content || "").join(""),
      "After empty delta"
    );
    assert.equal(objsA.filter((c) => c.choices?.[0]?.finish_reason).length, 1);

    // 7b: /v1/responses forwards reasoning_content as response.reasoning_summary_text.delta
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-resp",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { reasoning_content: "Step 1" }, finish_reason: null }]
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-resp",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: "Answer" }, finish_reason: "stop" }]
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-resp",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    });

    const respSse = await postV1("/v1/responses", {
      model: "test-oai/gpt-4o",
      stream: true,
      input: "reason test"
    });
    assert.equal(respSse.status, 200);
    const respText = await respSse.text();
    assert.match(respText, /event: response\.reasoning_summary_text\.delta/);
    assert.match(respText, /"delta":"Step 1"/);
    assert.match(respText, /"total_tokens":20/);

    // 7c: parallel interleaved tool call arguments in OpenAI -> Claude transformer
    const o2c = createOpenAIToClaudeStreamTransformer("claude-sonnet");
    const out1 = o2c.pushChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_a", function: { name: "fnA", arguments: "" } }]
          }
        }
      ]
    });
    const out2 = o2c.pushChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 1, id: "call_b", function: { name: "fnB", arguments: "" } }]
          }
        }
      ]
    });
    const out3 = o2c.pushChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }]
          }
        }
      ]
    });
    assert.ok(out1 && out2);
    assert.match(out3, /input_json_delta/);
    assert.match(out3, /"partial_json":"\{\\"x\\":1\}"/);
  });

  it("8. SSE keepalive heartbeats keep slow streams alive, and mid-stream idle timeout aborts stalled upstreams", async () => {
    // 8a: Keepalive heartbeat sent during slow TTFB when no fallback remains
    app.locals.streamHeartbeatMs = 50;
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      const t = setTimeout(() => {
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-slow",
              object: "chat.completion.chunk",
              model: "gpt-4o",
              choices: [{ index: 0, delta: { content: "Slow OK" }, finish_reason: "stop" }]
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 170);
      res.on("close", () => clearTimeout(t));
      return true;
    });

    const slowRes = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "slow" }]
    });
    assert.equal(slowRes.status, 200);
    const rawSlow = await slowRes.text();
    assert.match(rawSlow, /: keep-alive/);
    assert.match(rawSlow, /Slow OK/);

    // 8b: Mid-stream idle timeout aborts stalled upstream instead of hanging forever
    delete app.locals.streamHeartbeatMs;
    await app.storage.update((d) => {
      d.settings.timeoutMs = 120;
    });
    let stalledResRef = null;
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      stalledResRef = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-stall",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: "Chunk1 " }, finish_reason: null }]
        })}\n\n`
      );
      return true;
    });

    const stallRes = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "stall mid stream" }]
    });
    assert.equal(stallRes.status, 200);
    const stallText = await stallRes.text();
    assert.match(stallText, /Chunk1/);
    assert.match(stallText, /timed out/i);
    if (stalledResRef && !stalledResRef.writableEnded) stalledResRef.end();
  });

  it("9. /v1beta/models/*:streamGenerateContent guarantees finishReason STOP and propagates errors", async () => {
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-v1beta",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: "Gemini v1beta text" }, finish_reason: null }]
        })}\n\n`
      );
      res.end();
      return true;
    });

    const betaRes = await postV1("/v1beta/models/test-oai/gpt-4o:streamGenerateContent", {
      contents: [{ role: "user", parts: [{ text: "hello" }] }]
    });
    assert.equal(betaRes.status, 200);
    const betaFrames = parseSSE(await betaRes.text());
    const betaObjs = betaFrames.map((f) => JSON.parse(f.data));
    assert.equal(betaObjs[0].candidates[0].content.parts[0].text, "Gemini v1beta text");
    assert.equal(betaObjs.at(-1).candidates[0].finishReason, "STOP");
  });

  it("10. cross-provider authStyle header mapping covers all presets and dispatches cleanly", async () => {
    const expectedByStyle = {
      bearer: (h) => h.authorization === "Bearer test-secret",
      "x-api-key": (h) => h["x-api-key"] === "test-secret",
      "api-key": (h) => h["api-key"] === "test-secret",
      "x-subscription-token": (h) => h["x-subscription-token"] === "test-secret",
      "xi-api-key": (h) => h["xi-api-key"] === "test-secret",
      "x-key": (h) => h["x-key"] === "test-secret",
      token: (h) => h.authorization === "Token test-secret",
      key: (h) => h.authorization === "Key test-secret",
      authorization: (h) => h.authorization === "test-secret",
      none: (h) => !h.authorization && !h["x-api-key"] && !h["api-key"],
      "query-key": (h) => !h.authorization && !h["x-api-key"] && !h["api-key"]
    };

    const presetList = Array.isArray(PRESETS) ? PRESETS : Object.values(PRESETS);
    for (const preset of presetList) {
      const style = preset.authStyle || (preset.formatType === "anthropic" ? "x-api-key" : "bearer");
      const check = expectedByStyle[style];
      assert.ok(check, `Unexpected authStyle '${style}' on preset '${preset.preset}'`);
      const headers = buildUpstreamHeaders(preset, "test-secret", undefined);
      assert.ok(check(headers), `Preset '${preset.preset}' (${style}) failed header check: ${JSON.stringify(headers)}`);
    }

    // End-to-end dispatch check across non-bearer provider presets (e.g., Azure api-key, Deepgram token)
    await app.storage.update((d) => {
      d.providers.push(
        {
          id: "p-azure-e2e",
          name: "Test Azure",
          slug: "test-azure",
          preset: "azure",
          formatType: "openai",
          baseUrl: `${mock.baseUrl}/v1`,
          apiKeys: [{ id: "k-az", label: "AZ", key: "az-secret-123", enabled: true }],
          models: ["gpt-4o"],
          enabled: true
        },
        {
          id: "p-dg-e2e",
          name: "Test Deepgram",
          slug: "test-dg",
          preset: "deepgram",
          formatType: "openai",
          baseUrl: `${mock.baseUrl}/v1`,
          apiKeys: [{ id: "k-dg", label: "DG", key: "dg-secret-123", enabled: true }],
          models: ["nova-2"],
          enabled: true
        }
      );
    });

    const azRes = await postV1("/v1/chat/completions", {
      model: "test-azure/gpt-4o",
      messages: [{ role: "user", content: "az" }]
    });
    assert.equal(azRes.status, 200);
    assert.equal(mock.requests.at(-1).headers["api-key"], "az-secret-123");

    const dgRes = await postV1("/v1/chat/completions", {
      model: "test-dg/nova-2",
      messages: [{ role: "user", content: "dg" }]
    });
    assert.equal(dgRes.status, 200);
    assert.equal(mock.requests.at(-1).headers.authorization, "Token dg-secret-123");
  });

  it("11. Cloud Code SSE streams 7 parallel tool calls across separate frames with distinct indices (0..6), valid JSON args, and usage", async () => {
    const parallelCalls = [
      { id: "fc_p0", name: "pwsh", args: { description: "Check git", command: "git status --short" } },
      { id: "fc_p1", name: "pwsh", args: { description: "List root", command: "Get-ChildItem -Force" } },
      { id: "fc_p2", name: "glob", args: { pattern: "core/**/*.py" } },
      { id: "fc_p3", name: "glob", args: { pattern: "utils/**/*" } },
      { id: "fc_p4", name: "glob", args: { pattern: "website/**/*" } },
      { id: "fc_p5", name: "glob", args: { pattern: "tests/**/*" } },
      { id: "fc_p6", name: "read_file", args: { file_path: "requirements.txt" } }
    ];

    const makeCloudStream = () => {
      const enc = new TextEncoder();
      const lines = [
        `data: ${JSON.stringify({
          response: { candidates: [{ content: { parts: [{ text: "Inspecting workspace...", thought: true }] } }] }
        })}\n\n`,
        ...parallelCalls.map(
          (fc) =>
            `data: ${JSON.stringify({
              response: { candidates: [{ content: { parts: [{ functionCall: fc }] } }] }
            })}\n\n`
        ),
        `data: ${JSON.stringify({
          response: {
            candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 85, cachedContentTokenCount: 10 }
          }
        })}\n\n`
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const l of lines) controller.enqueue(enc.encode(l));
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    };

    // 11a: OpenAI /v1/chat/completions client accumulates by tc.index -> 7 valid JSON tool calls, never concatenated
    app.locals.cloudCodeFetchImpl = async () => makeCloudStream();
    const oaiRes = await postV1("/v1/chat/completions", {
      model: "test-ag/gemini-4-hydrogen-high",
      stream: true,
      messages: [{ role: "user", content: "audit workspace" }]
    });
    assert.equal(oaiRes.status, 200);
    const oaiFrames = parseSSE(await oaiRes.text());
    assert.equal(oaiFrames.at(-1)?.data, "[DONE]");
    const oaiChunks = oaiFrames.slice(0, -1).map((f) => JSON.parse(f.data));

    const accByIndex = new Map();
    let finalUsage = null;
    for (const c of oaiChunks) {
      if (c.usage) finalUsage = c.usage;
      for (const tc of c.choices?.[0]?.delta?.tool_calls || []) {
        assert.equal(typeof tc.index, "number");
        const cur = accByIndex.get(tc.index) || { id: "", name: "", arguments: "" };
        if (tc.id) cur.id += tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        accByIndex.set(tc.index, cur);
      }
    }
    assert.equal(accByIndex.size, 7);
    assert.deepEqual([...accByIndex.keys()], [0, 1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < parallelCalls.length; i++) {
      const got = accByIndex.get(i);
      assert.equal(got.id, parallelCalls[i].id);
      assert.equal(got.name, parallelCalls[i].name);
      assert.deepEqual(JSON.parse(got.arguments), parallelCalls[i].args);
    }
    assert.equal(oaiChunks.at(-1).choices[0].finish_reason, "tool_calls");
    assert.equal(finalUsage?.prompt_tokens, 120);
    assert.equal(finalUsage?.completion_tokens, 85);

    // 11b: Anthropic /v1/messages client receives 7 distinct tool_use blocks with valid JSON + usage
    app.locals.cloudCodeFetchImpl = async () => makeCloudStream();
    const antRes = await postV1("/v1/messages", {
      model: "test-ag/gemini-4-hydrogen-high",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: "audit workspace" }]
    });
    assert.equal(antRes.status, 200);
    const antEvents = parseSSE(await antRes.text()).map((f) => ({
      event: f.event,
      data: JSON.parse(f.data)
    }));
    const stoppedBlocks = new Set();
    const toolBlocks = new Map();
    for (const ev of antEvents) {
      if (ev.event === "content_block_start" && ev.data.content_block?.type === "tool_use") {
        toolBlocks.set(ev.data.index, { name: ev.data.content_block.name, id: ev.data.content_block.id, json: "" });
      } else if (ev.event === "content_block_delta") {
        assert.equal(
          stoppedBlocks.has(ev.data.index),
          false,
          `content_block_delta emitted after content_block_stop for block ${ev.data.index}`
        );
        if (ev.data.delta?.type === "input_json_delta") {
          toolBlocks.get(ev.data.index).json += ev.data.delta.partial_json;
        }
      } else if (ev.event === "content_block_stop") {
        stoppedBlocks.add(ev.data.index);
      }
    }
    assert.equal(toolBlocks.size, 7);
    let idx = 0;
    for (const tb of toolBlocks.values()) {
      assert.equal(tb.name, parallelCalls[idx].name);
      assert.deepEqual(JSON.parse(tb.json), parallelCalls[idx].args);
      idx++;
    }
    const msgDelta = antEvents.find((e) => e.event === "message_delta");
    assert.equal(msgDelta?.data?.delta?.stop_reason, "tool_use");
    assert.equal(msgDelta?.data?.usage?.output_tokens, 85);

    // 11c: OpenAI /v1/responses client receives 7 distinct function_call output items
    app.locals.cloudCodeFetchImpl = async () => makeCloudStream();
    const respApiRes = await postV1("/v1/responses", {
      model: "test-ag/gemini-4-hydrogen-high",
      stream: true,
      input: "audit workspace"
    });
    assert.equal(respApiRes.status, 200);
    const respEvents = parseSSE(await respApiRes.text()).map((f) => ({
      event: f.event,
      data: JSON.parse(f.data)
    }));
    const completedEv = respEvents.find((e) => e.event === "response.completed");
    const fcOutputs = (completedEv?.data?.response?.output || []).filter((o) => o.type === "function_call");
    assert.equal(fcOutputs.length, 7);
    for (let i = 0; i < parallelCalls.length; i++) {
      assert.equal(fcOutputs[i].name, parallelCalls[i].name);
      assert.deepEqual(JSON.parse(fcOutputs[i].arguments), parallelCalls[i].args);
    }
    assert.equal(completedEv?.data?.response?.usage?.total_tokens, 205);
  });

  it("12. OpenAI passthrough, Anthropic & Responses transformers normalize colliding index:0 parallel tool calls and interleaved blocks", async () => {
    // 12a: Buggy OpenAI-compat upstream (like Gemini OpenAI-compat / relays) sending colliding index:0 + duplicate full args + stop finish_reason
    mock.setHandler(({ url, res }) => {
      if (!url.endsWith("/chat/completions")) return false;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const frames = [
        {
          id: "chatcmpl-collide",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "pwsh", arguments: '{"cmd":"git status"}' } }]
              },
              finish_reason: null
            }
          ]
        },
        // Duplicate full JSON re-emission on same id must be suppressed
        {
          id: "chatcmpl-collide",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "pwsh", arguments: '{"cmd":"git status"}' } }]
              },
              finish_reason: null
            }
          ]
        },
        // Second parallel call colliding at index: 0 with new id
        {
          id: "chatcmpl-collide",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "glob", arguments: '{"pattern":"*.js"}' } }]
              },
              finish_reason: null
            }
          ]
        },
        // Third parallel call with missing index & id-less complete JSON
        {
          id: "chatcmpl-collide",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ type: "function", function: { name: "read_file", arguments: '{"file_path":"README.md"}' } }]
              },
              finish_reason: null
            }
          ]
        },
        // Relay wrongly sends finish_reason: "stop" after tool_calls -> normalized to "tool_calls"
        {
          id: "chatcmpl-collide",
          object: "chat.completion.chunk",
          model: "gpt-4o",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        }
      ];
      for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    });

    const pRes = await postV1("/v1/chat/completions", {
      model: "test-oai/gpt-4o",
      stream: true,
      messages: [{ role: "user", content: "parallel collide" }]
    });
    assert.equal(pRes.status, 200);
    const pFrames = parseSSE(await pRes.text());
    assert.equal(pFrames.at(-1)?.data, "[DONE]");
    const pObjs = pFrames.slice(0, -1).map((f) => JSON.parse(f.data));

    const acc = new Map();
    for (const c of pObjs) {
      for (const tc of c.choices?.[0]?.delta?.tool_calls || []) {
        const cur = acc.get(tc.index) || { name: "", args: "" };
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }
    assert.equal(acc.size, 3);
    assert.deepEqual([...acc.keys()], [0, 1, 2]);
    assert.deepEqual(JSON.parse(acc.get(0).args), { cmd: "git status" });
    assert.deepEqual(JSON.parse(acc.get(1).args), { pattern: "*.js" });
    assert.deepEqual(JSON.parse(acc.get(2).args), { file_path: "README.md" });
    assert.equal(pObjs.at(-1).choices[0].finish_reason, "tool_calls");

    // 12b: Interleaved OpenAI tool calls -> Anthropic SSE never emits delta after content_block_stop
    const o2c = createOpenAIToClaudeStreamTransformer("claude-sonnet");
    const rawAnt =
      o2c.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "subagent", arguments: '{"a":' } }] } }]
      }) +
      o2c.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "subagent", arguments: '{"b":' } }] } }]
      }) +
      o2c.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }]
      }) +
      o2c.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "2}" } }] }, finish_reason: "tool_calls" }]
      }) +
      o2c.finalize();

    const parsedAnt = parseSSE(rawAnt).map((f) => ({ event: f.event, data: JSON.parse(f.data) }));
    const closed = new Set();
    const byBlock = new Map();
    for (const ev of parsedAnt) {
      if (ev.event === "content_block_start" && ev.data.content_block?.type === "tool_use") {
        byBlock.set(ev.data.index, "");
      } else if (ev.event === "content_block_delta") {
        assert.equal(closed.has(ev.data.index), false, `delta after stop on block ${ev.data.index}`);
        byBlock.set(ev.data.index, byBlock.get(ev.data.index) + ev.data.delta.partial_json);
      } else if (ev.event === "content_block_stop") {
        closed.add(ev.data.index);
      }
    }
    assert.deepEqual(JSON.parse(byBlock.get(0)), { a: 1 });
    assert.deepEqual(JSON.parse(byBlock.get(1)), { b: 2 });

    // 12c: Colliding index:0 parallel calls -> Responses API transformer keeps them separate
    const o2r = createOpenAIToResponsesStreamTransformer("gpt-5");
    const rawResp =
      o2r.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "r1", function: { name: "subagent", arguments: '{"name":"core"}' } }] } }]
      }) +
      o2r.pushChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "r2", function: { name: "subagent", arguments: '{"name":"web"}' } }] } }]
      }) +
      o2r.finalize();
    const parsedResp = parseSSE(rawResp).map((f) => ({ event: f.event, data: JSON.parse(f.data) }));
    const doneResp = parsedResp.find((e) => e.event === "response.completed");
    const respTools = doneResp.data.response.output.filter((o) => o.type === "function_call");
    assert.equal(respTools.length, 2);
    assert.deepEqual(JSON.parse(respTools[0].arguments), { name: "core" });
    assert.deepEqual(JSON.parse(respTools[1].arguments), { name: "web" });

    // 12d: openAIToGeminiContents safely sanitizes malformed/non-object replayed tool arguments to {}
    const geminiConv = openAIToGeminiContents({
      model: "gemini-4-hydrogen-high",
      messages: [
        { role: "user", content: "retry" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "bad_1", type: "function", function: { name: "pwsh", arguments: '{"a":1}{"b":2}' } },
            { id: "bad_2", type: "function", function: { name: "glob", arguments: '["not","an","object"]' } }
          ]
        },
        { role: "tool", tool_call_id: "bad_1", content: "err" },
        { role: "tool", tool_call_id: "bad_2", content: "err" }
      ]
    });
    const modelTurn = geminiConv.contents.find((c) => c.role === "model");
    assert.deepEqual(modelTurn.parts[0].functionCall.args, {});
    assert.deepEqual(modelTurn.parts[1].functionCall.args, {});
  });
});
