import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchGeminiCliQuota,
  loadGeminiCliProject
} from "../server/geminiCliOAuth.js";

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

function makeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    for (const h of handlers) {
      const res = await h(url, init);
      if (res) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

describe("Gemini CLI plan + quota probes (used by connection test and /api/quota)", () => {
  it("1. loadGeminiCliProject resolves the auto-provisioned project and free tier", async () => {
    const { fetchImpl, calls } = makeFetch([
      (url) =>
        url.includes("loadCodeAssist")
          ? json(200, {
              cloudaicompanionProject: "cli-project-42",
              currentTier: { name: "Starter" },
              paidTier: { id: "free-tier", name: "Starter Quota" }
            })
          : null
    ]);

    const plan = await loadGeminiCliProject("ya29.token", { fetchImpl });
    assert.equal(plan.projectId, "cli-project-42");
    assert.equal(plan.tier, "free");
    assert.match(plan.tierLabel, /Starter/);

    // The probe must hit v1internal:loadCodeAssist — never {baseUrl}/models, which 401s for
    // CLI accounts (the bug this guards against).
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /cloudcode-pa\.googleapis\.com\/v1internal:loadCodeAssist$/);
    assert.equal(calls[0].init.method, "POST");
    assert.ok(calls[0].init.headers["client-metadata"]);
  });

  it("2. loadGeminiCliProject reports a paid plan when paidTier is not the free tier", async () => {
    const { fetchImpl } = makeFetch([
      () =>
        json(200, {
          cloudaicompanionProject: { id: "paid-project" },
          currentTier: { name: "Pro" },
          paidTier: { id: "g1-pro-tier", name: "Google AI Pro" }
        })
    ]);
    const plan = await loadGeminiCliProject("ya29.token", { fetchImpl });
    assert.equal(plan.projectId, "paid-project");
    assert.equal(plan.tier, "paid");
    assert.match(plan.tierLabel, /Google AI Pro/);
  });

  it("3. loadGeminiCliProject surfaces upstream failures instead of pretending success", async () => {
    const { fetchImpl } = makeFetch([
      () => json(401, { error: { message: "Request is missing required authentication credential." } })
    ]);
    await assert.rejects(
      () => loadGeminiCliProject("ya29.bad", { fetchImpl }),
      (err) => err.status === 400 && /loadCodeAssist failed/.test(err.message)
    );
  });

  it("4. fetchGeminiCliQuota normalizes remainingFraction buckets", async () => {
    const { fetchImpl, calls } = makeFetch([
      (url) =>
        url.includes("retrieveUserQuota")
          ? json(200, {
              buckets: [
                { modelId: "gemini-2.5-pro", remainingFraction: 0.8, resetTime: "2026-01-01T00:00:00Z" },
                { modelId: "gemini-2.5-flash", remainingFraction: "0.35" },
                { modelId: "", remainingFraction: 0.5 },
                { modelId: "broken" }
              ]
            })
          : null
    ]);

    const quota = await fetchGeminiCliQuota("ya29.token", {
      projectId: "cli-project-42",
      fetchImpl
    });

    assert.equal(quota.buckets.length, 2, "entries without a model or fraction are dropped");
    assert.equal(quota.buckets[0].modelId, "gemini-2.5-pro");
    assert.equal(quota.buckets[0].remainingFraction, 0.8);
    assert.equal(quota.buckets[1].remainingFraction, 0.35);

    assert.match(calls[0].url, /v1internal:retrieveUserQuota$/);
    assert.deepEqual(JSON.parse(calls[0].init.body), { project: "cli-project-42" });
  });

  it("5. fetchGeminiCliQuota omits the project body when none is known", async () => {
    const { fetchImpl, calls } = makeFetch([() => json(200, { buckets: [] })]);
    const quota = await fetchGeminiCliQuota("ya29.token", { fetchImpl });
    assert.deepEqual(quota.buckets, []);
    assert.deepEqual(JSON.parse(calls[0].init.body), {});
  });
});
