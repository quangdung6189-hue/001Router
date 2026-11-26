import { isRouterKeyModelAllowed } from "./auth.js";
import { getAllCliToolStatuses } from "./cliTools.js";
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

const EFFORT_SUFFIX_RE = /^(.*?)-(minimal|low|medium|high|xhigh|max)$/i;
const PRODUCT_MAX_RE = /(?:qwen|codex|minimax|mistral|doubao|glm|kimi|ernie|step|hunyuan|deepseek|grok|nova|sonar|baichuan|yi)[^/]*-max$/i;
const EFFORT_ORDER = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

function splitEffortSuffix(modelId) {
  const raw = String(modelId || "").trim();
  const m = EFFORT_SUFFIX_RE.exec(raw);
  if (!m || !m[1]) return { baseId: raw, suffix: null };
  let suffix = m[2].toLowerCase();
  if (suffix === "max" && PRODUCT_MAX_RE.test(raw)) {
    return { baseId: raw, suffix: null };
  }
  if (suffix === "minimal") suffix = "low";
  return { baseId: m[1], suffix };
}

function detectSuffixEffort(modelLower) {
  const { suffix } = splitEffortSuffix(modelLower);
  return suffix;
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
  const bareId = idLower.includes("/") ? idLower.slice(idLower.lastIndexOf("/") + 1) : idLower;
  const suffixEffort = detectSuffixEffort(bareId);

  let levels = ["low", "medium", "high"];
  let defaultEffort = "medium";

  const isAnthropicFamily =
    preset === "anthropic" ||
    preset === "claude" ||
    formatType === "anthropic" ||
    bareId.startsWith("claude-") ||
    idLower.startsWith("anthropic/");

  const isAntigravityOrCli =
    preset === "antigravity" ||
    preset === "gemini-cli" ||
    slug === "antigravity" ||
    slug === "gemini-cli";

  const isOpenAIFamily =
    preset === "openai" ||
    preset === "codex" ||
    preset === "azure" ||
    bareId.startsWith("gpt-") ||
    /^o[134]($|-)/.test(bareId) ||
    bareId.includes("codex") ||
    idLower.startsWith("openai/");

  if (isAntigravityOrCli) {
    if (bareId.includes("flash-lite") || bareId.includes("nano")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else if (bareId.includes("carbon")) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    } else if (
      bareId.startsWith("gemini-3") ||
      bareId.startsWith("gemini-4") ||
      bareId.includes("pro") ||
      bareId.includes("ultra") ||
      bareId.includes("neon") ||
      bareId.includes("hydrogen") ||
      bareId.includes("argon") ||
      bareId.includes("claude-sonnet") ||
      bareId.includes("claude-opus") ||
      bareId.includes("claude-fable") ||
      bareId.includes("claude-haiku-5")
    ) {
      levels = ["low", "medium", "high", "xhigh"];
      defaultEffort = "medium";
    } else if (bareId.includes("gpt-oss") || bareId.includes("flash") || bareId.includes("haiku")) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    }
  } else if (isAnthropicFamily) {
    const isLegacyHaiku =
      (bareId.includes("haiku") && !/haiku[-._]?[5-9]/.test(bareId)) ||
      bareId.includes("instant") ||
      bareId.startsWith("claude-2") ||
      bareId.startsWith("claude-3-haiku") ||
      bareId.startsWith("claude-3-5-haiku");

    if (isLegacyHaiku) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    } else if (
      bareId.includes("opus") ||
      bareId.includes("sonnet") ||
      bareId.includes("fable") ||
      /haiku[-._]?[5-9]/.test(bareId) ||
      bareId.includes("claude-3-7") ||
      bareId.includes("claude-3.7") ||
      bareId.includes("claude-4") ||
      bareId.includes("claude-5") ||
      catalogEntry?.reasoning === true
    ) {
      levels = ["low", "medium", "high", "max"];
      defaultEffort = "medium";
    }
  } else if (isOpenAIFamily) {
    const isNextGenReasoning =
      /^o[134]($|-)/.test(bareId) ||
      bareId.startsWith("gpt-5") ||
      bareId.startsWith("gpt-6") ||
      bareId.includes("codex") ||
      bareId.includes("astra") ||
      bareId.includes("sol") ||
      bareId.includes("luna") ||
      bareId.includes("terra") ||
      bareId.endsWith("-pro") ||
      bareId.includes("-pro-");

    if (bareId.includes("gpt-5") && (bareId.includes("nano") || bareId.includes("mini"))) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    } else if (/^o[34]-mini/.test(bareId)) {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    } else if (isNextGenReasoning) {
      levels = ["low", "medium", "high", "xhigh"];
      defaultEffort = "medium";
    } else if (bareId.includes("nano") || bareId.includes("mini")) {
      levels = ["low", "medium"];
      defaultEffort = "low";
    } else {
      levels = ["low", "medium", "high"];
      defaultEffort = "medium";
    }
  } else {
    const isDeepReasoningModel =
      catalogEntry?.reasoning === true ||
      bareId.includes("reasoner") ||
      bareId.includes("deepseek-r1") ||
      bareId.includes("deepseek-v3.1") ||
      bareId.includes("deepseek-v3.2") ||
      bareId.includes("deepseek-v4") ||
      bareId.startsWith("gemini-2.5") ||
      bareId.startsWith("gemini-3") ||
      bareId.startsWith("gemini-4") ||
      bareId.includes("thinking") ||
      bareId.includes("qwq") ||
      bareId.startsWith("qwen3") ||
      bareId.startsWith("qwen4") ||
      bareId.startsWith("grok-3") ||
      bareId.startsWith("grok-4") ||
      bareId.startsWith("glm-4.5") ||
      bareId.startsWith("glm-4.6") ||
      bareId.startsWith("glm-4.7") ||
      bareId.startsWith("glm-5") ||
      bareId.startsWith("kimi-k2.5") ||
      bareId.startsWith("kimi-k2.6") ||
      bareId.startsWith("kimi-k2.7") ||
      bareId.startsWith("kimi-k3");

    if (bareId.includes("flash-lite") || bareId.includes("8b-instant") || (bareId.includes("nano") && !catalogEntry?.reasoning)) {
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

const PROVIDER_LOGO_FILES = Object.freeze({
  openai: "openai.png",
  anthropic: "anthropic.png",
  claude: "claude.png",
  antigravity: "antigravity.png",
  gemini: "gemini.png",
  "gemini-cli": "gemini-cli.png",
  google: "gemini.png",
  deepseek: "deepseek.png",
  xai: "xai.png",
  grok: "xai.png",
  qwen: "qwen.png",
  alibaba: "qwen.png",
  kimi: "kimi.png",
  "kimi-coding": "kimi-coding.png",
  glm: "glm.png",
  "glm-cn": "glm.png",
  groq: "groq.png",
  openrouter: "openrouter.png",
  mistral: "mistral.png",
  cohere: "cohere.png",
  nvidia: "nvidia.png",
  cerebras: "cerebras.png",
  sambanova: "sambanova.png",
  huggingface: "huggingface.png",
  perplexity: "perplexity.png",
  together: "together.png",
  fireworks: "fireworks.png",
  minimax: "minimax.png",
  "minimax-cn": "minimax.png",
  muse: "muse.png",
  "meta-muse": "muse.png",
  ollama: "ollama.png",
  "ollama-local": "ollama.png",
  azure: "azure.png",
  bedrock: "bedrock.png",
  vertex: "vertex.png",
  gitlab: "gitlab.png",
  vercel: "vercel-ai-gateway.png",
  "vercel-ai-gateway": "vercel-ai-gateway.png",
  siliconflow: "siliconflow.png",
  codex: "codex.png",
  venice: "venice.png",
  nous: "nous.png",
  xiaomi: "xiaomi-mimo.png",
  "xiaomi-mimo": "xiaomi-mimo.png",
  agentrouter: "agentrouter.png",
  cloudflare: "cloudflare-ai.png",
  "cloudflare-ai": "cloudflare-ai.png",
  chutes: "chutes.png",
  featherless: "featherless.png",
  novita: "novita.png",
  nebius: "nebius.png",
  hyperbolic: "hyperbolic.png",
  byteplus: "byteplus.png",
  baidu: "baidu.png",
  tencent: "tencent.png",
  reka: "reka.png",
  lmstudio: "local-device.png",
  vllm: "local-device.png",
  llamacpp: "local-device.png",
  "local-device": "local-device.png"
});

export function resolveProviderLogoFile(provider) {
  const keys = [
    String(provider?.preset || "").toLowerCase().trim(),
    String(provider?.slug || "").toLowerCase().trim(),
    String(provider?.name || "").toLowerCase().trim()
  ].filter(Boolean);

  for (const k of keys) {
    if (Object.hasOwn(PROVIDER_LOGO_FILES, k)) return PROVIDER_LOGO_FILES[k];
  }
  const combined = keys.join(" ");
  if (combined.includes("antigravity")) return "antigravity.png";
  if (combined.includes("anthropic") || combined.includes("claude")) return "anthropic.png";
  if (combined.includes("openai") || combined.includes("codex")) return "openai.png";
  if (combined.includes("gemini") || combined.includes("google")) return "gemini.png";
  if (combined.includes("xai") || combined.includes("grok")) return "xai.png";
  if (combined.includes("deepseek")) return "deepseek.png";
  if (combined.includes("qwen") || combined.includes("alibaba")) return "qwen.png";
  if (combined.includes("kimi") || combined.includes("moonshot")) return "kimi.png";
  if (combined.includes("glm") || combined.includes("zhipu")) return "glm.png";
  if (combined.includes("groq")) return "groq.png";
  if (combined.includes("openrouter")) return "openrouter.png";
  if (combined.includes("mistral")) return "mistral.png";
  if (combined.includes("minimax")) return "minimax.png";
  if (combined.includes("ollama")) return "ollama.png";
  if (combined.includes("agentrouter")) return "agentrouter.png";
  return "";
}

export function resolveModelLogoFile(modelId, provider) {
  const lower = String(modelId || "").toLowerCase().trim();
  if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus") || lower.includes("haiku") || lower.includes("fable")) {
    return "claude.png";
  }
  if (lower.includes("gemini") || lower.includes("gemma") || lower.includes("imagen")) {
    return "gemini.png";
  }
  if (lower.includes("codex")) return "codex.png";
  if (lower.includes("gpt-") || lower.includes("chatgpt") || /^o[134]($|-)/.test(lower) || lower.includes("openai/")) {
    return "openai.png";
  }
  if (lower.includes("grok") || lower.includes("x-ai/")) return "xai.png";
  if (lower.includes("deepseek")) return "deepseek.png";
  if (lower.includes("qwen") || lower.includes("qwq")) return "qwen.png";
  if (lower.includes("kimi") || lower.includes("moonshot")) return "kimi.png";
  if (lower.includes("glm") || lower.includes("zhipu")) return "glm.png";
  if (lower.includes("llama") || lower.includes("meta-llama") || lower.includes("meta/")) return "muse.png";
  if (lower.includes("mistral") || lower.includes("mixtral") || lower.includes("codestral") || lower.includes("pixtral")) {
    return "mistral.png";
  }
  if (lower.includes("minimax") || lower.includes("abab")) return "minimax.png";
  if (lower.includes("command-") || lower.includes("cohere")) return "cohere.png";
  if (lower.includes("sonar") || lower.includes("perplexity")) return "perplexity.png";
  if (lower.includes("mimo")) return "xiaomi-mimo.png";
  return resolveProviderLogoFile(provider);
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

    const rawModels = [];
    const seenModels = new Set();

    for (const modelId of provider.models || []) {
      if (!modelId || seenModels.has(modelId)) continue;
      if (storage.isModelDisabled?.(provider.slug, modelId)) continue;

      const fullId = `${provider.slug}/${modelId}`;
      if (routerKey && !isRouterKeyModelAllowed(routerKey, fullId)) continue;

      seenModels.add(modelId);
      rawModels.push(modelId);
    }

    // Group effort-suffixed sibling variants (e.g. gemini-4-neon-{low,medium,high,xhigh})
    // into one unified model family so Effort slider & Model ID stay 100% synchronized.
    const familyBuckets = new Map();
    for (const modelId of rawModels) {
      const { baseId, suffix } = splitEffortSuffix(modelId);
      const key = suffix ? baseId.toLowerCase() : modelId.toLowerCase();
      let bucket = familyBuckets.get(key);
      if (!bucket) {
        bucket = {
          baseId: suffix ? baseId : modelId,
          bareId: null,
          variants: new Map(),
          firstId: modelId
        };
        familyBuckets.set(key, bucket);
      }
      if (suffix) {
        bucket.variants.set(suffix, modelId);
      } else {
        bucket.bareId = modelId;
        bucket.baseId = modelId;
      }
    }

    const models = [];
    for (const bucket of familyBuckets.values()) {
      // Only collapse into a suffix-pinned family when >= 2 real sibling effort variants exist;
      // single suffixed models (e.g. gpt-oss-120b-medium, gemini-3.1-pro-high) keep full effort profile.
      const hasSuffixVariants = bucket.variants.size >= 2;

      if (hasSuffixVariants) {
        const availableLevels = EFFORT_ORDER.filter((lvl) => bucket.variants.has(lvl));
        const stops = buildStops(availableLevels);
        const maxStop = stops[stops.length - 1];
        const defaultEffort = availableLevels.includes("medium")
          ? "medium"
          : availableLevels.includes("high")
            ? "high"
            : availableLevels[0];

        const variantMap = {};
        for (const lvl of availableLevels) {
          const rawId = bucket.variants.get(lvl);
          variantMap[lvl] = {
            id: rawId,
            modelId: rawId,
            fullId: `${provider.slug}/${rawId}`
          };
        }

        const repId = bucket.bareId || bucket.variants.get(defaultEffort) || bucket.firstId;
        const cat = catById.get(bucket.baseId) || catById.get(repId) || null;
        const effort = {
          effortLevels: stops,
          defaultEffort,
          maxEffort: maxStop.id,
          maxLabel: maxStop.label,
          maxPower: stops.length
        };

        models.push({
          id: bucket.baseId,
          fullId: variantMap[defaultEffort]?.fullId || `${provider.slug}/${repId}`,
          resolvedModelId: variantMap[defaultEffort]?.modelId || repId,
          label: formatModelDisplayName(bucket.baseId),
          description: buildModelDescription(bucket.baseId, cat, provider),
          logoFile: resolveModelLogoFile(bucket.baseId, provider),
          kind: cat?.kind || "chat",
          vision: Boolean(cat?.vision),
          reasoning: Boolean(cat?.reasoning || effort.maxPower >= 4),
          contextWindow: cat?.contextWindow || 128000,
          variantMap,
          effort
        });
      } else {
        const modelId = bucket.bareId || bucket.firstId;
        const fullId = `${provider.slug}/${modelId}`;
        const cat = catById.get(modelId) || catById.get(bucket.baseId) || null;
        const effort = getModelEffortProfile(provider, modelId, cat);

        models.push({
          id: modelId,
          fullId,
          resolvedModelId: modelId,
          label: formatModelDisplayName(modelId),
          description: buildModelDescription(modelId, cat, provider),
          logoFile: resolveModelLogoFile(modelId, provider),
          kind: cat?.kind || "chat",
          vision: Boolean(cat?.vision),
          reasoning: Boolean(cat?.reasoning || effort.maxPower >= 4),
          contextWindow: cat?.contextWindow || 128000,
          effort
        });
      }
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
      logoFile: resolveProviderLogoFile(provider),
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
