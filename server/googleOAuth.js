import { upstreamFetch } from "./proxy.js";
import crypto from "node:crypto";
import { extractCodeAndState } from "./oauthFlows.js";
import { isLoopbackHost } from "./security/headers.js";
import {
  classifyHostForSSRF,
  redactSecrets,
  stripPrototypePollution
} from "./security/redact.js";

export const DEFAULT_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DEFAULT_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const DEFAULT_GOOGLE_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GOOGLE_BILLING_BASE_URL = "https://cloudbilling.googleapis.com/v1";

export const GOOGLE_OAUTH_SCOPES =
  "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever";

export const GOOGLE_PKCE_TTL_MS = 600_000;
export const GOOGLE_PKCE_TTL_SEC = Math.floor(GOOGLE_PKCE_TTL_MS / 1000);
export const GOOGLE_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_PENDING_GOOGLE_STATES = 200;

/**
 * @typedef {{
 *   codeVerifier: string,
 *   clientId: string,
 *   clientSecret: string,
 *   projectId: string,
 *   redirectUri: string,
 *   createdAt: number,
 *   expiresAt: number
 * }} PendingGooglePkceRecord
 */

/** @type {Map<string, PendingGooglePkceRecord>} */
const googlePkceStates = new Map();

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const googleTokenCache = new Map();

/** @type {Map<string, Promise<{ accessToken: string, projectId: string }>>} */
const googleInFlightRefreshes = new Map();

/**
 * Create an Error carrying an HTTP status code.
 * @param {number} status
 * @param {string} message
 */
function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Prune expired pending Google OAuth PKCE states from memory.
 * @param {number} [now]
 */
function pruneExpiredGoogleStates(now = Date.now()) {
  for (const [stateKey, record] of googlePkceStates.entries()) {
    if (!record || record.expiresAt <= now) {
      googlePkceStates.delete(stateKey);
    }
  }
}

/**
 * Validate an optional Google Cloud project ID for safe inclusion in URLs and headers.
 * @param {unknown} rawProjectId
 * @returns {string}
 */
function normalizeProjectId(rawProjectId) {
  if (rawProjectId === undefined || rawProjectId === null) {
    return "";
  }
  const trimmed = String(rawProjectId).trim();
  if (!trimmed) {
    return "";
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(trimmed)) {
    throw createHttpError(400, "Invalid Google Cloud 'projectId' format");
  }
  return trimmed;
}

/**
 * Validate `callbackUrl` is a clean loopback or same-origin `http(s)` URL and strip query/hash
 * parameters to produce the exact `redirect_uri` required by Google OAuth 2.0.
 * @param {string} callbackUrl
 * @param {string} [requestHost]
 * @returns {string}
 */
function validateAndCleanRedirectUri(callbackUrl, requestHost = "") {
  if (typeof callbackUrl !== "string" || !callbackUrl.trim()) {
    throw createHttpError(400, "Missing required 'callbackUrl'");
  }

  let parsed;
  try {
    parsed = new URL(callbackUrl.trim());
  } catch {
    throw createHttpError(400, "Invalid 'callbackUrl': must be a valid http(s) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createHttpError(400, "Invalid 'callbackUrl': must use http or https protocol");
  }
  if (parsed.username || parsed.password) {
    throw createHttpError(400, "Invalid 'callbackUrl': must not contain embedded credentials");
  }

  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal) {
    throw createHttpError(400, "Invalid 'callbackUrl': forbidden metadata/link-local address");
  }

  const normalizedReqHost =
    typeof requestHost === "string" ? requestHost.trim().toLowerCase() : "";
  const isSameOrigin =
    Boolean(normalizedReqHost) && parsed.host.toLowerCase() === normalizedReqHost;
  const isLoopback = isLoopbackHost(parsed.hostname);

  if (!isLoopback && !isSameOrigin) {
    throw createHttpError(
      400,
      "Invalid 'callbackUrl': must target localhost/127.0.0.1 or the same origin"
    );
  }

  // Google OAuth requires exact redirect_uri matching without query params or hash fragments
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Validate a Google OAuth / API endpoint URL against protocol and SSRF rules.
 * Always blocks cloud metadata, link-local, and private LAN hosts.
 * Loopback `http://` is permitted only when explicitly allowed for offline tests.
 * @param {string} rawUrl
 * @param {string} label
 * @param {{ allowLoopback?: boolean }} [options]
 * @returns {URL}
 */
function validateGoogleEndpointUrl(rawUrl, label, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw createHttpError(400, `Invalid Google OAuth ${label}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createHttpError(400, `Invalid Google OAuth ${label}: must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw createHttpError(
      400,
      `Invalid Google OAuth ${label}: must not contain embedded credentials`
    );
  }

  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal) {
    throw createHttpError(
      400,
      `SSRF guard: Google OAuth ${label} blocked (${ssrf.reason || "forbidden host"})`
    );
  }
  if (ssrf.isPrivateLan) {
    throw createHttpError(
      400,
      `SSRF guard: Google OAuth ${label} cannot target private LAN address '${parsed.hostname}'`
    );
  }

  if (ssrf.isLoopback) {
    if (options.allowLoopback === true) {
      return parsed;
    }
    throw createHttpError(
      400,
      `SSRF guard: Google OAuth ${label} cannot target loopback addresses`
    );
  }

  if (parsed.protocol !== "https:") {
    throw createHttpError(400, `Google OAuth ${label} must use https://`);
  }

  return parsed;
}

/**
 * Compute an opaque cache key for a Google OAuth credential tuple without exposing the raw refresh token.
 * @param {string} clientId
 * @param {string} refreshToken
 * @param {string} tokenUri
 * @returns {string}
 */
function buildGoogleTokenCacheKey(clientId, refreshToken, tokenUri) {
  const refreshDigest = crypto
    .createHash("sha256")
    .update(refreshToken, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `${clientId}\0${refreshDigest}\0${tokenUri}`;
}

/**
 * Parse a user-supplied Google Cloud Console OAuth client secret JSON (`client_secret_*.json`).
 * Supports `{ web: { client_id, client_secret, project_id } }`, `{ installed: { ... } }`,
 * and flat `{ client_id, client_secret, project_id }` (or camelCase equivalents).
 * Strips prototype-pollution keys and validates required fields.
 *
 * @param {string | Record<string, any>} raw
 * @returns {{ clientId: string, clientSecret: string, projectId: string, redirectUris?: string[] }}
 */
export function parseGoogleClientSecretJson(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw createHttpError(400, "Google OAuth client secret JSON is empty");
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw createHttpError(400, "Invalid Google OAuth client secret JSON syntax");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createHttpError(400, "Google OAuth client secret JSON must be a JSON object");
  }

  const cleaned = stripPrototypePollution(parsed);

  const section =
    cleaned.web && typeof cleaned.web === "object" && !Array.isArray(cleaned.web)
      ? cleaned.web
      : cleaned.installed &&
          typeof cleaned.installed === "object" &&
          !Array.isArray(cleaned.installed)
        ? cleaned.installed
        : cleaned;

  const clientId = String(section.client_id ?? section.clientId ?? "").trim();
  const clientSecret = String(section.client_secret ?? section.clientSecret ?? "").trim();
  const rawProjectId =
    section.project_id ??
    section.projectId ??
    cleaned.project_id ??
    cleaned.projectId ??
    "";

  if (!clientId) {
    throw createHttpError(
      400,
      "Invalid Google OAuth client secret JSON: missing 'client_id'"
    );
  }
  if (!clientSecret) {
    throw createHttpError(
      400,
      "Invalid Google OAuth client secret JSON: missing 'client_secret'"
    );
  }

  const projectId = normalizeProjectId(rawProjectId);
  const redirectUris = Array.isArray(section.redirect_uris)
    ? section.redirect_uris.filter((u) => typeof u === "string" && u.trim()).map((u) => u.trim())
    : [];

  return {
    clientId,
    clientSecret,
    projectId,
    ...(redirectUris.length > 0 ? { redirectUris } : {})
  };
}

/**
 * Start an official Google OAuth 2.0 + PKCE (`S256`) authorization flow using the user's own
 * Google Cloud OAuth client (`clientId` + `clientSecret` or uploaded `client_secret_*.json`).
 *
 * @param {{
 *   clientId?: string,
 *   clientSecret?: string,
 *   projectId?: string,
 *   clientSecretJson?: string | Record<string, any>,
 *   callbackUrl: string,
 *   authBaseUrl?: string,
 *   requestHost?: string,
 *   nowFn?: () => number
 * }} options
 * @returns {{ authUrl: string, state: string, redirectUri: string, expiresInSec: number }}
 */
export function startGoogleOAuthPkce({
  clientId,
  clientSecret,
  projectId,
  clientSecretJson,
  callbackUrl,
  selectAccount = false,
  authBaseUrl = DEFAULT_GOOGLE_AUTH_URL,
  requestHost = "",
  nowFn = Date.now
} = {}) {
  let parsedJson = null;
  if (
    clientSecretJson !== undefined &&
    clientSecretJson !== null &&
    (typeof clientSecretJson !== "string" || clientSecretJson.trim())
  ) {
    parsedJson = parseGoogleClientSecretJson(clientSecretJson);
  }

  const resolvedClientId =
    (typeof clientId === "string" && clientId.trim()) || parsedJson?.clientId || "";
  const resolvedClientSecret =
    (typeof clientSecret === "string" && clientSecret.trim()) ||
    parsedJson?.clientSecret ||
    "";
  const resolvedProjectId = normalizeProjectId(
    (typeof projectId === "string" && projectId.trim()) || parsedJson?.projectId || ""
  );

  if (!resolvedClientId) {
    throw createHttpError(
      400,
      "Missing Google OAuth 'clientId'. Provide your own Google Cloud OAuth Client ID or client_secret JSON."
    );
  }
  if (!resolvedClientSecret) {
    throw createHttpError(
      400,
      "Missing Google OAuth 'clientSecret'. Provide your own Google Cloud OAuth Client Secret or client_secret JSON."
    );
  }

  const redirectUri = validateAndCleanRedirectUri(callbackUrl, requestHost);
  const authUrlObj = validateGoogleEndpointUrl(authBaseUrl, "authBaseUrl", {
    allowLoopback: authBaseUrl !== DEFAULT_GOOGLE_AUTH_URL
  });

  const now = nowFn();
  pruneExpiredGoogleStates(now);

  while (googlePkceStates.size >= MAX_PENDING_GOOGLE_STATES) {
    const oldestKey = googlePkceStates.keys().next().value;
    if (!oldestKey) break;
    googlePkceStates.delete(oldestKey);
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  const state = `google_${crypto.randomBytes(20).toString("hex")}`;

  authUrlObj.searchParams.set("client_id", resolvedClientId);
  authUrlObj.searchParams.set("redirect_uri", redirectUri);
  authUrlObj.searchParams.set("response_type", "code");
  authUrlObj.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  authUrlObj.searchParams.set("access_type", "offline");
  authUrlObj.searchParams.set("prompt", selectAccount ? "consent select_account" : "consent");
  authUrlObj.searchParams.set("code_challenge", codeChallenge);
  authUrlObj.searchParams.set("code_challenge_method", "S256");
  authUrlObj.searchParams.set("state", state);

  googlePkceStates.set(state, {
    codeVerifier,
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret,
    projectId: resolvedProjectId,
    redirectUri,
    createdAt: now,
    expiresAt: now + GOOGLE_PKCE_TTL_MS
  });

  return {
    authUrl: authUrlObj.toString(),
    state,
    redirectUri,
    expiresInSec: GOOGLE_PKCE_TTL_SEC
  };
}

/**
 * Inspect the connected Google Account profile, accessible Gemini API models,
 * and (when `projectId` is provided) Google Cloud Billing status to classify plan tier.
 * All external checks are best-effort and never throw if optional APIs (such as Cloud Billing)
 * are disabled or unavailable.
 *
 * @param {string} accessToken
 * @param {{
 *   projectId?: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   userinfoUrl?: string,
 *   modelsUrl?: string,
 *   billingBaseUrl?: string,
 *   dispatcher?: any
 * }} [options]
 */
export async function inspectGoogleAccountAndPlan(accessToken, options = {}) {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!token) {
    throw createHttpError(400, "Missing Google OAuth access token for account inspection");
  }

  const {
    projectId = "",
    fetchImpl = upstreamFetch,
    userinfoUrl = DEFAULT_GOOGLE_USERINFO_URL,
    modelsUrl = DEFAULT_GOOGLE_MODELS_URL,
    billingBaseUrl = DEFAULT_GOOGLE_BILLING_BASE_URL,
    dispatcher
  } = options;

  const cleanProjectId = normalizeProjectId(projectId);
  const authHeaders = {
    authorization: `Bearer ${token}`,
    accept: "application/json"
  };

  let email = "";
  let name = "";
  let picture = "";
  let modelsCount = 0;
  /** @type {string[]} */
  let topModels = [];
  /** @type {boolean | null} */
  let billingEnabled = null;
  let tier = "standard";
  let tierLabel = "Gemini API · Google Account Connected";

  // 1. Google UserInfo (email, name, picture)
  try {
    const parsedUserinfo = validateGoogleEndpointUrl(userinfoUrl, "userinfoUrl", {
      allowLoopback: userinfoUrl !== DEFAULT_GOOGLE_USERINFO_URL
    });
    const res = await fetchImpl(parsedUserinfo.toString(), {
      method: "GET",
      headers: authHeaders,
      ...(dispatcher ? { dispatcher } : {})
    });
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data === "object") {
        if (typeof data.email === "string") email = data.email.trim();
        if (typeof data.name === "string") name = data.name.trim();
        if (typeof data.picture === "string") picture = data.picture.trim();
      }
    }
  } catch {
    // Best-effort profile check
  }

  // 2. Gemini API accessible models count & top model names
  try {
    const parsedModels = validateGoogleEndpointUrl(modelsUrl, "modelsUrl", {
      allowLoopback: modelsUrl !== DEFAULT_GOOGLE_MODELS_URL
    });
    const modelHeaders = {
      ...authHeaders,
      ...(cleanProjectId ? { "x-goog-user-project": cleanProjectId } : {})
    };
    const res = await fetchImpl(parsedModels.toString(), {
      method: "GET",
      headers: modelHeaders,
      ...(dispatcher ? { dispatcher } : {})
    });
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      const rawList = Array.isArray(data?.models)
        ? data.models
        : Array.isArray(data?.data)
          ? data.data
          : [];
      const normalizedNames = rawList
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          const rawName = String(entry?.name || entry?.id || "").trim();
          return rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
        })
        .filter(Boolean);

      const uniqueModels = [...new Set(normalizedNames)];
      modelsCount = uniqueModels.length;

      // Prioritize Gemini models first in topModels preview
      const geminiFirst = [
        ...uniqueModels.filter((m) => m.toLowerCase().includes("gemini")),
        ...uniqueModels.filter((m) => !m.toLowerCase().includes("gemini"))
      ];
      topModels = geminiFirst.slice(0, 10);
    }
  } catch {
    // Best-effort model listing check
  }

  // 3. Google Cloud Billing status check (only when projectId is supplied; best-effort)
  if (cleanProjectId) {
    try {
      const cleanBillingBase = String(billingBaseUrl || DEFAULT_GOOGLE_BILLING_BASE_URL)
        .trim()
        .replace(/\/+$/, "");
      const billingEndpoint = `${cleanBillingBase}/projects/${encodeURIComponent(
        cleanProjectId
      )}/billingInfo`;
      const parsedBilling = validateGoogleEndpointUrl(billingEndpoint, "billingBaseUrl", {
        allowLoopback: billingBaseUrl !== DEFAULT_GOOGLE_BILLING_BASE_URL
      });
      const billingHeaders = {
        ...authHeaders,
        "x-goog-user-project": cleanProjectId
      };
      const res = await fetchImpl(parsedBilling.toString(), {
        method: "GET",
        headers: billingHeaders,
        ...(dispatcher ? { dispatcher } : {})
      });
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.billingEnabled === "boolean") {
          billingEnabled = data.billingEnabled;
          if (billingEnabled === true) {
            tier = "paid";
            tierLabel = "Pay-as-you-go (Cloud Billing Active)";
          } else {
            tier = "free";
            tierLabel = "Gemini API Free Tier";
          }
        }
      }
    } catch {
      // Cloud Billing API may not be enabled on user's GCP project — gracefully stay "standard"
    }
  }

  const quotaSummary =
    tier === "paid"
      ? {
          label: "Pay-as-you-go (Tier 1+)",
          rpmEstimate: "150–1,000+ RPM",
          rpdEstimate: "10,000+ RPD",
          note: "Cloud Billing đã bật — hạn mức theo Google Cloud Quotas của project."
        }
      : tier === "free"
        ? {
            label: "Gemini API Free Tier",
            rpmEstimate: "5–15 RPM",
            rpdEstimate: "25–1,500 RPD",
            note: "Gói miễn phí (Flash ~15 RPM / 1,500 RPD; Pro ~2–5 RPM / 25–100 RPD)."
          }
        : {
            label: "Google Account (Standard)",
            rpmEstimate: "Theo hạn mức GCP Project",
            rpdEstimate: "Xem Cloud Console Quotas",
            note: "Bật Cloud Billing API trên GCP Project để tự động đọc trạng thái Free / Pay-as-you-go."
          };

  return {
    email,
    name,
    ...(picture ? { picture } : {}),
    projectId: cleanProjectId,
    tier,
    tierLabel,
    billingEnabled,
    modelsCount,
    topModels,
    quotaSummary,
    checkedAt: new Date().toISOString()
  };
}

/**
 * Turn Google's token-endpoint error codes into actionable guidance (no secrets are included).
 * @param {string} errCode
 * @param {string} detail
 * @param {string} redirectUri exact redirect_uri that was sent to Google
 * @returns {string} empty when there is no specific advice
 */
function describeGoogleTokenError(errCode, detail, redirectUri) {
  const code = String(errCode || "").toLowerCase();
  const text = `${code} ${detail || ""}`.toLowerCase();
  if (code === "invalid_grant" || text.includes("invalid_grant")) {
    return "Google rejected the authorization code (invalid_grant): it was already used, has expired (codes live ~10 minutes), or was copied incompletely. Click 'Open Google sign-in' again and paste the new address right after approving.";
  }
  if (text.includes("redirect_uri_mismatch")) {
    return `Google rejected the redirect URI (redirect_uri_mismatch). In Google Cloud Console add exactly this Authorized redirect URI to your OAuth client: ${redirectUri} (for a Desktop client any http://127.0.0.1 or http://localhost port is accepted).`;
  }
  if (code === "invalid_client" || text.includes("invalid_client")) {
    return "Google rejected the OAuth client (invalid_client): the Client ID or Client Secret is wrong, or the client was deleted. Re-check them in Google Cloud Console > Credentials.";
  }
  if (code === "unauthorized_client" || text.includes("unauthorized_client")) {
    return "This OAuth client type is not allowed to use this flow (unauthorized_client). Create the client as 'Desktop app' (or 'Web application' with the redirect URI above).";
  }
  if (text.includes("access_blocked") || text.includes("access_denied")) {
    return "Google blocked or denied access. While the consent screen is in Testing mode, add your Google account under 'Test users', or publish the app.";
  }
  return "";
}

/**
 * Exchange an authorization `code` + one-time `state` from the Google OAuth 2.0 PKCE flow
 * for OAuth tokens at Google's official token endpoint, cache the access token in memory,
 * and run `inspectGoogleAccountAndPlan` to populate account & billing tier metadata.
 *
 * @param {{
 *   code: string,
 *   state: string,
 *   tokenUrl?: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   userinfoUrl?: string,
 *   modelsUrl?: string,
 *   billingBaseUrl?: string,
 *   dispatcher?: any,
 *   nowFn?: () => number
 * }} options
 */
export async function exchangeGoogleOAuthPkce({
  code,
  state,
  pastedUrl,
  callbackUrl,
  tokenUrl = DEFAULT_GOOGLE_TOKEN_URL,
  fetchImpl = upstreamFetch,
  userinfoUrl = DEFAULT_GOOGLE_USERINFO_URL,
  modelsUrl = DEFAULT_GOOGLE_MODELS_URL,
  billingBaseUrl = DEFAULT_GOOGLE_BILLING_BASE_URL,
  dispatcher,
  nowFn = Date.now
} = {}) {
  const now = nowFn();
  pruneExpiredGoogleStates(now);

  const extracted = extractCodeAndState({ code, state, pastedUrl, callbackUrl });
  const trimmedCode = extracted.code;
  if (!trimmedCode) {
    throw createHttpError(400, "Missing required Google OAuth authorization 'code'");
  }

  const trimmedState = extracted.state;
  if (!trimmedState) {
    throw createHttpError(400, "Missing required Google OAuth PKCE 'state'");
  }

  const record = googlePkceStates.get(trimmedState);
  // One-time consumption: always delete immediately to prevent replay attacks
  if (record) {
    googlePkceStates.delete(trimmedState);
  }

  if (!record) {
    throw createHttpError(
      400,
      "This Google sign-in session was not found, was already used, or has expired (valid for 10 minutes). Click 'Open Google sign-in' again and paste the new address."
    );
  }
  if (record.expiresAt <= now) {
    throw createHttpError(
      400,
      "This Google sign-in session expired (valid for 10 minutes). Start again and paste the address immediately after approving."
    );
  }

  const parsedTokenUrl = validateGoogleEndpointUrl(tokenUrl, "tokenUrl", {
    allowLoopback: tokenUrl !== DEFAULT_GOOGLE_TOKEN_URL
  });

  const formBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: trimmedCode,
    code_verifier: record.codeVerifier,
    client_id: record.clientId,
    client_secret: record.clientSecret,
    redirect_uri: record.redirectUri
  }).toString();

  let tokenRes;
  try {
    tokenRes = await fetchImpl(parsedTokenUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: formBody,
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    // The code never reached Google, so it is still unused: keep the PKCE record so the user can retry
    // (HTTP-level failures below stay consumed because Google may already have burned the code).
    if (record.expiresAt > nowFn()) googlePkceStates.set(trimmedState, record);
    throw createHttpError(
      502,
      redactSecrets(
        `Could not reach Google to finish sign-in (${err?.message || "network error"}). Check your connection/proxy and paste the same address again.`,
        [record.clientSecret, record.codeVerifier, trimmedCode]
      )
    );
  }

  const rawText = await tokenRes.text().catch(() => "");
  if (!tokenRes.ok) {
    let errCode = "";
    let errDetail = rawText.slice(0, 240);
    try {
      const parsedErr = JSON.parse(rawText);
      errCode = typeof parsedErr?.error === "string" ? parsedErr.error : "";
      errDetail =
        parsedErr?.error_description ||
        parsedErr?.error?.message ||
        parsedErr?.error ||
        errDetail;
    } catch {
      // non-JSON response
    }
    const cleanMsg = redactSecrets(String(errDetail || `HTTP ${tokenRes.status}`), [
      record.clientSecret,
      record.codeVerifier,
      trimmedCode
    ]);
    const hint = describeGoogleTokenError(errCode, cleanMsg, record.redirectUri);
    throw createHttpError(
      tokenRes.status >= 400 && tokenRes.status < 500 ? 400 : 502,
      hint || `Google OAuth token exchange failed (HTTP ${tokenRes.status}): ${cleanMsg}`
    );
  }

  let tokenData;
  try {
    tokenData = JSON.parse(rawText);
  } catch {
    throw createHttpError(502, "Google OAuth token endpoint returned invalid JSON");
  }

  const accessToken =
    typeof tokenData?.access_token === "string" ? tokenData.access_token.trim() : "";
  if (!accessToken) {
    throw createHttpError(
      502,
      "Google OAuth token endpoint response did not include 'access_token'"
    );
  }

  const refreshToken =
    typeof tokenData?.refresh_token === "string" ? tokenData.refresh_token.trim() : "";
  if (!refreshToken) {
    throw createHttpError(
      400,
      "Google OAuth did not return a 'refresh_token'. Ensure offline consent was granted and retry."
    );
  }

  const expiresInSec =
    typeof tokenData.expires_in === "number" &&
    Number.isFinite(tokenData.expires_in) &&
    tokenData.expires_in > 0
      ? tokenData.expires_in
      : 3600;

  const effectiveTokenUri = parsedTokenUrl.toString();
  const oauthCredentials = {
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    refreshToken,
    projectId: record.projectId || "",
    tokenUri: effectiveTokenUri
  };

  const cacheKey = buildGoogleTokenCacheKey(
    oauthCredentials.clientId,
    oauthCredentials.refreshToken,
    effectiveTokenUri
  );
  googleTokenCache.set(cacheKey, {
    accessToken,
    expiresAt: nowFn() + expiresInSec * 1000
  });

  const oauthMeta = await inspectGoogleAccountAndPlan(accessToken, {
    projectId: oauthCredentials.projectId,
    fetchImpl,
    userinfoUrl,
    modelsUrl,
    billingBaseUrl,
    dispatcher
  });

  return {
    oauthCredentials,
    oauthMeta,
    accessToken
  };
}

/**
 * Retrieve a valid Google OAuth 2.0 Bearer access token from in-memory cache (with 5-min expiry buffer),
 * or refresh via `grant_type=refresh_token` against Google's official token endpoint when expired.
 *
 * @param {string | Record<string, any>} oauthCredsStringOrObj
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   tokenUrlOverride?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   dispatcher?: any,
 *   nowFn?: () => number,
 *   forceRefresh?: boolean
 * }} [options]
 * @returns {Promise<{ accessToken: string, projectId: string }>}
 */
const GOOGLE_CRED_CACHE_MAX = 256;
const GOOGLE_TOKEN_CACHE_MAX = 1000;
const GOOGLE_TOKEN_SOFT_REFRESH_MS = 10 * 60 * 1000;
const GOOGLE_TOKEN_HARD_REFRESH_MS = GOOGLE_TOKEN_REFRESH_BUFFER_MS;
/** @type {Map<string, { clientId: string, clientSecret: string, refreshToken: string, projectId: string, effectiveTokenUri: string, cacheKey: string }>} */
const googleCredDescriptorCache = new Map();

export async function getGoogleOAuthAccessToken(oauthCredsStringOrObj, options = {}) {
  const {
    fetchImpl = upstreamFetch,
    tokenUrlOverride,
    allowLoopbackTokenUri = false,
    dispatcher,
    nowFn = Date.now,
    forceRefresh = false
  } = options;

  let clientId;
  let clientSecret;
  let refreshToken;
  let projectId;
  let effectiveTokenUri;
  let cacheKey;

  const descriptorKey =
    typeof oauthCredsStringOrObj === "string"
      ? `${allowLoopbackTokenUri ? 1 : 0}\0${tokenUrlOverride || ""}\0${oauthCredsStringOrObj}`
      : "";
  const cachedDesc = descriptorKey ? googleCredDescriptorCache.get(descriptorKey) : null;

  if (cachedDesc) {
    ({ clientId, clientSecret, refreshToken, projectId, effectiveTokenUri, cacheKey } = cachedDesc);
  } else {
    let rawObj = oauthCredsStringOrObj;
    if (typeof oauthCredsStringOrObj === "string") {
      try {
        rawObj = JSON.parse(oauthCredsStringOrObj);
      } catch {
        throw createHttpError(400, "Stored Google OAuth credentials JSON is malformed");
      }
    }

    if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
      throw createHttpError(400, "Stored Google OAuth credentials must be a JSON object");
    }

    const creds = stripPrototypePollution(rawObj);
    clientId = typeof creds.clientId === "string" ? creds.clientId.trim() : "";
    clientSecret = typeof creds.clientSecret === "string" ? creds.clientSecret.trim() : "";
    refreshToken = typeof creds.refreshToken === "string" ? creds.refreshToken.trim() : "";
    projectId = normalizeProjectId(creds.projectId || "");

    if (!clientId || !clientSecret || !refreshToken) {
      throw createHttpError(
        400,
        "Stored Google OAuth credentials are incomplete (missing clientId, clientSecret, or refreshToken)"
      );
    }

    const rawTokenUri =
      typeof tokenUrlOverride === "string" && tokenUrlOverride.trim()
        ? tokenUrlOverride.trim()
        : typeof creds.tokenUri === "string" && creds.tokenUri.trim()
          ? creds.tokenUri.trim()
          : DEFAULT_GOOGLE_TOKEN_URL;

    const parsedTokenUrl = validateGoogleEndpointUrl(rawTokenUri, "tokenUri", {
      allowLoopback: Boolean(allowLoopbackTokenUri || tokenUrlOverride)
    });
    effectiveTokenUri = parsedTokenUrl.toString();
    cacheKey = buildGoogleTokenCacheKey(clientId, refreshToken, effectiveTokenUri);

    if (descriptorKey) {
      googleCredDescriptorCache.set(descriptorKey, {
        clientId,
        clientSecret,
        refreshToken,
        projectId,
        effectiveTokenUri,
        cacheKey
      });
      while (googleCredDescriptorCache.size > GOOGLE_CRED_CACHE_MAX) {
        googleCredDescriptorCache.delete(googleCredDescriptorCache.keys().next().value);
      }
    }
  }

  const now = nowFn();
  if (!forceRefresh) {
    const cached = googleTokenCache.get(cacheKey);
    if (cached && cached.expiresAt - GOOGLE_TOKEN_HARD_REFRESH_MS > now) {
      if (
        cached.expiresAt - GOOGLE_TOKEN_SOFT_REFRESH_MS <= now &&
        !googleInFlightRefreshes.has(cacheKey)
      ) {
        getGoogleOAuthAccessToken(oauthCredsStringOrObj, {
          ...options,
          forceRefresh: true
        }).catch(() => {});
      }
      return { accessToken: cached.accessToken, projectId };
    }
  }

  const existingFlight = googleInFlightRefreshes.get(cacheKey);
  if (existingFlight && !forceRefresh) {
    return existingFlight;
  }

  const flightPromise = (async () => {
    const formBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString();

    let tokenRes;
    try {
      tokenRes = await fetchImpl(effectiveTokenUri, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: formBody,
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      throw createHttpError(
        502,
        redactSecrets(
          `Google OAuth token refresh network error: ${err?.message || "fetch failed"}`,
          [clientSecret, refreshToken]
        )
      );
    }

    const responseText = await tokenRes.text().catch(() => "");
    if (!tokenRes.ok) {
      const cleanDetail = redactSecrets(responseText.slice(0, 240), [
        clientSecret,
        refreshToken
      ]);
      throw createHttpError(
        tokenRes.status >= 400 && tokenRes.status < 500 ? 401 : 502,
        `Google OAuth token refresh failed (HTTP ${tokenRes.status})${
          cleanDetail ? `: ${cleanDetail}` : ""
        }`
      );
    }

    let tokenData;
    try {
      tokenData = JSON.parse(responseText);
    } catch {
      throw createHttpError(502, "Google OAuth token refresh endpoint returned invalid JSON");
    }

    const accessToken =
      typeof tokenData?.access_token === "string" ? tokenData.access_token.trim() : "";
    if (!accessToken) {
      throw createHttpError(
        502,
        "Google OAuth token refresh response did not include 'access_token'"
      );
    }

    const expiresInSec =
      typeof tokenData.expires_in === "number" &&
      Number.isFinite(tokenData.expires_in) &&
      tokenData.expires_in > 0
        ? tokenData.expires_in
        : 3600;

    googleTokenCache.set(cacheKey, {
      accessToken,
      expiresAt: nowFn() + expiresInSec * 1000
    });
    while (googleTokenCache.size > GOOGLE_TOKEN_CACHE_MAX) {
      googleTokenCache.delete(googleTokenCache.keys().next().value);
    }

    return { accessToken, projectId };
  })();

  googleInFlightRefreshes.set(cacheKey, flightPromise);
  try {
    return await flightPromise;
  } finally {
    if (googleInFlightRefreshes.get(cacheKey) === flightPromise) {
      googleInFlightRefreshes.delete(cacheKey);
    }
  }
}

export function peekGooglePkceState(state) {
  return googlePkceStates.get(state) || null;
}

export function restoreGooglePkceState(state, record) {
  if (!state || !record || typeof record !== "object") return;
  pruneExpiredGoogleStates();
  googlePkceStates.set(state, record);
}

/**
 * Clear cached Google OAuth access tokens (useful for tests verifying refresh_token behavior).
 */
export function clearGoogleOAuthTokenCache() {
  googleTokenCache.clear();
  googleInFlightRefreshes.clear();
}

/**
 * Clear all in-memory Google OAuth PKCE states and cached tokens (for test isolation).
 */
export function clearGoogleOAuthStore() {
  googlePkceStates.clear();
  googleTokenCache.clear();
  googleInFlightRefreshes.clear();
}
