import { nanoid } from "nanoid";
import { PRESETS, buildUpstreamUrl, getPreset, isKeyOptionalProvider } from "./presets.js";
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
  resolveAuthSecretForKey
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
  const isOfficialOpenAI =
    preset === "openai" || baseUrl.includes("api.openai.com");
  const isGeminiOpenAI =
    formatType === "gemini-openai" ||
    preset === "gemini" ||
    baseUrl.includes("generativelanguage.googleapis.com");
  const isOpenAIReasoning =
    isOfficialOpenAI && /^(o1|o3|o4|gpt-5)([-./]|$)/i.test(modelLower);

  const out = { ...payload, model: upstreamModel || payload.model };

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

  if (apiKey) {
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
    this.options = options || {};
    this.liveEvents = options?.liveEvents || options?.appLocals?.liveEvents || null;
    /** @type {Map<string, number>} */
    this.rrCursors = new Map();
    /** `${providerId}|${keyId}|${model}` -> cooldown-until epoch ms (per-model 429s, not persisted). */
    this.modelCooldowns = new Map();
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

  isKeyModelCoolingDown(providerId, keyId, model, now = Date.now()) {
    if (!model || !keyId) return false;
    const k = this._modelCooldownKey(providerId, keyId, model);
    const until = this.modelCooldowns.get(k);
    if (!until) return false;
    if (until <= now) {
      this.modelCooldowns.delete(k);
      return false;
    }
    return true;
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
    const secrets = [];
    for (const p of this.storage.getProviders()) {
      for (const k of p.apiKeys || []) {
        if (k?.key) secrets.push(k.key);
        if (typeof k?.serviceAccountJson === "string" && k.serviceAccountJson) {
          secrets.push(k.serviceAccountJson);
          try {
            const sa = JSON.parse(k.serviceAccountJson);
            if (sa?.private_key) secrets.push(sa.private_key);
          } catch {
            // ignore non-JSON
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
            // ignore non-JSON
          }
        }
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
    const { targets: adaptedTargets, adapterUsed } = isEmbeddings
      ? { targets: resolution.targets, adapterUsed: null }
      : this.applyCapacityAdapter(resolution.targets, requiredCaps, settings);

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
    const pricingMap = getMergedPricingMap(PRESETS, this.storage.getCustomPricing?.() || {});

    const clientAnthropicVersion =
      typeof req.headers["anthropic-version"] === "string"
        ? req.headers["anthropic-version"]
        : undefined;

    try {
      outerLoop: for (const target of adaptedTargets) {
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
          const msg = keySelection.allInCooldown
            ? `All API keys for provider '${provider.slug}' are in cooldown for model '${target.upstreamModel}' (rate-limited or account-level error; retry after ~60s or pick another model)`
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

        for (const keyEntry of keySelection.keys) {
          if (clientAborted) break outerLoop;

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
              this.liveEvents?.markRequestStart(provider.slug);
              markedActive = true;
              let upstreamRes = await upstreamFetch(upstreamUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(upstreamPayload),
                signal: controller.signal,
                ...(dispatcher ? { dispatcher } : {})
              });

              // On Anthropic-format custom relays (e.g. Claude Code / OneAPI / xai247 proxies),
              // some gateways require Authorization: Bearer while others require x-api-key.
              // If the primary header gets 401, retry once with the alternate auth header.
              if (
                upstreamRes.status === 401 &&
                resolvedSecret &&
                provider.formatType === "anthropic" &&
                !String(provider.baseUrl || "").toLowerCase().includes("api.anthropic.com")
              ) {
                const altHeaders = buildAlternateAuthHeaders(headers, resolvedSecret);
                if (altHeaders) {
                  await upstreamRes.text().catch(() => "");
                  upstreamRes = await upstreamFetch(upstreamUrl, {
                    method: "POST",
                    headers: altHeaders,
                    body: JSON.stringify(upstreamPayload),
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
                // Prefix with provenance: the text is the PROVIDER's own message, not 001Router's.
                const cleanMsg = `upstream ${provider.slug} HTTP ${upstreamRes.status}: ${sanitizeSecrets(
                  extractUpstreamErrorMessage(errText, upstreamRes.status),
                  secrets
                )}`;
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

                const cooldownScope = getCooldownScope(upstreamRes.status, cleanMsg);
                if (!keyEntry.isAnonymous && keyEntry.id && cooldownScope === "key") {
                  await this.storage.markProviderKeyCooldown(
                    provider.id,
                    keyEntry.id,
                    Date.now() + COOLDOWN_MS,
                    cleanMsg.slice(0, 200)
                  );
                } else if (!keyEntry.isAnonymous && keyEntry.id && cooldownScope === "model") {
                  // Per-model rate/capacity limit: keep the key usable for every other model.
                  this.modelCooldowns.set(
                    this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel),
                    Date.now() + COOLDOWN_MS
                  );
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
                try {
                  upstreamJson = JSON.parse(jsonText);
                } catch {
                  const attemptLatency = Date.now() - attemptStart;
                  this.liveEvents?.markRequestEnd(provider.slug, {
                    model: `${provider.slug}/${target.upstreamModel}`,
                    status: 502,
                    latencyMs: attemptLatency,
                    error: "Upstream returned invalid JSON"
                  });
                  markedActive = false;
                  attemptTrail.push({
                    target: target.raw,
                    providerSlug: provider.slug,
                    model: target.upstreamModel,
                    keyId: keyEntry.id,
                    status: 502,
                    latencyMs: attemptLatency,
                    error: "Upstream returned invalid JSON"
                  });
                  lastErrorStatus = 502;
                  lastErrorMessage = "Upstream returned invalid JSON";
                  break;
                }

                if (upstreamFormat === "anthropic") {
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

                let responseBody;
                if (isEmbeddings || clientFormat === upstreamFormat) {
                  responseBody = upstreamJson;
                } else if (clientFormat === "openai-responses") {
                  const asOpenAI =
                    upstreamFormat === "anthropic"
                      ? claudeToOpenAIResponse(upstreamJson, requestedModel)
                      : upstreamJson;
                  responseBody = openAIToResponsesResponse(asOpenAI, requestedModel);
                } else if (clientFormat === "anthropic" && upstreamFormat === "openai") {
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
                  this.modelCooldowns.delete(
                    this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel)
                  );
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
                  `200 ${endpoint} ${target.providerSlug}/${target.upstreamModel} (${promptTokens}in/${completionTokens}out, $${estCost.toFixed(4)}, ${totalLatency}ms)`
                );

                await this.storage.recordRequestLog(
                  {
                    id: logId,
                    timestamp: loggedAt,
                    keyId: routerKey?.id || null,
                    keyName: routerKey?.name || "Anonymous",
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
                      upstreamFormat === "anthropic"
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
                upstreamFormat,
                requestedModel,
                timeoutTimer: timer,
                isClientAborted: () => clientAborted,
                isTimedOut: () => timedOut,
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
                  this.modelCooldowns.delete(
                    this._modelCooldownKey(provider.id, keyEntry.id, target.upstreamModel)
                  );
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
    onFirstByteSent
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

    // Passthrough SSE (same format on client and upstream)
    if (clientFormat === upstreamFormat) {
      const usageParser = createSSEParser(({ event, data }) => {
        if (!data || data === "[DONE]") return;
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
            usageParser.feed(decoder.decode(value, { stream: true }));
            writeToClient(value);
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
