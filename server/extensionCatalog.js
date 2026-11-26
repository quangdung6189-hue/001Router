import { isRouterKeyModelAllowed } from "./auth.js";
import { getPreset } from "./presets.js";

/**
 * Effort tier visual and functional metadata for 001Router IDE extensions.
 * Each tier maps power level (1..4) to power-scaling colors, glow, and API effort value.
 */
export const EFFORT_TIERS = Object.freeze({
  low: Object.freeze({
    id: "low",
    label: "Low",
    shortLabel: "Low",
    power: 1,
    maxScale: 4,
    percent: 25,
    color: "#10B981",
    accent: "#06B6D4",
    glow: "rgba(16, 185, 129, 0.42)",
    description: "Fast & lightweight response"
  }),
  medium: Object.freeze({
    id: "medium",
    label: "Medium",
    shortLabel: "Med",
    power: 2,
    maxScale: 4,
    percent: 50,
    color: "#3B82F6",
    accent: "#6366F1",
    glow: "rgba(59, 130, 246, 0.48)",
    description: "Balanced speed & reasoning depth"
  }),
  high: Object.freeze({
    id: "high",
    label: "High",
    shortLabel: "High",
    power: 3,
    maxScale: 4,
    percent: 75,
    color: "#E56A4A",
    accent: "#F59E0B",
    glow: "rgba(229, 106, 74, 0.58)",
    description: "Deep multi-step reasoning"
  }),
  xhigh: Object.freeze({
    id: "xhigh",
    label: "XHigh",
    shortLabel: "XHigh",
    power: 4,
    maxScale: 4,
    percent: 100,
    color: "#EC4899",
    accent: "#A855F7",
    glow: "rgba(236, 72, 153, 0.72)",
    description: "Maximum compute & extended thinking"
  }),
  max: Object.freeze({
    id: "max",
    label: "Max",
    shortLabel: "Max",
    power: 4,
    maxScale: 4,
    percent: 100,
    color: "#A855F7",
    accent: "#EC4899",
    glow: "rgba(168, 85, 247, 0.75)",
    description: "Unbounded maximum thinking budget"
  })
});

function buildStops(levelIds) {
  const maxScale = levelIds.length;
  return levelIds.map((id, idx) => {
    const base = EFFORT_TIERS[id] || EFFORT_TIERS.medium;
    const stepPercent = Math.round(((idx + 1) / maxScale) * 100);
    return {
      ...base,
      power: idx + 1,
      maxScale,
      percent: stepPercent
    };
  });
}

function detectSuffixEffort(modelLower) {
  if (modelLower.endsWith("-xhigh")) return "xhigh";
  if (modelLower.endsWith("-max")) return "max";
  if (modelLower.endsWith("-high")) return "high";
  if (modelLower.endsWith("-medium")) return "medium";
  if (modelLower.endsWith("-low")) return "low";
  return null;
}

/**
 * Determine supported effort tiers (`effortLevels`) and `defaultEffort` for a
 * given provider and model pair.
 *
 * @param {{ preset?: string, slug?: string, formatType?: string } | null | undefined} provider
 * @param {string} modelId
 * @param {{ reasoning?: boolean, kind?: string } | null | undefined} [catalogEntry]
 */
export function getModelEffortProfile(provider, modelId, catalogEntry = null) {
  const preset = String(provider?.preset || "").toLowerCase().trim();
  const slug = String(provider?.slug || "").toLowerCase().trim();
  const formatType = String(provider?.formatType || "").toLowerCase().trim();
  const idLower = String(modelId || "").toLowerCase().trim();
  const suffixEffort = detectSuffixEffort(idLower);

  let levels = ["low", "medium", "high"];
  let defaultEffort = "medium";

  const isAnthropicFamily =
    preset === "anthropic" ||
    preset === "claude" ||
    formatType === "anthropic" ||
    idLower.startsWith("claude-");

  const isAntigravityOrCli =
    preset === "antigravity" ||
    preset === "gemini-cli" ||
    slug === "antigravity" ||
    slug === "gemini-cli";

  const isOpenAIFamily =
    preset === "openai" ||
    preset === "codex" ||
    preset === "azure" ||
    idLower.startsWith("gpt-") ||
    /^o[134]($|-)/.test(idLower) ||
    idLower.includes("codex");

  if (isAntigravityOrCli) {
    if (idLower.includes("flash-lite") || idLower.includes("nano")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else if (
      idLower.startsWith("gemini-3") ||
      idLower.startsWith("gemini-4") ||
      idLower.includes("pro") ||
      idLower.includes("ultra") ||
      idLower.includes("neon") ||
      idLower.includes("hydrogen") ||
      idLower.includes("carbon") ||
      idLower.includes("argon") ||
      idLower.includes("claude-sonnet") ||
      idLower.includes("claude-opus") ||
      idLower.includes("claude-fable") ||
      idLower.includes("gpt-oss")
    ) {
      levels = ["low", "medium", "high", "xhigh"];
      defaultEffort = "medium";
    } else if (idLower.includes("flash") || idLower.includes("haiku")) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    }
  } else if (isAnthropicFamily) {
    if (idLower.includes("haiku") || idLower.includes("instant")) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    } else if (
      idLower.includes("opus") ||
      idLower.includes("sonnet") ||
      idLower.includes("fable") ||
      idLower.includes("claude-3-7") ||
      idLower.includes("claude-3.7") ||
      idLower.includes("claude-4") ||
      idLower.includes("claude-5") ||
      catalogEntry?.reasoning
    ) {
      levels = ["low", "medium", "high", "max"];
      defaultEffort = "medium";
    }
  } else if (isOpenAIFamily) {
    if (idLower.includes("nano")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else if (
      /^o[134]($|-)/.test(idLower) ||
      idLower.startsWith("gpt-5") ||
      idLower.startsWith("gpt-6") ||
      idLower.includes("codex") ||
      idLower.includes("astra") ||
      idLower.endsWith("-pro") ||
      idLower.includes("-pro-")
    ) {
      levels = ["low", "medium", "high", "xhigh"];
      defaultEffort = "medium";
    } else if (idLower.includes("mini")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    }
  } else {
    const isDeepReasoningModel =
      catalogEntry?.reasoning === true ||
      idLower.includes("reasoner") ||
      idLower.includes("deepseek-r1") ||
      idLower.includes("deepseek-v4") ||
      idLower.startsWith("gemini-2.5-pro") ||
      idLower.startsWith("gemini-3") ||
      idLower.startsWith("gemini-4") ||
      idLower.includes("thinking") ||
      idLower.includes("qwq") ||
      idLower.startsWith("grok-3") ||
      idLower.startsWith("grok-4");

    if (idLower.includes("flash-lite") || idLower.includes("nano") || idLower.includes("8b-instant")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else if (isDeepReasoningModel) {
      levels = ["low", "medium", "high", "xhigh"];
      defaultEffort = "medium";
    } else {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    }
  }

  if (suffixEffort && levels.includes(suffixEffort)) {
    defaultEffort = suffixEffort;
  } else if (suffixEffort === "xhigh" && !levels.includes("xhigh")) {
    levels = ["low", "medium", "high", "xhigh"];
    defaultEffort = "xhigh";
  } else if (suffixEffort === "max" && !levels.includes("max")) {
    levels = ["low", "medium", "high", "max"];
    defaultEffort = "max";
  }

  const stops = buildStops(levels);
  const maxStop = stops[stops.length - 1];

  return {
    effortLevels: stops,
    defaultEffort,
    maxEffort: maxStop.id,
    maxLabel: maxStop.label,
    maxPower: stops.length
  };
}

function formatModelDisplayName(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw) return "Default";
  return raw;
}

function buildModelDescription(modelId, catalogEntry, provider) {
  if (catalogEntry?.description && typeof catalogEntry.description === "string") {
    return catalogEntry.description;
  }
  const lower = String(modelId || "").toLowerCase();
  if (lower.includes("opus") || lower.includes("fable") || lower.includes("astra") || lower.startsWith("o3") || lower.startsWith("gpt-6")) {
    return "For complex architecture, deep reasoning & hardest challenges";
  }
  if (lower.includes("sonnet") || lower.includes("gpt-5") || lower.includes("codex") || lower.includes("pro") || lower.includes("neon")) {
    return "Best balance of speed, code quality & multi-step reasoning";
  }
  if (lower.includes("haiku") || lower.includes("flash") || lower.includes("mini") || lower.includes("nano") || lower.includes("instant")) {
    return "Fastest response speed for quick edits & answers";
  }
  if (lower.includes("reasoner") || lower.includes("r1") || lower.includes("thinking") || lower.includes("qwq")) {
    return "Extended chain-of-thought reasoning specialist";
  }
  const provName = provider?.name || provider?.slug || "001Router";
  return `Routed through ${provName} (${catalogEntry?.contextWindow ? `${Math.round(catalogEntry.contextWindow / 1000)}K ctx` : "Unified API"})`;
}

/**
 * Build the structured provider -> model -> effort catalog consumed by the
 * 001Router VS Code / Antigravity IDE extension.
 *
 * @param {import("./storage.js").Storage} storage
 * @param {any} [routerKey]
 */
export function buildExtensionCatalog(storage, routerKey = null) {
  const now = Date.now();
  const providers = [];

  for (const provider of storage.getProviders()) {
    if (!provider || provider.enabled === false) continue;

    const presetDef = getPreset(provider.preset);
    const catById = new Map((presetDef?.modelCatalog || []).map((m) => [m.id, m]));
    const keys = Array.isArray(provider.apiKeys) ? provider.apiKeys : [];
    const enabledKeys = keys.filter((k) => k && k.enabled !== false);
    const activeKeys = enabledKeys.filter((k) => !k.cooldownUntil || k.cooldownUntil <= now);
    const isKeyOptional = presetDef?.keyOptional === true;

    const models = [];
    const seenModels = new Set();

    for (const modelId of provider.models || []) {
      if (!modelId || seenModels.has(modelId)) continue;
      if (storage.isModelDisabled?.(provider.slug, modelId)) continue;

      const fullId = `${provider.slug}/${modelId}`;
      if (routerKey && !isRouterKeyModelAllowed(routerKey, fullId)) continue;

      seenModels.add(modelId);
      const cat = catById.get(modelId) || null;
      const effort = getModelEffortProfile(provider, modelId, cat);

      models.push({
        id: modelId,
        fullId,
        label: formatModelDisplayName(modelId),
        description: buildModelDescription(modelId, cat, provider),
        kind: cat?.kind || "chat",
        vision: Boolean(cat?.vision),
        reasoning: Boolean(cat?.reasoning || effort.maxPower >= 4),
        contextWindow: cat?.contextWindow || 128000,
        effort
      });
    }

    if (models.length === 0) continue;

    providers.push({
      id: provider.id,
      slug: provider.slug,
      name: provider.name || presetDef?.name || provider.slug,
      preset: provider.preset || "custom",
      formatType: provider.formatType || "openai",
      color: presetDef?.color || "#E56A4A",
      monogram: presetDef?.monogram || String(provider.name || provider.slug || "01").slice(0, 2).toUpperCase(),
      connectedCount: isKeyOptional ? Math.max(1, enabledKeys.length) : activeKeys.length,
      totalKeys: enabledKeys.length,
      keyOptional: isKeyOptional,
      modelCount: models.length,
      models
    });
  }

  const combos = [];
  for (const combo of storage.getCombos()) {
    if (!combo || combo.enabled === false || !combo.name) continue;
    if (routerKey && !isRouterKeyModelAllowed(routerKey, combo.name)) continue;
    combos.push({
      id: combo.id || combo.name,
      name: combo.name,
      fullId: combo.name,
      strategy: combo.strategy || "fallback",
      targetCount: Array.isArray(combo.targets) ? combo.targets.length : 0,
      description: `Combo (${combo.strategy || "fallback"} · ${Array.isArray(combo.targets) ? combo.targets.length : 0} targets)`,
      effort: getModelEffortProfile({ preset: "combo", slug: "combo" }, combo.name, { reasoning: true })
    });
  }

  const aliases = {};
  for (const [alias, target] of Object.entries(storage.getModelAliases?.() || {})) {
    if (!alias || !target) continue;
    if (routerKey && !isRouterKeyModelAllowed(routerKey, alias) && !isRouterKeyModelAllowed(routerKey, target)) {
      continue;
    }
    aliases[alias] = {
      alias,
      target,
      effort: getModelEffortProfile({ preset: "alias", slug: "alias" }, target, { reasoning: true })
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    providers,
    combos,
    aliases
  };
}
