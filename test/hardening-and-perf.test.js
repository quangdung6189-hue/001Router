import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createApp, configureHttpServer } from "../server/index.js";
import { classifyHostForSSRF, redactSecrets } from "../server/security/redact.js";
import { parseHostHeaderName } from "../server/security/headers.js";
import { parseProviderCredentialJson } from "../server/serviceAccountAuth.js";
import { getGeminiCliAccessToken } from "../server/geminiCliOAuth.js";
import { getMergedPricingMap, findModelPricingRate } from "../server/pricing.js";
import { compressText } from "../server/tokenSaver.js";

function listenServer(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function loginDashboard(baseUrl, password = "1234") {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(res.status, 200, "Dashboard test login must succeed");
  const raw = res.headers.get("set-cookie") || "";
  const cookie = raw.split(";")[0];
  assert.ok(cookie.startsWith("r001_session="), "Expected r001_session cookie");
  return cookie;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

describe("Security Hardening, Simulated DDoS & Hot-Path Latency", () => {
  let tmpDir;
  let mockUpstream;
  let mockBaseUrl;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "router001-hardening-"));

    mockUpstream = http.createServer((req, res) => {
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          let body = {};
          try {
            body = JSON.parse(raw);
          } catch {
            // ignore
          }
          if (body.stream) {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache"
            });
            for (let i = 0; i < 6; i++) {
              res.write(
                `data: ${JSON.stringify({
                  id: "chatcmpl-bench",
                  object: "chat.completion.chunk",
                  model: body.model || "gpt-4o-mini",
                  choices: [{ index: 0, delta: { content: `tok${i} ` }, finish_reason: null }]
                })}\n\n`
              );
            }
            res.write(
              `data: ${JSON.stringify({
                id: "chatcmpl-bench",
                object: "chat.completion.chunk",
                model: body.model || "gpt-4o-mini",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 18, completion_tokens: 12, total_tokens: 30 }
              })}\n\n`
            );
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "chatcmpl-bench",
              object: "chat.completion",
              model: body.model || "gpt-4o-mini",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "OK" },
                  finish_reason: "stop"
                }
              ],
              usage: { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20 }
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    mockBaseUrl = await listenServer(mockUpstream);
  });

  after(async () => {
    await closeServer(mockUpstream);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. blocks simulated HTTP burst flood pre-auth with 429 + Retry-After", async () => {
    const dir = path.join(tmpDir, "flood-test");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 10, globalWindowMs: 60_000 }
    });
    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);
    try {
      const results = await Promise.all(
        Array.from({ length: 22 }, () => fetch(`${baseUrl}/api/me`))
      );
      const statuses = results.map((r) => r.status);
      const passedLimiterCount = statuses.filter((s) => s !== 429).length;
      const limited = results.filter((r) => r.status === 429);
      assert.equal(passedLimiterCount, 10, `Expected exactly 10 allowed requests, got ${passedLimiterCount}`);
      assert.equal(limited.length, 12, `Expected 12 rate-limited requests, got ${limited.length}`);
      assert.ok(Number(limited[0].headers.get("retry-after")) >= 1);
      assert.equal(limited[0].headers.get("x-ratelimit-remaining"), "0");
    } finally {
      await closeServer(server);
    }
  });

  it("2. throttles simulated /v1 API key brute-force flood with 429", async () => {
    const dir = path.join(tmpDir, "bruteforce-test");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 1000, globalWindowMs: 60_000 }
    });
    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);
    try {
      let saw401 = 0;
      let saw429 = 0;
      for (let i = 0; i < 66; i++) {
        const res = await fetch(`${baseUrl}/v1/models`, {
          headers: { authorization: `Bearer rk_attacker_guess_${i}` }
        });
        if (res.status === 401) saw401++;
        else if (res.status === 429) saw429++;
      }
      assert.ok(saw401 >= 55 && saw401 <= 60, `Expected ~60 401s before throttle, got ${saw401}`);
      assert.ok(saw429 >= 5, `Expected brute-force attempts to be throttled with 429, got ${saw429}`);
    } finally {
      await closeServer(server);
    }
  });

  it("3. enforces per-IP SSE connection cap and releases slots cleanly on close", async () => {
    const dir = path.join(tmpDir, "sse-cap-test");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 1000, globalWindowMs: 60_000 }
    });
    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);
    const openReqs = [];
    try {
      const cookie = await loginDashboard(baseUrl);
      const parsed = new URL(`${baseUrl}/api/usage/stream`);
      const openStream = () =>
        new Promise((resolve, reject) => {
          const req = http.get(
            {
              hostname: parsed.hostname,
              port: parsed.port,
              path: parsed.pathname,
              headers: { cookie }
            },
            (res) => {
              resolve({ req, res, status: res.statusCode });
            }
          );
          req.on("error", reject);
        });

      for (let i = 0; i < 8; i++) {
        const conn = await openStream();
        assert.equal(conn.status, 200, `Stream #${i + 1} should connect`);
        openReqs.push(conn);
      }
      const ninth = await openStream();
      assert.equal(ninth.status, 429, "9th concurrent SSE stream from same IP must return 429");
      ninth.req.destroy();

      for (const conn of openReqs) {
        conn.req.destroy();
      }
      await new Promise((r) => setTimeout(r, 80));

      const afterClose = await openStream();
      assert.equal(afterClose.status, 200, "Slot must be released after clients disconnect");
      afterClose.req.destroy();
    } finally {
      for (const conn of openReqs) conn.req.destroy();
      await closeServer(server);
    }
  });

  it("4. applies Slowloris / socket DoS hardening via configureHttpServer", () => {
    const srv = configureHttpServer(http.createServer());
    assert.equal(srv.keepAliveTimeout, 15_000);
    assert.equal(srv.headersTimeout, 20_000);
    assert.equal(srv.requestTimeout, 300_000);
    assert.equal(srv.maxHeadersCount, 100);
    assert.equal(srv.maxRequestsPerSocket, 1000);
    assert.equal(srv.maxConnections, 512);
  });

  it("5. rejects oversized >25MB /v1/audio/transcriptions upload with 413 without OOM", async () => {
    const dir = path.join(tmpDir, "upload-cap-test");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 1000, globalWindowMs: 60_000 }
    });
    const routerKey = app.storage.peekInitialRouterKey()?.key;
    assert.ok(routerKey, "Expected initial router key");
    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);
    try {
      const parsed = new URL(`${baseUrl}/v1/audio/transcriptions`);

      // Case A: declared Content-Length > 25MB rejected immediately with 413
      const statusHeaderCap = await new Promise((resolve, reject) => {
        let settled = false;
        const done = (val, isErr = false) => {
          if (settled) return;
          settled = true;
          if (isErr) reject(val);
          else resolve(val);
        };
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: "POST",
            headers: {
              authorization: `Bearer ${routerKey}`,
              "content-type": "multipart/form-data; boundary=----router001cap",
              "content-length": String(27 * 1024 * 1024)
            }
          },
          (res) => {
            res.resume();
            done(res.statusCode);
            req.destroy();
          }
        );
        req.on("error", (err) => {
          if (settled) return;
          if (err.code === "ECONNRESET" || err.code === "EPIPE") {
            done(413);
            return;
          }
          done(err, true);
        });
        req.setTimeout(5000, () => done(new Error("Timed out waiting for 413"), true));
        req.write(Buffer.alloc(64 * 1024, 0x41));
      });
      assert.equal(statusHeaderCap, 413, `Expected 413 on Content-Length >25MB, got ${statusHeaderCap}`);

      // Case B: chunked streaming upload > 25MB (no Content-Length) rejected mid-stream with 413
      const statusStreamCap = await new Promise((resolve, reject) => {
        let settled = false;
        const done = (val, isErr = false) => {
          if (settled) return;
          settled = true;
          if (isErr) reject(val);
          else resolve(val);
        };
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: "POST",
            headers: {
              authorization: `Bearer ${routerKey}`,
              "content-type": "multipart/form-data; boundary=----router001cap",
              "transfer-encoding": "chunked"
            }
          },
          (res) => {
            res.resume();
            done(res.statusCode);
            req.destroy();
          }
        );
        req.on("error", (err) => {
          if (settled) return;
          if (err.code === "ECONNRESET" || err.code === "EPIPE") {
            done(413);
            return;
          }
          done(err, true);
        });
        const chunk = Buffer.alloc(1024 * 1024, 0x41);
        let sent = 0;
        const pump = () => {
          if (settled || req.destroyed || req.writableEnded) return;
          if (sent >= 27) {
            req.end();
            return;
          }
          sent++;
          const ok = req.write(chunk);
          if (ok) setImmediate(pump);
          else req.once("drain", pump);
        };
        pump();
      });
      assert.equal(statusStreamCap, 413, `Expected 413 on streamed >25MB body, got ${statusStreamCap}`);
    } finally {
      await closeServer(server);
    }
  });

  it("6. resists catastrophic ReDoS payloads in redactSecrets and parseProviderCredentialJson", () => {
    const pemAttack = "-----BEGIN PRIVATE KEY-----\n".repeat(3000) + "unclosed-tail";
    const t0 = performance.now();
    const redacted = redactSecrets(pemAttack);
    const pemElapsed = performance.now() - t0;
    assert.ok(pemElapsed < 200, `PEM redaction took ${pemElapsed.toFixed(1)}ms (ReDoS regression)`);
    assert.ok(typeof redacted === "string");

    const fenceAttack = "```" + " ".repeat(15_000) + "\n{\"apiKey\":\"sk-test-12345678\"}\n```";
    const t1 = performance.now();
    const parsed = parseProviderCredentialJson(fenceAttack);
    const fenceElapsed = performance.now() - t1;
    assert.ok(fenceElapsed < 200, `Fence parsing took ${fenceElapsed.toFixed(1)}ms (ReDoS regression)`);
    assert.equal(parsed.apiKeys?.[0]?.key, "sk-test-12345678");
  });

  it("7. enforces SSRF, Host-parser, prototype-pollution, v1beta key scope, CLI public block, and async crypto export/import", async () => {
    // Host header smuggling guard
    assert.equal(parseHostHeaderName("[::1].evil.com"), "");
    assert.equal(parseHostHeaderName("localhost:80:evil"), "");
    assert.equal(parseHostHeaderName("[::1]:3000"), "::1");
    assert.equal(parseHostHeaderName("127.0.0.1:3000"), "127.0.0.1");

    // Expanded SSRF IPv4 / IPv6 ranges
    const blockedHosts = [
      "198.18.0.1",
      "224.0.0.1",
      "240.0.0.1",
      "::ffff:0:169.254.169.254",
      "64:ff9b:1::1",
      "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
      "ff02::1"
    ];
    for (const host of blockedHosts) {
      const c = classifyHostForSSRF(host);
      assert.ok(
        c.isPrivateLan || c.isMetadataOrLinkLocal || c.isLoopback,
        `Expected ${host} to be classified as private/metadata/loopback`
      );
    }

    // Gemini CLI tokenUri SSRF check
    await assert.rejects(
      () =>
        getGeminiCliAccessToken({
          clientId: "cid",
          refreshToken: "rtok",
          tokenUri: "http://169.254.169.254/latest/meta-data"
        }),
      /SSRF guard/i
    );

    const dir = path.join(tmpDir, "sec-routes-test");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 1000, globalWindowMs: 60_000 }
    });
    const routerKey = app.storage.peekInitialRouterKey()?.key;
    assert.ok(routerKey, "Expected initial router key");

    await app.storage.update((d) => {
      d.settings.allowPrivateUpstreams = true;
      d.providers.push({
        id: "p-allowed",
        name: "Allowed",
        slug: "allowed",
        preset: "openai",
        formatType: "openai",
        baseUrl: mockBaseUrl,
        apiKeys: [{ id: "k1", label: "k", key: "sk-mock-1", enabled: true }],
        models: ["gpt-4o-mini"],
        enabled: true
      });
      d.providers.push({
        id: "p-secret",
        name: "Secret",
        slug: "secret",
        preset: "openai",
        formatType: "openai",
        baseUrl: mockBaseUrl,
        apiKeys: [{ id: "k2", label: "k", key: "sk-mock-2", enabled: true }],
        models: ["secret-model"],
        enabled: true
      });
    });

    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);
    try {
      const cookie = await loginDashboard(baseUrl);

      // Prototype pollution guard on /v1/audio/voices?provider=constructor
      const voicesRes = await fetch(`${baseUrl}/v1/audio/voices?provider=constructor`, {
        headers: { authorization: `Bearer ${routerKey}` }
      });
      assert.equal(voicesRes.status, 200);
      const voicesJson = await voicesRes.json();
      assert.ok(Array.isArray(voicesJson.voices) && voicesJson.voices.length > 0);

      // Prototype key guard on /api/models/alias
      const aliasRes = await fetch(`${baseUrl}/api/models/alias`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ alias: "__proto__", target: "allowed/gpt-4o-mini" })
      });
      assert.equal(aliasRes.status, 400);

      // Restricted key scope enforced on GET /v1beta/models
      const createKeyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Scoped",
          access: { restricted: true, allow: ["allowed/gpt-4o-mini"] }
        })
      });
      assert.equal(createKeyRes.status, 201);
      const { key: scopedKey } = await createKeyRes.json();

      const v1betaRes = await fetch(`${baseUrl}/v1beta/models`, {
        headers: { "x-goog-api-key": scopedKey.key }
      });
      assert.equal(v1betaRes.status, 200);
      const v1betaJson = await v1betaRes.json();
      const names = (v1betaJson.models || []).map((m) => m.name);
      assert.ok(names.includes("models/allowed/gpt-4o-mini"));
      assert.ok(!names.includes("models/secret/secret-model"));

      // Async encrypted export + import roundtrip
      const expRes = await fetch(
        `${baseUrl}/api/export?secrets=encrypted&passphrase=StrongPassphrase123!`,
        { headers: { cookie } }
      );
      assert.equal(expRes.status, 200);
      const envelope = await expRes.json();
      assert.equal(envelope.encrypted, true);

      const badImpRes = await fetch(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ ...envelope, passphrase: "WrongPassword999!" })
      });
      assert.equal(badImpRes.status, 400);

      const goodImpRes = await fetch(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ ...envelope, passphrase: "StrongPassphrase123!", mode: "merge" })
      });
      assert.equal(goodImpRes.status, 200);

      // CLI tools blocked on public deployment
      const prevVercel = process.env.VERCEL;
      process.env.VERCEL = "1";
      try {
        const cliRes = await fetch(`${baseUrl}/api/cli-tools`, {
          headers: { cookie }
        });
        assert.equal(cliRes.status, 403);
      } finally {
        if (prevVercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = prevVercel;
      }
    } finally {
      await closeServer(server);
    }
  });

  it("8. benchmarks hot-path non-stream & SSE TTFT latency, pricing lookup, and tokenSaver LRU", async () => {
    const dir = path.join(tmpDir, "perf-bench");
    const app = await createApp({
      dataDir: dir,
      rateLimits: { globalMaxRequests: 10_000, globalWindowMs: 60_000 }
    });
    const routerKey = app.storage.peekInitialRouterKey()?.key;
    assert.ok(routerKey, "Expected initial router key");

    await app.storage.update((d) => {
      d.settings.allowPrivateUpstreams = true;
      d.providers.push({
        id: "p-bench",
        name: "BenchOpenAI",
        slug: "bench",
        preset: "openai",
        formatType: "openai",
        baseUrl: `${mockBaseUrl}/v1`,
        apiKeys: [{ id: "kb", label: "bench", key: "sk-bench-key", enabled: true }],
        models: ["gpt-4o-mini"],
        enabled: true
      });
    });

    const server = configureHttpServer(http.createServer(app));
    const baseUrl = await listenServer(server);

    try {
      // Warm-up (JIT + keep-alive pool)
      for (let i = 0; i < 5; i++) {
        const w = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${routerKey}`
          },
          body: JSON.stringify({
            model: "bench/gpt-4o-mini",
            messages: [{ role: "user", content: "hi" }]
          })
        });
        await w.text();
      }

      // 1) Non-streaming latency benchmark (40 requests)
      const nonStreamMs = [];
      const benchStart = performance.now();
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now();
        const r = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${routerKey}`
          },
          body: JSON.stringify({
            model: "bench/gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }]
          })
        });
        assert.equal(r.status, 200);
        await r.json();
        nonStreamMs.push(performance.now() - t0);
      }
      const totalNonStreamMs = performance.now() - benchStart;
      nonStreamMs.sort((a, b) => a - b);

      // 2) Streaming SSE TTFT benchmark (30 requests)
      const ttftMs = [];
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        const r = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${routerKey}`
          },
          body: JSON.stringify({
            model: "bench/gpt-4o-mini",
            stream: true,
            messages: [{ role: "user", content: "stream ping" }]
          })
        });
        assert.equal(r.status, 200);
        const reader = r.body.getReader();
        const first = await reader.read();
        assert.ok(!first.done && first.value.length > 0);
        ttftMs.push(performance.now() - t0);
        while (!(await reader.read()).done) {
          // drain
        }
      }
      ttftMs.sort((a, b) => a - b);

      // 3) Pricing lookup micro-benchmark (10,000 lookups)
      const p0 = performance.now();
      for (let i = 0; i < 10_000; i++) {
        const map = getMergedPricingMap(
          [],
          app.storage.getSettings().customPricing,
          app.storage.getCustomPricingVersion()
        );
        const rate = findModelPricingRate("openai", "gpt-4o-mini", map);
        assert.ok(rate);
      }
      const pricing10kMs = performance.now() - p0;

      // 4) tokenSaver short-path & large-prompt LRU cache micro-benchmark
      const s0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        compressText("Please summarize this short prompt cleanly.", { enabled: true });
      }
      const short1kMs = performance.now() - s0;

      const bigPrompt = "Line with   extra   spaces\n\n\n".repeat(1200);
      const cCold0 = performance.now();
      compressText(bigPrompt, { enabled: true });
      const bigColdMs = performance.now() - cCold0;
      const cWarm0 = performance.now();
      for (let i = 0; i < 100; i++) {
        compressText(bigPrompt, { enabled: true });
      }
      const bigWarm100Ms = performance.now() - cWarm0;

      const p50NonStream = percentile(nonStreamMs, 0.5);
      const p95NonStream = percentile(nonStreamMs, 0.95);
      const p50Ttft = percentile(ttftMs, 0.5);
      const p95Ttft = percentile(ttftMs, 0.95);
      const rps = (40 / (totalNonStreamMs / 1000)).toFixed(1);

      console.log(
        `[BENCHMARK] Non-stream p50=${p50NonStream.toFixed(2)}ms p95=${p95NonStream.toFixed(2)}ms (${rps} req/s) | ` +
          `SSE TTFT p50=${p50Ttft.toFixed(2)}ms p95=${p95Ttft.toFixed(2)}ms | ` +
          `Pricing 10k=${pricing10kMs.toFixed(2)}ms | TokenSaver short-1k=${short1kMs.toFixed(2)}ms big-cold=${bigColdMs.toFixed(2)}ms big-LRU-100x=${bigWarm100Ms.toFixed(2)}ms`
      );

      assert.ok(p50NonStream < 50, `Expected non-stream p50 < 50ms, got ${p50NonStream}ms`);
      assert.ok(p50Ttft < 50, `Expected SSE TTFT p50 < 50ms, got ${p50Ttft}ms`);
      assert.ok(pricing10kMs < 250, `Expected 10k pricing lookups < 250ms, got ${pricing10kMs}ms`);
      assert.ok(bigWarm100Ms < 50, `Expected 100x LRU big-prompt cache hits < 50ms, got ${bigWarm100Ms}ms`);
    } finally {
      await closeServer(server);
    }
  });
});
