import { nanoid } from "nanoid";
import {
  PRESETS,
  buildUpstreamUrl,
  getPreset,
  isKeyOptionalProvider,
  isLocalUrl
} from "./presets.js";
import {
  catalogChatModelIds,
  explainCloudCode429,
  fetchGeminiCliQuota,
  getCloudCodeFlavorForKey,
  loadGeminiCliProject,
  mergeCloudCodeUsage,
  parseAntigravityModelCatalog,
  parseCloudCodeRateLimit,
  resolveCatalogModel,
  syncProviderModelsWithCatalog
} from "./geminiCliOAuth.js";
import {
  KIMI_CODING_BASE_URL,
  aggregateCodexResponsesStream,
  buildClaudeOAuthMessagesRequest,
  buildCodexOAuthRequest,
  buildKimiHeaders,
  codexSseEventToOpenAIChunk,
  getClaudeFallbackCandidates,
  isClaudeOAuthKey,
  isCodexOAuthKey,
  isKimiOAuthKey
} from "./oauthFlows.js";
import {
  aggregateCloudCodeStream,
  buildCloudCodeRequest,
  cloudCodeChunkToOpenAI,
  cloudCodeToOpenAIResponse,
  unwrapCloudCodeResponse
} from "./geminiCliTranslator.js";
import { isRouterKeyModelAllowed, sanitizeSecrets } from "./auth.js";
import {
  applyCavemanMode,
  applyCustomPrompt,
  applyHeadroomCompression,
  applyPonytailMode,
  applyTokenSaver,
  isTokenSaverBypassed
} from "./tokenSaver.js";
import { calculateRequestCost, getMergedPricingMap } from "./pricing.js";
import {
  getDefaultUpstreamDispatcher,
  getProxyDispatcher,
  upstreamFetch
} from "./proxy.js";
import {
  resolveAuthContextForKey,
  resolveAuthSecretForKey,
  setDefaultOAuthStorage
} from "./serviceAccountAuth.js";
import {
  claudeToOpenAIRequest,
  claudeToOpenAIResponse,
  createClaudeToOpenAIStreamTransformer,
  createOpenAIToClaudeStreamTransformer,
  createOpenAIToResponsesStreamTransformer,
  createSSEParser,
  openaiToClaudeRequest,
  openaiToClaudeResponse,
  openAIToResponsesResponse,
  responsesToOpenAIRequest
} from "./translator.js";

export { resolveAuthContextForKey, resolveAuthSecretForKey };
export const COOLDOWN_MS = 60_000;

/**
 * Best-effort caller IP for request logs (to trace who used the router). On Vercel the edge sets
 * `x-real-ip` and clients cannot forge it; elsewhere `req.ip`, which only honours forwarding
 * headers when ROUTER001_TRUST_PROXY is set.
 * @param {import("express").Request} req
 * @returns {string}
 */
function requestClientIp(req) {
  if (process.env.VERCEL) {
    const real = req.headers?.["x-real-ip"];
    if (typeof real === "string" && real.trim()) return real.trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || "").slice(0, 64);
}

/** Upper bound for a Cloud Code cooldown taken from Google's quota reset time. */
const MAX_CLOUD_CODE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** A stored Antigravity model catalog older than this is re-read before refusing a model. */
const CLOUD_CODE_CATALOG_RECHECK_MS = 60 * 60 * 1000;
/**
 * Strike breaker (same idea as the reference router, #3681): Google can keep answering 429 while
 * its quota API still reports quota left. After this many such 429s for one key+model within the
 * window, pause that pair instead of hammering Google.
 */
const CLOUD_CODE_STRIKE_LIMIT = 3;
const CLOUD_CODE_STRIKE_WINDOW_MS = 60_000;
const CLOUD_CODE_STRIKE_PAUSE_MS = 15 * 60_000;
/**
 * A 429 while quota is left triggers one bare test chat to the same model (explainCloudCode429
 * `isolate`); its result is reused for this long per key+model instead of testing again.
 */
const CLOUD_CODE_PROBE_TTL_MS = 10 * 60_000;
const CLOUD_CODE_PROBE_CACHE_MAX = 500;

/**
 * Parse a direct `"providerSlug/upstreamModel"` target on the first `/`.
 * Supports models with slashes like `"openrouter/anthropic/claude-3.5-sonnet"`.
 * @param {string} modelStr
 * @returns {{ raw: string, providerSlug: string, upstreamModel: string } | null}
 */
export function parseDirectTarget(modelStr) {
  if (typeof modelStr !== "string") return null;
  const idx = modelStr.indexOf("/");
  if (idx <= 0 || idx === modelStr.length - 1) return null;
  return {
    raw: modelStr,
    providerSlug: modelStr.slice(0, idx),
    upstreamModel: modelStr.slice(idx + 1)
  };
}

/**
 * Check whether an upstream HTTP status should trigger key/target retry & fallback.
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
  return (
    status === 429 ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    (status >= 500 && status <= 599)
  );
}

/**
 * Check whether an upstream HTTP status should place the specific API key into 60s cooldown.
 * @param {number} status
 * @returns {boolean}
 */
export function shouldCooldownKey(status) {
  return status === 429 || status === 401 || status === 402 || status === 403;
}

// 429 bodies that mean the whole ACCOUNT/KEY is unusable (billing, credits, inactive account),
// as opposed to a per-model rate limit / capacity limit.
const ACCOUNT_LEVEL_429_RE =
  /quota|billing|insufficient|credit|balance|payment|account (is )?(not active|inactive|suspended|disabled)|top[- ]?up/i;

/**
 * Decide how wide an upstream failure's cooldown should be.
 * - 401/402/403 and account-level 429 (billing, credits…): the whole key is unusable -> "key".
 * - Any other 429 (RPM/TPM or per-model capacity): only this key+model pair -> "model",
 *   so other models on the same key/account keep working.
 * - Everything else: no cooldown.
 * @param {number} status
 * @param {string} [message]
 * @returns {"key" | "model" | null}
 */
export function getCooldownScope(status, message = "") {
  if (status === 401 || status === 402 || status === 403) return "key";
  if (status === 429) return ACCOUNT_LEVEL_429_RE.test(String(message || "")) ? "key" : "model";
  return null;
}

/**
 * Extract a human-readable error message from an upstream error payload.
 * @param {string} rawText
 * @param {number} status
 * @returns {string}
 */
function extractUpstreamErrorMessage(rawText, status) {
  if (!rawText) return `Upstream returned HTTP ${status}`;
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed) && parsed[0]?.error?.message) return parsed[0].error.message;
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // non-JSON body
  }
  return rawText.slice(0, 500);
}

const STREAM_OPTIONS_UNSUPPORTED_PRESETS = new Set([
  "mistral",
  "cerebras",
  "sambanova",
  "cloudflare",
  "cohere",
  "perplexity"
]);

const MERGE_SYSTEM_PRESETS = new Set([
  "gemini",
  "mistral",
  "deepseek",
  "perplexity",
  "cohere"
]);

const GEMINI_OPENAI_ALLOWED_KEYS = new Set([
  "model",
  "messages",
  "temperature",
  "top_p",
  "max_tokens",
  "stop",
  "stream",
  "stream_options",
  "n",
  "tools",
  "tool_choice",
  "response_format",
  "reasoning_effort"
]);

function stripSchemaMeta(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSchemaMeta);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "$schema" || k === "$id" || k === "$comment") continue;
    out[k] = stripSchemaMeta(v);
  }
  return out;
}

/**
 * Normalize & sanitize an OpenAI-format upstream payload for cross-provider compatibility
 * (fixes Cline/Cursor/Continue/Claude Code incompatibilities across Gemini, OpenAI o1/o3/o4/gpt-5,
 * Groq, DeepSeek, Mistral, Cerebras, Together, Ollama, and custom OpenAI-compatible endpoints).
 * @param {any} payload
 * @param {any} provider
 * @param {string} upstreamModel
 */
export function sanitizeUpstreamPayload(payload, provider, upstreamModel) {
  if (!payload || typeof payload !== "object") return payload;
  const preset = String(provider?.preset || provider?.slug || "").toLowerCase();
  const formatType = String(provider?.formatType || "openai").toLowerCase();
  const baseUrl = String(provider?.baseUrl || "").toLowerCase();
  const modelLower = String(upstreamModel || payload.model || "").toLowerCase();

  const isOpenRouter = preset === "openrouter" || baseUrl.includes("openrouter.ai");
  const isNousResearch =
    preset === "nous" || baseUrl.includes("inference-api.nousresearch.com");
  const isOfficialOpenAI =
    preset === "openai" || baseUrl.includes("api.openai.com");
  const isGeminiOpenAI =
    formatType === "gemini-openai" ||
    preset === "gemini" ||
    baseUrl.includes("generativelanguage.googleapis.com");
  const isOpenAIReasoning =
    isOfficialOpenAI && /^(o1|o3|o4|gpt-5)([-./]|$)/i.test(modelLower);

  const out = { ...payload, model: upstreamModel || payload.model };
  if (isNousResearch) {
    if (!out.product) out.product = "9router";
    if (!out.client) out.client = "9router";
    if (!out.user) out.user = "9router";
  }

  // Strip OpenRouter/client-specific meta fields on non-OpenRouter upstreams
  if (!isOpenRouter) {
    delete out.transforms;
    delete out.route;
    delete out.provider;
    delete out.include_reasoning;
    delete out.prompt_cache_key;
    if (out.reasoning && typeof out.reasoning === "object") {
      if (!out.reasoning_effort && typeof out.reasoning.effort === "string") {
        out.reasoning_effort = out.reasoning.effort;
      }
      delete out.reasoning;
    }
  }

  // `stream_options` is invalid on non-streaming requests across ALL OpenAI-compat providers
  if (out.stream !== true) {
    delete out.stream_options;
  } else if (STREAM_OPTIONS_UNSUPPORTED_PRESETS.has(preset)) {
    delete out.stream_options;
  }

  // Normalize max_tokens <-> max_completion_tokens
  if (isOpenAIReasoning) {
    if (out.max_tokens !== undefined && out.max_completion_tokens === undefined) {
      out.max_completion_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    if (/^(o1|o3|o4)([-./]|$)/i.test(modelLower)) {
      delete out.temperature;
      delete out.top_p;
    }
  } else if (!isOfficialOpenAI && !isOpenRouter) {
    if (out.max_completion_tokens !== undefined && out.max_tokens === undefined) {
      out.max_tokens = out.max_completion_tokens;
    }
    delete out.max_completion_tokens;
  }

  // Sanitize messages: strip Anthropic `cache_control`, map `developer` -> `system`, fix null content
  if (Array.isArray(out.messages)) {
    let normalizedMsgs = out.messages
      .filter((m) => m && typeof m === "object")
      .map((m) => {
        const msg = { ...m };
        delete msg.cache_control;

        if (msg.role === "developer" && !isOfficialOpenAI && !isOpenRouter) {
          msg.role = "system";
        }

        if (Array.isArray(msg.content)) {
          const cleanedParts = msg.content
            .filter((p) => p && typeof p === "object")
            .map((p) => {
              if (!isOpenRouter && "cache_control" in p) {
                const { cache_control: _cc, ...rest } = p;
                return rest;
              }
              return p;
            });
          // Collapse text-only system/tool content arrays to plain string for wider provider support
          if (
            (msg.role === "system" || msg.role === "tool") &&
            cleanedParts.every((p) => p.type === "text" && typeof p.text === "string")
          ) {
            msg.content = cleanedParts.map((p) => p.text).join("\n");
          } else {
            msg.content = cleanedParts;
          }
        } else if (msg.role === "assistant" && msg.content == null && !Array.isArray(msg.tool_calls)) {
          msg.content = "";
        } else if (msg.role === "tool" && typeof msg.content !== "string") {
          msg.content = msg.content == null ? "" : JSON.stringify(msg.content);
        }

        return msg;
      });

    // Merge multiple system messages into a single leading system message for strict providers
    if (isGeminiOpenAI || MERGE_SYSTEM_PRESETS.has(preset)) {
      const sysTexts = [];
      const nonSys = [];
      for (const msg of normalizedMsgs) {
        if (msg.role === "system") {
          const txt =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n")
                : "";
          if (txt.trim()) sysTexts.push(txt);
        } else {
          nonSys.push(msg);
        }
      }
      if (sysTexts.length > 0) {
        normalizedMsgs = [{ role: "system", content: sysTexts.join("\n\n") }, ...nonSys];
      } else {
        normalizedMsgs = nonSys;
      }
    }

    out.messages = normalizedMsgs;
  }

  // Sanitize tools & tool_choice
  if (Array.isArray(out.tools)) {
    if (out.tools.length === 0) {
      delete out.tools;
      delete out.tool_choice;
    } else {
      out.tools = out.tools.map((t) => {
        if (!t || typeof t !== "object") return t;
        const copy = { ...t };
        if (!isOpenRouter) delete copy.cache_control;
        if (isGeminiOpenAI && copy.function && typeof copy.function === "object") {
          copy.function = {
            ...copy.function,
            ...(copy.function.parameters
              ? { parameters: stripSchemaMeta(copy.function.parameters) }
              : {})
          };
        }
        return copy;
      });
    }
  } else if (out.tool_choice !== undefined) {
    delete out.tool_choice;
  }

  // Strict field allowlist for Google Gemini OpenAI-compatible endpoint
  if (isGeminiOpenAI) {
    const filtered = {};
    for (const [k, v] of Object.entries(out)) {
      if (GEMINI_OPENAI_ALLOWED_KEYS.has(k) && v !== undefined) {
        filtered[k] = v;
      }
    }
    return filtered;
  }

  return out;
}

function abortableDelay(ms, isAborted) {
  return new Promise((resolve) => {
    if (isAborted()) return resolve();
    const t = setTimeout(resolve, ms);
    const check = setInterval(() => {
      if (isAborted()) {
        clearTimeout(t);
        clearInterval(check);
        resolve();
      }
    }, 100);
    setTimeout(() => clearInterval(check), ms + 50);
  });
}

/**
 * Build upstream HTTP headers using official provider credentials and optional official headers
 * (such as `x-goog-user-project` for Google OAuth). Never performs client spoofing.
 * @param {any} provider
 * @param {string} apiKey
 * @param {string | undefined} clientAnthropicVersion
 * @param {Record<string, string>} [extraHeaders]
 */
export function buildUpstreamHeaders(provider, apiKey, clientAnthropicVersion, extraHeaders = {}) {
  const headers = {
    ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
    "content-type": "application/json"
  };

  const presetDef = provider?.preset ? getPreset(provider.preset) : null;
  const formatChanged = Boolean(
    presetDef?.formatType &&
    provider?.formatType &&
    provider.formatType !== presetDef.formatType
  );
  const authStyle =
    provider?.authStyle ||
    (!formatChanged ? presetDef?.authStyle : undefined) ||
    (provider?.formatType === "anthropic" ? "x-api-key" : "bearer");

  const hasAuthOverride = Boolean(headers.authorization || headers.Authorization);
  if (apiKey && !hasAuthOverride) {
    if (authStyle === "api-key") {
      headers["api-key"] = apiKey;
    } else if (authStyle === "x-api-key") {
      headers["x-api-key"] = apiKey;
    } else if (authStyle !== "none") {
      headers["authorization"] = `Bearer ${apiKey}`;
    }
  }

  if (provider?.formatType === "anthropic") {
    headers["anthropic-version"] = clientAnthropicVersion || "2023-06-01";
  }

  return headers;
}

/**
 * Build an alternate authentication header set (swapping `x-api-key` <-> `Authorization: Bearer`)
 * for third-party OpenAI/Anthropic-compatible relays that require the other header style.
 * Returns null if no alternate header can be derived.
 * @param {Record<string, string>} headers
 * @param {string} apiKey
 * @returns {Record<string, string> | null}
 */
export function buildAlternateAuthHeaders(headers, apiKey) {
  if (!apiKey || !headers || typeof headers !== "object") return null;
  const next = { ...headers };
  if (next["x-api-key"] && !next["authorization"]) {
    delete next["x-api-key"];
    next["authorization"] = `Bearer ${apiKey}`;
    return next;
  }
  if (next["authorization"] && !next["x-api-key"]) {
    delete next["authorization"];
    next["x-api-key"] = apiKey;
    if (!next["anthropic-version"]) {
      next["anthropic-version"] = "2023-06-01";
    }
    return next;
  }
  return null;
}

/**
 * Create a streaming SSE transformer matching `(clientFormat, upstreamFormat)`.
 * Composes Claude->OpenAI->Responses cleanly when Responses API targets an Anthropic upstream.
 */
function createStreamTransformer(clientFormat, upstreamFormat, requestedModel) {
  if (clientFormat === "openai-responses") {
    const respTx = createOpenAIToResponsesStreamTransformer(requestedModel);
    if (upstreamFormat === "openai") {
      return {
        mode: "openai",
        pushChunk: (chunk) => respTx.pushChunk(chunk),
        finalize: () => respTx.finalize(),
        getUsage: () => respTx.getUsage()
      };
    }

    const claudeToOpenAI = createClaudeToOpenAIStreamTransformer(requestedModel);
    let bufferedOut = "";
    const innerParser = createSSEParser(({ data }) => {
      if (!data) return;
      if (data === "[DONE]") {
        bufferedOut += respTx.finalize();
        return;
      }
      try {
        bufferedOut += respTx.pushChunk(JSON.parse(data));
      } catch {
        // ignore malformed intermediate SSE chunk
      }
    });

    return {
      mode: "anthropic",
      pushEvent(event, parsed) {
        bufferedOut = "";
        const openaiSse = claudeToOpenAI.pushEvent(event, parsed);
        if (openaiSse) innerParser.feed(openaiSse);
        return bufferedOut;
      },
      finalize() {
        bufferedOut = "";
        const tail = claudeToOpenAI.finalize();
        if (tail) innerParser.feed(tail);
        innerParser.flush();
        bufferedOut += respTx.finalize();
        return bufferedOut;
      },
      getUsage() {
        const u1 = claudeToOpenAI.getUsage();
        const u2 = respTx.getUsage();
        return {
          promptTokens: u2.promptTokens || u1.promptTokens || 0,
          completionTokens: u2.completionTokens || u1.completionTokens || 0
        };
      }
    };
  }

  if (clientFormat === "anthropic" && upstreamFormat === "openai") {
    const tx = createOpenAIToClaudeStreamTransformer(requestedModel);
    return {
      mode: "openai",
      pushChunk: (chunk) => tx.pushChunk(chunk),
      finalize: () => tx.finalize(),
      getUsage: () => tx.getUsage()
    };
  }

  const tx = createClaudeToOpenAIStreamTransformer(requestedModel);
  return {
    mode: "anthropic",
    pushEvent: (event, parsed) => tx.pushEvent(event, parsed),
    finalize: () => tx.finalize(),
    getUsage: () => tx.getUsage()
  };
}

/**
 * Format an error payload matching either OpenAI or Anthropic error envelopes.
 * @param {import("express").Response} res
 * @param {"openai" | "anthropic"} clientFormat
 * @param {number} status
 * @param {string} message
 * @param {string} [type]
 */
function sendClientError(res, clientFormat, status, message, type = "api_error") {
  if (res.headersSent || res.writableEnded) return;
  if (clientFormat === "anthropic") {
    const mappedType =
      status === 401
        ? "authentication_error"
        : status === 429
          ? "rate_limit_error"
          : status === 400
            ? "invalid_request_error"
            : type;
    res.status(status).json({
      type: "error",
      error: {
        type: mappedType,
        message
      }
    });
    return;
  }

  const mappedType =
    status === 401
      ? "authentication_error"
      : status === 400
        ? "invalid_request_error"
        : type;
  res.status(status).json({
    error: {
      message,
      type: mappedType
    }
  });
}

export class RouterService {
  /**
   * @param {import("./storage.js").Storage} storage
   * @param {{
   *   appLocals?: Record<string, any>,
   *   serviceAccountFetchImpl?: typeof globalThis.fetch,
   *   serviceAccountTokenUri?: string,
   *   allowLoopbackTokenUri?: boolean
   * }} [options]
   */
  constructor(storage, options = {}) {
    this.storage = storage;
    setDefaultOAuthStorage(storage);
    this.options = options || {};
    this.liveEvents = options?.liveEvents || options?.appLocals?.liveEvents || null;
    /** @type {Map<string, number>} */
    this.rrCursors = new Map();
    /** `${providerId}|${keyId}|${model}` -> cooldown-until epoch ms (per-model 429s, not persisted). */
    this.modelCooldowns = new Map();
    /** Same key as modelCooldowns -> why it is cooling down (shown while the cooldown lasts). */
    this.modelCooldownNotes = new Map();
    /** Same key as modelCooldowns -> { count, since } of Cloud Code 429s while quota was left. */
    this.cloudCodeStrikes = new Map();
    /** Same key as modelCooldowns -> { at, probe } result of the bare test chat after such a 429. */
    this.cloudCodeProbes = new Map();
    /** @type {Map<string, { idx: number, count: number }>} */
    this.stickyCursors = new Map();
    /** @type {Map<string, number>} */
    this.comboCursors = new Map();
    /** @type {Map<string, number>} */
    this.adapterCursors = new Map();
  }

  /**
   * Detect required multimodal input capabilities (`vision`, `audioInput`) in an OpenAI or Anthropic body.
   * @param {any} body
   * @returns {string[]}
   */
  detectRequiredCapabilities(body) {
    const caps = new Set();
    const msgs = Array.isArray(body?.messages) ? body.messages : [];
    for (const m of msgs) {
      if (!m || !Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "image_url" || block.type === "image") {
          caps.add("vision");
        } else if (block.type === "input_audio" || block.type === "audio") {
          caps.add("audioInput");
        }
      }
    }
    return [...caps];
  }

  /**
   * Check whether a target `{ providerSlug, upstreamModel }` supports a modality capability.
   * @param {{ providerSlug: string, upstreamModel: string }} target
   * @param {string} cap
   */
  targetSupportsCapability(target, cap) {
    const provider = this.storage.getProviderBySlug(target.providerSlug);
    const presetDef = provider ? getPreset(provider.preset) : getPreset(target.providerSlug);
    const modelId = String(target.upstreamModel || "").toLowerCase();

    if (presetDef?.modelCatalog) {
      const found = presetDef.modelCatalog.find(
        (m) => m.id?.toLowerCase() === modelId
      );
      if (found) {
        if (cap === "vision") return Boolean(found.vision || found.kind === "vision");
        if (cap === "audioInput") return Boolean(found.audioInput || /audio|omni|gemini-2|gemini-3|gemini-4/i.test(modelId));
      }
    }

    if (cap === "vision") {
      return /(gpt-4o|gpt-4\.1|gpt-5|gpt-6|claude-3|claude-sonnet-4|claude-opus-4|claude-sonnet-5|claude-fable|gemini-|vision|-vl|pixtral|llama-4|grok-2-vision|grok-3|grok-4)/i.test(
        modelId
      );
    }
    if (cap === "audioInput") {
      return /(audio|gpt-4o-audio|gemini-2|gemini-3|gemini-4|omni)/i.test(modelId);
    }
    return true;
  }

  /**
   * Prepend Capacity Adapter models if the request needs vision/audio and none of the resolved targets cover it.
   * @param {Array<{ raw: string, providerSlug: string, upstreamModel: string }>} targets
   * @param {string[]} requiredCaps
   * @param {any} settings
   */
  applyCapacityAdapter(targets, requiredCaps, settings) {
    if (!requiredCaps.length || !targets.length) return { targets, adapterUsed: null };
    const adapterCfg = settings?.capacityAdapter || {};
    for (const cap of requiredCaps) {
      if (targets.some((t) => this.targetSupportsCapability(t, cap))) continue;
      const entry = adapterCfg[cap];
      if (!entry || entry.enabled !== true || !Array.isArray(entry.models) || entry.models.length === 0) {
        continue;
      }
      const parsedPool = entry.models.map(parseDirectTarget).filter(Boolean);
      if (parsedPool.length === 0) continue;

      let orderedPool = parsedPool;
      if (entry.roundRobin && parsedPool.length > 1) {
        const cur = this.adapterCursors.get(cap) || 0;
        const start = cur % parsedPool.length;
        this.adapterCursors.set(cap, (start + 1) % parsedPool.length);
        orderedPool = parsedPool.map((_, i) => parsedPool[(start + i) % parsedPool.length]);
      }
      const existingRaw = new Set(targets.map((t) => t.raw));
      const uniqueAdapter = orderedPool.filter((t) => !existingRaw.has(t.raw));
      if (uniqueAdapter.length > 0) {
        return { targets: [...uniqueAdapter, ...targets], adapterUsed: cap };
      }
    }
    return { targets, adapterUsed: null };
  }

  /**
   * Build runtime options for Google Service Account & Google OAuth token exchange
   * (supports offline test overrides).
   */
  getServiceAccountOptions() {
    const locals = this.options.appLocals || {};
    const fetchImpl =
      locals.serviceAccountFetchImpl || this.options.serviceAccountFetchImpl;
    const tokenUriOverride =
      locals.serviceAccountTokenUri || this.options.serviceAccountTokenUri;
    const googleOAuthFetchImpl =
      locals.googleOAuthFetchImpl || this.options.googleOAuthFetchImpl;
    const googleOAuthTokenUrl =
      locals.googleOAuthTokenUrl || this.options.googleOAuthTokenUrl;
    const oauthFetchImpl =
      locals.oauthFetchImpl || this.options.oauthFetchImpl;
    const oauthTokenUrlOverride =
      locals.oauthTokenUrlOverride || this.options.oauthTokenUrlOverride;
    const allowLoopbackTokenUri = Boolean(
      locals.allowLoopbackTokenUri ||
        locals.oauthAllowLoopback ||
        this.options.allowLoopbackTokenUri
    );
    return {
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(tokenUriOverride ? { tokenUriOverride } : {}),
      ...(googleOAuthFetchImpl ? { googleOAuthFetchImpl } : {}),
      ...(googleOAuthTokenUrl ? { googleOAuthTokenUrl } : {}),
      ...(oauthFetchImpl ? { oauthFetchImpl } : {}),
      ...(oauthTokenUrlOverride ? { oauthTokenUrlOverride } : {}),
      allowLoopbackTokenUri
    };
  }

  /**
   * Resolve requested model into an ordered list of `{ providerSlug, upstreamModel }` targets.
   * @param {string} requestedModel
   */
  resolveTargets(requestedModel) {
    if (typeof requestedModel !== "string" || !requestedModel.trim()) {
      return {
        error: {
          status: 400,
          message: "Missing required 'model' field",
          type: "invalid_request_error"
        }
      };
    }

    // Resolve custom Model Aliases (e.g. "fast" -> "groq/llama-3.3-70b-versatile" or a combo name)
    let effectiveModel = requestedModel.trim();
    const aliases = this.storage.getModelAliases?.() || {};
    if (Object.prototype.hasOwnProperty.call(aliases, effectiveModel) && typeof aliases[effectiveModel] === "string") {
      effectiveModel = aliases[effectiveModel].trim();
    }

    const combos = this.storage.getCombos();
    const matchedCombo = combos.find(
      (c) =>
        c.enabled !== false &&
        (c.name === effectiveModel || c.id === effectiveModel)
    );

    if (matchedCombo) {
      const targets = (matchedCombo.targets || [])
        .map(parseDirectTarget)
        .filter(Boolean);
      if (targets.length === 0) {
        return {
          error: {
            status: 400,
            message: `Combo '${matchedCombo.name}' has no valid targets`,
            type: "invalid_request_error"
          }
        };
      }
      const strategy =
        matchedCombo.strategy === "round-robin" ? "round-robin" : "fallback";
      if (strategy === "round-robin" && targets.length > 1) {
        const cursorKey = matchedCombo.id || matchedCombo.name;
        const cursor = this.comboCursors.get(cursorKey) || 0;
        const startIdx = cursor % targets.length;
        this.comboCursors.set(cursorKey, (startIdx + 1) % targets.length);
        const rotated = [];
        for (let i = 0; i < targets.length; i++) {
          rotated.push(targets[(startIdx + i) % targets.length]);
        }
        return { isCombo: true, combo: matchedCombo, targets: rotated };
      }
      return { isCombo: true, combo: matchedCombo, targets };
    }

    const direct = parseDirectTarget(effectiveModel);
    if (!direct) {
      return {
        error: {
          status: 400,
          message: `Invalid model '${requestedModel}'. Use '<providerSlug>/<model>' or an enabled combo name.`,
          type: "invalid_request_error"
        }
      };
    }

    return { isCombo: false, targets: [direct] };
  }

  /**
   * Select active keys for a provider respecting `settings.fallbackStrategy`
   * (`round-robin` default, `fill-first`, or `sticky-round-robin`), skipping keys in cooldown.
   * Local Ollama / LM Studio providers are permitted to operate without an API key.
   * @param {any} provider
   */
  _modelCooldownKey(providerId, keyId, model) {
    return `${providerId}|${keyId}|${model}`;
  }

  /**
   * Latest reason + end of the per-model cooldowns blocking `model` on this provider.
   * @param {any} provider
   * @param {string} model
   * @returns {{ note: string, untilMs: number }}
   */
  _modelCooldownInfo(provider, model, now = Date.now()) {
    let note = "";
    let untilMs = 0;
    for (const k of provider?.apiKeys || []) {
      const mk = this._modelCooldownKey(provider.id, k.id, model);
      const until = this.modelCooldowns.get(mk);
      if (!until || until <= now) continue;
      if (!untilMs || until < untilMs) untilMs = until;
      note = note || this.modelCooldownNotes.get(mk) || "";
    }
    return { note, untilMs };
  }

  /**
   * Clear per-model in-memory cooldowns and Cloud Code strike caches for a provider (or one key).
   * @param {string} providerId
   * @param {string | null} [keyId]
   */
  clearProviderCooldowns(providerId, keyId = null) {
    if (!providerId) return;
    const prefix = keyId ? `${providerId}|${keyId}|` : `${providerId}|`;
    for (const map of [
      this.modelCooldowns,
      this.modelCooldownNotes,
      this.cloudCodeStrikes,
      this.cloudCodeProbes
    ]) {
      if (!map) continue;
      for (const k of [...map.keys()]) {
        if (k.startsWith(prefix)) map.delete(k);
      }
    }
  }

  /**
   * Store a fresh Antigravity model catalog on the key (and align the provider's model list).
   * @param {string} providerId
   * @param {string} keyId
   * @param {{ models: any[], defaultModelId: string }} catalog
   */
  async _storeCloudCodeCatalog(providerId, keyId, catalog) {
    if (!keyId || !catalog?.models?.length) return;
    const at = new Date().toISOString();
    await this.storage
      .update((data) => {
        const p = data.providers.find((x) => x.id === providerId);
        const k = (p?.apiKeys || []).find((x) => x.id === keyId);
        if (!k) return;
        k.oauthMeta = mergeCloudCodeUsage(
          k.oauthMeta,
          { catalogOk: true, models: catalog.models, defaultModelId: catalog.defaultModelId },
          at
        );
        if (syncProviderModelsWithCatalog(p)) p.updatedAt = at;
      })
      .catch(() => {});
  }

  /**
   * Re-read an Antigravity account's model catalog (best effort, 4s) and store it.
   * @returns {Promise<any[]>} the fresh models, or [] when Google did not answer in time
   */
  async _refreshCloudCodeCatalog(provider, keyEntry, accessToken, projectId, opts = {}) {
    let timer;
    try {
      const quota = await Promise.race([
        fetchGeminiCliQuota(accessToken, {
          flavor: "antigravity",
          projectId,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {})
        }).catch(() => null),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 4000);
        })
      ]);
      const catalog = parseAntigravityModelCatalog(quota?.raw);
      if (!catalog.models.length) return [];
      await this._storeCloudCodeCatalog(provider.id, keyEntry.id, catalog);
      return catalog.models;
    } finally {
      clearTimeout(timer);
    }
  }

  isKeyModelCoolingDown(providerId, keyId, model, now = Date.now()) {
    if (!model || !keyId) return false;
    const k = this._modelCooldownKey(providerId, keyId, model);
    const until = this.modelCooldowns.get(k);
    if (!until) return false;
    if (until <= now) {
      this.modelCooldowns.delete(k);
      this.modelCooldownNotes.delete(k);
      return false;
    }
    return true;
  }

  _setBoundedMapEntry(map, key, value, maxEntries = 2000) {
    map.delete(key);
    map.set(key, value);
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  getOrderedActiveKeys(provider, model = null) {
    const enabledKeys = (provider.apiKeys || []).filter((k) => k.enabled !== false);
    if (enabledKeys.length === 0) {
      if (isKeyOptionalProvider(provider)) {
        return {
          keys: [{ id: null, key: "", isAnonymous: true }],
          allInCooldown: false
        };
      }
      return { keys: [], allInCooldown: false };
    }

    const settings = this.storage.getSettings?.() || {};
    const strategy = settings.fallbackStrategy || "round-robin";
    let startIdx = 0;

    if (strategy === "fill-first") {
      startIdx = 0;
    } else if (strategy === "sticky-round-robin") {
      const limit = Math.max(1, Number(settings.stickyRoundRobinLimit) || 3);
      const state = this.stickyCursors.get(provider.id) || { idx: 0, count: 0 };
      startIdx = state.idx % enabledKeys.length;
      state.count += 1;
      if (state.count >= limit) {
        state.idx = (startIdx + 1) % enabledKeys.length;
        state.count = 0;
      }
      this.stickyCursors.set(provider.id, state);
    } else {
      const cursor = this.rrCursors.get(provider.id) || 0;
      startIdx = cursor % enabledKeys.length;
      this.rrCursors.set(provider.id, (startIdx + 1) % enabledKeys.length);
    }

    const rotated = [];
    for (let i = 0; i < enabledKeys.length; i++) {
      rotated.push(enabledKeys[(startIdx + i) % enabledKeys.length]);
    }

    const now = Date.now();
    const active = rotated.filter(
      (k) =>
        (!k.cooldownUntil || k.cooldownUntil <= now) &&
        !this.isKeyModelCoolingDown(provider.id, k.id, model, now)
    );
    if (active.length === 0) {
      return { keys: [], allInCooldown: true };
    }

    return { keys: active, allInCooldown: false };
  }

  /**
   * Collect all plaintext upstream keys across providers so error logs never leak secrets.
   */
  _allSecretKeys() {
    if (typeof this.storage.getRedactionSecrets === "function") {
      return [...this.storage.getRedactionSecrets()];
    }
    const secrets = [];
    for (const p of this.storage.getProviders()) {
      for (const k of p.apiKeys || []) {
        if (k?.key) secrets.push(k.key);
      }
    }
    return secrets;
  }

  /**
   * Handle `/v1/chat/completions` (OpenAI client format).
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  async handleChatCompletions(req, res) {
    return this._handleGeneration(req, res, {
      clientFormat: "openai",
      endpoint: "/v1/chat/completions"
    });
  }

  /**
   * Handle `/v1/messages` (Anthropic client format).
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  async handleMessages(req, res) {
    return this._handleGeneration(req, res, {
      clientFormat: "anthropic",
      endpoint: "/v1/messages"
    });
  }

  /**
   * Handle `/v1/responses` (OpenAI Responses API client format).
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  async handleResponses(req, res) {
    return this._handleGeneration(req, res, {
      clientFormat: "openai-responses",
      endpoint: "/v1/responses"
    });
  }

  /**
   * Handle `/v1/embeddings` (OpenAI client format).
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  async handleEmbeddings(req, res) {
    return this._handleGeneration(req, res, {
      clientFormat: "openai",
      endpoint: "/v1/embeddings",
      isEmbeddings: true
    });
  }

  /**
   * Core routing, translation, key rotation, cooldown, streaming, and logging pipeline.
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {{ clientFormat: "openai" | "anthropic" | "openai-responses", endpoint: string, isEmbeddings?: boolean }} opts
   */
  async _handleGeneration(req, res, opts) {
    const startedAt = Date.now();
    const { clientFormat, endpoint, isEmbeddings = false } = opts;
    const rawBody = req.body && typeof req.body === "object" ? req.body : {};
    const requestedModel = rawBody.model;
    const isStream = !isEmbeddings && rawBody.stream === true;
    const settings = this.storage.getSettings();
    const timeoutMs = settings.timeoutMs || 120000;
    const routerKey = req.routerKey || null;
    const clientIp = requestClientIp(req);

    // Enforce per-key access restrictions if enabled on this Router API Key
    if (routerKey && !isRouterKeyModelAllowed(routerKey, requestedModel)) {
      const denyMsg = `Router key '${routerKey.name}' is not permitted to access model '${requestedModel || ""}'`;
      this.liveEvents?.log("warn", "auth", denyMsg);
      return sendClientError(res, clientFormat, 403, denyMsg, "permission_error");
    }

    const resolution = this.resolveTargets(requestedModel);
    if (resolution.error) {
      await this.storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          clientIp,
          requestedModel: requestedModel || "",
          resolvedModel: requestedModel || "",
          providerSlug: null,
          endpoint,
          status: resolution.error.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          estimatedCost: 0,
          savedChars: 0,
          fallbackHops: 0,
          attemptTrail: [],
          error: resolution.error.message
        },
        routerKey?.id || null
      );
      return sendClientError(
        res,
        clientFormat,
        resolution.error.status,
        resolution.error.message,
        resolution.error.type
      );
    }

    const isResponsesClient = clientFormat === "openai-responses";
    const baseRequestBody = isResponsesClient
      ? responsesToOpenAIRequest(rawBody, requestedModel || "")
      : rawBody;
    const normalizedClientFormat = isResponsesClient ? "openai" : clientFormat;

    // Apply Capacity Adapter (Vision / Audio auto-adapter when target model lacks modality)
    const requiredCaps = isEmbeddings ? [] : this.detectRequiredCapabilities(baseRequestBody);
    const rawAdapted = isEmbeddings
      ? { targets: resolution.targets, adapterUsed: null }
      : this.applyCapacityAdapter(resolution.targets, requiredCaps, settings);
    // Re-enforce per-key model restriction so restricted keys cannot escalate to disallowed adapter models
    let adaptedTargets = rawAdapted.targets;
    let adapterUsed = rawAdapted.adapterUsed;
    if (routerKey?.access?.restricted === true && adapterUsed) {
      const origSet = new Set(resolution.targets.map((t) => t.raw));
      const allowedTargets = rawAdapted.targets.filter(
        (t) => origSet.has(t.raw) || isRouterKeyModelAllowed(routerKey, t.raw)
      );
      if (allowedTargets.length === resolution.targets.length) {
        adapterUsed = null;
      }
      adaptedTargets = allowedTargets;
    }

    // Apply Token Saver stack (RTK -> Headroom -> Caveman -> Ponytail -> Custom Prompt), unless bypassed via header
    const bypassTokenSaver = isEmbeddings || isTokenSaverBypassed(req);
    let workingBody = baseRequestBody;
    let savedChars = 0;
    let rtkFilters = [];
    let headroomApplied = false;
    let cavemanApplied = false;
    let ponytailApplied = false;
    let customPromptApplied = false;

    if (!bypassTokenSaver) {
      const rtkRes = applyTokenSaver(workingBody, normalizedClientFormat, settings);
      workingBody = rtkRes.body;
      savedChars = rtkRes.savedChars;
      rtkFilters = rtkRes.filters || [];

      if (settings.headroomEnabled) {
        const hrRes = await applyHeadroomCompression(workingBody, normalizedClientFormat, settings, {
          fetchImpl: this.options?.appLocals?.headroomFetchImpl
        });
        workingBody = hrRes.body;
        headroomApplied = hrRes.headroomApplied;
        if (hrRes.tokensSaved > 0) savedChars += hrRes.tokensSaved * 4;
      }

      const caveRes = applyCavemanMode(workingBody, normalizedClientFormat, settings);
      workingBody = caveRes.body;
      cavemanApplied = caveRes.cavemanApplied;

      const ponyRes = applyPonytailMode(workingBody, normalizedClientFormat, settings);
      workingBody = ponyRes.body;
      ponytailApplied = ponyRes.ponytailApplied;

      const customRes = applyCustomPrompt(workingBody, normalizedClientFormat, settings);
      workingBody = customRes.body;
      customPromptApplied = customRes.customPromptApplied;
    }
    const savedBody = workingBody;

    if (savedChars > 0 || cavemanApplied || ponytailApplied || headroomApplied || adapterUsed) {
      const tags = [];
      if (savedChars > 0) tags.push(`RTK:-${savedChars}ch${rtkFilters.length ? `[${rtkFilters.join(",")}]` : ""}`);
      if (headroomApplied) tags.push("Headroom");
      if (cavemanApplied) tags.push(`Caveman:${settings.cavemanLevel || "full"}`);
      if (ponytailApplied) tags.push(`Ponytail:${settings.ponytailLevel || "full"}`);
      if (customPromptApplied) tags.push("CustomPrompt");
      if (adapterUsed) tags.push(`CapacityAdapter:${adapterUsed}`);
      this.liveEvents?.log("info", "token-saver", `${requestedModel} -> ${tags.join(" | ")}`);
    }

    let clientAborted = false;
    let responseCompleted = false;
    /** @type {AbortController | null} */
    let activeController = null;

    const onClientAbort = () => {
      if (!responseCompleted && !res.writableFinished) {
        clientAborted = true;
        if (activeController) {
          activeController.abort();
        }
      }
    };

    req.on("aborted", onClientAbort);
    res.on("close", onClientAbort);

    const attemptTrail = [];
    let finalTarget = null;
    let lastErrorStatus = 502;
    let lastErrorMessage = "No available upstream targets";
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let finalStatus = 502;
    let hasSentBytesToClient = false;
    const pricingMap = getMergedPricingMap(
      PRESETS,
      this.storage.getCustomPricing?.() || {},
      this.storage.getCustomPricingVersion?.() ?? -1
    );

    const clientAnthropicVersion =
      typeof req.headers["anthropic-version"] === "string"
        ? req.headers["anthropic-version"]
        : undefined;

    try {
      outerLoop: for (let targetIdx = 0; targetIdx < adaptedTargets.length; targetIdx++) {
        const target = adaptedTargets[targetIdx];
        if (clientAborted) break;

        const provider = this.storage.getProviderBySlug(target.providerSlug);
        if (!provider || provider.enabled === false) {
          attemptTrail.push({
            target: target.raw,
            providerSlug: target.providerSlug,
            model: target.upstreamModel,
            keyId: null,
            status: 404,
            latencyMs: 0,
            error: !provider
              ? `Provider '${target.providerSlug}' not found`
              : `Provider '${target.providerSlug}' is disabled`
          });
          lastErrorStatus = !provider ? 404 : 503;
          lastErrorMessage = attemptTrail[attemptTrail.length - 1].error;
          continue;
        }

        if (this.storage.isModelDisabled?.(provider.slug, target.upstreamModel)) {
          const msg = `Model '${target.raw}' is disabled`;
          attemptTrail.push({
            target: target.raw,
            providerSlug: provider.slug,
            model: target.upstreamModel,
            keyId: null,
            status: 403,
            latencyMs: 0,
            error: msg
          });
          lastErrorStatus = 403;
          lastErrorMessage = msg;
          continue;
        }

        if (isEmbeddings && provider.formatType === "anthropic") {
          attemptTrail.push({
            target: target.raw,
            providerSlug: target.providerSlug,
            model: target.upstreamModel,
            keyId: null,
            status: 400,
            latencyMs: 0,
            error: "Embeddings are not supported by Anthropic providers"
          });
          lastErrorStatus = 400;
          lastErrorMessage = "Embeddings are not supported by Anthropic providers";
          continue;
        }

        const keySelection = this.getOrderedActiveKeys(provider, target.upstreamModel);
        if (keySelection.keys.length === 0) {
          const cooldownInfo = keySelection.allInCooldown
            ? this._modelCooldownInfo(provider, target.upstreamModel)
            : { note: "", untilMs: 0 };
          const retryHint = cooldownInfo.untilMs
            ? `retry after ${new Date(cooldownInfo.untilMs).toISOString().replace(/\.\d{3}Z$/, "Z")}`
            : "retry after ~60s";
          const msg = keySelection.allInCooldown
            ? `All API keys for provider '${provider.slug}' are in cooldown for model '${target.upstreamModel}' (rate-limited or account-level error; ${retryHint} or pick another model)${
                cooldownInfo.note ? `. Last upstream answer: ${cooldownInfo.note}` : ""
              }`
            : `No active API keys configured for provider '${provider.slug}'`;
          attemptTrail.push({
            target: target.raw,
            providerSlug: provider.slug,
            model: target.upstreamModel,
            keyId: null,
            status: keySelection.allInCooldown ? 429 : 503,
            latencyMs: 0,
            error: msg
          });
          lastErrorStatus = keySelection.allInCooldown ? 429 : 503;
          lastErrorMessage = msg;
          continue;
        }

        const upstreamFormat =
          provider.formatType === "anthropic" ? "anthropic" : "openai";

        // Prepare translated or passthrough upstream payload
        let upstreamPayload;
        if (isEmbeddings) {
          upstreamPayload = { ...savedBody, model: target.upstreamModel };
        } else if (normalizedClientFormat === upstreamFormat) {
          upstreamPayload =
            upstreamFormat === "openai"
              ? sanitizeUpstreamPayload(savedBody, provider, target.upstreamModel)
              : { ...savedBody, model: target.upstreamModel };
        } else if (normalizedClientFormat === "anthropic" && upstreamFormat === "openai") {
          upstreamPayload = sanitizeUpstreamPayload(
            claudeToOpenAIRequest(savedBody, target.upstreamModel),
            provider,
            target.upstreamModel
          );
        } else {
          upstreamPayload = openaiToClaudeRequest(savedBody, target.upstreamModel);
        }

        const upstreamPath = isEmbeddings
          ? "embeddings"
          : upstreamFormat === "anthropic"
            ? "messages"
            : "chat/completions";
        const upstreamUrl = buildUpstreamUrl(
          provider.baseUrl,
          provider.formatType,
          upstreamPath
        );

        const allowSingleKeyTransientRetry =
          adaptedTargets.length === 1 && keySelection.keys.length === 1;
        let cachedUpstreamBody = null;
        const getUpstreamBody = () => {
          if (cachedUpstreamBody === null) {
            cachedUpstreamBody = JSON.stringify(upstreamPayload);
          }
          return cachedUpstreamBody;
        };

        for (let keyIdx = 0; keyIdx < keySelection.keys.length; keyIdx++) {
          const keyEntry = keySelection.keys[keyIdx];
          if (clientAborted) break outerLoop;
          const hasFallbackRemaining =
            keyIdx + 1 < keySelection.keys.length || targetIdx + 1 < adaptedTargets.length;

          const maxAttemptsForKey = allowSingleKeyTransientRetry ? 2 : 1;
          for (let keyAttempt = 0; keyAttempt < maxAttemptsForKey; keyAttempt++) {
            if (clientAborted) break outerLoop;

            const attemptStart = Date.now();
            const controller = new AbortController();
            activeController = controller;
            let timedOut = false;
            const timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs);

            const proxyDispatcher = getProxyDispatcher(provider, this.storage);
            const dispatcher = proxyDispatcher || getDefaultUpstreamDispatcher();
            let resolvedSecret = "";
            let markedActive = false;

            try {
              const authCtx = await resolveAuthContextForKey(keyEntry, {
                ...this.getServiceAccountOptions(),
                ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {})
              });
              resolvedSecret = authCtx.secret;
              const headers = buildUpstreamHeaders(
                provider,
                resolvedSecret,
                clientAnthropicVersion,
                authCtx.extraHeaders
              );
              this.liveEvents?.markRequestStart(provider.slug, {
                model: target.upstreamModel
              });
              markedActive = true;

              // Gemini CLI / Antigravity (Cloud Code Assist) keys speak a different wire format:
              // the payload is wrapped in a Cloud Code envelope and the endpoint is
              // `v1internal:generateContent`. The flavor picks host, headers and envelope dialect.
              const cloudCodeFlavor = isEmbeddings ? null : getCloudCodeFlavorForKey(keyEntry);
              const isGeminiCliKey = Boolean(cloudCodeFlavor);
              const cloudCodeFetch =
                (isGeminiCliKey && this.options?.appLocals?.cloudCodeFetchImpl) || null;
              let effectiveUrl = upstreamUrl;
              /** Project + upstream model actually sent, for explaining a Cloud Code 429. */
              let cloudCodeCtx = null;
              /** Parsed Cloud Code envelope kept for systemInstruction-stripped 429 retry. */
              let cloudCodeEnvelope = null;
              /** A non-streaming client served from the streaming Cloud Code RPC. */
              let cloudCodeFoldStream = false;
              let effectiveBody = null;
              let effectiveHeaders = headers;
              if (isGeminiCliKey) {
                let cloudProject =
                  keyEntry?.oauthMeta?.projectId ||
                  keyEntry?.oauthCredentials?.projectId ||
                  "";

                // An empty project means the account was never onboarded to Cloud Code Assist;
                // sending the envelope anyway makes Google answer 403 "You do not have a valid
                // license of this product" (#3501). Provision once, persist, then continue.
                if (!cloudProject) {
                  try {
                    const plan = await loadGeminiCliProject(resolvedSecret, {
                      ...(dispatcher ? { dispatcher } : {}),
                      ...(cloudCodeFetch ? { fetchImpl: cloudCodeFetch } : {}),
                      flavor: cloudCodeFlavor.id
                    });
                    cloudProject = plan.projectId || "";
                    if (cloudProject && keyEntry?.id) {
                      await this.storage.update((data) => {
                        const p = data.providers.find((x) => x.id === provider.id);
                        const k = (p?.apiKeys || []).find((x) => x.id === keyEntry.id);
                        if (!k) return;
                        k.oauthMeta = {
                          ...(k.oauthMeta || {}),
                          projectId: cloudProject,
                          tier: plan.tier,
                          tierLabel: plan.tierLabel
                        };
                      });
                    }
                  } catch {
                    // Fall through to the explicit failure below.
                  }
                }

                // Never send a project-less envelope: Google answers 403 #3501 and the user
                // cannot tell it apart from a broken key.
                if (!cloudProject) {
                  const msg =
                    cloudCodeFlavor.id === "antigravity"
                      ? "Antigravity account has no Cloud Code project yet. Google did not provision one (onboardUser returned no project). Sign in again with 'Đăng nhập Antigravity' and run the diagnostics on that card; if it still fails, this Google account is not eligible for Antigravity."
                      : "Gemini CLI account has no Cloud Code Assist project yet. Google did not provision one (onboardUser returned no project). Open Providers -> Google Gemini, sign in again with 'Đăng nhập Gemini CLI', then retry. If it still fails, this Google account is not eligible for Cloud Code Assist.";
                  clearTimeout(timer);
                  this.liveEvents?.markRequestEnd(provider.slug, {
                    model: `${provider.slug}/${target.upstreamModel}`,
                    status: 403,
                    latencyMs: Date.now() - attemptStart,
                    error: msg
                  });
                  markedActive = false;
                  attemptTrail.push({
                    target: target.raw,
                    providerSlug: provider.slug,
                    model: target.upstreamModel,
                    keyId: keyEntry.id,
                    status: 403,
                    latencyMs: Date.now() - attemptStart,
                    error: msg
                  });
                  lastErrorStatus = 403;
                  lastErrorMessage = msg;
                  break;
                }

                // Antigravity plans differ per account and over time. Google answers a model that
                // is not on the plan with a misleading "429 check quota", so only send ids the
                // account's own catalog (fetchAvailableModels) offers, and refuse others here.
                const cloudCodeBody =
                  normalizedClientFormat === "anthropic"
                    ? upstreamFormat === "openai"
                      ? upstreamPayload
                      : claudeToOpenAIRequest(savedBody, target.upstreamModel)
                    : savedBody;
                let catalogModel = "";
                if (cloudCodeFlavor.id === "antigravity") {
                  let catalog = Array.isArray(keyEntry?.oauthMeta?.availableModels)
                    ? keyEntry.oauthMeta.availableModels
                    : [];
                  catalogModel = resolveCatalogModel(target.upstreamModel, catalog, cloudCodeBody);
                  const catalogAgeMs =
                    Date.now() - (Date.parse(keyEntry?.oauthMeta?.catalogAt || "") || 0);
                  if (catalog.length && !catalogModel && catalogAgeMs > CLOUD_CODE_CATALOG_RECHECK_MS) {
                    const fresh = await this._refreshCloudCodeCatalog(
                      provider,
                      keyEntry,
                      resolvedSecret,
                      cloudProject,
                      { fetchImpl: cloudCodeFetch, dispatcher }
                    );
                    if (fresh.length) {
                      catalog = fresh;
                      catalogModel = resolveCatalogModel(target.upstreamModel, catalog, cloudCodeBody);
                    }
                  }
                  if (catalog.length && !catalogModel) {
                    const chat = catalogChatModelIds(catalog);
                    const shown = chat.slice(0, 12);
                    const suggestion = keyEntry?.oauthMeta?.defaultModelId || shown[0] || "";
                    const msg = `Model '${target.upstreamModel}' is not on this Antigravity account's plan (${
                      keyEntry?.oauthMeta?.tierLabel || "Antigravity"
                    }); Google would only answer "429 check quota". Models on this plan: ${shown.join(", ")}${
                      chat.length > shown.length ? ", …" : ""
                    }.${suggestion ? ` Use e.g. '${provider.slug}/${suggestion}'.` : ""} If the plan just changed, press 'Làm mới gói & quota' on the Antigravity card.`;
                    clearTimeout(timer);
                    this.liveEvents?.markRequestEnd(provider.slug, {
                      model: `${provider.slug}/${target.upstreamModel}`,
                      status: 404,
                      latencyMs: Date.now() - attemptStart,
                      error: msg
                    });
                    markedActive = false;
                    attemptTrail.push({
                      target: target.raw,
                      providerSlug: provider.slug,
                      model: target.upstreamModel,
                      keyId: keyEntry.id,
                      status: 404,
                      latencyMs: Date.now() - attemptStart,
                      error: msg
                    });
                    lastErrorStatus = 404;
                    lastErrorMessage = msg;
                    break;
                  }
                }

                // Antigravity chat always uses the streaming RPC (as its IDE does); a non-streaming
                // client gets the folded stream (see the 2xx branch below).
                cloudCodeFoldStream = !isStream && cloudCodeFlavor.chatAlwaysStream === true;
                const upstreamStream = isStream || cloudCodeFoldStream;
                effectiveUrl = upstreamStream ? cloudCodeFlavor.streamUrl : cloudCodeFlavor.generateUrl;
                const envelope = buildCloudCodeRequest(
                  catalogModel || target.upstreamModel,
                  cloudCodeBody,
                  cloudProject,
                  { flavor: cloudCodeFlavor, exactModel: Boolean(catalogModel) }
                );
                cloudCodeEnvelope = envelope;
                cloudCodeCtx = {
                  projectId: cloudProject,
                  model: envelope.model,
                  hasSystemPrompt: Boolean(envelope.request?.systemInstruction),
                  // What was actually sent (after the competing-client rewrite), for the 429 note.
                  systemText: String(envelope.request?.systemInstruction?.parts?.[0]?.text || "").slice(0, 4000),
                  hasTools: Boolean(envelope.request?.tools?.length),
                  thinking: envelope.request?.generationConfig?.thinkingConfig || null
                };
                effectiveBody = JSON.stringify(envelope);
                effectiveHeaders = {
                  ...cloudCodeFlavor.chatHeaders(resolvedSecret, {
                    model: target.upstreamModel
                  }),
                  accept: upstreamStream ? "text/event-stream" : "application/json"
                };
              }

              const isClaudeOAuth =
                !isEmbeddings && !isGeminiCliKey && isClaudeOAuthKey(keyEntry, resolvedSecret);
              const isCodexOAuth =
                !isEmbeddings && !isGeminiCliKey && !isClaudeOAuth && isCodexOAuthKey(keyEntry);
              const isKimiOAuth =
                !isEmbeddings &&
                !isGeminiCliKey &&
                !isClaudeOAuth &&
                !isCodexOAuth &&
                isKimiOAuthKey(keyEntry);
              let effectiveUpstreamFormat = upstreamFormat;
              let codexResponsesFoldStream = false;
              let claudeBaseAnthropicBody = null;
              let claudeSentModel = target.upstreamModel;

              if (isClaudeOAuth) {
                effectiveUpstreamFormat = "anthropic";
                claudeBaseAnthropicBody =
                  upstreamFormat === "anthropic"
                    ? { ...upstreamPayload }
                    : openaiToClaudeRequest(
                        normalizedClientFormat === "anthropic"
                          ? claudeToOpenAIRequest(savedBody, target.upstreamModel)
                          : savedBody,
                        target.upstreamModel
                      );
                const builtClaude = buildClaudeOAuthMessagesRequest(
                  claudeBaseAnthropicBody,
                  resolvedSecret,
                  target.upstreamModel,
                  {
                    baseUrl: provider.baseUrl || "https://api.anthropic.com",
                    clientAnthropicVersion,
                    availableModels: keyEntry?.oauthMeta?.availableModels,
                    sessionId: savedBody?.metadata?.session_id
                  }
                );
                effectiveUrl = builtClaude.url;
                effectiveHeaders = builtClaude.headers;
                effectiveBody = JSON.stringify(builtClaude.body);
                claudeSentModel = builtClaude.resolvedModel;
              } else if (isCodexOAuth) {
                effectiveUpstreamFormat = "openai";
                codexResponsesFoldStream = !isStream;
                const openAiBody =
                  upstreamFormat === "openai"
                    ? upstreamPayload
                    : claudeToOpenAIRequest(savedBody, target.upstreamModel);
                const isLoopbackCodex = isLocalUrl(provider.baseUrl);
                const codexTargetUrl = isLoopbackCodex
                  ? String(provider.baseUrl || "").replace(/\/+$/, "").endsWith("/responses")
                    ? provider.baseUrl
                    : buildUpstreamUrl(provider.baseUrl, "openai", "responses")
                  : undefined;
                const builtCodex = buildCodexOAuthRequest(
                  openAiBody,
                  resolvedSecret,
                  target.upstreamModel,
                  {
                    ...(codexTargetUrl ? { url: codexTargetUrl } : {}),
                    accountId:
                      keyEntry?.oauthMeta?.accountId ||
                      keyEntry?.oauthCredentials?.accountId ||
                      "",
                    availableModels: keyEntry?.oauthMeta?.availableModels,
                    sessionId: savedBody?.metadata?.session_id
                  }
                );
                effectiveUrl = builtCodex.url;
                effectiveHeaders = builtCodex.headers;
                effectiveBody = JSON.stringify(builtCodex.body);
              } else if (isKimiOAuth) {
                const kimiHeaders = buildKimiHeaders(
                  keyEntry?.oauthMeta?.deviceId || keyEntry?.oauthCredentials?.deviceId || ""
                );
                effectiveHeaders = {
                  ...kimiHeaders,
                  ...headers
                };
                if (
                  !isLocalUrl(provider.baseUrl) &&
                  String(provider.baseUrl || "").toLowerCase().includes("moonshot.cn")
                ) {
                  effectiveUrl = buildUpstreamUrl(
                    KIMI_CODING_BASE_URL,
                    provider.formatType,
                    upstreamPath
                  );
                }
              }

              if (effectiveBody === null) {
                effectiveBody = getUpstreamBody();
              }

              let upstreamRes = await (cloudCodeFetch || upstreamFetch)(effectiveUrl, {
                method: "POST",
                headers: effectiveHeaders,
                body: effectiveBody,
                signal: controller.signal,
                ...(dispatcher ? { dispatcher } : {})
              });

              // Claude OAuth: if requested model (e.g. un-aliased claude-sonnet-5-5) is rejected
              // with 400/404 model error, retry on live/fallback Claude models on the same account.
              if (
                isClaudeOAuth &&
                claudeBaseAnthropicBody &&
                (upstreamRes.status === 404 || upstreamRes.status === 400) &&
                !clientAborted
              ) {
                const firstErrText = await upstreamRes.text().catch(() => "");
                const errHead = firstErrText.slice(0, 4096).toLowerCase();
                const looksLikeModelError =
                  upstreamRes.status === 404 ||
                  errHead.includes("not_found_error") ||
                  (/\bmodel\b/.test(errHead) &&
                    /\b(invalid|not\s+found|unsupported|unavailable|unknown)\b/.test(errHead));
                if (looksLikeModelError) {
                  const candidates = getClaudeFallbackCandidates(
                    claudeSentModel,
                    keyEntry?.oauthMeta?.availableModels
                  ).slice(0, 3);
                  const tried = new Set([claudeSentModel]);
                  let resolvedRes = null;
                  let lastFallbackBody = firstErrText;
                  let lastFallbackStatus = upstreamRes.status;
                  let lastFallbackHeaders = upstreamRes.headers;
                  for (const cand of candidates) {
                    if (tried.has(cand) || clientAborted) continue;
                    tried.add(cand);
                    const nextBuilt = buildClaudeOAuthMessagesRequest(
                      claudeBaseAnthropicBody,
                      resolvedSecret,
                      cand,
                      {
                        exactModel: true,
                        baseUrl: provider.baseUrl || "https://api.anthropic.com",
                        clientAnthropicVersion,
                        sessionId: savedBody?.metadata?.session_id
                      }
                    );
                    const nextRes = await upstreamFetch(nextBuilt.url, {
                      method: "POST",
                      headers: nextBuilt.headers,
                      body: JSON.stringify(nextBuilt.body),
                      signal: controller.signal,
                      ...(dispatcher ? { dispatcher } : {})
                    });
                    if (nextRes.ok) {
                      resolvedRes = nextRes;
                      break;
                    }
                    lastFallbackStatus = nextRes.status;
                    lastFallbackHeaders = nextRes.headers;
                    lastFallbackBody = await nextRes.text().catch(() => "");
                    if (nextRes.status !== 404 && nextRes.status !== 400) {
                      resolvedRes = new Response(lastFallbackBody, {
                        status: lastFallbackStatus,
                        headers: lastFallbackHeaders
                      });
                      break;
                    }
                  }
                  upstreamRes =
                    resolvedRes ||
                    new Response(lastFallbackBody, {
                      status: lastFallbackStatus,
                      headers: lastFallbackHeaders
                    });
                } else {
                  upstreamRes = new Response(firstErrText, {
                    status: upstreamRes.status,
                    statusText: upstreamRes.statusText,
                    headers: upstreamRes.headers
                  });
                }
              }

              // Antigravity flags certain systemInstruction texts with a detail-free HTTP 429
              // even with 100% quota left. Retry once with systemInstruction folded into the
              // first user turn, and if still 429, once more with systemInstruction dropped.
              if (
                isGeminiCliKey &&
                cloudCodeFlavor.id === "antigravity" &&
                upstreamRes.status === 429 &&
                cloudCodeCtx?.hasSystemPrompt &&
                cloudCodeEnvelope?.request?.systemInstruction &&
                !cloudCodeCtx.systemText.includes("FlaggedApp") &&
                !clientAborted
              ) {
                const first429Text = await upstreamRes.text().catch(() => "");
                const parsed429 = parseCloudCodeRateLimit(first429Text);
                const isCapacity429 = /capacity|high traffic|overloaded/i.test(
                  `${parsed429.reason} ${parsed429.message}`
                );
                if (!parsed429.resetAtMs && !isCapacity429) {
                  const fullSysText = (
                    cloudCodeEnvelope.request.systemInstruction.parts || []
                  )
                    .map((p) => (typeof p?.text === "string" ? p.text : ""))
                    .filter(Boolean)
                    .join("\n\n");

                  const retryVariants = [];
                  if (fullSysText && Array.isArray(cloudCodeEnvelope.request.contents)) {
                    const { systemInstruction: _dropSys, ...reqWithoutSys } = cloudCodeEnvelope.request;
                    const firstUserIdx = cloudCodeEnvelope.request.contents.findIndex(
                      (t) => t?.role === "user" && Array.isArray(t.parts)
                    );
                    if (firstUserIdx >= 0) {
                      const nextContents = cloudCodeEnvelope.request.contents.slice();
                      const firstUser = nextContents[firstUserIdx];
                      nextContents[firstUserIdx] = {
                        ...firstUser,
                        parts: [{ text: `${fullSysText}\n\n` }, ...firstUser.parts]
                      };
                      retryVariants.push({
                        ...cloudCodeEnvelope,
                        request: { ...reqWithoutSys, contents: nextContents }
                      });
                    }
                  }
                  {
                    const { systemInstruction: _dropSys2, ...reqWithoutSys2 } = cloudCodeEnvelope.request;
                    retryVariants.push({
                      ...cloudCodeEnvelope,
                      request: reqWithoutSys2
                    });
                  }

                  for (const retryEnv of retryVariants) {
                    if (clientAborted) break;
                    upstreamRes = await (cloudCodeFetch || upstreamFetch)(effectiveUrl, {
                      method: "POST",
                      headers: effectiveHeaders,
                      body: JSON.stringify(retryEnv),
                      signal: controller.signal,
                      ...(dispatcher ? { dispatcher } : {})
                    });
                    if (upstreamRes.ok) {
                      cloudCodeCtx.hasSystemPrompt = false;
                      cloudCodeCtx.systemText = "";
                      break;
                    }
                    if (upstreamRes.status !== 429) break;
                    if (retryEnv !== retryVariants[retryVariants.length - 1]) {
                      await upstreamRes.text().catch(() => "");
                    }
                  }
                } else {
                  upstreamRes = new Response(first429Text, {
                    status: upstreamRes.status,
                    headers: upstreamRes.headers
                  });
                }
              }

              // On Anthropic-format custom relays (e.g. Claude Code / OneAPI / xai247 proxies),
              // some gateways require Authorization: Bearer while others require x-api-key.
              // If the primary header gets 401, retry once with the alternate auth header.
              if (
                upstreamRes.status === 401 &&
                resolvedSecret &&
                !isGeminiCliKey &&
                !isClaudeOAuth &&
                !isCodexOAuth &&
                !isKimiOAuth &&
                provider.formatType === "anthropic" &&
                !String(provider.baseUrl || "").toLowerCase().includes("api.anthropic.com")
              ) {
                const altHeaders = buildAlternateAuthHeaders(headers, resolvedSecret);
                if (altHeaders) {
                  await upstreamRes.text().catch(() => "");
                  upstreamRes = await upstreamFetch(upstreamUrl, {
                    method: "POST",
                    headers: altHeaders,
                    body: getUpstreamBody(),
                    signal: controller.signal,
                    ...(dispatcher ? { dispatcher } : {})
                  });
                }
              }

              if (!upstreamRes.ok) {
                clearTimeout(timer);
                const errText = await upstreamRes.text().catch(() => "");
                const secrets = this._allSecretKeys();
                if (resolvedSecret) secrets.push(resolvedSecret);
                // Cloud Code 429s are often a bare "Resource has been exhausted"; read the live
                // quota so the message says whether it is the quota or this request. While quota
                // is left, one bare test chat (cached per key+model) tells request from account.
                const probeKey = keyEntry.id
                  ? this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel)
                  : "";
                const cachedProbe = probeKey ? this.cloudCodeProbes.get(probeKey) : null;
                const explainOpts =
                  isGeminiCliKey && upstreamRes.status === 429
                    ? {
                        errText,
                        accessToken: resolvedSecret,
                        projectId: cloudCodeCtx?.projectId || "",
                        model: cloudCodeCtx?.model || target.upstreamModel,
                        flavor: cloudCodeFlavor.id,
                        tier: keyEntry?.oauthMeta?.tier || "",
                        hasSystemPrompt: cloudCodeCtx?.hasSystemPrompt === true,
                        systemText: cloudCodeCtx?.systemText || "",
                        hasTools: cloudCodeCtx?.hasTools === true,
                        thinking: cloudCodeCtx?.thinking ?? null,
                        isolate:
                          cachedProbe && Date.now() - cachedProbe.at < CLOUD_CODE_PROBE_TTL_MS
                            ? cachedProbe.probe
                            : Boolean(probeKey && !clientAborted),
                        ...(cloudCodeFetch ? { fetchImpl: cloudCodeFetch } : {}),
                        ...(dispatcher ? { dispatcher } : {})
                      }
                    : null;

                // Fast failover: when backup keys or fallback targets are immediately available,
                // do NOT stall 4-16s waiting on quota/bare-chat probes — fail over in <1ms and
                // run the diagnostic probe detached in the background to refine future cooldowns.
                let cloudCodeVerdict = null;
                if (explainOpts && hasFallbackRemaining) {
                  explainCloudCode429(explainOpts)
                    .then((verdict) => {
                      if (!verdict) return;
                      if (verdict.probeFresh && probeKey) {
                        this.cloudCodeProbes.delete(probeKey);
                        this.cloudCodeProbes.set(probeKey, { at: Date.now(), probe: verdict.probe });
                        while (this.cloudCodeProbes.size > CLOUD_CODE_PROBE_CACHE_MAX) {
                          this.cloudCodeProbes.delete(this.cloudCodeProbes.keys().next().value);
                        }
                      }
                      if (verdict.cause === "model" && !keyEntry.isAnonymous) {
                        this._storeCloudCodeCatalog(provider.id, keyEntry.id, verdict.catalog).catch(() => {});
                      }
                      if (probeKey && verdict.resetAtMs && verdict.resetAtMs > Date.now()) {
                        const refinedUntil = Math.min(
                          Math.max(verdict.resetAtMs, Date.now() + COOLDOWN_MS),
                          Date.now() + MAX_CLOUD_CODE_COOLDOWN_MS
                        );
                        this._setBoundedMapEntry(this.modelCooldowns, probeKey, refinedUntil);
                        if (verdict.note) {
                          this._setBoundedMapEntry(this.modelCooldownNotes, probeKey, verdict.note);
                        }
                      }
                    })
                    .catch(() => {});
                } else if (explainOpts) {
                  cloudCodeVerdict = await explainCloudCode429(explainOpts).catch(() => null);
                }
                if (cloudCodeVerdict?.probeFresh && probeKey) {
                  this.cloudCodeProbes.delete(probeKey);
                  this.cloudCodeProbes.set(probeKey, { at: Date.now(), probe: cloudCodeVerdict.probe });
                  while (this.cloudCodeProbes.size > CLOUD_CODE_PROBE_CACHE_MAX) {
                    this.cloudCodeProbes.delete(this.cloudCodeProbes.keys().next().value);
                  }
                }
                // The live read found the model missing from the plan: keep that catalog so the
                // next request is refused locally with the real model list.
                if (cloudCodeVerdict?.cause === "model" && !keyEntry.isAnonymous) {
                  await this._storeCloudCodeCatalog(provider.id, keyEntry.id, cloudCodeVerdict.catalog);
                }
                // Strike breaker for 429s while quota is left (see CLOUD_CODE_STRIKE_LIMIT). When
                // even a bare test chat is refused, pausing right away spares Google more calls.
                let strikePause = false;
                if (cloudCodeVerdict?.cause === "account" && keyEntry.id) {
                  strikePause = true;
                  this.cloudCodeStrikes.delete(probeKey);
                  cloudCodeVerdict.note += " Paused this model on this account for 15 minutes.";
                } else if (cloudCodeVerdict?.cause === "request" && keyEntry.id) {
                  const sk = this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel);
                  const now = Date.now();
                  const prev = this.cloudCodeStrikes.get(sk);
                  const since =
                    prev && now - prev.since <= CLOUD_CODE_STRIKE_WINDOW_MS ? prev.since : now;
                  const count = prev && since === prev.since ? prev.count + 1 : 1;
                  if (count >= CLOUD_CODE_STRIKE_LIMIT) {
                    this.cloudCodeStrikes.delete(sk);
                    strikePause = true;
                    cloudCodeVerdict.note += ` Paused this model on this account for 15 minutes after ${count} refusals in a row.`;
                  } else {
                    this._setBoundedMapEntry(this.cloudCodeStrikes, sk, { count, since });
                  }
                }
                // Prefix with provenance: the text is the PROVIDER's own message, not 001Router's.
                const cleanMsg = `upstream ${provider.slug} HTTP ${upstreamRes.status}: ${sanitizeSecrets(
                  extractUpstreamErrorMessage(errText, upstreamRes.status),
                  secrets
                )}${cloudCodeVerdict?.note ? ` — ${cloudCodeVerdict.note}` : ""}`;
                const attemptLatency = Date.now() - attemptStart;

                this.liveEvents?.markRequestEnd(provider.slug, {
                  model: `${provider.slug}/${target.upstreamModel}`,
                  status: upstreamRes.status,
                  latencyMs: attemptLatency,
                  error: cleanMsg
                });
                markedActive = false;
                this.liveEvents?.log(
                  "warn",
                  "upstream",
                  `${provider.slug}/${target.upstreamModel} HTTP ${upstreamRes.status} (${attemptLatency}ms): ${cleanMsg.slice(0, 140)}`,
                  secrets
                );

                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: upstreamRes.status,
                  latencyMs: attemptLatency,
                  error: cleanMsg
                });

                // Cloud Code quota is per model family, so a 429 never takes the whole account
                // down. A model missing from the plan is refused locally from now on; a refused
                // request (quota still left) only cools down once the strike breaker trips.
                const cooldownScope = cloudCodeVerdict
                  ? cloudCodeVerdict.cause === "model" ||
                    (cloudCodeVerdict.cause === "request" && !strikePause)
                    ? null
                    : "model"
                  : getCooldownScope(upstreamRes.status, cleanMsg);
                const cooldownUntil = strikePause
                  ? Date.now() + CLOUD_CODE_STRIKE_PAUSE_MS
                  : cloudCodeVerdict?.resetAtMs && cloudCodeVerdict.resetAtMs > Date.now()
                    ? Math.min(
                        Math.max(cloudCodeVerdict.resetAtMs, Date.now() + COOLDOWN_MS),
                        Date.now() + MAX_CLOUD_CODE_COOLDOWN_MS
                      )
                    : Date.now() + COOLDOWN_MS;
                if (!keyEntry.isAnonymous && keyEntry.id && cooldownScope === "key") {
                  await this.storage.markProviderKeyCooldown(
                    provider.id,
                    keyEntry.id,
                    Date.now() + COOLDOWN_MS,
                    cleanMsg.slice(0, 200)
                  );
                } else if (!keyEntry.isAnonymous && keyEntry.id && cooldownScope === "model") {
                  // Per-model rate/capacity limit: keep the key usable for every other model.
                  const mk = this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel);
                  this._setBoundedMapEntry(this.modelCooldowns, mk, cooldownUntil);
                  const noteText = cloudCodeVerdict?.note || cleanMsg.slice(0, 260);
                  if (noteText) this._setBoundedMapEntry(this.modelCooldownNotes, mk, noteText);
                  else this.modelCooldownNotes.delete(mk);
                }

                lastErrorStatus = upstreamRes.status;
                lastErrorMessage = cleanMsg;

                const isTransient5xx =
                  upstreamRes.status === 502 ||
                  upstreamRes.status === 503 ||
                  upstreamRes.status === 504;
                if (
                  isTransient5xx &&
                  keyAttempt + 1 < maxAttemptsForKey &&
                  attemptLatency < 15_000 &&
                  !clientAborted
                ) {
                  await abortableDelay(800, () => clientAborted);
                  continue;
                }

                if (isRetryableStatus(upstreamRes.status)) {
                  break;
                }
                // Non-retryable client error (e.g. 400 invalid schema / 404 model)
                finalTarget = target;
                finalStatus = upstreamRes.status;
                break outerLoop;
              }

              // Detect when upstream returned application/json even though client requested stream: true
              const upstreamContentType = (upstreamRes.headers.get("content-type") || "").toLowerCase();
              const isJsonFallbackForStream =
                isStream && upstreamContentType.includes("application/json");

              // Successful HTTP 2xx response (non-streaming OR JSON fallback for stream request)
              if (!isStream || isJsonFallbackForStream) {
                const jsonText = await upstreamRes.text();
                clearTimeout(timer);
                let upstreamJson;
                let invalidBodyMsg = "Upstream returned invalid JSON";
                try {
                  if (cloudCodeFoldStream) {
                    // Non-streaming client, streaming RPC: fold the SSE frames into one response.
                    upstreamJson = aggregateCloudCodeStream(jsonText);
                    if (upstreamJson?.error) {
                      invalidBodyMsg = `upstream ${provider.slug} stream error: ${sanitizeSecrets(
                        String(upstreamJson.error.message || upstreamJson.error.status || "unknown").slice(0, 300),
                        [...this._allSecretKeys(), ...(resolvedSecret ? [resolvedSecret] : [])]
                      )}`;
                      throw new Error(invalidBodyMsg);
                    }
                    if (!upstreamJson) {
                      invalidBodyMsg = "Upstream stream ended without a response";
                      throw new Error(invalidBodyMsg);
                    }
                  } else if (codexResponsesFoldStream) {
                    upstreamJson = aggregateCodexResponsesStream(jsonText, target.upstreamModel);
                    if (upstreamJson?.error) {
                      invalidBodyMsg = `upstream ${provider.slug} stream error: ${sanitizeSecrets(
                        String(upstreamJson.error.message || "unknown").slice(0, 300),
                        [...this._allSecretKeys(), ...(resolvedSecret ? [resolvedSecret] : [])]
                      )}`;
                      throw new Error(invalidBodyMsg);
                    }
                  } else {
                    upstreamJson = JSON.parse(jsonText);
                  }
                } catch {
                  const attemptLatency = Date.now() - attemptStart;
                  this.liveEvents?.markRequestEnd(provider.slug, {
                    model: `${provider.slug}/${target.upstreamModel}`,
                    status: 502,
                    latencyMs: attemptLatency,
                    error: invalidBodyMsg
                  });
                  markedActive = false;
                  attemptTrail.push({
                    target: target.raw,
                    providerSlug: provider.slug,
                    model: target.upstreamModel,
                    keyId: keyEntry.id,
                    status: 502,
                    latencyMs: attemptLatency,
                    error: invalidBodyMsg
                  });
                  lastErrorStatus = 502;
                  lastErrorMessage = invalidBodyMsg;
                  break;
                }

                if (effectiveUpstreamFormat === "anthropic") {
                  promptTokens = upstreamJson?.usage?.input_tokens ?? 0;
                  completionTokens = upstreamJson?.usage?.output_tokens ?? 0;
                  cachedTokens = upstreamJson?.usage?.cache_read_input_tokens ?? 0;
                } else {
                  promptTokens = upstreamJson?.usage?.prompt_tokens ?? 0;
                  completionTokens = upstreamJson?.usage?.completion_tokens ?? 0;
                  cachedTokens =
                    upstreamJson?.usage?.prompt_tokens_details?.cached_tokens ??
                    upstreamJson?.usage?.cached_tokens ??
                    0;
                }

                // Cloud Code Assist wraps Gemini payloads in `{ response: {...} }` and reports
                // usage as `usageMetadata`, so normalize both before any format mapping.
                if (isGeminiCliKey) {
                  const rawCloud = unwrapCloudCodeResponse(upstreamJson);
                  const usageMeta = rawCloud?.usageMetadata || {};
                  promptTokens = Number(usageMeta.promptTokenCount) || 0;
                  completionTokens = Number(usageMeta.candidatesTokenCount) || 0;
                  cachedTokens = Number(usageMeta.cachedContentTokenCount) || 0;
                  upstreamJson = cloudCodeToOpenAIResponse(upstreamJson, target.upstreamModel);
                }

                let responseBody;
                if (isEmbeddings || clientFormat === effectiveUpstreamFormat) {
                  responseBody = upstreamJson;
                } else if (clientFormat === "openai-responses") {
                  const asOpenAI =
                    effectiveUpstreamFormat === "anthropic"
                      ? claudeToOpenAIResponse(upstreamJson, requestedModel)
                      : upstreamJson;
                  responseBody = openAIToResponsesResponse(asOpenAI, requestedModel);
                } else if (clientFormat === "anthropic" && effectiveUpstreamFormat === "openai") {
                  responseBody = openaiToClaudeResponse(upstreamJson, requestedModel);
                } else {
                  responseBody = claudeToOpenAIResponse(upstreamJson, requestedModel);
                }

                finalTarget = target;
                finalStatus = 200;
                const estCost = calculateRequestCost(
                  provider.preset || provider.slug,
                  target.upstreamModel,
                  { promptTokens, completionTokens, cachedTokens },
                  pricingMap
                );
                const totalLatency = Date.now() - startedAt;

                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 200,
                  latencyMs: Date.now() - attemptStart
                });

                if (!keyEntry.isAnonymous && keyEntry.id) {
                  await this.storage.clearProviderKeyCooldown(provider.id, keyEntry.id);
                  const mk = this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel);
                  this.modelCooldowns.delete(mk);
                  this.modelCooldownNotes.delete(mk);
                  this.cloudCodeStrikes.delete(mk);
                  this.cloudCodeProbes.delete(mk);
                }

                const logId = nanoid();
                const loggedAt = new Date().toISOString();
                const fallbackHops = Math.max(0, attemptTrail.length - 1);

                this.liveEvents?.markRequestEnd(provider.slug, {
                  id: logId,
                  timestamp: loggedAt,
                  model: `${target.providerSlug}/${target.upstreamModel}`,
                  requestedModel,
                  resolvedModel: `${target.providerSlug}/${target.upstreamModel}`,
                  endpoint,
                  keyName: routerKey?.name || "Anonymous",
                  status: 200,
                  promptTokens,
                  completionTokens,
                  cachedTokens,
                  cost: estCost,
                  savedChars,
                  fallbackHops,
                  stream: false,
                  latencyMs: totalLatency
                });
                markedActive = false;
                this.liveEvents?.log(
                  "info",
                  "proxy",
                  `200 ${endpoint} ${target.providerSlug}/${target.upstreamModel} (${promptTokens}in/${completionTokens}out, $${estCost.toFixed(4)}, ${totalLatency}ms)`,
                  [],
                  { skipRedact: true }
                );

                await this.storage.recordRequestLog(
                  {
                    id: logId,
                    timestamp: loggedAt,
                    keyId: routerKey?.id || null,
                    keyName: routerKey?.name || "Anonymous",
                    clientIp,
                    requestedModel,
                    resolvedModel: `${target.providerSlug}/${target.upstreamModel}`,
                    providerSlug: provider.slug,
                    endpoint,
                    status: 200,
                    latencyMs: totalLatency,
                    promptTokens,
                    completionTokens,
                    cachedTokens,
                    estimatedCost: estCost,
                    savedChars,
                    ...(rtkFilters.length > 0 ? { rtkFilters } : {}),
                    ...(cavemanApplied ? { caveman: true } : {}),
                    ...(ponytailApplied ? { ponytail: true } : {}),
                    ...(headroomApplied ? { headroom: true } : {}),
                    ...(adapterUsed ? { adapterUsed } : {}),
                    fallbackHops,
                    attemptTrail
                  },
                  routerKey?.id || null
                );

                responseCompleted = true;
                if (!clientAborted && !res.writableEnded) {
                  if (isJsonFallbackForStream) {
                    res.status(200);
                    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache, no-transform");
                    res.setHeader("Connection", "keep-alive");
                    res.setHeader("X-Accel-Buffering", "no");
                    res.socket?.setNoDelay?.(true);
                    res.flushHeaders?.();

                    const asOpenAI =
                      effectiveUpstreamFormat === "anthropic"
                        ? claudeToOpenAIResponse(upstreamJson, requestedModel)
                        : upstreamJson;
                    const choice = asOpenAI?.choices?.[0] || {};
                    const msg = choice.message || {};
                    const synthChunk = {
                      id: asOpenAI?.id || `chatcmpl-${nanoid(16)}`,
                      object: "chat.completion.chunk",
                      created: asOpenAI?.created || Math.floor(Date.now() / 1000),
                      model: requestedModel || asOpenAI?.model || target.upstreamModel,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            role: "assistant",
                            ...(typeof msg.content === "string" ? { content: msg.content } : {}),
                            ...(typeof msg.reasoning_content === "string"
                              ? { reasoning_content: msg.reasoning_content }
                              : {}),
                            ...(Array.isArray(msg.tool_calls)
                              ? {
                                  tool_calls: msg.tool_calls.map((tc, i) => ({
                                    index: i,
                                    ...tc
                                  }))
                                }
                              : {})
                          },
                          finish_reason: choice.finish_reason || "stop"
                        }
                      ],
                      ...(asOpenAI?.usage ? { usage: asOpenAI.usage } : {})
                    };

                    if (clientFormat === "openai") {
                      res.write(`data: ${JSON.stringify(synthChunk)}\n\n`);
                      res.write("data: [DONE]\n\n");
                    } else {
                      const tx = createStreamTransformer(clientFormat, "openai", requestedModel);
                      const out1 = tx.pushChunk(synthChunk);
                      if (out1) res.write(out1);
                      const out2 = tx.finalize();
                      if (out2) res.write(out2);
                    }
                    res.end();
                  } else {
                    res.status(200).json(responseBody);
                  }
                }
                return;
              }

              // Streaming SSE response
              if (!upstreamRes.body) {
                clearTimeout(timer);
                this.liveEvents?.markRequestEnd(provider.slug, {
                  model: `${provider.slug}/${target.upstreamModel}`,
                  status: 502,
                  latencyMs: Date.now() - attemptStart,
                  error: "Upstream returned empty body"
                });
                markedActive = false;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 502,
                  latencyMs: Date.now() - attemptStart,
                  error: "Upstream returned empty body"
                });
                lastErrorStatus = 502;
                lastErrorMessage = "Upstream returned empty body";
                break;
              }

              const streamResult = await this._pipeSSEStream({
                upstreamRes,
                res,
                clientFormat,
                upstreamFormat: effectiveUpstreamFormat,
                requestedModel,
                timeoutTimer: timer,
                isClientAborted: () => clientAborted,
                isTimedOut: () => timedOut,
                cloudCode: isGeminiCliKey,
                codexResponses: isCodexOAuth,
                onFirstByteSent: () => {
                  hasSentBytesToClient = true;
                }
              });

              clearTimeout(timer);

              if (streamResult.failedBeforeFirstByte) {
                const secrets = this._allSecretKeys();
                const cleanMsg = sanitizeSecrets(
                  streamResult.error || "Upstream stream error",
                  secrets
                );
                this.liveEvents?.markRequestEnd(provider.slug, {
                  model: `${provider.slug}/${target.upstreamModel}`,
                  status: streamResult.timedOut ? 504 : 502,
                  latencyMs: Date.now() - attemptStart,
                  error: cleanMsg
                });
                markedActive = false;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: streamResult.timedOut ? 504 : 502,
                  latencyMs: Date.now() - attemptStart,
                  error: cleanMsg
                });
                lastErrorStatus = streamResult.timedOut ? 504 : 502;
                lastErrorMessage = cleanMsg;
                if (clientAborted) {
                  finalTarget = target;
                  finalStatus = 499;
                  break outerLoop;
                }
                break;
              }

              // Once first byte was sent to the client, NEVER fall back even on mid-stream error
              finalTarget = target;
              promptTokens = streamResult.promptTokens;
              completionTokens = streamResult.completionTokens;
              const estCost = calculateRequestCost(
                provider.preset || provider.slug,
                target.upstreamModel,
                { promptTokens, completionTokens, cachedTokens },
                pricingMap
              );

              if (streamResult.abortedByClient) {
                finalStatus = 499;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 499,
                  latencyMs: Date.now() - attemptStart,
                  error: "Client disconnected"
                });
              } else if (streamResult.midStreamError) {
                finalStatus = 502;
                const secrets = this._allSecretKeys();
                const cleanMsg = sanitizeSecrets(
                  streamResult.error || "Mid-stream upstream failure",
                  secrets
                );
                lastErrorMessage = cleanMsg;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 502,
                  latencyMs: Date.now() - attemptStart,
                  error: cleanMsg
                });
              } else {
                finalStatus = 200;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 200,
                  latencyMs: Date.now() - attemptStart
                });
                if (!keyEntry.isAnonymous && keyEntry.id) {
                  await this.storage.clearProviderKeyCooldown(provider.id, keyEntry.id);
                  const mk = this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel);
                  this.modelCooldowns.delete(mk);
                  this.modelCooldownNotes.delete(mk);
                  this.cloudCodeStrikes.delete(mk);
                  this.cloudCodeProbes.delete(mk);
                }
              }

              const totalLatency = Date.now() - startedAt;
              const streamLogId = nanoid();
              const streamLoggedAt = new Date().toISOString();
              const streamFallbackHops = Math.max(0, attemptTrail.length - 1);

              this.liveEvents?.markRequestEnd(provider.slug, {
                id: streamLogId,
                timestamp: streamLoggedAt,
                model: `${target.providerSlug}/${target.upstreamModel}`,
                requestedModel,
                resolvedModel: `${target.providerSlug}/${target.upstreamModel}`,
                endpoint,
                keyName: routerKey?.name || "Anonymous",
                status: finalStatus,
                promptTokens,
                completionTokens,
                cachedTokens,
                cost: estCost,
                savedChars,
                fallbackHops: streamFallbackHops,
                stream: true,
                latencyMs: totalLatency,
                ...(finalStatus !== 200 ? { error: lastErrorMessage } : {})
              });
              markedActive = false;
              this.liveEvents?.log(
                finalStatus === 200 ? "info" : "warn",
                "stream",
                `${finalStatus} ${endpoint} ${target.providerSlug}/${target.upstreamModel} (${promptTokens}in/${completionTokens}out, $${estCost.toFixed(4)}, ${totalLatency}ms)`
              );

              await this.storage.recordRequestLog(
                {
                  id: streamLogId,
                  timestamp: streamLoggedAt,
                  keyId: routerKey?.id || null,
                  keyName: routerKey?.name || "Anonymous",
                  clientIp,
                  requestedModel,
                  resolvedModel: `${target.providerSlug}/${target.upstreamModel}`,
                  providerSlug: provider.slug,
                  endpoint,
                  status: finalStatus,
                  latencyMs: totalLatency,
                  promptTokens,
                  completionTokens,
                  cachedTokens,
                  estimatedCost: estCost,
                  savedChars,
                  ...(rtkFilters.length > 0 ? { rtkFilters } : {}),
                  ...(cavemanApplied ? { caveman: true } : {}),
                  ...(ponytailApplied ? { ponytail: true } : {}),
                  ...(headroomApplied ? { headroom: true } : {}),
                  ...(adapterUsed ? { adapterUsed } : {}),
                  fallbackHops: streamFallbackHops,
                  attemptTrail,
                  ...(finalStatus !== 200 ? { error: lastErrorMessage } : {})
                },
                routerKey?.id || null
              );

              responseCompleted = true;
              if (!res.writableEnded) {
                res.end();
              }
              return;
            } catch (err) {
              clearTimeout(timer);
              const attemptLatency = Date.now() - attemptStart;
              const errStatus = clientAborted && !timedOut ? 499 : timedOut ? 504 : 502;
              const secrets = this._allSecretKeys();
              if (resolvedSecret) secrets.push(resolvedSecret);
              const errMsg = sanitizeSecrets(
                clientAborted && !timedOut
                  ? "Client aborted request"
                  : timedOut
                    ? `Upstream request timed out after ${timeoutMs}ms`
                    : err?.message || "Upstream network error",
                secrets
              );
              if (markedActive) {
                this.liveEvents?.markRequestEnd(provider.slug, {
                  model: `${provider.slug}/${target.upstreamModel}`,
                  status: errStatus,
                  latencyMs: attemptLatency,
                  error: errMsg
                });
                markedActive = false;
              }
              if (clientAborted && !timedOut) {
                finalTarget = target;
                finalStatus = 499;
                lastErrorStatus = 499;
                lastErrorMessage = errMsg;
                attemptTrail.push({
                  target: target.raw,
                  providerSlug: provider.slug,
                  model: target.upstreamModel,
                  keyId: keyEntry.id,
                  status: 499,
                  latencyMs: attemptLatency,
                  error: lastErrorMessage
                });
                break outerLoop;
              }

              attemptTrail.push({
                target: target.raw,
                providerSlug: provider.slug,
                model: target.upstreamModel,
                keyId: keyEntry.id,
                status: errStatus,
                latencyMs: attemptLatency,
                error: errMsg
              });
              lastErrorStatus = errStatus;
              lastErrorMessage = errMsg;
              break;
            } finally {
              activeController = null;
            }
          }
        }
      }

      // All targets failed or client aborted before completion
      if (clientAborted) {
        finalStatus = 499;
        lastErrorMessage = lastErrorMessage || "Client aborted request";
      } else {
        finalStatus = lastErrorStatus || 502;
      }

      await this.storage.recordRequestLog(
        {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          keyId: routerKey?.id || null,
          keyName: routerKey?.name || "Anonymous",
          clientIp,
          requestedModel,
          resolvedModel: finalTarget
            ? `${finalTarget.providerSlug}/${finalTarget.upstreamModel}`
            : requestedModel,
          providerSlug:
            finalTarget?.providerSlug ||
            attemptTrail[attemptTrail.length - 1]?.providerSlug ||
            null,
          endpoint,
          status: finalStatus,
          latencyMs: Date.now() - startedAt,
          promptTokens,
          completionTokens,
          savedChars,
          ...(cavemanApplied ? { caveman: true } : {}),
          fallbackHops: Math.max(0, attemptTrail.length - 1),
          attemptTrail,
          error: lastErrorMessage
        },
        routerKey?.id || null
      );

      responseCompleted = true;
      if (!clientAborted && !hasSentBytesToClient && !res.writableEnded) {
        sendClientError(res, clientFormat, finalStatus, lastErrorMessage);
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      req.off("aborted", onClientAbort);
      res.off("close", onClientAbort);
    }
  }

  /**
   * Read an upstream SSE Response body, perform optional bidirectional SSE translation,
   * flush SSE headers cleanly ONLY once the first downstream byte is ready, and never
   * allow fallback once bytes have been flushed to the client.
   */
  async _pipeSSEStream({
    upstreamRes,
    res,
    clientFormat,
    upstreamFormat,
    requestedModel,
    timeoutTimer,
    isClientAborted,
    isTimedOut,
    onFirstByteSent,
    cloudCode = false,
    codexResponses = false
  }) {
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let headersFlushed = false;
    let firstByteSent = false;
    let timerCleared = false;
    let promptTokens = 0;
    let completionTokens = 0;

    const flushSSEHeaders = () => {
      if (headersFlushed) return;
      headersFlushed = true;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.socket?.setNoDelay?.(true);
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
    };

    const writeToClient = (chunkOrString) => {
      if (!chunkOrString || chunkOrString.length === 0) return;
      if (isClientAborted() || res.writableEnded) return;
      flushSSEHeaders();
      if (!firstByteSent) {
        firstByteSent = true;
        onFirstByteSent();
      }
      res.write(chunkOrString);
    };

    const clearTtfbTimer = () => {
      if (!timerCleared && timeoutTimer) {
        timerCleared = true;
        clearTimeout(timeoutTimer);
      }
    };

    // Cloud Code Assist SSE: each frame is `{ response: { candidates: [...] } }`, so the frames
    // must be translated into OpenAI chunks before they ever reach the client.
    if (cloudCode) {
      const chunkId = `chatcmpl-${nanoid(20)}`;
      const tx =
        clientFormat === "openai"
          ? null
          : createStreamTransformer(clientFormat, "openai", requestedModel);
      let doneSeen = false;
      let roleSent = false;

      const parser = createSSEParser(({ data }) => {
        if (!data || data === "[DONE]") return;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const raw = unwrapCloudCodeResponse(parsed);
        const usageMeta = raw?.usageMetadata || {};
        if (usageMeta.promptTokenCount) promptTokens = Number(usageMeta.promptTokenCount) || 0;
        if (usageMeta.candidatesTokenCount) {
          completionTokens = Number(usageMeta.candidatesTokenCount) || 0;
        }

        const chunk = cloudCodeChunkToOpenAI(parsed, requestedModel, chunkId);
        if (!chunk) return;

        if (!roleSent) {
          roleSent = true;
          chunk.choices[0].delta = { role: "assistant", ...chunk.choices[0].delta };
        }

        if (clientFormat === "openai") {
          writeToClient(`data: ${JSON.stringify(chunk)}\n\n`);
          return;
        }
        const out = tx.pushChunk(chunk);
        if (out) writeToClient(out);
      });

      try {
        while (true) {
          if (isClientAborted()) {
            await reader.cancel().catch(() => {});
            return {
              failedBeforeFirstByte: !firstByteSent,
              abortedByClient: true,
              midStreamError: false,
              promptTokens,
              completionTokens
            };
          }

          const { value, done } = await reader.read();
          if (done) {
            parser.flush();
            break;
          }
          if (value && value.length > 0) {
            clearTtfbTimer();
            parser.feed(decoder.decode(value, { stream: true }));
          }
        }

        if (!firstByteSent) {
          return {
            failedBeforeFirstByte: true,
            timedOut: false,
            error: "Upstream Cloud Code stream ended with no data",
            promptTokens,
            completionTokens
          };
        }

        if (tx) {
          const tail = tx.finalize();
          if (tail) writeToClient(tail);
        } else if (!doneSeen && clientFormat === "openai") {
          writeToClient("data: [DONE]\n\n");
        }

        return {
          failedBeforeFirstByte: false,
          abortedByClient: false,
          midStreamError: false,
          promptTokens,
          completionTokens
        };
      } catch (err) {
        clearTtfbTimer();
        await reader.cancel().catch(() => {});
        if (isClientAborted()) {
          return {
            failedBeforeFirstByte: !firstByteSent,
            abortedByClient: true,
            midStreamError: false,
            error: "Client aborted stream",
            promptTokens,
            completionTokens
          };
        }
        return {
          failedBeforeFirstByte: !firstByteSent,
          abortedByClient: false,
          midStreamError: firstByteSent,
          timedOut: Boolean(isTimedOut?.()) || err?.name === "AbortError",
          error: err?.message || "Upstream Cloud Code stream interrupted",
          promptTokens,
          completionTokens
        };
      }
    }

    // OpenAI Codex OAuth (chatgpt.com/backend-api/codex/responses) emits Responses API SSE events.
    // Translate events to OpenAI chunks (and optionally to Anthropic/Responses via createStreamTransformer).
    if (codexResponses) {
      const codexState = { model: requestedModel };
      const tx =
        clientFormat === "openai"
          ? null
          : createStreamTransformer(clientFormat, "openai", requestedModel);
      let finalizedSent = false;
      let roleSent = false;
      let streamFailure = "";

      const emitTail = () => {
        if (finalizedSent) return;
        finalizedSent = true;
        if (tx) {
          const tail = tx.finalize();
          if (tail) writeToClient(tail);
        } else if (firstByteSent) {
          writeToClient("data: [DONE]\n\n");
        }
      };

      const parser = createSSEParser(({ event, data }) => {
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") emitTail();
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const chunk = codexSseEventToOpenAIChunk(event, parsed, codexState);
        if (!chunk) return;
        if (chunk.error) {
          streamFailure = chunk.error;
          return;
        }
        if (codexState.usage) {
          promptTokens = codexState.usage.promptTokens || promptTokens;
          completionTokens = codexState.usage.completionTokens || completionTokens;
        }
        if (!roleSent && chunk.choices?.[0]?.delta) {
          roleSent = true;
          chunk.choices[0].delta = { role: "assistant", ...chunk.choices[0].delta };
        }
        if (clientFormat === "openai") {
          writeToClient(`data: ${JSON.stringify(chunk)}\n\n`);
        } else {
          const out = tx.pushChunk(chunk);
          if (out) writeToClient(out);
        }
        if (chunk.choices?.[0]?.finish_reason) {
          emitTail();
        }
      });

      try {
        while (true) {
          if (isClientAborted()) {
            await reader.cancel().catch(() => {});
            return {
              failedBeforeFirstByte: !firstByteSent,
              abortedByClient: true,
              midStreamError: false,
              promptTokens,
              completionTokens
            };
          }

          const { value, done } = await reader.read();
          if (done) {
            parser.flush();
            if (firstByteSent) emitTail();
            break;
          }
          if (value && value.length > 0) {
            clearTtfbTimer();
            parser.feed(decoder.decode(value, { stream: true }));
          }
        }

        if (!firstByteSent) {
          return {
            failedBeforeFirstByte: true,
            timedOut: false,
            error: streamFailure || "Upstream Codex stream ended with no data",
            promptTokens,
            completionTokens
          };
        }

        return {
          failedBeforeFirstByte: false,
          abortedByClient: false,
          midStreamError: Boolean(streamFailure),
          ...(streamFailure ? { error: streamFailure } : {}),
          promptTokens,
          completionTokens
        };
      } catch (err) {
        clearTtfbTimer();
        await reader.cancel().catch(() => {});
        if (isClientAborted()) {
          return {
            failedBeforeFirstByte: !firstByteSent,
            abortedByClient: true,
            midStreamError: false,
            error: "Client aborted stream",
            promptTokens,
            completionTokens
          };
        }
        return {
          failedBeforeFirstByte: !firstByteSent,
          abortedByClient: false,
          midStreamError: firstByteSent,
          timedOut: Boolean(isTimedOut?.()) || err?.name === "AbortError",
          error: err?.message || "Upstream Codex stream interrupted",
          promptTokens,
          completionTokens
        };
      }
    }

    // Passthrough SSE (same format on client and upstream)
    // Ultra-low-latency path: write raw upstream bytes to client socket FIRST, then inspect
    // usage metadata lazily (skipping JSON.parse on non-usage token frames — ~3.2x less CPU).
    if (clientFormat === upstreamFormat) {
      const usageParser = createSSEParser(({ event, data }) => {
        if (!data || data === "[DONE]") return;
        if (upstreamFormat === "anthropic") {
          if (event !== "message_start" && event !== "message_delta" && !data.includes('"usage"')) {
            return;
          }
        } else if (!data.includes('"usage"')) {
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (upstreamFormat === "anthropic") {
            const type = parsed.type || event;
            if (type === "message_start" && parsed.message?.usage) {
              promptTokens = parsed.message.usage.input_tokens ?? promptTokens;
            } else if (type === "message_delta" && parsed.usage) {
              completionTokens = parsed.usage.output_tokens ?? completionTokens;
            }
          } else if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // ignore non-JSON SSE data frames
        }
      });

      try {
        while (true) {
          if (isClientAborted()) {
            await reader.cancel().catch(() => {});
            return {
              failedBeforeFirstByte: !firstByteSent,
              abortedByClient: true,
              midStreamError: false,
              promptTokens,
              completionTokens
            };
          }

          const { value, done } = await reader.read();
          if (done) {
            usageParser.flush();
            break;
          }

          if (value && value.length > 0) {
            clearTtfbTimer();
            writeToClient(value);
            usageParser.feed(decoder.decode(value, { stream: true }));
          }
        }

        if (!firstByteSent) {
          return {
            failedBeforeFirstByte: true,
            timedOut: false,
            error: "Upstream SSE stream ended with no data",
            promptTokens,
            completionTokens
          };
        }

        return {
          failedBeforeFirstByte: false,
          abortedByClient: false,
          midStreamError: false,
          promptTokens,
          completionTokens
        };
      } catch (err) {
        clearTtfbTimer();
        await reader.cancel().catch(() => {});
        if (isClientAborted()) {
          return {
            failedBeforeFirstByte: !firstByteSent,
            abortedByClient: true,
            midStreamError: false,
            error: "Client aborted stream",
            promptTokens,
            completionTokens
          };
        }
        return {
          failedBeforeFirstByte: !firstByteSent,
          abortedByClient: false,
          midStreamError: firstByteSent,
          timedOut: Boolean(isTimedOut?.()) || err?.name === "AbortError",
          error: err?.message || "Upstream SSE stream interrupted",
          promptTokens,
          completionTokens
        };
      }
    }

    // Translated SSE (Anthropic <-> OpenAI or -> OpenAI Responses)
    const transformer = createStreamTransformer(
      clientFormat,
      upstreamFormat,
      requestedModel
    );

    let doneSeen = false;
    const sseParser = createSSEParser(({ event, data }) => {
      if (transformer.mode === "openai") {
        if (data === "[DONE]") {
          doneSeen = true;
          const tail = transformer.finalize();
          if (tail) writeToClient(tail);
          return;
        }
        try {
          const chunk = JSON.parse(data);
          const out = transformer.pushChunk(chunk);
          if (out) writeToClient(out);
        } catch {
          // ignore malformed SSE JSON frame
        }
      } else {
        if (data === "[DONE]") {
          doneSeen = true;
          const tail = transformer.finalize();
          if (tail) writeToClient(tail);
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const out = transformer.pushEvent(event, parsed);
          if (out) writeToClient(out);
          if ((parsed.type || event) === "message_stop") {
            doneSeen = true;
          }
        } catch {
          // ignore malformed SSE JSON frame
        }
      }
    });

    try {
      while (true) {
        if (isClientAborted()) {
          await reader.cancel().catch(() => {});
          const usage = transformer.getUsage();
          return {
            failedBeforeFirstByte: !firstByteSent,
            abortedByClient: true,
            midStreamError: false,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens
          };
        }

        const { value, done } = await reader.read();
        if (done) {
          sseParser.flush();
          if (!doneSeen && firstByteSent) {
            const tail = transformer.finalize();
            if (tail) writeToClient(tail);
          }
          break;
        }

        if (value && value.length > 0) {
          clearTtfbTimer();
          sseParser.feed(decoder.decode(value, { stream: true }));
        }
      }

      const usage = transformer.getUsage();
      if (!firstByteSent) {
        return {
          failedBeforeFirstByte: true,
          timedOut: false,
          error: "Upstream SSE stream ended with no events",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens
        };
      }

      return {
        failedBeforeFirstByte: false,
        abortedByClient: false,
        midStreamError: false,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens
      };
    } catch (err) {
      clearTtfbTimer();
      await reader.cancel().catch(() => {});
      const usage = transformer.getUsage();
      if (isClientAborted()) {
        return {
          failedBeforeFirstByte: !firstByteSent,
          abortedByClient: true,
          midStreamError: false,
          error: "Client aborted stream",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens
        };
      }
      return {
        failedBeforeFirstByte: !firstByteSent,
        abortedByClient: false,
        midStreamError: firstByteSent,
        timedOut: err?.name === "AbortError",
        error: err?.message || "Upstream SSE stream interrupted",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens
      };
    }
  }
}
