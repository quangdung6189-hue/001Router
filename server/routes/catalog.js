import express from "express";
import { nanoid } from "nanoid";
import { createDashboardAuthMiddleware } from "../auth.js";
import { PRESETS, getPreset, isKeyOptionalProvider } from "../presets.js";
import { getCatalogResponse, queryCatalogModels } from "../catalog/index.js";
import {
  getCatalogSyncStatus,
  syncCatalogFromLiveSources
} from "../catalog/updater.js";
import {
  clearProxyDispatcherCache,
  getPlainProxyUrl,
  getProxyPoolById,
  getProxyPools,
  maskProxyUrl,
  parseProxyUrl,
  testProxyPoolConnection,
  toPublicProxyPool
} from "../proxy.js";

export const COMBO_TEMPLATES = [
  {
    id: "3-tier",
    name: "3-Tier Smart Cascade (Premium → Cheap → Free)",
    description:
      "Routes to premium frontier models first, falls back to low-cost workhorses, then free-tier APIs",
    tiers: [
      {
        tier: "premium",
        label: "Tier 1: Premium Frontier",
        candidates: [
          "anthropic/claude-fable-5-2",
          "openai/gpt-6.2-astra-pro",
          "openai/gpt-6.2-sol",
          "anthropic/claude-sonnet-5-5",
          "xai/grok-4.7",
          "openai/gpt-4o",
          "anthropic/claude-sonnet-4-20250514"
        ]
      },
      {
        tier: "cheap",
        label: "Tier 2: Low-Cost Workhorse",
        candidates: [
          "deepseek/deepseek-v4-pro",
          "deepseek/deepseek-chat",
          "alibaba/qwen4-max",
          "glm/glm-5.3-prime",
          "kimi/kimi-k3.1-pro",
          "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
          "fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct"
        ]
      },
      {
        tier: "free",
        label: "Tier 3: Free Forever Safety Net",
        candidates: [
          "gemini/gemini-4-neon",
          "gemini/gemini-2.5-flash",
          "groq/llama-3.3-70b-versatile",
          "cerebras/gpt-oss-120b",
          "cerebras/llama-3.3-70b",
          "openrouter/deepseek/deepseek-r1:free"
        ]
      }
    ]
  },
  {
    id: "free-only",
    name: "Free-Tier Forever Rotation",
    description:
      "Zero-cost fallback chain across all connected free-tier developer APIs",
    tiers: [
      {
        tier: "free",
        label: "Free Developer APIs",
        candidates: [
          "gemini/gemini-4-neon",
          "gemini/gemini-2.5-flash",
          "groq/llama-3.3-70b-versatile",
          "cerebras/gpt-oss-120b",
          "cerebras/llama-3.3-70b",
          "sambanova/Meta-Llama-3.3-70B-Instruct",
          "nvidia/nemotron-3.5-super-vl",
          "mistral/mistral-large-4-0",
          "openrouter/deepseek/deepseek-r1:free"
        ]
      }
    ]
  },
  {
    id: "fast-coding",
    name: "Fast Coding & Agent Loop",
    description:
      "High-throughput coding models ordered from top coding agents to ultra-fast inference",
    tiers: [
      {
        tier: "premium",
        label: "Frontier Coding",
        candidates: [
          "anthropic/claude-sonnet-5-5",
          "openai/gpt-6.2-sol",
          "anthropic/claude-sonnet-4-20250514",
          "openai/gpt-4o"
        ]
      },
      {
        tier: "cheap",
        label: "Coding Specialists",
        candidates: [
          "deepseek/deepseek-v4-pro",
          "deepseek/deepseek-chat",
          "kimi/kimi-k2.7-code",
          "alibaba/qwen3-coder-480b-a35b-instruct",
          "glm/glm-5.3-prime"
        ]
      },
      {
        tier: "free",
        label: "Ultra-Fast Free Inference",
        candidates: [
          "cerebras/gpt-oss-120b",
          "groq/llama-3.3-70b-versatile",
          "gemini/gemini-4-hydrogen",
          "gemini/gemini-2.5-flash"
        ]
      }
    ]
  }
];

/**
 * Check if a provider is enabled and has at least one enabled key (or is key-optional).
 * @param {any} provider
 * @returns {boolean}
 */
function isProviderReadyForCombo(provider) {
  if (!provider || provider.enabled === false) return false;
  const presetDef = getPreset(provider.preset);
  if (presetDef?.category === "service") return false;
  const hasEnabledKey = (provider.apiKeys || []).some(
    (k) => k.enabled !== false && Boolean(k.key || k.serviceAccountJson || k.oauthCredentials)
  );
  return hasEnabledKey || isKeyOptionalProvider(provider);
}

/**
 * Determine the effective tier (`"premium" | "cheap" | "free" | "local"`) of a configured provider.
 * @param {any} provider
 * @returns {string}
 */
function getProviderEffectiveTier(provider) {
  if (provider?.tier) return provider.tier;
  const presetDef = getPreset(provider?.preset);
  if (presetDef?.tier) return presetDef.tier;
  if (presetDef?.category === "free-tier") return "free";
  if (presetDef?.category === "local") return "local";
  return "premium";
}

/**
 * Create the Express router mounted at `/api` for Catalog, Combo Templates, and Proxy Pools.
 * @param {import("../storage.js").Storage} storage
 */
export function createCatalogRouter(storage) {
  const router = express.Router();

  router.use(createDashboardAuthMiddleware(storage));

  // --- Model Catalog ---

  router.get("/catalog", (_req, res) => {
    return res.json(getCatalogResponse(PRESETS));
  });

  router.get("/catalog/models", (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "";
    const days = typeof req.query.days === "string" ? req.query.days : "";
    return res.json(queryCatalogModels(PRESETS, { kind, q, sort, days }));
  });

  router.get("/catalog/sync-status", (_req, res) => {
    return res.json(getCatalogSyncStatus(storage));
  });

  router.post("/catalog/sync", async (_req, res) => {
    try {
      const result = await syncCatalogFromLiveSources();
      return res.json(result);
    } catch (err) {
      return res.status(502).json({
        ok: false,
        error: err?.message || "Failed to sync live model catalog"
      });
    }
  });

  // --- Combo Tier Templates ---

  router.get("/combos/templates", (_req, res) => {
    return res.json({ templates: COMBO_TEMPLATES });
  });

  router.post("/combos/templates/:id/generate", async (req, res) => {
    const templateId = req.params.id;
    const template = COMBO_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      return res.status(404).json({ error: `Combo template '${templateId}' not found` });
    }

    const readyProviders = storage.getProviders().filter(isProviderReadyForCombo);
    const targets = [];
    const seenTargets = new Set();

    const addTarget = (targetStr) => {
      if (targetStr && !seenTargets.has(targetStr)) {
        seenTargets.add(targetStr);
        targets.push(targetStr);
      }
    };

    for (const tierBlock of template.tiers) {
      const usedProviderIdsInTier = new Set();

      // 1. Match explicit template candidates against ready providers
      for (const candidate of tierBlock.candidates) {
        const slashIdx = candidate.indexOf("/");
        if (slashIdx <= 0) continue;
        const candPreset = candidate.slice(0, slashIdx);
        const candModel = candidate.slice(slashIdx + 1);

        const matchingProviders = readyProviders.filter(
          (p) => p.preset === candPreset || p.slug === candPreset
        );
        for (const prov of matchingProviders) {
          const provModels = Array.isArray(prov.models) ? prov.models : [];
          if (provModels.includes(candModel)) {
            addTarget(`${prov.slug}/${candModel}`);
            usedProviderIdsInTier.add(prov.id);
          } else if (provModels.length > 0 && !usedProviderIdsInTier.has(prov.id)) {
            addTarget(`${prov.slug}/${provModels[0]}`);
            usedProviderIdsInTier.add(prov.id);
          }
        }
      }

      // 2. Also include any other ready providers belonging to this tier
      for (const prov of readyProviders) {
        if (usedProviderIdsInTier.has(prov.id)) continue;
        const provTier = getProviderEffectiveTier(prov);
        if (provTier === tierBlock.tier) {
          const provModels = Array.isArray(prov.models) ? prov.models : [];
          const fallbackModel =
            provModels[0] || getPreset(prov.preset)?.models?.[0] || "";
          if (fallbackModel) {
            addTarget(`${prov.slug}/${fallbackModel}`);
            usedProviderIdsInTier.add(prov.id);
          }
        }
      }
    }

    if (targets.length === 0) {
      return res.status(409).json({
        error: "No connected and enabled providers match this template"
      });
    }

    const body = req.body || {};
    const existingCombos = storage.getCombos();
    const baseName =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : template.id;
    let finalName = baseName;
    let suffix = 2;
    while (existingCombos.some((c) => c.name === finalName)) {
      finalName = `${baseName}-${suffix++}`;
    }

    const now = new Date().toISOString();
    const combo = {
      id: nanoid(),
      name: finalName,
      description: template.description,
      strategy: "fallback",
      targets,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };

    await storage.update((data) => {
      data.combos.push(combo);
    });

    return res.status(201).json({ combo });
  });

  // --- Outbound Proxy Pools ---

  router.get("/proxy-pools", (_req, res) => {
    const pools = getProxyPools(storage).map((p) => toPublicProxyPool(p, storage));
    return res.json({ pools });
  });

  router.post("/proxy-pools", async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Proxy pool name is required" });
    }

    const parsed = parseProxyUrl(body.url);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error || "Invalid proxy URL" });
    }

    const now = new Date().toISOString();
    const pool = {
      id: nanoid(),
      name,
      type: parsed.type,
      url: parsed.url,
      enabled: body.enabled !== false,
      createdAt: now,
      updatedAt: now
    };

    await storage.update((data) => {
      if (!Array.isArray(data.proxyPools)) {
        data.proxyPools = [];
      }
      data.proxyPools.push(pool);
    });
    clearProxyDispatcherCache();

    return res.status(201).json({ pool: toPublicProxyPool(pool, storage) });
  });

  router.put("/proxy-pools/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const existing = getProxyPoolById(storage, id);
    if (!existing) {
      return res.status(404).json({ error: "Proxy pool not found" });
    }

    let nextUrl = getPlainProxyUrl(existing, storage);
    let nextType = existing.type || "http";

    if (body.url !== undefined) {
      const incomingUrl = typeof body.url === "string" ? body.url.trim() : "";
      const existingMasked = maskProxyUrl(nextUrl);
      if (incomingUrl && incomingUrl !== existingMasked) {
        const parsed = parseProxyUrl(incomingUrl);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error || "Invalid proxy URL" });
        }
        nextUrl = parsed.url;
        nextType = parsed.type;
      }
    }

    if (body.name !== undefined) {
      const candidateName = typeof body.name === "string" ? body.name.trim() : "";
      if (!candidateName) {
        return res.status(400).json({ error: "Proxy pool name cannot be empty" });
      }
    }

    const updated = await storage.update((data) => {
      if (!Array.isArray(data.proxyPools)) {
        data.proxyPools = [];
      }
      const target = data.proxyPools.find((p) => p.id === id);
      if (!target) return null;

      if (typeof body.name === "string" && body.name.trim()) {
        target.name = body.name.trim();
      }
      target.url = nextUrl;
      target.type = nextType;
      if (body.enabled !== undefined) {
        target.enabled = Boolean(body.enabled);
      }
      target.updatedAt = new Date().toISOString();
      return target;
    });

    clearProxyDispatcherCache();
    if (!updated) {
      return res.status(404).json({ error: "Proxy pool not found" });
    }

    return res.json({ pool: toPublicProxyPool(updated, storage) });
  });

  router.delete("/proxy-pools/:id", async (req, res) => {
    const { id } = req.params;
    const removed = await storage.update((data) => {
      if (!Array.isArray(data.proxyPools)) return false;
      const idx = data.proxyPools.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      data.proxyPools.splice(idx, 1);
      for (const prov of data.providers || []) {
        if (prov.proxyPoolId === id) {
          prov.proxyPoolId = null;
        }
      }
      return true;
    });

    clearProxyDispatcherCache();
    if (!removed) {
      return res.status(404).json({ error: "Proxy pool not found" });
    }
    return res.json({ ok: true });
  });

  router.post("/proxy-pools/:id/test", async (req, res) => {
    const pool = getProxyPoolById(storage, req.params.id);
    if (!pool) {
      return res.status(404).json({ error: "Proxy pool not found" });
    }
    const result = await testProxyPoolConnection(pool, storage);
    return res.json(result);
  });

  return router;
}
