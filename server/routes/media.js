import express from "express";
import { nanoid } from "nanoid";
import { createRouterAuthMiddleware, sanitizeSecrets } from "../auth.js";
import {
  buildUpstreamUrl,
  getPreset,
  isKeyOptionalProvider,
  isValidHttpUrl,
  normalizeBaseUrl
} from "../presets.js";
import { parseDirectTarget, resolveAuthContextForKey } from "../router.js";
import { getProxyDispatcher } from "../proxy.js";
import { classifyHostForSSRF } from "../security/redact.js";

const SEARCH_PRESETS = new Set([
  "tavily",
  "brave",
  "serper",
  "exa",
  "linkup",
  "searchapi",
  "searxng",
  "google-pse",
  "youcom"
]);

const FETCH_PRESETS = new Set(["firecrawl", "jina", "tavily", "exa"]);

/**
 * Send an OpenAI-formatted error response.
 * @param {import("express").Response} res
 * @param {number} status
 * @param {string} message
 * @param {string} [type]
 */
function sendV1Error(res, status, message, type = "api_error") {
  if (res.headersSent || res.writableEnded) return;
  const mappedType =
    status === 400
      ? "invalid_request_error"
      : status === 401
        ? "authentication_error"
        : status === 404
          ? "not_found_error"
          : type;
  res.status(status).json({
    error: {
      message,
      type: mappedType
    }
  });
}

/**
 * Build official authentication headers for a provider according to its preset `authStyle`.
 * @param {any} provider
 * @param {string} apiKey
 * @param {Record<string, string>} [extraHeaders]
 */
function buildServiceHeaders(provider, apiKey, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (!apiKey) return headers;

  const presetDef = getPreset(provider?.preset);
  const formatChanged = Boolean(
    presetDef?.formatType &&
    provider?.formatType &&
    provider.formatType !== presetDef.formatType
  );
  const authStyle =
    provider?.authStyle ||
    (!formatChanged ? presetDef?.authStyle : undefined) ||
    (provider?.formatType === "anthropic" ? "x-api-key" : "bearer");

  switch (authStyle) {
    case "x-subscription-token":
      headers["x-subscription-token"] = apiKey;
      break;
    case "x-api-key":
      headers["x-api-key"] = apiKey;
      break;
    case "xi-api-key":
      headers["xi-api-key"] = apiKey;
      break;
    case "x-key":
      headers["x-key"] = apiKey;
      break;
    case "api-key":
      headers["api-key"] = apiKey;
      headers["authorization"] = `Bearer ${apiKey}`;
      break;
    case "token":
      headers["authorization"] = `Token ${apiKey}`;
      break;
    case "key":
      headers["authorization"] = `Key ${apiKey}`;
      break;
    case "authorization":
      headers["authorization"] = apiKey;
      break;
    case "none":
    case "query-key":
      break;
    default:
      headers["authorization"] = `Bearer ${apiKey}`;
      break;
  }

  return headers;
}

/**
 * Collect all plaintext upstream keys across providers for secret redaction.
 * @param {import("../storage.js").Storage} storage
 */
function collectAllSecrets(storage) {
  const secrets = [];
  for (const p of storage.getProviders()) {
    for (const k of p.apiKeys || []) {
      if (k?.key) secrets.push(k.key);
      if (typeof k?.serviceAccountJson === "string" && k.serviceAccountJson) {
        secrets.push(k.serviceAccountJson);
        try {
          const sa = JSON.parse(k.serviceAccountJson);
          if (sa?.private_key) secrets.push(sa.private_key);
        } catch {
          // ignore
        }
      }
      if (typeof k?.oauthCredentials === "string" && k.oauthCredentials) {
        secrets.push(k.oauthCredentials);
        try {
          const oc = JSON.parse(k.oauthCredentials);
          if (oc?.refreshToken) secrets.push(oc.refreshToken);
          if (oc?.clientSecret) secrets.push(oc.clientSecret);
          if (oc?.accessToken) secrets.push(oc.accessToken);
        } catch {
          // ignore
        }
      }
    }
  }
  return secrets;
}

/**
 * Resolve an active provider and upstream model for media endpoints (`/v1/images/generations`, `/v1/audio/*`).
 * @param {import("../storage.js").Storage} storage
 * @param {import("../router.js").RouterService} routerService
 * @param {{ model?: string, providerHint?: string, kind: "image" | "tts" | "stt" }} opts
 */
function resolveMediaProviderAndModel(storage, routerService, opts) {
  const { model = "", providerHint = "", kind } = opts;
  const enabledProviders = storage
    .getProviders()
    .filter((p) => p.enabled !== false);

  // 1. Check if model is `<providerSlug>/<upstreamModel>` or a combo name
  if (typeof model === "string" && model.trim()) {
    const trimmedModel = model.trim();
    const direct = parseDirectTarget(trimmedModel);
    if (direct) {
      const prov = enabledProviders.find(
        (p) => p.slug === direct.providerSlug || p.preset === direct.providerSlug
      );
      if (prov) {
        return { provider: prov, upstreamModel: direct.upstreamModel };
      }
      return {
        error: {
          status: 404,
          message: `Provider '${direct.providerSlug}' not found or disabled`
        }
      };
    }

    const comboMatch = storage
      .getCombos()
      .find(
        (c) =>
          c.enabled !== false &&
          (c.name === trimmedModel || c.id === trimmedModel)
      );
    if (comboMatch) {
      for (const t of comboMatch.targets || []) {
        const parsed = parseDirectTarget(t);
        if (!parsed) continue;
        const prov = enabledProviders.find((p) => p.slug === parsed.providerSlug);
        if (prov) {
          return { provider: prov, upstreamModel: parsed.upstreamModel };
        }
      }
    }
  }

  // 2. Explicit provider hint
  if (typeof providerHint === "string" && providerHint.trim()) {
    const hint = providerHint.trim().toLowerCase();
    const prov = enabledProviders.find(
      (p) => p.slug.toLowerCase() === hint || (p.preset || "").toLowerCase() === hint
    );
    if (!prov) {
      return {
        error: {
          status: 404,
          message: `Provider '${providerHint}' not found or disabled`
        }
      };
    }
    return {
      provider: prov,
      upstreamModel: model || prov.models?.[0] || "default"
    };
  }

  // 3. Find enabled provider supporting the requested service kind or OpenAI format
  const byModelMatch = model
    ? enabledProviders.find((p) => (p.models || []).includes(model))
    : null;
  if (byModelMatch) {
    return { provider: byModelMatch, upstreamModel: model };
  }

  const byKindMatch = enabledProviders.find((p) => {
    const presetDef = getPreset(p.preset);
    return (presetDef?.serviceKinds || []).includes(kind);
  });
  if (byKindMatch) {
    return {
      provider: byKindMatch,
      upstreamModel: model || byKindMatch.models?.[0] || "default"
    };
  }

  const fallbackOpenAI = enabledProviders.find((p) => p.formatType === "openai");
  if (fallbackOpenAI) {
    return {
      provider: fallbackOpenAI,
      upstreamModel: model || fallbackOpenAI.models?.[0] || "default"
    };
  }

  return {
    error: {
      status: 503,
      message: `No enabled provider available for ${kind}`
    }
  };
}

/**
 * Normalize raw search provider JSON into `{ title, url, snippet }[]`.
 * @param {any} rawJson
 * @param {number} maxResults
 */
export function normalizeSearchResults(rawJson, maxResults = 5) {
  if (!rawJson || typeof rawJson !== "object") return [];
  const rawList =
    (Array.isArray(rawJson.results) && rawJson.results) ||
    (Array.isArray(rawJson.web?.results) && rawJson.web.results) ||
    (Array.isArray(rawJson.organic) && rawJson.organic) ||
    (Array.isArray(rawJson.organic_results) && rawJson.organic_results) ||
    (Array.isArray(rawJson.items) && rawJson.items) ||
    (Array.isArray(rawJson.data) && rawJson.data) ||
    [];

  const normalized = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const url = String(item.url || item.link || "").trim();
    const title = String(item.title || item.name || url || "").trim();
    const snippet = String(
      item.snippet ??
        item.content ??
        item.description ??
        item.text ??
        (Array.isArray(item.highlights) ? item.highlights[0] : "") ??
        ""
    ).trim();
    if (url || title) {
      normalized.push({ title, url, snippet });
    }
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}

/**
 * Normalize raw web-fetch response payload into `{ title?: string, content: string }`.
 * @param {any} rawPayload
 */
export function normalizeWebFetchResult(rawPayload) {
  if (typeof rawPayload === "string") {
    return { content: rawPayload };
  }
  if (!rawPayload || typeof rawPayload !== "object") {
    return { content: "" };
  }

  const dataObj =
    rawPayload.data && typeof rawPayload.data === "object" && !Array.isArray(rawPayload.data)
      ? rawPayload.data
      : null;
  const firstResult =
    Array.isArray(rawPayload.results) && rawPayload.results[0]
      ? rawPayload.results[0]
      : Array.isArray(rawPayload.data) && rawPayload.data[0]
        ? rawPayload.data[0]
        : null;

  const title =
    dataObj?.metadata?.title ||
    dataObj?.title ||
    firstResult?.title ||
    rawPayload.title ||
    undefined;

  const content =
    dataObj?.markdown ??
    dataObj?.content ??
    dataObj?.text ??
    firstResult?.raw_content ??
    firstResult?.content ??
    firstResult?.text ??
    rawPayload.markdown ??
    rawPayload.content ??
    rawPayload.text ??
    "";

  return {
    ...(title ? { title: String(title) } : {}),
    content: String(content)
  };
}

/**
 * Read raw Buffer from an Express request stream (used for multipart/form-data passthrough).
 * @param {import("express").Request} req
 * @returns {Promise<Buffer>}
 */
function readRawRequestBuffer(req) {
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body), "utf8"));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Create the Express router mounted at `/v1` for image, audio, search, and web-fetch service kinds.
 * @param {import("../storage.js").Storage} storage
 * @param {import("../router.js").RouterService} routerService
 */
export function createMediaRouter(storage, routerService) {
  const router = express.Router();

  router.use(createRouterAuthMiddleware(storage));

  // --- POST /v1/images/generations ---

  router.post("/images/generations", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routerKey = req.routerKey || null;

    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return sendV1Error(res, 400, "Missing required 'prompt' field");
    }

    const resolved = resolveMediaProviderAndModel(storage, routerService, {
      model: body.model || "",
      providerHint: body.provider || "",
      kind: "image"
    });
    if (resolved.error) {
      return sendV1Error(res, resolved.error.status, resolved.error.message);
    }

    const { provider, upstreamModel } = resolved;
    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for provider '${provider.slug}'`
      );
    }

    const keyEntry = keySelection.keys[0];
    const upstreamUrl = buildUpstreamUrl(
      provider.baseUrl,
      provider.formatType,
      "images/generations"
    );
    const upstreamPayload = { ...body, model: upstreamModel };
    delete upstreamPayload.provider;

    const dispatcher = getProxyDispatcher(provider, storage);

    try {
      const { secret: authSecret, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const headers = buildServiceHeaders(provider, authSecret, {
        ...extraHeaders,
        "content-type": "application/json"
      });
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamPayload),
        ...(dispatcher ? { dispatcher } : {})
      });
      const text = await upstreamRes.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: { message: text.slice(0, 300) || `HTTP ${upstreamRes.status}` } };
      }

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: body.model || `${provider.slug}/${upstreamModel}`,
          resolvedModel: `${provider.slug}/${upstreamModel}`,
          providerSlug: provider.slug,
          endpoint: "/v1/images/generations",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/${upstreamModel}`,
              providerSlug: provider.slug,
              model: upstreamModel,
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      return res.status(upstreamRes.status).json(json);
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream image generation failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  // --- POST /v1/audio/speech ---

  router.post("/audio/speech", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routerKey = req.routerKey || null;

    if (typeof body.input !== "string" || !body.input.trim()) {
      return sendV1Error(res, 400, "Missing required 'input' field");
    }

    const resolved = resolveMediaProviderAndModel(storage, routerService, {
      model: body.model || "",
      providerHint: body.provider || "",
      kind: "tts"
    });
    if (resolved.error) {
      return sendV1Error(res, resolved.error.status, resolved.error.message);
    }

    const { provider, upstreamModel } = resolved;
    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for provider '${provider.slug}'`
      );
    }

    const keyEntry = keySelection.keys[0];
    const upstreamUrl = buildUpstreamUrl(
      provider.baseUrl,
      provider.formatType,
      "audio/speech"
    );
    const upstreamPayload = {
      ...body,
      model: upstreamModel,
      voice: body.voice || "alloy"
    };
    delete upstreamPayload.provider;

    const dispatcher = getProxyDispatcher(provider, storage);

    try {
      const { secret: authSecret, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const headers = buildServiceHeaders(provider, authSecret, {
        ...extraHeaders,
        "content-type": "application/json"
      });
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamPayload),
        ...(dispatcher ? { dispatcher } : {})
      });

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: body.model || `${provider.slug}/${upstreamModel}`,
          resolvedModel: `${provider.slug}/${upstreamModel}`,
          providerSlug: provider.slug,
          endpoint: "/v1/audio/speech",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/${upstreamModel}`,
              providerSlug: provider.slug,
              model: upstreamModel,
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text().catch(() => "");
        const cleanMsg = sanitizeSecrets(
          errText.slice(0, 300) || `HTTP ${upstreamRes.status}`,
          collectAllSecrets(storage)
        );
        return sendV1Error(res, upstreamRes.status, cleanMsg);
      }

      const contentType =
        upstreamRes.headers.get("content-type") || "audio/mpeg";
      res.status(200);
      res.setHeader("Content-Type", contentType);

      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            res.write(Buffer.from(value));
          }
        }
        return res.end();
      }

      const audioBuf = Buffer.from(await upstreamRes.arrayBuffer());
      return res.send(audioBuf);
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream speech synthesis failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  // --- POST /v1/audio/transcriptions ---

  router.post("/audio/transcriptions", async (req, res) => {
    const startedAt = Date.now();
    const routerKey = req.routerKey || null;
    const rawContentType = req.headers["content-type"] || "application/octet-stream";

    let rawBuffer;
    try {
      rawBuffer = await readRawRequestBuffer(req);
    } catch (err) {
      return sendV1Error(res, 400, err?.message || "Failed to read transcription body");
    }

    // Extract optional model or provider hint from multipart form or JSON body or query
    let extractedModel =
      typeof req.query.model === "string" ? req.query.model : "";
    let providerHint =
      typeof req.query.provider === "string"
        ? req.query.provider
        : typeof req.headers["x-provider"] === "string"
          ? req.headers["x-provider"]
          : "";

    if (!extractedModel && req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      if (typeof req.body.model === "string") extractedModel = req.body.model;
      if (typeof req.body.provider === "string") providerHint = req.body.provider;
    }

    if (!extractedModel && rawContentType.includes("multipart/form-data") && rawBuffer.length > 0) {
      const previewStr = rawBuffer.toString("latin1");
      const match = previewStr.match(
        /Content-Disposition:\s*form-data;\s*name="model"\r?\n\r?\n([^\r\n]+)/i
      );
      if (match && match[1]) {
        extractedModel = match[1].trim();
      }
    }

    const resolved = resolveMediaProviderAndModel(storage, routerService, {
      model: extractedModel,
      providerHint,
      kind: "stt"
    });
    if (resolved.error) {
      return sendV1Error(res, resolved.error.status, resolved.error.message);
    }

    const { provider, upstreamModel } = resolved;
    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for provider '${provider.slug}'`
      );
    }

    // If multipart body contains `<providerSlug>/<upstreamModel>`, rewrite to `<upstreamModel>`
    let forwardBuffer = rawBuffer;
    if (
      extractedModel &&
      extractedModel.includes("/") &&
      upstreamModel &&
      rawContentType.includes("multipart/form-data")
    ) {
      const str = rawBuffer.toString("latin1");
      const replaced = str.replace(extractedModel, upstreamModel);
      forwardBuffer = Buffer.from(replaced, "latin1");
    }

    const keyEntry = keySelection.keys[0];
    const upstreamUrl = buildUpstreamUrl(
      provider.baseUrl,
      provider.formatType,
      "audio/transcriptions"
    );
    const dispatcher = getProxyDispatcher(provider, storage);

    try {
      const { secret: authSecret, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const headers = buildServiceHeaders(provider, authSecret, {
        ...extraHeaders,
        "content-type": rawContentType
      });
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: forwardBuffer,
        ...(dispatcher ? { dispatcher } : {})
      });
      const respText = await upstreamRes.text();

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: extractedModel || `${provider.slug}/${upstreamModel}`,
          resolvedModel: `${provider.slug}/${upstreamModel}`,
          providerSlug: provider.slug,
          endpoint: "/v1/audio/transcriptions",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/${upstreamModel}`,
              providerSlug: provider.slug,
              model: upstreamModel,
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      const respContentType =
        upstreamRes.headers.get("content-type") || "application/json";
      res.status(upstreamRes.status);
      res.setHeader("Content-Type", respContentType);
      return res.send(respText);
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream audio transcription failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  // --- POST /v1/search ---

  router.post("/search", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routerKey = req.routerKey || null;

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return sendV1Error(res, 400, "Missing required 'query' field");
    }

    const maxResults =
      typeof body.max_results === "number" && body.max_results > 0
        ? Math.min(Math.floor(body.max_results), 50)
        : 5;

    const enabledProviders = storage
      .getProviders()
      .filter((p) => p.enabled !== false);
    const requestedProvider =
      typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";

    let provider = null;
    if (requestedProvider) {
      provider =
        enabledProviders.find(
          (p) =>
            p.slug.toLowerCase() === requestedProvider ||
            (p.preset || "").toLowerCase() === requestedProvider
        ) || null;
    } else {
      provider =
        enabledProviders.find((p) => {
          const presetKey = (p.preset || "").toLowerCase();
          const presetDef = getPreset(presetKey);
          return (
            SEARCH_PRESETS.has(presetKey) ||
            SEARCH_PRESETS.has(p.slug.toLowerCase()) ||
            (presetDef?.serviceKinds || []).includes("search")
          );
        }) || null;
    }

    if (!provider) {
      return sendV1Error(
        res,
        requestedProvider ? 404 : 503,
        requestedProvider
          ? `Search provider '${body.provider}' not found or disabled`
          : "No enabled search provider configured"
      );
    }

    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for search provider '${provider.slug}'`
      );
    }

    const keyEntry = keySelection.keys[0];
    const presetKey = (provider.preset || provider.slug || "").toLowerCase();
    const baseUrl = normalizeBaseUrl(provider.baseUrl);
    const dispatcher = getProxyDispatcher(provider, storage);

    try {
      const { secret: apiKey, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      let reqUrl = `${baseUrl}/search`;
      let reqMethod = "POST";
      let reqHeaders = buildServiceHeaders(provider, apiKey, {
        ...extraHeaders,
        "content-type": "application/json",
        accept: "application/json"
      });
      let reqBody = JSON.stringify({ query, max_results: maxResults });

      if (presetKey === "brave") {
        reqMethod = "GET";
        reqUrl = `${baseUrl}/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
        reqHeaders = buildServiceHeaders(provider, apiKey, {
          accept: "application/json"
        });
        reqBody = undefined;
      } else if (presetKey === "serper") {
        reqMethod = "POST";
        reqUrl = `${baseUrl}/search`;
        reqBody = JSON.stringify({ q: query, num: maxResults });
      } else if (presetKey === "exa") {
        reqMethod = "POST";
        reqUrl = `${baseUrl}/search`;
        reqBody = JSON.stringify({ query, numResults: maxResults });
      } else if (presetKey === "linkup") {
        reqMethod = "POST";
        reqUrl = `${baseUrl}/search`;
        reqBody = JSON.stringify({
          q: query,
          query,
          depth: "standard",
          outputType: "searchResults",
          maxResults
        });
      } else if (presetKey === "searchapi") {
        reqMethod = "GET";
        reqUrl = `${baseUrl}/search?engine=google&q=${encodeURIComponent(query)}&num=${maxResults}`;
        reqHeaders = buildServiceHeaders(provider, apiKey, {
          accept: "application/json"
        });
        reqBody = undefined;
      } else if (presetKey === "searxng") {
        reqMethod = "GET";
        reqUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
        reqHeaders = buildServiceHeaders(provider, apiKey, {
          accept: "application/json"
        });
        reqBody = undefined;
      } else if (presetKey === "google-pse") {
        reqMethod = "GET";
        const sep = baseUrl.includes("?") ? "&" : "?";
        reqUrl = `${baseUrl}${sep}q=${encodeURIComponent(query)}&num=${Math.min(
          maxResults,
          10
        )}${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}${
          body.cx ? `&cx=${encodeURIComponent(body.cx)}` : ""
        }`;
        reqHeaders = { accept: "application/json" };
        reqBody = undefined;
      } else if (presetKey === "youcom") {
        reqMethod = "GET";
        reqUrl = `${baseUrl}/v1/search?query=${encodeURIComponent(query)}&count=${maxResults}`;
        reqHeaders = buildServiceHeaders(provider, apiKey, {
          accept: "application/json"
        });
        reqBody = undefined;
      } else {
        // Tavily & default
        reqMethod = "POST";
        reqUrl = `${baseUrl}/search`;
        reqBody = JSON.stringify({
          query,
          max_results: maxResults
        });
      }

      const upstreamRes = await fetch(reqUrl, {
        method: reqMethod,
        headers: reqHeaders,
        ...(reqBody ? { body: reqBody } : {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const text = await upstreamRes.text();

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: `${provider.slug}/search`,
          resolvedModel: `${provider.slug}/search`,
          providerSlug: provider.slug,
          endpoint: "/v1/search",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/search`,
              providerSlug: provider.slug,
              model: "search",
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      if (!upstreamRes.ok) {
        const cleanMsg = sanitizeSecrets(
          text.slice(0, 300) || `HTTP ${upstreamRes.status}`,
          collectAllSecrets(storage)
        );
        return sendV1Error(res, upstreamRes.status, cleanMsg);
      }

      let rawJson = {};
      try {
        rawJson = JSON.parse(text);
      } catch {
        rawJson = {};
      }

      const results = normalizeSearchResults(rawJson, maxResults);
      const providerLabel =
        provider.preset && provider.preset !== "custom"
          ? provider.preset
          : provider.slug;

      return res.json({
        provider: providerLabel,
        results
      });
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream search request failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  // --- POST /v1/web/fetch ---

  router.post("/web/fetch", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routerKey = req.routerKey || null;

    const targetUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!targetUrl || !isValidHttpUrl(targetUrl)) {
      return sendV1Error(res, 400, "Missing or invalid 'url' field");
    }

    try {
      const parsedTarget = new URL(targetUrl);
      const ssrf = classifyHostForSSRF(parsedTarget.hostname);
      if (ssrf.isMetadataOrLinkLocal || ssrf.isPrivateLan || ssrf.isLoopback) {
        return sendV1Error(
          res,
          400,
          `SSRF guard: ${ssrf.reason || "private or loopback target host blocked"}`
        );
      }
    } catch {
      return sendV1Error(res, 400, "Invalid target URL");
    }

    const enabledProviders = storage
      .getProviders()
      .filter((p) => p.enabled !== false);
    const requestedProvider =
      typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";

    let provider = null;
    if (requestedProvider) {
      provider =
        enabledProviders.find(
          (p) =>
            p.slug.toLowerCase() === requestedProvider ||
            (p.preset || "").toLowerCase() === requestedProvider
        ) || null;
    } else {
      provider =
        enabledProviders.find((p) => {
          const presetKey = (p.preset || "").toLowerCase();
          const presetDef = getPreset(presetKey);
          return (
            FETCH_PRESETS.has(presetKey) ||
            FETCH_PRESETS.has(p.slug.toLowerCase()) ||
            (presetDef?.serviceKinds || []).includes("fetch")
          );
        }) || null;
    }

    if (!provider) {
      return sendV1Error(
        res,
        requestedProvider ? 404 : 503,
        requestedProvider
          ? `Web fetch provider '${body.provider}' not found or disabled`
          : "No enabled web fetch provider configured"
      );
    }

    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for web fetch provider '${provider.slug}'`
      );
    }

    const keyEntry = keySelection.keys[0];
    const presetKey = (provider.preset || provider.slug || "").toLowerCase();
    const baseUrl = normalizeBaseUrl(provider.baseUrl);
    const dispatcher = getProxyDispatcher(provider, storage);

    try {
      const { secret: apiKey, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      let reqUrl = `${baseUrl}/scrape`;
      let reqMethod = "POST";
      let reqHeaders = buildServiceHeaders(provider, apiKey, {
        ...extraHeaders,
        "content-type": "application/json",
        accept: "application/json"
      });
      let reqBody = JSON.stringify({ url: targetUrl, formats: ["markdown"] });

      if (presetKey === "jina" && baseUrl.includes("jina.ai")) {
        reqMethod = "GET";
        reqUrl = `https://r.jina.ai/${targetUrl}`;
        reqHeaders = buildServiceHeaders(provider, apiKey, {
          accept: "application/json"
        });
        reqBody = undefined;
      } else if (presetKey === "tavily") {
        reqMethod = "POST";
        reqUrl = `${baseUrl}/extract`;
        reqBody = JSON.stringify({ urls: [targetUrl], url: targetUrl });
      } else if (presetKey === "exa") {
        reqMethod = "POST";
        reqUrl = `${baseUrl}/contents`;
        reqBody = JSON.stringify({
          ids: [targetUrl],
          urls: [targetUrl],
          url: targetUrl,
          text: true
        });
      }

      let upstreamRes = await fetch(reqUrl, {
        method: reqMethod,
        headers: reqHeaders,
        ...(reqBody ? { body: reqBody } : {}),
        ...(dispatcher ? { dispatcher } : {})
      });

      // Fallback to /scrape if mock upstream only implements /scrape
      if (upstreamRes.status === 404 && !reqUrl.endsWith("/scrape")) {
        upstreamRes = await fetch(`${baseUrl}/scrape`, {
          method: "POST",
          headers: buildServiceHeaders(provider, apiKey, {
            "content-type": "application/json",
            accept: "application/json"
          }),
          body: JSON.stringify({ url: targetUrl }),
          ...(dispatcher ? { dispatcher } : {})
        });
      }

      const text = await upstreamRes.text();

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: `${provider.slug}/fetch`,
          resolvedModel: `${provider.slug}/fetch`,
          providerSlug: provider.slug,
          endpoint: "/v1/web/fetch",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/fetch`,
              providerSlug: provider.slug,
              model: "fetch",
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      if (!upstreamRes.ok) {
        const cleanMsg = sanitizeSecrets(
          text.slice(0, 300) || `HTTP ${upstreamRes.status}`,
          collectAllSecrets(storage)
        );
        return sendV1Error(res, upstreamRes.status, cleanMsg);
      }

      let parsedPayload = text;
      try {
        parsedPayload = JSON.parse(text);
      } catch {
        parsedPayload = text;
      }

      const normalized = normalizeWebFetchResult(parsedPayload);
      const providerLabel =
        provider.preset && provider.preset !== "custom"
          ? provider.preset
          : provider.slug;

      return res.json({
        provider: providerLabel,
        url: targetUrl,
        ...(normalized.title ? { title: normalized.title } : {}),
        content: normalized.content
      });
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream web fetch failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  // --- GET /v1/audio/voices (9Router TTS voices endpoint) ---

  router.get("/audio/voices", (req, res) => {
    const providerFilter =
      typeof req.query.provider === "string" ? req.query.provider.trim().toLowerCase() : "";
    const catalog = {
      openai: [
        { id: "alloy", name: "Alloy", gender: "neutral", language: "en" },
        { id: "ash", name: "Ash", gender: "male", language: "en" },
        { id: "coral", name: "Coral", gender: "female", language: "en" },
        { id: "echo", name: "Echo", gender: "male", language: "en" },
        { id: "fable", name: "Fable", gender: "neutral", language: "en" },
        { id: "nova", name: "Nova", gender: "female", language: "en" },
        { id: "onyx", name: "Onyx", gender: "male", language: "en" },
        { id: "sage", name: "Sage", gender: "female", language: "en" },
        { id: "shimmer", name: "Shimmer", gender: "female", language: "en" }
      ],
      elevenlabs: [
        { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", language: "en" },
        { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "female", language: "en" },
        { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "male", language: "en" },
        { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "male", language: "en" }
      ],
      deepgram: [
        { id: "aura-asteria-en", name: "Asteria", gender: "female", language: "en" },
        { id: "aura-luna-en", name: "Luna", gender: "female", language: "en" },
        { id: "aura-orion-en", name: "Orion", gender: "male", language: "en" },
        { id: "aura-arcas-en", name: "Arcas", gender: "male", language: "en" }
      ],
      "self-hosted-tts": [
        { id: "af_heart", name: "Kokoro Heart", gender: "female", language: "en" },
        { id: "af_bella", name: "Kokoro Bella", gender: "female", language: "en" },
        { id: "am_adam", name: "Kokoro Adam", gender: "male", language: "en" }
      ]
    };
    if (providerFilter) {
      return res.json({
        provider: providerFilter,
        voices: catalog[providerFilter] || catalog.openai
      });
    }
    return res.json({ voices: catalog });
  });

  // --- POST /v1/videos/generations (9Router video generation proxy) ---

  router.post("/videos/generations", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routerKey = req.routerKey || null;
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return sendV1Error(res, 400, "Missing required 'prompt' field");
    }

    const resolved = resolveMediaProviderAndModel(storage, routerService, {
      model: body.model || "",
      providerHint: body.provider || "",
      kind: "video"
    });
    if (resolved.error) {
      return sendV1Error(res, resolved.error.status, resolved.error.message);
    }

    const { provider, upstreamModel } = resolved;
    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for video provider '${provider.slug}'`
      );
    }

    const keyEntry = keySelection.keys[0];
    const upstreamUrl = buildUpstreamUrl(provider.baseUrl, provider.formatType, "videos/generations");
    const dispatcher = getProxyDispatcher(provider, storage);
    const upstreamPayload = { ...body, model: upstreamModel };
    delete upstreamPayload.provider;

    try {
      const { secret: authSecret, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const headers = buildServiceHeaders(provider, authSecret, {
        ...extraHeaders,
        "content-type": "application/json"
      });
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamPayload),
        ...(dispatcher ? { dispatcher } : {})
      });
      const text = await upstreamRes.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: { message: text.slice(0, 300) || `HTTP ${upstreamRes.status}` } };
      }

      await storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          requestedModel: body.model || `${provider.slug}/${upstreamModel}`,
          resolvedModel: `${provider.slug}/${upstreamModel}`,
          providerSlug: provider.slug,
          endpoint: "/v1/videos/generations",
          status: upstreamRes.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [
            {
              target: `${provider.slug}/${upstreamModel}`,
              providerSlug: provider.slug,
              model: upstreamModel,
              keyId: keyEntry.id,
              status: upstreamRes.status,
              latencyMs: Date.now() - startedAt
            }
          ]
        },
        routerKey?.id || null
      );

      return res.status(upstreamRes.status).json(json);
    } catch (err) {
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream video generation failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    }
  });

  return router;
}
