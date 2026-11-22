import fs from "node:fs/promises";
import path from "node:path";
import {
  CATALOG_JSON_PATH,
  getCatalogGeneratedAt,
  getRawCatalogData,
  reloadCatalog
} from "./index.js";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const OPENROUTER_MAX_MODELS = 40;
const DEFAULT_STALE_AFTER_MS = 86_400_000; // 24 hours
const DEFAULT_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

/**
 * Mapping from OpenRouter vendor prefix -> 001Router official preset ID.
 */
export const VENDOR_PREFIX_MAP = {
  "meta/": "muse",
  "xiaomi/": "xiaomi",
  "baidu/": "baidu",
  "tencent/": "tencent",
  "bytedance/": "byteplus",
  "bytedance-seed/": "byteplus",
  "nousresearch/": "nous",
  "openai/": "openai",
  "anthropic/": "anthropic",
  "google/": "gemini",
  "x-ai/": "xai",
  "deepseek/": "deepseek",
  "mistralai/": "mistral",
  "cohere/": "cohere",
  "qwen/": "alibaba",
  "moonshotai/": "kimi",
  "z-ai/": "glm",
  "minimax/": "minimax",
  "perplexity/": "perplexity",
  "nvidia/": "nvidia",
  "rekaai/": "reka"
};

/**
 * OpenRouter-only routing suffixes that are not valid model IDs on direct vendor APIs.
 */
const OPENROUTER_ONLY_SUFFIXES = [
  ":free",
  ":extended",
  ":exacto",
  ":nitro",
  ":online",
  ":floor",
  ":thinking",
  ":beta"
];

const syncState = {
  isSyncing: false,
  lastError: null,
  lastResult: null,
  inFlightPromise: null
};

/**
 * Atomic file rename with tiny retry on transient Windows file locks.
 * @param {string} src
 * @param {string} dest
 */
async function atomicRename(src, dest) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const retryable =
        err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES");
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 15 * attempt));
    }
  }
}

/**
 * Round a per-token USD price string/number into USD per 1M tokens.
 * @param {unknown} perTokenRaw
 * @returns {number | undefined}
 */
function toPerMillionPrice(perTokenRaw) {
  if (perTokenRaw === undefined || perTokenRaw === null || perTokenRaw === "") {
    return undefined;
  }
  const n = Number(perTokenRaw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const perM = n * 1_000_000;
  return Number(perM.toFixed(4));
}

/**
 * Convert OpenRouter `created` unix timestamp (seconds) to YYYY-MM-DD.
 * @param {unknown} created
 * @returns {string | undefined}
 */
function toReleasedDate(created) {
  const sec = Number(created);
  if (!Number.isFinite(sec) || sec <= 0) return undefined;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Strip leading `"Vendor: "` prefix from OpenRouter display names.
 * @param {string} rawName
 * @param {string} fallbackId
 * @returns {string}
 */
function cleanModelName(rawName, fallbackId) {
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  if (!trimmed) return fallbackId;
  const colonIdx = trimmed.indexOf(": ");
  if (colonIdx > 0 && colonIdx <= 32) {
    const stripped = trimmed.slice(colonIdx + 2).trim();
    if (stripped) return stripped;
  }
  return trimmed;
}

/**
 * Normalize a single OpenRouter model object into 001Router catalog entry format.
 * @param {Record<string, any>} raw
 * @param {string} targetId
 */
function normalizeOpenRouterModel(raw, targetId) {
  const contextWindow = Number(
    raw.context_length ?? raw.top_provider?.context_length
  );
  const maxOutput = Number(raw.top_provider?.max_completion_tokens);
  const released = toReleasedDate(raw.created);
  const inputPrice = toPerMillionPrice(raw.pricing?.prompt);
  const outputPrice = toPerMillionPrice(raw.pricing?.completion);

  const inputModalities = Array.isArray(raw.architecture?.input_modalities)
    ? raw.architecture.input_modalities
    : [];
  const modalityStr = String(raw.architecture?.modality || "").toLowerCase();
  const vision =
    inputModalities.includes("image") || modalityStr.includes("image");

  const supportedParams = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters
    : [];
  const reasoning =
    supportedParams.includes("reasoning") ||
    supportedParams.includes("include_reasoning");
  const tools = supportedParams.includes("tools");

  const free =
    targetId.endsWith(":free") ||
    (inputPrice === 0 && outputPrice === 0);

  /** @type {Record<string, any>} */
  const entry = {
    id: targetId,
    name: cleanModelName(raw.name, targetId),
    kind: "chat"
  };

  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    entry.contextWindow = Math.floor(contextWindow);
  }
  if (Number.isFinite(maxOutput) && maxOutput > 0) {
    entry.maxOutput = Math.floor(maxOutput);
  }
  if (released) {
    entry.released = released;
  }
  if (inputPrice !== undefined) {
    entry.inputPrice = inputPrice;
  }
  if (outputPrice !== undefined) {
    entry.outputPrice = outputPrice;
  }
  if (vision) entry.vision = true;
  if (reasoning) entry.reasoning = true;
  if (tools) entry.tools = true;
  if (free) entry.free = true;

  return entry;
}

/**
 * Compare two catalog models: chat first, then `released` DESC (nulls last), then `id` ASC.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 */
function compareProviderModels(a, b) {
  const aChat = (a.kind || "chat") === "chat" ? 0 : 1;
  const bChat = (b.kind || "chat") === "chat" ? 0 : 1;
  if (aChat !== bChat) return aChat - bChat;

  const ra = typeof a.released === "string" ? a.released : "";
  const rb = typeof b.released === "string" ? b.released : "";
  if (ra !== rb) {
    if (!ra) return 1;
    if (!rb) return -1;
    return rb.localeCompare(ra);
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
}

/**
 * Merge a live chat model entry onto an existing entry while preserving curated fields.
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} incoming
 */
function mergeModelEntry(existing, incoming) {
  const merged = { ...existing, ...incoming };
  // Preserve curated kind if existing was non-chat
  if (existing.kind && existing.kind !== "chat") {
    merged.kind = existing.kind;
  }
  // Keep existing released date if incoming lacks one
  if (!incoming.released && existing.released) {
    merged.released = existing.released;
  }
  // Keep existing contextWindow / maxOutput if incoming lacks them
  if (!incoming.contextWindow && existing.contextWindow) {
    merged.contextWindow = existing.contextWindow;
  }
  if (!incoming.maxOutput && existing.maxOutput) {
    merged.maxOutput = existing.maxOutput;
  }
  return merged;
}

/**
 * Fetch live models from OpenRouter public API, merge cleanly into `modelCatalog.json`,
 * write atomically, and trigger live catalog + presets reload.
 * @param {{ fetchImpl?: typeof globalThis.fetch, catalogPath?: string, timeoutMs?: number, reload?: boolean }} [options]
 */
export async function syncCatalogFromLiveSources(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const catalogPath = options.catalogPath
    ? path.resolve(options.catalogPath)
    : CATALOG_JSON_PATH;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_FETCH_TIMEOUT_MS;
  const isDefaultCatalog = path.resolve(catalogPath) === path.resolve(CATALOG_JSON_PATH);
  const shouldReload = options.reload !== undefined ? Boolean(options.reload) : isDefaultCatalog;

  // Deduplicate concurrent syncs targeting the default catalog
  if (isDefaultCatalog && syncState.inFlightPromise) {
    return syncState.inFlightPromise;
  }

  const run = async () => {
    if (isDefaultCatalog) {
      syncState.isSyncing = true;
      syncState.lastError = null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(OPENROUTER_MODELS_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res || !res.ok) {
        const status = res?.status ?? 0;
        throw new Error(`OpenRouter catalog fetch failed with HTTP ${status}`);
      }

      const payload = await res.json();
      const rawModels = Array.isArray(payload?.data) ? payload.data : [];

      // Load existing catalog from disk (if present)
      let existingCatalog = {
        generatedAt: new Date().toISOString(),
        sources: [],
        providers: {}
      };
      try {
        const existingRaw = await fs.readFile(catalogPath, "utf8");
        const parsed = JSON.parse(existingRaw);
        if (parsed && typeof parsed === "object" && parsed.providers) {
          existingCatalog = parsed;
        }
      } catch {
        // Start fresh if file does not exist yet
      }

      /** @type {Map<string, Map<string, Record<string, any>>>} */
      const liveByPreset = new Map();
      /** @type {Array<Record<string, any>>} */
      const openRouterCandidates = [];

      for (const raw of rawModels) {
        if (!raw || typeof raw.id !== "string") continue;
        const fullId = raw.id.trim();
        if (!fullId || fullId.includes(":batch")) continue;

        // Track candidate for `openrouter` preset (skip meta-routers like openrouter/auto)
        if (!fullId.startsWith("openrouter/")) {
          openRouterCandidates.push(normalizeOpenRouterModel(raw, fullId));
        }

        // Match vendor prefix for direct official API-key presets
        const slashIdx = fullId.indexOf("/");
        if (slashIdx <= 0) continue;
        const prefix = fullId.slice(0, slashIdx + 1).toLowerCase();
        const presetId = VENDOR_PREFIX_MAP[prefix];
        if (!presetId) continue;

        // Skip OpenRouter-only routing suffixes on direct vendor presets
        if (OPENROUTER_ONLY_SUFFIXES.some((sfx) => fullId.toLowerCase().endsWith(sfx))) {
          continue;
        }

        const directModelId = fullId.slice(slashIdx + 1);
        if (!directModelId) continue;

        const entry = normalizeOpenRouterModel(raw, directModelId);
        if (!liveByPreset.has(presetId)) {
          liveByPreset.set(presetId, new Map());
        }
        liveByPreset.get(presetId).set(directModelId, entry);
      }

      // Build top 40 newest + free models for `openrouter`
      openRouterCandidates.sort(compareProviderModels);
      const openRouterSelected = new Map();
      const freeCandidates = openRouterCandidates.filter((m) => m.free);
      for (const m of freeCandidates.slice(0, 15)) {
        openRouterSelected.set(m.id, m);
      }
      for (const m of openRouterCandidates) {
        if (openRouterSelected.size >= OPENROUTER_MAX_MODELS) break;
        if (!openRouterSelected.has(m.id)) {
          openRouterSelected.set(m.id, m);
        }
      }
      if (openRouterSelected.size > 0) {
        liveByPreset.set("openrouter", openRouterSelected);
      }

      // Merge into existing catalog providers
      const nextProviders = {};
      const existingProviders = existingCatalog.providers || {};

      // Copy existing providers first
      for (const [presetId, provData] of Object.entries(existingProviders)) {
        const list = Array.isArray(provData?.models)
          ? provData.models.map((m) => ({ ...m }))
          : [];
        nextProviders[presetId] = { models: list };
      }

      let addedCount = 0;
      const newlyAddedModels = [];

      for (const [presetId, liveMap] of liveByPreset.entries()) {
        if (!nextProviders[presetId]) {
          nextProviders[presetId] = { models: [] };
        }
        const existingList = nextProviders[presetId].models;
        const byId = new Map();
        for (const item of existingList) {
          if (item && item.id) {
            byId.set(item.id, item);
          }
        }

        if (presetId === "openrouter") {
          // Preserve non-chat curated entries, refresh top 40 live models
          const nonChat = existingList.filter((m) => m && m.kind && m.kind !== "chat");
          const prevChatIds = new Set(
            existingList.filter((m) => !m.kind || m.kind === "chat").map((m) => m.id)
          );
          const mergedChat = [];
          for (const [id, entry] of liveMap.entries()) {
            const prev = byId.get(id);
            if (prev) {
              mergedChat.push(mergeModelEntry(prev, entry));
            } else {
              mergedChat.push(entry);
              if (!prevChatIds.has(id)) {
                addedCount += 1;
                newlyAddedModels.push({
                  fullId: `openrouter/${id}`,
                  preset: "openrouter",
                  id,
                  name: entry.name,
                  released: entry.released || null
                });
              }
            }
          }
          nextProviders[presetId] = {
            models: [...mergedChat, ...nonChat].sort(compareProviderModels)
          };
          continue;
        }

        for (const [id, entry] of liveMap.entries()) {
          const prev = byId.get(id);
          if (prev) {
            byId.set(id, mergeModelEntry(prev, entry));
          } else {
            byId.set(id, entry);
            addedCount += 1;
            newlyAddedModels.push({
              fullId: `${presetId}/${id}`,
              preset: presetId,
              id,
              name: entry.name,
              released: entry.released || null
            });
          }
        }

        nextProviders[presetId] = {
          models: [...byId.values()].sort(compareProviderModels)
        };
      }

      // Sort all remaining providers cleanly too
      for (const presetId of Object.keys(nextProviders)) {
        if (!liveByPreset.has(presetId)) {
          nextProviders[presetId].models.sort(compareProviderModels);
        }
      }

      const generatedAt = new Date().toISOString();
      const todayDate = generatedAt.slice(0, 10);
      const nextCatalog = {
        generatedAt,
        sources: [
          `https://openrouter.ai/api/v1/models (live, fetched ${todayDate})`,
          "Vendor docs/known public model ids (best-effort, not live-verified) for hosting, local and service providers"
        ],
        providers: nextProviders
      };

      // Atomic write (tmp + rename)
      await fs.mkdir(path.dirname(catalogPath), { recursive: true });
      const tmpPath = `${catalogPath}.${process.pid}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 8)}.tmp`;
      const jsonStr = JSON.stringify(nextCatalog, null, 1);
      try {
        await fs.writeFile(tmpPath, jsonStr, "utf8");
        await atomicRename(tmpPath, catalogPath);
      } catch (writeErr) {
        try {
          await fs.unlink(tmpPath);
        } catch {
          // ignore cleanup failure
        }
        throw writeErr;
      }

      if (shouldReload) {
        reloadCatalog(catalogPath);
      }

      // Compute summary metrics
      const providerKeys = Object.keys(nextProviders);
      let totalModels = 0;
      const allChatWithRelease = [];
      for (const [presetId, prov] of Object.entries(nextProviders)) {
        const models = Array.isArray(prov?.models) ? prov.models : [];
        totalModels += models.length;
        for (const m of models) {
          if ((!m.kind || m.kind === "chat") && m.released) {
            allChatWithRelease.push({
              fullId: `${presetId}/${m.id}`,
              preset: presetId,
              id: m.id,
              name: m.name || m.id,
              released: m.released
            });
          }
        }
      }
      allChatWithRelease.sort((a, b) => {
        if (b.released !== a.released) return b.released.localeCompare(a.released);
        return a.fullId.localeCompare(b.fullId);
      });

      const result = {
        ok: true,
        generatedAt,
        totalProviders: providerKeys.length,
        totalModels,
        addedCount,
        newestModels: allChatWithRelease.slice(0, 10)
      };

      if (isDefaultCatalog) {
        syncState.lastResult = result;
        syncState.lastError = null;
      }

      return result;
    } catch (err) {
      clearTimeout(timer);
      const message = err?.message || "Live catalog sync failed";
      if (isDefaultCatalog) {
        syncState.lastError = message;
      }
      throw err;
    } finally {
      if (isDefaultCatalog) {
        syncState.isSyncing = false;
        syncState.inFlightPromise = null;
      }
    }
  };

  if (isDefaultCatalog) {
    syncState.inFlightPromise = run();
    return syncState.inFlightPromise;
  }
  return run();
}

/**
 * Return current catalog sync status for `GET /api/catalog/sync-status`.
 * @param {import("../storage.js").Storage | null} [storage]
 */
export function getCatalogSyncStatus(storage = null) {
  const lastSyncedAt = getCatalogGeneratedAt();
  const lastSyncedMs = Date.parse(lastSyncedAt);
  const autoSyncEnabled = storage
    ? storage.getSettings().catalogAutoSync !== false
    : true;

  const raw = getRawCatalogData();
  const providersObj = raw?.providers || {};
  const totalProviders = Object.keys(providersObj).length;
  let totalModels = 0;
  for (const prov of Object.values(providersObj)) {
    totalModels += Array.isArray(prov?.models) ? prov.models.length : 0;
  }

  return {
    lastSyncedAt,
    isSyncing: syncState.isSyncing,
    autoSyncEnabled,
    lastError: syncState.lastError,
    lastResult: syncState.lastResult,
    nextScheduledSyncAt:
      autoSyncEnabled && Number.isFinite(lastSyncedMs)
        ? new Date(lastSyncedMs + DEFAULT_STALE_AFTER_MS).toISOString()
        : null,
    totalProviders,
    totalModels
  };
}

/**
 * Start a non-blocking daily background scheduler that syncs the model catalog
 * when `catalogAutoSync !== false`, `NODE_ENV !== "test"`, and the catalog is older than 24h.
 * Timers are `.unref()`'d so they never block graceful shutdown or tests.
 * @param {import("../storage.js").Storage} storage
 * @param {{ intervalMs?: number, staleAfterMs?: number, initialDelayMs?: number, fetchImpl?: typeof globalThis.fetch }} [options]
 */
export function startDailyCatalogScheduler(storage, options = {}) {
  const intervalMs = Number(options.intervalMs) || DEFAULT_CHECK_INTERVAL_MS;
  const staleAfterMs = Number(options.staleAfterMs) || DEFAULT_STALE_AFTER_MS;
  const initialDelayMs = Number(options.initialDelayMs) || 5_000;

  if (process.env.NODE_ENV === "test") {
    return { stop() {} };
  }

  const checkAndSync = async () => {
    try {
      if (process.env.NODE_ENV === "test") return;
      if (storage && storage.getSettings().catalogAutoSync === false) return;
      if (syncState.isSyncing) return;

      const generatedAt = getCatalogGeneratedAt();
      const ageMs = Date.now() - Date.parse(generatedAt);
      if (Number.isFinite(ageMs) && ageMs < staleAfterMs) {
        return;
      }

      const res = await syncCatalogFromLiveSources({
        fetchImpl: options.fetchImpl
      });
      console.log(
        `[Catalog Auto-Sync] Synced ${res.totalModels} models across ${res.totalProviders} providers (+${res.addedCount} new)`
      );
    } catch (err) {
      console.warn(
        `[Catalog Auto-Sync] Skipped/failed: ${err?.message || "unknown error"}`
      );
    }
  };

  const initialTimer = setTimeout(checkAndSync, initialDelayMs);
  if (typeof initialTimer.unref === "function") {
    initialTimer.unref();
  }

  const intervalTimer = setInterval(checkAndSync, intervalMs);
  if (typeof intervalTimer.unref === "function") {
    intervalTimer.unref();
  }

  return {
    stop() {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    }
  };
}
