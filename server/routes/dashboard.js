import express from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import {
  PRESETS,
  VALID_FORMAT_TYPES,
  buildUpstreamUrl,
  getPreset,
  isKeyOptionalProvider,
  isLocalUrl,
  isValidHttpUrl,
  normalizeBaseUrl
} from "../presets.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  buildSessionCookieOptions,
  createDashboardAuthMiddleware,
  isDashboardAuthenticated,
  isDashboardLoginRequired,
  isPasswordChangeRequired,
  isPublicDeployment,
  isRouterKeyRequired,
  isValidLocalCliRequest,
  maskKey,
  sanitizeSecrets,
  signSessionToken
} from "../auth.js";
import { parseHostHeaderName, isLoopbackHost } from "../security/headers.js";
import {
  cleanupLocalTunnels,
  disableTailscale,
  disableTunnel,
  enableTailscale,
  enableTunnel,
  getDownloadStatus,
  getTailscaleStatus,
  getTunnelStatus
} from "../localTunnel.js";
import {
  RTK_FILTER_CATALOG,
  VALID_CAVEMAN_LEVELS,
  VALID_PONYTAIL_LEVELS,
  checkHeadroomStatus,
  compressText
} from "../tokenSaver.js";
import { getMergedPricingMap, normalizePricingRate } from "../pricing.js";
import { buildExtensionCatalog } from "../extensionCatalog.js";
import { getCatalogChatModelIds } from "../catalog/index.js";
import {
  claudeToOpenAIRequest,
  openaiToClaudeRequest
} from "../translator.js";
import {
  decryptExportBundleAsync,
  deriveRouterKeyFields,
  encryptExportBundleAsync
} from "../security/crypto.js";
import {
  createLoginRateLimiter,
  createRateLimitMiddleware,
  extractClientIp
} from "../security/ratelimit.js";
import {
  classifyHostForSSRF,
  isSafePropertyKey,
  maskProxyUrl,
  stripPrototypePollution,
  validateProviderBaseUrl
} from "../security/redact.js";
import { getSecurityStatus, runSecurityScan } from "../security/scan.js";
import {
  clearProxyDispatcherCache,
  getProxyDispatcher,
  parseProxyUrl,
  upstreamFetch as fetch
} from "../proxy.js";
import { buildAlternateAuthHeaders, buildUpstreamHeaders } from "../router.js";
import {
  hasBaseUrlTemplatePlaceholder,
  parseProviderCredentialJson,
  resolveAuthContextForKey,
  resolveAuthSecretForKey
} from "../serviceAccountAuth.js";
import {
  exchangeOpenRouterPkce,
  startOpenRouterPkce
} from "../oauthPkce.js";
import {
  exchangeGoogleOAuthPkce,
  getGoogleOAuthAccessToken,
  inspectGoogleAccountAndPlan,
  parseGoogleClientSecretJson,
  peekGooglePkceState,
  restoreGooglePkceState,
  startGoogleOAuthPkce
} from "../googleOAuth.js";
import {
  CLAUDE_CODE_DEFAULT_MODELS,
  CODEX_DEFAULT_MODELS,
  KIMI_CODE_DEFAULT_MODELS,
  KIMI_CODING_BASE_URL,
  aggregateCodexResponsesStream,
  buildClaudeOAuthMessagesRequest,
  buildCodexOAuthRequest,
  buildKimiHeaders,
  exchangeGenericOAuthPkce,
  extractCodeAndState,
  fetchClaudeOAuthUsage,
  fetchCodexOAuthUsage,
  fetchKimiOAuthUsage,
  getClaudeFallbackCandidates,
  getGenericOAuthAccessToken,
  isClaudeOAuthKey,
  isCodexOAuthKey,
  isKimiOAuthKey,
  peekGenericPkceState,
  pollDeviceCodeFlow,
  restoreGenericPkceState,
  startDeviceCodeFlow,
  startGenericOAuthPkce
} from "../oauthFlows.js";
import {
  catalogChatModelIds,
  diagnoseGeminiCliConnection,
  getCloudCodeFlavor,
  getCloudCodeFlavorForKey,
  exchangeGeminiCliOAuth,
  fetchCloudCodeUsage,
  getGeminiCliAccessToken,
  loadGeminiCliProject,
  mergeCloudCodeUsage,
  parseCloudCodeRateLimit,
  peekGeminiCliState,
  resolveCatalogModel,
  restoreGeminiCliState,
  startGeminiCliOAuth,
  syncProviderModelsWithCatalog
} from "../geminiCliOAuth.js";
import {
  aggregateCloudCodeStream,
  buildCloudCodeRequest,
  unwrapCloudCodeResponse
} from "../geminiCliTranslator.js";

const VALID_COMBO_STRATEGIES = new Set(["fallback", "round-robin"]);
const TEST_ALL_CONCURRENCY = 5;
const REDACTED_MARKER = "***redacted***";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const COMMON_PASSWORDS = new Set([
  "1234", "12345", "123456", "1234567", "12345678", "123456789", "1234567890", "00000000",
  "11111111", "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123",
  "qwertyui", "abc12345", "admin", "admin123", "administrator", "letmein", "welcome",
  "iloveyou", "changeme", "001router", "router001", "12341234"
]);

/**
 * Reject trivially guessable dashboard passwords (including the shipped default `1234`).
 * @param {string} pw
 */
function isTooCommonPassword(pw) {
  const lower = String(pw || "").toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  return /^(.)\1+$/.test(lower); // same character repeated
}

/**
 * Convert an internal router key entry into its public representation without plaintext key or hash.
 * @param {any} k
 */
export function toPublicRouterKey(k) {
  const access =
    k.access && typeof k.access === "object"
      ? {
          restricted: Boolean(k.access.restricted),
          allow: Array.isArray(k.access.allow)
            ? k.access.allow.filter((x) => typeof x === "string" && x.trim())
            : []
        }
      : { restricted: false, allow: [] };
  return {
    id: k.id,
    name: k.name,
    keyPreview: k.keyPreview || (k.key ? maskKey(k.key) : ""),
    ...(k.prefix ? { prefix: k.prefix } : {}),
    ...(k.last4 ? { last4: k.last4 } : {}),
    ...(k.proxyPoolId !== undefined ? { proxyPoolId: k.proxyPoolId } : {}),
    access,
    enabled: k.enabled !== false,
    requestCount: Number(k.requestCount) || 0,
    lastUsedAt: k.lastUsedAt ?? null,
    createdAt: k.createdAt
  };
}

/**
 * Compute the safe public masked display string for a provider key entry.
 * Never reveals plaintext keys or service account JSON private keys.
 * @param {any} k
 * @returns {string}
 */
function getPublicMaskedKey(k) {
  if (k && typeof k.key === "string" && k.key.trim()) {
    return maskKey(k.key);
  }
  if (k?.authMethod === "service_account") {
    const projectId = k.serviceAccountMeta?.projectId;
    return projectId ? `sa:${projectId}` : "service_account";
  }
  if (k?.authMethod === "google_oauth") {
    const email = k.oauthMeta?.email;
    return email ? `oauth:${email}` : "google_oauth";
  }
  if (k?.authMethod === "antigravity") {
    const email = k.oauthMeta?.email;
    return email ? `ag:${email}` : "antigravity";
  }
  if (k?.authMethod === "gemini_cli") {
    const email = k.oauthMeta?.email;
    return email ? `gcli:${email}` : "gemini_cli";
  }
  if (k?.authMethod === "oauth2") {
    const identity = k.oauthMeta?.email || k.oauthMeta?.username || k.oauthMeta?.name;
    return identity ? `oauth:${identity}` : "oauth2";
  }
  if (k?.authMethod === "device_code") {
    const identity = k.oauthMeta?.email || k.oauthMeta?.username;
    return identity ? `device:${identity}` : "device_code";
  }
  return "";
}

/**
 * Convert an internal provider record into its public representation with masked API keys.
 * NEVER leaks `key`, `serviceAccountJson`, or `oauthCredentials`.
 * @param {any} provider
 */
export function toPublicProvider(provider) {
  return {
    id: provider.id,
    slug: provider.slug,
    preset: provider.preset,
    name: provider.name,
    baseUrl: provider.baseUrl,
    formatType: provider.formatType,
    apiKeys: (provider.apiKeys || []).map((k) => ({
      id: k.id,
      label: k.label || "",
      maskedKey: getPublicMaskedKey(k),
      authMethod: k.authMethod || "api_key",
      ...(k.serviceAccountMeta ? { serviceAccountMeta: { ...k.serviceAccountMeta } } : {}),
      ...(k.oauthMeta
        ? {
            oauthMeta: {
              ...k.oauthMeta,
              ...(Array.isArray(k.oauthMeta.topModels)
                ? { topModels: [...k.oauthMeta.topModels] }
                : {})
            }
          }
        : {}),
      enabled: k.enabled !== false,
      cooldownUntil: k.cooldownUntil ?? null,
      ...(k.lastError ? { lastError: k.lastError } : {})
    })),
    models: Array.isArray(provider.models) ? provider.models : [],
    proxyPoolId: provider.proxyPoolId || null,
    enabled: provider.enabled !== false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

/**
 * Normalize a string into a URL-safe lowercase slug.
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalize incoming apiKeys items on provider creation.
 * @param {any[]} rawKeys
 */
function normalizeNewApiKeys(rawKeys) {
  if (!Array.isArray(rawKeys)) return [];
  const out = [];
  for (const item of rawKeys) {
    if (typeof item === "string") {
      const key = item.trim();
      if (key) {
        out.push({
          id: nanoid(),
          label: "",
          key,
          authMethod: "api_key",
          enabled: true,
          cooldownUntil: null
        });
      }
    } else if (item && typeof item === "object") {
      const key = typeof item.key === "string" ? item.key.trim() : "";
      if (key) {
        out.push({
          id: item.id || nanoid(),
          label: typeof item.label === "string" ? item.label.trim() : "",
          key,
          authMethod:
            typeof item.authMethod === "string" && item.authMethod.trim()
              ? item.authMethod.trim()
              : "api_key",
          enabled: item.enabled !== false,
          cooldownUntil: null
        });
      }
    }
  }
  return out;
}

/**
 * Normalize incoming apiKeys items on provider update, preserving existing plaintext keys,
 * `serviceAccountJson`, `authMethod`, and `serviceAccountMeta` whenever `key` is omitted,
 * empty, or equals the masked value for an existing `id`.
 * @param {any[]} rawKeys
 * @param {any[]} existingKeys
 */
function mergeUpdatedApiKeys(rawKeys, existingKeys) {
  const existingById = new Map((existingKeys || []).map((k) => [k.id, k]));
  const next = [];

  for (const item of rawKeys) {
    if (typeof item === "string") {
      const key = item.trim();
      if (!key) continue;
      next.push({
        id: nanoid(),
        label: "",
        key,
        authMethod: "api_key",
        enabled: true,
        cooldownUntil: null
      });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const prev = item.id ? existingById.get(item.id) : null;
    const incomingKey = typeof item.key === "string" ? item.key.trim() : "";

    if (prev) {
      const prevMasked = getPublicMaskedKey(prev);
      const shouldPreserve =
        !incomingKey ||
        incomingKey === maskKey(prev.key) ||
        (prevMasked && incomingKey === prevMasked);
      const finalKey = shouldPreserve ? prev.key : incomingKey;
      const keyChanged = finalKey !== prev.key;
      const nextAuthMethod = keyChanged
        ? (typeof item.authMethod === "string" && item.authMethod.trim()) || "api_key"
        : prev.authMethod || "api_key";
      next.push({
        id: prev.id,
        label:
          item.label !== undefined ? String(item.label).trim() : prev.label || "",
        key: finalKey,
        authMethod: nextAuthMethod,
        ...(!keyChanged && prev.serviceAccountJson
          ? { serviceAccountJson: prev.serviceAccountJson }
          : {}),
        ...(!keyChanged && prev.serviceAccountMeta
          ? { serviceAccountMeta: { ...prev.serviceAccountMeta } }
          : {}),
        ...(!keyChanged && prev.oauthCredentials
          ? { oauthCredentials: prev.oauthCredentials }
          : {}),
        ...(!keyChanged && prev.oauthMeta
          ? {
              oauthMeta: {
                ...prev.oauthMeta,
                ...(Array.isArray(prev.oauthMeta.topModels)
                  ? { topModels: [...prev.oauthMeta.topModels] }
                  : {})
              }
            }
          : {}),
        enabled:
          item.enabled !== undefined ? Boolean(item.enabled) : prev.enabled !== false,
        cooldownUntil: keyChanged
          ? null
          : item.cooldownUntil !== undefined
            ? item.cooldownUntil
            : prev.cooldownUntil ?? null,
        ...(!keyChanged && prev.lastError ? { lastError: prev.lastError } : {})
      });
    } else if (incomingKey) {
      next.push({
        id: item.id || nanoid(),
        label: typeof item.label === "string" ? item.label.trim() : "",
        key: incomingKey,
        authMethod:
          typeof item.authMethod === "string" && item.authMethod.trim()
            ? item.authMethod.trim()
            : "api_key",
        enabled: item.enabled !== false,
        cooldownUntil: null
      });
    }
  }

  return next;
}

/**
 * Pick an active API key (preferring non-cooldown enabled keys) for testing / fetching models.
 * @param {any} provider
 */
function pickProviderKeyForTest(provider) {
  const enabled = (provider.apiKeys || []).filter((k) => k.enabled !== false);
  if (enabled.length === 0) {
    if (isKeyOptionalProvider(provider)) {
      return { key: "", isAnonymous: true };
    }
    return null;
  }
  const now = Date.now();
  const ready = enabled.find((k) => !k.cooldownUntil || k.cooldownUntil <= now);
  return ready || enabled[0];
}

/**
 * Run a bounded-concurrency async map preserving input order.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIdx = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Extract runtime service account & Google OAuth options from Express app locals (for offline test overrides).
 * @param {import("express").Request} req
 */
function extractServiceAccountOptions(req) {
  const locals = req?.app?.locals || {};
  return {
    ...(locals.serviceAccountFetchImpl ? { fetchImpl: locals.serviceAccountFetchImpl } : {}),
    ...(locals.serviceAccountTokenUri ? { tokenUriOverride: locals.serviceAccountTokenUri } : {}),
    ...(locals.googleOAuthFetchImpl ? { googleOAuthFetchImpl: locals.googleOAuthFetchImpl } : {}),
    ...(locals.googleOAuthTokenUrl ? { googleOAuthTokenUrl: locals.googleOAuthTokenUrl } : {}),
    ...(locals.oauthFetchImpl ? { oauthFetchImpl: locals.oauthFetchImpl } : {}),
    ...(locals.oauthTokenUrlOverride
      ? { oauthTokenUrlOverride: locals.oauthTokenUrlOverride }
      : {}),
    allowLoopbackTokenUri: Boolean(
      locals.allowLoopbackTokenUri || locals.oauthAllowLoopback
    ),
    // Cloud Code chat probes (per-model Test on Gemini CLI / Antigravity keys) use this in tests.
    ...(locals.cloudCodeFetchImpl ? { cloudCodeFetchImpl: locals.cloudCodeFetchImpl } : {})
  };
}

/**
 * Extract runtime OAuth 2.0 / Device Code endpoint overrides from Express app locals
 * (for offline test mocks).
 * @param {import("express").Request} req
 */
function extractOAuthFlowsOptions(req) {
  const locals = req?.app?.locals || {};
  return {
    ...(locals.oauthFetchImpl ? { fetchImpl: locals.oauthFetchImpl } : {}),
    ...(locals.oauthGitLabBaseUrl ? { gitlabBaseUrl: locals.oauthGitLabBaseUrl } : {}),
    ...(locals.oauthKiloApiBaseUrl ? { kiloApiBaseUrl: locals.oauthKiloApiBaseUrl } : {}),
    ...(locals.oauthNousPortalBaseUrl ? { nousPortalBaseUrl: locals.oauthNousPortalBaseUrl } : {}),
    ...(locals.oauthKimiAuthBaseUrl ? { kimiAuthBaseUrl: locals.oauthKimiAuthBaseUrl } : {}),
    ...(locals.oauthAuthorizeUrlOverride
      ? { authorizeUrlOverride: locals.oauthAuthorizeUrlOverride }
      : {}),
    ...(locals.oauthTokenUrlOverride ? { tokenUrlOverride: locals.oauthTokenUrlOverride } : {}),
    ...(locals.oauthUserinfoUrlOverride
      ? { userinfoUrlOverride: locals.oauthUserinfoUrlOverride }
      : {}),
    allowLoopback: Boolean(locals.oauthAllowLoopback || locals.allowLoopbackTokenUri)
  };
}

/**
 * Persist an authenticated OAuth / Device-Code credential entry onto a matching or new provider.
 */
async function upsertOAuthProviderConnection(
  storage,
  {
    targetProviderId = "",
    presetSlug = "custom",
    providerBaseUrl = "",
    providerName = "",
    providerSlug = "",
    providerFormatType = "",
    keyEntry
  }
) {
  const now = new Date().toISOString();
  const presetDef = getPreset(presetSlug);
  const existingTarget = targetProviderId
    ? storage.getProviderById(targetProviderId)
    : presetSlug !== "custom"
      ? storage
          .getProviders()
          .find((p) => p.preset === presetSlug || p.slug === presetSlug) || null
      : null;

  let resolvedBaseUrl = "";
  if (!existingTarget) {
    const candidateRaw =
      providerBaseUrl ||
      presetDef?.baseUrl ||
      "";
    resolvedBaseUrl = normalizeBaseUrl(candidateRaw);
    if (!resolvedBaseUrl || !isValidHttpUrl(resolvedBaseUrl)) {
      throw Object.assign(
        new Error("Valid 'providerBaseUrl' (or existing 'providerId') is required"),
        { status: 400 }
      );
    }
    const ssrfCheck = validateProviderBaseUrl(resolvedBaseUrl, {
      preset: presetSlug,
      category: presetDef?.category,
      allowPrivateUpstreams: storage.getSettings().allowPrivateUpstreams
    });
    if (!ssrfCheck.valid) {
      throw Object.assign(new Error(ssrfCheck.error || "Invalid provider baseUrl"), {
        status: 400
      });
    }
  }

  let savedKeyId = "";
  const savedProvider = await storage.update((data) => {
    const target = targetProviderId
      ? data.providers.find((p) => p.id === targetProviderId)
      : presetSlug !== "custom"
        ? data.providers.find((p) => p.preset === presetSlug || p.slug === presetSlug)
        : null;

    if (target) {
      if (!Array.isArray(target.apiKeys)) {
        target.apiKeys = [];
      }
      const identity =
        keyEntry.oauthMeta?.email || keyEntry.oauthMeta?.username || "";
      const existingKey = identity
        ? target.apiKeys.find(
            (k) =>
              k.authMethod === keyEntry.authMethod &&
              (k.oauthMeta?.email || k.oauthMeta?.username || "") === identity
          )
        : null;

      if (existingKey) {
        Object.assign(existingKey, {
          label: keyEntry.label || existingKey.label,
          key: keyEntry.key ?? "",
          authMethod: keyEntry.authMethod,
          ...(keyEntry.oauthCredentials !== undefined
            ? { oauthCredentials: keyEntry.oauthCredentials }
            : {}),
          oauthMeta: keyEntry.oauthMeta,
          enabled: true,
          cooldownUntil: null
        });
        delete existingKey.lastError;
        savedKeyId = existingKey.id;
      } else {
        const createdKey = { id: nanoid(), ...keyEntry, enabled: true, cooldownUntil: null };
        target.apiKeys.push(createdKey);
        savedKeyId = createdKey.id;
      }
      target.updatedAt = now;
      return target;
    }

    const baseSlug = slugify(providerSlug || providerName || presetSlug || "oauth") || "oauth";
    let slug = baseSlug;
    let suffix = 2;
    while (data.providers.some((p) => p.slug === slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const createdKey = { id: nanoid(), ...keyEntry, enabled: true, cooldownUntil: null };
    savedKeyId = createdKey.id;

    const formatType =
      providerFormatType && VALID_FORMAT_TYPES.has(providerFormatType)
        ? providerFormatType
        : presetDef?.formatType || "openai";

    const created = {
      id: nanoid(),
      slug,
      preset: presetDef ? presetDef.preset : "custom",
      name: providerName || presetDef?.name || "OAuth Provider",
      baseUrl: resolvedBaseUrl,
      formatType,
      ...(presetDef?.authStyle ? { authStyle: presetDef.authStyle } : {}),
      apiKeys: [createdKey],
      models: [...(presetDef?.models || presetDef?.defaultModels || [])],
      proxyPoolId: null,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    data.providers.push(created);
    return created;
  });

  return { savedProvider, savedKeyId };
}

/**
 * Extract runtime Google OAuth endpoint overrides from Express app locals (for offline tests).
 * @param {import("express").Request} req
 */
function extractGoogleOAuthOptions(req) {
  const locals = req?.app?.locals || {};
  return {
    ...(locals.googleOAuthAuthBaseUrl ? { authBaseUrl: locals.googleOAuthAuthBaseUrl } : {}),
    ...(locals.googleOAuthTokenUrl ? { tokenUrl: locals.googleOAuthTokenUrl } : {}),
    ...(locals.googleOAuthUserinfoUrl ? { userinfoUrl: locals.googleOAuthUserinfoUrl } : {}),
    ...(locals.googleOAuthModelsUrl ? { modelsUrl: locals.googleOAuthModelsUrl } : {}),
    ...(locals.googleOAuthBillingBaseUrl
      ? { billingBaseUrl: locals.googleOAuthBillingBaseUrl }
      : {}),
    ...(locals.googleOAuthFetchImpl ? { fetchImpl: locals.googleOAuthFetchImpl } : {}),
    allowLoopbackTokenUri: Boolean(
      locals.allowLoopbackTokenUri || locals.googleOAuthTokenUrl
    )
  };
}

/**
 * Collect all plaintext secrets (static API keys, service account private keys, OAuth secrets)
 * from a provider so error messages can never leak secrets.
 * @param {any} provider
 * @param {string} [extraSecret]
 * @returns {string[]}
 */
function collectProviderSecrets(provider, extraSecret = "") {
  const secrets = [];
  for (const k of provider?.apiKeys || []) {
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
  if (extraSecret) secrets.push(extraSecret);
  return secrets;
}

/**
 * Send one tiny real chat to a Cloud Code Assist key (Gemini CLI / Antigravity) and report what
 * Google answered.
 *
 * These keys only speak `v1internal:*` RPCs, so `GET {baseUrl}/models` and `chat/completions` are
 * not usable probes — which is why the generic branch in `runProviderConnectionTest` returns right
 * after `loadCodeAssist` and never touches the requested model. This probe replays what the router
 * actually sends for a chat (same envelope, same RPC, same model resolution), so a green result
 * means that model really answers, and a red one carries Google's own reason.
 *
 * @param {any} keyEntry
 * @param {string} accessToken
 * @param {string} requestedModel model id as the dashboard shows it
 * @param {{ dispatcher?: any, fetchImpl?: typeof globalThis.fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, status: number, latencyMs: number, message: string, model?: string, reply?: string, usage?: any } | null>}
 *   `null` when the key is not a Cloud Code key, so the caller keeps its generic probe.
 */
async function probeCloudCodeModel(keyEntry, accessToken, requestedModel, options = {}) {
  const { dispatcher = null, fetchImpl = fetch, signal = undefined } = options;
  const flavor = getCloudCodeFlavorForKey(keyEntry);
  if (!flavor) return null;

  const started = Date.now();
  let projectId =
    keyEntry?.oauthMeta?.projectId || keyEntry?.oauthCredentials?.projectId || "";

  // An account that was never onboarded has no project; provision it the same way a chat would.
  if (!projectId) {
    try {
      const plan = await loadGeminiCliProject(accessToken, {
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(dispatcher ? { dispatcher } : {}),
        flavor: flavor.id
      });
      projectId = plan.projectId || "";
    } catch (err) {
      return {
        ok: false,
        status: Number(err?.status) || 0,
        latencyMs: Date.now() - started,
        message: `Could not resolve the Cloud Code project: ${err?.message || "loadCodeAssist failed"}`
      };
    }
  }
  if (!projectId) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      message:
        "This account has no Cloud Code project (Google did not provision one); sign in again."
    };
  }
  return finishCloudCodeModelProbe({
    flavor,
    keyEntry,
    accessToken,
    requestedModel,
    projectId,
    started,
    fetchImpl,
    dispatcher,
    signal
  });
}

/**
 * Second half of `probeCloudCodeModel`: pick a model the account can actually use, send the chat,
 * and shape Google's answer into the `{ ok, status, latencyMs, message }` the UI already renders.
 *
 * @param {{
 *   flavor: any, keyEntry: any, accessToken: string, requestedModel: string, projectId: string,
 *   started: number, fetchImpl: typeof globalThis.fetch, dispatcher: any, signal?: AbortSignal
 * }} ctx
 * @returns {Promise<{ ok: boolean, status: number, latencyMs: number, message: string, model?: string, reply?: string, usage?: any }>}
 */
async function finishCloudCodeModelProbe(ctx) {
  const {
    flavor,
    keyEntry,
    accessToken,
    requestedModel,
    projectId,
    started,
    fetchImpl,
    dispatcher,
    signal
  } = ctx;

  // Antigravity plans differ per account: send an id from the account's own catalog when the
  // requested one is not on the plan, instead of letting Google answer a misleading 429.
  const catalog = Array.isArray(keyEntry?.oauthMeta?.availableModels)
    ? keyEntry.oauthMeta.availableModels
    : [];
  const hasCatalog = flavor.id === "antigravity" && catalog.length > 0;
  let model = requestedModel;
  if (hasCatalog) {
    const onPlan = resolveCatalogModel(requestedModel, catalog);
    if (onPlan) {
      model = onPlan;
    } else {
      const chatIds = catalogChatModelIds(catalog);
      const suggestion = keyEntry?.oauthMeta?.defaultModelId || chatIds[0] || "";
      return {
        ok: false,
        status: 404,
        latencyMs: Date.now() - started,
        model: requestedModel,
        message: `Model '${requestedModel}' is not on this account's plan, so Google would only answer "429 check quota". Models on this plan: ${chatIds
          .slice(0, 8)
          .join(", ")}${chatIds.length > 8 ? ", …" : ""}.${
          suggestion ? ` Try '${suggestion}'.` : ""
        }`
      };
    }
  }

  const envelope = buildCloudCodeRequest(
    model,
    { messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 16 },
    projectId,
    { flavor, exactModel: hasCatalog }
  );
  const stream = flavor.chatAlwaysStream === true;
  const url = stream ? flavor.streamUrl : flavor.generateUrl;

  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        ...flavor.chatHeaders(accessToken),
        accept: stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(envelope),
      ...(signal ? { signal } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      model: envelope.model,
      message: aborted
        ? `The ${flavor.label} request timed out (check Settings → timeout, or your proxy).`
        : `Could not reach ${flavor.label} (${err?.message || "network error"})`
    };
  }

  const text = await res.text().catch(() => "");
  const latencyMs = Date.now() - started;
  const parsed = stream ? aggregateCloudCodeStream(text) : parseJsonOrNull(text);
  return shapeCloudCodeProbeResult({
    res,
    text,
    parsed,
    envelope,
    flavor,
    latencyMs
  });
}



/**
 * Turn the Cloud Code chat answer into the test-result shape the dashboard renders.
 *
 * @param {{ res: any, text: string, parsed: any, envelope: any, flavor: any, latencyMs: number }} ctx
 * @returns {{ ok: boolean, status: number, latencyMs: number, message: string, model?: string, reply?: string, usage?: any }}
 */
function shapeCloudCodeProbeResult({ res, text, parsed, envelope, flavor, latencyMs }) {
  if (!res.ok) {
    const errMessage = parsed?.error?.message || parsed?.error || text.slice(0, 240);
    const errText = String(errMessage || `HTTP ${res.status}`)
      .replace(/\s+/g, " ")
      .trim();
    const rate = parseCloudCodeRateLimit(
      typeof errMessage === "string" && errMessage.trim().startsWith("{") ? errMessage : text
    );
    const hint =
      res.status === 429
        ? " Google is refusing this model for this account/client right now; 001Router cannot change that (retry later, use another account, or route this app to an official API: gemini/…, Vertex AI, OpenRouter, Anthropic, OpenAI)."
        : "";
    return {
      ok: false,
      status: res.status,
      latencyMs,
      model: envelope.model,
      message: `HTTP ${res.status}: ${errText.slice(0, 240)}.${
        rate?.resetAtMs ? ` Quota resets at ${new Date(rate.resetAtMs).toISOString()}.` : ""
      }${hint}`
    };
  }

  const payload = unwrapCloudCodeResponse(parsed);
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const reply = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .filter((p) => typeof p?.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  const usage = payload?.usageMetadata || null;
  const promptTokens = Number(usage?.promptTokenCount) || 0;
  const outputTokens = Number(usage?.candidatesTokenCount) || 0;

  return {
    ok: true,
    status: res.status,
    latencyMs,
    model: envelope.model,
    reply: reply.slice(0, 120),
    ...(usage ? { usage: { promptTokens, outputTokens } } : {}),
    message: `${flavor.label} model '${envelope.model}' answered in ${latencyMs}ms${
      reply ? ` ("${reply.slice(0, 60)}")` : " (empty reply)"
    }${usage ? ` · ${promptTokens} tokens in / ${outputTokens} out` : ""}`
  };
}

/** JSON.parse that returns null instead of throwing. */
function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Sync plan tier, quota windows, and live model catalog for Claude, Codex, and Kimi OAuth accounts,
 * then persist them onto the key (`oauthMeta`) and merge models into `provider.models`.
 * Skips live external network fetches for loopback mock providers / offline test runs.
 */
async function syncOAuthAccountPlanAndModels(provider, keyEntry, storage, options = {}) {
  if (!provider || !keyEntry) return null;
  let resolvedSecret = typeof options.resolvedSecret === "string" ? options.resolvedSecret : "";
  if (!resolvedSecret) {
    try {
      const ctx = await resolveAuthContextForKey(keyEntry, {
        ...(options.saOptions || {}),
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
        ...(options.forceRefresh ? { forceRefresh: true } : {})
      });
      resolvedSecret = ctx.secret;
    } catch {
      resolvedSecret = "";
    }
  }

  const isClaude = isClaudeOAuthKey(keyEntry, resolvedSecret);
  const isCodex = !isClaude && isCodexOAuthKey(keyEntry);
  const isKimi = !isClaude && !isCodex && isKimiOAuthKey(keyEntry);
  if (!isClaude && !isCodex && !isKimi) return null;

  if (options.allowLoopback === true || isLocalUrl(provider.baseUrl)) {
    return null;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const fetchUsageOnce = async (token) => {
    if (isClaude) {
      return fetchClaudeOAuthUsage(token, {
        fetchImpl,
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {})
      });
    }
    if (isCodex) {
      return fetchCodexOAuthUsage(token, {
        accountId: keyEntry?.oauthMeta?.accountId || "",
        fetchImpl,
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {})
      });
    }
    const isOAuth = keyEntry.authMethod === "oauth2" && Boolean(keyEntry.oauthCredentials);
    return fetchKimiOAuthUsage(isOAuth ? token : "", isOAuth ? "" : token, {
      deviceId: keyEntry?.oauthMeta?.deviceId || "",
      fetchImpl,
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {})
    });
  };

  let usage;
  try {
    usage = await fetchUsageOnce(resolvedSecret);
  } catch (err) {
    if (Number(err?.status) === 401 && keyEntry.authMethod === "oauth2" && keyEntry.oauthCredentials) {
      const ctx = await resolveAuthContextForKey(keyEntry, {
        ...(options.saOptions || {}),
        ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
        forceRefresh: true
      });
      resolvedSecret = ctx.secret;
      usage = await fetchUsageOnce(resolvedSecret);
    } else {
      throw err;
    }
  }

  const checkedAt = new Date().toISOString();
  const billingStatus = usage.quotaOk || usage.planOk ? "active" : "unknown";
  const liveIds =
    Array.isArray(usage.liveModelIds) && usage.liveModelIds.length > 0
      ? usage.liveModelIds
      : Array.isArray(usage.models)
        ? usage.models.map((m) => m.id).filter(Boolean)
        : [];
  const catalogChatIds = getCatalogChatModelIds(provider.preset);
  let updatedProvider = null;
  let updatedMeta = null;

  await storage.update((data) => {
    const target = data.providers.find((p) => p.id === provider.id);
    if (!target) return;
    const targetKey = (target.apiKeys || []).find((k) => k.id === keyEntry.id);
    if (targetKey) {
      targetKey.oauthMeta = {
        ...mergeCloudCodeUsage(targetKey.oauthMeta, usage, checkedAt),
        ...(usage.email ? { email: usage.email } : {}),
        ...(usage.accountId ? { accountId: usage.accountId } : {}),
        ...(usage.organizationId ? { organizationId: usage.organizationId } : {}),
        ...(usage.organizationName ? { organizationName: usage.organizationName } : {}),
        billingStatus,
        modelsCount:
          liveIds.length || (usage.models || []).length || (target.models || []).length
      };
      if (options.clearCooldown !== false) {
        targetKey.cooldownUntil = null;
        delete targetKey.lastError;
      }
      updatedMeta = targetKey.oauthMeta;
    }
    if (liveIds.length > 0 || (usage.models || []).length > 0) {
      const modelIdsToMerge =
        liveIds.length > 0 ? liveIds : (usage.models || []).map((m) => m.id).filter(Boolean);
      target.models = options.replaceModels
        ? [...new Set([...modelIdsToMerge, ...catalogChatIds])]
        : [...new Set([...modelIdsToMerge, ...(target.models || []), ...catalogChatIds])];
    }
    target.updatedAt = checkedAt;
    updatedProvider = target;
  });

  return {
    providerType: isClaude ? "claude_oauth" : isCodex ? "codex_oauth" : "kimi_oauth",
    usage,
    liveIds,
    catalogOnly: catalogChatIds.filter((id) => !liveIds.includes(id)),
    updatedProvider: updatedProvider || storage.getProviderById(provider.id),
    updatedMeta,
    checkedAt
  };
}

const NON_KEY_AUTO_SYNC_AUTH_METHODS = new Set([
  "antigravity",
  "gemini_cli",
  "claude_oauth",
  "codex_oauth",
  "kimi_oauth",
  "oauth2",
  "service_account",
  "google_oauth"
]);

/**
 * Persist live models discovered from an upstream `/models` response onto the active key
 * (`oauthMeta.packageModels` + `availableModels`) and prepend them to `provider.models`
 * so package-scoped keys expose their supported models first without dropping custom models.
 */
async function persistDiscoveredPackageModels(
  storage,
  providerId,
  keyId,
  fetchedModels,
  routerService = null
) {
  if (!providerId || !Array.isArray(fetchedModels) || fetchedModels.length === 0) {
    return null;
  }
  const cleanIds = [...new Set(fetchedModels.map((id) => String(id || "").trim()).filter(Boolean))];
  if (cleanIds.length === 0) return null;

  const nowIso = new Date().toISOString();
  const updated = await storage.update((data) => {
    const target = data.providers.find((p) => p.id === providerId);
    if (!target) return null;
    target.models = [...new Set([...cleanIds, ...(target.models || [])])];
    if (keyId) {
      const targetKey = (target.apiKeys || []).find((k) => k.id === keyId);
      if (targetKey) {
        targetKey.oauthMeta = {
          ...(targetKey.oauthMeta || {}),
          packageModels: cleanIds,
          availableModels: cleanIds.map((id) => ({
            id,
            label: id,
            family: "claude_gpt",
            kind: "chat",
            isLive: true
          })),
          modelsCount: cleanIds.length,
          checkedAt: nowIso
        };
      }
    }
    target.updatedAt = nowIso;
    return target;
  });

  if (updated && routerService && keyId) {
    routerService.clearProviderCooldowns(providerId, keyId);
  }
  return updated;
}

/**
 * Best-effort background-free sync of a provider key's live `/models` list right after
 * create / update / connect-json (4s timeout, fail-open). Skips unit-test synthetic calls
 * unless explicitly requested via `forceSync` or custom `fetchImpl`.
 */
async function autoSyncProviderPackageModels(provider, storage, options = {}) {
  if (!provider?.id || !provider.baseUrl) return null;
  const hasCustomFetch = typeof options.fetchImpl === "function";
  const forceSync = options.forceSync === true;
  if (!forceSync && !hasCustomFetch) {
    const isTestRunner =
      Boolean(process.env.NODE_TEST_CONTEXT) ||
      process.argv.some((a) => String(a).endsWith(".test.js"));
    if (isTestRunner || isLocalUrl(provider.baseUrl)) {
      return null;
    }
  }

  const keyEntry = (provider.apiKeys || []).find(
    (k) =>
      k &&
      k.enabled !== false &&
      !NON_KEY_AUTO_SYNC_AUTH_METHODS.has(k.authMethod || "api_key") &&
      !getCloudCodeFlavorForKey(k)
  );
  if (!keyEntry) return null;

  const secret = resolveAuthSecretForKey(keyEntry);
  if (!secret) return null;
  if (
    !forceSync &&
    !hasCustomFetch &&
    /^(?:sk-sweep-|sk-mock-|nvapi-good-|sn-bad-|test-)/i.test(secret)
  ) {
    return null;
  }

  const fetchImpl = options.fetchImpl || fetch;
  const dispatcher = getProxyDispatcher(provider, storage);
  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 3500, 500), 6000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = buildUpstreamHeaders(provider, secret);
    const modelsUrl = buildUpstreamUrl(provider.baseUrl, provider.formatType, "models");
    let res = await fetchImpl(modelsUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    });
    if ((res.status === 401 || res.status === 403) && secret) {
      const altHeaders = buildAlternateAuthHeaders(headers, secret);
      if (altHeaders) {
        const retryRes = await fetchImpl(modelsUrl, {
          method: "GET",
          headers: altHeaders,
          signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {})
        });
        if (retryRes.ok) res = retryRes;
      }
    }
    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    const rawList = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : [];
    const fetchedModels = rawList
      .map((m) => {
        if (typeof m === "string") return m.trim();
        const rawId = String(m?.id || m?.name || "").trim();
        if (provider.preset === "gemini" && rawId.startsWith("models/")) {
          return rawId.slice("models/".length);
        }
        return rawId;
      })
      .filter(Boolean);

    if (fetchedModels.length === 0) return null;
    return await persistDiscoveredPackageModels(
      storage,
      provider.id,
      keyEntry.id,
      fetchedModels,
      options.routerService || null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a short reply preview and token usage from an OpenAI- or Anthropic-formatted probe response.
 * @param {string} rawText
 * @param {boolean} isAnthropic
 * @returns {{ reply: string, usage: { promptTokens: number, outputTokens: number, totalTokens: number } | null }}
 */
function extractProbeReplyAndUsage(rawText, isAnthropic = false) {
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") {
    return { reply: "", usage: null };
  }

  let reply = "";
  if (isAnthropic || Array.isArray(parsed.content)) {
    const blocks = Array.isArray(parsed.content) ? parsed.content : [];
    reply = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
  } else if (Array.isArray(parsed.choices)) {
    const msg = parsed.choices[0]?.message;
    if (typeof msg?.content === "string") {
      reply = msg.content.trim();
    } else if (Array.isArray(msg?.content)) {
      reply = msg.content
        .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();
    } else if (typeof parsed.choices[0]?.text === "string") {
      reply = parsed.choices[0].text.trim();
    }
  } else if (typeof parsed.output_text === "string") {
    reply = parsed.output_text.trim();
  }

  const u = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : null;
  let usage = null;
  if (u) {
    const promptTokens = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0) || 0;
    const outputTokens =
      Number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0) || 0;
    const totalTokens =
      Number(u.total_tokens ?? u.totalTokenCount ?? promptTokens + outputTokens) || 0;
    if (promptTokens > 0 || outputTokens > 0 || totalTokens > 0) {
      usage = { promptTokens, outputTokens, totalTokens };
    }
  }

  return { reply: reply.slice(0, 120), usage };
}

/**
 * Test connectivity to a single upstream provider using its active key.
 * @param {any} provider
 * @param {import("../storage.js").Storage} storage
 * @param {string} [requestedModel]
 * @param {Record<string, any>} [saOptions]
 */
async function runProviderConnectionTest(
  provider,
  storage,
  requestedModel = "",
  saOptions = {},
  explicitKeyEntry = null
) {
  const keyEntry = explicitKeyEntry || pickProviderKeyForTest(provider);
  if (!keyEntry) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      message: "No enabled API keys configured"
    };
  }

  const settings = storage.getSettings();
  const timeoutMs = Math.min(settings.timeoutMs || 30000, 30000);
  const dispatcher = getProxyDispatcher(provider, storage);
  let resolvedSecret = "";

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const authCtx = await resolveAuthContextForKey(keyEntry, {
      ...saOptions,
      ...(dispatcher ? { dispatcher } : {})
    });
    resolvedSecret = authCtx.secret;

    const headers = buildUpstreamHeaders(
      provider,
      resolvedSecret,
      undefined,
      authCtx.extraHeaders
    );

    const secrets = collectProviderSecrets(provider, resolvedSecret);

    // Gemini CLI / Cloud Code Assist keys cannot be probed through `{baseUrl}/models` or
    // `{baseUrl}/chat/completions` — the upstream only speaks `v1internal:*` RPCs. Probe
    // `loadCodeAssist` instead, which returns the project + plan tier in one shot.
    const probeFlavor = getCloudCodeFlavorForKey(keyEntry);
    if (probeFlavor && resolvedSecret) {
      // A per-model Test must actually talk to that model: `loadCodeAssist` only proves the account
      // and would report "Connected" even when Google refuses every chat. Send one tiny chat over
      // the same RPC the router uses; fall back to the plan probe when it cannot run.
      if (requestedModel) {
        const cloudProbe = await probeCloudCodeModel(keyEntry, resolvedSecret, requestedModel, {
          ...(dispatcher ? { dispatcher } : {}),
          fetchImpl: saOptions.cloudCodeFetchImpl || fetch,
          signal: controller.signal
        });
        if (cloudProbe) {
          clearTimeout(timer);
          return {
            ...cloudProbe,
            message: sanitizeSecrets(cloudProbe.message, secrets)
          };
        }
      }
      let probe;
      try {
        probe = await loadGeminiCliProject(resolvedSecret, {
          ...(dispatcher ? { dispatcher } : {}),
          flavor: probeFlavor.id
        });
      } catch (err) {
        clearTimeout(timer);
        return {
          ok: false,
          status: Number(err?.status) || 0,
          latencyMs: Date.now() - started,
          message: sanitizeSecrets(err?.message || "Cloud Code Assist probe failed", secrets)
        };
      }
      clearTimeout(timer);

      return {
        ok: true,
        status: 200,
        latencyMs: Date.now() - started,
        message: `Connected via ${probeFlavor.label} (${probe.tierLabel}${
          probe.projectId ? `, project ${probe.projectId}` : ""
        })`,
        modelsCount: Array.isArray(provider.models) ? provider.models.length : 0,
        oauthMeta: {
          tier: probe.tier,
          tierLabel: probe.tierLabel,
          projectId: probe.projectId
        }
      };
    }

    const isClaudeOAuth = !probeFlavor && isClaudeOAuthKey(keyEntry, resolvedSecret);
    const isCodexOAuth = !probeFlavor && !isClaudeOAuth && isCodexOAuthKey(keyEntry);
    const isKimiOAuth = !probeFlavor && !isClaudeOAuth && !isCodexOAuth && isKimiOAuthKey(keyEntry);
    const isLoopbackBase = isLocalUrl(provider.baseUrl);

    if (isClaudeOAuth && resolvedSecret && !isLoopbackBase) {
      if (!requestedModel) {
        try {
          const usage = await fetchClaudeOAuthUsage(resolvedSecret, {
            ...(dispatcher ? { dispatcher } : {})
          });
          clearTimeout(timer);
          return {
            ok: Boolean(usage.planOk || usage.quotaOk),
            status: 200,
            latencyMs: Date.now() - started,
            message: `Connected (${usage.tierLabel} · ${(usage.models || []).length} models)`,
            modelsCount: (usage.models || []).length,
            oauthMeta: mergeCloudCodeUsage(keyEntry.oauthMeta, usage, new Date().toISOString())
          };
        } catch (err) {
          clearTimeout(timer);
          return {
            ok: false,
            status: Number(err?.status) || 0,
            latencyMs: Date.now() - started,
            message: sanitizeSecrets(err?.message || "Claude OAuth connection failed", secrets)
          };
        }
      }

      const baseProbeBody = {
        messages: [{ role: "user", content: "Reply with the single word OK." }],
        max_tokens: 16
      };
      const firstReq = buildClaudeOAuthMessagesRequest(
        baseProbeBody,
        resolvedSecret,
        requestedModel,
        {
          baseUrl: provider.baseUrl || "https://api.anthropic.com",
          availableModels: keyEntry?.oauthMeta?.availableModels
        }
      );
      let chatRes = await fetch(firstReq.url, {
        method: "POST",
        headers: firstReq.headers,
        body: JSON.stringify(firstReq.body),
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {})
      });
      let usedModel = firstReq.resolvedModel;
      if ((chatRes.status === 404 || chatRes.status === 400) && !controller.signal.aborted) {
        const firstErr = await chatRes.text().catch(() => "");
        const candidates = getClaudeFallbackCandidates(
          usedModel,
          keyEntry?.oauthMeta?.availableModels
        ).slice(0, 2);
        let fallbackOkRes = null;
        let lastFallbackText = firstErr;
        for (const cand of candidates) {
          const candReq = buildClaudeOAuthMessagesRequest(baseProbeBody, resolvedSecret, cand, {
            exactModel: true,
            baseUrl: provider.baseUrl || "https://api.anthropic.com"
          });
          const candRes = await fetch(candReq.url, {
            method: "POST",
            headers: candReq.headers,
            body: JSON.stringify(candReq.body),
            signal: controller.signal,
            ...(dispatcher ? { dispatcher } : {})
          });
          if (candRes.ok) {
            fallbackOkRes = candRes;
            usedModel = candReq.resolvedModel;
            break;
          }
          lastFallbackText = await candRes.text().catch(() => "");
          chatRes = candRes;
        }
        if (fallbackOkRes) {
          chatRes = fallbackOkRes;
        } else if (!fallbackOkRes && !chatRes.bodyUsed) {
          chatRes = new Response(lastFallbackText, { status: chatRes.status, headers: chatRes.headers });
        }
      }
      const resText = await chatRes.text().catch(() => "");
      clearTimeout(timer);
      const { reply, usage } = chatRes.ok
        ? extractProbeReplyAndUsage(resText, true)
        : { reply: "", usage: null };
      return {
        ok: chatRes.ok,
        status: chatRes.status,
        latencyMs: Date.now() - started,
        model: usedModel,
        ...(reply ? { reply } : {}),
        ...(usage ? { usage } : {}),
        message: chatRes.ok
          ? `Connected using model '${usedModel}'${reply ? ` ("${reply.slice(0, 60)}")` : ""}`
          : sanitizeSecrets(resText.slice(0, 200) || `HTTP ${chatRes.status}`, secrets)
      };
    }

    if (isCodexOAuth && resolvedSecret && !isLoopbackBase) {
      if (!requestedModel) {
        try {
          const usage = await fetchCodexOAuthUsage(resolvedSecret, {
            accountId: keyEntry?.oauthMeta?.accountId || "",
            ...(dispatcher ? { dispatcher } : {})
          });
          clearTimeout(timer);
          return {
            ok: Boolean(usage.planOk || usage.quotaOk),
            status: 200,
            latencyMs: Date.now() - started,
            message: `Connected (${usage.tierLabel} · ${(usage.models || []).length} models)`,
            modelsCount: (usage.models || []).length,
            oauthMeta: mergeCloudCodeUsage(keyEntry.oauthMeta, usage, new Date().toISOString())
          };
        } catch (err) {
          clearTimeout(timer);
          return {
            ok: false,
            status: Number(err?.status) || 0,
            latencyMs: Date.now() - started,
            message: sanitizeSecrets(err?.message || "Codex OAuth connection failed", secrets)
          };
        }
      }

      const codexReq = buildCodexOAuthRequest(
        { messages: [{ role: "user", content: "Reply with the single word OK." }] },
        resolvedSecret,
        requestedModel,
        {
          accountId: keyEntry?.oauthMeta?.accountId || "",
          availableModels: keyEntry?.oauthMeta?.availableModels
        }
      );
      const codexRes = await fetch(codexReq.url, {
        method: "POST",
        headers: codexReq.headers,
        body: JSON.stringify(codexReq.body),
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {})
      });
      const codexText = await codexRes.text().catch(() => "");
      clearTimeout(timer);
      const folded = codexRes.ok
        ? aggregateCodexResponsesStream(codexText, codexReq.resolvedModel)
        : null;
      const ok = codexRes.ok && !folded?.error;
      const codexReply = ok
        ? String(folded?.choices?.[0]?.message?.content || "").trim().slice(0, 120)
        : "";
      const codexUsageRaw = ok && folded?.usage ? folded.usage : null;
      const codexUsage = codexUsageRaw
        ? {
            promptTokens: Number(codexUsageRaw.prompt_tokens) || 0,
            outputTokens: Number(codexUsageRaw.completion_tokens) || 0,
            totalTokens:
              Number(codexUsageRaw.total_tokens) ||
              (Number(codexUsageRaw.prompt_tokens) || 0) +
                (Number(codexUsageRaw.completion_tokens) || 0)
          }
        : null;
      return {
        ok,
        status: codexRes.status,
        latencyMs: Date.now() - started,
        model: codexReq.resolvedModel,
        ...(codexReply ? { reply: codexReply } : {}),
        ...(codexUsage && codexUsage.totalTokens > 0 ? { usage: codexUsage } : {}),
        message: ok
          ? `Connected using model '${codexReq.resolvedModel}'${
              codexReply ? ` ("${codexReply.slice(0, 60)}")` : ""
            }`
          : sanitizeSecrets(
              folded?.error?.message || codexText.slice(0, 200) || `HTTP ${codexRes.status}`,
              secrets
            )
      };
    }

    if (isKimiOAuth && resolvedSecret && !isLoopbackBase) {
      if (!requestedModel) {
        try {
          const isOAuth = keyEntry.authMethod === "oauth2" && Boolean(keyEntry.oauthCredentials);
          const usage = await fetchKimiOAuthUsage(isOAuth ? resolvedSecret : "", isOAuth ? "" : resolvedSecret, {
            deviceId: keyEntry?.oauthMeta?.deviceId || "",
            ...(dispatcher ? { dispatcher } : {})
          });
          clearTimeout(timer);
          return {
            ok: Boolean(usage.planOk || usage.quotaOk),
            status: 200,
            latencyMs: Date.now() - started,
            message: `Connected (${usage.tierLabel} · ${(usage.models || []).length} models)`,
            modelsCount: (usage.models || []).length,
            oauthMeta: mergeCloudCodeUsage(keyEntry.oauthMeta, usage, new Date().toISOString())
          };
        } catch (err) {
          clearTimeout(timer);
          return {
            ok: false,
            status: Number(err?.status) || 0,
            latencyMs: Date.now() - started,
            message: sanitizeSecrets(err?.message || "Kimi OAuth connection failed", secrets)
          };
        }
      }

      const kimiBase = String(provider.baseUrl || "").toLowerCase().includes("moonshot.cn")
        ? KIMI_CODING_BASE_URL
        : provider.baseUrl;
      const kimiHeaders = {
        ...buildKimiHeaders(keyEntry?.oauthMeta?.deviceId || ""),
        ...headers,
        "content-type": "application/json"
      };
      const kimiUrl = buildUpstreamUrl(
        kimiBase,
        provider.formatType,
        provider.formatType === "anthropic" ? "messages" : "chat/completions"
      );
      const kimiRes = await fetch(kimiUrl, {
        method: "POST",
        headers: kimiHeaders,
        body: JSON.stringify({
          model: requestedModel,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply OK" }]
        }),
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {})
      });
      const kimiText = await kimiRes.text().catch(() => "");
      clearTimeout(timer);
      const { reply: kimiReply, usage: kimiUsage } = kimiRes.ok
        ? extractProbeReplyAndUsage(kimiText, provider.formatType === "anthropic")
        : { reply: "", usage: null };
      return {
        ok: kimiRes.ok,
        status: kimiRes.status,
        latencyMs: Date.now() - started,
        model: requestedModel,
        ...(kimiReply ? { reply: kimiReply } : {}),
        ...(kimiUsage ? { usage: kimiUsage } : {}),
        message: kimiRes.ok
          ? `Connected using model '${requestedModel}'${
              kimiReply ? ` ("${kimiReply.slice(0, 60)}")` : ""
            }`
          : sanitizeSecrets(kimiText.slice(0, 200) || `HTTP ${kimiRes.status}`, secrets)
      };
    }

    const skipAltAuth = isClaudeOAuth || isCodexOAuth || isKimiOAuth;

    if (!requestedModel) {
      const modelsUrl = buildUpstreamUrl(
        provider.baseUrl,
        provider.formatType,
        "models"
      );
      let modelsRes = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {})
      });

      if ((modelsRes.status === 401 || modelsRes.status === 403) && resolvedSecret && !skipAltAuth) {
        const altHeaders = buildAlternateAuthHeaders(headers, resolvedSecret);
        if (altHeaders) {
          const retryRes = await fetch(modelsUrl, {
            method: "GET",
            headers: altHeaders,
            signal: controller.signal,
            ...(dispatcher ? { dispatcher } : {})
          });
          if (retryRes.ok) {
            modelsRes = retryRes;
          }
        }
      }

      if (modelsRes.ok) {
        const data = await modelsRes.json().catch(() => ({}));
        clearTimeout(timer);
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.models)
            ? data.models
            : [];
        const fetchedIds = list
          .map((m) => {
            if (typeof m === "string") return m.trim();
            const rawId = String(m?.id || m?.name || "").trim();
            if (provider.preset === "gemini" && rawId.startsWith("models/")) {
              return rawId.slice("models/".length);
            }
            return rawId;
          })
          .filter(Boolean);
        if (fetchedIds.length > 0 && !keyEntry.isAnonymous && keyEntry.id) {
          await persistDiscoveredPackageModels(storage, provider.id, keyEntry.id, fetchedIds).catch(
            () => {}
          );
        }
        return {
          ok: true,
          status: modelsRes.status,
          latencyMs: Date.now() - started,
          message: `Connected (${list.length} models available)`,
          modelsCount: list.length
        };
      }

      if (modelsRes.status !== 404 && modelsRes.status !== 405 && modelsRes.status !== 501) {
        const errText = await modelsRes.text().catch(() => "");
        clearTimeout(timer);
        return {
          ok: false,
          status: modelsRes.status,
          latencyMs: Date.now() - started,
          message: sanitizeSecrets(
            errText.slice(0, 200) || `HTTP ${modelsRes.status}`,
            secrets
          )
        };
      }

      if (saOptions?.zeroToken === true) {
        clearTimeout(timer);
        return {
          ok: true,
          status: modelsRes.status,
          latencyMs: Date.now() - started,
          zeroToken: true,
          message: "Endpoint reachable (0 tokens spent)"
        };
      }
    }

    if (saOptions?.zeroToken === true) {
      clearTimeout(timer);
      return {
        ok: true,
        status: 200,
        latencyMs: Date.now() - started,
        zeroToken: true,
        message: "Connection verified (0 tokens spent)"
      };
    }

    const testModel = requestedModel || provider.models?.[0] || "gpt-4o-mini";
    const isAnthropic = provider.formatType === "anthropic";
    const testUrl = buildUpstreamUrl(
      provider.baseUrl,
      provider.formatType,
      isAnthropic ? "messages" : "chat/completions"
    );
    const usesMaxCompletionTokens =
      !isAnthropic &&
      (provider.preset === "openai" || /openai\.com/i.test(String(provider.baseUrl || ""))) &&
      /^(o1|o3|o4|gpt-5|gpt-6)/i.test(testModel);
    const testPayload = {
      model: testModel,
      ...(usesMaxCompletionTokens ? { max_completion_tokens: 16 } : { max_tokens: 16 }),
      messages: [{ role: "user", content: "Reply with the single word OK." }]
    };

    let chatRes = await fetch(testUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(testPayload),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    });
    if ((chatRes.status === 401 || chatRes.status === 403) && resolvedSecret && !skipAltAuth) {
      const altHeaders = buildAlternateAuthHeaders(headers, resolvedSecret);
      if (altHeaders) {
        const retryChatRes = await fetch(testUrl, {
          method: "POST",
          headers: { ...altHeaders, "content-type": "application/json" },
          body: JSON.stringify(testPayload),
          signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {})
        });
        if (retryChatRes.ok) {
          chatRes = retryChatRes;
        }
      }
    }
    const errOrOkText = await chatRes.text().catch(() => "");
    clearTimeout(timer);

    const { reply: chatReply, usage: chatUsage } = chatRes.ok
      ? extractProbeReplyAndUsage(errOrOkText, isAnthropic)
      : { reply: "", usage: null };

    return {
      ok: chatRes.ok,
      status: chatRes.status,
      latencyMs: Date.now() - started,
      model: testModel,
      ...(chatReply ? { reply: chatReply } : {}),
      ...(chatUsage ? { usage: chatUsage } : {}),
      message: chatRes.ok
        ? `Connected using model '${testModel}'${
            chatReply ? ` ("${chatReply.slice(0, 60)}")` : ""
          }`
        : sanitizeSecrets(
            errOrOkText.slice(0, 200) || `HTTP ${chatRes.status}`,
            secrets
          )
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      message: sanitizeSecrets(
        err?.message || "Connection failed",
        collectProviderSecrets(provider, resolvedSecret)
      )
    };
  }
}

/**
 * Validate and normalize a quota budget limit field (`null` or non-negative integer).
 * @param {unknown} raw
 * @param {string} fieldName
 */
function parseQuotaLimit(raw, fieldName) {
  if (raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return { ok: true, value: Math.floor(raw) };
  }
  return {
    ok: false,
    error: `${fieldName} must be null or a non-negative number`
  };
}

/**
 * Create the Express router mounted at `/api`.
 * @param {import("../storage.js").Storage} storage
 */
export function createDashboardRouter(storage, liveEvents = null) {
  const router = express.Router();
  const loginLimiter = createLoginRateLimiter();
  const sensitiveCryptoRateLimit = createRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: Number(process.env.ROUTER001_SENSITIVE_RPM) || 25,
    message: "Too many sensitive security operations. Please wait a minute and retry."
  });
  const heavyProbeRateLimit = createRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: Number(process.env.ROUTER001_PROBE_RPM) || 30,
    message: "Too many bulk provider probes. Please wait a moment and retry."
  });

  // --- Public Auth Endpoints ---

  router.post("/login", async (req, res) => {
    const clientIp = extractClientIp(req);
    const rateCheck = loginLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader("Retry-After", String(rateCheck.retryAfterSec));
      return res.status(429).json({
        error: "Too many failed login attempts. Try again later.",
        retryAfterSec: rateCheck.retryAfterSec
      });
    }

    const body = req.body || {};
    const password = typeof body.password === "string" ? body.password : "";
    const storedHash = storage.getPasswordHash();

    // Always execute bcrypt.compare for constant-time resistance even on empty password
    const compareOutcome = await bcrypt.compare(password || "\0", storedHash);
    const valid = Boolean(password) && compareOutcome;

    if (!valid) {
      const failure = loginLimiter.recordFailure(clientIp);
      return res.status(401).json({
        error: "Invalid password",
        ...(failure.retryAfterSec > 0
          ? { locked: true, retryAfterSec: failure.retryAfterSec }
          : {})
      });
    }

    loginLimiter.recordSuccess(clientIp);
    const token = signSessionToken(
      storage.getSessionSecret(),
      SESSION_TTL_MS,
      storage.getSessionVersion()
    );
    res.cookie(
      SESSION_COOKIE_NAME,
      token,
      buildSessionCookieOptions(req, SESSION_TTL_MS)
    );
    return res.json({
      ok: true,
      defaultPassword: storage.isDefaultPasswordSync(),
      ...(isPasswordChangeRequired(storage) ? { passwordChangeRequired: true } : {})
    });
  });

  router.post("/logout", async (req, res) => {
    if (isDashboardAuthenticated(req, storage)) {
      await storage.bumpSessionVersion();
    }
    res.clearCookie(
      SESSION_COOKIE_NAME,
      buildSessionCookieOptions(req, undefined)
    );
    return res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const loginRequired = isDashboardLoginRequired(storage, req);
    if (!loginRequired || isDashboardAuthenticated(req, storage)) {
      return res.json({
        authenticated: true,
        defaultPassword: storage.isDefaultPasswordSync(),
        ...(isPasswordChangeRequired(storage) ? { passwordChangeRequired: true } : {}),
        ...(!loginRequired ? { requireLogin: false } : {})
      });
    }
    return res.status(401).json({
      authenticated: false,
      error: "Unauthorized"
    });
  });

  // Local CLI-only password recovery: requires the host's .cli-token over loopback
  router.post("/auth/reset-password", sensitiveCryptoRateLimit, async (req, res) => {
    if (!isValidLocalCliRequest(req)) {
      return res.status(403).json({
        error: "Password reset is only permitted from the local CLI on loopback with a valid CLI token"
      });
    }
    const defaultHash = await bcrypt.hash("1234", 10);
    await storage.setPasswordHash(defaultHash);
    return res.json({ ok: true, message: "Dashboard password reset to default (1234)" });
  });

  // Password-verified connect handshake for 001Router IDE extensions (VS Code / Antigravity IDE)
  router.post("/extension/connect", async (req, res) => {
    const clientIp = extractClientIp(req);
    const rateCheck = loginLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader("Retry-After", String(rateCheck.retryAfterSec));
      return res.status(429).json({
        error: "Quá nhiều lần nhập sai mật khẩu. Vui lòng thử lại sau.",
        retryAfterSec: rateCheck.retryAfterSec
      });
    }

    const body = req.body || {};
    const password = typeof body.password === "string" ? body.password : "";
    const clientNameRaw = typeof body.clientName === "string" ? body.clientName.trim() : "";
    const clientName = clientNameRaw ? clientNameRaw.slice(0, 64) : "001Router VS Code Extension";
    const storedHash = storage.getPasswordHash();

    // Always execute bcrypt.compare for constant-time resistance
    const compareOutcome = await bcrypt.compare(password || "\0", storedHash);
    const valid = Boolean(password) && compareOutcome;

    if (!valid) {
      const failure = loginLimiter.recordFailure(clientIp);
      return res.status(401).json({
        error: "Mật khẩu web 001Router không chính xác",
        ...(failure.retryAfterSec > 0
          ? { locked: true, retryAfterSec: failure.retryAfterSec }
          : {})
      });
    }

    loginLimiter.recordSuccess(clientIp);

    const keyVal = `sk-001r-${nanoid(24)}`;
    const { keyHash, prefix, last4 } = deriveRouterKeyFields(keyVal);
    const nowIso = new Date().toISOString();

    const storedKey = await storage.update((data) => {
      if (!Array.isArray(data.keys)) data.keys = [];
      const existing = data.keys.find((k) => k && k.name === clientName);
      if (existing) {
        existing.keyHash = keyHash;
        existing.prefix = prefix;
        existing.last4 = last4;
        existing.keyPreview = maskKey(keyVal);
        existing.enabled = true;
        delete existing.key;
        return existing;
      }
      const created = {
        id: nanoid(),
        name: clientName,
        keyHash,
        prefix,
        last4,
        keyPreview: maskKey(keyVal),
        enabled: true,
        requestCount: 0,
        lastUsedAt: null,
        createdAt: nowIso
      };
      data.keys.push(created);
      return created;
    });

    return res.json({
      ok: true,
      routerKey: keyVal,
      keyName: storedKey.name,
      catalog: buildExtensionCatalog(storage, storedKey)
    });
  });

  // --- Protected Dashboard Routes ---
  router.use(createDashboardAuthMiddleware(storage));

  // --- Providers ---

  router.get("/providers", (_req, res) => {
    const providers = storage.getProviders().map(toPublicProvider);
    return res.json({ providers, presets: PRESETS });
  });

  router.get("/providers/:id", (req, res) => {
    const provider =
      storage.getProviderById(req.params.id) ||
      storage.getProviderBySlug(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const presetDef = getPreset(provider.preset);
    const disabledModels = storage.getDisabledModels?.()[provider.slug] || [];
    return res.json({
      provider: toPublicProvider(provider),
      preset: presetDef,
      disabledModels
    });
  });

  router.post("/providers/:id/reset-cooldown", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const keyId = typeof req.body?.keyId === "string" ? req.body.keyId.trim() : "";
    const updated = await storage.update((data) => {
      const target = data.providers.find((p) => p.id === provider.id);
      if (!target) return null;
      for (const k of target.apiKeys || []) {
        if (!keyId || k.id === keyId) {
          k.cooldownUntil = null;
          delete k.lastError;
        }
      }
      target.updatedAt = new Date().toISOString();
      return target;
    });
    req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyId || null);
    return res.json({ ok: true, provider: toPublicProvider(updated) });
  });

  router.post("/providers/:id/custom-models", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const modelId = typeof req.body?.modelId === "string" ? req.body.modelId.trim() : "";
    if (!modelId) {
      return res.status(400).json({ error: "modelId is required" });
    }
    const updated = await storage.update((data) => {
      const target = data.providers.find((p) => p.id === provider.id);
      if (!target) return null;
      if (!Array.isArray(target.models)) target.models = [];
      if (!target.models.includes(modelId)) {
        target.models.push(modelId);
      }
      target.updatedAt = new Date().toISOString();
      return target;
    });
    return res.status(201).json({ ok: true, provider: toPublicProvider(updated) });
  });

  router.delete("/providers/:id/custom-models/{*modelId}", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const rawId = Array.isArray(req.params.modelId)
      ? req.params.modelId.join("/")
      : String(req.params.modelId || "");
    const modelId = decodeURIComponent(rawId).trim();
    const updated = await storage.update((data) => {
      const target = data.providers.find((p) => p.id === provider.id);
      if (!target) return null;
      target.models = (target.models || []).filter((m) => m !== modelId);
      target.updatedAt = new Date().toISOString();
      return target;
    });
    return res.json({ ok: true, provider: toPublicProvider(updated) });
  });

  router.post("/providers", async (req, res) => {
    const body = req.body || {};
    const presetKey = typeof body.preset === "string" ? body.preset.trim() : "custom";
    const presetDef = getPreset(presetKey);
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : presetDef?.name || "";

    if (!name) {
      return res.status(400).json({ error: "Provider name is required" });
    }

    const rawBaseUrl =
      typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl
        : presetDef?.baseUrl || "";
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return res.status(400).json({ error: "Invalid baseUrl" });
    }
    const ssrfCheck = validateProviderBaseUrl(baseUrl, {
      preset: presetKey,
      category: presetDef?.category,
      allowPrivateUpstreams: storage.getSettings().allowPrivateUpstreams
    });
    if (!ssrfCheck.valid) {
      return res.status(400).json({ error: ssrfCheck.error || "Invalid baseUrl" });
    }

    const formatType =
      typeof body.formatType === "string" && body.formatType.trim()
        ? body.formatType.trim()
        : presetDef?.formatType || "openai";
    if (!VALID_FORMAT_TYPES.has(formatType)) {
      return res.status(400).json({ error: "Invalid formatType" });
    }

    const existingProviders = storage.getProviders();
    let slug = "";
    if (typeof body.slug === "string" && body.slug.trim()) {
      slug = slugify(body.slug);
      if (!slug) {
        return res.status(400).json({ error: "Invalid provider slug" });
      }
      if (existingProviders.some((p) => p.slug === slug)) {
        return res.status(400).json({ error: `Provider slug '${slug}' already exists` });
      }
    } else {
      const baseSlug =
        slugify(presetKey !== "custom" ? presetKey : name) || "provider";
      slug = baseSlug;
      let suffix = 2;
      while (existingProviders.some((p) => p.slug === slug)) {
        slug = `${baseSlug}-${suffix++}`;
      }
    }

    const apiKeys = normalizeNewApiKeys(body.apiKeys || []);
    const models = Array.isArray(body.models)
      ? [
          ...new Set(
            body.models
              .filter((m) => typeof m === "string" && m.trim())
              .map((m) => m.trim())
          )
        ]
      : [...(presetDef?.models || presetDef?.defaultModels || [])];

    const now = new Date().toISOString();
    const provider = {
      id: nanoid(),
      slug,
      preset: presetKey || "custom",
      name,
      baseUrl,
      formatType,
      apiKeys,
      models,
      proxyPoolId:
        typeof body.proxyPoolId === "string" && body.proxyPoolId.trim()
          ? body.proxyPoolId.trim()
          : null,
      enabled: body.enabled !== false,
      createdAt: now,
      updatedAt: now
    };

    await storage.update((data) => {
      data.providers.push(provider);
    });

    const syncedProvider =
      body.autoSyncModels === false
        ? provider
        : (await autoSyncProviderPackageModels(provider, storage, {
            forceSync: body.autoSyncModels === true || req.app?.locals?.autoSyncModels === true,
            fetchImpl: req.app?.locals?.autoSyncFetchImpl,
            routerService: req.app?.locals?.routerService || null
          })) || provider;

    return res.status(201).json({ provider: toPublicProvider(syncedProvider) });
  });

  router.post("/providers/test-all", heavyProbeRateLimit, async (req, res) => {
    const body = req.body || {};
    const categoryFilter =
      typeof body.category === "string" && body.category.trim()
        ? body.category.trim().toLowerCase()
        : "";
    const providerIdSet =
      Array.isArray(body.providerIds) && body.providerIds.length > 0
        ? new Set(body.providerIds.filter((id) => typeof id === "string" && id.trim()))
        : null;

    let targets = storage.getProviders();
    if (providerIdSet) {
      targets = targets.filter((p) => providerIdSet.has(p.id));
    }
    if (categoryFilter) {
      targets = targets.filter((p) => {
        const presetCat = (getPreset(p.preset)?.category || "custom").toLowerCase();
        return presetCat === categoryFilter;
      });
    }

    const saOptions = extractServiceAccountOptions(req);
    const results = await mapWithConcurrency(
      targets,
      TEST_ALL_CONCURRENCY,
      async (provider) => {
        const outcome = await runProviderConnectionTest(provider, storage, "", saOptions);
        return {
          providerId: provider.id,
          slug: provider.slug,
          name: provider.name,
          ...outcome
        };
      }
    );

    return res.json({ results });
  });

  // --- Official Provider Connection Mode 2: JSON / Google Vertex AI Service Account JSON ---

  router.post("/providers/connect-json", async (req, res) => {
    const body = req.body || {};
    const rawJsonInput =
      body.jsonText !== undefined && body.jsonText !== null
        ? body.jsonText
        : body.json;
    if (
      rawJsonInput === undefined ||
      rawJsonInput === null ||
      (typeof rawJsonInput === "string" && !rawJsonInput.trim())
    ) {
      return res.status(400).json({ error: "Missing 'jsonText' or 'json' payload" });
    }

    const saOptions = extractServiceAccountOptions(req);
    const requestedPreset =
      typeof body.preset === "string" ? body.preset.trim() : "";
    const requestedLocation =
      typeof body.location === "string" ? body.location.trim() : "";
    const requestedPresetDef = requestedPreset ? getPreset(requestedPreset) : null;

    let parsed;
    try {
      parsed = parseProviderCredentialJson(rawJsonInput, {
        preset: requestedPreset || undefined,
        location: requestedLocation || undefined,
        allowLoopbackTokenUri: saOptions.allowLoopbackTokenUri,
        keyOptional: Boolean(requestedPresetDef?.keyOptional)
      });
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: sanitizeSecrets(err?.message || "Invalid credential JSON") });
    }

    if (parsed.mode === "google_oauth_client") {
      const googleOpts = extractGoogleOAuthOptions(req);
      try {
        const started = startGoogleOAuthPkce({
          clientId: parsed.clientId,
          clientSecret: parsed.clientSecret,
          projectId: parsed.projectId,
          callbackUrl: body.callbackUrl || "http://127.0.0.1:20128/providers",
          ...(googleOpts.authBaseUrl ? { authBaseUrl: googleOpts.authBaseUrl } : {}),
          requestHost: typeof req.headers?.host === "string" ? req.headers.host : ""
        });
        return res.json({
          ok: true,
          mode: "google_oauth_client",
          requiresOAuthRedirect: true,
          ...started
        });
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error: sanitizeSecrets(
            err?.message || "Failed to start Google OAuth PKCE flow",
            [parsed.clientSecret].filter(Boolean)
          )
        });
      }
    }

    const effectivePreset =
      requestedPreset ||
      (parsed.mode === "service_account"
        ? "vertex"
        : parsed.mode === "google_authorized_user"
          ? "gemini"
          : "custom");
    const presetDef = getPreset(effectivePreset);
    const existingProviders = storage.getProviders();

    let targetExisting = null;
    if (typeof body.providerId === "string" && body.providerId.trim()) {
      targetExisting = storage.getProviderById(body.providerId.trim());
      if (!targetExisting) {
        return res.status(404).json({ error: "Provider not found" });
      }
    } else if (typeof body.slug === "string" && body.slug.trim()) {
      const requestedSlug = slugify(body.slug);
      if (!requestedSlug) {
        return res.status(400).json({ error: "Invalid provider slug" });
      }
      targetExisting = existingProviders.find((p) => p.slug === requestedSlug) || null;
    } else if (
      effectivePreset !== "custom" &&
      effectivePreset !== "custom-openai" &&
      effectivePreset !== "custom-anthropic"
    ) {
      targetExisting =
        existingProviders.find(
          (p) => p.preset === effectivePreset || p.slug === effectivePreset
        ) || null;
    } else if (parsed.slug) {
      const parsedSlug = slugify(parsed.slug);
      if (parsedSlug) {
        targetExisting = existingProviders.find((p) => p.slug === parsedSlug) || null;
      }
    }

    const explicitBaseUrl =
      typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : "";
    let rawBaseUrl = "";
    if (targetExisting) {
      if (explicitBaseUrl) {
        rawBaseUrl = explicitBaseUrl;
      } else if (parsed.mode === "config_json" && parsed.baseUrl) {
        rawBaseUrl = parsed.baseUrl;
      } else if (
        parsed.suggestedBaseUrl &&
        (!targetExisting.baseUrl || hasBaseUrlTemplatePlaceholder(targetExisting.baseUrl))
      ) {
        rawBaseUrl = parsed.suggestedBaseUrl;
      } else {
        rawBaseUrl = targetExisting.baseUrl;
      }
    } else {
      rawBaseUrl =
        explicitBaseUrl ||
        parsed.baseUrl ||
        parsed.suggestedBaseUrl ||
        presetDef?.baseUrl ||
        "";
    }

    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    if (!baseUrl || !isValidHttpUrl(baseUrl)) {
      return res.status(400).json({ error: "Invalid or missing baseUrl" });
    }

    const effPresetForSsrf = targetExisting?.preset || effectivePreset;
    const ssrfCheck = validateProviderBaseUrl(baseUrl, {
      preset: effPresetForSsrf,
      category: getPreset(effPresetForSsrf)?.category,
      allowPrivateUpstreams: storage.getSettings().allowPrivateUpstreams
    });
    if (!ssrfCheck.valid) {
      return res.status(400).json({ error: ssrfCheck.error || "Invalid baseUrl" });
    }

    const formatType =
      (typeof body.formatType === "string" && body.formatType.trim()) ||
      parsed.formatType ||
      parsed.suggestedFormatType ||
      targetExisting?.formatType ||
      presetDef?.formatType ||
      "openai";
    if (!VALID_FORMAT_TYPES.has(formatType)) {
      return res.status(400).json({ error: "Invalid formatType" });
    }

    const name =
      (typeof body.name === "string" && body.name.trim()) ||
      parsed.name ||
      targetExisting?.name ||
      presetDef?.name ||
      effectivePreset;

    const incomingLabel = typeof body.label === "string" ? body.label.trim() : "";
    const newKeyEntries =
      parsed.mode === "service_account"
        ? [
            {
              id: nanoid(),
              label:
                incomingLabel ||
                parsed.serviceAccountMeta.clientEmail ||
                "Vertex Service Account",
              key: "",
              authMethod: "service_account",
              serviceAccountJson: parsed.serviceAccountJson,
              serviceAccountMeta: { ...parsed.serviceAccountMeta },
              enabled: true,
              cooldownUntil: null
            }
          ]
        : parsed.mode === "google_authorized_user"
          ? [
              {
                id: nanoid(),
                label:
                  incomingLabel ||
                  parsed.oauthMeta?.email ||
                  "Google ADC Authorized User",
                key: "",
                authMethod: "google_oauth",
                oauthCredentials: parsed.oauthCredentials,
                oauthMeta: { ...parsed.oauthMeta },
                enabled: true,
                cooldownUntil: null
              }
            ]
          : (parsed.apiKeys || []).map((item) => ({
              id: nanoid(),
              label: incomingLabel || item.label || "Imported JSON Key",
              key: item.key,
              authMethod: "api_key",
              enabled: item.enabled !== false,
              cooldownUntil: null
            }));

    const bodyModels = Array.isArray(body.models)
      ? body.models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim())
      : [];
    const parsedModels = Array.isArray(parsed.models) ? parsed.models : [];

    const now = new Date().toISOString();
    const savedProvider = await storage.update((data) => {
      if (targetExisting) {
        const target = data.providers.find((p) => p.id === targetExisting.id);
        if (!target) return null;
        target.baseUrl = baseUrl;
        target.formatType = formatType;
        if (typeof body.name === "string" && body.name.trim()) {
          target.name = body.name.trim();
        }
        if (!Array.isArray(target.apiKeys)) {
          target.apiKeys = [];
        }
        target.apiKeys.push(...newKeyEntries);
        if (bodyModels.length > 0 || parsedModels.length > 0) {
          target.models = [
            ...new Set([...(target.models || []), ...parsedModels, ...bodyModels])
          ];
        }
        target.updatedAt = now;
        return target;
      }

      let slug = "";
      const explicitSlug =
        (typeof body.slug === "string" && body.slug.trim()) || parsed.slug || "";
      if (explicitSlug) {
        slug = slugify(explicitSlug);
        if (!slug) {
          return { _error: { status: 400, message: "Invalid provider slug" } };
        }
        if (data.providers.some((p) => p.slug === slug)) {
          let suffix = 2;
          const base = slug;
          while (data.providers.some((p) => p.slug === slug)) {
            slug = `${base}-${suffix++}`;
          }
        }
      } else {
        const baseSlug =
          slugify(effectivePreset !== "custom" ? effectivePreset : name) || "provider";
        slug = baseSlug;
        let suffix = 2;
        while (data.providers.some((p) => p.slug === slug)) {
          slug = `${baseSlug}-${suffix++}`;
        }
      }

      const models =
        bodyModels.length > 0 || parsedModels.length > 0
          ? [...new Set([...parsedModels, ...bodyModels])]
          : [...(presetDef?.models || presetDef?.defaultModels || [])];

      const created = {
        id: nanoid(),
        slug,
        preset: effectivePreset,
        name,
        baseUrl,
        formatType,
        apiKeys: newKeyEntries,
        models,
        proxyPoolId:
          typeof body.proxyPoolId === "string" && body.proxyPoolId.trim()
            ? body.proxyPoolId.trim()
            : null,
        enabled: body.enabled !== false,
        createdAt: now,
        updatedAt: now
      };
      data.providers.push(created);
      return created;
    });

    if (!savedProvider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    if (savedProvider._error) {
      return res
        .status(savedProvider._error.status)
        .json({ error: savedProvider._error.message });
    }

    const finalProvider =
      body.autoSyncModels === false
        ? savedProvider
        : (await autoSyncProviderPackageModels(savedProvider, storage, {
            forceSync: body.autoSyncModels === true || req.app?.locals?.autoSyncModels === true,
            fetchImpl: req.app?.locals?.autoSyncFetchImpl,
            routerService: req.app?.locals?.routerService || null
          })) || savedProvider;

    return res.json({
      ok: true,
      mode: parsed.mode,
      provider: toPublicProvider(finalProvider)
    });
  });

  // --- Official Provider Connection Mode 3: OpenRouter Official OAuth PKCE ---

  router.post("/providers/oauth/openrouter/start", (req, res) => {
    const body = req.body || {};
    const authBaseUrl = req.app?.locals?.oauthAuthBaseUrl || undefined;
    try {
      const started = startOpenRouterPkce({
        callbackUrl: body.callbackUrl,
        ...(authBaseUrl ? { authBaseUrl } : {}),
        requestHost: typeof req.headers?.host === "string" ? req.headers.host : ""
      });
      return res.json({
        ok: true,
        ...started
      });
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: sanitizeSecrets(err?.message || "Failed to start OpenRouter OAuth PKCE") });
    }
  });

  router.post("/providers/oauth/openrouter/exchange", async (req, res) => {
    const body = req.body || {};
    const existingOr =
      storage
        .getProviders()
        .find((p) => p.preset === "openrouter" || p.slug === "openrouter") || null;
    const dispatcher = existingOr ? getProxyDispatcher(existingOr, storage) : undefined;
    const exchangeUrl = req.app?.locals?.oauthExchangeUrl || undefined;
    const fetchImpl = req.app?.locals?.oauthFetchImpl || undefined;

    let extracted;
    try {
      extracted = body.pastedUrl
        ? extractCodeAndState(body)
        : { code: body.code, state: body.state };
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: sanitizeSecrets(err?.message || "Invalid OpenRouter callback URL") });
    }

    let mintedKey;
    try {
      const exchanged = await exchangeOpenRouterPkce({
        code: extracted.code,
        state: extracted.state,
        ...(exchangeUrl ? { exchangeUrl } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(dispatcher ? { dispatcher } : {})
      });
      mintedKey = exchanged.key;
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: sanitizeSecrets(err?.message || "OpenRouter OAuth PKCE exchange failed") });
    }

    const now = new Date().toISOString();
    const keyEntry = {
      id: nanoid(),
      label: "OpenRouter OAuth PKCE",
      key: mintedKey,
      authMethod: "oauth_pkce",
      enabled: true,
      cooldownUntil: null
    };

    const savedProvider = await storage.update((data) => {
      const target = data.providers.find(
        (p) => p.preset === "openrouter" || p.slug === "openrouter"
      );
      if (target) {
        if (!Array.isArray(target.apiKeys)) {
          target.apiKeys = [];
        }
        target.apiKeys.push(keyEntry);
        target.updatedAt = now;
        return target;
      }

      const orPreset = getPreset("openrouter");
      let slug = "openrouter";
      let suffix = 2;
      while (data.providers.some((p) => p.slug === slug)) {
        slug = `openrouter-${suffix++}`;
      }

      const created = {
        id: nanoid(),
        slug,
        preset: "openrouter",
        name: orPreset?.name || "OpenRouter",
        baseUrl: normalizeBaseUrl(orPreset?.baseUrl || "https://openrouter.ai/api/v1"),
        formatType: orPreset?.formatType || "openai",
        apiKeys: [keyEntry],
        models: [...(orPreset?.models || orPreset?.defaultModels || [])],
        proxyPoolId: null,
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.providers.push(created);
      return created;
    });

    return res.json({
      ok: true,
      provider: toPublicProvider(savedProvider)
    });
  });

  // --- Official Provider Connection Mode 4: Google Cloud OAuth 2.0 + PKCE (Bring Your Own Client) ---

  function resolveSavedGoogleOAuthClient() {
    const envClientId =
      typeof process.env.GOOGLE_OAUTH_CLIENT_ID === "string"
        ? process.env.GOOGLE_OAUTH_CLIENT_ID.trim()
        : "";
    const envClientSecret =
      typeof process.env.GOOGLE_OAUTH_CLIENT_SECRET === "string"
        ? process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim()
        : "";
    const envProjectId =
      typeof process.env.GOOGLE_OAUTH_PROJECT_ID === "string"
        ? process.env.GOOGLE_OAUTH_PROJECT_ID.trim()
        : "";
    if (envClientId && envClientSecret) {
      return {
        source: "env",
        clientId: envClientId,
        clientSecret: envClientSecret,
        projectId: envProjectId
      };
    }

    const encClient = storage.data?.googleOAuthClientEnc;
    if (typeof encClient === "string" && encClient.trim()) {
      try {
        const plain = storage.decryptSecret(encClient.trim());
        const parsed = JSON.parse(plain);
        const cid = typeof parsed?.clientId === "string" ? parsed.clientId.trim() : "";
        const csec = typeof parsed?.clientSecret === "string" ? parsed.clientSecret.trim() : "";
        const pid = typeof parsed?.projectId === "string" ? parsed.projectId.trim() : "";
        if (cid && csec) {
          return {
            source: "saved",
            clientId: cid,
            clientSecret: csec,
            projectId: pid
          };
        }
      } catch {
        // Ignore corrupted saved client entry
      }
    }

    for (const p of storage.getProviders()) {
      for (const k of p.apiKeys || []) {
        if (k.authMethod !== "google_oauth" || !k.oauthCredentials) continue;
        try {
          const creds =
            typeof k.oauthCredentials === "string"
              ? JSON.parse(k.oauthCredentials)
              : k.oauthCredentials;
          const cid = typeof creds?.clientId === "string" ? creds.clientId.trim() : "";
          const csec = typeof creds?.clientSecret === "string" ? creds.clientSecret.trim() : "";
          const pid = typeof creds?.projectId === "string" ? creds.projectId.trim() : "";
          if (cid && csec) {
            return {
              source: "saved",
              clientId: cid,
              clientSecret: csec,
              projectId: pid
            };
          }
        } catch {
          // ignore malformed credential entry
        }
      }
    }

    return null;
  }

  router.get("/providers/oauth/google/client-status", (_req, res) => {
    const saved = resolveSavedGoogleOAuthClient();
    return res.json({
      ok: true,
      configured: Boolean(saved),
      source: saved?.source || "none",
      clientIdPreview: saved ? maskKey(saved.clientId) : "",
      projectId: saved?.projectId || ""
    });
  });

  router.post("/providers/oauth/google/start", async (req, res) => {
    const body = req.body || {};
    const googleOpts = extractGoogleOAuthOptions(req);
    const clientSecretJson =
      body.clientSecretJson !== undefined ? body.clientSecretJson : body.jsonText;
    const hasExplicitCreds =
      Boolean(typeof body.clientId === "string" && body.clientId.trim()) ||
      Boolean(typeof body.clientSecret === "string" && body.clientSecret.trim()) ||
      Boolean(
        clientSecretJson !== undefined &&
          clientSecretJson !== null &&
          (typeof clientSecretJson !== "string" || clientSecretJson.trim())
      );

    let effectiveClientId = body.clientId;
    let effectiveClientSecret = body.clientSecret;
    let effectiveProjectId = body.projectId;
    let effectiveJson = clientSecretJson;
    let usedSaved = false;

    if (body.useSavedClient === true || !hasExplicitCreds) {
      const saved = resolveSavedGoogleOAuthClient();
      if (saved) {
        effectiveClientId = saved.clientId;
        effectiveClientSecret = saved.clientSecret;
        effectiveProjectId =
          (typeof body.projectId === "string" && body.projectId.trim()) || saved.projectId;
        effectiveJson = undefined;
        usedSaved = true;
      }
    }

    try {
      const started = startGoogleOAuthPkce({
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        projectId: effectiveProjectId,
        clientSecretJson: effectiveJson,
        callbackUrl: body.callbackUrl,
        selectAccount: body.selectAccount === true || usedSaved,
        ...(googleOpts.authBaseUrl ? { authBaseUrl: googleOpts.authBaseUrl } : {}),
        requestHost: typeof req.headers?.host === "string" ? req.headers.host : ""
      });

      // Persist user's OAuth client encrypted (AES-256-GCM) so future sign-ins are 1-click!
      if (!usedSaved && body.saveClient !== false) {
        try {
          let toSaveId = typeof effectiveClientId === "string" ? effectiveClientId.trim() : "";
          let toSaveSecret =
            typeof effectiveClientSecret === "string" ? effectiveClientSecret.trim() : "";
          let toSaveProject =
            typeof effectiveProjectId === "string" ? effectiveProjectId.trim() : "";
          if ((!toSaveId || !toSaveSecret) && effectiveJson) {
            const parsed = parseGoogleClientSecretJson(effectiveJson);
            toSaveId = toSaveId || parsed.clientId;
            toSaveSecret = toSaveSecret || parsed.clientSecret;
            toSaveProject = toSaveProject || parsed.projectId || "";
          }
          if (toSaveId && toSaveSecret) {
            const enc = storage.encryptSecret(
              JSON.stringify({
                clientId: toSaveId,
                clientSecret: toSaveSecret,
                projectId: toSaveProject
              })
            );
            await storage.update((data) => {
              data.googleOAuthClientEnc = enc;
            });
          }
        } catch {
          // Best-effort client save; never block authUrl generation
        }
      }

      // Persist encrypted PKCE state in storage so multi-instance serverless (Vercel) can complete callback
      try {
        const pkceRec = peekGooglePkceState(started.state);
        if (pkceRec) {
          const encPkce = storage.encryptSecret(JSON.stringify(pkceRec));
          const nowMs = Date.now();
          await storage.update((data) => {
            const list = Array.isArray(data.pendingGooglePkce) ? data.pendingGooglePkce : [];
            const pruned = list.filter((item) => item && item.expiresAt > nowMs && item.state !== started.state);
            pruned.push({ state: started.state, enc: encPkce, expiresAt: pkceRec.expiresAt });
            data.pendingGooglePkce = pruned.slice(-30);
          });
        }
      } catch {
        // Best-effort cross-instance PKCE persistence
      }

      return res.json({
        ok: true,
        usedSavedClient: usedSaved,
        ...started
      });
    } catch (err) {
      const secretsToRedact = [
        typeof body.clientSecret === "string" ? body.clientSecret : "",
        typeof effectiveClientSecret === "string" ? effectiveClientSecret : ""
      ].filter(Boolean);
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(
          err?.message || "Failed to start Google OAuth PKCE flow",
          secretsToRedact
        )
      });
    }
  });

  router.post("/providers/oauth/google/exchange", async (req, res) => {
    const body = req.body || {};
    const existingGemini =
      storage
        .getProviders()
        .find((p) => p.preset === "gemini" || p.slug === "gemini") || null;
    const dispatcher = existingGemini ? getProxyDispatcher(existingGemini, storage) : undefined;
    const googleOpts = extractGoogleOAuthOptions(req);

    let extractedInput;
    try {
      extractedInput = extractCodeAndState(body);
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "Invalid Google OAuth callback URL")
      });
    }

    // Always consume any persisted cross-instance PKCE record to prevent replay attacks
    if (extractedInput.state) {
      const targetState = extractedInput.state;
      const inMemory = Boolean(peekGooglePkceState(targetState));
      let restoredEnc = "";
      const hasPersisted =
        Array.isArray(storage.data?.pendingGooglePkce) &&
        storage.data.pendingGooglePkce.some((item) => item && item.state === targetState);
      if (hasPersisted) {
        await storage.update((data) => {
          const list = Array.isArray(data.pendingGooglePkce) ? data.pendingGooglePkce : [];
          const idx = list.findIndex((item) => item && item.state === targetState);
          if (idx >= 0) {
            restoredEnc = list[idx].enc || "";
            list.splice(idx, 1);
            data.pendingGooglePkce = list;
          }
        });
      }
      if (!inMemory && restoredEnc) {
        try {
          const rec = JSON.parse(storage.decryptSecret(restoredEnc));
          restoreGooglePkceState(targetState, rec);
        } catch {
          // Ignore malformed encrypted state
        }
      }
    }

    let exchanged;
    try {
      exchanged = await exchangeGoogleOAuthPkce({
        code: extractedInput.code,
        state: extractedInput.state,
        pastedUrl: body.pastedUrl,
        callbackUrl: body.callbackUrl,
        ...(googleOpts.tokenUrl ? { tokenUrl: googleOpts.tokenUrl } : {}),
        ...(googleOpts.userinfoUrl ? { userinfoUrl: googleOpts.userinfoUrl } : {}),
        ...(googleOpts.modelsUrl ? { modelsUrl: googleOpts.modelsUrl } : {}),
        ...(googleOpts.billingBaseUrl
          ? { billingBaseUrl: googleOpts.billingBaseUrl }
          : {}),
        ...(googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {}),
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "Google OAuth PKCE exchange failed")
      });
    }

    const now = new Date().toISOString();
    const oauthMeta = { ...exchanged.oauthMeta };
    const oauthCredentialsStr = JSON.stringify(exchanged.oauthCredentials);
    const label =
      (typeof body.label === "string" && body.label.trim()) ||
      oauthMeta.email ||
      "Google OAuth";

    let savedKeyId = "";
    const savedProvider = await storage.update((data) => {
      const target = data.providers.find(
        (p) => p.preset === "gemini" || p.slug === "gemini"
      );
      if (target) {
        if (!Array.isArray(target.apiKeys)) {
          target.apiKeys = [];
        }
        // Update matching Google OAuth account+project in place, or append new connection
        const existingKey = target.apiKeys.find(
          (k) =>
            k.authMethod === "google_oauth" &&
            oauthMeta.email &&
            k.oauthMeta?.email === oauthMeta.email &&
            (k.oauthMeta?.projectId || "") === (oauthMeta.projectId || "")
        );
        if (existingKey) {
          existingKey.label = label;
          existingKey.key = "";
          existingKey.authMethod = "google_oauth";
          existingKey.oauthCredentials = oauthCredentialsStr;
          existingKey.oauthMeta = oauthMeta;
          existingKey.enabled = true;
          existingKey.cooldownUntil = null;
          delete existingKey.lastError;
          savedKeyId = existingKey.id;
        } else {
          const newKey = {
            id: nanoid(),
            label,
            key: "",
            authMethod: "google_oauth",
            oauthCredentials: oauthCredentialsStr,
            oauthMeta,
            enabled: true,
            cooldownUntil: null
          };
          target.apiKeys.push(newKey);
          savedKeyId = newKey.id;
        }
        target.updatedAt = now;
        return target;
      }

      const geminiPreset = getPreset("gemini");
      let slug = "gemini";
      let suffix = 2;
      while (data.providers.some((p) => p.slug === slug)) {
        slug = `gemini-${suffix++}`;
      }

      const newKey = {
        id: nanoid(),
        label,
        key: "",
        authMethod: "google_oauth",
        oauthCredentials: oauthCredentialsStr,
        oauthMeta,
        enabled: true,
        cooldownUntil: null
      };
      savedKeyId = newKey.id;

      const created = {
        id: nanoid(),
        slug,
        preset: "gemini",
        name: geminiPreset?.name || "Google Gemini",
        baseUrl: normalizeBaseUrl(
          geminiPreset?.baseUrl ||
            "https://generativelanguage.googleapis.com/v1beta/openai"
        ),
        formatType: geminiPreset?.formatType || "gemini-openai",
        apiKeys: [newKey],
        models: [...(geminiPreset?.models || geminiPreset?.defaultModels || [])],
        proxyPoolId: null,
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.providers.push(created);
      return created;
    });

    return res.json({
      ok: true,
      keyId: savedKeyId,
      oauthMeta,
      provider: toPublicProvider(savedProvider)
    });
  });

  // --- Cloud Code Assist OAuth (Gemini CLI + Antigravity) — the 9router-style flow, web-safe ---
  /**
   * Register status/start/exchange/diagnose routes for one Cloud Code flavor.
   * @param {{ routeSlug: string, flavor: "gemini_cli" | "antigravity", preset: string, label: string }} cfg
   */
  function registerCloudCodeOAuthRoutes(cfg) {
    const flavor = getCloudCodeFlavor(cfg.flavor);
    const base = `/providers/oauth/${cfg.routeSlug}`;
    const findProvider = () =>
      storage.getProviders().find((p) => p.preset === cfg.preset || p.slug === cfg.preset) || null;

    router.get(`${base}/status`, (_req, res) => {
      return res.json({ ok: true, defaultRedirect: flavor.defaultRedirect, flavor: flavor.id });
    });

    router.post(`${base}/start`, async (req, res) => {
      const body = req.body || {};
      try {
        const started = startGeminiCliOAuth({
          flavor: flavor.id,
          callbackUrl: body.callbackUrl || flavor.defaultRedirect,
          selectAccount: body.selectAccount !== false,
          ...(typeof body.clientId === "string" && body.clientId.trim()
            ? { clientId: body.clientId.trim() }
            : {}),
          ...(typeof body.clientSecret === "string" && body.clientSecret.trim()
            ? { clientSecret: body.clientSecret.trim() }
            : {}),
          requestHost: typeof req.headers?.host === "string" ? req.headers.host : ""
        });

        // Persist the PKCE record so a different serverless instance can finish the exchange.
        try {
          const rec = peekGeminiCliState(started.state);
          if (rec) {
            const enc = storage.encryptSecret(JSON.stringify(rec));
            const nowMs = Date.now();
            await storage.update((data) => {
              const list = Array.isArray(data.pendingGeminiCliPkce) ? data.pendingGeminiCliPkce : [];
              const pruned = list.filter(
                (item) => item && item.expiresAt > nowMs && item.state !== started.state
              );
              pruned.push({ state: started.state, enc, expiresAt: rec.expiresAt });
              data.pendingGeminiCliPkce = pruned.slice(-30);
            });
          }
        } catch {
          // Best-effort persistence; single-instance local dev works without it.
        }

        return res.json({ ok: true, ...started });
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error: sanitizeSecrets(err?.message || `Failed to start ${cfg.label} OAuth`)
        });
      }
    });

    router.post(`${base}/exchange`, async (req, res) => {
      const body = req.body || {};
      const existing = findProvider();
      const dispatcher = existing ? getProxyDispatcher(existing, storage) : undefined;
      const googleOpts = extractGoogleOAuthOptions(req);

      let extracted;
      try {
        extracted = extractCodeAndState(body);
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error: sanitizeSecrets(err?.message || `Invalid ${cfg.label} callback URL`)
        });
      }

      // Restore a PKCE record persisted by another instance, then consume it (replay guard).
      if (extracted.state) {
        const targetState = extracted.state;
        const inMemory = Boolean(peekGeminiCliState(targetState));
        let restoredEnc = "";
        const hasPersisted =
          Array.isArray(storage.data?.pendingGeminiCliPkce) &&
          storage.data.pendingGeminiCliPkce.some((item) => item && item.state === targetState);
        if (hasPersisted) {
          await storage.update((data) => {
            const list = Array.isArray(data.pendingGeminiCliPkce) ? data.pendingGeminiCliPkce : [];
            const idx = list.findIndex((item) => item && item.state === targetState);
            if (idx >= 0) {
              restoredEnc = list[idx].enc || "";
              list.splice(idx, 1);
              data.pendingGeminiCliPkce = list;
            }
          });
        }
        if (!inMemory && restoredEnc) {
          try {
            restoreGeminiCliState(targetState, JSON.parse(storage.decryptSecret(restoredEnc)));
          } catch {
            // Ignore malformed encrypted state
          }
        }
      }

      let exchanged;
      try {
        exchanged = await exchangeGeminiCliOAuth({
          flavor: flavor.id,
          code: extracted.code,
          state: extracted.state,
          pastedUrl: body.pastedUrl,
          callbackUrl: body.callbackUrl,
          ...(googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {}),
          ...(googleOpts.tokenUrl ? { tokenUrl: googleOpts.tokenUrl } : {}),
          ...(dispatcher ? { dispatcher } : {})
        });
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error: sanitizeSecrets(err?.message || `${cfg.label} OAuth exchange failed`)
        });
      }

      const now = new Date().toISOString();
      const oauthMeta = { ...exchanged.oauthMeta };
      const oauthCredentialsStr = JSON.stringify(exchanged.oauthCredentials);
      const label =
        (typeof body.label === "string" && body.label.trim()) || oauthMeta.email || cfg.label;

      let savedKeyId = "";
      const savedProvider = await storage.update((data) => {
        const target = data.providers.find((p) => p.preset === cfg.preset || p.slug === cfg.preset);
        if (target) {
          if (!Array.isArray(target.apiKeys)) target.apiKeys = [];
          const existingKey = target.apiKeys.find(
            (k) =>
              k.authMethod === flavor.id &&
              oauthMeta.email &&
              k.oauthMeta?.email === oauthMeta.email
          );
          if (existingKey) {
            existingKey.label = label;
            existingKey.key = "";
            existingKey.authMethod = flavor.id;
            existingKey.oauthCredentials = oauthCredentialsStr;
            existingKey.oauthMeta = oauthMeta;
            existingKey.enabled = true;
            existingKey.cooldownUntil = null;
            delete existingKey.lastError;
            savedKeyId = existingKey.id;
          } else {
            const newKey = {
              id: nanoid(),
              label,
              key: "",
              authMethod: flavor.id,
              oauthCredentials: oauthCredentialsStr,
              oauthMeta,
              enabled: true,
              cooldownUntil: null
            };
            target.apiKeys.push(newKey);
            savedKeyId = newKey.id;
          }
          syncProviderModelsWithCatalog(target);
          target.updatedAt = now;
          return target;
        }

        const presetDef = getPreset(cfg.preset);
        let slug = cfg.preset;
        let suffix = 2;
        while (data.providers.some((p) => p.slug === slug)) slug = `${cfg.preset}-${suffix++}`;

        const newKey = {
          id: nanoid(),
          label,
          key: "",
          authMethod: flavor.id,
          oauthCredentials: oauthCredentialsStr,
          oauthMeta,
          enabled: true,
          cooldownUntil: null
        };
        savedKeyId = newKey.id;

        const created = {
          id: nanoid(),
          slug,
          preset: cfg.preset,
          name: presetDef?.name || cfg.label,
          baseUrl: normalizeBaseUrl(presetDef?.baseUrl || flavor.generateUrl),
          formatType: presetDef?.formatType || "gemini-openai",
          apiKeys: [newKey],
          models: [...(presetDef?.models || presetDef?.defaultModels || [])],
          proxyPoolId: null,
          enabled: true,
          createdAt: now,
          updatedAt: now
        };
        syncProviderModelsWithCatalog(created);
        data.providers.push(created);
        return created;
      });

      return res.json({
        ok: true,
        keyId: savedKeyId,
        oauthMeta,
        flavor: flavor.id,
        provider: toPublicProvider(savedProvider)
      });
    });

    // Re-read plan + quota from Google for every account of this flavor and store it on the key,
    // so the provider card shows the live plan and weekly / 5-hour windows.
    router.post(`${base}/refresh`, async (req, res) => {
      const provider = findProvider();
      const keys = (provider?.apiKeys || []).filter(
        (k) => k.enabled !== false && k.authMethod === flavor.id && k.oauthCredentials
      );
      if (keys.length === 0) {
        return res.status(404).json({
          error: `No ${cfg.label} connection found. Sign in with 'Đăng nhập ${cfg.label}' first.`
        });
      }

      const dispatcher = getProxyDispatcher(provider, storage);
      const googleOpts = extractGoogleOAuthOptions(req);
      const fetchOpts = googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {};
      const results = await Promise.all(
        keys.map(async (k) => {
          try {
            const { accessToken } = await getGeminiCliAccessToken(k.oauthCredentials, {
              ...fetchOpts,
              ...(googleOpts.tokenUrl ? { tokenUrlOverride: googleOpts.tokenUrl } : {}),
              ...(dispatcher ? { dispatcher } : {})
            });
            const usage = await fetchCloudCodeUsage(accessToken, {
              ...fetchOpts,
              ...(dispatcher ? { dispatcher } : {}),
              projectId: k.oauthMeta?.projectId || "",
              flavor: flavor.id
            });
            return { keyId: k.id, usage };
          } catch (err) {
            return { keyId: k.id, error: sanitizeSecrets(err?.message || "Refresh failed") };
          }
        })
      );

      const checkedAt = new Date().toISOString();
      await storage.update((data) => {
        const p = data.providers.find((x) => x.id === provider.id);
        for (const r of results) {
          const k = (p?.apiKeys || []).find((x) => x.id === r.keyId);
          if (!k || !r.usage) continue;
          k.oauthMeta = mergeCloudCodeUsage(k.oauthMeta, r.usage, checkedAt);
        }
        if (syncProviderModelsWithCatalog(p)) p.updatedAt = checkedAt;
      });

      const fresh = findProvider();
      return res.json({
        ok: true,
        flavor: flavor.id,
        accounts: results.map((r) => {
          const k = (fresh?.apiKeys || []).find((x) => x.id === r.keyId);
          return { keyId: r.keyId, oauthMeta: k?.oauthMeta || null, ...(r.error ? { error: r.error } : {}) };
        })
      });
    });

    // Diagnostics: shows exactly what Google answers during project discovery.
    router.post(`${base}/diagnose`, async (req, res) => {
      const body = req.body || {};
      const provider = findProvider();
      const keyEntry = (provider?.apiKeys || []).find(
        (k) => k.enabled !== false && k.authMethod === flavor.id && k.oauthCredentials
      );
      if (!keyEntry) {
        return res.status(404).json({
          error: `No ${cfg.label} connection found. Sign in with 'Đăng nhập ${cfg.label}' first.`
        });
      }

      const dispatcher = getProxyDispatcher(provider, storage);
      const googleOpts = extractGoogleOAuthOptions(req);
      const fetchOpts = googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {};
      const steps = [];
      let accessToken = "";

      try {
        const tokenRes = await getGeminiCliAccessToken(keyEntry.oauthCredentials, {
          ...fetchOpts,
          ...(googleOpts.tokenUrl ? { tokenUrlOverride: googleOpts.tokenUrl } : {}),
          ...(dispatcher ? { dispatcher } : {}),
          forceRefresh: body.forceRefresh === true
        });
        accessToken = tokenRes.accessToken;
        steps.push({
          step: "refreshToken",
          ok: true,
          projectIdInCreds: tokenRes.projectId || ""
        });
      } catch (err) {
        const message = sanitizeSecrets(err?.message || "Token refresh failed");
        return res.status(400).json({
          error: message,
          steps: [{ step: "refreshToken", ok: false, error: message }]
        });
      }

      // loadCodeAssist -> onboardUser -> quota, replaying the real sign-in flow and returning
      // Google's raw answers (see diagnoseGeminiCliConnection for the fidelity rules).
      const requestedTier =
        typeof body.tierId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.tierId.trim())
          ? body.tierId.trim()
          : "";
      const requestedProbe =
        typeof body.probeModel === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(body.probeModel.trim())
          ? body.probeModel.trim()
          : "";
      const chatProbeModel =
        body.chatProbe === false ? "" : requestedProbe || cfg.defaultProbeModel || "";
      let diagnosis;
      try {
        diagnosis = await diagnoseGeminiCliConnection(accessToken, {
          ...fetchOpts,
          ...(dispatcher ? { dispatcher } : {}),
          flavor: flavor.id,
          tierId: requestedTier,
          forceOnboard: body.forceOnboard === true,
          chatProbeModel
        });
      } catch (err) {
        return res.status(Number(err?.status) || 502).json({
          error: sanitizeSecrets(err?.message || `${cfg.label} diagnostics failed`),
          steps
        });
      }

      return res.json({
        ok: true,
        flavor: flavor.id,
        email: keyEntry.oauthMeta?.email || "",
        savedProjectId: keyEntry.oauthMeta?.projectId || "",
        savedTier: keyEntry.oauthMeta?.tier || "",
        discoveredProjectId: diagnosis.projectId,
        onboardTierId: diagnosis.tierId,
        steps: [...steps, ...diagnosis.steps]
      });
    });
  }

  registerCloudCodeOAuthRoutes({
    routeSlug: "gemini-cli",
    flavor: "gemini_cli",
    preset: "gemini",
    label: "Gemini CLI"
  });
  registerCloudCodeOAuthRoutes({
    routeSlug: "antigravity",
    flavor: "antigravity",
    preset: "antigravity",
    label: "Antigravity",
    // Diagnostics send one plain chat to this model (no system prompt, no tools).
    defaultProbeModel: "gemini-3.8-flash"
  });

  async function refreshGoogleOAuthConnection(provider, keyEntry, req) {
    const dispatcher = getProxyDispatcher(provider, storage);
    const googleOpts = extractGoogleOAuthOptions(req);
    let freshAccessToken = "";

    const { accessToken, projectId } = await getGoogleOAuthAccessToken(
      keyEntry.oauthCredentials,
      {
        ...(googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {}),
        ...(googleOpts.tokenUrl ? { tokenUrlOverride: googleOpts.tokenUrl } : {}),
        allowLoopbackTokenUri: googleOpts.allowLoopbackTokenUri,
        ...(dispatcher ? { dispatcher } : {}),
        forceRefresh: true
      }
    );
    freshAccessToken = accessToken;

    const updatedMeta = await inspectGoogleAccountAndPlan(accessToken, {
      projectId,
      ...(googleOpts.fetchImpl ? { fetchImpl: googleOpts.fetchImpl } : {}),
      ...(googleOpts.userinfoUrl ? { userinfoUrl: googleOpts.userinfoUrl } : {}),
      ...(googleOpts.modelsUrl ? { modelsUrl: googleOpts.modelsUrl } : {}),
      ...(googleOpts.billingBaseUrl ? { billingBaseUrl: googleOpts.billingBaseUrl } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });

    const updatedProvider = await storage.update((data) => {
      const target = data.providers.find((p) => p.id === provider.id);
      if (!target) return null;
      const targetKey = (target.apiKeys || []).find((k) => k.id === keyEntry.id);
      if (!targetKey) return null;
      targetKey.oauthMeta = { ...updatedMeta };
      targetKey.cooldownUntil = null;
      delete targetKey.lastError;
      target.updatedAt = new Date().toISOString();
      return target;
    });

    return { updatedProvider, updatedMeta, freshAccessToken };
  }

  router.post("/providers/:id/oauth/google/refresh-plan", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const body = req.body || {};
    const requestedKeyId =
      typeof body.keyId === "string" && body.keyId.trim() ? body.keyId.trim() : "";

    const oauthKeys = (provider.apiKeys || []).filter(
      (k) => k.authMethod === "google_oauth" && k.oauthCredentials
    );
    const keyEntry = requestedKeyId
      ? oauthKeys.find((k) => k.id === requestedKeyId) || null
      : oauthKeys.find((k) => k.enabled !== false) || oauthKeys[0] || null;

    if (!keyEntry) {
      return res
        .status(400)
        .json({ error: "No Google OAuth connection found on this provider" });
    }

    try {
      const { updatedProvider, updatedMeta } = await refreshGoogleOAuthConnection(
        provider,
        keyEntry,
        req
      );
      if (!updatedProvider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      return res.json({
        ok: true,
        keyId: keyEntry.id,
        oauthMeta: updatedMeta,
        provider: toPublicProvider(updatedProvider)
      });
    } catch (err) {
      return res.status(Number(err?.status) || 502).json({
        error: sanitizeSecrets(
          err?.message || "Failed to refresh Google OAuth account plan",
          collectProviderSecrets(provider)
        )
      });
    }
  });

  // --- Official Provider Connection Mode 5: OAuth 2.0 PKCE & RFC 8628 Device Code Flows ---
  // Supports OpenAI/Codex (`openai`/`codex`), Anthropic/Claude (`anthropic`/`claude`),
  // GitLab Duo (`gitlab`), Kilo Code (`kilocode`), Kimi (`kimi`), Nous Research (`nous`),
  // and BYO `custom_oauth`.

  const SUPPORTED_GENERIC_PKCE_PROVIDERS = new Set([
    "gitlab",
    "custom_oauth",
    "openai",
    "codex",
    "anthropic",
    "claude"
  ]);

  const SUPPORTED_DEVICE_CODE_PROVIDERS = new Set([
    "kilocode",
    "nous",
    "kimi",
    "kimi-coding",
    "custom_oauth"
  ]);

  function normalizeOAuthRouteProvider(raw) {
    const p = String(raw || "").trim().toLowerCase();
    return p === "custom" ? "custom_oauth" : p;
  }

  router.post("/providers/oauth/:provider/start", async (req, res) => {
    const oauthProvider = normalizeOAuthRouteProvider(req.params.provider);
    if (!SUPPORTED_GENERIC_PKCE_PROVIDERS.has(oauthProvider)) {
      return res.status(400).json({
        error: `Unsupported OAuth PKCE provider '${oauthProvider}'. Supported: openrouter, google, openai, anthropic, gitlab, custom_oauth`
      });
    }

    const body = req.body || {};
    const oauthOpts = extractOAuthFlowsOptions(req);
    try {
      const started = startGenericOAuthPkce(oauthProvider, {
        ...body,
        ...(oauthProvider === "gitlab" && !body.baseUrl && oauthOpts.gitlabBaseUrl
          ? { baseUrl: oauthOpts.gitlabBaseUrl }
          : {}),
        ...(!body.authorizeUrl && oauthOpts.authorizeUrlOverride
          ? { authorizeUrl: oauthOpts.authorizeUrlOverride }
          : {}),
        ...(!body.tokenUrl && oauthOpts.tokenUrlOverride
          ? { tokenUrl: oauthOpts.tokenUrlOverride }
          : {}),
        ...(!body.userinfoUrl && oauthOpts.userinfoUrlOverride
          ? { userinfoUrl: oauthOpts.userinfoUrlOverride }
          : {}),
        allowLoopback: oauthOpts.allowLoopback,
        requestHost: typeof req.headers?.host === "string" ? req.headers.host : ""
      });

      // Persist PKCE state encrypted so serverless instances can finish the exchange.
      try {
        const rec = peekGenericPkceState(started.state);
        if (rec) {
          const enc = storage.encryptSecret(JSON.stringify(rec));
          const nowMs = Date.now();
          await storage.update((data) => {
            const list = Array.isArray(data.pendingGenericPkce) ? data.pendingGenericPkce : [];
            const pruned = list.filter(
              (item) => item && item.expiresAt > nowMs && item.state !== started.state
            );
            pruned.push({ state: started.state, enc, expiresAt: rec.expiresAt });
            data.pendingGenericPkce = pruned.slice(-30);
          });
        }
      } catch {
        // Best-effort persistence
      }

      return res.json({
        ok: true,
        ...started
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(
          err?.message || `Failed to start ${oauthProvider} OAuth PKCE`,
          [body.clientSecret]
        )
      });
    }
  });

  router.post("/providers/oauth/:provider/exchange", async (req, res) => {
    const oauthProvider = normalizeOAuthRouteProvider(req.params.provider);
    if (!SUPPORTED_GENERIC_PKCE_PROVIDERS.has(oauthProvider)) {
      return res.status(400).json({
        error: `Unsupported OAuth PKCE provider '${oauthProvider}'`
      });
    }

    const body = req.body || {};
    const oauthOpts = extractOAuthFlowsOptions(req);
    const targetHintId = typeof body.providerId === "string" ? body.providerId.trim() : "";
    const existingHint = targetHintId ? storage.getProviderById(targetHintId) : null;
    const dispatcher = existingHint ? getProxyDispatcher(existingHint, storage) : undefined;

    // Restore cross-instance PKCE record if not present in this process memory.
    try {
      const parsedPreview = extractCodeAndState(body);
      if (parsedPreview.state) {
        const targetState = parsedPreview.state;
        const inMemory = Boolean(peekGenericPkceState(targetState));
        let restoredEnc = "";
        const hasPersisted =
          Array.isArray(storage.data?.pendingGenericPkce) &&
          storage.data.pendingGenericPkce.some((item) => item && item.state === targetState);
        if (hasPersisted) {
          await storage.update((data) => {
            const list = Array.isArray(data.pendingGenericPkce) ? data.pendingGenericPkce : [];
            const idx = list.findIndex((item) => item && item.state === targetState);
            if (idx >= 0) {
              restoredEnc = list[idx].enc || "";
              list.splice(idx, 1);
              data.pendingGenericPkce = list;
            }
          });
        }
        if (!inMemory && restoredEnc) {
          try {
            restoreGenericPkceState(targetState, JSON.parse(storage.decryptSecret(restoredEnc)));
          } catch {
            // Ignore malformed state
          }
        }
      }
    } catch {
      // extractCodeAndState inside exchangeGenericOAuthPkce will surface clean validation error
    }

    let exchanged;
    try {
      exchanged = await exchangeGenericOAuthPkce(oauthProvider, {
        ...body,
        ...(oauthOpts.fetchImpl ? { fetchImpl: oauthOpts.fetchImpl } : {}),
        ...(oauthOpts.tokenUrlOverride ? { tokenUrlOverride: oauthOpts.tokenUrlOverride } : {}),
        ...(oauthOpts.userinfoUrlOverride
          ? { userinfoUrlOverride: oauthOpts.userinfoUrlOverride }
          : {}),
        allowLoopback: oauthOpts.allowLoopback,
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "OAuth PKCE exchange failed")
      });
    }

    const presetSlug =
      oauthProvider === "gitlab"
        ? "gitlab"
        : oauthProvider === "openai" || oauthProvider === "codex"
          ? "openai"
          : oauthProvider === "anthropic" || oauthProvider === "claude"
            ? "anthropic"
            : exchanged.extra?.preset || "custom";

    let providerBaseUrl =
      typeof body.providerBaseUrl === "string" ? body.providerBaseUrl.trim() : "";
    if (!providerBaseUrl && oauthProvider === "gitlab" && exchanged.baseUrl) {
      const candidate = `${exchanged.baseUrl.replace(/\/+$/, "")}/api/v4`;
      const check = validateProviderBaseUrl(candidate, {
        preset: "gitlab",
        allowPrivateUpstreams: storage.getSettings().allowPrivateUpstreams
      });
      if (check.valid) providerBaseUrl = candidate;
    } else if (!providerBaseUrl && oauthProvider === "custom_oauth") {
      providerBaseUrl =
        (typeof body.apiBaseUrl === "string" && body.apiBaseUrl.trim()) ||
        exchanged.baseUrl ||
        "";
    }

    const fallbackLabel =
      presetSlug === "openai"
        ? "OpenAI OAuth"
        : presetSlug === "anthropic"
          ? "Claude OAuth"
          : oauthProvider === "gitlab"
            ? "GitLab OAuth 2.0"
            : "OAuth 2.0";

    const label =
      (typeof body.label === "string" && body.label.trim()) ||
      exchanged.oauthMeta?.email ||
      exchanged.oauthMeta?.username ||
      fallbackLabel;

    try {
      const { savedProvider, savedKeyId } = await upsertOAuthProviderConnection(storage, {
        targetProviderId: targetHintId || exchanged.extra?.providerId || "",
        presetSlug,
        providerBaseUrl,
        providerName: exchanged.extra?.name || body.name || "",
        providerSlug: exchanged.extra?.slug || body.slug || "",
        providerFormatType: exchanged.extra?.formatType || body.formatType || "",
        keyEntry: {
          label,
          key: "",
          authMethod: "oauth2",
          oauthCredentials: JSON.stringify(exchanged.oauthCredentials),
          oauthMeta: exchanged.oauthMeta
        }
      });

      let finalProvider = savedProvider;
      let finalMeta = exchanged.oauthMeta;
      const savedKey = (savedProvider?.apiKeys || []).find((k) => k.id === savedKeyId);
      if (savedKey && !oauthOpts.allowLoopback && !isLocalUrl(savedProvider?.baseUrl)) {
        try {
          const synced = await syncOAuthAccountPlanAndModels(savedProvider, savedKey, storage, {
            allowLoopback: oauthOpts.allowLoopback,
            dispatcher: dispatcher || undefined,
            saOptions: extractServiceAccountOptions(req)
          });
          if (synced?.updatedProvider) finalProvider = synced.updatedProvider;
          if (synced?.updatedMeta) finalMeta = synced.updatedMeta;
        } catch {
          // Best-effort initial plan & model sync on connect.
        }
      }
      req.app?.locals?.routerService?.clearProviderCooldowns(savedProvider?.id, savedKeyId || null);

      return res.json({
        ok: true,
        keyId: savedKeyId,
        oauthMeta: finalMeta,
        provider: toPublicProvider(finalProvider)
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "Failed to save OAuth connection")
      });
    }
  });

  router.post("/providers/oauth/:provider/device-code", async (req, res) => {
    const oauthProvider = normalizeOAuthRouteProvider(req.params.provider);
    if (!SUPPORTED_DEVICE_CODE_PROVIDERS.has(oauthProvider)) {
      return res.status(400).json({
        error: `Unsupported Device Code provider '${oauthProvider}'. Supported: kilocode, kimi, nous, custom_oauth`
      });
    }

    const body = req.body || {};
    const oauthOpts = extractOAuthFlowsOptions(req);
    const lookupPreset = oauthProvider === "kimi-coding" ? "kimi" : oauthProvider;
    const existingProvider =
      (typeof body.providerId === "string" && body.providerId.trim()
        ? storage.getProviderById(body.providerId.trim())
        : null) ||
      storage.getProviders().find((p) => p.preset === lookupPreset) ||
      null;
    const dispatcher = existingProvider
      ? getProxyDispatcher(existingProvider, storage)
      : undefined;

    try {
      const started = await startDeviceCodeFlow(oauthProvider, {
        ...body,
        ...(oauthProvider === "kilocode" && !body.apiBaseUrl && oauthOpts.kiloApiBaseUrl
          ? { apiBaseUrl: oauthOpts.kiloApiBaseUrl }
          : {}),
        ...(oauthProvider === "nous" && !body.portalBaseUrl && oauthOpts.nousPortalBaseUrl
          ? { portalBaseUrl: oauthOpts.nousPortalBaseUrl }
          : {}),
        ...((oauthProvider === "kimi" || oauthProvider === "kimi-coding") &&
        !body.kimiAuthBaseUrl &&
        oauthOpts.kimiAuthBaseUrl
          ? { kimiAuthBaseUrl: oauthOpts.kimiAuthBaseUrl }
          : {}),
        ...(oauthOpts.fetchImpl ? { fetchImpl: oauthOpts.fetchImpl } : {}),
        allowLoopback: oauthOpts.allowLoopback,
        ...(dispatcher ? { dispatcher } : {})
      });
      return res.json({
        ok: true,
        ...started
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(
          err?.message || `Failed to start ${oauthProvider} device code flow`,
          [body.clientSecret]
        )
      });
    }
  });

  router.post("/providers/oauth/:provider/poll", async (req, res) => {
    const oauthProvider = normalizeOAuthRouteProvider(req.params.provider);
    if (!SUPPORTED_DEVICE_CODE_PROVIDERS.has(oauthProvider)) {
      return res.status(400).json({
        error: `Unsupported Device Code provider '${oauthProvider}'`
      });
    }

    const body = req.body || {};
    const oauthOpts = extractOAuthFlowsOptions(req);
    const targetHintId = typeof body.providerId === "string" ? body.providerId.trim() : "";
    const lookupPreset = oauthProvider === "kimi-coding" ? "kimi" : oauthProvider;
    const existingProvider =
      (targetHintId ? storage.getProviderById(targetHintId) : null) ||
      storage.getProviders().find((p) => p.preset === lookupPreset) ||
      null;
    const dispatcher = existingProvider
      ? getProxyDispatcher(existingProvider, storage)
      : undefined;

    let result;
    try {
      result = await pollDeviceCodeFlow(oauthProvider, {
        ...body,
        ...(oauthOpts.fetchImpl ? { fetchImpl: oauthOpts.fetchImpl } : {}),
        allowLoopback: oauthOpts.allowLoopback,
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "Device code polling failed")
      });
    }

    if (result.status !== "approved") {
      return res.json(result);
    }

    const isKimi = oauthProvider === "kimi" || oauthProvider === "kimi-coding";
    const presetSlug =
      oauthProvider === "kilocode" || oauthProvider === "nous"
        ? oauthProvider
        : isKimi
          ? "kimi"
          : result.extra?.preset || "custom";

    const providerBaseUrl =
      (typeof body.providerBaseUrl === "string" && body.providerBaseUrl.trim()) ||
      (isKimi ? "https://api.kimi.com/coding/v1" : "") ||
      (oauthProvider === "custom_oauth"
        ? (typeof body.apiBaseUrl === "string" && body.apiBaseUrl.trim()) ||
          result.extra?.baseUrl ||
          ""
        : "");

    const defaultLabel =
      oauthProvider === "kilocode"
        ? "Kilo Code Device Auth"
        : oauthProvider === "nous"
          ? "Nous Device Auth"
          : isKimi
            ? "Kimi Code Device Auth"
            : "OAuth Device Auth";

    const label =
      (typeof body.label === "string" && body.label.trim()) ||
      result.oauthMeta?.email ||
      result.extra?.name ||
      defaultLabel;

    try {
      const { savedProvider, savedKeyId } = await upsertOAuthProviderConnection(storage, {
        targetProviderId: targetHintId || result.extra?.providerId || "",
        presetSlug,
        providerBaseUrl,
        providerName: result.extra?.name || body.name || "",
        providerSlug: result.extra?.slug || body.slug || "",
        providerFormatType: result.extra?.formatType || body.formatType || "",
        keyEntry: {
          label,
          key: result.key || "",
          authMethod: result.authMethod,
          ...(result.oauthCredentials
            ? { oauthCredentials: JSON.stringify(result.oauthCredentials) }
            : {}),
          oauthMeta: result.oauthMeta
        }
      });

      let finalProvider = savedProvider;
      let finalMeta = result.oauthMeta;
      const savedKey = (savedProvider?.apiKeys || []).find((k) => k.id === savedKeyId);
      if (savedKey && !oauthOpts.allowLoopback && !isLocalUrl(savedProvider?.baseUrl)) {
        try {
          const synced = await syncOAuthAccountPlanAndModels(savedProvider, savedKey, storage, {
            allowLoopback: oauthOpts.allowLoopback,
            dispatcher: dispatcher || undefined,
            saOptions: extractServiceAccountOptions(req)
          });
          if (synced?.updatedProvider) finalProvider = synced.updatedProvider;
          if (synced?.updatedMeta) finalMeta = synced.updatedMeta;
        } catch {
          // Best-effort initial plan & model sync on device auth connect.
        }
      }
      req.app?.locals?.routerService?.clearProviderCooldowns(savedProvider?.id, savedKeyId || null);

      return res.json({
        status: "approved",
        ok: true,
        keyId: savedKeyId,
        oauthMeta: finalMeta,
        provider: toPublicProvider(finalProvider)
      });
    } catch (err) {
      return res.status(Number(err?.status) || 400).json({
        error: sanitizeSecrets(err?.message || "Failed to persist device authorization")
      });
    }
  });

  router.put("/providers/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const existing = storage.getProviderById(id);
    if (!existing) {
      return res.status(404).json({ error: "Provider not found" });
    }

    let nextSlug = existing.slug;
    if (body.slug !== undefined) {
      const candidate = slugify(body.slug);
      if (!candidate) {
        return res.status(400).json({ error: "Invalid provider slug" });
      }
      if (
        storage
          .getProviders()
          .some((p) => p.id !== id && p.slug === candidate)
      ) {
        return res.status(400).json({ error: `Provider slug '${candidate}' already exists` });
      }
      nextSlug = candidate;
    }

    let nextBaseUrl = existing.baseUrl;
    if (body.baseUrl !== undefined) {
      const candidate = normalizeBaseUrl(body.baseUrl);
      if (!candidate || !isValidHttpUrl(candidate)) {
        return res.status(400).json({ error: "Invalid baseUrl" });
      }
      const effPreset =
        typeof body.preset === "string" && body.preset.trim()
          ? body.preset.trim()
          : existing.preset;
      const ssrfCheck = validateProviderBaseUrl(candidate, {
        preset: effPreset,
        category: getPreset(effPreset)?.category,
        allowPrivateUpstreams: storage.getSettings().allowPrivateUpstreams
      });
      if (!ssrfCheck.valid) {
        return res.status(400).json({ error: ssrfCheck.error || "Invalid baseUrl" });
      }
      nextBaseUrl = candidate;
    }

    let nextFormatType = existing.formatType;
    if (body.formatType !== undefined) {
      if (!VALID_FORMAT_TYPES.has(body.formatType)) {
        return res.status(400).json({ error: "Invalid formatType" });
      }
      nextFormatType = body.formatType;
    }

    const updated = await storage.update((data) => {
      const target = data.providers.find((p) => p.id === id);
      if (!target) return null;

      target.slug = nextSlug;
      if (typeof body.preset === "string" && body.preset.trim()) {
        target.preset = body.preset.trim();
      }
      if (typeof body.name === "string" && body.name.trim()) {
        target.name = body.name.trim();
      }
      target.baseUrl = nextBaseUrl;
      if (nextFormatType !== target.formatType && body.authStyle === undefined) {
        delete target.authStyle;
      }
      target.formatType = nextFormatType;
      if (Array.isArray(body.apiKeys)) {
        target.apiKeys = mergeUpdatedApiKeys(body.apiKeys, target.apiKeys || []);
      }
      if (Array.isArray(body.models)) {
        target.models = [
          ...new Set(
            body.models
              .filter((m) => typeof m === "string" && m.trim())
              .map((m) => m.trim())
          )
        ];
      }
      if (body.proxyPoolId !== undefined) {
        target.proxyPoolId =
          typeof body.proxyPoolId === "string" && body.proxyPoolId.trim()
            ? body.proxyPoolId.trim()
            : null;
      }
      if (body.enabled !== undefined) {
        target.enabled = Boolean(body.enabled);
      }
      target.updatedAt = new Date().toISOString();
      return target;
    });

    if (!updated) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const shouldSyncOnUpdate =
      body.autoSyncModels !== false &&
      (Array.isArray(body.apiKeys) ||
        body.baseUrl !== undefined ||
        body.autoSyncModels === true);
    const finalProvider = shouldSyncOnUpdate
      ? (await autoSyncProviderPackageModels(updated, storage, {
          forceSync: body.autoSyncModels === true || req.app?.locals?.autoSyncModels === true,
          fetchImpl: req.app?.locals?.autoSyncFetchImpl,
          routerService: req.app?.locals?.routerService || null
        })) || updated
      : updated;
    return res.json({ provider: toPublicProvider(finalProvider) });
  });

  router.delete("/providers/:id", async (req, res) => {
    const { id } = req.params;
    const removed = await storage.update((data) => {
      const idx = data.providers.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      data.providers.splice(idx, 1);
      if (data.quotas && Object.prototype.hasOwnProperty.call(data.quotas, id)) {
        delete data.quotas[id];
      }
      return true;
    });
    if (!removed) {
      return res.status(404).json({ error: "Provider not found" });
    }
    return res.json({ ok: true });
  });

  router.post("/providers/:id/test", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const body = req.body || {};
    const zeroToken = body.zeroToken === true;
    const requestedModel = zeroToken
      ? ""
      : typeof body.model === "string"
        ? body.model.trim()
        : "";
    const saOptions = {
      ...extractServiceAccountOptions(req),
      ...(zeroToken ? { zeroToken: true } : {})
    };
    const result = await runProviderConnectionTest(
      provider,
      storage,
      requestedModel,
      saOptions
    );
    if (result.ok) {
      for (const k of provider.apiKeys || []) {
        if (k.enabled !== false && k.id) {
          await storage.clearProviderKeyCooldown(provider.id, k.id);
        }
      }
      req.app?.locals?.routerService?.clearProviderCooldowns(provider.id);
    }
    return res.json(result);
  });

  router.post("/providers/:id/keys/:keyId/test", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const keyEntry = (provider.apiKeys || []).find((k) => k.id === req.params.keyId);
    if (!keyEntry) {
      return res.status(404).json({ error: "API key connection not found" });
    }

    const body = req.body || {};
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    const saOptions = extractServiceAccountOptions(req);
    const result = await runProviderConnectionTest(
      provider,
      storage,
      requestedModel,
      saOptions,
      keyEntry
    );
    if (result.ok) {
      await storage.clearProviderKeyCooldown(provider.id, keyEntry.id);
      req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
    }
    return res.json({ keyId: keyEntry.id, ...result });
  });

  async function persistInspectOAuthMeta(providerId, keyId, patch) {
    if (!providerId || !keyId || !patch || typeof patch !== "object") return;
    await storage
      .update((data) => {
        const target = data.providers.find((p) => p.id === providerId);
        if (!target) return;
        const targetKey = (target.apiKeys || []).find((k) => k.id === keyId);
        if (!targetKey) return;
        targetKey.oauthMeta = {
          ...(targetKey.oauthMeta || {}),
          ...patch
        };
      })
      .catch(() => {});
  }

  // Official Account, Tier & Billing Inspector (OpenAI, Google OAuth/Gemini, Cloud Code, OpenRouter, & Generic)
  router.post("/providers/:id/inspect-account", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const body = req.body || {};
    const requestedKeyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
    const checkBilling = body.checkBilling !== false;
    const keyEntry = requestedKeyId
      ? (provider.apiKeys || []).find((k) => k.id === requestedKeyId)
      : pickProviderKeyForTest(provider);
    if (!keyEntry) {
      return res.status(400).json({
        ok: false,
        error: "No enabled API key or OAuth connection found for this provider"
      });
    }

    const started = Date.now();
    const saOptions = extractServiceAccountOptions(req);
    const dispatcher = getProxyDispatcher(provider, storage);
    const presetSlug = String(provider.preset || provider.slug || "").toLowerCase();
    const baseUrlLower = String(provider.baseUrl || "").toLowerCase();

    try {
      // 1a. Cloud Code Assist (Antigravity / Gemini CLI) -> live plan, windows, and model catalog
      const cloudFlavor = getCloudCodeFlavorForKey(keyEntry);
      if (cloudFlavor && keyEntry.oauthCredentials) {
        const cloudFetch = req.app?.locals?.cloudCodeFetchImpl || req.app?.locals?.googleOAuthFetchImpl;
        const { accessToken } = await getGeminiCliAccessToken(keyEntry.oauthCredentials, {
          ...(cloudFetch ? { fetchImpl: cloudFetch } : {}),
          ...(dispatcher ? { dispatcher } : {})
        });
        const usage = await fetchCloudCodeUsage(accessToken, {
          projectId: keyEntry.oauthMeta?.projectId || "",
          ...(cloudFetch ? { fetchImpl: cloudFetch } : {}),
          ...(dispatcher ? { dispatcher } : {}),
          flavor: cloudFlavor.id
        });
        const nowIso = new Date().toISOString();
        const billingStatus =
          usage.tier === "paid" ? "active" : usage.tier ? "free_tier" : "unknown";
        const modelsCount =
          (Array.isArray(usage.models) && usage.models.length) ||
          (Array.isArray(usage.buckets) && usage.buckets.length) ||
          (provider.models || []).length;

        let updatedMeta = keyEntry.oauthMeta || {};
        await storage
          .update((data) => {
            const target = data.providers.find((p) => p.id === provider.id);
            const targetKey = (target?.apiKeys || []).find((k) => k.id === keyEntry.id);
            if (!targetKey) return;
            targetKey.oauthMeta = {
              ...mergeCloudCodeUsage(targetKey.oauthMeta, usage, nowIso),
              billingStatus,
              modelsCount
            };
            updatedMeta = targetKey.oauthMeta;
            if (syncProviderModelsWithCatalog(target)) target.updatedAt = nowIso;
          })
          .catch(() => {});

        if (usage.planOk || usage.quotaOk) {
          req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
        }

        return res.json({
          ok: Boolean(usage.planOk || usage.quotaOk),
          keyId: keyEntry.id,
          providerType: cloudFlavor.id,
          authMethod: keyEntry.authMethod,
          email: updatedMeta?.email || "",
          projectId: usage.projectId || updatedMeta?.projectId || "",
          tierLabel: usage.tierLabel || updatedMeta?.tierLabel || `${cloudFlavor.label} · Connected`,
          billingStatus,
          billingActive: usage.tier === "paid",
          quotaWindows: updatedMeta?.quotaWindows || usage.windows || [],
          availableModels: updatedMeta?.availableModels || usage.models || [],
          modelsCount,
          recommendedModels: catalogChatModelIds(usage.models).slice(0, 4),
          provider: toPublicProvider(storage.getProviderById(provider.id)),
          latencyMs: Date.now() - started,
          checkedAt: nowIso
        });
      }

      // 1b. Google OAuth 2.0 / ADC authorized_user -> refresh live email, project & Cloud Billing tier
      if (keyEntry.authMethod === "google_oauth" && keyEntry.oauthCredentials) {
        const { updatedMeta } = await refreshGoogleOAuthConnection(provider, keyEntry, req);
        const billingActive =
          updatedMeta?.billingEnabled === true ||
          updatedMeta?.billingActive === true ||
          updatedMeta?.tier === "paid";
        const isFreeTier =
          !billingActive &&
          (updatedMeta?.billingEnabled === false ||
            updatedMeta?.isFreeTier === true ||
            updatedMeta?.tier === "free");
        const billingStatus = billingActive
          ? "active"
          : isFreeTier
            ? "free_tier"
            : "unknown";
        const report = {
          ok: true,
          keyId: keyEntry.id,
          providerType: "google_oauth",
          authMethod: "google_oauth",
          email: updatedMeta?.email || "",
          projectId: updatedMeta?.projectId || "",
          tierLabel: updatedMeta?.tierLabel || "Google OAuth 2.0",
          billingStatus,
          billingActive,
          modelsCount: Number(updatedMeta?.modelsCount) || (provider.models || []).length,
          recommendedModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
          provider: toPublicProvider(storage.getProviderById(provider.id)),
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString()
        };
        return res.json(report);
      }

      const authCtx = await resolveAuthContextForKey(keyEntry, {
        ...saOptions,
        ...(dispatcher ? { dispatcher } : {})
      });
      const resolvedSecret = authCtx.secret;
      const secrets = collectProviderSecrets(provider, resolvedSecret);
      const headers = buildUpstreamHeaders(
        provider,
        resolvedSecret,
        undefined,
        authCtx.extraHeaders
      );

      const isLoopbackBase = isLocalUrl(provider.baseUrl);

      // 1c. Claude Code OAuth, OpenAI Codex OAuth, Kimi Code OAuth -> live plan, quota windows & live models
      const isClaudeOAuth = isClaudeOAuthKey(keyEntry, resolvedSecret);
      const isCodexOAuth = !isClaudeOAuth && isCodexOAuthKey(keyEntry);
      const isKimiOAuth = !isClaudeOAuth && !isCodexOAuth && isKimiOAuthKey(keyEntry);
      if ((isClaudeOAuth || isCodexOAuth || isKimiOAuth) && !isLoopbackBase) {
        const synced = await syncOAuthAccountPlanAndModels(provider, keyEntry, storage, {
          resolvedSecret,
          dispatcher,
          saOptions,
          allowLoopback: Boolean(
            req.app?.locals?.oauthAllowLoopback || req.app?.locals?.allowLoopbackTokenUri
          )
        });
        if (synced) {
          const { usage, updatedProvider, updatedMeta, checkedAt, providerType } = synced;
          req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
          const chatModels = (usage.models || []).map((m) => m.id).filter(Boolean);
          return res.json({
            ok: Boolean(usage.planOk || usage.quotaOk),
            keyId: keyEntry.id,
            providerType,
            authMethod: keyEntry.authMethod || "oauth2",
            email: updatedMeta?.email || usage.email || "",
            accountId: updatedMeta?.accountId || usage.accountId || "",
            tierLabel: updatedMeta?.tierLabel || usage.tierLabel,
            billingStatus: "active",
            billingActive: true,
            quotaWindows: updatedMeta?.quotaWindows || usage.windows || [],
            availableModels: updatedMeta?.availableModels || usage.models || [],
            modelsCount: chatModels.length || (updatedProvider?.models || []).length,
            recommendedModels: chatModels.slice(0, 6),
            provider: toPublicProvider(updatedProvider),
            latencyMs: Date.now() - started,
            checkedAt
          });
        }
      }

      // 2. OpenRouter official /auth/key inspector (skip when baseUrl points to a custom third-party relay)
      if (
        baseUrlLower.includes("openrouter.ai") ||
        (presetSlug === "openrouter" && isLoopbackBase && provider.formatType !== "anthropic")
      ) {
        const keyInfoUrl = `${provider.baseUrl.replace(/\/+$/, "")}/auth/key`;
        const infoRes = await fetch(keyInfoUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000),
          ...(dispatcher ? { dispatcher } : {})
        });
        const infoJson = await infoRes.json().catch(() => ({}));
        const d = infoJson?.data || infoJson || {};
        const isFreeTier = Boolean(d.is_free_tier);
        const limitRemaining =
          typeof d.limit_remaining === "number"
            ? d.limit_remaining
            : typeof d.limit === "number" && typeof d.usage === "number"
              ? Math.max(0, d.limit - d.usage)
              : null;
        const checkedAt = new Date().toISOString();
        const tierLabel = isFreeTier ? "OpenRouter Free Tier" : "OpenRouter Paid";
        const billingStatus = !infoRes.ok
          ? "inactive"
          : isFreeTier
            ? "free_tier"
            : limitRemaining === 0
              ? "inactive"
              : "active";
        const modelsCount = (provider.models || []).length;
        await persistInspectOAuthMeta(provider.id, keyEntry.id, {
          tierLabel,
          billingStatus,
          modelsCount,
          checkedAt
        });
        return res.json({
          ok: infoRes.ok,
          keyId: keyEntry.id,
          providerType: "openrouter",
          authMethod: keyEntry.authMethod || "api_key",
          label: d.label || keyEntry.label || "",
          tierLabel,
          isFreeTier,
          billingStatus,
          usage: typeof d.usage === "number" ? d.usage : null,
          limit: typeof d.limit === "number" ? d.limit : null,
          limitRemaining,
          modelsCount,
          latencyMs: Date.now() - started,
          checkedAt,
          ...(!infoRes.ok
            ? { message: sanitizeSecrets(d?.error?.message || `HTTP ${infoRes.status}`, secrets) }
            : {})
        });
      }

      // 3. Official OpenAI API Key inspector (GET /models + optional 1-token billing check)
      if (
        baseUrlLower.includes("api.openai.com") ||
        (presetSlug === "openai" && isLoopbackBase && provider.formatType !== "anthropic")
      ) {
        const modelsUrl = buildUpstreamUrl(provider.baseUrl, provider.formatType, "models");
        const modelsRes = await fetch(modelsUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000),
          ...(dispatcher ? { dispatcher } : {})
        });
        if (!modelsRes.ok) {
          const errText = await modelsRes.text().catch(() => "");
          return res.json({
            ok: false,
            keyId: keyEntry.id,
            providerType: "openai",
            authMethod: keyEntry.authMethod || "api_key",
            billingStatus: modelsRes.status === 429 || modelsRes.status === 402 ? "inactive" : "error",
            billingUrl: "https://platform.openai.com/settings/organization/billing",
            status: modelsRes.status,
            latencyMs: Date.now() - started,
            message: sanitizeSecrets(errText.slice(0, 220) || `HTTP ${modelsRes.status}`, secrets)
          });
        }

        const modelsJson = await modelsRes.json().catch(() => ({}));
        const orgHeader = modelsRes.headers.get("openai-organization") || "";
        const rawList = Array.isArray(modelsJson?.data) ? modelsJson.data : [];
        const ids = rawList.map((m) => m?.id).filter(Boolean);
        const hasFlagship = ids.some((id) => /^(gpt-5|gpt-4\.1|gpt-4o|o3|o4)/i.test(id));

        let billingStatus = "unknown";
        let billingMessage = "Models accessible (billing not probed)";
        if (checkBilling) {
          const probeModel =
            ids.find((id) => id === "gpt-4o-mini") ||
            ids.find((id) => id === "gpt-4.1-mini") ||
            provider.models?.[0] ||
            "gpt-4o-mini";
          const chatUrl = buildUpstreamUrl(provider.baseUrl, provider.formatType, "chat/completions");
          const probeRes = await fetch(chatUrl, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              model: probeModel,
              max_tokens: 1,
              messages: [{ role: "user", content: "ping" }]
            }),
            signal: AbortSignal.timeout(15000),
            ...(dispatcher ? { dispatcher } : {})
          });
          if (probeRes.ok) {
            billingStatus = "active";
            billingMessage = `Billing active — verified with ${probeModel}`;
          } else {
            const pErr = await probeRes.text().catch(() => "");
            const cleanErr = sanitizeSecrets(pErr.slice(0, 240) || `HTTP ${probeRes.status}`, secrets);
            if (
              probeRes.status === 402 ||
              /billing|insufficient_quota|not active|exceeded your current quota/i.test(cleanErr)
            ) {
              billingStatus = "inactive";
              billingMessage = cleanErr;
            } else if (probeRes.status === 429) {
              billingStatus = "rate_limited";
              billingMessage = cleanErr;
            } else {
              billingStatus = "unknown";
              billingMessage = cleanErr;
            }
          }
        }

        const checkedAt = new Date().toISOString();
        const tierLabel =
          keyEntry.oauthMeta?.tierLabel && keyEntry.authMethod === "oauth2"
            ? keyEntry.oauthMeta.tierLabel
            : billingStatus === "active"
              ? hasFlagship
                ? "OpenAI API (Billing Active · Flagship)"
                : "OpenAI API (Billing Active)"
              : billingStatus === "inactive"
                ? "OpenAI Billing Inactive / $0 Credit"
                : "OpenAI API Key";
        await persistInspectOAuthMeta(provider.id, keyEntry.id, {
          tierLabel,
          billingStatus,
          modelsCount: ids.length,
          checkedAt
        });

        return res.json({
          ok: billingStatus !== "inactive",
          keyId: keyEntry.id,
          providerType: "openai",
          authMethod: keyEntry.authMethod || "api_key",
          organization: orgHeader,
          tierLabel,
          billingStatus,
          billingMessage,
          billingUrl: "https://platform.openai.com/settings/organization/billing",
          modelsCount: ids.length,
          hasFlagship,
          recommendedModels: ids
            .filter((id) => /^(gpt-4\.1|gpt-4o|gpt-5|o3|o4)/i.test(id))
            .slice(0, 4),
          latencyMs: Date.now() - started,
          checkedAt
        });
      }

      // 4. Google Gemini API Key inspector (GET /models + chat-ready filter)
      if (
        baseUrlLower.includes("generativelanguage.googleapis.com") ||
        (presetSlug === "gemini" && isLoopbackBase && provider.formatType !== "anthropic")
      ) {
        const modelsUrl = buildUpstreamUrl(provider.baseUrl, provider.formatType, "models");
        const modelsRes = await fetch(modelsUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000),
          ...(dispatcher ? { dispatcher } : {})
        });
        if (!modelsRes.ok) {
          const errText = await modelsRes.text().catch(() => "");
          return res.json({
            ok: false,
            keyId: keyEntry.id,
            providerType: "gemini_apikey",
            authMethod: keyEntry.authMethod || "api_key",
            billingStatus: "error",
            status: modelsRes.status,
            latencyMs: Date.now() - started,
            message: sanitizeSecrets(errText.slice(0, 220) || `HTTP ${modelsRes.status}`, secrets)
          });
        }
        const modelsJson = await modelsRes.json().catch(() => ({}));
        const rawList = Array.isArray(modelsJson?.data)
          ? modelsJson.data
          : Array.isArray(modelsJson?.models)
            ? modelsJson.models
            : [];
        const ids = rawList
          .map((m) => String(m?.id || m?.name || "").replace(/^models\//, ""))
          .filter(Boolean);
        const chatIds = ids.filter(
          (id) => !/(tts|image|transcribe|live|lyria|embedding|aqa|native-audio|imagen|veo)/i.test(id)
        );
        const checkedAt = new Date().toISOString();
        const tierLabel = "Google AI Studio API Key";
        await persistInspectOAuthMeta(provider.id, keyEntry.id, {
          tierLabel,
          billingStatus: "active",
          modelsCount: ids.length,
          checkedAt
        });
        return res.json({
          ok: true,
          keyId: keyEntry.id,
          providerType: "gemini_apikey",
          authMethod: keyEntry.authMethod || "api_key",
          tierLabel,
          billingStatus: "active",
          billingMessage: "Use Google OAuth 2.0 to detect exact GCP Cloud Billing (Free Tier vs Pay-as-you-go)",
          billingUrl: "https://aistudio.google.com/apikey",
          modelsCount: ids.length,
          chatModelsCount: chatIds.length,
          recommendedModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
          latencyMs: Date.now() - started,
          checkedAt
        });
      }

      // 5. All other official providers
      const testRes = await runProviderConnectionTest(provider, storage, "", saOptions, keyEntry);
      const checkedAt = new Date().toISOString();
      const billingStatus = testRes.ok
        ? "active"
        : testRes.status === 402 || testRes.status === 429
          ? "inactive"
          : "error";
      const tierLabel = testRes.ok
        ? keyEntry.oauthMeta?.tierLabel || `${provider.name} (Verified)`
        : keyEntry.oauthMeta?.tierLabel || `${provider.name} (Error)`;
      const modelsCount = testRes.modelsCount ?? (provider.models || []).length;
      await persistInspectOAuthMeta(provider.id, keyEntry.id, {
        tierLabel,
        billingStatus,
        modelsCount,
        checkedAt
      });
      if (testRes.ok) {
        await storage.clearProviderKeyCooldown(provider.id, keyEntry.id);
        req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
      }
      return res.json({
        ok: testRes.ok,
        keyId: keyEntry.id,
        providerType: presetSlug || "custom",
        authMethod: keyEntry.authMethod || "api_key",
        tierLabel,
        billingStatus,
        billingMessage: testRes.message,
        modelsCount,
        provider: toPublicProvider(storage.getProviderById(provider.id)),
        latencyMs: testRes.latencyMs ?? Date.now() - started,
        checkedAt
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        keyId: keyEntry.id,
        error: sanitizeSecrets(err?.message || "Account inspection failed", collectProviderSecrets(provider))
      });
    }
  });

  router.post("/providers/:id/keys/:keyId/refresh", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    const keyEntry = (provider.apiKeys || []).find((k) => k.id === req.params.keyId);
    if (!keyEntry) {
      return res.status(404).json({ error: "API key connection not found" });
    }

    try {
      if (keyEntry.authMethod === "google_oauth" && keyEntry.oauthCredentials) {
        const { updatedProvider, updatedMeta } = await refreshGoogleOAuthConnection(
          provider,
          keyEntry,
          req
        );
        if (!updatedProvider) {
          return res.status(404).json({ error: "Provider not found" });
        }
        req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
        return res.json({
          ok: true,
          keyId: keyEntry.id,
          oauthMeta: updatedMeta,
          provider: toPublicProvider(updatedProvider)
        });
      }

      if (keyEntry.authMethod === "oauth2" && keyEntry.oauthCredentials) {
        const dispatcher = getProxyDispatcher(provider, storage);
        const oauthOpts = extractOAuthFlowsOptions(req);
        const refreshed = await getGenericOAuthAccessToken(keyEntry.oauthCredentials, {
          ...(oauthOpts.fetchImpl ? { fetchImpl: oauthOpts.fetchImpl } : {}),
          ...(oauthOpts.tokenUrlOverride ? { tokenUrlOverride: oauthOpts.tokenUrlOverride } : {}),
          allowLoopback: oauthOpts.allowLoopback,
          ...(dispatcher ? { dispatcher } : {}),
          forceRefresh: true
        });

        let updatedCreds;
        try {
          updatedCreds = JSON.parse(keyEntry.oauthCredentials);
        } catch {
          updatedCreds = {};
        }
        updatedCreds.accessToken = refreshed.accessToken;
        updatedCreds.expiresAt = refreshed.expiresAt;
        if (refreshed.refreshToken) {
          updatedCreds.refreshToken = refreshed.refreshToken;
        }

        const nowIso = new Date().toISOString();
        let updatedMeta = {
          ...(keyEntry.oauthMeta || {}),
          expiresAt: new Date(refreshed.expiresAt).toISOString(),
          checkedAt: nowIso
        };

        let updatedProvider = await storage.update((data) => {
          const target = data.providers.find((p) => p.id === provider.id);
          if (!target) return null;
          const targetKey = (target.apiKeys || []).find((k) => k.id === keyEntry.id);
          if (!targetKey) return null;
          targetKey.oauthCredentials = JSON.stringify(updatedCreds);
          targetKey.oauthMeta = updatedMeta;
          targetKey.cooldownUntil = null;
          delete targetKey.lastError;
          target.updatedAt = nowIso;
          return target;
        });

        if (updatedProvider && !oauthOpts.allowLoopback && !isLocalUrl(provider.baseUrl)) {
          try {
            const updatedKey = (updatedProvider.apiKeys || []).find((k) => k.id === keyEntry.id) || keyEntry;
            const synced = await syncOAuthAccountPlanAndModels(updatedProvider, updatedKey, storage, {
              resolvedSecret: refreshed.accessToken,
              allowLoopback: oauthOpts.allowLoopback,
              dispatcher: dispatcher || undefined,
              saOptions: extractServiceAccountOptions(req)
            });
            if (synced?.updatedProvider) updatedProvider = synced.updatedProvider;
            if (synced?.updatedMeta) updatedMeta = synced.updatedMeta;
          } catch {
            // Best-effort quota/model refresh along with token refresh.
          }
        }
        req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);

        return res.json({
          ok: true,
          keyId: keyEntry.id,
          oauthMeta: updatedMeta,
          provider: toPublicProvider(updatedProvider)
        });
      }

      if (keyEntry.authMethod === "service_account" && keyEntry.serviceAccountJson) {
        const dispatcher = getProxyDispatcher(provider, storage);
        const saOptions = extractServiceAccountOptions(req);
        await resolveAuthContextForKey(keyEntry, {
          ...saOptions,
          ...(dispatcher ? { dispatcher } : {}),
          forceRefresh: true
        });
        await storage.clearProviderKeyCooldown(provider.id, keyEntry.id);
        req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
        const refreshedProvider = storage.getProviderById(provider.id);
        return res.json({
          ok: true,
          keyId: keyEntry.id,
          provider: toPublicProvider(refreshedProvider)
        });
      }

      return res.status(400).json({
        error: "This connection uses a static key and does not support OAuth token refresh"
      });
    } catch (err) {
      return res.status(Number(err?.status) || 502).json({
        error: sanitizeSecrets(
          err?.message || "Failed to refresh connection credentials",
          collectProviderSecrets(provider)
        )
      });
    }
  });

  router.post("/providers/:id/models", async (req, res) => {
    const provider = storage.getProviderById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const keyEntry = pickProviderKeyForTest(provider);
    if (!keyEntry) {
      return res.json({
        ok: false,
        models: provider.models || [],
        message: "No enabled API keys configured"
      });
    }

    const body = req.body || {};
    const replace = body.replace === true;
    const settings = storage.getSettings();
    const timeoutMs = Math.min(settings.timeoutMs || 30000, 30000);
    const dispatcher = getProxyDispatcher(provider, storage);
    const saOptions = extractServiceAccountOptions(req);

    // Cloud Code Assist keys (Antigravity / Gemini CLI) discover their plan models via
    // fetchAvailableModels / retrieveUserQuota instead of REST GET /models.
    const cloudKeys = (provider.apiKeys || []).filter(
      (k) => k.enabled !== false && getCloudCodeFlavorForKey(k) && k.oauthCredentials
    );
    if (cloudKeys.length > 0 && (provider.preset === "antigravity" || getCloudCodeFlavorForKey(keyEntry))) {
      const cloudFetch = req.app?.locals?.cloudCodeFetchImpl || req.app?.locals?.googleOAuthFetchImpl;
      const results = await Promise.all(
        cloudKeys.map(async (k) => {
          const cliFlavor = getCloudCodeFlavorForKey(k);
          try {
            const { accessToken } = await getGeminiCliAccessToken(k.oauthCredentials, {
              ...(dispatcher ? { dispatcher } : {}),
              ...(cloudFetch ? { fetchImpl: cloudFetch } : {})
            });
            const usage = await fetchCloudCodeUsage(accessToken, {
              projectId: k.oauthMeta?.projectId || "",
              ...(dispatcher ? { dispatcher } : {}),
              ...(cloudFetch ? { fetchImpl: cloudFetch } : {}),
              flavor: cliFlavor.id
            });
            return { keyId: k.id, flavor: cliFlavor.id, usage };
          } catch (err) {
            return { keyId: k.id, flavor: cliFlavor.id, error: err?.message || "fetch failed" };
          }
        })
      );

      const okResults = results.filter((r) => r.usage && (r.usage.catalogOk || r.usage.quotaOk));
      if (okResults.length > 0) {
        const checkedAt = new Date().toISOString();
        const catalogChatIds = getCatalogChatModelIds(provider.preset);
        let finalModels = Array.isArray(provider.models) ? [...provider.models] : [];
        const liveIds = [];
        for (const r of okResults) {
          const fromCatalog = catalogChatModelIds(r.usage.models);
          const fromBuckets = (Array.isArray(r.usage.buckets) ? r.usage.buckets : [])
            .map((b) => b?.modelId)
            .filter((id) => typeof id === "string" && id && !/^tab_/i.test(id));
          for (const mid of [...fromCatalog, ...fromBuckets]) {
            if (!liveIds.includes(mid)) liveIds.push(mid);
          }
        }

        await storage.update((data) => {
          const target = data.providers.find((p) => p.id === provider.id);
          if (!target) return;
          for (const r of okResults) {
            const k = (target.apiKeys || []).find((x) => x.id === r.keyId);
            if (!k) continue;
            k.oauthMeta = mergeCloudCodeUsage(k.oauthMeta, r.usage, checkedAt);
          }
          if (target.preset === "antigravity" || okResults.some((r) => r.flavor === "antigravity")) {
            syncProviderModelsWithCatalog(target);
            if (Array.isArray(target.models) && target.models.length > 0) {
              finalModels = [...target.models];
            }
          } else if (liveIds.length > 0) {
            finalModels = replace
              ? [...new Set([...liveIds, ...catalogChatIds])]
              : [...new Set([...liveIds, ...(target.models || []), ...catalogChatIds])];
            target.models = finalModels;
          }
          target.updatedAt = checkedAt;
        });

        const liveSet = new Set(liveIds);
        const catalogOnly = catalogChatIds.filter((id) => !liveSet.has(id));
        return res.json({
          ok: true,
          models: finalModels,
          live: liveIds,
          catalogOnly,
          message: `Synced ${liveIds.length} plan models via Cloud Code Assist`
        });
      }
    }

    // Claude OAuth / Codex OAuth / Kimi Code OAuth accounts discover their live model catalog
    // and quota windows through official OAuth usage/model endpoints.
    const oauthModelKeys = (provider.apiKeys || []).filter(
      (k) =>
        k.enabled !== false &&
        !getCloudCodeFlavorForKey(k) &&
        (isClaudeOAuthKey(k) || isCodexOAuthKey(k) || isKimiOAuthKey(k))
    );
    if (oauthModelKeys.length > 0 && !isLocalUrl(provider.baseUrl)) {
      const oauthOpts = extractOAuthFlowsOptions(req);
      const allowLoopback = Boolean(
        oauthOpts.allowLoopback || req.app?.locals?.allowLoopbackTokenUri
      );
      if (!allowLoopback) {
        const syncedList = [];
        let lastErr = null;
        for (const k of oauthModelKeys) {
          try {
            const s = await syncOAuthAccountPlanAndModels(provider, k, storage, {
              dispatcher,
              saOptions,
              allowLoopback,
              replaceModels: replace && syncedList.length === 0
            });
            if (s) syncedList.push(s);
          } catch (err) {
            lastErr = err;
          }
        }
        if (syncedList.length > 0) {
          const latestProvider = storage.getProviderById(provider.id);
          const catalogChatIds = getCatalogChatModelIds(provider.preset);
          const liveIds = [...new Set(syncedList.flatMap((s) => s.liveIds || []))];
          const liveSet = new Set(liveIds);
          const catalogOnly = catalogChatIds.filter((id) => !liveSet.has(id));
          req.app?.locals?.routerService?.clearProviderCooldowns(provider.id);
          return res.json({
            ok: true,
            models: latestProvider?.models || [],
            live: liveIds,
            catalogOnly,
            provider: toPublicProvider(latestProvider),
            message: `Synced ${liveIds.length} live models from OAuth account (${catalogOnly.length} catalog-only merged)`
          });
        }
        if (lastErr) {
          return res.json({
            ok: false,
            models: provider.models || [],
            message: sanitizeSecrets(
              lastErr?.message || "Failed to sync OAuth account models",
              collectProviderSecrets(provider)
            )
          });
        }
      }
    }

    let resolvedSecret = "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authCtx = await resolveAuthContextForKey(keyEntry, {
        ...saOptions,
        ...(dispatcher ? { dispatcher } : {})
      });
      resolvedSecret = authCtx.secret;
      const headers = buildUpstreamHeaders(
        provider,
        resolvedSecret,
        undefined,
        authCtx.extraHeaders
      );
      const secrets = collectProviderSecrets(provider, resolvedSecret);

      const modelsUrl = buildUpstreamUrl(
        provider.baseUrl,
        provider.formatType,
        "models"
      );
      let upstreamRes = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {})
      });
      if ((upstreamRes.status === 401 || upstreamRes.status === 403) && resolvedSecret) {
        const altHeaders = buildAlternateAuthHeaders(headers, resolvedSecret);
        if (altHeaders) {
          const retryRes = await fetch(modelsUrl, {
            method: "GET",
            headers: altHeaders,
            signal: controller.signal,
            ...(dispatcher ? { dispatcher } : {})
          });
          if (retryRes.ok) {
            upstreamRes = retryRes;
          }
        }
      }
      clearTimeout(timer);

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text().catch(() => "");
        return res.json({
          ok: false,
          models: provider.models || [],
          message: sanitizeSecrets(
            errText.slice(0, 200) || `HTTP ${upstreamRes.status}`,
            secrets
          )
        });
      }

      const json = await upstreamRes.json();
      const rawList = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];

      const fetchedModels = rawList
        .map((m) => {
          if (typeof m === "string") return m.trim();
          const rawId = m?.id || m?.name || "";
          if (provider.preset === "gemini" && rawId.startsWith("models/")) {
            return rawId.slice("models/".length);
          }
          return rawId;
        })
        .filter(Boolean);

      const catalogChatIds = getCatalogChatModelIds(provider.preset);
      const liveSet = new Set(fetchedModels);
      const catalogOnly = catalogChatIds.filter((id) => !liveSet.has(id));
      const merged = replace
        ? [...new Set([...fetchedModels, ...catalogChatIds])]
        : [...new Set([...fetchedModels, ...(provider.models || []), ...catalogChatIds])];

      await storage.update((data) => {
        const target = data.providers.find((p) => p.id === provider.id);
        if (target) {
          target.models = merged;
          if (fetchedModels.length > 0) {
            const targetKey = (target.apiKeys || []).find((k) => k.id === keyEntry.id);
            if (targetKey) {
              targetKey.oauthMeta = {
                ...(targetKey.oauthMeta || {}),
                packageModels: fetchedModels,
                availableModels: fetchedModels.map((id) => ({
                  id,
                  label: id,
                  family: "claude_gpt",
                  kind: "chat",
                  isLive: true
                })),
                modelsCount: fetchedModels.length,
                checkedAt: new Date().toISOString()
              };
            }
          }
          target.updatedAt = new Date().toISOString();
        }
      });

      const updatedProvider = storage.getProviderById(provider.id);
      if (fetchedModels.length > 0) {
        req.app?.locals?.routerService?.clearProviderCooldowns(provider.id, keyEntry.id);
      }

      return res.json({
        ok: true,
        models: merged,
        live: fetchedModels,
        catalogOnly,
        provider: toPublicProvider(updatedProvider),
        message: `Fetched ${fetchedModels.length} live models (${catalogOnly.length} catalog-only merged)`
      });
    } catch (err) {
      clearTimeout(timer);
      return res.json({
        ok: false,
        models: provider.models || [],
        message: sanitizeSecrets(
          err?.message || "Failed to fetch models",
          collectProviderSecrets(provider, resolvedSecret)
        )
      });
    }
  });

  // --- Combos ---

  router.get("/combos", (_req, res) => {
    return res.json({ combos: storage.getCombos() });
  });

  router.post("/combos", async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Combo name is required" });
    }
    if (storage.getCombos().some((c) => c.name === name)) {
      return res.status(400).json({ error: `Combo '${name}' already exists` });
    }
    let strategy = "fallback";
    if (body.strategy !== undefined) {
      if (typeof body.strategy !== "string" || !VALID_COMBO_STRATEGIES.has(body.strategy)) {
        return res.status(400).json({
          error: "Invalid strategy. Must be 'fallback' or 'round-robin'"
        });
      }
      strategy = body.strategy;
    }
    const targets = Array.isArray(body.targets)
      ? body.targets.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim())
      : [];

    const now = new Date().toISOString();
    const combo = {
      id: nanoid(),
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      strategy,
      targets,
      enabled: body.enabled !== false,
      createdAt: now,
      updatedAt: now
    };

    await storage.update((data) => {
      data.combos.push(combo);
    });

    return res.status(201).json({ combo });
  });

  router.put("/combos/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const existing = storage.getCombos().find((c) => c.id === id);
    if (!existing) {
      return res.status(404).json({ error: "Combo not found" });
    }

    if (body.name !== undefined) {
      const nextName = typeof body.name === "string" ? body.name.trim() : "";
      if (!nextName) {
        return res.status(400).json({ error: "Combo name cannot be empty" });
      }
      if (storage.getCombos().some((c) => c.id !== id && c.name === nextName)) {
        return res.status(400).json({ error: `Combo '${nextName}' already exists` });
      }
    }

    if (body.strategy !== undefined) {
      if (typeof body.strategy !== "string" || !VALID_COMBO_STRATEGIES.has(body.strategy)) {
        return res.status(400).json({
          error: "Invalid strategy. Must be 'fallback' or 'round-robin'"
        });
      }
    }

    const updated = await storage.update((data) => {
      const target = data.combos.find((c) => c.id === id);
      if (!target) return null;
      if (body.name !== undefined) target.name = body.name.trim();
      if (body.description !== undefined) {
        target.description = String(body.description).trim();
      }
      if (body.strategy !== undefined) {
        target.strategy = body.strategy;
      }
      if (Array.isArray(body.targets)) {
        target.targets = body.targets
          .filter((t) => typeof t === "string" && t.trim())
          .map((t) => t.trim());
      }
      if (body.enabled !== undefined) target.enabled = Boolean(body.enabled);
      target.updatedAt = new Date().toISOString();
      return target;
    });

    return res.json({ combo: updated });
  });

  router.delete("/combos/:id", async (req, res) => {
    const { id } = req.params;
    const removed = await storage.update((data) => {
      const idx = data.combos.findIndex((c) => c.id === id);
      if (idx === -1) return false;
      data.combos.splice(idx, 1);
      return true;
    });
    if (!removed) {
      return res.status(404).json({ error: "Combo not found" });
    }
    return res.json({ ok: true });
  });

  router.post("/combos/reorder", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === "string") : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }
    const reordered = await storage.update((data) => {
      const byId = new Map(data.combos.map((c) => [c.id, c]));
      const next = [];
      for (const id of ids) {
        if (byId.has(id)) {
          next.push(byId.get(id));
          byId.delete(id);
        }
      }
      for (const rest of byId.values()) next.push(rest);
      data.combos = next;
      return data.combos;
    });
    return res.json({ ok: true, combos: reordered });
  });

  router.post("/combos/bulk-delete", async (req, res) => {
    const ids = new Set(Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === "string") : []);
    if (ids.size === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }
    const deletedCount = await storage.update((data) => {
      const before = data.combos.length;
      data.combos = data.combos.filter((c) => !ids.has(c.id));
      return before - data.combos.length;
    });
    return res.json({ ok: true, deletedCount });
  });

  // --- Router API Keys ---

  router.get("/keys", (_req, res) => {
    return res.json({ keys: storage.getKeys().map(toPublicRouterKey) });
  });

  router.get("/keys/reveal-initial", (_req, res) => {
    const initial = storage.consumeInitialRouterKey();
    if (!initial || !initial.key) {
      return res.status(404).json({
        ok: false,
        revealed: false,
        key: null,
        error: "Initial router key has already been revealed"
      });
    }
    return res.json({
      ok: true,
      revealed: true,
      id: initial.id,
      name: initial.name,
      key: initial.key,
      keyPreview: initial.keyPreview
    });
  });

  router.post("/keys", async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Key name is required" });
    }
    const keyVal = `sk-001r-${nanoid(24)}`;
    const { keyHash, prefix, last4 } = deriveRouterKeyFields(keyVal);
    const storedKey = {
      id: nanoid(),
      name,
      keyHash,
      prefix,
      last4,
      keyPreview: maskKey(keyVal),
      enabled: true,
      requestCount: 0,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      ...(body.access && typeof body.access === "object"
        ? {
            access: {
              restricted: Boolean(body.access.restricted),
              allow: Array.isArray(body.access.allow)
                ? [
                    ...new Set(
                      body.access.allow
                        .filter((x) => typeof x === "string" && x.trim())
                        .map((x) => x.trim())
                    )
                  ]
                : []
            }
          }
        : {})
    };

    await storage.update((data) => {
      data.keys.push(storedKey);
    });

    // Return plaintext key ONCE on creation
    return res.status(201).json({
      key: {
        ...toPublicRouterKey(storedKey),
        key: keyVal
      }
    });
  });

  router.patch("/keys/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const updated = await storage.update((data) => {
      const target = data.keys.find((k) => k.id === id);
      if (!target) return null;
      if (typeof body.name === "string" && body.name.trim()) {
        target.name = body.name.trim();
      }
      if (body.proxyPoolId !== undefined) {
        target.proxyPoolId =
          typeof body.proxyPoolId === "string" && body.proxyPoolId.trim()
            ? body.proxyPoolId.trim()
            : null;
      }
      if (body.access && typeof body.access === "object") {
        target.access = {
          restricted: Boolean(body.access.restricted),
          allow: Array.isArray(body.access.allow)
            ? [...new Set(body.access.allow.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))]
            : target.access?.allow || []
        };
      }
      if (body.enabled !== undefined) {
        target.enabled = Boolean(body.enabled);
      }
      return target;
    });

    if (!updated) {
      return res.status(404).json({ error: "Key not found" });
    }
    return res.json({ key: toPublicRouterKey(updated) });
  });

  router.delete("/keys/:id", async (req, res) => {
    const { id } = req.params;
    const removed = await storage.update((data) => {
      const idx = data.keys.findIndex((k) => k.id === id);
      if (idx === -1) return false;
      data.keys.splice(idx, 1);
      return true;
    });
    if (!removed) {
      return res.status(404).json({ error: "Key not found" });
    }
    return res.json({ ok: true });
  });

  // --- Usage & Logs (Enhanced 9Router Parity: 6 periods, cost breakdown, byKey, byEndpoint, live SSE + persisted Supabase/DB sync) ---

  const mapPersistedLogToRecent = (log) => {
    const httpCode = Number(log.status) || 200;
    const ok = httpCode >= 200 && httpCode < 400;
    return {
      id: log.id || `${log.timestamp || ""}-${log.providerSlug || "router"}-${log.latencyMs || 0}`,
      timestamp: log.timestamp || new Date().toISOString(),
      provider: log.providerSlug || "router",
      model: log.resolvedModel || log.requestedModel || log.providerSlug || "unknown",
      requestedModel: log.requestedModel || "",
      resolvedModel: log.resolvedModel || "",
      endpoint: log.endpoint || "/v1/chat/completions",
      keyName: log.keyName || "Anonymous",
      status: ok ? "ok" : "error",
      httpStatus: httpCode,
      promptTokens: Number(log.promptTokens) || 0,
      completionTokens: Number(log.completionTokens) || 0,
      cachedTokens: Number(log.cachedTokens) || 0,
      cost: Number(log.estimatedCost) || 0,
      savedChars: Number(log.savedChars) || 0,
      latencyMs: Number(log.latencyMs) || 0,
      fallbackHops: Number(log.fallbackHops) || 0,
      stream: Boolean(log.stream),
      ...(log.error ? { error: log.error } : {}),
      ...(Array.isArray(log.attemptTrail) ? { attemptTrail: log.attemptTrail } : {})
    };
  };

  const buildMergedRecentRequests = (limit = 100) => {
    const maxItems = Math.max(1, Math.min(Number(limit) || 100, 200));
    const liveSnap = liveEvents
      ? liveEvents.getUsageSnapshot(maxItems)
      : { activeRequests: {}, activeModels: {}, recentRequests: [], errorProvider: null };
    const persisted = storage.getLogs().slice(0, maxItems).map(mapPersistedLogToRecent);

    const byId = new Map();
    for (const item of persisted) {
      byId.set(item.id, item);
    }
    for (const item of liveSnap.recentRequests || []) {
      const existing = byId.get(item.id);
      if (existing) {
        // Prefer richer persisted record while keeping any fresher live metadata
        byId.set(item.id, {
          ...item,
          ...existing,
          promptTokens: existing.promptTokens || item.promptTokens || 0,
          completionTokens: existing.completionTokens || item.completionTokens || 0,
          cachedTokens: existing.cachedTokens || item.cachedTokens || 0,
          cost: existing.cost || item.cost || 0,
          savedChars: existing.savedChars || item.savedChars || 0
        });
      } else {
        // Avoid duplicating if an older live item has a random ID matching a persisted log
        const itemTs = Date.parse(item.timestamp || "");
        const dup = persisted.some(
          (p) =>
            p.provider === item.provider &&
            p.model === item.model &&
            p.httpStatus === (item.httpStatus || 200) &&
            Math.abs((Date.parse(p.timestamp || "") || 0) - (itemTs || 0)) <= 2000 &&
            Math.abs((p.latencyMs || 0) - (item.latencyMs || 0)) <= 50
        );
        if (!dup) {
          byId.set(item.id, item);
        }
      }
    }

    const merged = [...byId.values()]
      .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
      .slice(0, maxItems);

    return {
      activeRequests: liveSnap.activeRequests || {},
      activeModels: liveSnap.activeModels || {},
      recentRequests: merged,
      errorProvider: liveSnap.errorProvider || null,
      totalLogged: storage.getLogs().length,
      timestamp: new Date().toISOString()
    };
  };

  const buildUsageSeries = (filteredLogs, range, nowMs) => {
    const pad2 = (n) => String(n).padStart(2, "0");
    const emptyBucket = (key, label, fullLabel) => ({
      key,
      date: key,
      label,
      fullLabel,
      requests: 0,
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cost: 0,
      errors: 0,
      savedChars: 0
    });

    const addLog = (bucket, log) => {
      const isOk = log.status >= 200 && log.status < 400;
      const pTok = Number(log.promptTokens) || 0;
      const cTok = Number(log.completionTokens) || 0;
      const caTok = Number(log.cachedTokens) || 0;
      const cost = Number(log.estimatedCost) || 0;
      const saved = Number(log.savedChars) || 0;
      bucket.requests += 1;
      bucket.tokens += pTok + cTok;
      bucket.promptTokens += pTok;
      bucket.completionTokens += cTok;
      bucket.cachedTokens += caTok;
      bucket.cost = Number((bucket.cost + cost).toFixed(6));
      if (!isOk) bucket.errors += 1;
      bucket.savedChars += saved;
    };

    if (range === "today") {
      // 12 two-hour buckets across today (UTC day matching todayPrefix)
      const dayStr = new Date(nowMs).toISOString().slice(0, 10);
      const buckets = Array.from({ length: 12 }, (_, idx) => {
        const h0 = idx * 2;
        const h1 = h0 + 2;
        return emptyBucket(
          `${dayStr}T${pad2(h0)}`,
          `${pad2(h0)}h`,
          `${dayStr} · ${pad2(h0)}:00–${pad2(h1)}:00`
        );
      });
      for (const log of filteredLogs) {
        const ts = Date.parse(log.timestamp);
        if (!Number.isFinite(ts)) continue;
        const hr = new Date(ts).getUTCHours();
        const idx = Math.max(0, Math.min(11, Math.floor(hr / 2)));
        addLog(buckets[idx], log);
      }
      return buckets;
    }

    if (range === "24h") {
      // 12 rolling two-hour buckets ending at current hour
      const bucketMs = 2 * 60 * 60 * 1000;
      const endBucket = Math.floor(nowMs / bucketMs) * bucketMs + bucketMs;
      const startBucket = endBucket - 12 * bucketMs;
      const buckets = Array.from({ length: 12 }, (_, idx) => {
        const t0 = startBucket + idx * bucketMs;
        const d0 = new Date(t0);
        const h0 = pad2(d0.getUTCHours());
        const d1 = new Date(t0 + bucketMs);
        const h1 = pad2(d1.getUTCHours());
        const dayPart = d0.toISOString().slice(5, 10);
        return emptyBucket(
          d0.toISOString().slice(0, 13),
          `${h0}h`,
          `${dayPart} · ${h0}:00–${h1}:00`
        );
      });
      for (const log of filteredLogs) {
        const ts = Date.parse(log.timestamp);
        if (!Number.isFinite(ts)) continue;
        const idx = Math.floor((ts - startBucket) / bucketMs);
        if (idx >= 0 && idx < 12) addLog(buckets[idx], log);
      }
      return buckets;
    }

    if (range === "7d") {
      const dayMs = 24 * 60 * 60 * 1000;
      const buckets = [];
      const byDate = new Map();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(nowMs - i * dayMs);
        const iso = d.toISOString().slice(0, 10);
        const b = emptyBucket(iso, iso.slice(5), iso);
        buckets.push(b);
        byDate.set(iso, b);
      }
      for (const log of filteredLogs) {
        const iso = typeof log.timestamp === "string" ? log.timestamp.slice(0, 10) : "";
        const b = byDate.get(iso);
        if (b) addLog(b, log);
      }
      return buckets;
    }

    // 30d / 60d / all -> 10 to 12 clean chronological buckets so bars & scrub line stay balanced
    const totalDays = range === "30d" ? 30 : range === "60d" ? 60 : 0;
    const dayMs = 24 * 60 * 60 * 1000;
    let spanStart = nowMs - 11 * dayMs;
    if (totalDays > 0) {
      spanStart = nowMs - (totalDays - 1) * dayMs;
    } else if (filteredLogs.length > 0) {
      const parsedTs = filteredLogs.map((l) => Date.parse(l.timestamp)).filter(Number.isFinite);
      if (parsedTs.length > 0) {
        spanStart = Math.min(...parsedTs);
      }
    }
    const slotCount = range === "30d" ? 10 : 12;
    const totalSpan = Math.max(dayMs * slotCount, nowMs - spanStart + dayMs);
    const stepMs = totalSpan / slotCount;
    const buckets = Array.from({ length: slotCount }, (_, idx) => {
      const t0 = spanStart + idx * stepMs;
      const t1 = t0 + stepMs - 1;
      const s0 = new Date(t0).toISOString().slice(5, 10);
      const s1 = new Date(Math.min(t1, nowMs)).toISOString().slice(5, 10);
      return emptyBucket(
        new Date(t0).toISOString().slice(0, 10) + `#${idx}`,
        s0,
        s0 === s1 ? s0 : `${s0} → ${s1}`
      );
    });
    for (const log of filteredLogs) {
      const ts = Date.parse(log.timestamp);
      if (!Number.isFinite(ts)) continue;
      const idx = Math.max(0, Math.min(slotCount - 1, Math.floor((ts - spanStart) / stepMs)));
      addLog(buckets[idx], log);
    }
    return buckets;
  };

  router.get("/usage/live", (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 100;
    return res.json(buildMergedRecentRequests(limit));
  });

  router.get("/usage/stream", (req, res) => {
    if (!liveEvents) {
      return res.status(503).json({ error: "Live events hub unavailable" });
    }
    return liveEvents.attachUsageStream(req, res, buildMergedRecentRequests(100));
  });

  router.get("/usage", (req, res) => {
    const rawRange = typeof req.query.range === "string" ? req.query.range : "7d";
    const range = ["today", "24h", "7d", "30d", "60d", "all"].includes(rawRange) ? rawRange : "7d";
    const now = Date.now();
    const todayPrefix = new Date(now).toISOString().slice(0, 10);
    const cutoff =
      range === "24h"
        ? now - 24 * 60 * 60 * 1000
        : range === "7d"
          ? now - 7 * 24 * 60 * 60 * 1000
          : range === "30d"
            ? now - 30 * 24 * 60 * 60 * 1000
            : range === "60d"
              ? now - 60 * 24 * 60 * 60 * 1000
              : 0;

    const logs = storage.getLogs().filter((log) => {
      if (range === "today") {
        return typeof log.timestamp === "string" && log.timestamp.startsWith(todayPrefix);
      }
      if (!cutoff) return true;
      const ts = Date.parse(log.timestamp);
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });

    let successRequests = 0;
    let errorRequests = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let totalCost = 0;
    let savedChars = 0;
    let latencySum = 0;

    const byDayMap = new Map();
    const byProviderMap = new Map();
    const byModelMap = new Map();
    const byKeyMap = new Map();
    const byEndpointMap = new Map();

    for (const log of logs) {
      const isOk = log.status >= 200 && log.status < 400;
      if (isOk) successRequests += 1;
      else errorRequests += 1;

      const pTok = Number(log.promptTokens) || 0;
      const cTok = Number(log.completionTokens) || 0;
      const caTok = Number(log.cachedTokens) || 0;
      const tok = pTok + cTok;
      const cost = Number(log.estimatedCost) || 0;
      const saved = Number(log.savedChars) || 0;
      const lat = Number(log.latencyMs) || 0;

      promptTokens += pTok;
      completionTokens += cTok;
      cachedTokens += caTok;
      totalCost += cost;
      savedChars += saved;
      latencySum += lat;

      const dateKey =
        typeof log.timestamp === "string" && log.timestamp.length >= 10
          ? log.timestamp.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
      const dayEntry = byDayMap.get(dateKey) || {
        date: dateKey,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        errors: 0,
        savedChars: 0
      };
      dayEntry.requests += 1;
      dayEntry.tokens += tok;
      dayEntry.promptTokens += pTok;
      dayEntry.completionTokens += cTok;
      dayEntry.cost = Number((dayEntry.cost + cost).toFixed(6));
      if (!isOk) dayEntry.errors += 1;
      dayEntry.savedChars += saved;
      byDayMap.set(dateKey, dayEntry);

      const provKey = log.providerSlug || "unknown";
      const provEntry = byProviderMap.get(provKey) || {
        provider: provKey,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        cost: 0,
        errors: 0,
        lastUsed: null
      };
      provEntry.requests += 1;
      provEntry.tokens += tok;
      provEntry.promptTokens += pTok;
      provEntry.completionTokens += cTok;
      provEntry.cachedTokens += caTok;
      provEntry.cost = Number((provEntry.cost + cost).toFixed(6));
      if (!isOk) provEntry.errors += 1;
      if (!provEntry.lastUsed || log.timestamp > provEntry.lastUsed) provEntry.lastUsed = log.timestamp;
      byProviderMap.set(provKey, provEntry);

      const modelKey = log.resolvedModel || log.requestedModel || "unknown";
      const modelEntry = byModelMap.get(modelKey) || {
        model: modelKey,
        provider: provKey,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        cost: 0,
        errors: 0,
        lastUsed: null
      };
      modelEntry.requests += 1;
      modelEntry.tokens += tok;
      modelEntry.promptTokens += pTok;
      modelEntry.completionTokens += cTok;
      modelEntry.cachedTokens += caTok;
      modelEntry.cost = Number((modelEntry.cost + cost).toFixed(6));
      if (!isOk) modelEntry.errors += 1;
      if (!modelEntry.lastUsed || log.timestamp > modelEntry.lastUsed) modelEntry.lastUsed = log.timestamp;
      byModelMap.set(modelKey, modelEntry);

      const keyLabel = log.keyName || "Anonymous";
      const keyEntry = byKeyMap.get(keyLabel) || {
        keyName: keyLabel,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        errors: 0,
        lastUsed: null
      };
      keyEntry.requests += 1;
      keyEntry.tokens += tok;
      keyEntry.promptTokens += pTok;
      keyEntry.completionTokens += cTok;
      keyEntry.cost = Number((keyEntry.cost + cost).toFixed(6));
      if (!isOk) keyEntry.errors += 1;
      if (!keyEntry.lastUsed || log.timestamp > keyEntry.lastUsed) keyEntry.lastUsed = log.timestamp;
      byKeyMap.set(keyLabel, keyEntry);

      const epKey = log.endpoint || "/v1/chat/completions";
      const epEntry = byEndpointMap.get(epKey) || {
        endpoint: epKey,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        errors: 0,
        lastUsed: null
      };
      epEntry.requests += 1;
      epEntry.tokens += tok;
      epEntry.promptTokens += pTok;
      epEntry.completionTokens += cTok;
      epEntry.cost = Number((epEntry.cost + cost).toFixed(6));
      if (!isOk) epEntry.errors += 1;
      if (!epEntry.lastUsed || log.timestamp > epEntry.lastUsed) epEntry.lastUsed = log.timestamp;
      byEndpointMap.set(epKey, epEntry);
    }

    const totalRequests = logs.length;
    const mergedLive = buildMergedRecentRequests(100);
    const series = buildUsageSeries(logs, range, now);
    return res.json({
      range,
      summary: {
        totalRequests,
        successRequests,
        errorRequests,
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens: promptTokens + completionTokens,
        totalCost: Number(totalCost.toFixed(6)),
        savedChars,
        avgLatencyMs: totalRequests > 0 ? Math.round(latencySum / totalRequests) : 0
      },
      series,
      byDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byProvider: [...byProviderMap.values()].sort((a, b) => b.requests - a.requests),
      byModel: [...byModelMap.values()].sort((a, b) => b.requests - a.requests),
      byKey: [...byKeyMap.values()].sort((a, b) => b.requests - a.requests),
      byEndpoint: [...byEndpointMap.values()].sort((a, b) => b.requests - a.requests),
      activeRequests: mergedLive.activeRequests,
      activeModels: mergedLive.activeModels || {},
      recentRequests: mergedLive.recentRequests,
      errorProvider: mergedLive.errorProvider
    });
  });

  // --- Live Server Console Logs ---

  router.get("/console-logs", (req, res) => {
    const limit = Number(req.query.limit) || 200;
    return res.json({
      logs: liveEvents ? liveEvents.getConsoleLogs(limit) : []
    });
  });

  router.delete("/console-logs", (_req, res) => {
    liveEvents?.clearConsoleLogs();
    return res.json({ ok: true });
  });

  router.get("/console-logs/stream", (req, res) => {
    if (!liveEvents) {
      return res.status(503).json({ error: "Console log stream unavailable" });
    }
    return liveEvents.attachConsoleStream(req, res);
  });

  // --- Model Aliases & Disabled Models (9Router Parity) ---

  router.get("/models/alias", (_req, res) => {
    return res.json({ aliases: storage.getModelAliases() });
  });

  router.put("/models/alias", async (req, res) => {
    const alias = typeof req.body?.alias === "string" ? req.body.alias.trim() : "";
    const target = typeof req.body?.model === "string"
      ? req.body.model.trim()
      : typeof req.body?.target === "string"
        ? req.body.target.trim()
        : "";
    if (!alias || !target || !isSafePropertyKey(alias)) {
      return res.status(400).json({ error: "Both valid 'alias' and 'model' are required" });
    }
    const aliases = await storage.setModelAlias(alias, target);
    return res.json({ ok: true, aliases });
  });

  router.delete("/models/alias", async (req, res) => {
    const alias =
      (typeof req.query.alias === "string" && req.query.alias.trim()) ||
      (typeof req.body?.alias === "string" && req.body.alias.trim()) ||
      "";
    if (!alias || !isSafePropertyKey(alias)) {
      return res.status(400).json({ error: "Valid alias is required" });
    }
    await storage.deleteModelAlias(alias);
    return res.json({ ok: true, aliases: storage.getModelAliases() });
  });

  router.get("/models/disabled", (req, res) => {
    const providerSlug =
      typeof req.query.provider === "string" ? req.query.provider.trim() : "";
    const all = storage.getDisabledModels();
    if (providerSlug) {
      return res.json({
        provider: providerSlug,
        ids: isSafePropertyKey(providerSlug) && Object.hasOwn(all, providerSlug) ? all[providerSlug] : []
      });
    }
    return res.json({ disabledModels: all });
  });

  router.post("/models/disabled", async (req, res) => {
    const providerSlug = typeof req.body?.provider === "string" ? req.body.provider.trim() : "";
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : typeof req.body?.id === "string" && req.body.id.trim()
        ? [req.body.id.trim()]
        : [];
    if (!providerSlug || !isSafePropertyKey(providerSlug) || ids.length === 0) {
      return res.status(400).json({ error: "Valid provider and ids are required" });
    }
    const next = await storage.disableModels(providerSlug, ids);
    return res.json({ ok: true, provider: providerSlug, ids: next });
  });

  router.delete("/models/disabled", async (req, res) => {
    const providerSlug = typeof req.query.provider === "string" ? req.query.provider.trim() : "";
    const modelId = typeof req.query.id === "string" ? req.query.id.trim() : "";
    if (!providerSlug || !isSafePropertyKey(providerSlug) || !modelId) {
      return res.status(400).json({ error: "Valid provider and id query params are required" });
    }
    const next = await storage.enableModel(providerSlug, modelId);
    return res.json({ ok: true, provider: providerSlug, ids: next });
  });

  // --- Model Pricing Settings (9Router /api/pricing Parity) ---

  router.get("/pricing", (_req, res) => {
    const customPricing = storage.getCustomPricing();
    const pricing = getMergedPricingMap(
      PRESETS,
      customPricing,
      storage.getCustomPricingVersion?.() ?? -1
    );
    return res.json({ pricing, customPricing });
  });

  router.put("/pricing", async (req, res) => {
    const body = req.body || {};
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const rate = normalizePricingRate(body.rate || body);
    if (!provider || !model || !rate || !isSafePropertyKey(provider) || !isSafePropertyKey(model)) {
      return res.status(400).json({ error: "Valid provider, model, and input/output pricing rates are required" });
    }
    const saved = await storage.setCustomPricing(provider, model, rate);
    return res.json({
      ok: true,
      provider,
      model,
      rate: saved,
      pricing: getMergedPricingMap(
        PRESETS,
        storage.getCustomPricing(),
        storage.getCustomPricingVersion?.() ?? -1
      )
    });
  });

  router.delete("/pricing", async (req, res) => {
    const provider = typeof req.query.provider === "string" ? req.query.provider.trim().toLowerCase() : "";
    const model = typeof req.query.model === "string" ? req.query.model.trim() : "";
    if ((provider && !isSafePropertyKey(provider)) || (model && !isSafePropertyKey(model))) {
      return res.status(400).json({ error: "Invalid provider or model key" });
    }
    await storage.resetCustomPricing(provider, model);
    return res.json({
      ok: true,
      pricing: getMergedPricingMap(
        PRESETS,
        storage.getCustomPricing(),
        storage.getCustomPricingVersion?.() ?? -1
      )
    });
  });

  // --- Headroom External Proxy Health Probe ---

  function validateHeadroomUrl(rawUrl, allowPrivateUpstreams = false) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || "").trim());
    } catch {
      return { valid: false, error: "Invalid headroomUrl" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "headroomUrl must start with http:// or https://" };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: "headroomUrl must not embed credentials" };
    }
    const ssrf = classifyHostForSSRF(parsed.hostname);
    if (ssrf.isMetadataOrLinkLocal) {
      return { valid: false, error: `SSRF guard: ${ssrf.reason || "forbidden headroomUrl host"}` };
    }
    if (ssrf.isPrivateLan && allowPrivateUpstreams !== true) {
      return { valid: false, error: `SSRF guard: ${ssrf.reason || "private headroomUrl host blocked"}` };
    }
    return { valid: true, url: parsed.toString().replace(/\/+$/, "") };
  }

  router.get("/headroom/status", async (req, res) => {
    const settings = storage.getSettings();
    const rawUrl =
      (typeof req.query.url === "string" && req.query.url.trim()) ||
      settings.headroomUrl ||
      "http://localhost:8787";
    const check = validateHeadroomUrl(rawUrl, settings.allowPrivateUpstreams);
    if (!check.valid) {
      return res.status(400).json({ running: false, online: false, error: check.error });
    }
    const status = await checkHeadroomStatus(check.url, req.app?.locals?.headroomFetchImpl);
    return res.json(status);
  });

  router.get("/logs", (req, res) => {
    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 100;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const statusFilter =
      typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const providerFilter =
      typeof req.query.provider === "string" ? req.query.provider.trim().toLowerCase() : "";
    const modelFilter =
      typeof req.query.model === "string" ? req.query.model.trim().toLowerCase() : "";

    const filtered = storage.getLogs().filter((log) => {
      if (statusFilter) {
        if (statusFilter === "success" || statusFilter === "ok") {
          if (!(log.status >= 200 && log.status < 400)) return false;
        } else if (statusFilter === "error") {
          if (log.status >= 200 && log.status < 400) return false;
        } else if (String(log.status) !== statusFilter) {
          return false;
        }
      }
      if (providerFilter) {
        if ((log.providerSlug || "").toLowerCase() !== providerFilter) return false;
      }
      if (modelFilter) {
        const reqM = (log.requestedModel || "").toLowerCase();
        const resM = (log.resolvedModel || "").toLowerCase();
        if (!reqM.includes(modelFilter) && !resM.includes(modelFilter)) return false;
      }
      return true;
    });

    return res.json({
      logs: filtered.slice(offset, offset + limit),
      total: filtered.length
    });
  });

  router.delete("/logs", async (_req, res) => {
    await storage.clearLogs();
    liveEvents?.clearRecentRequests();
    return res.json({ ok: true });
  });

  // --- Settings & Password ---

  router.get("/settings", (_req, res) => {
    return res.json({
      settings: storage.getSettings(),
      // Public deployments force key + login on, whatever the stored settings say.
      publicDeployment: isPublicDeployment(storage),
      effective: {
        requireKey: isRouterKeyRequired(storage),
        requireLogin: isDashboardLoginRequired(storage)
      }
    });
  });

  const handleUpdateSettings = async (req, res) => {
    const body = req.body || {};
    const patch = {};

    if (body.timeoutMs !== undefined) {
      const val = Number(body.timeoutMs);
      if (!Number.isFinite(val) || val < 100) {
        return res.status(400).json({ error: "timeoutMs must be >= 100" });
      }
      patch.timeoutMs = Math.floor(val);
    }
    if (body.tokenSaverEnabled !== undefined) {
      patch.tokenSaverEnabled = Boolean(body.tokenSaverEnabled);
    }
    if (body.tokenSaverMaxChars !== undefined) {
      const val = Number(body.tokenSaverMaxChars);
      if (!Number.isFinite(val) || val < 100) {
        return res.status(400).json({ error: "tokenSaverMaxChars must be >= 100" });
      }
      patch.tokenSaverMaxChars = Math.floor(val);
    }
    if (body.requireKey !== undefined) {
      const nextReqKey = Boolean(body.requireKey);
      if (!nextReqKey && isPublicDeployment(storage)) {
        return res.status(400).json({
          error: "Router API key enforcement cannot be disabled on public deployments"
        });
      }
      patch.requireKey = nextReqKey;
    }
    if (body.cavemanEnabled !== undefined) {
      patch.cavemanEnabled = Boolean(body.cavemanEnabled);
    }
    if (body.cavemanLevel !== undefined) {
      if (
        typeof body.cavemanLevel !== "string" ||
        !VALID_CAVEMAN_LEVELS.has(body.cavemanLevel)
      ) {
        return res.status(400).json({
          error: "cavemanLevel must be lite, full, ultra, wenyan-lite, wenyan, or wenyan-ultra"
        });
      }
      patch.cavemanLevel = body.cavemanLevel;
    }
    if (body.ponytailEnabled !== undefined) {
      patch.ponytailEnabled = Boolean(body.ponytailEnabled);
    }
    if (body.ponytailLevel !== undefined) {
      if (
        typeof body.ponytailLevel !== "string" ||
        !VALID_PONYTAIL_LEVELS.has(body.ponytailLevel)
      ) {
        return res.status(400).json({
          error: "ponytailLevel must be 'lite', 'full', or 'ultra'"
        });
      }
      patch.ponytailLevel = body.ponytailLevel;
    }
    if (body.customPromptEnabled !== undefined) {
      patch.customPromptEnabled = Boolean(body.customPromptEnabled);
    }
    if (body.customPrompt !== undefined) {
      patch.customPrompt = typeof body.customPrompt === "string" ? body.customPrompt.slice(0, 8000) : "";
    }
    if (body.headroomEnabled !== undefined) {
      patch.headroomEnabled = Boolean(body.headroomEnabled);
    }
    if (body.headroomUrl !== undefined) {
      const rawUrl = typeof body.headroomUrl === "string" ? body.headroomUrl.trim() : "";
      if (rawUrl) {
        const allowPriv =
          body.allowPrivateUpstreams !== undefined
            ? Boolean(body.allowPrivateUpstreams)
            : storage.getSettings().allowPrivateUpstreams;
        const check = validateHeadroomUrl(rawUrl, allowPriv);
        if (!check.valid) {
          return res.status(400).json({ error: check.error });
        }
        patch.headroomUrl = check.url;
      } else {
        patch.headroomUrl = "http://localhost:8787";
      }
    }
    if (body.headroomTimeoutMs !== undefined) {
      const val = Number(body.headroomTimeoutMs);
      if (!Number.isFinite(val) || val < 200 || val > 30000) {
        return res.status(400).json({ error: "headroomTimeoutMs must be between 200 and 30000" });
      }
      patch.headroomTimeoutMs = Math.floor(val);
    }
    if (body.capacityAdapter && typeof body.capacityAdapter === "object") {
      const current = storage.getSettings().capacityAdapter || {};
      const nextAdapter = { ...current };
      for (const cap of ["vision", "audioInput"]) {
        const entry = body.capacityAdapter[cap];
        if (entry && typeof entry === "object") {
          nextAdapter[cap] = {
            enabled: Boolean(entry.enabled),
            roundRobin: Boolean(entry.roundRobin),
            models: Array.isArray(entry.models)
              ? [...new Set(entry.models.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()))]
              : []
          };
        }
      }
      patch.capacityAdapter = nextAdapter;
    }
    if (body.fallbackStrategy !== undefined) {
      if (!["fill-first", "round-robin", "sticky-round-robin"].includes(body.fallbackStrategy)) {
        return res.status(400).json({
          error: "fallbackStrategy must be 'fill-first', 'round-robin', or 'sticky-round-robin'"
        });
      }
      patch.fallbackStrategy = body.fallbackStrategy;
    }
    if (body.stickyRoundRobinLimit !== undefined) {
      const val = Number(body.stickyRoundRobinLimit);
      if (!Number.isFinite(val) || val < 1 || val > 100) {
        return res.status(400).json({ error: "stickyRoundRobinLimit must be between 1 and 100" });
      }
      patch.stickyRoundRobinLimit = Math.floor(val);
    }
    if (body.enableTranslator !== undefined) {
      patch.enableTranslator = Boolean(body.enableTranslator);
    }
    if (body.requireLogin !== undefined) {
      const nextReq = Boolean(body.requireLogin);
      if (!nextReq && isPublicDeployment(storage)) {
        return res.status(400).json({
          error: "Dashboard login cannot be disabled when bound to a non-loopback or cloud address"
        });
      }
      patch.requireLogin = nextReq;
    }
    if (body.allowPrivateUpstreams !== undefined) {
      patch.allowPrivateUpstreams = Boolean(body.allowPrivateUpstreams);
    }
    if (body.catalogAutoSync !== undefined) {
      patch.catalogAutoSync = Boolean(body.catalogAutoSync);
    }
    if (body.tunnelDashboardAccess !== undefined) {
      const nextAccess = Boolean(body.tunnelDashboardAccess);
      if (nextAccess && storage.isDefaultPasswordSync()) {
        return res.status(400).json({
          error: "Change the default dashboard password before allowing dashboard access via tunnel"
        });
      }
      patch.tunnelDashboardAccess = nextAccess;
    }
    if (body.outboundProxyEnabled !== undefined) {
      patch.outboundProxyEnabled = Boolean(body.outboundProxyEnabled);
    }
    if (body.outboundProxyUrl !== undefined) {
      const rawUrl = typeof body.outboundProxyUrl === "string" ? body.outboundProxyUrl.trim() : "";
      if (rawUrl) {
        const parsed = parseProxyUrl(rawUrl);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error || "Invalid outbound proxy URL" });
        }
        const ssrf = classifyHostForSSRF(parsed.host);
        const allowPriv =
          body.allowPrivateUpstreams !== undefined
            ? Boolean(body.allowPrivateUpstreams)
            : storage.getSettings().allowPrivateUpstreams;
        if (
          ssrf.isMetadataOrLinkLocal ||
          (ssrf.isPrivateLan && allowPriv !== true) ||
          (ssrf.isLoopback && allowPriv === false)
        ) {
          return res.status(400).json({ error: "Outbound proxy host is blocked by SSRF policy" });
        }
        patch.outboundProxyUrl = parsed.url;
      } else {
        patch.outboundProxyUrl = "";
      }
    }
    if (body.outboundNoProxy !== undefined) {
      patch.outboundNoProxy =
        typeof body.outboundNoProxy === "string" ? body.outboundNoProxy.slice(0, 1000) : "";
    }

    const updated = await storage.updateSettings(patch);
    return res.json({
      settings: updated,
      publicDeployment: isPublicDeployment(storage),
      effective: {
        requireKey: isRouterKeyRequired(storage, req),
        requireLogin: isDashboardLoginRequired(storage, req)
      }
    });
  };

  router.put("/settings", handleUpdateSettings);
  router.patch("/settings", handleUpdateSettings);

  router.post("/settings/proxy-test", heavyProbeRateLimit, async (req, res) => {
    const rawUrl = typeof req.body?.proxyUrl === "string" ? req.body.proxyUrl.trim() : "";
    const parsed = parseProxyUrl(rawUrl);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error || "Invalid proxy URL" });
    }
    const ssrf = classifyHostForSSRF(parsed.host);
    const allowPriv = storage.getSettings().allowPrivateUpstreams;
    if (
      ssrf.isMetadataOrLinkLocal ||
      (ssrf.isPrivateLan && allowPriv !== true) ||
      (ssrf.isLoopback && allowPriv === false)
    ) {
      return res.status(400).json({ ok: false, error: "Proxy host is blocked by SSRF policy" });
    }

    const netMod = await import("node:net");
    const dnsMod = await import("node:dns");
    const started = Date.now();
    try {
      const host = parsed.host.replace(/^\[|\]$/g, "");
      let targetIp = host;
      if (!netMod.default.isIP(host)) {
        const addrs = await dnsMod.default.promises.lookup(host, { all: true });
        if (!addrs?.length) {
          return res.status(400).json({ ok: false, error: "Proxy DNS lookup returned no addresses" });
        }
        targetIp = addrs[0].address;
      }
      const probeOk = await new Promise((resolve, reject) => {
        const sock = netMod.default.createConnection({ host: targetIp, port: parsed.port });
        sock.setTimeout(5000);
        sock.once("connect", () => {
          sock.destroy();
          resolve(true);
        });
        sock.once("timeout", () => {
          sock.destroy();
          reject(new Error("Proxy connection timed out"));
        });
        sock.once("error", (err) => {
          sock.destroy();
          reject(err);
        });
      });
      return res.json({
        ok: probeOk,
        status: "TCP_OK",
        elapsedMs: Date.now() - started
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        elapsedMs: Date.now() - started,
        error: sanitizeSecrets(err?.message || "Proxy test failed", [rawUrl])
      });
    }
  });

  // --- Local Cloudflare Tunnel & Tailscale Funnel ---

  const getTunnelManager = (req) => {
    const ov = req.app?.locals?.tunnelManagerOverride;
    return {
      getTunnelStatus: ov?.getTunnelStatus || getTunnelStatus,
      getDownloadStatus: ov?.getDownloadStatus || getDownloadStatus,
      enableTunnel: ov?.enableTunnel || enableTunnel,
      disableTunnel: ov?.disableTunnel || disableTunnel,
      getTailscaleStatus: ov?.getTailscaleStatus || getTailscaleStatus,
      enableTailscale: ov?.enableTailscale || enableTailscale,
      disableTailscale: ov?.disableTailscale || disableTailscale,
      cleanup: ov?.cleanup || cleanupLocalTunnels
    };
  };

  router.get("/tunnel/status", async (req, res) => {
    if (isPublicDeployment(storage)) {
      return res.json({
        tunnel: { enabled: false, settingsEnabled: false, tunnelUrl: "", publicUrl: "", running: false, installed: false },
        tailscale: { installed: false, loggedIn: false, running: false, enabled: false, settingsEnabled: false, tunnelUrl: "" },
        download: { downloading: false, progress: 0 },
        unavailableReason: "Tunnels are only available on local desktop installations"
      });
    }
    const mgr = getTunnelManager(req);
    const [tunnel, tailscale] = await Promise.all([
      mgr.getTunnelStatus(storage),
      mgr.getTailscaleStatus(storage)
    ]);
    return res.json({
      tunnel,
      tailscale,
      download: mgr.getDownloadStatus()
    });
  });

  router.post("/tunnel/enable", async (req, res) => {
    if (isPublicDeployment(storage)) {
      return res.status(403).json({ error: "Tunnel is disabled on public deployments" });
    }
    if (storage.isDefaultPasswordSync()) {
      return res.status(400).json({
        error: "Security required: Change the default dashboard password before enabling remote tunnel access"
      });
    }
    if (!isRouterKeyRequired(storage)) {
      return res.status(400).json({
        error: "Security required: Enable \"Require API key\" before enabling the tunnel"
      });
    }
    try {
      const mgr = getTunnelManager(req);
      const port = Number(req.app?.locals?.port) || storage.port || 20128;
      const result = await mgr.enableTunnel(storage, port);
      liveEvents?.log?.("info", "tunnel", `Cloudflare Quick Tunnel active: ${result.tunnelUrl}`);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to start tunnel" });
    }
  });

  router.post("/tunnel/disable", async (req, res) => {
    try {
      const mgr = getTunnelManager(req);
      const result = await mgr.disableTunnel(storage);
      liveEvents?.log?.("info", "tunnel", "Cloudflare Quick Tunnel disabled");
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to stop tunnel" });
    }
  });

  router.get("/tunnel/tailscale-check", async (req, res) => {
    if (isPublicDeployment(storage)) {
      return res.json({ installed: false, loggedIn: false, running: false, enabled: false, tunnelUrl: "" });
    }
    const mgr = getTunnelManager(req);
    const ts = await mgr.getTailscaleStatus(storage);
    return res.json(ts);
  });

  router.post("/tunnel/tailscale-enable", async (req, res) => {
    if (isPublicDeployment(storage)) {
      return res.status(403).json({ error: "Tailscale tunnel is disabled on public deployments" });
    }
    if (storage.isDefaultPasswordSync()) {
      return res.status(400).json({
        error: "Security required: Change the default dashboard password before enabling Tailscale Funnel"
      });
    }
    try {
      const mgr = getTunnelManager(req);
      const port = Number(req.app?.locals?.port) || storage.port || 20128;
      const result = await mgr.enableTailscale(storage, port);
      if (result?.success) {
        liveEvents?.log?.("info", "tunnel", `Tailscale Funnel active: ${result.tunnelUrl}`);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to enable Tailscale" });
    }
  });

  router.post("/tunnel/tailscale-disable", async (req, res) => {
    try {
      const mgr = getTunnelManager(req);
      const result = await mgr.disableTailscale(storage);
      liveEvents?.log?.("info", "tunnel", "Tailscale Funnel disabled");
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err?.message || "Failed to disable Tailscale" });
    }
  });

  // --- Version & Local Server Shutdown ---

  router.get("/version", (_req, res) => {
    return res.json({
      version: "2.0.0",
      currentVersion: "2.0.0",
      latestVersion: "2.0.0",
      hasUpdate: false
    });
  });

  router.post("/version/shutdown", async (req, res) => {
    const reqHost = parseHostHeaderName(req.headers?.host);
    if (isPublicDeployment(storage) || !reqHost || !isLoopbackHost(reqHost)) {
      return res.status(403).json({
        error: "Server shutdown is only permitted from localhost"
      });
    }
    await getTunnelManager(req).cleanup().catch(() => {});
    await storage.flushDeferred?.().catch(() => {});
    liveEvents?.log?.("warn", "server", "Shutdown requested from local dashboard");
    res.json({ success: true, message: "Shutting down 001Router proxy server..." });

    const allowExit =
      !process.env.NODE_TEST_CONTEXT && req.app?.locals?.allowProcessExit !== false;
    if (allowExit) {
      setTimeout(() => {
        try {
          req.app?.locals?.httpServer?.close?.(() => process.exit(0));
        } catch {
          // ignore
        }
        setTimeout(() => process.exit(0), 500).unref();
      }, 250).unref();
    }
  });

  router.post("/settings/password", sensitiveCryptoRateLimit, async (req, res) => {
    const body = req.body || {};
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword) {
      return res.status(401).json({ error: "Current password is required" });
    }
    const valid = await bcrypt.compare(currentPassword, storage.getPasswordHash());
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`
      });
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      // bcrypt only hashes the first 72 bytes; refuse silently-truncated secrets
      return res.status(400).json({
        error: `New password must be at most ${MAX_PASSWORD_LENGTH} characters`
      });
    }
    if (isTooCommonPassword(newPassword) || newPassword === currentPassword) {
      return res.status(400).json({
        error: "New password is too common or identical to the current password"
      });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);
    await storage.setPasswordHash(nextHash);

    // Rotate session cookie with new server-side sessionVersion so prior cookies are invalidated
    const rotatedToken = signSessionToken(
      storage.getSessionSecret(),
      SESSION_TTL_MS,
      storage.getSessionVersion()
    );
    res.cookie(
      SESSION_COOKIE_NAME,
      rotatedToken,
      buildSessionCookieOptions(req, SESSION_TTL_MS)
    );
    return res.json({
      ok: true,
      defaultPassword: storage.isDefaultPasswordSync()
    });
  });

  // --- Security Status & On-Demand Scan ---

  router.get("/security/status", (_req, res) => {
    return res.json(getSecurityStatus(storage));
  });

  router.post("/security/scan", sensitiveCryptoRateLimit, async (_req, res) => {
    const scanResult = await runSecurityScan({
      storage,
      dataDir: storage.dataDir,
      bindHost: storage.bindHost
    });
    return res.json(scanResult);
  });

  // --- Quota & Budget Tracker ---

  router.get("/quota", async (req, res) => {
    const cloudFetch = req.app?.locals?.googleOAuthFetchImpl || null;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const todayPrefix = nowIso.slice(0, 10);
    const monthPrefix = nowIso.slice(0, 7);

    /** @type {Map<string, { today: { requests: number, tokens: number, errors: number }, month: { requests: number, tokens: number, errors: number } }>} */
    const statsBySlug = new Map();
    const getBucket = (slug) => {
      let bucket = statsBySlug.get(slug);
      if (!bucket) {
        bucket = {
          today: { requests: 0, tokens: 0, errors: 0 },
          month: { requests: 0, tokens: 0, errors: 0 }
        };
        statsBySlug.set(slug, bucket);
      }
      return bucket;
    };

    /** Today's upstream attempts per provider key (`attemptTrail`), so each account shows its own. */
    const todayByKey = new Map();
    for (const log of storage.getLogs()) {
      if (!log || typeof log.timestamp !== "string" || !log.providerSlug) continue;
      const inMonth = log.timestamp.startsWith(monthPrefix);
      const inToday = log.timestamp.startsWith(todayPrefix);
      if (!inMonth && !inToday) continue;
      if (inToday && Array.isArray(log.attemptTrail)) {
        for (const hop of log.attemptTrail) {
          if (!hop?.keyId) continue;
          const k = todayByKey.get(hop.keyId) || { requests: 0, errors: 0 };
          k.requests += 1;
          if (!(hop.status >= 200 && hop.status < 400)) k.errors += 1;
          todayByKey.set(hop.keyId, k);
        }
      }

      const bucket = getBucket(log.providerSlug);
      const tokens = (Number(log.promptTokens) || 0) + (Number(log.completionTokens) || 0);
      const isErr = !(log.status >= 200 && log.status < 400);

      if (inMonth) {
        bucket.month.requests += 1;
        bucket.month.tokens += tokens;
        if (isErr) bucket.month.errors += 1;
      }
      if (inToday) {
        bucket.today.requests += 1;
        bucket.today.tokens += tokens;
        if (isErr) bucket.today.errors += 1;
      }
    }

    const quotas = storage.getQuotas();
    const items = await Promise.all(
      storage.getProviders().map(async (provider) => {
      const enabledKeys = (provider.apiKeys || []).filter((k) => k.enabled !== false);
      let activeKeys = 0;
      let cooldownKeys = 0;
      let maxCooldownRemainingMs = 0;

      for (const k of enabledKeys) {
        if (k.cooldownUntil && k.cooldownUntil > now) {
          cooldownKeys += 1;
          const remaining = k.cooldownUntil - now;
          if (remaining > maxCooldownRemainingMs) {
            maxCooldownRemainingMs = remaining;
          }
        } else {
          activeKeys += 1;
        }
      }

      const stats = statsBySlug.get(provider.slug) || {
        today: { requests: 0, tokens: 0, errors: 0 },
        month: { requests: 0, tokens: 0, errors: 0 }
      };
      const storedBudget = quotas[provider.id] || {};

      // Live plan/quota for Cloud Code Assist, Claude OAuth, OpenAI Codex OAuth, Kimi Code OAuth,
      // and any account with stored quota windows. Each key gets its own account entry.
      const quotaKeys = (provider.apiKeys || []).filter(
        (k) =>
          k.enabled !== false &&
          ((getCloudCodeFlavorForKey(k) && k.oauthCredentials) ||
            isClaudeOAuthKey(k) ||
            isCodexOAuthKey(k) ||
            isKimiOAuthKey(k) ||
            (Array.isArray(k.oauthMeta?.quotaWindows) && k.oauthMeta.quotaWindows.length > 0))
      );
      const dispatcher = quotaKeys.length ? getProxyDispatcher(provider, storage) : null;
      const isLoopbackBase = isLocalUrl(provider.baseUrl);
      const skipLiveOAuthQuota = Boolean(
        req.app?.locals?.oauthAllowLoopback || req.app?.locals?.allowLoopbackTokenUri
      );
      const saOptions = extractServiceAccountOptions(req);
      const cloudCodeAccounts = await Promise.all(
        quotaKeys.map(async (cliKey) => {
          const cliFlavor = getCloudCodeFlavorForKey(cliKey);
          const isClaudeOAuth = !cliFlavor && isClaudeOAuthKey(cliKey);
          const isCodexOAuth = !cliFlavor && !isClaudeOAuth && isCodexOAuthKey(cliKey);
          const isKimiOAuth = !cliFlavor && !isClaudeOAuth && !isCodexOAuth && isKimiOAuthKey(cliKey);
          const prev = cliKey.oauthMeta || {};
          const keyToday = todayByKey.get(cliKey.id) || { requests: 0, errors: 0 };
          const defaultFlavor = cliFlavor
            ? cliFlavor.id
            : isClaudeOAuth
              ? "claude"
              : isCodexOAuth
                ? "codex"
                : isKimiOAuth
                  ? "kimi"
                  : provider.preset || provider.slug;
          const defaultTierLabel = cliFlavor
            ? `${cliFlavor.label} · Connected`
            : isClaudeOAuth
              ? "Claude OAuth"
              : isCodexOAuth
                ? "OpenAI Codex"
                : isKimiOAuth
                  ? "Kimi Code"
                  : provider.name || provider.slug;
          // Stored values (from sign-in / last refresh) when the live read fails or isn't needed.
          const account = {
            keyId: cliKey.id,
            label: cliKey.label || cliKey.name || "",
            flavor: defaultFlavor,
            email: prev.email || "",
            tier: prev.tier || "",
            tierLabel: prev.tierLabel || defaultTierLabel,
            projectId: prev.projectId || "",
            buckets: Array.isArray(prev.quotaBuckets) ? prev.quotaBuckets : [],
            windows: Array.isArray(prev.quotaWindows) ? prev.quotaWindows : [],
            perModelHidden: prev.perModelHidden === true,
            models: Array.isArray(prev.availableModels) ? prev.availableModels : [],
            defaultModelId: prev.defaultModelId || "",
            checkedAt: prev.checkedAt || "",
            cooldownUntil: cliKey.cooldownUntil && cliKey.cooldownUntil > now ? cliKey.cooldownUntil : 0,
            today: keyToday,
            live: false,
            error: ""
          };
          try {
            let usage = null;
            if (cliFlavor && cliKey.oauthCredentials) {
              const { accessToken } = await getGeminiCliAccessToken(cliKey.oauthCredentials, {
                ...(dispatcher ? { dispatcher } : {}),
                ...(cloudFetch ? { fetchImpl: cloudFetch } : {})
              });
              usage = await fetchCloudCodeUsage(accessToken, {
                projectId: account.projectId,
                ...(dispatcher ? { dispatcher } : {}),
                ...(cloudFetch ? { fetchImpl: cloudFetch } : {}),
                flavor: cliFlavor.id
              });
              if (!usage.planOk && !usage.quotaOk) {
                account.error = "Google did not return plan or quota for this account.";
                return account;
              }
            } else if ((isClaudeOAuth || isCodexOAuth || isKimiOAuth) && !isLoopbackBase && !skipLiveOAuthQuota) {
              const authCtx = await resolveAuthContextForKey(cliKey, {
                ...saOptions,
                ...(dispatcher ? { dispatcher } : {})
              });
              if (isClaudeOAuth) {
                usage = await fetchClaudeOAuthUsage(authCtx.secret, {
                  ...(dispatcher ? { dispatcher } : {})
                });
              } else if (isCodexOAuth) {
                usage = await fetchCodexOAuthUsage(authCtx.secret, {
                  accountId: prev.accountId || "",
                  ...(dispatcher ? { dispatcher } : {})
                });
              } else {
                const isOAuth = cliKey.authMethod === "oauth2" && Boolean(cliKey.oauthCredentials);
                usage = await fetchKimiOAuthUsage(
                  isOAuth ? authCtx.secret : "",
                  isOAuth ? "" : authCtx.secret,
                  {
                    deviceId: prev.deviceId || "",
                    ...(dispatcher ? { dispatcher } : {})
                  }
                );
              }
              if (!usage?.planOk && !usage?.quotaOk) {
                account.error = usage?.warning || "Provider did not return plan or quota for this account.";
                return account;
              }
            } else {
              // Stored quota/catalog snapshot only (static key or offline loopback mode)
              return account;
            }
            Object.assign(account, {
              ...(usage.email ? { email: usage.email } : {}),
              tier: usage.tier || account.tier,
              tierLabel: usage.tierLabel || account.tierLabel,
              projectId: usage.projectId || account.projectId,
              buckets:
                Array.isArray(usage.buckets) && usage.buckets.length > 0
                  ? usage.buckets
                  : account.buckets?.length
                    ? account.buckets
                    : usage.buckets || [],
              windows:
                Array.isArray(usage.windows) && usage.windows.length > 0
                  ? usage.windows
                  : account.windows?.length
                    ? account.windows
                    : usage.windows || [],
              perModelHidden: Boolean(usage.perModelHidden),
              ...(usage.catalogOk && Array.isArray(usage.models) && usage.models.length > 0
                ? {
                    models: usage.models,
                    defaultModelId: usage.defaultModelId || account.defaultModelId
                  }
                : {}),
              checkedAt: new Date().toISOString(),
              live: true
            });

            // Keep the stored plan / catalog in step with this live read, so the Providers page and
            // the router see the same plan. Written only when something changed (or every hour).
            const idsOf = (list) => (Array.isArray(list) ? list.map((m) => m?.id).join(",") : "");
            const staleMs = Date.now() - (Date.parse(prev.checkedAt || "") || 0);
            const changed =
              (usage.tierLabel && usage.tierLabel !== prev.tierLabel) ||
              (usage.catalogOk && idsOf(usage.models) !== idsOf(prev.availableModels)) ||
              staleMs > 60 * 60 * 1000;
            if (changed) {
              const checkedAt = account.checkedAt;
              await storage
                .update((data) => {
                  const p = data.providers.find((x) => x.id === provider.id);
                  const k = (p?.apiKeys || []).find((x) => x.id === cliKey.id);
                  if (!k) return;
                  k.oauthMeta = mergeCloudCodeUsage(k.oauthMeta, usage, checkedAt);
                  if (cliFlavor) {
                    if (syncProviderModelsWithCatalog(p)) p.updatedAt = checkedAt;
                  } else if (Array.isArray(usage.models) && usage.models.length > 0) {
                    const liveIds = (usage.liveModelIds?.length
                      ? usage.liveModelIds
                      : usage.models.map((m) => m.id)
                    ).filter(Boolean);
                    if (liveIds.length > 0) {
                      p.models = [...new Set([...liveIds, ...(p.models || []), ...getCatalogChatModelIds(p.preset)])];
                      p.updatedAt = checkedAt;
                    }
                  }
                })
                .catch(() => {});
            }
          } catch (err) {
            // Best-effort: one account failing never breaks the others or the quota list.
            account.error = sanitizeSecrets(String(err?.message || "live read failed").slice(0, 200), []);
          }
          return account;
        })
      );
      const cloudCodeQuota = cloudCodeAccounts.find((a) => a.live) || cloudCodeAccounts[0] || null;

      return {
        providerId: provider.id,
        slug: provider.slug,
        name: provider.name,
        preset: provider.preset,
        enabled: provider.enabled !== false,
        activeKeys,
        cooldownKeys,
        maxCooldownRemainingMs,
        today: stats.today,
        month: stats.month,
        budget: {
          dailyTokenLimit: storedBudget.dailyTokenLimit ?? null,
          dailyRequestLimit: storedBudget.dailyRequestLimit ?? null,
          monthlyTokenLimit: storedBudget.monthlyTokenLimit ?? null
        },
        ...(cloudCodeQuota ? { cloudCodeQuota, cloudCodeAccounts } : {})
      };
      })
    );

    return res.json({ items });
  });

  router.put("/quota/:providerId", async (req, res) => {
    const { providerId } = req.params;
    const provider = storage.getProviderById(providerId);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const body = req.body || {};
    const existing = storage.getQuota(providerId) || {
      dailyTokenLimit: null,
      dailyRequestLimit: null,
      monthlyTokenLimit: null
    };

    const nextBudget = {
      dailyTokenLimit: existing.dailyTokenLimit ?? null,
      dailyRequestLimit: existing.dailyRequestLimit ?? null,
      monthlyTokenLimit: existing.monthlyTokenLimit ?? null
    };

    for (const field of ["dailyTokenLimit", "dailyRequestLimit", "monthlyTokenLimit"]) {
      if (body[field] !== undefined) {
        const parsed = parseQuotaLimit(body[field], field);
        if (!parsed.ok) {
          return res.status(400).json({ error: parsed.error });
        }
        nextBudget[field] = parsed.value;
      }
    }

    const saved = await storage.setQuota(providerId, nextBudget);
    return res.json({ ok: true, budget: saved });
  });

  // --- Live Token Saver Tester ---

  router.post("/token-saver/test", (req, res) => {
    const body = req.body || {};
    if (typeof body.text !== "string") {
      return res.status(400).json({ error: "text must be a string" });
    }

    const settings = storage.getSettings();
    let maxChars = settings.tokenSaverMaxChars || 20000;
    if (body.maxChars !== undefined) {
      const val = Number(body.maxChars);
      if (!Number.isFinite(val) || val <= 0) {
        return res.status(400).json({ error: "maxChars must be a positive number" });
      }
      maxChars = Math.floor(val);
    }

    const originalChars = body.text.length;
    const { text: compressedText, savedChars, filter } = compressText(body.text, maxChars);
    const compressedChars = compressedText.length;
    const savedPercent =
      originalChars > 0
        ? Number(((savedChars / originalChars) * 100).toFixed(2))
        : 0;
    const estTokensSaved = Math.round(savedChars / 4);

    return res.json({
      originalChars,
      compressedChars,
      savedChars,
      savedPercent,
      estTokensSaved,
      filter,
      filters: RTK_FILTER_CATALOG,
      compressedText
    });
  });

  // --- Live Translator Debugger ---

  router.post("/debug/translate", (req, res) => {
    const body = req.body || {};
    const { direction, payload } = body;

    if (direction !== "claude-to-openai" && direction !== "openai-to-claude") {
      return res.status(400).json({
        error: "direction must be 'claude-to-openai' or 'openai-to-claude'"
      });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "payload must be a JSON object" });
    }

    const targetModel =
      typeof payload.model === "string" && payload.model.trim()
        ? payload.model.trim()
        : direction === "claude-to-openai"
          ? "gpt-4o"
          : "claude-sonnet-4-20250514";

    const translated =
      direction === "claude-to-openai"
        ? claudeToOpenAIRequest(payload, targetModel)
        : openaiToClaudeRequest(payload, targetModel);

    return res.json({
      ok: true,
      direction,
      translated
    });
  });

  // --- Export & Import ---

  router.get("/export", sensitiveCryptoRateLimit, async (req, res) => {
    const rawSecrets =
      typeof req.query.secrets === "string"
        ? req.query.secrets.trim().toLowerCase()
        : "redacted";
    if (!["redacted", "encrypted", "plain"].includes(rawSecrets)) {
      return res.status(400).json({
        error: "Invalid secrets parameter. Must be 'redacted', 'encrypted', or 'plain'"
      });
    }

    if (rawSecrets === "plain") {
      const confirmPw = req.headers["x-confirm-password"];
      if (typeof confirmPw !== "string" || !confirmPw) {
        return res.status(401).json({
          error: "X-Confirm-Password header is required for plaintext export"
        });
      }
      const pwValid = await bcrypt.compare(confirmPw, storage.getPasswordHash());
      if (!pwValid) {
        return res.status(401).json({
          error: "Invalid password in X-Confirm-Password header"
        });
      }
    }

    let passphrase = "";
    if (rawSecrets === "encrypted") {
      passphrase =
        (typeof req.query.passphrase === "string" && req.query.passphrase) ||
        (typeof req.headers["x-export-passphrase"] === "string" &&
          req.headers["x-export-passphrase"]) ||
        "";
      if (!passphrase || passphrase.length < 8) {
        return res.status(400).json({
          error: "A passphrase (at least 8 characters) is required for encrypted export"
        });
      }
    }

    const redactFlag = rawSecrets === "redacted";
    const providers = storage.getProviders().map((p) => ({
      ...p,
      apiKeys: Array.isArray(p.apiKeys)
        ? p.apiKeys.map((k) => ({
            id: k.id,
            label: k.label || "",
            key: redactFlag ? REDACTED_MARKER : k.key,
            maskedKey: getPublicMaskedKey(k),
            authMethod: k.authMethod || "api_key",
            ...(k.serviceAccountMeta ? { serviceAccountMeta: k.serviceAccountMeta } : {}),
            ...(k.serviceAccountJson
              ? { serviceAccountJson: redactFlag ? REDACTED_MARKER : k.serviceAccountJson }
              : {}),
            ...(k.oauthMeta ? { oauthMeta: k.oauthMeta } : {}),
            ...(k.oauthCredentials
              ? { oauthCredentials: redactFlag ? REDACTED_MARKER : k.oauthCredentials }
              : {}),
            enabled: k.enabled !== false,
            cooldownUntil: k.cooldownUntil ?? null,
            ...(k.lastError ? { lastError: k.lastError } : {})
          }))
        : []
    }));

    const keys = storage.getKeys().map((k) => ({
      ...toPublicRouterKey(k),
      key: REDACTED_MARKER,
      ...(!redactFlag && k.keyHash ? { keyHash: k.keyHash } : {})
    }));

    const rawPools = Array.isArray(storage.data?.proxyPools)
      ? storage.data.proxyPools
      : [];
    const proxyPools = rawPools.map((pool) => ({
      ...pool,
      url: redactFlag ? REDACTED_MARKER : pool.url,
      urlMasked: maskProxyUrl(pool.url)
    }));

    const bundle = {
      exportedAt: new Date().toISOString(),
      version: 1,
      secretsMode: rawSecrets,
      providers,
      combos: storage.getCombos(),
      quotas: storage.getQuotas(),
      keys,
      proxyPools,
      settings: storage.getSettings()
    };

    if (rawSecrets === "encrypted") {
      try {
        const encryptedEnvelope = await encryptExportBundleAsync(bundle, passphrase);
        return res.json(encryptedEnvelope);
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error: err?.message || "Failed to encrypt export bundle"
        });
      }
    }

    return res.json(bundle);
  });

  router.post("/import", sensitiveCryptoRateLimit, async (req, res) => {
    const rawBody = stripPrototypePollution(req.body);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return res.status(400).json({ error: "Invalid import payload" });
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(rawBody), "utf8");
    if (payloadBytes > MAX_IMPORT_BYTES) {
      return res.status(413).json({ error: "Import bundle exceeds 5 MB limit" });
    }

    let body = rawBody;
    if (rawBody.encrypted === true) {
      const passphrase =
        (typeof rawBody.passphrase === "string" && rawBody.passphrase) ||
        (typeof req.query.passphrase === "string" && req.query.passphrase) ||
        (typeof req.headers["x-import-passphrase"] === "string" &&
          req.headers["x-import-passphrase"]) ||
        (typeof req.headers["x-export-passphrase"] === "string" &&
          req.headers["x-export-passphrase"]) ||
        "";
      if (!passphrase) {
        return res.status(400).json({
          error: "Passphrase is required to import an encrypted bundle"
        });
      }
      try {
        const decrypted = await decryptExportBundleAsync(rawBody, passphrase);
        body = stripPrototypePollution(decrypted);
        if (rawBody.mode) {
          body.mode = rawBody.mode;
        }
      } catch (err) {
        return res.status(Number(err?.status) || 400).json({
          error:
            err?.status === 429
              ? err.message
              : "Invalid passphrase or corrupted encrypted bundle"
        });
      }
    }

    if (
      (body.providers !== undefined && !Array.isArray(body.providers)) ||
      (body.combos !== undefined && !Array.isArray(body.combos)) ||
      (body.keys !== undefined && !Array.isArray(body.keys)) ||
      (body.settings !== undefined &&
        (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)))
    ) {
      return res.status(400).json({ error: "Invalid import bundle schema" });
    }

    // SSRF validation on all imported provider baseUrls
    if (Array.isArray(body.providers)) {
      const allowPrivate =
        body.settings?.allowPrivateUpstreams ??
        storage.getSettings().allowPrivateUpstreams;
      for (const p of body.providers) {
        if (!p || typeof p !== "object") continue;
        const candidateUrl = normalizeBaseUrl(p.baseUrl || "");
        if (!candidateUrl || !isValidHttpUrl(candidateUrl)) {
          return res.status(400).json({ error: "Invalid provider baseUrl in import" });
        }
        const presetKey = typeof p.preset === "string" ? p.preset.trim() : "custom";
        const ssrfCheck = validateProviderBaseUrl(candidateUrl, {
          preset: presetKey,
          category: getPreset(presetKey)?.category,
          allowPrivateUpstreams: allowPrivate
        });
        if (!ssrfCheck.valid) {
          return res.status(400).json({ error: ssrfCheck.error || "Invalid baseUrl" });
        }
      }
    }

    const mode = body.mode === "replace" ? "replace" : "merge";
    const now = new Date().toISOString();

    const normalizeImportedProvider = (p, existingProviders = []) => {
      if (!p || typeof p !== "object") return null;
      const baseUrl = normalizeBaseUrl(p.baseUrl || "");
      const slug = slugify(p.slug || p.name || p.preset);
      if (!slug || !baseUrl || !isValidHttpUrl(baseUrl)) return null;
      const formatType = VALID_FORMAT_TYPES.has(p.formatType)
        ? p.formatType
        : "openai";

      const prevProv =
        existingProviders.find((ep) => ep.id === p.id || ep.slug === slug) || null;
      const prevKeyById = new Map(
        (prevProv?.apiKeys || []).map((ek) => [ek.id, ek])
      );

      const apiKeys = [];
      for (const item of Array.isArray(p.apiKeys) ? p.apiKeys : []) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (!trimmed || trimmed === REDACTED_MARKER) continue;
          apiKeys.push({
            id: nanoid(),
            label: "",
            key: trimmed,
            enabled: true,
            cooldownUntil: null
          });
        } else if (item && typeof item === "object") {
          const rawKey = typeof item.key === "string" ? item.key.trim() : "";
          const rawSaJson =
            typeof item.serviceAccountJson === "string"
              ? item.serviceAccountJson.trim()
              : "";
          const rawOAuthCreds =
            typeof item.oauthCredentials === "string"
              ? item.oauthCredentials.trim()
              : item.oauthCredentials && typeof item.oauthCredentials === "object"
                ? JSON.stringify(item.oauthCredentials)
                : "";
          const prevKey = item.id ? prevKeyById.get(item.id) : null;
          const isServiceAccount =
            item.authMethod === "service_account" ||
            prevKey?.authMethod === "service_account" ||
            Boolean(rawSaJson);
          const OAUTH_AUTH_METHODS = new Set([
            "google_oauth",
            "gemini_cli",
            "antigravity",
            "oauth2",
            "device_code"
          ]);
          const resolvedOAuthMethod = OAUTH_AUTH_METHODS.has(item.authMethod)
            ? item.authMethod
            : OAUTH_AUTH_METHODS.has(prevKey?.authMethod)
              ? prevKey.authMethod
              : "google_oauth";
          const hasOAuthCreds = Boolean(rawOAuthCreds || prevKey?.oauthCredentials);
          const isDeviceStaticKey =
            resolvedOAuthMethod === "device_code" &&
            !hasOAuthCreds &&
            Boolean(rawKey || prevKey?.key);
          const isOAuthKey =
            !isDeviceStaticKey &&
            (OAUTH_AUTH_METHODS.has(item.authMethod) ||
              OAUTH_AUTH_METHODS.has(prevKey?.authMethod) ||
              Boolean(rawOAuthCreds));

          if (isOAuthKey) {
            const finalOAuthCreds =
              rawOAuthCreds && rawOAuthCreds !== REDACTED_MARKER
                ? rawOAuthCreds
                : prevKey?.oauthCredentials || "";
            if (finalOAuthCreds) {
              apiKeys.push({
                id: prevKey?.id || item.id || nanoid(),
                label:
                  typeof item.label === "string"
                    ? item.label.trim()
                    : prevKey?.label || "",
                key: "",
                authMethod: resolvedOAuthMethod,
                oauthCredentials: finalOAuthCreds,
                ...(item.oauthMeta || prevKey?.oauthMeta
                  ? {
                      oauthMeta: {
                        ...(prevKey?.oauthMeta || {}),
                        ...(item.oauthMeta || {})
                      }
                    }
                  : {}),
                enabled:
                  item.enabled !== undefined
                    ? item.enabled !== false
                    : prevKey?.enabled !== false,
                cooldownUntil: prevKey?.cooldownUntil ?? null
              });
            }
          } else if (isServiceAccount) {
            const finalSaJson =
              rawSaJson && rawSaJson !== REDACTED_MARKER
                ? rawSaJson
                : prevKey?.serviceAccountJson || "";
            if (finalSaJson) {
              apiKeys.push({
                id: prevKey?.id || item.id || nanoid(),
                label:
                  typeof item.label === "string"
                    ? item.label.trim()
                    : prevKey?.label || "",
                key: "",
                authMethod: "service_account",
                serviceAccountJson: finalSaJson,
                ...(item.serviceAccountMeta || prevKey?.serviceAccountMeta
                  ? {
                      serviceAccountMeta: {
                        ...(prevKey?.serviceAccountMeta || {}),
                        ...(item.serviceAccountMeta || {})
                      }
                    }
                  : {}),
                enabled:
                  item.enabled !== undefined
                    ? item.enabled !== false
                    : prevKey?.enabled !== false,
                cooldownUntil: prevKey?.cooldownUntil ?? null
              });
            }
          } else if (!rawKey || rawKey === REDACTED_MARKER) {
            if (prevKey && prevKey.key) {
              apiKeys.push({
                id: prevKey.id,
                label:
                  typeof item.label === "string"
                    ? item.label.trim()
                    : prevKey.label || "",
                key: prevKey.key,
                authMethod: prevKey.authMethod || "api_key",
                ...(item.oauthMeta || prevKey?.oauthMeta
                  ? {
                      oauthMeta: {
                        ...(prevKey?.oauthMeta || {}),
                        ...(item.oauthMeta || {})
                      }
                    }
                  : {}),
                enabled:
                  item.enabled !== undefined
                    ? item.enabled !== false
                    : prevKey.enabled !== false,
                cooldownUntil: prevKey.cooldownUntil ?? null
              });
            }
          } else {
            apiKeys.push({
              id: item.id || nanoid(),
              label: typeof item.label === "string" ? item.label.trim() : "",
              key: rawKey,
              authMethod:
                typeof item.authMethod === "string" && item.authMethod.trim()
                  ? item.authMethod.trim()
                  : "api_key",
              ...(item.oauthMeta && typeof item.oauthMeta === "object"
                ? { oauthMeta: { ...item.oauthMeta } }
                : {}),
              enabled: item.enabled !== false,
              cooldownUntil: null
            });
          }
        }
      }

      // If all incoming keys were redacted and did not match by id, preserve existing provider keys
      if (apiKeys.length === 0 && prevProv && Array.isArray(prevProv.apiKeys) && prevProv.apiKeys.length > 0) {
        const hadRedactedPlaceholder =
          Array.isArray(p.apiKeys) &&
          p.apiKeys.some(
            (ik) =>
              ik === REDACTED_MARKER ||
              (ik && typeof ik === "object" && (!ik.key || ik.key === REDACTED_MARKER))
          );
        if (hadRedactedPlaceholder) {
          apiKeys.push(...prevProv.apiKeys);
        }
      }

      return {
        id: p.id || prevProv?.id || nanoid(),
        slug,
        preset: typeof p.preset === "string" ? p.preset : "custom",
        name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : slug,
        baseUrl,
        formatType,
        apiKeys,
        models: Array.isArray(p.models)
          ? [...new Set(p.models.filter((m) => typeof m === "string" && m.trim()))]
          : [],
        ...(p.proxyPoolId !== undefined ? { proxyPoolId: p.proxyPoolId } : {}),
        enabled: p.enabled !== false,
        createdAt: p.createdAt || prevProv?.createdAt || now,
        updatedAt: now
      };
    };

    const normalizeImportedCombo = (c) => {
      if (!c || typeof c !== "object") return null;
      const name = typeof c.name === "string" ? c.name.trim() : "";
      if (!name) return null;
      return {
        id: c.id || nanoid(),
        name,
        description: typeof c.description === "string" ? c.description.trim() : "",
        strategy: VALID_COMBO_STRATEGIES.has(c.strategy) ? c.strategy : "fallback",
        targets: Array.isArray(c.targets)
          ? c.targets.filter((t) => typeof t === "string" && t.trim())
          : [],
        enabled: c.enabled !== false,
        createdAt: c.createdAt || now,
        updatedAt: now
      };
    };

    const normalizeImportedKey = (k, existingKeys = []) => {
      if (!k || typeof k !== "object") return null;
      const rawKey = typeof k.key === "string" ? k.key.trim() : "";
      const rawHash =
        typeof k.keyHash === "string" && /^[0-9a-f]{64}$/i.test(k.keyHash)
          ? k.keyHash.toLowerCase()
          : "";
      const prevKey =
        existingKeys.find(
          (ek) =>
            (k.id && ek.id === k.id) ||
            (rawHash && ek.keyHash === rawHash) ||
            (k.name && ek.name === k.name)
        ) || null;

      let keyHash = rawHash;
      let prefix = typeof k.prefix === "string" ? k.prefix : prevKey?.prefix || "sk-001r-";
      let last4 = typeof k.last4 === "string" ? k.last4 : prevKey?.last4 || "";
      let keyPreview =
        typeof k.keyPreview === "string" && k.keyPreview
          ? k.keyPreview
          : prevKey?.keyPreview || "";

      if (rawKey && rawKey !== REDACTED_MARKER) {
        const derived = deriveRouterKeyFields(rawKey);
        keyHash = derived.keyHash;
        prefix = derived.prefix;
        last4 = derived.last4;
        keyPreview = maskKey(rawKey);
      } else if (!keyHash && prevKey && prevKey.keyHash) {
        keyHash = prevKey.keyHash;
        prefix = prevKey.prefix || prefix;
        last4 = prevKey.last4 || last4;
        keyPreview = prevKey.keyPreview || keyPreview;
      }

      if (!keyHash) return null;

      return {
        id: k.id || prevKey?.id || nanoid(),
        name:
          typeof k.name === "string" && k.name.trim()
            ? k.name.trim()
            : prevKey?.name || "Imported Key",
        keyHash,
        prefix,
        last4,
        keyPreview,
        ...(k.proxyPoolId !== undefined
          ? { proxyPoolId: k.proxyPoolId }
          : prevKey?.proxyPoolId !== undefined
            ? { proxyPoolId: prevKey.proxyPoolId }
            : {}),
        enabled: k.enabled !== false,
        requestCount: Number(k.requestCount ?? prevKey?.requestCount) || 0,
        lastUsedAt: k.lastUsedAt ?? prevKey?.lastUsedAt ?? null,
        createdAt: k.createdAt || prevKey?.createdAt || now
      };
    };

    const counts = await storage.update((data) => {
      if (Array.isArray(body.providers)) {
        const existingProviders = Array.isArray(data.providers) ? data.providers : [];
        const incoming = body.providers
          .map((p) => normalizeImportedProvider(p, existingProviders))
          .filter(Boolean);
        if (mode === "replace") {
          data.providers = incoming;
        } else {
          for (const item of incoming) {
            const idx = data.providers.findIndex(
              (p) => p.id === item.id || p.slug === item.slug
            );
            if (idx >= 0) {
              data.providers[idx] = { ...item, id: data.providers[idx].id };
            } else {
              data.providers.push(item);
            }
          }
        }
      }

      if (Array.isArray(body.combos)) {
        const incoming = body.combos.map(normalizeImportedCombo).filter(Boolean);
        if (mode === "replace") {
          data.combos = incoming;
        } else {
          for (const item of incoming) {
            const idx = data.combos.findIndex(
              (c) => c.id === item.id || c.name === item.name
            );
            if (idx >= 0) {
              data.combos[idx] = { ...item, id: data.combos[idx].id };
            } else {
              data.combos.push(item);
            }
          }
        }
      }

      if (Array.isArray(body.keys)) {
        const existingKeys = Array.isArray(data.keys) ? data.keys : [];
        const incoming = body.keys
          .map((k) => normalizeImportedKey(k, existingKeys))
          .filter(Boolean);
        if (mode === "replace") {
          if (incoming.length > 0) {
            data.keys = incoming;
          }
        } else {
          for (const item of incoming) {
            const idx = data.keys.findIndex(
              (k) => k.id === item.id || k.keyHash === item.keyHash
            );
            if (idx >= 0) {
              data.keys[idx] = { ...item, id: data.keys[idx].id };
            } else {
              data.keys.push(item);
            }
          }
        }
      }

      if (body.quotas && typeof body.quotas === "object" && !Array.isArray(body.quotas)) {
        if (!data.quotas || typeof data.quotas !== "object" || Array.isArray(data.quotas)) {
          data.quotas = {};
        }
        if (mode === "replace") {
          data.quotas = {};
        }
        for (const [provId, rawBudget] of Object.entries(body.quotas)) {
          if (!provId || !rawBudget || typeof rawBudget !== "object") continue;
          const dTok = parseQuotaLimit(rawBudget.dailyTokenLimit ?? null, "dailyTokenLimit");
          const dReq = parseQuotaLimit(rawBudget.dailyRequestLimit ?? null, "dailyRequestLimit");
          const mTok = parseQuotaLimit(rawBudget.monthlyTokenLimit ?? null, "monthlyTokenLimit");
          data.quotas[provId] = {
            dailyTokenLimit: dTok.ok ? dTok.value : null,
            dailyRequestLimit: dReq.ok ? dReq.value : null,
            monthlyTokenLimit: mTok.ok ? mTok.value : null
          };
        }
      }

      if (Array.isArray(body.proxyPools)) {
        const existingPools = Array.isArray(data.proxyPools) ? data.proxyPools : [];
        const incomingPools = [];
        for (const item of body.proxyPools) {
          if (!item || typeof item !== "object") continue;
          const name = typeof item.name === "string" ? item.name.trim() : "";
          if (!name) continue;
          const prevPool =
            (item.id && existingPools.find((p) => p.id === item.id)) ||
            existingPools.find((p) => p.name === name) ||
            null;
          const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
          let finalUrl = "";
          let finalType = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
          if (!rawUrl || rawUrl === REDACTED_MARKER) {
            if (prevPool?.url) {
              finalUrl = prevPool.url;
              finalType = prevPool.type || finalType || "http";
            }
          } else {
            const parsed = parseProxyUrl(rawUrl);
            if (!parsed.ok) continue;
            const ssrf = classifyHostForSSRF(parsed.host);
            const allowPrivate = storage.getSettings().allowPrivateUpstreams;
            if (
              ssrf.isMetadataOrLinkLocal ||
              (ssrf.isPrivateLan && allowPrivate !== true) ||
              (ssrf.isLoopback && allowPrivate === false)
            ) {
              continue;
            }
            finalUrl = parsed.url;
            finalType = parsed.type;
          }
          if (!finalUrl) continue;
          incomingPools.push({
            id: prevPool?.id || item.id || nanoid(),
            name,
            type: finalType || "http",
            url: finalUrl,
            enabled: item.enabled !== false,
            createdAt: item.createdAt || prevPool?.createdAt || now,
            updatedAt: now
          });
        }
        if (mode === "replace") {
          data.proxyPools = incomingPools;
        } else {
          if (!Array.isArray(data.proxyPools)) data.proxyPools = [];
          for (const pool of incomingPools) {
            const idx = data.proxyPools.findIndex(
              (p) => p.id === pool.id || p.name === pool.name
            );
            if (idx >= 0) {
              data.proxyPools[idx] = { ...pool, id: data.proxyPools[idx].id };
            } else {
              data.proxyPools.push(pool);
            }
          }
        }
        clearProxyDispatcherCache();
      }

      if (body.settings && typeof body.settings === "object") {
        const s = body.settings;
        if (typeof s.timeoutMs === "number" && s.timeoutMs >= 100) {
          data.settings.timeoutMs = Math.floor(s.timeoutMs);
        }
        if (typeof s.tokenSaverEnabled === "boolean") {
          data.settings.tokenSaverEnabled = s.tokenSaverEnabled;
        }
        if (typeof s.tokenSaverMaxChars === "number" && s.tokenSaverMaxChars >= 100) {
          data.settings.tokenSaverMaxChars = Math.floor(s.tokenSaverMaxChars);
        }
        // Protected: `requireKey` / `requireLogin` (and secrets) are NEVER restored from a backup.
        // A backup is data, and an imported `requireKey: false` silently opened /v1 to anyone who
        // knew the URL. Change them only through PUT /api/settings, which refuses on public hosts.
      }

      return {
        providers: data.providers.length,
        combos: data.combos.length,
        keys: data.keys.length
      };
    });

    return res.json({ ok: true, counts });
  });

  return router;
}
