import { upstreamFetch } from "./proxy.js";
import crypto from "node:crypto";
import { isLoopbackHost } from "./security/headers.js";
import {
  classifyHostForSSRF,
  redactSecrets,
  stripPrototypePollution
} from "./security/redact.js";

export const OAUTH_STATE_TTL_MS = 600_000;
export const OAUTH_STATE_TTL_SEC = Math.floor(OAUTH_STATE_TTL_MS / 1000);
export const OAUTH2_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_PENDING_OAUTH_STATES = 200;

export const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";
export const DEFAULT_GITLAB_SCOPE = "api read_user";

export const DEFAULT_KILOCODE_API_BASE_URL = "https://api.kilo.ai";

export const DEFAULT_NOUS_PORTAL_BASE_URL = "https://portal.nousresearch.com";
export const DEFAULT_NOUS_OAUTH_CLIENT_ID = "hermes-cli";
export const DEFAULT_NOUS_OAUTH_SCOPE = "inference:invoke inference:mint_agent_key";

/**
 * @typedef {{
 *   provider: string,
 *   codeVerifier: string,
 *   clientId: string,
 *   clientSecret: string,
 *   redirectUri: string,
 *   tokenUrl: string,
 *   userinfoUrl: string,
 *   baseUrl: string,
 *   scope: string,
 *   extra: Record<string, any>,
 *   createdAt: number,
 *   expiresAt: number
 * }} PendingOAuthPkceRecord
 */

/** @type {Map<string, PendingOAuthPkceRecord>} */
const pendingPkceStates = new Map();

/** @type {Map<string, { provider: string, tokenUrl: string, pollUrlBase: string, profileUrl: string, agentKeyUrl: string, clientId: string, clientSecret: string, scope: string, extra: Record<string, any>, createdAt: number, expiresAt: number }>} */
const pendingDeviceFlows = new Map();

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const oauth2TokenCache = new Map();

/** @type {Map<string, Promise<string>>} */
const oauth2InFlightRefreshes = new Map();

function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pruneMap(map, now = Date.now()) {
  for (const [k, v] of map.entries()) {
    if (!v || v.expiresAt <= now) {
      map.delete(k);
    }
  }
}

function enforceMapCap(map) {
  while (map.size >= MAX_PENDING_OAUTH_STATES) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

/**
 * Validate an external OAuth HTTP(S) URL against SSRF rules.
 * Blocks cloud metadata / link-local and private LAN addresses.
 * Loopback `http://` is permitted ONLY when `allowLoopback === true` (for offline tests).
 * @param {string} rawUrl
 * @param {string} label
 * @param {{ allowLoopback?: boolean }} [options]
 * @returns {URL}
 */
export function validateOAuthEndpointUrl(rawUrl, label, options = {}) {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    throw createHttpError(400, `Missing required OAuth ${label}`);
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createHttpError(400, `Invalid OAuth ${label}: must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createHttpError(400, `Invalid OAuth ${label}: must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw createHttpError(400, `Invalid OAuth ${label}: must not embed credentials`);
  }

  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal) {
    throw createHttpError(
      400,
      `SSRF guard: OAuth ${label} blocked (${ssrf.reason || "forbidden host"})`
    );
  }
  if (ssrf.isPrivateLan) {
    throw createHttpError(
      400,
      `SSRF guard: OAuth ${label} cannot target private LAN address '${parsed.hostname}'`
    );
  }
  if (ssrf.isLoopback) {
    if (options.allowLoopback === true) {
      return parsed;
    }
    throw createHttpError(400, `SSRF guard: OAuth ${label} cannot target loopback addresses`);
  }
  if (parsed.protocol !== "https:") {
    throw createHttpError(400, `OAuth ${label} must use https://`);
  }

  return parsed;
}

/**
 * Validate and normalize `callbackUrl` targeting loopback or same-origin.
 * Strips query string and hash to match strict OAuth 2.0 `redirect_uri` rules.
 * @param {string} callbackUrl
 * @param {string} [requestHost]
 * @returns {string}
 */
export function validateOAuthCallbackUrl(callbackUrl, requestHost = "") {
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

  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Extract `code` and `state` from either direct values or a pasted full OAuth redirect URL.
 * @param {{ code?: string, state?: string, callbackUrl?: string, pastedUrl?: string }} input
 */
export function extractCodeAndState(input = {}) {
  let code = typeof input.code === "string" ? input.code.trim() : "";
  let state = typeof input.state === "string" ? input.state.trim() : "";
  const rawUrl =
    typeof input.pastedUrl === "string" && input.pastedUrl.trim()
      ? input.pastedUrl.trim()
      : typeof input.callbackUrl === "string" && input.callbackUrl.includes("?")
        ? input.callbackUrl.trim()
        : "";

  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const qCode = u.searchParams.get("code");
      const qState = u.searchParams.get("state");
      const qErr = u.searchParams.get("error_description") || u.searchParams.get("error");
      if (qErr && !qCode) {
        throw createHttpError(400, `OAuth provider returned error: ${qErr}`);
      }
      if (!code && qCode) code = qCode.trim();
      if (!state && qState) state = qState.trim();
    } catch (err) {
      if (err?.status) throw err;
      throw createHttpError(400, "Invalid pasted OAuth callback URL");
    }
  }

  return { code, state };
}

function buildOAuth2CacheKey(clientId, refreshToken, tokenUrl) {
  const digest = crypto
    .createHash("sha256")
    .update(`${clientId}\0${refreshToken}\0${tokenUrl}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `oauth2:${digest}`;
}

/**
 * Start an official OAuth 2.0 + PKCE (`S256`) flow for `gitlab` or `custom_oauth`.
 * @param {string} provider
 * @param {Record<string, any>} params
 */
export function startGenericOAuthPkce(provider, params = {}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const cleanParams = stripPrototypePollution(params);
  const nowFn = typeof cleanParams.nowFn === "function" ? cleanParams.nowFn : Date.now;
  const allowLoopback = Boolean(cleanParams.allowLoopback);

  let authorizeUrl = "";
  let tokenUrl = "";
  let userinfoUrl = "";
  let baseUrl = "";
  let scope = "";
  const clientId = typeof cleanParams.clientId === "string" ? cleanParams.clientId.trim() : "";
  const clientSecret =
    typeof cleanParams.clientSecret === "string" ? cleanParams.clientSecret.trim() : "";

  if (!clientId) {
    throw createHttpError(400, "Missing required OAuth 'clientId'");
  }

  if (normalizedProvider === "gitlab") {
    const rawBase =
      typeof cleanParams.baseUrl === "string" && cleanParams.baseUrl.trim()
        ? cleanParams.baseUrl.trim().replace(/\/+$/, "")
        : DEFAULT_GITLAB_BASE_URL;
    const parsedBase = validateOAuthEndpointUrl(rawBase, "baseUrl", { allowLoopback });
    baseUrl = parsedBase.toString().replace(/\/+$/, "");
    authorizeUrl = `${baseUrl}/oauth/authorize`;
    tokenUrl =
      typeof cleanParams.tokenUrl === "string" && cleanParams.tokenUrl.trim()
        ? cleanParams.tokenUrl.trim()
        : `${baseUrl}/oauth/token`;
    userinfoUrl =
      typeof cleanParams.userinfoUrl === "string" && cleanParams.userinfoUrl.trim()
        ? cleanParams.userinfoUrl.trim()
        : `${baseUrl}/api/v4/user`;
    scope =
      typeof cleanParams.scope === "string" && cleanParams.scope.trim()
        ? cleanParams.scope.trim()
        : DEFAULT_GITLAB_SCOPE;
  } else {
    authorizeUrl =
      typeof cleanParams.authorizeUrl === "string" ? cleanParams.authorizeUrl.trim() : "";
    tokenUrl = typeof cleanParams.tokenUrl === "string" ? cleanParams.tokenUrl.trim() : "";
    userinfoUrl =
      typeof cleanParams.userinfoUrl === "string" ? cleanParams.userinfoUrl.trim() : "";
    baseUrl =
      typeof cleanParams.baseUrl === "string"
        ? cleanParams.baseUrl.trim().replace(/\/+$/, "")
        : "";
    scope = typeof cleanParams.scope === "string" ? cleanParams.scope.trim() : "";
  }

  const parsedAuthUrl = validateOAuthEndpointUrl(authorizeUrl, "authorizeUrl", {
    allowLoopback
  });
  const parsedTokenUrl = validateOAuthEndpointUrl(tokenUrl, "tokenUrl", { allowLoopback });
  if (userinfoUrl) {
    validateOAuthEndpointUrl(userinfoUrl, "userinfoUrl", { allowLoopback });
  }

  const redirectUri = validateOAuthCallbackUrl(
    cleanParams.callbackUrl,
    cleanParams.requestHost || ""
  );

  const now = nowFn();
  pruneMap(pendingPkceStates, now);
  enforceMapCap(pendingPkceStates);

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  const state = `${normalizedProvider || "oauth2"}_${crypto.randomBytes(20).toString("hex")}`;

  parsedAuthUrl.searchParams.set("client_id", clientId);
  parsedAuthUrl.searchParams.set("redirect_uri", redirectUri);
  parsedAuthUrl.searchParams.set("response_type", "code");
  if (scope) parsedAuthUrl.searchParams.set("scope", scope);
  parsedAuthUrl.searchParams.set("code_challenge", codeChallenge);
  parsedAuthUrl.searchParams.set("code_challenge_method", "S256");
  parsedAuthUrl.searchParams.set("state", state);

  pendingPkceStates.set(state, {
    provider: normalizedProvider || "custom_oauth",
    codeVerifier,
    clientId,
    clientSecret,
    redirectUri,
    tokenUrl: parsedTokenUrl.toString(),
    userinfoUrl,
    baseUrl,
    scope,
    extra: {
      preset: typeof cleanParams.preset === "string" ? cleanParams.preset.trim() : "",
      providerId:
        typeof cleanParams.providerId === "string" ? cleanParams.providerId.trim() : "",
      name: typeof cleanParams.name === "string" ? cleanParams.name.trim() : "",
      slug: typeof cleanParams.slug === "string" ? cleanParams.slug.trim() : "",
      formatType:
        typeof cleanParams.formatType === "string" ? cleanParams.formatType.trim() : ""
    },
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS
  });

  return {
    authUrl: parsedAuthUrl.toString(),
    state,
    redirectUri,
    expiresInSec: OAUTH_STATE_TTL_SEC
  };
}

/**
 * Exchange authorization `code` + `state` for OAuth 2.0 tokens (`gitlab` / `custom_oauth`).
 * @param {string} provider
 * @param {Record<string, any>} params
 */
export async function exchangeGenericOAuthPkce(provider, params = {}) {
  const cleanParams = stripPrototypePollution(params);
  const nowFn = typeof cleanParams.nowFn === "function" ? cleanParams.nowFn : Date.now;
  const fetchImpl = cleanParams.fetchImpl || upstreamFetch;
  const dispatcher = cleanParams.dispatcher;
  const allowLoopback = Boolean(cleanParams.allowLoopback);

  const now = nowFn();
  pruneMap(pendingPkceStates, now);

  const { code, state } = extractCodeAndState(cleanParams);
  if (!code) {
    throw createHttpError(400, "Missing required OAuth authorization 'code'");
  }
  if (!state) {
    throw createHttpError(400, "Missing required OAuth PKCE 'state'");
  }

  const record = pendingPkceStates.get(state);
  if (record) {
    pendingPkceStates.delete(state);
  }
  if (!record) {
    throw createHttpError(400, "Invalid or already-used OAuth PKCE state");
  }
  if (record.expiresAt <= now) {
    throw createHttpError(400, "OAuth PKCE state has expired");
  }
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider && record.provider !== normalizedProvider) {
    throw createHttpError(400, "OAuth PKCE state does not match selected provider");
  }

  const tokenUrl =
    typeof cleanParams.tokenUrlOverride === "string" && cleanParams.tokenUrlOverride.trim()
      ? cleanParams.tokenUrlOverride.trim()
      : record.tokenUrl;
  const parsedTokenUrl = validateOAuthEndpointUrl(tokenUrl, "tokenUrl", { allowLoopback });

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: record.redirectUri,
    client_id: record.clientId,
    code_verifier: record.codeVerifier
  });
  if (record.clientSecret) {
    form.set("client_secret", record.clientSecret);
  }

  let tokenRes;
  try {
    tokenRes = await fetchImpl(parsedTokenUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: form.toString(),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw createHttpError(
      502,
      redactSecrets(
        `OAuth token exchange network error: ${err?.message || "fetch failed"}`,
        [record.clientSecret, record.codeVerifier, code]
      )
    );
  }

  const rawText = await tokenRes.text().catch(() => "");
  if (!tokenRes.ok) {
    let detail = rawText.slice(0, 240);
    try {
      const parsedErr = JSON.parse(rawText);
      detail =
        parsedErr?.error_description ||
        parsedErr?.error?.message ||
        parsedErr?.error ||
        detail;
    } catch {
      // ignore
    }
    throw createHttpError(
      tokenRes.status >= 400 && tokenRes.status < 500 ? 400 : 502,
      redactSecrets(`OAuth token exchange failed (HTTP ${tokenRes.status}): ${detail}`, [
        record.clientSecret,
        record.codeVerifier,
        code
      ])
    );
  }

  let tokenData;
  try {
    tokenData = JSON.parse(rawText);
  } catch {
    throw createHttpError(502, "OAuth token endpoint returned invalid JSON");
  }

  const accessToken =
    typeof tokenData?.access_token === "string" ? tokenData.access_token.trim() : "";
  if (!accessToken) {
    throw createHttpError(502, "OAuth token response did not include 'access_token'");
  }

  const refreshToken =
    typeof tokenData?.refresh_token === "string" ? tokenData.refresh_token.trim() : "";
  const expiresInSec =
    typeof tokenData?.expires_in === "number" &&
    Number.isFinite(tokenData.expires_in) &&
    tokenData.expires_in > 0
      ? tokenData.expires_in
      : 7200;
  const expiresAt = nowFn() + expiresInSec * 1000;

  let userInfo = {};
  const userinfoUrl =
    typeof cleanParams.userinfoUrlOverride === "string" &&
    cleanParams.userinfoUrlOverride.trim()
      ? cleanParams.userinfoUrlOverride.trim()
      : record.userinfoUrl;
  if (userinfoUrl) {
    try {
      const parsedUserUrl = validateOAuthEndpointUrl(userinfoUrl, "userinfoUrl", {
        allowLoopback
      });
      const uRes = await fetchImpl(parsedUserUrl.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json"
        },
        ...(dispatcher ? { dispatcher } : {})
      });
      if (uRes && uRes.ok) {
        userInfo = (await uRes.json().catch(() => ({}))) || {};
      }
    } catch {
      // Best-effort profile lookup
    }
  }

  const oauthCredentials = {
    provider: record.provider,
    clientId: record.clientId,
    ...(record.clientSecret ? { clientSecret: record.clientSecret } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    accessToken,
    expiresAt,
    tokenUrl: parsedTokenUrl.toString(),
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {})
  };

  if (refreshToken) {
    const cacheKey = buildOAuth2CacheKey(
      record.clientId,
      refreshToken,
      parsedTokenUrl.toString()
    );
    oauth2TokenCache.set(cacheKey, { accessToken, expiresAt });
  }

  const oauthMeta = {
    provider: record.provider,
    ...(userInfo.email ? { email: String(userInfo.email) } : {}),
    ...(userInfo.username ? { username: String(userInfo.username) } : {}),
    ...(userInfo.name ? { name: String(userInfo.name) } : {}),
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    expiresAt: new Date(expiresAt).toISOString(),
    checkedAt: new Date(nowFn()).toISOString()
  };

  return {
    oauthCredentials,
    oauthMeta,
    extra: record.extra,
    baseUrl: record.baseUrl
  };
}

/**
 * Start an official Device Code flow (`kilocode`, `nous`, or `custom_oauth`).
 * @param {string} provider
 * @param {Record<string, any>} params
 */
export async function startDeviceCodeFlow(provider, params = {}) {
  const cleanParams = stripPrototypePollution(params);
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const fetchImpl = cleanParams.fetchImpl || upstreamFetch;
  const dispatcher = cleanParams.dispatcher;
  const nowFn = typeof cleanParams.nowFn === "function" ? cleanParams.nowFn : Date.now;
  const allowLoopback = Boolean(cleanParams.allowLoopback);

  const now = nowFn();
  pruneMap(pendingDeviceFlows, now);
  enforceMapCap(pendingDeviceFlows);

  if (normalizedProvider === "kilocode") {
    const apiBase =
      typeof cleanParams.apiBaseUrl === "string" && cleanParams.apiBaseUrl.trim()
        ? cleanParams.apiBaseUrl.trim().replace(/\/+$/, "")
        : DEFAULT_KILOCODE_API_BASE_URL;
    const initiateUrl =
      typeof cleanParams.initiateUrl === "string" && cleanParams.initiateUrl.trim()
        ? cleanParams.initiateUrl.trim()
        : `${apiBase}/api/device-auth/codes`;
    const pollUrlBase =
      typeof cleanParams.pollUrlBase === "string" && cleanParams.pollUrlBase.trim()
        ? cleanParams.pollUrlBase.trim().replace(/\/+$/, "")
        : `${apiBase}/api/device-auth/codes`;
    const profileUrl =
      typeof cleanParams.profileUrl === "string" && cleanParams.profileUrl.trim()
        ? cleanParams.profileUrl.trim()
        : `${apiBase}/api/profile`;

    validateOAuthEndpointUrl(initiateUrl, "initiateUrl", { allowLoopback });
    validateOAuthEndpointUrl(pollUrlBase, "pollUrlBase", { allowLoopback });

    let res;
    try {
      res = await fetchImpl(initiateUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      throw createHttpError(
        502,
        `Kilo Code device auth network error: ${err?.message || "fetch failed"}`
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw createHttpError(
        res.status === 429 ? 429 : 502,
        `Kilo Code device auth initiation failed (HTTP ${res.status}): ${errText.slice(0, 200)}`
      );
    }

    const data = await res.json();
    const deviceCode = String(data?.code || "").trim();
    const verificationUrl = String(data?.verificationUrl || "").trim();
    if (!deviceCode || !verificationUrl) {
      throw createHttpError(502, "Kilo Code device auth response missing code or verificationUrl");
    }

    const expiresIn = Number(data?.expiresIn) > 0 ? Number(data.expiresIn) : 300;
    const flowId = `dev_${crypto.randomBytes(16).toString("hex")}`;
    pendingDeviceFlows.set(flowId, {
      provider: "kilocode",
      tokenUrl: "",
      pollUrlBase,
      profileUrl,
      agentKeyUrl: "",
      clientId: "",
      clientSecret: "",
      scope: "",
      extra: { deviceCode },
      createdAt: now,
      expiresAt: now + expiresIn * 1000
    });

    return {
      flowId,
      provider: "kilocode",
      deviceCode,
      userCode: deviceCode,
      verificationUri: verificationUrl,
      verificationUriComplete: verificationUrl,
      expiresIn,
      interval: 3
    };
  }

  // RFC 8628 standard device code flow (`nous` or `custom_oauth`)
  const isNous = normalizedProvider === "nous";
  const portalBase =
    isNous && typeof cleanParams.portalBaseUrl === "string" && cleanParams.portalBaseUrl.trim()
      ? cleanParams.portalBaseUrl.trim().replace(/\/+$/, "")
      : DEFAULT_NOUS_PORTAL_BASE_URL;

  const deviceCodeUrl =
    typeof cleanParams.deviceCodeUrl === "string" && cleanParams.deviceCodeUrl.trim()
      ? cleanParams.deviceCodeUrl.trim()
      : isNous
        ? `${portalBase}/api/oauth/device/code`
        : "";
  const tokenUrl =
    typeof cleanParams.tokenUrl === "string" && cleanParams.tokenUrl.trim()
      ? cleanParams.tokenUrl.trim()
      : isNous
        ? `${portalBase}/api/oauth/token`
        : "";
  const agentKeyUrl =
    typeof cleanParams.agentKeyUrl === "string" && cleanParams.agentKeyUrl.trim()
      ? cleanParams.agentKeyUrl.trim()
      : isNous
        ? `${portalBase}/api/oauth/agent-key`
        : "";
  const clientId =
    typeof cleanParams.clientId === "string" && cleanParams.clientId.trim()
      ? cleanParams.clientId.trim()
      : isNous
        ? DEFAULT_NOUS_OAUTH_CLIENT_ID
        : "";
  const clientSecret =
    typeof cleanParams.clientSecret === "string" ? cleanParams.clientSecret.trim() : "";
  const scope =
    typeof cleanParams.scope === "string" && cleanParams.scope.trim()
      ? cleanParams.scope.trim()
      : isNous
        ? DEFAULT_NOUS_OAUTH_SCOPE
        : "";

  if (!clientId) {
    throw createHttpError(400, "Missing required OAuth 'clientId'");
  }
  validateOAuthEndpointUrl(deviceCodeUrl, "deviceCodeUrl", { allowLoopback });
  validateOAuthEndpointUrl(tokenUrl, "tokenUrl", { allowLoopback });
  if (agentKeyUrl) {
    validateOAuthEndpointUrl(agentKeyUrl, "agentKeyUrl", { allowLoopback });
  }

  const form = new URLSearchParams({ client_id: clientId });
  if (scope) form.set("scope", scope);

  let res;
  try {
    res = await fetchImpl(deviceCodeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: form.toString(),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw createHttpError(
      502,
      redactSecrets(`Device code request network error: ${err?.message || "fetch failed"}`, [
        clientSecret
      ])
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw createHttpError(
      res.status >= 400 && res.status < 500 ? 400 : 502,
      redactSecrets(
        `Device code request failed (HTTP ${res.status}): ${errText.slice(0, 200)}`,
        [clientSecret]
      )
    );
  }

  const data = await res.json();
  const deviceCode = String(data?.device_code || "").trim();
  const userCode = String(data?.user_code || "").trim();
  const verificationUri = String(data?.verification_uri || "").trim();
  const verificationUriComplete = String(
    data?.verification_uri_complete || verificationUri
  ).trim();

  if (!deviceCode || !verificationUri) {
    throw createHttpError(502, "Device code response missing device_code or verification_uri");
  }

  const expiresIn = Number(data?.expires_in) > 0 ? Number(data.expires_in) : 600;
  const interval = Number(data?.interval) > 0 ? Number(data.interval) : 5;
  const flowId = `dev_${crypto.randomBytes(16).toString("hex")}`;

  pendingDeviceFlows.set(flowId, {
    provider: normalizedProvider || "custom_oauth",
    tokenUrl,
    pollUrlBase: "",
    profileUrl: "",
    agentKeyUrl,
    clientId,
    clientSecret,
    scope,
    extra: {
      deviceCode,
      preset: typeof cleanParams.preset === "string" ? cleanParams.preset.trim() : "",
      providerId:
        typeof cleanParams.providerId === "string" ? cleanParams.providerId.trim() : "",
      name: typeof cleanParams.name === "string" ? cleanParams.name.trim() : "",
      slug: typeof cleanParams.slug === "string" ? cleanParams.slug.trim() : "",
      baseUrl: typeof cleanParams.baseUrl === "string" ? cleanParams.baseUrl.trim() : "",
      formatType:
        typeof cleanParams.formatType === "string" ? cleanParams.formatType.trim() : ""
    },
    createdAt: now,
    expiresAt: now + expiresIn * 1000
  });

  return {
    flowId,
    provider: normalizedProvider || "custom_oauth",
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval
  };
}

/**
 * Poll a pending Device Code flow once and return status (`pending`, `slow_down`, `expired`, `denied`, or `approved`).
 * @param {string} provider
 * @param {Record<string, any>} params
 */
export async function pollDeviceCodeFlow(provider, params = {}) {
  const cleanParams = stripPrototypePollution(params);
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const fetchImpl = cleanParams.fetchImpl || upstreamFetch;
  const dispatcher = cleanParams.dispatcher;
  const nowFn = typeof cleanParams.nowFn === "function" ? cleanParams.nowFn : Date.now;
  const allowLoopback = Boolean(cleanParams.allowLoopback);

  const flowId = typeof cleanParams.flowId === "string" ? cleanParams.flowId.trim() : "";
  if (!flowId) {
    throw createHttpError(400, "Missing required 'flowId'");
  }

  const now = nowFn();
  const record = pendingDeviceFlows.get(flowId);
  if (!record) {
    throw createHttpError(400, "Invalid or expired device authorization session");
  }
  if (normalizedProvider && record.provider !== normalizedProvider) {
    throw createHttpError(400, "Device authorization session does not match provider");
  }
  if (record.expiresAt <= now) {
    pendingDeviceFlows.delete(flowId);
    return { status: "expired", error: "expired_token", message: "Device code expired" };
  }

  if (record.provider === "kilocode") {
    const pollUrl = `${record.pollUrlBase}/${encodeURIComponent(record.extra.deviceCode)}`;
    validateOAuthEndpointUrl(pollUrl, "pollUrl", { allowLoopback });

    let res;
    try {
      res = await fetchImpl(pollUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      return {
        status: "pending",
        error: "network_retry",
        message: err?.message || "Temporary network error"
      };
    }

    if (res.status === 202) {
      return { status: "pending", error: "authorization_pending" };
    }
    if (res.status === 403) {
      pendingDeviceFlows.delete(flowId);
      return {
        status: "denied",
        error: "access_denied",
        message: "Authorization denied by user"
      };
    }
    if (res.status === 410) {
      pendingDeviceFlows.delete(flowId);
      return {
        status: "expired",
        error: "expired_token",
        message: "Authorization code expired"
      };
    }
    if (!res.ok) {
      return {
        status: "error",
        error: "poll_failed",
        message: `Poll returned HTTP ${res.status}`
      };
    }

    const data = await res.json().catch(() => ({}));
    if (data?.status === "approved" && data?.token) {
      pendingDeviceFlows.delete(flowId);
      let orgId = null;
      if (record.profileUrl) {
        try {
          const parsedProfile = validateOAuthEndpointUrl(record.profileUrl, "profileUrl", {
            allowLoopback
          });
          const pRes = await fetchImpl(parsedProfile.toString(), {
            method: "GET",
            headers: {
              authorization: `Bearer ${data.token}`,
              accept: "application/json"
            },
            ...(dispatcher ? { dispatcher } : {})
          });
          if (pRes && pRes.ok) {
            const profile = await pRes.json().catch(() => ({}));
            orgId = profile?.organizations?.[0]?.id || null;
          }
        } catch {
          // Best-effort org lookup
        }
      }

      return {
        status: "approved",
        authMethod: "device_code",
        key: String(data.token).trim(),
        oauthMeta: {
          provider: "kilocode",
          ...(data.userEmail ? { email: String(data.userEmail) } : {}),
          ...(orgId ? { orgId: String(orgId) } : {}),
          checkedAt: new Date(nowFn()).toISOString()
        },
        extra: record.extra
      };
    }

    return { status: "pending", error: "authorization_pending" };
  }

  // RFC 8628 token polling
  validateOAuthEndpointUrl(record.tokenUrl, "tokenUrl", { allowLoopback });
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: record.clientId,
    device_code: record.extra.deviceCode
  });
  if (record.clientSecret) {
    form.set("client_secret", record.clientSecret);
  }

  let res;
  try {
    res = await fetchImpl(record.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: form.toString(),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    return {
      status: "pending",
      error: "network_retry",
      message: err?.message || "Temporary network error"
    };
  }

  const data = await res.json().catch(() => ({}));
  if (data?.error === "authorization_pending") {
    return { status: "pending", error: "authorization_pending" };
  }
  if (data?.error === "slow_down") {
    return { status: "slow_down", error: "slow_down" };
  }
  if (data?.error === "expired_token") {
    pendingDeviceFlows.delete(flowId);
    return { status: "expired", error: "expired_token", message: "Device code expired" };
  }
  if (data?.error === "access_denied") {
    pendingDeviceFlows.delete(flowId);
    return {
      status: "denied",
      error: "access_denied",
      message: "Authorization denied by user"
    };
  }

  const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : "";
  if (!res.ok || !accessToken) {
    const errMsg = redactSecrets(
      String(data?.error_description || data?.error || `HTTP ${res.status}`),
      [record.clientSecret]
    );
    pendingDeviceFlows.delete(flowId);
    return { status: "error", error: data?.error || "poll_failed", message: errMsg };
  }

  pendingDeviceFlows.delete(flowId);
  const refreshToken =
    typeof data?.refresh_token === "string" ? data.refresh_token.trim() : "";
  const expiresInSec =
    typeof data?.expires_in === "number" &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
      ? data.expires_in
      : 7200;
  const expiresAt = nowFn() + expiresInSec * 1000;

  // For Nous Research, try minting a dedicated inference agent key (optional best-effort)
  let mintedAgentKey = "";
  let agentKeyExpiresAt = null;
  if (record.provider === "nous" && record.agentKeyUrl) {
    try {
      const parsedAgentUrl = validateOAuthEndpointUrl(record.agentKeyUrl, "agentKeyUrl", {
        allowLoopback
      });
      const akRes = await fetchImpl(parsedAgentUrl.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ min_ttl_seconds: 7200 }),
        ...(dispatcher ? { dispatcher } : {})
      });
      if (akRes && akRes.ok) {
        const akData = await akRes.json().catch(() => ({}));
        if (typeof akData?.api_key === "string" && akData.api_key.trim()) {
          mintedAgentKey = akData.api_key.trim();
          agentKeyExpiresAt = akData.expires_at || null;
        }
      }
    } catch {
      // Fall back cleanly to storing OAuth access/refresh credentials
    }
  }

  const effectiveToken = mintedAgentKey || accessToken;
  const oauthCredentials = {
    provider: record.provider,
    clientId: record.clientId,
    ...(record.clientSecret ? { clientSecret: record.clientSecret } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    accessToken: effectiveToken,
    expiresAt,
    tokenUrl: record.tokenUrl
  };

  if (refreshToken) {
    const cacheKey = buildOAuth2CacheKey(record.clientId, refreshToken, record.tokenUrl);
    oauth2TokenCache.set(cacheKey, { accessToken: effectiveToken, expiresAt });
  }

  return {
    status: "approved",
    authMethod: "oauth2",
    oauthCredentials,
    oauthMeta: {
      provider: record.provider,
      flow: "device_code",
      ...(agentKeyExpiresAt ? { agentKeyExpiresAt } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
      checkedAt: new Date(nowFn()).toISOString()
    },
    extra: record.extra
  };
}

/**
 * Resolve a valid Bearer access token from stored generic `oauthCredentials` (`authMethod: "oauth2"`).
 * Uses cached / stored non-expired `accessToken` when valid, or refreshes via `refresh_token`.
 *
 * @param {string | Record<string, any>} oauthCredsStringOrObj
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   tokenUrlOverride?: string,
 *   allowLoopback?: boolean,
 *   dispatcher?: any,
 *   nowFn?: () => number,
 *   forceRefresh?: boolean
 * }} [options]
 * @returns {Promise<{ accessToken: string, expiresAt: number }>}
 */
export async function getGenericOAuthAccessToken(oauthCredsStringOrObj, options = {}) {
  const {
    fetchImpl = upstreamFetch,
    tokenUrlOverride,
    allowLoopback = false,
    dispatcher,
    nowFn = Date.now,
    forceRefresh = false
  } = options;

  let rawObj = oauthCredsStringOrObj;
  if (typeof oauthCredsStringOrObj === "string") {
    try {
      rawObj = JSON.parse(oauthCredsStringOrObj);
    } catch {
      throw createHttpError(400, "Stored OAuth2 credentials JSON is malformed");
    }
  }
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
    throw createHttpError(400, "Stored OAuth2 credentials must be a JSON object");
  }

  const creds = stripPrototypePollution(rawObj);
  const clientId = typeof creds.clientId === "string" ? creds.clientId.trim() : "";
  const clientSecret =
    typeof creds.clientSecret === "string" ? creds.clientSecret.trim() : "";
  const refreshToken =
    typeof creds.refreshToken === "string" ? creds.refreshToken.trim() : "";
  const storedAccessToken =
    typeof creds.accessToken === "string" ? creds.accessToken.trim() : "";
  const storedExpiresAt = Number(creds.expiresAt) || 0;
  const rawTokenUrl =
    typeof tokenUrlOverride === "string" && tokenUrlOverride.trim()
      ? tokenUrlOverride.trim()
      : typeof creds.tokenUrl === "string"
        ? creds.tokenUrl.trim()
        : "";

  const now = nowFn();

  if (!forceRefresh && storedAccessToken) {
    if (!refreshToken || !rawTokenUrl || storedExpiresAt - OAUTH2_TOKEN_REFRESH_BUFFER_MS > now) {
      return { accessToken: storedAccessToken, expiresAt: storedExpiresAt };
    }
  }

  if (!refreshToken || !rawTokenUrl) {
    if (storedAccessToken) {
      return { accessToken: storedAccessToken, expiresAt: storedExpiresAt };
    }
    throw createHttpError(
      400,
      "Stored OAuth2 credentials lack refreshToken and active accessToken"
    );
  }

  const parsedTokenUrl = validateOAuthEndpointUrl(rawTokenUrl, "tokenUrl", {
    allowLoopback: Boolean(allowLoopback || tokenUrlOverride)
  });
  const effectiveTokenUrl = parsedTokenUrl.toString();
  const cacheKey = buildOAuth2CacheKey(clientId, refreshToken, effectiveTokenUrl);

  if (!forceRefresh) {
    const cached = oauth2TokenCache.get(cacheKey);
    if (cached && cached.expiresAt - OAUTH2_TOKEN_REFRESH_BUFFER_MS > now) {
      return { accessToken: cached.accessToken, expiresAt: cached.expiresAt };
    }
  }

  const existingFlight = oauth2InFlightRefreshes.get(cacheKey);
  if (existingFlight && !forceRefresh) {
    const accessToken = await existingFlight;
    const cached = oauth2TokenCache.get(cacheKey);
    return { accessToken, expiresAt: cached?.expiresAt || now + 3600_000 };
  }

  const flightPromise = (async () => {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
    if (clientId) form.set("client_id", clientId);
    if (clientSecret) form.set("client_secret", clientSecret);

    let res;
    try {
      res = await fetchImpl(effectiveTokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: form.toString(),
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      throw createHttpError(
        502,
        redactSecrets(
          `OAuth2 token refresh network error: ${err?.message || "fetch failed"}`,
          [clientSecret, refreshToken]
        )
      );
    }

    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      throw createHttpError(
        res.status >= 400 && res.status < 500 ? 401 : 502,
        redactSecrets(
          `OAuth2 token refresh failed (HTTP ${res.status}): ${rawText.slice(0, 200)}`,
          [clientSecret, refreshToken]
        )
      );
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw createHttpError(502, "OAuth2 token refresh returned invalid JSON");
    }

    const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : "";
    if (!accessToken) {
      throw createHttpError(502, "OAuth2 refresh response did not include 'access_token'");
    }

    const expiresInSec =
      typeof data?.expires_in === "number" &&
      Number.isFinite(data.expires_in) &&
      data.expires_in > 0
        ? data.expires_in
        : 3600;
    const expiresAt = nowFn() + expiresInSec * 1000;
    const rotatedRefresh =
      typeof data?.refresh_token === "string" ? data.refresh_token.trim() : "";
    oauth2TokenCache.set(cacheKey, { accessToken, expiresAt, refreshToken: rotatedRefresh });
    return accessToken;
  })();

  oauth2InFlightRefreshes.set(cacheKey, flightPromise);
  try {
    const accessToken = await flightPromise;
    const cached = oauth2TokenCache.get(cacheKey);
    return {
      accessToken,
      expiresAt: cached?.expiresAt || now + 3600_000,
      ...(cached?.refreshToken ? { refreshToken: cached.refreshToken } : {})
    };
  } finally {
    if (oauth2InFlightRefreshes.get(cacheKey) === flightPromise) {
      oauth2InFlightRefreshes.delete(cacheKey);
    }
  }
}

export function clearOAuthFlowsStore() {
  pendingPkceStates.clear();
  pendingDeviceFlows.clear();
  oauth2TokenCache.clear();
  oauth2InFlightRefreshes.clear();
}
