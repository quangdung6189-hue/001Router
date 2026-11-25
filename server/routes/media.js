import express from "express";
import dns from "node:dns";
import { isIP } from "node:net";
import { nanoid } from "nanoid";
import {
  createRouterAuthMiddleware,
  isRouterKeyModelAllowed,
  sanitizeSecrets
} from "../auth.js";
import {
  buildUpstreamUrl,
  getPreset,
  isKeyOptionalProvider,
  isValidHttpUrl,
  normalizeBaseUrl
} from "../presets.js";
import { parseDirectTarget, resolveAuthContextForKey } from "../router.js";
import { getProxyDispatcher, upstreamFetch as fetch } from "../proxy.js";
import { classifyHostForSSRF } from "../security/redact.js";

const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;
const AUDIO_UPLOAD_TIMEOUT_MS = 30_000;
const DNS_SSRF_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Resolve DNS for a target hostname and reject if any returned IP is loopback, LAN, or metadata/link-local.
 * @param {string} rawHostname
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function checkResolvedHostForSSRF(rawHostname) {
  const bare = String(rawHostname || "")
    .trim()
    .replace(/^\[|\]$/g, "");
  if (!bare || isIP(bare)) return { ok: true };
  let timer = null;
  try {
    const records = await Promise.race([
      dns.promises.lookup(bare, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS timeout")), DNS_SSRF_LOOKUP_TIMEOUT_MS);
        timer.unref?.();
      })
    ]);
    if (Array.isArray(records)) {
      for (const rec of records) {
        const addr = rec?.address;
        if (!addr) continue;
        const ssrf = classifyHostForSSRF(addr);
        if (ssrf.isMetadataOrLinkLocal || ssrf.isPrivateLan || ssrf.isLoopback) {
          return {
            ok: false,
            reason: `target host resolved to forbidden address (${ssrf.reason || addr})`
          };
        }
      }
    }
  } catch {
    // Allow remote scraper providers to handle unresolvable or offline-test hostnames;
    // any private/loopback/metadata literal was already blocked lexically above.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { ok: true };
}

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
 * Enforce per-key access restrictions (`routerKey.access`) on media/search/fetch endpoints.
 * Fail-closed: a restricted key may only use a target whose canonical id (`<providerSlug>/<model>`,
 * `<providerSlug>/search`, `<providerSlug>/fetch`) or whose combo name is on its allow-list.
 * Sends a 403 `permission_error` and returns false when denied.
 * @param {import("express").Response} res
 * @param {any} routerKey
 * @param {Array<string | null | undefined>} candidates
 * @returns {boolean} true when the request may proceed
 */
function enforceRouterKeyAccess(res, routerKey, candidates) {
  if (!routerKey || routerKey.access?.restricted !== true) return true;
  if (candidates.some((c) => typeof c === "string" && c && isRouterKeyModelAllowed(routerKey, c))) {
    return true;
  }
  const label = candidates.find((c) => typeof c === "string" && c) || "";
  if (!res.headersSent && !res.writableEnded) {
    res.status(403).json({
      error: {
        message: `Router key '${routerKey.name}' is not permitted to access '${label}'`,
        type: "permission_error"
      }
    });
  }
  return false;
}

/**
 * Return `model` when it names an enabled combo (so a key may be allow-listed on the combo name).
 * @param {import("../storage.js").Storage} storage
 * @param {unknown} model
 */
function comboNameOrNull(storage, model) {
  const m = typeof model === "string" ? model.trim() : "";
  if (!m) return null;
  const hit = storage.getCombos().some((c) => c.enabled !== false && (c.name === m || c.id === m));
  return hit ? m : null;
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
  if (typeof storage?.getRedactionSecrets === "function") {
    return storage.getRedactionSecrets();
  }
  const secrets = [];
  for (const p of storage.getProviders()) {
    for (const k of p.apiKeys || []) {
      if (k?.key) secrets.push(k.key);
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
 * Read raw Buffer from an Express request stream with strict byte and timeout caps.
 * @param {import("express").Request} req
 * @param {number} [maxBytes]
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer>}
 */
function readRawRequestBuffer(
  req,
  maxBytes = MAX_AUDIO_UPLOAD_BYTES,
  timeoutMs = AUDIO_UPLOAD_TIMEOUT_MS
) {
  const contentLenHeader = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLenHeader) && contentLenHeader > maxBytes) {
    const err = new Error(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
    err.status = 413;
    return Promise.reject(err);
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) {
      const err = new Error(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
      err.status = 413;
      return Promise.reject(err);
    }
    return Promise.resolve(req.body);
  }
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    const buf = Buffer.from(JSON.stringify(req.body), "utf8");
    if (buf.length > maxBytes) {
      const err = new Error(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
      err.status = 413;
      return Promise.reject(err);
    }
    return Promise.resolve(buf);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      if (err) reject(err);
      else resolve(buf);
    };

    const timer = setTimeout(() => {
      const err = new Error("Request upload timed out");
      err.status = 408;
      finish(err);
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk) => {
      const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bufChunk.length;
      if (totalBytes > maxBytes) {
        chunks.length = 0;
        const err = new Error(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
        err.status = 413;
        finish(err);
        return;
      }
      chunks.push(bufChunk);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, totalBytes));
    const onError = (err) => finish(err);
    const onAborted = () => {
      const err = new Error("Request stream aborted by client");
      err.status = 400;
      finish(err);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

/**
 * Extract the `model` field from a multipart/form-data buffer without decoding multi-MB audio payloads.
 * @param {Buffer} rawBuffer
 * @returns {string}
 */
function extractMultipartModelField(rawBuffer) {
  if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) return "";
  const pattern =
    /Content-Disposition:\s*form-data;\s*(?:[^;\r\n]+;\s*)*name=["']?model["']?(?:;[^\r\n]*)?\r?\n(?:[^\r\n]+\r?\n)*\r?\n([^\r\n]+)/i;
  if (rawBuffer.length <= 131_072) {
    const m = rawBuffer.toString("latin1").match(pattern);
    return m && m[1] ? m[1].trim() : "";
  }
  const head = rawBuffer.subarray(0, 65_536).toString("latin1");
  const headMatch = head.match(pattern);
  if (headMatch && headMatch[1]) return headMatch[1].trim();
  const tail = rawBuffer.subarray(rawBuffer.length - 65_536).toString("latin1");
  const tailMatch = tail.match(pattern);
  return tailMatch && tailMatch[1] ? tailMatch[1].trim() : "";
}

/**
 * Replace the first occurrence of `searchStr` with `replaceStr` directly on a Buffer (binary-safe).
 * @param {Buffer} buf
 * @param {string} searchStr
 * @param {string} replaceStr
 * @returns {Buffer}
 */
function replaceUtf8SequenceInBuffer(buf, searchStr, replaceStr) {
  const needle = Buffer.from(searchStr, "utf8");
  const idx = buf.indexOf(needle);
  if (idx < 0) return buf;
  const replacement = Buffer.from(replaceStr, "utf8");
  return Buffer.concat([
    buf.subarray(0, idx),
    replacement,
    buf.subarray(idx + needle.length)
  ]);
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
    if (
      !enforceRouterKeyAccess(res, routerKey, [
        `${provider.slug}/${upstreamModel}`,
        comboNameOrNull(storage, body.model)
      ])
    ) {
      return;
    }
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
        signal: AbortSignal.timeout(Number(storage.getSettings().timeoutMs) || 120_000),
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
    if (
      !enforceRouterKeyAccess(res, routerKey, [
        `${provider.slug}/${upstreamModel}`,
        comboNameOrNull(storage, body.model)
      ])
    ) {
      return;
    }
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
    const speechAbort = new AbortController();
    const onSpeechClose = () => {
      if (!res.writableEnded) speechAbort.abort();
    };
    res.on("close", onSpeechClose);

    try {
      const { secret: authSecret, extraHeaders } = await resolveAuthContextForKey(keyEntry, {
        ...(routerService.getServiceAccountOptions?.() || {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      const headers = buildServiceHeaders(provider, authSecret, {
        ...extraHeaders,
        "content-type": "application/json"
      });
      const timeoutSignal = AbortSignal.timeout(Number(storage.getSettings().timeoutMs) || 120_000);
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        signal: AbortSignal.any([speechAbort.signal, timeoutSignal]),
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
        try {
          while (true) {
            if (speechAbort.signal.aborted || res.writableEnded) {
              await reader.cancel().catch(() => {});
              break;
            }
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.length > 0 && !res.writableEnded) {
              res.write(Buffer.from(value));
            }
          }
        } finally {
          reader.releaseLock();
        }
        return res.writableEnded ? undefined : res.end();
      }

      const audioBuf = Buffer.from(await upstreamRes.arrayBuffer());
      return res.send(audioBuf);
    } catch (err) {
      if (speechAbort.signal.aborted || res.writableEnded) return;
      const cleanMsg = sanitizeSecrets(
        err?.message || "Upstream speech synthesis failed",
        collectAllSecrets(storage)
      );
      return sendV1Error(res, 502, cleanMsg);
    } finally {
      res.removeListener("close", onSpeechClose);
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
      const status = Number(err?.status) || 400;
      if (status === 413 || status === 408) {
        res.setHeader("Connection", "close");
        res.once("finish", () => {
          if (!req.complete) {
            req.socket?.end();
            const forceClose = setTimeout(() => {
              if (!req.destroyed) req.destroy();
            }, 250);
            forceClose.unref?.();
          }
        });
      }
      return sendV1Error(res, status, err?.message || "Failed to read transcription body");
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
      extractedModel = extractMultipartModelField(rawBuffer);
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
    if (
      !enforceRouterKeyAccess(res, routerKey, [
        `${provider.slug}/${upstreamModel}`,
        comboNameOrNull(storage, extractedModel)
      ])
    ) {
      return;
    }
    const keySelection = routerService.getOrderedActiveKeys(provider);
    if (keySelection.keys.length === 0) {
      return sendV1Error(
        res,
        keySelection.allInCooldown ? 429 : 503,
        `No active API keys for provider '${provider.slug}'`
      );
    }

    // If multipart body contains `<providerSlug>/<upstreamModel>`, rewrite binary-safely to `<upstreamModel>`
    let forwardBuffer = rawBuffer;
    if (
      extractedModel &&
      extractedModel.includes("/") &&
      upstreamModel &&
      rawContentType.includes("multipart/form-data")
    ) {
      forwardBuffer = replaceUtf8SequenceInBuffer(rawBuffer, extractedModel, upstreamModel);
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
        signal: AbortSignal.timeout(Number(storage.getSettings().timeoutMs) || 120_000),
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
    if (!enforceRouterKeyAccess(res, routerKey, [`${provider.slug}/search`])) {
      return;
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
        signal: AbortSignal.timeout(Number(storage.getSettings().timeoutMs) || 120_000),
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

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
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
    if (!enforceRouterKeyAccess(res, routerKey, [`${provider.slug}/fetch`])) {
      return;
    }

    const dnsCheck = await checkResolvedHostForSSRF(parsedTarget.hostname);
    if (!dnsCheck.ok) {
      return sendV1Error(res, 400, `SSRF guard: ${dnsCheck.reason}`);
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

      const fetchTimeoutMs = Number(storage.getSettings().timeoutMs) || 120_000;
      let upstreamRes = await fetch(reqUrl, {
        method: reqMethod,
        signal: AbortSignal.timeout(fetchTimeoutMs),
        headers: reqHeaders,
        ...(reqBody ? { body: reqBody } : {}),
        ...(dispatcher ? { dispatcher } : {})
      });

      // Fallback to /scrape if mock upstream only implements /scrape
      if (upstreamRes.status === 404 && !reqUrl.endsWith("/scrape")) {
        await upstreamRes.body?.cancel?.().catch(() => {});
        upstreamRes = await fetch(`${baseUrl}/scrape`, {
          method: "POST",
          signal: AbortSignal.timeout(fetchTimeoutMs),
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
        voices: Object.hasOwn(catalog, providerFilter) ? catalog[providerFilter] : catalog.openai
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
    if (
      !enforceRouterKeyAccess(res, routerKey, [
        `${provider.slug}/${upstreamModel}`,
        comboNameOrNull(storage, body.model)
      ])
    ) {
      return;
    }
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
        signal: AbortSignal.timeout(Number(storage.getSettings().timeoutMs) || 120_000),
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
