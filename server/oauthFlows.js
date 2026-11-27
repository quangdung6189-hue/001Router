import { upstreamFetch } from "./proxy.js";
import crypto from "node:crypto";
import { arch, hostname, platform } from "node:os";
import { isLoopbackHost } from "./security/headers.js";
import {
  classifyHostForSSRF,
  redactSecrets,
  stripPrototypePollution
} from "./security/redact.js";

export const CLAUDE_CLI_VERSION = "2.1.322";
export const CODEX_CLI_VERSION = "0.167.1";
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1";
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`;
export const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1";
export const CLAUDE_OAUTH_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
export const CLAUDE_OAUTH_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
export const KIMI_CODING_USAGE_URL = "https://api.kimi.com/coding/v1/usages";

export const CLAUDE_CODE_DEFAULT_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-2",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5"
];

export const CODEX_DEFAULT_MODELS = [
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-daybreak-blue-latest",
  "gpt-reserve",
  "codex-auto-review"
];

export const KIMI_CODE_DEFAULT_MODELS = [
  "kimi-k3",
  "k3",
  "kimi-for-coding",
  "kimi-for-coding-highspeed",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
  "kimi-k2.6",
  "kimi-k2.5",
  "kimi-k2.5-thinking",
  "kimi-latest"
];

export const OAUTH_STATE_TTL_MS = 600_000;
export const OAUTH_STATE_TTL_SEC = Math.floor(OAUTH_STATE_TTL_MS / 1000);
export const OAUTH2_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const OAUTH2_CRED_CACHE_MAX = 256;
const OAUTH2_TOKEN_CACHE_MAX = 1000;
const MAX_PENDING_OAUTH_STATES = 200;

const CACHED_PLATFORM = platform();
const CACHED_ARCH = arch();
let CACHED_HOSTNAME = "unknown";
try {
  CACHED_HOSTNAME = hostname() || "unknown";
} catch {
  CACHED_HOSTNAME = "unknown";
}
const CACHED_STAINLESS_OS = (() => {
  switch (CACHED_PLATFORM) {
    case "darwin":
      return "MacOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    case "freebsd":
      return "FreeBSD";
    default:
      return `Other::${CACHED_PLATFORM}`;
  }
})();
const CACHED_STAINLESS_ARCH = (() => {
  switch (CACHED_ARCH) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    case "ia32":
      return "x86";
    default:
      return `other::${CACHED_ARCH}`;
  }
})();
const CACHED_KIMI_DEVICE_MODEL =
  CACHED_PLATFORM === "darwin"
    ? `macOS ${CACHED_ARCH}`
    : CACHED_PLATFORM === "win32"
      ? `Windows ${CACHED_ARCH}`
      : CACHED_PLATFORM === "linux"
        ? `Linux ${CACHED_ARCH}`
        : `${CACHED_PLATFORM} ${CACHED_ARCH}`;

export const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";
export const DEFAULT_GITLAB_SCOPE = "api read_user";

export const DEFAULT_KILOCODE_API_BASE_URL = "https://api.kilo.ai";

export const DEFAULT_NOUS_PORTAL_BASE_URL = "https://portal.nousresearch.com";
export const DEFAULT_NOUS_OAUTH_CLIENT_ID = "hermes-cli";
export const DEFAULT_NOUS_OAUTH_SCOPE = "inference:invoke inference:mint_agent_key";

export const DEFAULT_KIMI_AUTH_BASE_URL = "https://auth.kimi.com";
export const DEFAULT_KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";

export const DEFAULT_OPENAI_OAUTH_CLIENT_ID =
  process.env.OPENAI_OAUTH_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";
export const DEFAULT_OPENAI_CALLBACK_URL = "http://localhost:1455/auth/callback";

export const DEFAULT_CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_OAUTH_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const DEFAULT_CLAUDE_CALLBACK_URL = "http://localhost:54545/callback";

function canonicalOAuthProvider(provider) {
  const p = String(provider || "").trim().toLowerCase();
  if (p === "codex") return "openai";
  if (p === "claude") return "anthropic";
  if (p === "kimi-coding") return "kimi";
  return p;
}

function getBuiltInOAuthPkceConfig(provider) {
  const canonical = canonicalOAuthProvider(provider);
  if (canonical === "openai") {
    return {
      canonical: "openai",
      clientId: DEFAULT_OPENAI_OAUTH_CLIENT_ID,
      clientSecret: "",
      authorizeUrl: "https://auth.openai.com/oauth/authorize",
      tokenUrl: "https://auth.openai.com/oauth/token",
      userinfoUrl: "",
      scope: "openid profile email offline_access",
      defaultCallbackUrl: DEFAULT_OPENAI_CALLBACK_URL,
      extraAuthParams: {
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "codex_cli_rs"
      },
      tokenEncoding: "form"
    };
  }
  if (canonical === "anthropic") {
    return {
      canonical: "anthropic",
      clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
      clientSecret: "",
      authorizeUrl: "https://claude.ai/oauth/authorize",
      tokenUrl: "https://api.anthropic.com/v1/oauth/token",
      userinfoUrl: "https://api.anthropic.com/api/oauth/profile",
      scope: "org:create_api_key user:profile user:inference",
      defaultCallbackUrl: DEFAULT_CLAUDE_CALLBACK_URL,
      extraAuthParams: {
        code: "true"
      },
      tokenEncoding: "json"
    };
  }
  return null;
}

function decodeJwtPayloadBestEffort(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractOpenAIJwtMeta(tokenData) {
  const idClaims = decodeJwtPayloadBestEffort(tokenData?.id_token) || {};
  const accessClaims = decodeJwtPayloadBestEffort(tokenData?.access_token) || {};
  const authClaims =
    (idClaims["https://api.openai.com/auth"] &&
    typeof idClaims["https://api.openai.com/auth"] === "object"
      ? idClaims["https://api.openai.com/auth"]
      : accessClaims["https://api.openai.com/auth"]) || {};
  const profileClaims =
    (idClaims["https://api.openai.com/profile"] &&
    typeof idClaims["https://api.openai.com/profile"] === "object"
      ? idClaims["https://api.openai.com/profile"]
      : accessClaims["https://api.openai.com/profile"]) || {};

  const email =
    String(
      idClaims.email ||
        profileClaims.email ||
        accessClaims.email ||
        ""
    ).trim();
  const rawPlan = String(
    authClaims.chatgpt_plan_type ||
      idClaims.chatgpt_plan_type ||
      idClaims.plan_type ||
      idClaims.subscription_plan ||
      accessClaims.chatgpt_plan_type ||
      ""
  )
    .trim()
    .toLowerCase();

  let tierLabel = "OpenAI Codex";
  if (rawPlan === "pro") tierLabel = "ChatGPT Pro";
  else if (rawPlan === "plus") tierLabel = "ChatGPT Plus";
  else if (rawPlan === "team") tierLabel = "ChatGPT Team";
  else if (rawPlan === "enterprise" || rawPlan === "edu") tierLabel = `ChatGPT ${rawPlan[0].toUpperCase()}${rawPlan.slice(1)}`;
  else if (rawPlan === "free") tierLabel = "ChatGPT Free";
  else if (rawPlan) tierLabel = `ChatGPT ${rawPlan}`;

  const accountId = String(authClaims.chatgpt_account_id || "").trim();
  return {
    ...(email ? { email } : {}),
    ...(accountId ? { accountId } : {}),
    ...(rawPlan ? { tier: rawPlan } : {}),
    tierLabel
  };
}

function extractClaudeProfileMeta(userInfo) {
  const email = String(userInfo?.account?.email || userInfo?.email || "").trim();
  const name = String(userInfo?.account?.full_name || userInfo?.name || "").trim();
  const orgType = String(
    userInfo?.organization?.organization_type || userInfo?.organization_type || ""
  )
    .trim()
    .toLowerCase();
  let tierLabel = "Claude OAuth";
  if (orgType.includes("max")) tierLabel = "Claude Max";
  else if (orgType.includes("pro")) tierLabel = "Claude Pro";
  else if (orgType.includes("team")) tierLabel = "Claude Team";
  else if (orgType.includes("enterprise")) tierLabel = "Claude Enterprise";
  else if (userInfo?.has_claude_max) tierLabel = "Claude Max";
  else if (userInfo?.has_claude_pro) tierLabel = "Claude Pro";
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(orgType ? { tier: orgType } : {}),
    tierLabel
  };
}

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

/** @type {Map<string, { accessToken: string, expiresAt: number, refreshToken?: string, updatedCredentialsJson?: string }>} */
const oauth2TokenCache = new Map();

/** @type {Map<string, { provider: string, clientId: string, clientSecret: string, refreshToken: string, storedAccessToken: string, storedExpiresAt: number, rawTokenUrl: string, effectiveTokenUrl: string, cacheKey: string, baseCredsObj: Record<string, any> }>} */
const oauth2CredDescriptorCache = new Map();

/** @type {Map<string, Promise<{ accessToken: string, expiresAt: number, refreshToken?: string, updatedCredentialsJson?: string }>>} */
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

/** Longest pasted callback text accepted (real callbacks are a few hundred bytes). */
export const MAX_PASTED_CALLBACK_LENGTH = 4096;

const OAUTH_ERROR_HINTS = {
  access_denied: "Sign-in was cancelled or denied (access_denied). Start again and approve the consent screen.",
  access_blocked:
    "Google blocked this app (access_blocked). Add your account as a test user on the OAuth consent screen, or publish the app.",
  invalid_scope: "Google rejected the requested scope (invalid_scope).",
  redirect_uri_mismatch:
    "Google rejected the redirect URI (redirect_uri_mismatch). Add the exact redirect URI shown in the dialog to your OAuth client.",
  admin_policy_enforced: "Your Google Workspace admin policy blocks this sign-in (admin_policy_enforced)."
};

/**
 * Extract the OAuth `code` and `state` from explicit fields and/or a pasted callback.
 * Accepts the full callback URL (even for a loopback address that refused the connection), a URL whose
 * parameters are in the `#fragment`, or just the bare query (`code=...&state=...` / `?code=...`).
 * The pasted text is never echoed back in error messages (it contains the one-time authorization code).
 * @param {{ code?: string, state?: string, pastedUrl?: string, callbackUrl?: string }} [input]
 * @returns {{ code: string, state: string }}
 */
export function extractCodeAndState(input = {}) {
  let code = typeof input.code === "string" ? input.code.trim() : "";
  let state = typeof input.state === "string" ? input.state.trim() : "";
  const hasPasted = typeof input.pastedUrl === "string" && input.pastedUrl.trim();
  const rawUrl = hasPasted
    ? input.pastedUrl.trim()
    : typeof input.callbackUrl === "string" && /[?&](code|error)=/.test(input.callbackUrl)
      ? input.callbackUrl.trim()
      : "";

  if (rawUrl) {
    if (rawUrl.length > MAX_PASTED_CALLBACK_LENGTH) {
      throw createHttpError(400, "Pasted callback text is too long. Paste only the address from the browser bar.");
    }
    let params = null;
    let hashStateFallback = "";
    try {
      const u = new URL(rawUrl);
      const fromQuery = u.searchParams;
      if (fromQuery.has("code") || fromQuery.has("error")) {
        params = fromQuery;
        const rawHash = u.hash.replace(/^#/, "").trim();
        if (rawHash && !rawHash.includes("=")) {
          hashStateFallback = rawHash;
        }
      } else {
        params = new URLSearchParams(u.hash.replace(/^#/, ""));
      }
    } catch {
      // Bare Anthropic format "code#state" (without spaces or URL syntax)
      const hashCodeMatch = rawUrl.match(/^([A-Za-z0-9_.~/-]+)#([A-Za-z0-9_.~/-]+)$/);
      if (hashCodeMatch) {
        params = new URLSearchParams({ code: hashCodeMatch[1], state: hashCodeMatch[2] });
      } else {
        // Not a URL: accept a bare query string such as "?code=...&state=..." or "code=...&state=..."
        const candidate = rawUrl.replace(/^[?#]/, "");
        if (/^[A-Za-z0-9_.~%+-]+=/.test(candidate)) {
          params = new URLSearchParams(candidate);
        }
      }
    }
    if (!params) {
      throw createHttpError(
        400,
        "Could not read the pasted callback. Paste the full address from the browser address bar (it contains ?code=...&state=...)."
      );
    }

    let qCode = (params.get("code") || "").trim();
    let qState = (params.get("state") || "").trim() || hashStateFallback;
    if (qCode.includes("#")) {
      const hashIdx = qCode.indexOf("#");
      const splitState = qCode.slice(hashIdx + 1).trim();
      qCode = qCode.slice(0, hashIdx).trim();
      if (!qState && splitState) qState = splitState;
    }
    const qErr = (params.get("error") || "").trim();
    if (qErr && !qCode) {
      const known = OAUTH_ERROR_HINTS[qErr.toLowerCase()];
      const desc = (params.get("error_description") || "").trim().slice(0, 200);
      throw createHttpError(400, known || `OAuth provider returned an error: ${qErr}${desc ? ` (${desc})` : ""}`);
    }
    if (!qCode) {
      throw createHttpError(
        400,
        "The pasted address has no authorization 'code'. Finish approving access first, then copy the full address from the browser bar."
      );
    }
    if ((code && code !== qCode) || (state && qState && state !== qState)) {
      throw createHttpError(400, "The pasted callback does not match the code/state that were provided.");
    }
    if (!code) code = qCode;
    if (!state) state = qState;
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
  const builtIn = getBuiltInOAuthPkceConfig(normalizedProvider);
  const cleanParams = stripPrototypePollution(params);
  const nowFn = typeof cleanParams.nowFn === "function" ? cleanParams.nowFn : Date.now;
  const allowLoopback = Boolean(cleanParams.allowLoopback);

  let authorizeUrl = "";
  let tokenUrl = "";
  let userinfoUrl = "";
  let baseUrl = "";
  let scope = "";
  const explicitClientId = typeof cleanParams.clientId === "string" ? cleanParams.clientId.trim() : "";
  const clientId = explicitClientId || builtIn?.clientId || "";
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
  } else if (builtIn) {
    authorizeUrl =
      (typeof cleanParams.authorizeUrl === "string" && cleanParams.authorizeUrl.trim()) ||
      builtIn.authorizeUrl;
    tokenUrl =
      (typeof cleanParams.tokenUrl === "string" && cleanParams.tokenUrl.trim()) ||
      builtIn.tokenUrl;
    userinfoUrl =
      (typeof cleanParams.userinfoUrl === "string" && cleanParams.userinfoUrl.trim()) ||
      builtIn.userinfoUrl;
    baseUrl =
      typeof cleanParams.baseUrl === "string"
        ? cleanParams.baseUrl.trim().replace(/\/+$/, "")
        : "";
    scope =
      (typeof cleanParams.scope === "string" && cleanParams.scope.trim()) || builtIn.scope;
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

  const effectiveCallback =
    (typeof cleanParams.callbackUrl === "string" && cleanParams.callbackUrl.trim()) ||
    builtIn?.defaultCallbackUrl ||
    "";
  const redirectUri = validateOAuthCallbackUrl(effectiveCallback, cleanParams.requestHost || "");

  const now = nowFn();
  pruneMap(pendingPkceStates, now);
  enforceMapCap(pendingPkceStates);

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  const state = `${normalizedProvider || "oauth2"}_${crypto.randomBytes(20).toString("hex")}`;

  if (builtIn?.extraAuthParams) {
    for (const [k, v] of Object.entries(builtIn.extraAuthParams)) {
      parsedAuthUrl.searchParams.set(k, v);
    }
  }
  parsedAuthUrl.searchParams.set("client_id", clientId);
  parsedAuthUrl.searchParams.set("redirect_uri", redirectUri);
  parsedAuthUrl.searchParams.set("response_type", "code");
  if (scope) parsedAuthUrl.searchParams.set("scope", scope);
  parsedAuthUrl.searchParams.set("code_challenge", codeChallenge);
  parsedAuthUrl.searchParams.set("code_challenge_method", "S256");
  parsedAuthUrl.searchParams.set("state", state);

  pendingPkceStates.set(state, {
    provider: builtIn ? builtIn.canonical : normalizedProvider || "custom_oauth",
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
        typeof cleanParams.formatType === "string" ? cleanParams.formatType.trim() : "",
      ...(builtIn ? { tokenEncoding: builtIn.tokenEncoding, rawProvider: normalizedProvider } : {})
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
 * Inspect an active PKCE record without consuming it (for serverless persistence).
 * @param {string} state
 */
export function peekGenericPkceState(state) {
  return pendingPkceStates.get(state) || null;
}

/**
 * Restore a persisted PKCE record into memory before `exchangeGenericOAuthPkce`.
 * @param {string} state
 * @param {PendingOAuthPkceRecord} record
 */
export function restoreGenericPkceState(state, record) {
  if (!state || !record || typeof record !== "object") return;
  if (!record.codeVerifier || !record.expiresAt || record.expiresAt <= Date.now()) return;
  pendingPkceStates.set(state, record);
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
  const normalizedProvider = canonicalOAuthProvider(provider);
  if (normalizedProvider && canonicalOAuthProvider(record.provider) !== normalizedProvider) {
    throw createHttpError(400, "OAuth PKCE state does not match selected provider");
  }

  const tokenUrl =
    typeof cleanParams.tokenUrlOverride === "string" && cleanParams.tokenUrlOverride.trim()
      ? cleanParams.tokenUrlOverride.trim()
      : record.tokenUrl;
  const parsedTokenUrl = validateOAuthEndpointUrl(tokenUrl, "tokenUrl", { allowLoopback });

  const useJsonTokenExchange =
    record.extra?.tokenEncoding === "json" ||
    canonicalOAuthProvider(record.provider) === "anthropic" ||
    /anthropic\.com/i.test(parsedTokenUrl.hostname);

  let reqContentType = "application/x-www-form-urlencoded";
  let reqBody = "";
  if (useJsonTokenExchange) {
    reqContentType = "application/json";
    reqBody = JSON.stringify({
      grant_type: "authorization_code",
      code,
      state,
      redirect_uri: record.redirectUri,
      client_id: record.clientId,
      code_verifier: record.codeVerifier,
      ...(record.clientSecret ? { client_secret: record.clientSecret } : {})
    });
  } else {
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
    reqBody = form.toString();
  }

  let tokenRes;
  try {
    tokenRes = await fetchImpl(parsedTokenUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": reqContentType,
        accept: "application/json"
      },
      body: reqBody,
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
          accept: "application/json",
          ...(canonicalOAuthProvider(record.provider) === "anthropic"
            ? { "anthropic-beta": "oauth-2025-04-20" }
            : {})
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

  const jwtOrProfileMeta =
    canonicalOAuthProvider(record.provider) === "openai"
      ? extractOpenAIJwtMeta(tokenData)
      : canonicalOAuthProvider(record.provider) === "anthropic"
        ? extractClaudeProfileMeta(userInfo)
        : {};

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
    ...jwtOrProfileMeta,
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

  // RFC 8628 standard device code flow (`kimi`, `nous`, or `custom_oauth`)
  const canonicalDevice = canonicalOAuthProvider(normalizedProvider);
  const isNous = canonicalDevice === "nous";
  const isKimi = canonicalDevice === "kimi";
  const portalBase =
    isNous && typeof cleanParams.portalBaseUrl === "string" && cleanParams.portalBaseUrl.trim()
      ? cleanParams.portalBaseUrl.trim().replace(/\/+$/, "")
      : DEFAULT_NOUS_PORTAL_BASE_URL;
  const kimiAuthBase =
    isKimi && typeof cleanParams.kimiAuthBaseUrl === "string" && cleanParams.kimiAuthBaseUrl.trim()
      ? cleanParams.kimiAuthBaseUrl.trim().replace(/\/+$/, "")
      : DEFAULT_KIMI_AUTH_BASE_URL;

  const deviceCodeUrl =
    typeof cleanParams.deviceCodeUrl === "string" && cleanParams.deviceCodeUrl.trim()
      ? cleanParams.deviceCodeUrl.trim()
      : isNous
        ? `${portalBase}/api/oauth/device/code`
        : isKimi
          ? `${kimiAuthBase}/api/oauth/device_authorization`
          : "";
  const tokenUrl =
    typeof cleanParams.tokenUrl === "string" && cleanParams.tokenUrl.trim()
      ? cleanParams.tokenUrl.trim()
      : isNous
        ? `${portalBase}/api/oauth/token`
        : isKimi
          ? `${kimiAuthBase}/api/oauth/token`
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
        : isKimi
          ? DEFAULT_KIMI_OAUTH_CLIENT_ID
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
    provider: canonicalDevice || "custom_oauth",
    tokenUrl,
    pollUrlBase: "",
    profileUrl: "",
    agentKeyUrl,
    clientId,
    clientSecret,
    scope,
    extra: {
      deviceCode,
      ...(isKimi ? { deviceId: `kimi-${crypto.randomBytes(8).toString("hex")}` } : {}),
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
    provider: canonicalDevice || "custom_oauth",
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
  const normalizedProvider = canonicalOAuthProvider(provider);
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
  if (normalizedProvider && canonicalOAuthProvider(record.provider) !== normalizedProvider) {
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
        accept: "application/json",
        ...(record.provider === "kimi" ? buildKimiHeaders(record.extra?.deviceId) : {})
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
    tokenUrl: record.tokenUrl,
    ...(record.extra?.deviceId ? { deviceId: record.extra.deviceId } : {})
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
      ...(record.extra?.deviceId ? { deviceId: record.extra.deviceId } : {}),
      ...(record.provider === "kimi" ? { tierLabel: "Kimi Code Plan" } : {}),
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

  let provider = "";
  let clientId = "";
  let clientSecret = "";
  let refreshToken = "";
  let storedAccessToken = "";
  let storedExpiresAt = 0;
  let rawTokenUrl = "";
  let effectiveTokenUrl = "";
  let cacheKey = "";
  let baseCredsObj = null;

  const allowLoop = Boolean(allowLoopback || tokenUrlOverride);
  const descriptorKey =
    typeof oauthCredsStringOrObj === "string"
      ? `${allowLoop ? 1 : 0}\0${tokenUrlOverride || ""}\0${oauthCredsStringOrObj}`
      : "";
  const cachedDesc = descriptorKey ? oauth2CredDescriptorCache.get(descriptorKey) : null;

  if (cachedDesc) {
    ({
      provider,
      clientId,
      clientSecret,
      refreshToken,
      storedAccessToken,
      storedExpiresAt,
      rawTokenUrl,
      effectiveTokenUrl,
      cacheKey,
      baseCredsObj
    } = cachedDesc);
  } else {
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
    baseCredsObj = { ...creds };
    provider = typeof creds.provider === "string" ? creds.provider.trim() : "";
    clientId = typeof creds.clientId === "string" ? creds.clientId.trim() : "";
    clientSecret =
      typeof creds.clientSecret === "string" ? creds.clientSecret.trim() : "";
    refreshToken =
      typeof creds.refreshToken === "string" ? creds.refreshToken.trim() : "";
    storedAccessToken =
      typeof creds.accessToken === "string" ? creds.accessToken.trim() : "";
    storedExpiresAt = Number(creds.expiresAt) || 0;
    rawTokenUrl =
      typeof tokenUrlOverride === "string" && tokenUrlOverride.trim()
        ? tokenUrlOverride.trim()
        : typeof creds.tokenUrl === "string"
          ? creds.tokenUrl.trim()
          : "";

    if (refreshToken && rawTokenUrl) {
      const parsedTokenUrl = validateOAuthEndpointUrl(rawTokenUrl, "tokenUrl", {
        allowLoopback: allowLoop
      });
      effectiveTokenUrl = parsedTokenUrl.toString();
      cacheKey = buildOAuth2CacheKey(clientId, refreshToken, effectiveTokenUrl);
    }

    if (descriptorKey) {
      oauth2CredDescriptorCache.set(descriptorKey, {
        provider,
        clientId,
        clientSecret,
        refreshToken,
        storedAccessToken,
        storedExpiresAt,
        rawTokenUrl,
        effectiveTokenUrl,
        cacheKey,
        baseCredsObj
      });
      while (oauth2CredDescriptorCache.size > OAUTH2_CRED_CACHE_MAX) {
        oauth2CredDescriptorCache.delete(oauth2CredDescriptorCache.keys().next().value);
      }
    }
  }

  const now = nowFn();

  // Prefer in-memory refreshed token when fresher than storedAccessToken
  if (!forceRefresh && cacheKey) {
    const cached = oauth2TokenCache.get(cacheKey);
    if (cached && cached.expiresAt - OAUTH2_TOKEN_REFRESH_BUFFER_MS > now) {
      return { accessToken: cached.accessToken, expiresAt: cached.expiresAt };
    }
  }

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

  const existingFlight = oauth2InFlightRefreshes.get(cacheKey);
  if (existingFlight && !forceRefresh) {
    const res = await existingFlight;
    return {
      accessToken: res.accessToken,
      expiresAt: res.expiresAt,
      ...(res.refreshToken ? { refreshToken: res.refreshToken } : {}),
      refreshed: true,
      ...(res.updatedCredentialsJson
        ? { updatedCredentialsJson: res.updatedCredentialsJson }
        : {})
    };
  }

  const cachedForRefresh = oauth2TokenCache.get(cacheKey);
  const activeRefreshToken =
    (cachedForRefresh &&
      typeof cachedForRefresh.refreshToken === "string" &&
      cachedForRefresh.refreshToken.trim()) ||
    refreshToken;

  const flightPromise = (async () => {
    const useJsonRefresh =
      canonicalOAuthProvider(provider) === "anthropic" ||
      /anthropic\.com/i.test(effectiveTokenUrl);
    let contentType = "application/x-www-form-urlencoded";
    let body = "";
    if (useJsonRefresh) {
      contentType = "application/json";
      body = JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: activeRefreshToken,
        ...(clientId ? { client_id: clientId } : {}),
        ...(clientSecret ? { client_secret: clientSecret } : {})
      });
    } else {
      const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: activeRefreshToken
      });
      if (clientId) form.set("client_id", clientId);
      if (clientSecret) form.set("client_secret", clientSecret);
      body = form.toString();
    }

    let res;
    try {
      res = await fetchImpl(effectiveTokenUrl, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": contentType,
          accept: "application/json"
        },
        body,
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      throw createHttpError(
        502,
        redactSecrets(
          `OAuth2 token refresh network error: ${err?.message || "fetch failed"}`,
          [clientSecret, activeRefreshToken]
        )
      );
    }

    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      throw createHttpError(
        res.status >= 400 && res.status < 500 ? 401 : 502,
        redactSecrets(
          `OAuth2 token refresh failed (HTTP ${res.status}): ${rawText.slice(0, 200)}`,
          [clientSecret, activeRefreshToken]
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
    const nextRefreshToken = rotatedRefresh || activeRefreshToken;
    const updatedObj = {
      ...(baseCredsObj || {}),
      provider: provider || baseCredsObj?.provider || "",
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      refreshToken: nextRefreshToken,
      accessToken,
      expiresAt,
      ...(rawTokenUrl ? { tokenUrl: rawTokenUrl } : {})
    };
    const updatedCredentialsJson = JSON.stringify(updatedObj);

    const cacheRecord = {
      accessToken,
      expiresAt,
      refreshToken: nextRefreshToken,
      updatedCredentialsJson
    };
    oauth2TokenCache.set(cacheKey, cacheRecord);
    if (rotatedRefresh) {
      const rotatedCacheKey = buildOAuth2CacheKey(clientId, rotatedRefresh, effectiveTokenUrl);
      oauth2TokenCache.set(rotatedCacheKey, cacheRecord);
    }
    while (oauth2TokenCache.size > OAUTH2_TOKEN_CACHE_MAX) {
      oauth2TokenCache.delete(oauth2TokenCache.keys().next().value);
    }

    if (cachedDesc) {
      cachedDesc.refreshToken = nextRefreshToken;
      cachedDesc.storedAccessToken = accessToken;
      cachedDesc.storedExpiresAt = expiresAt;
      cachedDesc.baseCredsObj = updatedObj;
    }

    return {
      accessToken,
      expiresAt,
      ...(rotatedRefresh ? { refreshToken: rotatedRefresh } : {}),
      updatedCredentialsJson
    };
  })();

  oauth2InFlightRefreshes.set(cacheKey, flightPromise);
  try {
    const result = await flightPromise;
    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
      refreshed: true,
      updatedCredentialsJson: result.updatedCredentialsJson
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
  oauth2CredDescriptorCache.clear();
  oauth2InFlightRefreshes.clear();
}

// ---------------------------------------------------------------------------
// OAuth Plan Detection, Quota Inspection, Live Model Discovery & Wire Adaptation
// (Anthropic Claude Code OAuth, OpenAI Codex OAuth, Kimi Code Device OAuth)
// ---------------------------------------------------------------------------

function mapStainlessOs() {
  return CACHED_STAINLESS_OS;
}

function mapStainlessArch() {
  return CACHED_STAINLESS_ARCH;
}

export function isClaudeOAuthKey(keyEntry, secret = "") {
  const oauthProvider = String(keyEntry?.oauthMeta?.provider || "").toLowerCase();
  const s = String(secret || keyEntry?.key || "");
  return (
    (keyEntry?.authMethod === "oauth2" &&
      (oauthProvider === "claude" || oauthProvider === "anthropic")) ||
    s.includes("sk-ant-oat")
  );
}

export function isCodexOAuthKey(keyEntry) {
  const oauthProvider = String(keyEntry?.oauthMeta?.provider || "").toLowerCase();
  return (
    keyEntry?.authMethod === "oauth2" &&
    (oauthProvider === "openai" || oauthProvider === "codex")
  );
}

export function isKimiOAuthKey(keyEntry) {
  const oauthProvider = String(keyEntry?.oauthMeta?.provider || "").toLowerCase();
  return (
    keyEntry?.authMethod === "oauth2" &&
    (oauthProvider === "kimi" || oauthProvider === "kimi-coding")
  );
}

export function buildKimiHeaders(deviceId = "") {
  const resolvedId =
    typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : `kimi-${Date.now()}`;

  return {
    "x-msh-platform": "9router",
    "x-msh-version": "2.0.0",
    "x-msh-device-name": CACHED_HOSTNAME,
    "x-msh-device-model": CACHED_KIMI_DEVICE_MODEL,
    "x-msh-device-id": resolvedId
  };
}

// --- Claude Code OAuth ---

const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28"
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

export function selectAnthropicBeta(model = "", body = null) {
  const summarize = body?.thinking?.display === "summarized";
  const flags = ANTHROPIC_BETA_BASE.filter(
    (flag) => flag !== "redact-thinking-2026-02-12" || !summarize
  );
  if (/^claude-(opus|sonnet)/i.test(String(model || ""))) {
    flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  }
  return flags.join(",");
}

const CLAUDE_DOT_TO_API_ID = {
  "claude-sonnet-5.5": "claude-sonnet-5-5",
  "claude-opus-5.5": "claude-opus-5-5",
  "claude-haiku-5.5": "claude-haiku-5-5",
  "claude-fable-5.2": "claude-fable-5-2",
  "claude-fable-5.1": "claude-fable-5-1",
  "claude-opus-4.8": "claude-opus-4-8",
  "claude-opus-4.7": "claude-opus-4-7",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6": "claude-opus-4-6",
  "claude-opus-4.5": "claude-opus-4-5-20251101",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
  "claude-opus-4.1": "claude-opus-4-1-20250805",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929"
};

function normalizeClaudeModelSyntax(rawId) {
  let id = String(rawId || "").trim();
  if (!id) return "";
  id = id.replace(/\([^()]+\)\s*$/, "").trim();
  id = id.replace(/-(thinking|xhigh|high|medium|low|minimal)$/i, "").trim();
  const lower = id.toLowerCase();
  if (CLAUDE_DOT_TO_API_ID[lower]) return CLAUDE_DOT_TO_API_ID[lower];
  return id.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

function claudeModelFamily(modelId) {
  const s = String(modelId || "").toLowerCase();
  if (s.includes("haiku")) return "haiku";
  if (s.includes("opus") || s.includes("fable")) return "opus";
  return "sonnet";
}

export function resolveClaudeOAuthModel(requestedModel, availableModels = []) {
  const raw = String(requestedModel || "").trim();
  const normalized = normalizeClaudeModelSyntax(raw);
  const liveList = (Array.isArray(availableModels) ? availableModels : []).filter(
    (m) => m && m.id && m.isLive === true
  );
  if (liveList.length === 0) {
    return normalized || "claude-sonnet-4-6";
  }

  const exact = liveList.find((m) => m.id === raw || m.id === normalized);
  if (exact) return exact.id;

  const prefixMatch = liveList.find(
    (m) => m.id.startsWith(normalized) || normalized.startsWith(m.id)
  );
  if (prefixMatch) return prefixMatch.id;

  const fam = claudeModelFamily(normalized || raw);
  const familyMatch = liveList.find((m) => claudeModelFamily(m.id) === fam);
  if (familyMatch) return familyMatch.id;

  return liveList[0].id;
}

export function getClaudeFallbackCandidates(requestedModel, availableModels = []) {
  const normalized = normalizeClaudeModelSyntax(requestedModel);
  const liveIds = (Array.isArray(availableModels) ? availableModels : [])
    .filter((m) => m?.id && m.isLive === true)
    .map((m) => m.id);
  const fam = claudeModelFamily(normalized || requestedModel);

  const familyOrder =
    fam === "haiku"
      ? ["claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022", "claude-sonnet-4-6"]
      : fam === "opus"
        ? [
            "claude-opus-4-6",
            "claude-opus-4-5-20251101",
            "claude-opus-4-1-20250805",
            "claude-sonnet-4-6"
          ]
        : [
            "claude-sonnet-4-6",
            "claude-sonnet-4-5-20250929",
            "claude-sonnet-4-20250514",
            "claude-3-7-sonnet-20250219",
            "claude-haiku-4-5-20251001"
          ];

  const merged = [...new Set([...liveIds, ...familyOrder, ...CLAUDE_CODE_DEFAULT_MODELS])];
  return merged.filter((id) => id && id !== normalized && id !== requestedModel);
}

function deriveDeterministicUuid(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function buildClaudeOAuthMessagesRequest(
  anthropicPayload,
  accessToken,
  upstreamModel,
  options = {}
) {
  const availableModels = Array.isArray(options.availableModels) ? options.availableModels : [];
  const effectiveModel = options.exactModel
    ? String(upstreamModel || "claude-sonnet-4-6")
    : resolveClaudeOAuthModel(upstreamModel, availableModels);

  const sessionId =
    (typeof options.sessionId === "string" && options.sessionId.trim()) ||
    deriveDeterministicUuid(`session:${accessToken.slice(0, 32)}:${effectiveModel}`);
  const deviceId = crypto.createHash("sha256").update(`device:${accessToken}`).digest("hex");
  const accountUuid = deriveDeterministicUuid(`account:${accessToken}`);

  const body = { ...(anthropicPayload || {}), model: effectiveModel };

  // Haiku < 5 rejects adaptive thinking; downgrade cleanly
  if (
    /haiku/i.test(effectiveModel) &&
    !/haiku[-._]?[5-9]/i.test(effectiveModel) &&
    body.thinking?.type === "adaptive"
  ) {
    body.thinking = { type: "enabled", budget_tokens: 4096 };
  }
  if (body.thinking?.type === "enabled" && body.max_tokens && body.thinking.budget_tokens >= body.max_tokens) {
    body.max_tokens = body.thinking.budget_tokens + 1024;
  }

  // Inject Claude Code OAuth billing header + deterministic user_id metadata
  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 5);
  const buildHash = crypto.randomBytes(2).toString("hex").slice(0, 3);
  const billingText = `x-anthropic-billing-header: cc_version=${CLAUDE_CLI_VERSION}.${buildHash}; cc_entrypoint=sdk-cli; cch=${contentHash};`;
  const billingBlock = { type: "text", text: billingText };

  if (Array.isArray(body.system)) {
    if (!body.system[0]?.text?.startsWith("x-anthropic-billing-header:")) {
      body.system = [billingBlock, ...body.system];
    }
  } else if (typeof body.system === "string" && body.system.trim()) {
    body.system = [billingBlock, { type: "text", text: body.system }];
  } else {
    body.system = [billingBlock];
  }

  if (!body.metadata?.user_id) {
    body.metadata = {
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      user_id: JSON.stringify({
        device_id: deviceId,
        account_uuid: accountUuid,
        session_id: sessionId
      })
    };
  }

  const rawBase = String(options.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  let messagesUrl;
  if (rawBase.endsWith("/messages")) {
    messagesUrl = rawBase;
  } else if (rawBase.endsWith("/v1")) {
    messagesUrl = `${rawBase}/messages`;
  } else {
    messagesUrl = `${rawBase}/v1/messages`;
  }
  if (options.addBetaQuery !== false && !messagesUrl.includes("beta=")) {
    messagesUrl += messagesUrl.includes("?") ? "&beta=true" : "?beta=true";
  }

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "anthropic-version": options.clientAnthropicVersion || "2023-06-01",
    "anthropic-beta": selectAnthropicBeta(effectiveModel, body),
    "anthropic-dangerous-direct-browser-access": "true",
    "user-agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
    "x-app": "cli",
    "x-stainless-helper-method": "stream",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime-version": "v24.14.0",
    "x-stainless-package-version": "0.80.0",
    "x-stainless-runtime": "node",
    "x-stainless-lang": "js",
    "x-stainless-arch": mapStainlessArch(),
    "x-stainless-os": mapStainlessOs(),
    "x-stainless-timeout": "600",
    "x-claude-code-session-id": sessionId
  };

  return {
    url: messagesUrl,
    headers,
    body,
    resolvedModel: effectiveModel
  };
}

function parseIsoOrUnixReset(val) {
  if (val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    const ms = val < 1e12 ? val * 1000 : val;
    return new Date(ms).toISOString();
  }
  const ms = Date.parse(String(val));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

export async function fetchClaudeOAuthUsage(accessToken, options = {}) {
  const token = String(accessToken || "").trim();
  if (!token) throw createHttpError(400, "Missing Claude OAuth access token");

  const fetchImpl = options.fetchImpl || upstreamFetch;
  const dispatcher = options.dispatcher;
  const headers = {
    authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
    "user-agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`,
    accept: "application/json"
  };

  const fetchJson = async (url) => {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
        ...(dispatcher ? { dispatcher } : {})
      });
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, text };
    } catch (err) {
      return { ok: false, status: 0, data: null, text: err?.message || "network error" };
    }
  };

  const [profileRes, usageRes, modelsRes] = await Promise.all([
    fetchJson(options.profileUrl || CLAUDE_OAUTH_PROFILE_URL),
    fetchJson(options.usageUrl || CLAUDE_OAUTH_USAGE_URL),
    fetchJson(options.modelsUrl || CLAUDE_OAUTH_MODELS_URL)
  ]);

  const authFailed =
    [profileRes, usageRes, modelsRes].every((r) => !r.ok) &&
    [profileRes, usageRes, modelsRes].some((r) => r.status === 401 || r.status === 403);
  if (authFailed) {
    const failed = [modelsRes, usageRes, profileRes].find((r) => r.status === 401 || r.status === 403);
    const errMsg =
      failed?.data?.error?.message ||
      failed?.data?.error ||
      failed?.text?.slice(0, 200) ||
      `HTTP ${failed?.status}`;
    throw createHttpError(failed?.status || 401, redactSecrets(String(errMsg), [token]));
  }

  const profileMeta = profileRes.ok && profileRes.data ? extractClaudeProfileMeta(profileRes.data) : {};
  const organizationId = String(profileRes.data?.organization?.uuid || "").trim();
  const organizationName = String(profileRes.data?.organization?.name || "").trim();

  const windows = [];
  const u = usageRes.ok && usageRes.data && typeof usageRes.data === "object" ? usageRes.data : {};
  const addWindow = (id, windowType, label, utilization, resetsAt) => {
    if (typeof utilization !== "number" || !Number.isFinite(utilization)) return;
    const clampedPct = Math.max(0, Math.min(100, utilization));
    windows.push({
      id,
      family: "claude_gpt",
      window: windowType,
      label,
      remainingFraction: Math.max(0, Math.min(1, (100 - clampedPct) / 100)),
      resetTime: parseIsoOrUnixReset(resetsAt)
    });
  };

  if (u.five_hour && typeof u.five_hour === "object") {
    addWindow("claude_5h", "5h", "Claude · 5 giờ", u.five_hour.utilization, u.five_hour.resets_at);
  }
  if (u.seven_day && typeof u.seven_day === "object") {
    addWindow("claude_weekly", "weekly", "Claude · tuần", u.seven_day.utilization, u.seven_day.resets_at);
  }
  for (const [k, v] of Object.entries(u)) {
    if (k.startsWith("seven_day_") && k !== "seven_day" && v && typeof v === "object") {
      const sub = k.replace("seven_day_", "");
      const title = sub ? sub[0].toUpperCase() + sub.slice(1) : sub;
      addWindow(`claude_${k}`, "weekly", `Claude ${title} · tuần`, v.utilization, v.resets_at);
    }
  }
  if (Array.isArray(u.limits)) {
    for (const lim of u.limits) {
      if (lim?.kind !== "weekly_scoped" || typeof lim.percent !== "number") continue;
      const mName = String(lim?.scope?.model?.display_name || "").trim();
      if (!mName) continue;
      addWindow(
        `claude_weekly_${mName.toLowerCase()}`,
        "weekly",
        `Claude ${mName} · tuần`,
        lim.percent,
        lim.resets_at
      );
    }
  }

  const baseWindow =
    windows.find((w) => w.id === "claude_5h") ||
    windows.find((w) => w.id === "claude_weekly") ||
    windows[0] ||
    null;

  const liveRaw =
    modelsRes.ok && Array.isArray(modelsRes.data?.data) ? modelsRes.data.data : [];
  const liveModels = liveRaw
    .map((m) => {
      const id = String(m?.id || "").trim();
      if (!id) return null;
      return {
        id,
        label: String(m?.display_name || m?.name || id).trim(),
        family: "claude_gpt",
        kind: "chat",
        remainingFraction: baseWindow ? baseWindow.remainingFraction : null,
        resetTime: baseWindow ? baseWindow.resetTime : "",
        isLive: true
      };
    })
    .filter(Boolean);

  const models =
    liveModels.length > 0
      ? liveModels
      : CLAUDE_CODE_DEFAULT_MODELS.map((id) => ({
          id,
          label: id,
          family: "claude_gpt",
          kind: "chat",
          remainingFraction: baseWindow ? baseWindow.remainingFraction : null,
          resetTime: baseWindow ? baseWindow.resetTime : "",
          isLive: false
        }));

  const tierLabel =
    profileMeta.tierLabel && profileMeta.tierLabel !== "Claude OAuth"
      ? profileMeta.tierLabel
      : usageRes.ok || modelsRes.ok
        ? "Claude Code Plan"
        : "Claude OAuth";

  return {
    planOk: Boolean(profileRes.ok || usageRes.ok || modelsRes.ok),
    quotaOk: Boolean(usageRes.ok || windows.length > 0),
    catalogOk: models.length > 0,
    ...(profileMeta.email ? { email: profileMeta.email } : {}),
    ...(profileMeta.name ? { name: profileMeta.name } : {}),
    ...(profileMeta.tier ? { tier: profileMeta.tier } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(organizationName ? { organizationName } : {}),
    tierLabel,
    windows,
    buckets: models
      .filter((m) => typeof m.remainingFraction === "number")
      .map((m) => ({
        modelId: m.id,
        remainingFraction: m.remainingFraction,
        resetTime: m.resetTime || ""
      })),
    models,
    liveModelIds: liveModels.map((m) => m.id),
    defaultModelId: models[0]?.id || "claude-sonnet-4-6",
    perModelHidden: false
  };
}

// --- OpenAI Codex OAuth ---

const CODEX_DEFAULT_INSTRUCTIONS =
  "You are Codex, an expert software engineering assistant. Follow the user's instructions carefully and respond concisely.";

function clampCodexCallId(id) {
  if (typeof id !== "string" || !id) return `call_${crypto.randomBytes(6).toString("hex")}`;
  return id.length > 64 ? id.slice(0, 64) : id;
}

export function resolveCodexOAuthModel(requestedModel, availableModels = []) {
  const raw = String(requestedModel || "")
    .trim()
    .replace(/\([^()]+\)\s*$/, "")
    .trim();
  const base = raw
    .replace(/\[1m\]$/i, "")
    .replace(/-review$/i, "")
    .replace(/-(none|minimal|low|medium|high|xhigh)$/i, "")
    .trim();

  const list = Array.isArray(availableModels) ? availableModels.filter((m) => m?.id) : [];
  const exact = list.find((m) => m.id === raw || m.id === base);
  if (exact) return exact.id;

  const isCodexSlug =
    /^gpt-(?:5|6)/i.test(base) ||
    /^gpt-(?:daybreak|reserve)/i.test(base) ||
    base === "codex-auto-review" ||
    /codex/i.test(base);
  if (isCodexSlug && list.length === 0) {
    return base || "gpt-5.3-codex";
  }

  return list[0]?.id || (isCodexSlug && base ? base : "gpt-5.3-codex");
}

function extractTextFromMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function buildCodexOAuthRequest(
  openaiPayload,
  accessToken,
  upstreamModel,
  options = {}
) {
  const raw = String(upstreamModel || openaiPayload?.model || "").trim();
  const effortMatch = raw.match(/-(none|minimal|low|medium|high|xhigh)$/i);
  const availableModels = Array.isArray(options.availableModels) ? options.availableModels : [];
  const resolvedModel = resolveCodexOAuthModel(raw, availableModels);

  const rawBody = openaiPayload && typeof openaiPayload === "object" ? openaiPayload : {};
  const input = [];
  const instructionsParts = [];

  if (typeof rawBody.instructions === "string" && rawBody.instructions.trim()) {
    instructionsParts.push(rawBody.instructions.trim());
  }

  if (Array.isArray(rawBody.input)) {
    for (const item of rawBody.input) {
      if (item) input.push(item);
    }
  } else if (Array.isArray(rawBody.messages)) {
    for (const msg of rawBody.messages) {
      if (!msg || !msg.role) continue;
      if (msg.role === "system" || msg.role === "developer") {
        const txt = extractTextFromMessageContent(msg.content).trim();
        if (txt) instructionsParts.push(txt);
        continue;
      }
      if (msg.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: clampCodexCallId(msg.tool_call_id),
          output:
            typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")
        });
        continue;
      }
      if (msg.role === "user" || msg.role === "assistant") {
        const contentType = msg.role === "user" ? "input_text" : "output_text";
        const contentParts =
          typeof msg.content === "string"
            ? [{ type: contentType, text: msg.content }]
            : Array.isArray(msg.content)
              ? msg.content.map((c) => {
                  if (typeof c === "string") return { type: contentType, text: c };
                  if (c?.type === "text" || c?.type === "input_text" || c?.type === "output_text") {
                    return { type: contentType, text: c.text ?? "" };
                  }
                  if (c?.type === "image_url") {
                    const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url || "";
                    return { type: "input_image", image_url: url, detail: c.image_url?.detail || "auto" };
                  }
                  return { type: contentType, text: c?.text || JSON.stringify(c) };
                })
              : [];

        if (contentParts.length > 0) {
          input.push({ type: "message", role: msg.role, content: contentParts });
        }

        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const name = typeof tc?.function?.name === "string" ? tc.function.name.trim() : "";
            if (!name) continue;
            let args = "{}";
            if (typeof tc.function?.arguments === "string") {
              args = tc.function.arguments || "{}";
            } else if (tc.function?.arguments !== undefined) {
              args = JSON.stringify(tc.function.arguments);
            }
            input.push({
              type: "function_call",
              call_id: clampCodexCallId(tc.id),
              name: name.slice(0, 128),
              arguments: args
            });
          }
        }
      }
    }
  }

  if (input.length === 0) {
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "..." }]
    });
  }

  const tools = [];
  if (Array.isArray(rawBody.tools)) {
    for (const tool of rawBody.tools) {
      if (!tool || typeof tool !== "object") continue;
      if (tool.type === "function") {
        const fn = tool.function && typeof tool.function === "object" ? tool.function : tool;
        const name = typeof fn.name === "string" ? fn.name.trim() : "";
        if (!name) continue;
        const params =
          fn.parameters && typeof fn.parameters === "object"
            ? { ...fn.parameters, ...(fn.parameters.type === "object" && !fn.parameters.properties ? { properties: {} } : {}) }
            : { type: "object", properties: {} };
        tools.push({
          type: "function",
          name: name.slice(0, 128),
          ...(fn.description ? { description: String(fn.description) } : {}),
          parameters: params,
          ...(typeof fn.strict === "boolean" ? { strict: fn.strict } : {})
        });
      }
    }
  }

  let effort =
    rawBody.reasoning?.effort ||
    rawBody.reasoning_effort ||
    (effortMatch ? effortMatch[1].toLowerCase() : "") ||
    "low";
  if (effort === "max" || effort === "ultra") effort = "high";
  if (!["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    effort = "low";
  }

  const sessionId =
    (typeof options.sessionId === "string" && options.sessionId.trim()) ||
    crypto.createHash("sha256").update(`codex:${accessToken.slice(0, 32)}`).digest("hex").slice(0, 24);

  const payload = {
    model: resolvedModel,
    input,
    instructions: instructionsParts.join("\n\n") || CODEX_DEFAULT_INSTRUCTIONS,
    stream: true,
    store: false,
    prompt_cache_key: sessionId,
    reasoning: { effort, summary: "auto" },
    ...(effort !== "none" ? { include: ["reasoning.encrypted_content"] } : {})
  };
  if (tools.length > 0) {
    payload.tools = tools;
    if (rawBody.tool_choice !== undefined) {
      if (
        rawBody.tool_choice &&
        typeof rawBody.tool_choice === "object" &&
        rawBody.tool_choice.type === "function" &&
        rawBody.tool_choice.function?.name
      ) {
        payload.tool_choice = { type: "function", name: rawBody.tool_choice.function.name };
      } else if (
        typeof rawBody.tool_choice === "string" ||
        rawBody.tool_choice?.type === "function"
      ) {
        payload.tool_choice = rawBody.tool_choice;
      }
    }
  }

  const jwtMeta = extractOpenAIJwtMeta({ access_token: accessToken });
  const accountId = options.accountId || jwtMeta.accountId || "";

  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${accessToken}`,
    originator: "codex_cli_rs",
    "user-agent": `codex_cli_rs/${CODEX_CLI_VERSION}`,
    version: CODEX_CLI_VERSION,
    session_id: sessionId,
    ...(accountId ? { "chatgpt-account-id": accountId } : {})
  };

  return {
    url: options.url || CODEX_RESPONSES_URL,
    headers,
    body: payload,
    resolvedModel
  };
}

export function codexSseEventToOpenAIChunk(eventType, parsed, state) {
  const type = parsed?.type || eventType || "";
  if (!state.chatId) {
    state.chatId = `chatcmpl-${crypto.randomBytes(8).toString("hex")}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolIdxMap = new Map();
    state.toolHasArgs = new Set();
    state.nextToolIdx = 0;
  }
  const makeChunk = (delta, finishReason = null, usage = undefined) => ({
    id: state.chatId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "gpt-5.3-codex",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {})
  });

  if (type === "error" || type === "response.failed") {
    const err = parsed?.error || parsed?.response?.error;
    const msg = err?.message || (typeof err === "string" ? err : JSON.stringify(err || "Codex error"));
    return { error: msg };
  }
  if (type === "response.output_text.delta" && typeof parsed?.delta === "string" && parsed.delta) {
    return makeChunk({ content: parsed.delta });
  }
  if (
    type === "response.reasoning_summary_text.delta" &&
    typeof parsed?.delta === "string" &&
    parsed.delta
  ) {
    return makeChunk({ reasoning_content: parsed.delta });
  }
  if (
    type === "response.output_item.added" &&
    (parsed?.item?.type === "function_call" || parsed?.item?.type === "custom_tool_call")
  ) {
    const item = parsed.item;
    const itemKey = item.id || parsed.item_id || item.call_id;
    let idx = state.toolIdxMap.get(itemKey);
    if (idx === undefined) {
      idx = state.nextToolIdx++;
      if (itemKey) state.toolIdxMap.set(itemKey, idx);
      if (item.call_id && item.call_id !== itemKey) {
        state.toolIdxMap.set(item.call_id, idx);
      }
    }
    return makeChunk({
      tool_calls: [
        {
          index: idx,
          id: item.call_id || `call_${idx}`,
          type: "function",
          function: { name: item.name || "", arguments: "" }
        }
      ]
    });
  }
  if (
    (type === "response.function_call_arguments.delta" ||
      type === "response.custom_tool_call_input.delta") &&
    typeof parsed?.delta === "string" &&
    parsed.delta
  ) {
    const idx =
      (parsed.item_id ? state.toolIdxMap.get(parsed.item_id) : undefined) ??
      Math.max(0, state.nextToolIdx - 1);
    state.toolHasArgs.add(idx);
    return makeChunk({ tool_calls: [{ index: idx, function: { arguments: parsed.delta } }] });
  }
  if (
    type === "response.output_item.done" &&
    (parsed?.item?.type === "function_call" || parsed?.item?.type === "custom_tool_call")
  ) {
    const item = parsed.item;
    const itemKey = item.id || parsed.item_id || item.call_id;
    const rawArgs =
      typeof item.arguments === "string"
        ? item.arguments
        : typeof item.input === "string"
          ? item.input
          : "";
    let idx = itemKey ? state.toolIdxMap.get(itemKey) : undefined;
    if (idx === undefined && item.name) {
      idx = state.nextToolIdx++;
      if (itemKey) state.toolIdxMap.set(itemKey, idx);
      state.toolHasArgs.add(idx);
      return makeChunk({
        tool_calls: [
          {
            index: idx,
            id: item.call_id || `call_${idx}`,
            type: "function",
            function: { name: item.name, arguments: rawArgs }
          }
        ]
      });
    }
    if (idx !== undefined && rawArgs && !state.toolHasArgs.has(idx)) {
      state.toolHasArgs.add(idx);
      return makeChunk({ tool_calls: [{ index: idx, function: { arguments: rawArgs } }] });
    }
    return null;
  }
  if (type === "response.completed" || type === "response.done") {
    const u = parsed?.response?.usage;
    const promptTokens = Number(u?.input_tokens ?? u?.prompt_tokens) || 0;
    const completionTokens = Number(u?.output_tokens ?? u?.completion_tokens) || 0;
    const cachedTokens = Number(u?.input_tokens_details?.cached_tokens) || 0;
    const finishReason = state.nextToolIdx > 0 ? "tool_calls" : "stop";
    state.done = true;
    state.usage = { promptTokens, completionTokens, cachedTokens };
    return makeChunk(
      {},
      finishReason,
      u
        ? {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            ...(cachedTokens ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
          }
        : undefined
    );
  }
  return null;
}

export function aggregateCodexResponsesStream(sseText, requestedModel) {
  let content = "";
  let reasoning = "";
  const toolCallsByKey = new Map();
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let streamError = "";

  let currentEvent = "";
  for (const rawLine of String(sseText || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      currentEvent = "";
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const type = parsed?.type || currentEvent || "";
    if (type === "error" || type === "response.failed") {
      const err = parsed?.error || parsed?.response?.error;
      streamError = err?.message || (typeof err === "string" ? err : JSON.stringify(err || "Codex stream failed"));
      break;
    }
    if (type === "response.output_text.delta" && typeof parsed?.delta === "string") {
      content += parsed.delta;
    } else if (type === "response.reasoning_summary_text.delta" && typeof parsed?.delta === "string") {
      reasoning += parsed.delta;
    } else if (
      type === "response.output_item.added" &&
      (parsed?.item?.type === "function_call" || parsed?.item?.type === "custom_tool_call")
    ) {
      const k = parsed.item.id || parsed.item_id || parsed.item.call_id || String(toolCallsByKey.size);
      toolCallsByKey.set(k, {
        id: parsed.item.call_id || `call_${toolCallsByKey.size}`,
        type: "function",
        function: { name: parsed.item.name || "tool", arguments: "" }
      });
    } else if (
      (type === "response.function_call_arguments.delta" ||
        type === "response.custom_tool_call_input.delta") &&
      typeof parsed?.delta === "string"
    ) {
      const k = parsed.item_id || [...toolCallsByKey.keys()].pop();
      const entry = k ? toolCallsByKey.get(k) : null;
      if (entry) entry.function.arguments += parsed.delta;
    } else if (type === "response.output_item.done" && parsed?.item?.type === "function_call") {
      const k = parsed.item.id || parsed.item_id || parsed.item.call_id;
      const entry = k ? toolCallsByKey.get(k) : null;
      if (entry && !entry.function.arguments && typeof parsed.item.arguments === "string") {
        entry.function.arguments = parsed.item.arguments;
      }
    } else if (type === "response.completed" || type === "response.done") {
      const u = parsed?.response?.usage;
      if (u) {
        promptTokens = Number(u.input_tokens ?? u.prompt_tokens) || 0;
        completionTokens = Number(u.output_tokens ?? u.completion_tokens) || 0;
        cachedTokens = Number(u.input_tokens_details?.cached_tokens) || 0;
      }
      if (!content && typeof parsed?.response?.output_text === "string") {
        content = parsed.response.output_text;
      } else if (!content && Array.isArray(parsed?.response?.output)) {
        for (const item of parsed.response.output) {
          if (item?.type === "message" && Array.isArray(item.content)) {
            content += item.content.map((p) => p?.text || "").join("");
          }
        }
      }
    }
  }

  if (streamError) {
    return { error: { message: streamError } };
  }

  const toolCalls = [...toolCallsByKey.values()];
  const message = {
    role: "assistant",
    content: content || (toolCalls.length > 0 ? null : ""),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  };

  return {
    id: `chatcmpl-${crypto.randomBytes(10).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel || "gpt-5.3-codex",
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(cachedTokens ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
    }
  };
}

export async function fetchCodexOAuthUsage(accessToken, options = {}) {
  const token = String(accessToken || "").trim();
  if (!token) throw createHttpError(400, "Missing OpenAI Codex OAuth access token");

  const fetchImpl = options.fetchImpl || upstreamFetch;
  const dispatcher = options.dispatcher;
  const jwtMeta = extractOpenAIJwtMeta({ access_token: token });
  const accountId = options.accountId || jwtMeta.accountId || "";

  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    originator: "codex_cli_rs",
    "user-agent": `codex_cli_rs/${CODEX_CLI_VERSION}`,
    ...(accountId ? { "chatgpt-account-id": accountId } : {})
  };

  const fetchJson = async (url) => {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
        ...(dispatcher ? { dispatcher } : {})
      });
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, text };
    } catch (err) {
      return { ok: false, status: 0, data: null, text: err?.message || "network error" };
    }
  };

  const [usageRes, modelsRes] = await Promise.all([
    fetchJson(options.usageUrl || CODEX_USAGE_URL),
    fetchJson(options.modelsUrl || CODEX_MODELS_URL)
  ]);

  if (!usageRes.ok && !modelsRes.ok && (usageRes.status === 401 || modelsRes.status === 401)) {
    throw createHttpError(401, "OpenAI Codex OAuth token invalid or expired");
  }

  const u = usageRes.ok && usageRes.data && typeof usageRes.data === "object" ? usageRes.data : {};
  const windows = [];
  const addWindow = (id, windowType, label, win) => {
    if (!win || typeof win !== "object") return;
    const usedPct = Number(win.used_percent ?? win.percent_used);
    if (!Number.isFinite(usedPct)) return;
    const rem = Math.max(0, Math.min(1, (100 - Math.max(0, Math.min(100, usedPct))) / 100));
    windows.push({
      id,
      family: "claude_gpt",
      window: windowType,
      label,
      remainingFraction: rem,
      resetTime: parseIsoOrUnixReset(win.reset_at ?? win.resets_at ?? win.resetAt)
    });
  };

  const mainRL = u.rate_limit || u.rate_limits || u.rate_limits_by_limit_id?.codex || null;
  if (mainRL && typeof mainRL === "object") {
    addWindow("codex_5h", "5h", "Codex · 5 giờ", mainRL.primary_window || mainRL.primary);
    addWindow("codex_weekly", "weekly", "Codex · tuần", mainRL.secondary_window || mainRL.secondary);
  }
  const revRL = u.code_review_rate_limit || u.review_rate_limit || u.rate_limits_by_limit_id?.code_review || null;
  if (revRL && typeof revRL === "object") {
    addWindow("codex_review_5h", "5h", "Review · 5 giờ", revRL.primary_window || revRL.primary);
    addWindow("codex_review_weekly", "weekly", "Review · tuần", revRL.secondary_window || revRL.secondary);
  }

  const baseWindow =
    windows.find((w) => w.id === "codex_5h") ||
    windows.find((w) => w.id === "codex_weekly") ||
    windows[0] ||
    null;

  const rawList = Array.isArray(modelsRes.data?.models)
    ? modelsRes.data.models
    : Array.isArray(modelsRes.data?.data)
      ? modelsRes.data.data
      : [];
  const liveModels = rawList
    .map((m) => {
      const id = String(m?.slug || m?.id || m?.model || m?.name || "").trim();
      if (!id) return null;
      return {
        id,
        label: String(m?.display_name || m?.displayName || m?.title || m?.name || id).trim(),
        family: "claude_gpt",
        kind: (m?.type || "").toLowerCase() === "image" ? "image" : "chat",
        remainingFraction: baseWindow ? baseWindow.remainingFraction : null,
        resetTime: baseWindow ? baseWindow.resetTime : "",
        isLive: true
      };
    })
    .filter(Boolean);

  const models =
    liveModels.length > 0
      ? liveModels
      : CODEX_DEFAULT_MODELS.map((id) => ({
          id,
          label: id,
          family: "claude_gpt",
          kind: "chat",
          remainingFraction: baseWindow ? baseWindow.remainingFraction : null,
          resetTime: baseWindow ? baseWindow.resetTime : "",
          isLive: false
        }));

  const rawPlan = String(u.plan_type || u.summary?.plan || jwtMeta.tier || "").trim().toLowerCase();
  let tierLabel = jwtMeta.tierLabel || "OpenAI Codex";
  if (rawPlan === "pro") tierLabel = "ChatGPT Pro";
  else if (rawPlan === "plus") tierLabel = "ChatGPT Plus";
  else if (rawPlan === "team") tierLabel = "ChatGPT Team";
  else if (rawPlan === "enterprise" || rawPlan === "edu") {
    tierLabel = `ChatGPT ${rawPlan[0].toUpperCase()}${rawPlan.slice(1)}`;
  } else if (rawPlan === "free") tierLabel = "ChatGPT Free";

  return {
    planOk: Boolean(usageRes.ok || modelsRes.ok || jwtMeta.email || accountId),
    quotaOk: Boolean(usageRes.ok || windows.length > 0),
    catalogOk: models.length > 0,
    ...(jwtMeta.email ? { email: jwtMeta.email } : {}),
    ...(accountId ? { accountId } : {}),
    ...(rawPlan ? { tier: rawPlan } : {}),
    tierLabel,
    windows,
    buckets: models
      .filter((m) => typeof m.remainingFraction === "number")
      .map((m) => ({
        modelId: m.id,
        remainingFraction: m.remainingFraction,
        resetTime: m.resetTime || ""
      })),
    models,
    liveModelIds: liveModels.map((m) => m.id),
    defaultModelId: models[0]?.id || "gpt-5.3-codex",
    perModelHidden: false
  };
}

// --- Kimi Code OAuth ---

const KIMI_PLAN_LEVELS = {
  LEVEL_BASIC: "Moderato",
  LEVEL_INTERMEDIATE: "Allegretto",
  LEVEL_ADVANCED: "Allegro",
  LEVEL_STANDARD: "Vivace"
};

export async function fetchKimiOAuthUsage(accessToken, apiKey = "", options = {}) {
  const token = String(accessToken || "").trim();
  const key = String(apiKey || "").trim();
  if (!token && !key) throw createHttpError(400, "Missing Kimi Code credential");

  const fetchImpl = options.fetchImpl || upstreamFetch;
  const dispatcher = options.dispatcher;
  const authHeaders = key
    ? { "x-api-key": key }
    : {
        authorization: `Bearer ${token}`,
        ...buildKimiHeaders(options.deviceId)
      };

  const res = await fetchImpl(options.usageUrl || KIMI_CODING_USAGE_URL, {
    method: "GET",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
      accept: "application/json"
    },
    signal: AbortSignal.timeout(15000),
    ...(dispatcher ? { dispatcher } : {})
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }

  if (res.status === 401) {
    throw createHttpError(401, "Kimi authentication expired or invalid");
  }

  const windows = [];
  if (res.ok && data && typeof data === "object") {
    const usageObj = data.usage && typeof data.usage === "object" ? data.usage : {};
    const wLimit = Number(usageObj.limit ?? usageObj.Limit);
    const wUsed = Number(usageObj.used ?? usageObj.Used) || 0;
    const wRem = Number(usageObj.remaining ?? usageObj.Remaining);
    if (Number.isFinite(wLimit) && wLimit > 0) {
      const rem = Number.isFinite(wRem) ? wRem : Math.max(0, wLimit - wUsed);
      windows.push({
        id: "kimi_weekly",
        family: "claude_gpt",
        window: "weekly",
        label: "Kimi · tuần",
        remainingFraction: Math.max(0, Math.min(1, rem / wLimit)),
        resetTime: parseIsoOrUnixReset(
          usageObj.resetTime || usageObj.ResetTime || usageObj.reset_at || usageObj.resetAt
        )
      });
    }
    for (const item of Array.isArray(data.limits) ? data.limits : []) {
      const d = item?.detail && typeof item.detail === "object" ? item.detail : null;
      if (!d) continue;
      const l = Number(d.limit ?? d.Limit);
      const r = Number(d.remaining ?? d.Remaining);
      if (Number.isFinite(l) && l > 0) {
        const rem = Number.isFinite(r) ? r : l;
        windows.push({
          id: `kimi_limit_${windows.length}`,
          family: "claude_gpt",
          window: "5h",
          label: "Kimi · giới hạn ngắn hạn",
          remainingFraction: Math.max(0, Math.min(1, rem / l)),
          resetTime: parseIsoOrUnixReset(d.resetTime || d.reset_at || d.resetAt)
        });
      }
    }
  }

  const level = data?.user?.membership?.level;
  const planSuffix = level ? KIMI_PLAN_LEVELS[level] || String(level).replace(/^LEVEL_/, "") : "";
  const tierLabel = planSuffix ? `Kimi Code · ${planSuffix}` : "Kimi Code Plan";
  const baseWindow = windows[0] || null;
  const models = KIMI_CODE_DEFAULT_MODELS.map((id) => ({
    id,
    label: id,
    family: "claude_gpt",
    kind: "chat",
    remainingFraction: baseWindow ? baseWindow.remainingFraction : null,
    resetTime: baseWindow ? baseWindow.resetTime : "",
    isLive: res.ok
  }));

  return {
    planOk: res.ok || res.status === 403,
    quotaOk: res.ok && windows.length > 0,
    catalogOk: true,
    tierLabel,
    windows,
    buckets: models
      .filter((m) => typeof m.remainingFraction === "number")
      .map((m) => ({
        modelId: m.id,
        remainingFraction: m.remainingFraction,
        resetTime: m.resetTime || ""
      })),
    models,
    liveModelIds: res.ok ? KIMI_CODE_DEFAULT_MODELS : [],
    defaultModelId: KIMI_CODE_DEFAULT_MODELS[0],
    perModelHidden: false,
    ...(!res.ok ? { warning: text.slice(0, 200) || `HTTP ${res.status}` } : {})
  };
}
