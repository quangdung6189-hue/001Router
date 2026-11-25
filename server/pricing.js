/**
 * Model pricing engine & request cost calculator (USD per 1M tokens), matching 9Router.
 * Combines modelCatalog.json prices with user custom overrides persisted in storage.
 * Memoized by catalog revision + customPricing version so hot-path lookups cost ~0.0001ms.
 */

import { getRawCatalogData, onCatalogReload } from "./catalog/index.js";

const EMPTY_PRESETS = Object.freeze([]);
let catalogRevision = 0;
/** @type {{ rev: number, presetsRef: any, map: Record<string, Record<string, any>> } | null} */
let cachedDefaults = null;
/** @type {{ rev: number, presetsRef: any, customVersion: number, map: Record<string, Record<string, any>> } | null} */
let cachedMerged = null;
/** @type {WeakMap<Record<string, any>, Map<string, any>>} */
const lowerProviderIndexCache = new WeakMap();

onCatalogReload(() => {
  catalogRevision += 1;
  cachedDefaults = null;
  cachedMerged = null;
});

/**
 * Normalize a pricing rate entry (`$/1M tokens`).
 * @param {any} entry
 */
export function normalizePricingRate(entry) {
  if (!entry || typeof entry !== "object") return null;
  const input = Number(entry.input);
  const output = Number(entry.output);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  const normInput = Number.isFinite(input) && input >= 0 ? input : 0;
  const normOutput = Number.isFinite(output) && output >= 0 ? output : 0;
  const cached =
    Number.isFinite(Number(entry.cached)) && Number(entry.cached) >= 0
      ? Number(entry.cached)
      : Number((normInput * 0.5).toFixed(4));
  const reasoning =
    Number.isFinite(Number(entry.reasoning)) && Number(entry.reasoning) >= 0
      ? Number(entry.reasoning)
      : normOutput;
  const cacheCreation =
    Number.isFinite(Number(entry.cache_creation)) && Number(entry.cache_creation) >= 0
      ? Number(entry.cache_creation)
      : normInput;
  return {
    input: normInput,
    output: normOutput,
    cached,
    reasoning,
    cache_creation: cacheCreation
  };
}

/**
 * Build (and memoize) the default pricing map grouped by provider slug from `modelCatalog.json` + presets.
 * @param {any[]} [presets]
 * @returns {Record<string, Record<string, { input: number, output: number, cached: number, reasoning: number, cache_creation: number }>>}
 */
export function getDefaultPricingMap(presets = EMPTY_PRESETS) {
  const presetsKey = Array.isArray(presets) && presets.length > 0 ? presets : EMPTY_PRESETS;
  if (
    cachedDefaults &&
    cachedDefaults.rev === catalogRevision &&
    cachedDefaults.presetsRef === presetsKey
  ) {
    return cachedDefaults.map;
  }

  const map = {};
  const catalog = getRawCatalogData();
  const catalogProviders = catalog?.providers || {};

  for (const [providerId, entry] of Object.entries(catalogProviders)) {
    const models = Array.isArray(entry?.models) ? entry.models : [];
    for (const m of models) {
      if (!m?.id) continue;
      const hasPrice =
        typeof m.inputPrice === "number" ||
        typeof m.outputPrice === "number" ||
        m.free === true;
      if (!hasPrice) continue;
      const rate = normalizePricingRate({
        input: m.free ? 0 : m.inputPrice ?? 0,
        output: m.free ? 0 : m.outputPrice ?? 0,
        cached: m.free ? 0 : m.cachedPrice,
        reasoning: m.free ? 0 : m.reasoningPrice
      });
      if (!rate) continue;
      if (!map[providerId]) map[providerId] = {};
      map[providerId][m.id] = rate;
    }
  }

  for (const p of presets || []) {
    const pid = p.preset || p.slug;
    if (!pid) continue;
    const isFree = p.tier === "free" || p.category === "free-tier" || p.category === "local";
    for (const m of p.modelCatalog || []) {
      if (!m?.id) continue;
      if (map[pid]?.[m.id]) continue;
      const rate = normalizePricingRate({
        input: isFree || m.free ? 0 : m.inputPrice ?? (p.tier === "cheap" ? 0.4 : 2.5),
        output: isFree || m.free ? 0 : m.outputPrice ?? (p.tier === "cheap" ? 1.2 : 10.0)
      });
      if (rate) {
        if (!map[pid]) map[pid] = {};
        map[pid][m.id] = rate;
      }
    }
  }

  cachedDefaults = { rev: catalogRevision, presetsRef: presetsKey, map };
  return map;
}

/**
 * Merge default pricing with user custom overrides.
 * When `customVersion` is provided (from Storage), returns a cached merged map in O(1).
 * @param {any[]} presets
 * @param {Record<string, Record<string, any>>} customPricing
 * @param {number} [customVersion]
 */
export function getMergedPricingMap(presets = EMPTY_PRESETS, customPricing = {}, customVersion = -1) {
  const presetsKey = Array.isArray(presets) && presets.length > 0 ? presets : EMPTY_PRESETS;
  if (
    customVersion >= 0 &&
    cachedMerged &&
    cachedMerged.rev === catalogRevision &&
    cachedMerged.presetsRef === presetsKey &&
    cachedMerged.customVersion === customVersion
  ) {
    return cachedMerged.map;
  }

  const defaults = getDefaultPricingMap(presetsKey);
  const hasCustom = customPricing && typeof customPricing === "object" && Object.keys(customPricing).length > 0;
  if (!hasCustom) {
    if (customVersion >= 0) {
      cachedMerged = { rev: catalogRevision, presetsRef: presetsKey, customVersion, map: defaults };
    }
    return defaults;
  }

  const merged = {};
  for (const [prov, models] of Object.entries(defaults)) {
    merged[prov] = { ...models };
  }
  for (const [prov, models] of Object.entries(customPricing)) {
    if (!models || typeof models !== "object") continue;
    if (!merged[prov]) merged[prov] = {};
    for (const [modelId, rawRate] of Object.entries(models)) {
      const rate = normalizePricingRate(rawRate);
      if (rate) {
        merged[prov][modelId] = { ...rate, custom: true };
      }
    }
  }

  if (customVersion >= 0) {
    cachedMerged = { rev: catalogRevision, presetsRef: presetsKey, customVersion, map: merged };
  }
  return merged;
}

function getLowercaseProviderIndex(provTable) {
  let idx = lowerProviderIndexCache.get(provTable);
  if (!idx) {
    idx = new Map();
    for (const [k, v] of Object.entries(provTable)) {
      idx.set(k.toLowerCase(), v);
    }
    lowerProviderIndexCache.set(provTable, idx);
  }
  return idx;
}

/**
 * Resolve pricing rate for `(providerSlug, modelId)` using custom overrides -> defaults -> prefix match.
 * @param {string} providerSlug
 * @param {string} modelId
 * @param {Record<string, Record<string, any>>} pricingMap
 */
export function findModelPricingRate(providerSlug, modelId, pricingMap) {
  if (!pricingMap || typeof pricingMap !== "object") return null;
  const pKey = String(providerSlug || "").toLowerCase();
  const rawModel = String(modelId || "");
  const bareModel =
    rawModel.includes("/") && rawModel.startsWith(`${pKey}/`)
      ? rawModel.slice(pKey.length + 1)
      : rawModel;

  const provTable = pricingMap[pKey];
  if (provTable) {
    if (provTable[bareModel]) return provTable[bareModel];
    if (provTable[rawModel]) return provTable[rawModel];
    const lowerMap = getLowercaseProviderIndex(provTable);
    const ciHit = lowerMap.get(bareModel.toLowerCase());
    if (ciHit) return ciHit;
  }

  // Fallback: match model ID across all providers
  for (const models of Object.values(pricingMap)) {
    if (models[bareModel]) return models[bareModel];
  }
  return null;
}

/**
 * Calculate estimated USD cost for a request.
 * @param {string} providerSlug
 * @param {string} modelId
 * @param {{ promptTokens?: number, completionTokens?: number, cachedTokens?: number, reasoningTokens?: number }} usage
 * @param {Record<string, Record<string, any>>} pricingMap
 * @returns {number}
 */
export function calculateRequestCost(providerSlug, modelId, usage = {}, pricingMap = {}) {
  const rate = findModelPricingRate(providerSlug, modelId, pricingMap);
  if (!rate) return 0;

  const promptTokens = Math.max(0, Number(usage.promptTokens) || 0);
  const completionTokens = Math.max(0, Number(usage.completionTokens) || 0);
  const cachedTokens = Math.max(0, Math.min(promptTokens, Number(usage.cachedTokens) || 0));
  const uncachedPrompt = Math.max(0, promptTokens - cachedTokens);
  const reasoningTokens = Math.max(0, Number(usage.reasoningTokens) || 0);

  const cost =
    (uncachedPrompt * rate.input) / 1_000_000 +
    (cachedTokens * (rate.cached ?? rate.input * 0.5)) / 1_000_000 +
    (completionTokens * rate.output) / 1_000_000 +
    (reasoningTokens * (rate.reasoning ?? rate.output)) / 1_000_000;

  return Number(cost.toFixed(6));
}
