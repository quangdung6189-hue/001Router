import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCodeAndState } from "../server/oauthFlows.js";
import { exchangeGoogleOAuthPkce, startGoogleOAuthPkce } from "../server/googleOAuth.js";

const CLIENT = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-testsecret123456" };
const REDIRECT = "http://127.0.0.1:1455/oauth2callback";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Build a fake fetch: first token call behaves per `tokenBehaviour`, everything else returns benign JSON. */
function makeFetch(tokenBehaviour) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: String(opts.body || "") });
    if (u.includes("oauth2.googleapis.com/token")) return tokenBehaviour(calls.filter((c) => c.url.includes("/token")).length);
    if (u.includes("userinfo")) return json(200, { email: "me@example.com", name: "Me" });
    if (u.includes("/models")) return json(200, { models: [{ name: "models/gemini-2.0-flash" }] });
    return json(404, {});
  };
  return { fetchImpl, calls };
}

const okToken = () => json(200, { access_token: "ya29.testtoken123456", refresh_token: "1//refresh123456", expires_in: 3600 });

function start() {
  return startGoogleOAuthPkce({ ...CLIENT, callbackUrl: REDIRECT, selectAccount: true });
}

describe("Pasted OAuth callback handling", () => {
  it("1. extractCodeAndState reads full loopback URLs, fragments and bare queries", () => {
    const a = extractCodeAndState({ pastedUrl: `${REDIRECT}?state=S1&code=4%2F0AbC&scope=x` });
    assert.deepEqual(a, { code: "4/0AbC", state: "S1" });
    assert.deepEqual(extractCodeAndState({ pastedUrl: `${REDIRECT}#code=C2&state=S2` }), { code: "C2", state: "S2" });
    assert.deepEqual(extractCodeAndState({ pastedUrl: "?code=C3&state=S3" }), { code: "C3", state: "S3" });
    assert.deepEqual(extractCodeAndState({ pastedUrl: "code=C4&state=S4" }), { code: "C4", state: "S4" });
    assert.deepEqual(extractCodeAndState({ code: "C5", state: "S5" }), { code: "C5", state: "S5" });
    assert.deepEqual(extractCodeAndState({ pastedUrl: `  ${REDIRECT}?code=C6&state=S6  ` }), { code: "C6", state: "S6" });
  });

  it("2. extractCodeAndState gives friendly errors and never echoes the pasted code", () => {
    const secretCode = "4/SUPER-SECRET-CODE";
    const expectError = (input, re) => {
      assert.throws(
        () => extractCodeAndState(input),
        (err) => {
          assert.equal(err.status, 400);
          assert.match(err.message, re);
          assert.ok(!err.message.includes("SUPER-SECRET"), "error must not echo the code");
          return true;
        }
      );
    };
    expectError({ pastedUrl: `${REDIRECT}?error=access_denied&state=S` }, /access_denied/);
    expectError({ pastedUrl: `${REDIRECT}?error=redirect_uri_mismatch` }, /redirect_uri_mismatch/);
    expectError({ pastedUrl: `${REDIRECT}?state=S` }, /no authorization 'code'/);
    expectError({ pastedUrl: "this is not a url ?? " }, /Could not read the pasted callback/);
    expectError({ pastedUrl: `${REDIRECT}?code=${secretCode}&state=S`, code: "OTHER" }, /does not match/);
    expectError({ pastedUrl: `${REDIRECT}?code=${secretCode}&state=S`, state: "DIFFERENT" }, /does not match/);
    expectError({ pastedUrl: `${REDIRECT}?code=${"x".repeat(5000)}` }, /too long/);
  });

  it("3. a pasted loopback URL completes the exchange with the server-held PKCE verifier", async () => {
    const started = start();
    assert.equal(started.redirectUri, REDIRECT);
    const { fetchImpl, calls } = makeFetch(okToken);
    const res = await exchangeGoogleOAuthPkce({
      pastedUrl: `${REDIRECT}?state=${started.state}&code=4%2Fgood-code&scope=openid`,
      fetchImpl
    });
    assert.equal(res.oauthCredentials.refreshToken, "1//refresh123456");
    const form = new URLSearchParams(calls.find((c) => c.url.includes("/token")).body);
    assert.equal(form.get("code"), "4/good-code");
    assert.equal(form.get("redirect_uri"), REDIRECT);
    assert.ok(form.get("code_verifier").length >= 43, "PKCE verifier comes from the stored record");
    // one-time use: pasting the same URL again must fail without calling Google
    const before = calls.length;
    await assert.rejects(
      () => exchangeGoogleOAuthPkce({ pastedUrl: `${REDIRECT}?state=${started.state}&code=4%2Fgood-code`, fetchImpl }),
      /not found, was already used, or has expired/
    );
    assert.equal(calls.length, before);
  });

  it("4. unknown state is rejected before any request to Google", async () => {
    const { fetchImpl, calls } = makeFetch(okToken);
    await assert.rejects(
      () => exchangeGoogleOAuthPkce({ pastedUrl: `${REDIRECT}?state=forged&code=abc`, fetchImpl }),
      (err) => err.status === 400 && /sign-in session/.test(err.message)
    );
    assert.equal(calls.length, 0);
  });

  it("5. Google's invalid_grant / redirect_uri_mismatch / invalid_client become actionable messages", async () => {
    const cases = [
      [{ error: "invalid_grant", error_description: "Bad Request" }, /invalid_grant.*already used.*expired/s],
      [{ error: "redirect_uri_mismatch" }, new RegExp(`add exactly this Authorized redirect URI.*${REDIRECT.replace(/[/.]/g, "\\$&")}`)],
      [{ error: "invalid_client", error_description: "Unauthorized" }, /Client ID or Client Secret is wrong/]
    ];
    for (const [body, re] of cases) {
      const started = start();
      const { fetchImpl } = makeFetch(() => json(400, body));
      await assert.rejects(
        () => exchangeGoogleOAuthPkce({ pastedUrl: `${REDIRECT}?state=${started.state}&code=4%2Fabc`, fetchImpl }),
        (err) => {
          assert.equal(err.status, 400);
          assert.match(err.message, re);
          assert.ok(!err.message.includes("GOCSPX-testsecret"), "client secret must not leak");
          return true;
        }
      );
    }
  });

  it("6. a pure network failure keeps the PKCE session so the same URL can be pasted again", async () => {
    const started = start();
    let failed = false;
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/token") && !failed) {
        failed = true;
        throw new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com");
      }
      if (u.includes("/token")) return okToken();
      if (u.includes("userinfo")) return json(200, { email: "me@example.com" });
      return json(200, { models: [] });
    };
    const pasted = `${REDIRECT}?state=${started.state}&code=4%2Fretry`;
    await assert.rejects(
      () => exchangeGoogleOAuthPkce({ pastedUrl: pasted, fetchImpl }),
      (err) => err.status === 502 && /Could not reach Google/.test(err.message)
    );
    const ok = await exchangeGoogleOAuthPkce({ pastedUrl: pasted, fetchImpl });
    assert.equal(ok.oauthCredentials.refreshToken, "1//refresh123456");
  });

  it("7. expired sessions say so (10 minute limit)", async () => {
    let t = 1_000_000;
    const started = startGoogleOAuthPkce({ ...CLIENT, callbackUrl: REDIRECT, nowFn: () => t });
    const { fetchImpl } = makeFetch(okToken);
    await assert.rejects(
      () =>
        exchangeGoogleOAuthPkce({
          pastedUrl: `${REDIRECT}?state=${started.state}&code=abc`,
          fetchImpl,
          nowFn: () => t + 11 * 60 * 1000
        }),
      /not found, was already used, or has expired|expired/
    );
  });
});
