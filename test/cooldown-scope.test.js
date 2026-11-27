import { test } from "node:test";
import assert from "node:assert/strict";
import { getCooldownScope, isModelPackageUnavailableError, RouterService } from "../server/router.js";

test("cooldown scope: auth/billing/quota lock the key, plain rate limits lock only the model", () => {
  assert.equal(getCooldownScope(401, "Invalid API key"), "key");
  assert.equal(getCooldownScope(402, ""), "key");
  assert.equal(getCooldownScope(403, "Forbidden"), "key");
  assert.equal(
    getCooldownScope(403, "upstream deepseek HTTP 403: Model claude-fable-5.1 không nằm trong gói token của key này."),
    "model"
  );
  assert.equal(
    isModelPackageUnavailableError(403, "Model claude-fable-5.1 không nằm trong gói token của key này."),
    true
  );
  assert.equal(
    isModelPackageUnavailableError(403, "API Key 所属分组已停用"),
    true
  );
  assert.equal(getCooldownScope(429, "Quota exceeded"), "key");
  assert.equal(getCooldownScope(429, "Your account is not active, please check your billing details"), "key");
  assert.equal(getCooldownScope(429, "Insufficient balance"), "key");
  assert.equal(getCooldownScope(429, "Rate limit reached for model deepseek-v4-flash"), "model");
  assert.equal(getCooldownScope(429, "Model is overloaded, try again later"), "model");
  assert.equal(getCooldownScope(503, "Service temporarily unavailable"), null);
  assert.equal(getCooldownScope(500, "boom"), null);
});

test("a per-model cooldown never blocks other models on the same key", () => {
  const storage = { getSettings: () => ({}), getProviders: () => [] };
  const router = new RouterService(storage);
  const provider = { id: "p1", slug: "deepseek", apiKeys: [{ id: "k1", key: "sk-x", enabled: true }] };

  router.modelCooldowns.set(router._modelCooldownKey("p1", "k1", "model-a"), Date.now() + 60_000);

  const forA = router.getOrderedActiveKeys(provider, "model-a");
  assert.equal(forA.keys.length, 0);
  assert.equal(forA.allInCooldown, true);

  const forB = router.getOrderedActiveKeys(provider, "model-b");
  assert.equal(forB.keys.length, 1);
  assert.equal(forB.keys[0].id, "k1");

  // Expired entries are dropped and the key is usable again.
  router.modelCooldowns.set(router._modelCooldownKey("p1", "k1", "model-a"), Date.now() - 1);
  assert.equal(router.getOrderedActiveKeys(provider, "model-a").keys.length, 1);
});

test("getOrderedActiveKeys prioritizes the key whose synced packageModels contains the requested model", () => {
  const storage = { getSettings: () => ({ fallbackStrategy: "fill-first" }), getProviders: () => [] };
  const router = new RouterService(storage);
  const provider = {
    id: "p-pkg",
    slug: "deepseek",
    apiKeys: [
      { id: "k-other", key: "sk-1", enabled: true, oauthMeta: { packageModels: ["deepseek-chat"] } },
      { id: "k-match", key: "sk-2", enabled: true, oauthMeta: { packageModels: ["claude-sonnet-5"] } }
    ]
  };
  const ordered = router.getOrderedActiveKeys(provider, "claude-sonnet-5");
  assert.equal(ordered.keys.length, 2);
  assert.equal(ordered.keys[0].id, "k-match");
});
