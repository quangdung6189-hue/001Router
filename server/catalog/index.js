import fs from "node:fs";
import path from "node:path";

export const CATALOG_JSON_PATH = path.resolve(import.meta.dirname, "./modelCatalog.json");
const PROVIDERS_PUBLIC_DIR = path.resolve(
  import.meta.dirname,
  "../../web/public/providers"
);

let rawCatalogData = {
  generatedAt: new Date().toISOString(),
  sources: [],
  providers: {}
};

/** @type {Set<() => void>} */
const reloadListeners = new Set();

function loadCatalogFromDisk(catalogPath = CATALOG_JSON_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.providers) {
      rawCatalogData = parsed;
    }
  } catch {
    // Fallback if modelCatalog.json is missing or unreadable
  }
  return rawCatalogData;
}

loadCatalogFromDisk();

/**
 * Subscribe a listener to be invoked whenever `reloadCatalog()` refreshes catalog data.
 * @param {() => void} listener
 */
export function onCatalogReload(listener) {
  if (typeof listener === "function") {
    reloadListeners.add(listener);
  }
}

/**
 * Reload `modelCatalog.json` from disk and notify listeners (e.g., `refreshPresets`)
 * so `/api/catalog`, `/api/catalog/models`, and `/api/providers` reflect updates immediately.
 * @param {string} [catalogPath]
 */
export function reloadCatalog(catalogPath = CATALOG_JSON_PATH) {
  const data = loadCatalogFromDisk(catalogPath);
  for (const listener of reloadListeners) {
    try {
      listener();
    } catch {
      // Ignore individual listener errors during reload
    }
  }
  return data;
}

/**
 * Return the raw in-memory catalog object.
 */
export function getRawCatalogData() {
  return rawCatalogData;
}

/**
 * The 9 official service kinds supported by 001Router.
 */
export const CATALOG_KINDS = [
  {
    id: "chat",
    label: "Chat / LLM",
    icon: "message-square",
    endpoint: { method: "POST", path: "/v1/chat/completions" }
  },
  {
    id: "vision",
    label: "Vision / Multimodal",
    icon: "eye",
    endpoint: { method: "POST", path: "/v1/chat/completions" }
  },
  {
    id: "embedding",
    label: "Embeddings",
    icon: "layers",
    endpoint: { method: "POST", path: "/v1/embeddings" }
  },
  {
    id: "image",
    label: "Image Generation",
    icon: "image",
    endpoint: { method: "POST", path: "/v1/images/generations" }
  },
  {
    id: "tts",
    label: "Text-to-Speech (TTS)",
    icon: "volume-2",
    endpoint: { method: "POST", path: "/v1/audio/speech" }
  },
  {
    id: "stt",
    label: "Speech-to-Text (STT)",
    icon: "mic",
    endpoint: { method: "POST", path: "/v1/audio/transcriptions" }
  },
  {
    id: "video",
    label: "Video Generation",
    icon: "video",
    endpoint: { method: "POST", path: "/v1/images/generations" }
  },
  {
    id: "search",
    label: "Web Search",
    icon: "search",
    endpoint: { method: "POST", path: "/v1/search" }
  },
  {
    id: "fetch",
    label: "Web Fetch / Reader",
    icon: "globe",
    endpoint: { method: "POST", path: "/v1/web/fetch" }
  }
];

/**
 * Preset ID -> logo basename mapping from API.md Section 9.1.
 */
export const PRESET_LOGO_BASENAMES = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  groq: "groq",
  cerebras: "cerebras",
  openrouter: "openrouter",
  nvidia: "nvidia",
  sambanova: "sambanova",
  huggingface: "huggingface",
  mistral: "mistral",
  cloudflare: "cloudflare-ai",
  deepseek: "deepseek",
  xai: "xai",
  together: "together",
  fireworks: "fireworks",
  perplexity: "perplexity",
  cohere: "cohere",
  glm: "glm",
  kimi: "kimi",
  minimax: "minimax",
  alibaba: "qwen",
  siliconflow: "siliconflow",
  nebius: "nebius",
  hyperbolic: "hyperbolic",
  chutes: "chutes",
  venice: "venice",
  vercel: "vercel-ai-gateway",
  featherless: "featherless",
  ollama: "ollama",
  lmstudio: "local-device",
  vllm: "local-device",
  llamacpp: "local-device",
  azure: "azure",
  bedrock: "bedrock",
  vertex: "vertex",
  novita: "novita",
  reka: "reka",
  muse: "muse",
  byteplus: "byteplus",
  xiaomi: "xiaomi-mimo",
  baidu: "baidu",
  tencent: "tencent",
  nous: "nous",
  deepgram: "deepgram",
  assemblyai: "assemblyai",
  elevenlabs: "elevenlabs",
  tavily: "tavily",
  brave: "brave-search",
  serper: "serper",
  exa: "exa",
  firecrawl: "firecrawl",
  jina: "jina-ai",
  fal: "fal-ai",
  stability: "stability-ai",
  bfl: "black-forest-labs",
  recraft: "recraft",
  runway: "runwayml",
  voyage: "voyage-ai",
  searxng: "searxng",
  "google-pse": "google-pse",
  linkup: "linkup",
  searchapi: "searchapi",
  "opencode-zen": "opencode",
  "opencode-go": "opencode-go",
  "kilo-gateway": "kilo-gateway",
  kilocode: "kilocode",
  "api-airforce": "api-airforce",
  bazaarlink: "bazaarlink",
  poolside: "poolside",
  agnes: "agnes",
  runcrate: "runcrate",
  "glm-cn": "glm-cn",
  "minimax-cn": "minimax-cn",
  alicode: "alicode",
  "alicode-intl": "alicode-intl",
  "alitp-intl": "alitp-intl",
  "volcengine-ark": "volcengine-ark",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
  llm7: "llm7",
  synthetic: "synthetic",
  morph: "morph",
  blackbox: "blackbox",
  tokenharbor: "tokenharbor",
  tokenrouter: "tokenrouter",
  bluesminds: "bluesminds",
  dahl: "dahl",
  sensenova: "sensenova",
  "sensenova-intl": "sensenova-intl",
  gitlab: "gitlab",
  "vertex-partner": "vertex-partner",
  "bedrock-xai": "bedrock-xai",
  comfyui: "comfyui",
  sdwebui: "sdwebui",
  cartesia: "cartesia",
  "fish-audio": "fish-audio",
  inworld: "inworld",
  playht: "playht",
  youcom: "youcom",
  "custom-openai": "oai-cc",
  "custom-anthropic": "anthropic-m",
  custom: "local-device"
};

/**
 * Supplemental catalog entries for search, web-fetch, and audio service providers.
 */
const SUPPLEMENTAL_SERVICE_MODELS = {
  tavily: [
    { id: "tavily-search", name: "Tavily AI Search", kind: "search", free: true },
    { id: "tavily-extract", name: "Tavily Web Extract", kind: "fetch", free: true }
  ],
  brave: [
    { id: "brave-web-search", name: "Brave Web Search", kind: "search", free: true }
  ],
  serper: [
    { id: "serper-google-search", name: "Serper Google Search", kind: "search" }
  ],
  exa: [
    { id: "exa-search", name: "Exa Neural Search", kind: "search" },
    { id: "exa-contents", name: "Exa Web Contents", kind: "fetch" }
  ],
  firecrawl: [
    { id: "firecrawl-scrape", name: "Firecrawl Markdown Scraper", kind: "fetch" }
  ],
  jina: [
    { id: "jina-reader", name: "Jina Reader (r.jina.ai)", kind: "fetch", free: true }
  ],
  searxng: [
    { id: "searxng-search", name: "SearXNG Meta-Search", kind: "search", free: true }
  ],
  "google-pse": [
    { id: "google-pse-search", name: "Google Programmable Search", kind: "search", free: true }
  ],
  linkup: [
    { id: "linkup-search", name: "Linkup Web Search", kind: "search" }
  ],
  searchapi: [
    { id: "searchapi-google", name: "SearchAPI Google Search", kind: "search" }
  ],
  cartesia: [
    { id: "sonic-2", name: "Cartesia Sonic 2", kind: "tts" }
  ],
  "fish-audio": [
    { id: "speech-1.6", name: "Fish Speech 1.6", kind: "tts" }
  ],
  inworld: [
    { id: "inworld-tts-1", name: "Inworld TTS 1", kind: "tts" }
  ],
  playht: [
    { id: "Play3.0-mini", name: "PlayHT 3.0 Mini", kind: "tts" }
  ],
  youcom: [
    { id: "youcom-search", name: "You.com Web Search", kind: "search" }
  ],
  comfyui: [
    { id: "flux-dev", name: "FLUX Dev (ComfyUI)", kind: "image", free: true },
    { id: "sdxl", name: "SDXL (ComfyUI)", kind: "image", free: true }
  ],
  sdwebui: [
    { id: "stable-diffusion-v1-5", name: "Stable Diffusion v1.5", kind: "image", free: true },
    { id: "sdxl-base-1.0", name: "SDXL Base 1.0", kind: "image", free: true }
  ]
};

/**
 * Resolve and verify the logo basename and file extension against `web/public/providers`.
 * @param {string} presetId
 * @returns {{ logo: string, logoExt: "png" | "svg" }}
 */
export function getPresetLogo(presetId) {
  const candidate = PRESET_LOGO_BASENAMES[presetId] || presetId || "local-device";
  if (fs.existsSync(PROVIDERS_PUBLIC_DIR)) {
    for (const ext of ["png", "svg"]) {
      const fullPath = path.join(PROVIDERS_PUBLIC_DIR, `${candidate}.${ext}`);
      if (fs.existsSync(fullPath)) {
        return { logo: candidate, logoExt: /** @type {"png" | "svg"} */ (ext) };
      }
    }
    return { logo: "local-device", logoExt: "png" };
  }
  // Serverless environments (e.g. Vercel) serve web/public/providers via CDN
  // rather than bundling it into the API function filesystem.
  return { logo: candidate, logoExt: "png" };
}

/**
 * Return the ISO timestamp when modelCatalog.json was generated.
 * @returns {string}
 */
export function getCatalogGeneratedAt() {
  return rawCatalogData.generatedAt || "2026-11-22T00:00:00.000Z";
}

/**
 * Return the full modelCatalog array for a given preset.
 * @param {string} presetId
 * @param {string[]} [fallbackChatModels]
 * @returns {Array<Record<string, any>>}
 */
export function getPresetCatalogModels(presetId, fallbackChatModels = []) {
  const fromJson = rawCatalogData.providers?.[presetId]?.models;
  const baseModels = Array.isArray(fromJson) ? fromJson.map((m) => ({ ...m })) : [];
  const extraModels = SUPPLEMENTAL_SERVICE_MODELS[presetId] || [];

  const seenIds = new Set(baseModels.map((m) => m.id));
  for (const extra of extraModels) {
    if (!seenIds.has(extra.id)) {
      seenIds.add(extra.id);
      baseModels.push({ ...extra });
    }
  }

  if (baseModels.length === 0 && Array.isArray(fallbackChatModels) && fallbackChatModels.length > 0) {
    return fallbackChatModels.map((id) => ({
      id,
      name: id,
      kind: "chat"
    }));
  }

  return baseModels;
}

/**
 * Return only the chat model IDs from the catalog for a preset.
 * @param {string} presetId
 * @param {string[]} [fallbackChatModels]
 * @returns {string[]}
 */
export function getCatalogChatModelIds(presetId, fallbackChatModels = []) {
  const catalog = getPresetCatalogModels(presetId, fallbackChatModels);
  const chatIds = catalog.filter((m) => m.kind === "chat").map((m) => m.id);
  if (chatIds.length > 0) {
    return chatIds;
  }
  return Array.isArray(fallbackChatModels) ? [...fallbackChatModels] : [];
}

/**
 * Derive all supported service kinds for a preset from its modelCatalog and explicit serviceKinds.
 * @param {Array<Record<string, any>>} modelCatalog
 * @param {string[]} [explicitKinds]
 * @param {string} [category]
 * @returns {string[]}
 */
export function deriveServiceKinds(modelCatalog, explicitKinds = [], category = "") {
  const kinds = new Set();
  for (const k of explicitKinds) {
    if (k) kinds.add(k);
  }
  for (const m of modelCatalog || []) {
    if (m?.kind) {
      kinds.add(m.kind);
    }
    if (m?.vision === true) {
      kinds.add("vision");
    }
  }
  if (kinds.size === 0 && category !== "service") {
    kinds.add("chat");
  }
  return [...kinds];
}

/**
 * Enrich a raw preset definition with catalog models, logo, tier, and serviceKinds.
 * @param {Record<string, any>} rawPreset
 */
export function enrichPresetWithCatalog(rawPreset) {
  const presetId = rawPreset.preset;
  const { logo, logoExt } =
    rawPreset.logo && rawPreset.logoExt
      ? { logo: rawPreset.logo, logoExt: rawPreset.logoExt }
      : getPresetLogo(presetId);

  const tier =
    rawPreset.tier ||
    (rawPreset.category === "free-tier"
      ? "free"
      : rawPreset.category === "local"
        ? "local"
        : "premium");

  const modelCatalog = getPresetCatalogModels(presetId, rawPreset.models || []);
  const chatCatalogIds = modelCatalog.filter((m) => m.kind === "chat").map((m) => m.id);
  const models =
    chatCatalogIds.length > 0
      ? chatCatalogIds
      : Array.isArray(rawPreset.models)
        ? [...rawPreset.models]
        : [];

  const serviceKinds = deriveServiceKinds(
    modelCatalog,
    rawPreset.serviceKinds || [],
    rawPreset.category
  );

  return {
    id: presetId,
    ...rawPreset,
    logo,
    logoExt,
    tier,
    serviceKinds,
    modelCatalog,
    catalogUpdatedAt: getCatalogGeneratedAt(),
    models,
    defaultModels: [...models],
    requiresApiKey: !rawPreset.keyOptional
  };
}

/**
 * Build the payload for `GET /api/catalog`.
 * @param {Array<Record<string, any>>} presets
 */
export function getCatalogResponse(presets) {
  const providers = presets
    .filter((p) => p.category !== "custom")
    .map((p) => ({
      preset: p.preset,
      name: p.name,
      category: p.category,
      tier: p.tier,
      badge: p.badge,
      color: p.color,
      monogram: p.monogram,
      logo: p.logo,
      logoExt: p.logoExt,
      baseUrl: p.baseUrl,
      formatType: p.formatType,
      authStyle: p.authStyle || (p.formatType === "anthropic" ? "x-api-key" : "bearer"),
      docsUrl: p.docsUrl,
      keyOptional: Boolean(p.keyOptional),
      serviceKinds: p.serviceKinds || [],
      models: p.modelCatalog || []
    }));

  return {
    generatedAt: getCatalogGeneratedAt(),
    sources: rawCatalogData.sources || [],
    kinds: CATALOG_KINDS,
    providers
  };
}

/**
 * Query flat model entries across all presets for `GET /api/catalog/models?kind=&q=&sort=&days=`.
 * Defaults to sorting by `released` DESC (newest first).
 * @param {Array<Record<string, any>>} presets
 * @param {{ kind?: string, q?: string, sort?: string, days?: string | number }} [filters]
 */
export function queryCatalogModels(presets, filters = {}) {
  const kindFilter =
    typeof filters.kind === "string" ? filters.kind.trim().toLowerCase() : "";
  const qFilter =
    typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  const presetFilter =
    typeof filters.preset === "string" ? filters.preset.trim().toLowerCase() : "";
  const tierFilter =
    typeof filters.tier === "string" ? filters.tier.trim().toLowerCase() : "";
  const sortMode =
    typeof filters.sort === "string" && filters.sort.trim()
      ? filters.sort.trim().toLowerCase()
      : "newest";

  const rawDays =
    filters.days !== undefined && filters.days !== "" && filters.days !== null
      ? Number(filters.days)
      : NaN;
  const daysCutoffMs =
    Number.isFinite(rawDays) && rawDays > 0
      ? Date.now() - rawDays * 86_400_000
      : null;

  const models = [];
  for (const preset of presets) {
    if (preset.category === "custom") continue;
    if (presetFilter && String(preset.preset || "").toLowerCase() !== presetFilter) continue;
    if (tierFilter && String(preset.tier || "").toLowerCase() !== tierFilter) continue;
    for (const entry of preset.modelCatalog || []) {
      if (kindFilter && kindFilter !== "all") {
        if (kindFilter === "vision") {
          if (entry.kind !== "vision" && entry.vision !== true) continue;
        } else if (entry.kind !== kindFilter) {
          continue;
        }
      }

      if (daysCutoffMs !== null) {
        if (!entry.released) continue;
        const parsedMs = Date.parse(entry.released);
        if (!Number.isFinite(parsedMs) || parsedMs < daysCutoffMs) continue;
      }

      const fullId = `${preset.preset}/${entry.id}`;
      if (qFilter) {
        const hay = `${fullId} ${entry.name || ""} ${preset.name || ""}`.toLowerCase();
        if (!hay.includes(qFilter)) continue;
      }

      models.push({
        preset: preset.preset,
        providerName: preset.name,
        tier: preset.tier,
        logo: preset.logo,
        logoExt: preset.logoExt,
        id: entry.id,
        fullId,
        name: entry.name || entry.id,
        kind: entry.kind || "chat",
        contextWindow: entry.contextWindow ?? null,
        maxOutput: entry.maxOutput ?? null,
        free: Boolean(entry.free || preset.tier === "free"),
        released: entry.released ?? null,
        inputPrice: entry.inputPrice ?? null,
        outputPrice: entry.outputPrice ?? null,
        vision: Boolean(entry.vision),
        reasoning: Boolean(entry.reasoning),
        tools: Boolean(entry.tools)
      });
    }
  }

  models.sort((a, b) => {
    if (sortMode === "name") {
      return (a.name || "").localeCompare(b.name || "", undefined, {
        sensitivity: "base"
      });
    }
    if (sortMode === "context") {
      const ca = typeof a.contextWindow === "number" ? a.contextWindow : -1;
      const cb = typeof b.contextWindow === "number" ? b.contextWindow : -1;
      if (cb !== ca) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    }
    if (sortMode === "price") {
      const pa =
        a.free
          ? 0
          : typeof a.inputPrice === "number"
            ? a.inputPrice
            : Number.POSITIVE_INFINITY;
      const pb =
        b.free
          ? 0
          : typeof b.inputPrice === "number"
            ? b.inputPrice
            : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return (a.name || "").localeCompare(b.name || "");
    }
    // Default: "newest" -> released DESC (nulls last), tie-break by name ASC
    const ra = a.released || "";
    const rb = b.released || "";
    if (ra !== rb) {
      if (!ra) return 1;
      if (!rb) return -1;
      return rb.localeCompare(ra);
    }
    return (a.name || "").localeCompare(b.name || "");
  });

  return { models };
}
