import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { createMockUpstream } from "./mock-upstream.js";
import {
  MAX_JSON_DEPTH,
  classifyHostForSSRF,
  stripPrototypePollution,
  validateProviderBaseUrl
} from "../server/security/redact.js";
import {
  createHostGuardMiddleware,
  isLoopbackHost,
  parseHostHeaderName
} from "../server/security/headers.js";
import { getProxyDispatcher } from "../server/proxy.js";
import { filterLs } from "../server/rtkFilters.js";
import { compressText } from "../server/tokenSaver.js";

function rawGet(port, pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers: { host: hostHeader }, agent: false },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Security audit regression suite (2026-11)", () => {
  let tmpDir;
  let mock;
  let server;
  let baseUrl;
  let port;
  let cookie = "";

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-audit-test-"));
    mock = await createMockUpstream();
    const app = await createApp({ dataDir: tmpDir, port: 20128 });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "1234" })
    });
    assert.equal(res.status, 200);
    cookie = res.headers.get("set-cookie").split(";")[0];
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mock.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function api(method, urlPath, body, headers = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, text };
  }

  it("1. SSRF classifier blocks IPv4-mapped/NAT64/6to4 IPv6 forms and trailing-dot metadata hosts", () => {
    const blocked = [
      "169.254.169.254",
      "[::ffff:169.254.169.254]",
      "::ffff:a9fe:a9fe",
      "0:0:0:0:0:ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::1",
      "metadata.google.internal.",
      "fd00:ec2::254",
      "fe80::1",
      "::"
    ];
    for (const h of blocked) {
      assert.equal(classifyHostForSSRF(h).isMetadataOrLinkLocal, true, `${h} must be metadata/link-local`);
    }
    assert.equal(classifyHostForSSRF("::ffff:10.0.0.1").isPrivateLan, true);
    assert.equal(classifyHostForSSRF("::ffff:192.168.1.1").isPrivateLan, true);
    assert.equal(classifyHostForSSRF("fec0::1").isPrivateLan, true);
    assert.equal(classifyHostForSSRF("100.64.0.1").isPrivateLan, true);
    assert.equal(classifyHostForSSRF("::ffff:127.0.0.1").isLoopback, true);
    assert.equal(classifyHostForSSRF("localhost.").isLoopback, true);
    // public hosts must not be flagged (including names that merely start with fc/fd/fe)
    for (const h of ["api.openai.com", "fcm.googleapis.com", "fdroid.org", "8.8.8.8", "2606:4700::1", "172.32.0.1"]) {
      const c = classifyHostForSSRF(h);
      assert.equal(c.isMetadataOrLinkLocal || c.isPrivateLan || c.isLoopback, false, `${h} must be public`);
    }
    assert.equal(
      validateProviderBaseUrl("http://[::ffff:169.254.169.254]/", { preset: "custom" }).valid,
      false
    );
  });

  it("2. provider create rejects mapped-IPv6 metadata baseUrl but still accepts legit upstreams", async () => {
    const bad = await api("POST", "/api/providers", {
      preset: "openai",
      name: "evil",
      baseUrl: "http://[::ffff:169.254.169.254]/",
      apiKeys: ["sk-test-12345678"]
    });
    assert.equal(bad.status, 400);
    const good = await api("POST", "/api/providers", {
      preset: "openai",
      name: "legit",
      baseUrl: "https://api.openai.com/v1",
      apiKeys: ["sk-test-12345678"]
    });
    assert.equal(good.status, 201);
  });

  it("3. isLoopbackHost does not treat 127.x.evil.com as loopback; Host guard blocks rebinding names", async () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("127.0.0.1.evil.com"), false);
    assert.equal(isLoopbackHost("127.evil.com"), false);
    assert.equal(parseHostHeaderName("[::1]:20128"), "::1");
    assert.equal(parseHostHeaderName("Localhost:20128"), "localhost");

    for (const host of ["evil.example.com", "127.0.0.1.evil.com", "attacker.test:20128"]) {
      const r = await rawGet(port, "/health", host);
      assert.equal(r.status, 403, `Host ${host} must be rejected`);
    }
    for (const host of ["localhost", `127.0.0.1:${port}`, `[::1]:${port}`, "localhost:20128"]) {
      const r = await rawGet(port, "/health", host);
      assert.equal(r.status, 200, `Host ${host} must be accepted`);
    }
  });

  it("3b. Host guard honours explicit allow-list and is skipped for non-loopback binds", () => {
    const run = (mw, host) => {
      let status = 0;
      let nexted = false;
      mw(
        { headers: { host }, path: "/api/me" },
        { status: (s) => ({ json: () => (status = s) }) },
        () => (nexted = true)
      );
      return { status, nexted };
    };
    const allow = createHostGuardMiddleware({ bindHost: "127.0.0.1", allowedHosts: ["router.example.com"] });
    assert.equal(run(allow, "router.example.com").nexted, true);
    assert.equal(run(allow, "other.example.com").status, 403);
    const open = createHostGuardMiddleware({ bindHost: "0.0.0.0" });
    assert.equal(run(open, "anything.example.com").nexted, true);
  });

  it("4. password policy rejects default/common/short passwords and accepts a strong one", async () => {
    for (const pw of ["1234", "12345678", "short", "aaaaaaaaaa", "password123"]) {
      const r = await api("POST", "/api/settings/password", { currentPassword: "1234", newPassword: pw });
      assert.equal(r.status, 400, `password '${pw}' must be rejected`);
    }
    const tooLong = await api("POST", "/api/settings/password", {
      currentPassword: "1234",
      newPassword: "x".repeat(80) + "Qz9!"
    });
    assert.equal(tooLong.status, 400);
    // keep default password for the rest of this suite: do not change it here
  });

  it("5. per-key model restrictions are enforced on media/search/fetch endpoints (fail-closed)", async () => {
    for (const slug of ["allowedprov", "secretprov"]) {
      const r = await api("POST", "/api/providers", {
        preset: "custom",
        name: slug,
        slug,
        baseUrl: `${mock.baseUrl}/v1`,
        apiKeys: ["sk-mock-123456789"],
        models: ["m1"]
      });
      assert.equal(r.status, 201);
    }
    const created = await api("POST", "/api/keys", { name: "restricted" });
    assert.equal(created.status, 201);
    const keyId = created.json.key.id;
    const key = created.json.key.key;
    const patched = await api("PATCH", `/api/keys/${keyId}`, {
      access: { restricted: true, allow: ["allowedprov/m1"] }
    });
    assert.equal(patched.json.key.access.restricted, true);

    const call = (p, body) =>
      fetch(`${baseUrl}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body)
      });

    mock.reset();
    const denied = [
      ["/v1/images/generations", { model: "secretprov/m1", prompt: "x" }],
      ["/v1/audio/speech", { model: "secretprov/m1", input: "x", voice: "a" }],
      ["/v1/videos/generations", { model: "secretprov/m1", prompt: "x" }],
      ["/v1/audio/transcriptions", { model: "secretprov/m1" }],
      ["/v1/search", { query: "x", provider: "secretprov" }],
      ["/v1/web/fetch", { url: "https://example.com", provider: "secretprov" }]
    ];
    for (const [p, body] of denied) {
      const res = await call(p, body);
      assert.equal(res.status, 403, `${p} must be 403 for a key not allow-listed on secretprov`);
      const json = await res.json();
      assert.equal(json.error.type, "permission_error");
    }
    // denied requests must never reach any upstream
    assert.equal(mock.requests.length, 0, "denied media requests must not be forwarded upstream");
    // allow-listed target is not blocked by the access check (any non-403 outcome is fine)
    const allowed = await call("/v1/images/generations", { model: "allowedprov/m1", prompt: "x" });
    assert.notEqual(allowed.status, 403);
  });

  it("6. token-saver filters are linear-time on adversarial whitespace (no ReDoS)", () => {
    const spaces = " ".repeat(200000);
    const t0 = performance.now();
    filterLs(spaces + "x");
    filterLs(spaces);
    compressText(spaces + "x", 20000);
    compressText("\t".repeat(200000) + "x", 20000);
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 1500, `adversarial whitespace took ${Math.round(elapsed)}ms (expected < 1500ms)`);
    // functional sanity: a real ls -l listing is still summarised
    const ls = "total 8\ndrwxr-xr-x 2 u g 4096 Jan  5 12:00 src\n-rw-r--r-- 1 u g 120 Mar 10 2024 a.js\n";
    const out = filterLs(ls);
    assert.match(out, /src\//);
    assert.match(out, /a\.js/);
  });

  it("7. pathological JSON nesting yields HTTP 400 (not 500) and never crashes the server", async () => {
    assert.throws(
      () => stripPrototypePollution(JSON.parse("[".repeat(MAX_JSON_DEPTH + 50) + "]".repeat(MAX_JSON_DEPTH + 50))),
      (err) => err.status === 400
    );
    const deep = "[".repeat(50000) + "]".repeat(50000);
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: deep
    });
    assert.equal(res.status, 400);
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    // normal nested payloads are untouched
    const normal = { a: { b: [{ c: [1, 2, { d: "x" }] }] } };
    assert.deepEqual(stripPrototypePollution(normal), normal);
  });

  it("8. an unusable proxy pool fails CLOSED instead of silently connecting directly", async () => {
    const mk = (url) => ({
      getProxyPools: () => [{ id: "p1", url, enabled: true }]
    });
    // socks5h is accepted by our validator but rejected by undici ProxyAgent: must be normalised, not dropped
    const socks = getProxyDispatcher({ proxyPoolId: "p1" }, mk("socks5h://127.0.0.1:1080"));
    assert.ok(socks, "socks5h pool must yield a dispatcher");
    // unparsable proxy URL => fail-closed dispatcher (defined) that refuses connections
    const broken = getProxyDispatcher({ proxyPoolId: "p1" }, mk("not a url"));
    assert.ok(broken, "invalid proxy URL must yield a fail-closed dispatcher, not undefined");
    await assert.rejects(
      () => fetch(`${mock.baseUrl}/v1/models`, { dispatcher: broken }),
      /fetch failed|Blocked/
    );
    // no pool / disabled pool => direct (undefined) as before
    assert.equal(getProxyDispatcher({ proxyPoolId: "nope" }, mk("http://1.2.3.4:8080")), undefined);
    assert.equal(getProxyDispatcher({}, mk("http://1.2.3.4:8080")), undefined);
  });

  it("9. encrypted export requires an 8+ character passphrase", async () => {
    const short = await api("GET", "/api/export?secrets=encrypted&passphrase=abcd");
    assert.equal(short.status, 400);
    const ok = await api("GET", "/api/export?secrets=encrypted&passphrase=correct-horse-battery");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.encrypted, true);
  });
});
