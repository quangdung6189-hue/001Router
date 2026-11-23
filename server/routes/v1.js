import express from "express";
import { createRouterAuthMiddleware, isRouterKeyModelAllowed } from "../auth.js";
import { PRESETS, getPreset } from "../presets.js";
import { estimateAnthropicInputTokens } from "../translator.js";
import { getMergedPricingMap } from "../pricing.js";

/**
 * Create the Express router mounted at `/v1` for unified OpenAI & Anthropic clients.
 * @param {import("../storage.js").Storage} storage
 * @param {import("../router.js").RouterService} routerService
 */
export function createV1Router(storage, routerService) {
  const router = express.Router();

  router.use(createRouterAuthMiddleware(storage));

  router.get("/models", (req, res) => {
    const kindFilter =
      typeof req.query.kind === "string" ? req.query.kind.trim().toLowerCase() : "";
    const routerKey = req.routerKey || null;
    const data = [];
    const seen = new Set();

    const maybePush = (item) => {
      if (seen.has(item.id)) return;
      if (routerKey && !isRouterKeyModelAllowed(routerKey, item.id)) return;
      seen.add(item.id);
      data.push(item);
    };

    if (!kindFilter || kindFilter === "chat" || kindFilter === "all") {
      for (const combo of storage.getCombos()) {
        if (combo.enabled === false || !combo.name) continue;
        const created = combo.createdAt
          ? Math.floor(Date.parse(combo.createdAt) / 1000) || Math.floor(Date.now() / 1000)
          : Math.floor(Date.now() / 1000);
        maybePush({
          id: combo.name,
          object: "model",
          created,
          owned_by: "001router-combo"
        });
      }

      // Include custom Model Aliases
      const aliases = storage.getModelAliases?.() || {};
      const nowSec = Math.floor(Date.now() / 1000);
      for (const [alias, target] of Object.entries(aliases)) {
        if (!alias || !target) continue;
        maybePush({
          id: alias,
          object: "model",
          created: nowSec,
          owned_by: "001router-alias"
        });
      }
    }

    for (const provider of storage.getProviders()) {
      if (provider.enabled === false) continue;
      const created = provider.createdAt
        ? Math.floor(Date.parse(provider.createdAt) / 1000) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

      if (!kindFilter || kindFilter === "all") {
        for (const modelId of provider.models || []) {
          if (!modelId) continue;
          if (storage.isModelDisabled?.(provider.slug, modelId)) continue;
          maybePush({
            id: `${provider.slug}/${modelId}`,
            object: "model",
            created,
            owned_by: provider.slug
          });
        }
        continue;
      }

      const presetDef = getPreset(provider.preset);
      const catalogEntries = presetDef?.modelCatalog || [];
      const catalogById = new Map(catalogEntries.map((m) => [m.id, m]));
      const candidateIds = new Set([
        ...(provider.models || []),
        ...catalogEntries.map((m) => m.id)
      ]);

      for (const modelId of candidateIds) {
        if (!modelId) continue;
        if (storage.isModelDisabled?.(provider.slug, modelId)) continue;
        const entry = catalogById.get(modelId);
        let matches = false;
        if (kindFilter === "chat") {
          matches = entry ? entry.kind === "chat" : (provider.models || []).includes(modelId);
        } else if (kindFilter === "vision") {
          matches = Boolean(entry && (entry.vision === true || entry.kind === "vision"));
        } else {
          matches = Boolean(entry && entry.kind === kindFilter);
        }
        if (!matches) continue;

        maybePush({
          id: `${provider.slug}/${modelId}`,
          object: "model",
          created,
          owned_by: provider.slug,
          kind: entry?.kind || kindFilter
        });
      }
    }

    return res.json({
      object: "list",
      data
    });
  });

  // Rich model metadata & pricing endpoint (9Router /v1/models/info parity)
  router.get("/models/info", (req, res) => {
    const routerKey = req.routerKey || null;
    const pricingMap = getMergedPricingMap(PRESETS, storage.getCustomPricing?.() || {});
    const models = [];
    for (const provider of storage.getProviders()) {
      if (provider.enabled === false) continue;
      const presetDef = getPreset(provider.preset);
      const catById = new Map((presetDef?.modelCatalog || []).map((m) => [m.id, m]));
      for (const modelId of provider.models || []) {
        if (storage.isModelDisabled?.(provider.slug, modelId)) continue;
        const fullId = `${provider.slug}/${modelId}`;
        if (routerKey && !isRouterKeyModelAllowed(routerKey, fullId)) continue;
        const cat = catById.get(modelId) || {};
        const price = pricingMap[provider.preset]?.[modelId] || pricingMap[provider.slug]?.[modelId] || null;
        models.push({
          id: fullId,
          provider: provider.slug,
          preset: provider.preset,
          model: modelId,
          contextWindow: cat.contextWindow || 128000,
          vision: Boolean(cat.vision),
          reasoning: Boolean(cat.reasoning),
          tools: cat.tools !== false,
          pricing: price
        });
      }
    }
    const visibleAliases = {};
    for (const [alias, target] of Object.entries(storage.getModelAliases?.() || {})) {
      if (!routerKey || isRouterKeyModelAllowed(routerKey, alias) || isRouterKeyModelAllowed(routerKey, target)) {
        visibleAliases[alias] = target;
      }
    }
    const visibleCombos = storage.getCombos().filter(
      (c) => c.enabled !== false && (!routerKey || isRouterKeyModelAllowed(routerKey, c.name))
    );
    return res.json({
      object: "list",
      models,
      aliases: visibleAliases,
      combos: visibleCombos
    });
  });

  router.post("/chat/completions", (req, res) =>
    routerService.handleChatCompletions(req, res)
  );

  router.post("/embeddings", (req, res) =>
    routerService.handleEmbeddings(req, res)
  );

  router.post("/messages", (req, res) =>
    routerService.handleMessages(req, res)
  );

  router.post("/responses", (req, res) =>
    routerService.handleResponses(req, res)
  );

  // OpenAI Responses context compaction helper (9Router /v1/responses/compact parity)
  router.post("/responses/compact", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const input = Array.isArray(body.input) ? body.input : [];
    const maxItems = Math.max(2, Number(body.max_items) || 20);
    if (input.length <= maxItems) {
      return res.json({
        object: "response.compaction",
        compacted: false,
        original_count: input.length,
        compacted_count: input.length,
        output: input
      });
    }
    const head = input.slice(0, Math.min(4, Math.floor(maxItems / 3)));
    const tail = input.slice(-(maxItems - head.length));
    const dropped = input.length - head.length - tail.length;
    const output = [
      ...head,
      {
        type: "message",
        role: "system",
        content: `[Compacted ${dropped} middle conversation items by 001Router]`
      },
      ...tail
    ];
    return res.json({
      object: "response.compaction",
      compacted: true,
      original_count: input.length,
      compacted_count: output.length,
      output
    });
  });

  router.post("/messages/count_tokens", (req, res) => {
    const inputTokens = estimateAnthropicInputTokens(req.body || {});
    return res.json({ input_tokens: inputTokens });
  });

  // Ollama compatibility endpoints (/v1/api/tags & /v1/api/chat)
  router.get("/api/tags", (req, res) => {
    const routerKey = req.routerKey || null;
    const models = [];
    for (const combo of storage.getCombos()) {
      if (combo.enabled === false || !combo.name) continue;
      if (routerKey && !isRouterKeyModelAllowed(routerKey, combo.name)) continue;
      models.push({
        name: combo.name,
        model: combo.name,
        modified_at: combo.updatedAt || new Date().toISOString(),
        size: 0
      });
    }
    for (const provider of storage.getProviders()) {
      if (provider.enabled === false) continue;
      for (const m of provider.models || []) {
        if (storage.isModelDisabled?.(provider.slug, m)) continue;
        const fullId = `${provider.slug}/${m}`;
        if (routerKey && !isRouterKeyModelAllowed(routerKey, fullId)) continue;
        models.push({
          name: fullId,
          model: fullId,
          modified_at: provider.updatedAt || new Date().toISOString(),
          size: 0
        });
      }
    }
    return res.json({ models });
  });

  router.post("/api/chat", (req, res) => {
    // Delegate Ollama chat body (already messages + model + stream) to OpenAI pipeline
    return routerService.handleChatCompletions(req, res);
  });

  return router;
}
