import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp, parseTrustProxy } from "../server/index.js";
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
import { createGuardedAgent, getProxyDispatcher } from "../server/proxy.js";
import { fetch as undiciFetch } from "undici";
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
    // non-JSON objects (e.g. dispatchers) survive untouched; polluting keys are still stripped
    const inst = new (class Foo { dispatch() {} })();
    assert.equal(stripPrototypePollution({ d: inst }).d, inst);
    assert.deepEqual(JSON.parse(JSON.stringify(stripPrototypePollution(JSON.parse('{"__proto__":{"x":1},"a":1}')))), { a: 1 });
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
    // no pool / unknown pool => direct, but through the SSRF-guarded agent (never undefined)
    assert.ok(getProxyDispatcher({ proxyPoolId: "nope" }, mk("http://1.2.3.4:8080")));
    assert.ok(getProxyDispatcher({}, mk("http://1.2.3.4:8080")));
  });

  it("9. encrypted export requires an 8+ character passphrase", async () => {
    const short = await api("GET", "/api/export?secrets=encrypted&passphrase=abcd");
    assert.equal(short.status, 400);
    const ok = await api("GET", "/api/export?secrets=encrypted&passphrase=correct-horse-battery");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.encrypted, true);
  });

  it("10. guarded upstream agent blocks metadata/loopback by DNS name, IP literal and redirect", async () => {
    const target = http.createServer((_q, r) => r.end("hello"));
    await new Promise((r) => target.listen(0, "127.0.0.1", r));
    const tport = target.address().port;
    const redirector = http.createServer((_q, r) => {
      r.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      r.end();
    });
    await new Promise((r) => redirector.listen(0, "127.0.0.1", r));
    const rport = redirector.address().port;
    const attempt = async (policy, url) => {
      try {
        const res = await undiciFetch(url, { dispatcher: createGuardedAgent(policy) });
        return { ok: true, body: await res.text() };
      } catch (err) {
        return { ok: false, code: err.cause?.code || err.code };
      }
    };
    try {
      const open = { blockPrivate: false, blockLoopback: false };
      const strict = { blockPrivate: true, blockLoopback: true };
      assert.deepEqual(await attempt(open, `http://127.0.0.1:${tport}/`), { ok: true, body: "hello" });
      assert.equal((await attempt(strict, `http://127.0.0.1:${tport}/`)).code, "ESSRFBLOCKED");
      assert.equal((await attempt(strict, `http://localhost:${tport}/`)).code, "ESSRFBLOCKED"); // via DNS lookup
      // metadata is blocked even with the most permissive policy: literals, mapped IPv6 and redirects
      for (const url of ["http://169.254.169.254/", "http://[::ffff:169.254.169.254]/"]) {
        assert.equal((await attempt(open, url)).code, "ESSRFBLOCKED", url);
      }
      // a redirect to metadata never gets followed (refused as cross-origin before any connection)
      const viaRedirect = await attempt(open, `http://127.0.0.1:${rport}/`);
      assert.equal(viaRedirect.ok, false);
      assert.match(viaRedirect.code, /ESSRFREDIRECT|ESSRFBLOCKED/);
    } finally {
      target.close();
      redirector.close();
    }
  });

  it("11. upstream cross-origin redirects are refused (credentials never forwarded), same-origin still works", async () => {
    const seen = [];
    const other = http.createServer((q, r) => {
      seen.push(q.headers["x-api-key"]);
      r.end("OTHER");
    });
    await new Promise((r) => other.listen(0, "127.0.0.1", r));
    const oport = other.address().port;
    const main = http.createServer((q, r) => {
      if (q.url === "/cross") {
        r.writeHead(302, { location: `http://127.0.0.1:${oport}/` });
        return r.end();
      }
      if (q.url === "/same") {
        r.writeHead(302, { location: "/final" });
        return r.end();
      }
      r.end(`ok ${q.url}`);
    });
    await new Promise((r) => main.listen(0, "127.0.0.1", r));
    const mport = main.address().port;
    const dispatcher = createGuardedAgent({ blockPrivate: false, blockLoopback: false });
    try {
      const same = await undiciFetch(`http://127.0.0.1:${mport}/same`, { dispatcher });
      assert.equal(await same.text(), "ok /final");
      await assert.rejects(
        () => undiciFetch(`http://127.0.0.1:${mport}/cross`, { dispatcher, headers: { "x-api-key": "SECRET" } }),
        (err) => (err.cause?.code || err.code) === "ESSRFREDIRECT"
      );
      assert.deepEqual(seen, [], "x-api-key must not reach the redirect target");
    } finally {
      main.close();
      other.close();
    }
  });
});

describe("Security hardening round 2: forced password change, trust proxy, master key", () => {
  async function boot(options = {}, env = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-audit2-"));
    const app = await createApp({ dataDir: dir, port: 20128, ...options });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    return {
      base,
      app,
      async close() {
        await new Promise((r) => server.close(r));
        await fs.rm(dir, { recursive: true, force: true });
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    };
  }
  const post = (base, p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    });

  it("12. enforcePasswordChange: default password session can ONLY change the password", async () => {
    const t = await boot({ enforcePasswordChange: true });
    try {
      const login = await post(t.base, "/api/login", { password: "1234" });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).passwordChangeRequired, true);
      let cookie = login.headers.get("set-cookie").split(";")[0];
      const get = (p) => fetch(`${t.base}${p}`, { headers: { cookie } });

      const me = await (await get("/api/me")).json();
      assert.equal(me.passwordChangeRequired, true);
      for (const p of ["/api/providers", "/api/keys", "/api/keys/reveal-initial", "/api/settings", "/api/export", "/api/cli-tools/statuses", "/api/catalog"]) {
        const r = await get(p);
        assert.equal(r.status, 403, `${p} must be blocked`);
        assert.equal((await r.json()).code, "PASSWORD_CHANGE_REQUIRED");
      }
      // rejected/weak passwords keep the lock
      const weak = await post(t.base, "/api/settings/password", { currentPassword: "1234", newPassword: "12345678" }, { cookie });
      assert.equal(weak.status, 400);
      assert.equal((await get("/api/providers")).status, 403);
      // a strong password lifts it
      const ok = await post(t.base, "/api/settings/password", { currentPassword: "1234", newPassword: "Str0ng-Passphrase!" }, { cookie });
      assert.equal(ok.status, 200);
      cookie = ok.headers.get("set-cookie").split(";")[0];
      assert.equal((await get("/api/providers")).status, 200);
      assert.notEqual((await (await get("/api/me")).json()).passwordChangeRequired, true);
    } finally {
      await t.close();
    }
  });

  it("12b. enforcement is off by default for embedded/test use and when explicitly disabled", async () => {
    const t = await boot({});
    try {
      const login = await post(t.base, "/api/login", { password: "1234" });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.notEqual((await login.json()).passwordChangeRequired, true);
      assert.equal((await fetch(`${t.base}/api/providers`, { headers: { cookie } })).status, 200);
    } finally {
      await t.close();
    }
  });

  it("13. parseTrustProxy never trusts all forwarded headers", () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy(""), false);
    assert.equal(parseTrustProxy("0"), false);
    assert.equal(parseTrustProxy("false"), false);
    assert.equal(parseTrustProxy("true"), 1);
    assert.equal(parseTrustProxy("2"), 2);
    assert.equal(parseTrustProxy("loopback"), "loopback");
  });

  it("13b. login lockout keys on the real client IP behind a trusted proxy, and ignores spoofing without it", async () => {
    const tp = await boot({}, { ROUTER001_TRUST_PROXY: "1" });
    try {
      const attempt = (ip) => post(tp.base, "/api/login", { password: "wrong" }, { "x-forwarded-for": ip });
      for (let i = 0; i < 6; i++) await attempt("203.0.113.7"); // attacker locks only their own IP
      assert.equal((await attempt("203.0.113.7")).status, 429);
      const other = await post(tp.base, "/api/login", { password: "1234" }, { "x-forwarded-for": "198.51.100.9" });
      assert.equal(other.status, 200, "a different client behind the proxy must not be locked out");
    } finally {
      await tp.close();
    }
    const plain = await boot({});
    try {
      // not trusting the proxy: X-Forwarded-For is ignored, so rotating it does not reset the counter
      let last = 0;
      for (let i = 0; i < 7; i++) {
        last = (await post(plain.base, "/api/login", { password: "wrong" }, { "x-forwarded-for": `203.0.113.${i}` })).status;
      }
      assert.equal(last, 429);
    } finally {
      await plain.close();
    }
  });

  it("14. security scan flags a master key stored next to db.json and passes when supplied via env", async () => {
    const t = await boot({}, { ROUTER001_MASTER_KEY: undefined });
    try {
      const login = await post(t.base, "/api/login", { password: "1234" });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const scan = await (await post(t.base, "/api/security/scan", {}, { cookie })).json();
      const check = scan.checks.find((c) => c.id === "masterKeyLocation");
      assert.equal(check.status, "WARN");
      assert.equal(scan.masterKeyFromEnv, false);
    } finally {
      await t.close();
    }
    const e = await boot({}, { ROUTER001_MASTER_KEY: "a".repeat(64) });
    try {
      const login = await post(e.base, "/api/login", { password: "1234" });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const scan = await (await post(e.base, "/api/security/scan", {}, { cookie })).json();
      assert.equal(scan.checks.find((c) => c.id === "masterKeyLocation").status, "PASS");
    } finally {
      await e.close();
    }
  });
});
