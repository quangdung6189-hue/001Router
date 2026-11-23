import { test } from "node:test";
import assert from "node:assert/strict";
import { getCooldownScope, RouterService } from "../server/router.js";

test("cooldown scope: auth/billing/quota lock the key, plain rate limits lock only the model", () => {
  assert.equal(getCooldownScope(401, "Invalid API key"), "key");
  assert.equal(getCooldownScope(402, ""), "key");
  assert.equal(getCooldownScope(403, "Forbidden"), "key");
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
