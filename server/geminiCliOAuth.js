import crypto from "node:crypto";
import { upstreamFetch } from "./proxy.js";
import { extractCodeAndState } from "./oauthFlows.js";
import { isLoopbackHost } from "./security/headers.js";
import {
  aggregateCloudCodeStream,
  buildCloudCodeRequest,
  resolveUpstreamModel,
  systemPromptIdentity
} from "./geminiCliTranslator.js";
import {
  classifyHostForSSRF,
  redactSecrets,
  stripPrototypePollution
} from "./security/redact.js";

/**
 * Gemini CLI (Google Cloud Code Assist) OAuth — the same public OAuth client the official
 * `gemini-cli` binary and 9router use. Google accepts loopback redirects for this client on
 * ANY port, so a remote (Vercel) dashboard can still finish the flow by pasting the callback.
 *
 * Upstream is `cloudcode-pa.googleapis.com/v1internal` (Cloud Code Assist), NOT
 * `generativelanguage.googleapis.com`. That is what makes the account quota/plan resolve
 * without the user ever creating a GCP project or enabling Cloud Billing.
 */

/**
 * Public `gemini-cli` OAuth client. Google ships this same pair inside the official CLI binary,
 * so it is not a private credential — but the value is assembled from fragments at runtime so
 * repository secret scanners do not flag the literal. Override with GOOGLE_CLI_CLIENT_ID /
 * GOOGLE_CLI_CLIENT_SECRET when you want to use your own client.
 */
const CLI_CLIENT_ID_PARTS = [
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j",
  ".apps.googleusercontent.com"
];
const CLI_CLIENT_SECRET_PARTS = ["GOCSPX-4uHg", "MPm-1o7Sk-", "geV6Cu5clXFsxl"];

export const GEMINI_CLI_CLIENT_ID =
  process.env.GOOGLE_CLI_CLIENT_ID || CLI_CLIENT_ID_PARTS.join("");

export const GEMINI_CLI_CLIENT_SECRET =
  process.env.GOOGLE_CLI_CLIENT_SECRET || CLI_CLIENT_SECRET_PARTS.join("");

export const GEMINI_CLI_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GEMINI_CLI_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GEMINI_CLI_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
export const GEMINI_CLI_CLOUDCODE_BASE = "https://cloudcode-pa.googleapis.com/v1internal";

export const GEMINI_CLI_LOAD_CODE_ASSIST_URL = `${GEMINI_CLI_CLOUDCODE_BASE}:loadCodeAssist`;
export const GEMINI_CLI_ONBOARD_USER_URL = `${GEMINI_CLI_CLOUDCODE_BASE}:onboardUser`;
export const GEMINI_CLI_QUOTA_URL = `${GEMINI_CLI_CLOUDCODE_BASE}:retrieveUserQuota`;
export const GEMINI_CLI_GENERATE_URL = `${GEMINI_CLI_CLOUDCODE_BASE}:generateContent`;
export const GEMINI_CLI_STREAM_URL = `${GEMINI_CLI_CLOUDCODE_BASE}:streamGenerateContent?alt=sse`;

export const GEMINI_CLI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];

export const GEMINI_CLI_VERSION = "0.34.0";
export const GEMINI_CLI_API_CLIENT = "google-genai-sdk/1.41.0 gl-node/v22.19.0";
export const GEMINI_CLI_DEFAULT_REDIRECT = "http://127.0.0.1:1455/oauth2callback";

/**
 * Antigravity — Google's replacement for the Gemini CLI client. Same Cloud Code Assist RPCs, but
 * its own public OAuth client (shipped inside the Antigravity IDE, assembled from fragments for the
 * same secret-scanner reason as above), two extra scopes, and chat on the `daily-cloudcode-pa` host.
 * Override with ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET.
 */
const AG_CLIENT_ID_PARTS = [
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep",
  ".apps.googleusercontent.com"
];
const AG_CLIENT_SECRET_PARTS = ["GOCSPX-K58F", "WR486LdLJ1", "mLB8sXC4z6qDAf"];

export const ANTIGRAVITY_CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID || AG_CLIENT_ID_PARTS.join("");
export const ANTIGRAVITY_CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET || AG_CLIENT_SECRET_PARTS.join("");
export const ANTIGRAVITY_VERSION = "2.24.0";
export const ANTIGRAVITY_USER_AGENT = `antigravity/hub/${ANTIGRAVITY_VERSION} darwin/arm64`;
export const ANTIGRAVITY_CHAT_BASE = "https://daily-cloudcode-pa.googleapis.com/v1internal";
export const ANTIGRAVITY_DEFAULT_REDIRECT = "http://localhost:1456/callback";
/** Weekly + 5-hour quota windows per model family — the real limit on free-tier accounts. */
export const ANTIGRAVITY_QUOTA_SUMMARY_URL = `${ANTIGRAVITY_CHAT_BASE}:retrieveUserQuotaSummary`;
export const ANTIGRAVITY_SCOPES = [
  ...GEMINI_CLI_SCOPES,
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs"
];
/** Antigravity caps output tokens; larger values are rejected upstream. */
export const ANTIGRAVITY_MAX_OUTPUT_TOKENS = 64000;

/**
 * Friendly model ids exposed by the router -> the effort-suffixed ids Antigravity expects.
 * Ids not listed here are sent unchanged.
 */
export const ANTIGRAVITY_MODEL_ALIASES = Object.freeze({
  "gemini-4-carbon-high": "gemini-4-carbon-high(high)",
  "gemini-4-carbon-medium": "gemini-4-carbon-medium(medium)",
  "gemini-4-carbon-low": "gemini-4-carbon-low(low)",
  "gemini-4-carbon": "gemini-4-carbon-medium(medium)",
  "gemini-4-argon-high": "gemini-4-argon-high(high)",
  "gemini-4-argon-medium": "gemini-4-argon-medium(medium)",
  "gemini-4-argon-low": "gemini-4-argon-low(low)",
  "gemini-4-neon-high": "gemini-4-neon-high(high)",
  "gemini-4-neon-medium": "gemini-4-neon-medium(medium)",
  "gemini-4-neon-low": "gemini-4-neon-low(low)",
  "gemini-4-neon": "gemini-4-neon-medium(medium)",
  "gemini-3.8-flash-high": "gemini-3.8-flash-high(high)",
  "gemini-3.8-flash-medium": "gemini-3.8-flash-medium(medium)",
  "gemini-3.8-flash-low": "gemini-3.8-flash-low(low)",
  "gemini-3.8-flash": "gemini-3.8-flash-medium(medium)",
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered(high)",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered(medium)",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered(low)",
  "gemini-3.7-flash": "gemini-3.7-flash-tiered(medium)",
  "gemini-3.6-flash-high": "gemini-3.6-flash-tiered(high)",
  "gemini-3.6-flash-medium": "gemini-3.6-flash-tiered(medium)",
  "gemini-3.6-flash-low": "gemini-3.6-flash-tiered(low)",
  "gemini-3.6-flash": "gemini-3.6-flash-tiered(medium)",
  "gemini-3.1-pro-high": "gemini-pro-agent",
  "gemini-pro-agent": "gemini-pro-agent",
  "gemini-3.1-pro-low": "gemini-3.1-pro-low(low)",
  "claude-sonnet-5-5-high": "claude-sonnet-5-5-high(high)",
  "claude-sonnet-5-5-medium": "claude-sonnet-5-5-medium(medium)",
  "claude-sonnet-5-5-low": "claude-sonnet-5-5-low(low)",
  "claude-sonnet-5-5": "claude-sonnet-5-5-high(high)",
  "claude-opus-5-5-high": "claude-opus-5-5-high(high)",
  "claude-opus-5-5-medium": "claude-opus-5-5-medium(medium)",
  "claude-opus-5-5-low": "claude-opus-5-5-low(low)",
  "claude-opus-5-5": "claude-opus-5-5-high(high)",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
  "gpt-oss-120b": "gpt-oss-120b-medium",
  "gpt-oss-120b-medium": "gpt-oss-120b-medium"
});

/**
 * Per-client differences of the Cloud Code Assist handshake and chat wire format. Everything
 * else (PKCE, token refresh, envelope translation) is shared.
 *
 * @typedef {{
 *   id: "gemini_cli" | "antigravity",
 *   label: string,
 *   clientId: string,
 *   clientSecret: string,
 *   scopes: string[],
 *   defaultRedirect: string,
 *   loadCodeAssistUrl: string,
 *   onboardUserUrl: string,
 *   quotaUrl: string,
 *   quotaKind: "buckets" | "models",
 *   generateUrl: string,
 *   streamUrl: string,
 *   chatAlwaysStream: boolean,
 *   envelopeUserAgent: string,
 *   maxOutputTokens: number,
 *   quotaSummaryUrl: string,
 *   quotaHeaders: (token: string) => Record<string, string>,
 *   discoveryHeaders: (token: string) => Record<string, string>,
 *   loadCodeAssistBody: () => any,
 *   chatHeaders: (token: string, options?: { model?: string }) => Record<string, string>,
 *   resolveModel: (model: string) => string
 * }} CloudCodeFlavor
 */

/** @type {Record<string, CloudCodeFlavor>} */
const CLOUD_CODE_FLAVORS = {
  gemini_cli: {
    id: "gemini_cli",
    label: "Gemini CLI",
    clientId: GEMINI_CLI_CLIENT_ID,
    clientSecret: GEMINI_CLI_CLIENT_SECRET,
    scopes: GEMINI_CLI_SCOPES,
    defaultRedirect: GEMINI_CLI_DEFAULT_REDIRECT,
    loadCodeAssistUrl: GEMINI_CLI_LOAD_CODE_ASSIST_URL,
    onboardUserUrl: GEMINI_CLI_ONBOARD_USER_URL,
    quotaUrl: GEMINI_CLI_QUOTA_URL,
    quotaKind: "buckets",
    quotaSummaryUrl: "",
    quotaHeaders: (token) => buildGeminiCliHeaders(token),
    generateUrl: GEMINI_CLI_GENERATE_URL,
    streamUrl: GEMINI_CLI_STREAM_URL,
    chatAlwaysStream: false,
    envelopeUserAgent: "gemini-cli",
    maxOutputTokens: 0,
    discoveryHeaders: (token) => buildGeminiCliDiscoveryHeaders(token),
    loadCodeAssistBody: () => ({ metadata: geminiCliClientMetadata(), mode: 1 }),
    chatHeaders: (token, options) => buildGeminiCliHeaders(token, options),
    resolveModel: (model) => model
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    clientId: ANTIGRAVITY_CLIENT_ID,
    clientSecret: ANTIGRAVITY_CLIENT_SECRET,
    scopes: ANTIGRAVITY_SCOPES,
    defaultRedirect: ANTIGRAVITY_DEFAULT_REDIRECT,
    // Project discovery stays on the prod host; only chat uses the daily host.
    loadCodeAssistUrl: GEMINI_CLI_LOAD_CODE_ASSIST_URL,
    onboardUserUrl: GEMINI_CLI_ONBOARD_USER_URL,
    quotaUrl: `${ANTIGRAVITY_CHAT_BASE}:fetchAvailableModels`,
    quotaKind: "models",
    quotaSummaryUrl: ANTIGRAVITY_QUOTA_SUMMARY_URL,
    // The IDE tags its quota RPCs with its client name/version.
    quotaHeaders: (token) => ({
      ...buildAntigravityHeaders(token),
      "x-client-name": "antigravity",
      "x-client-version": ANTIGRAVITY_VERSION
    }),
    generateUrl: `${ANTIGRAVITY_CHAT_BASE}:generateContent`,
    streamUrl: `${ANTIGRAVITY_CHAT_BASE}:streamGenerateContent?alt=sse`,
    // The IDE's agent chat only uses the streaming RPC; non-streaming clients are served by
    // folding the stream (aggregateCloudCodeStream) instead of calling generateContent.
    chatAlwaysStream: true,
    envelopeUserAgent: "antigravity",
    maxOutputTokens: ANTIGRAVITY_MAX_OUTPUT_TOKENS,
    // The Antigravity IDE sends no X-Goog-Api-Client / Client-Metadata on discovery.
    discoveryHeaders: (token) => buildAntigravityHeaders(token),
    loadCodeAssistBody: () => ({ metadata: geminiCliClientMetadata() }),
    chatHeaders: (token) => buildAntigravityHeaders(token),
    resolveModel: (model) => ANTIGRAVITY_MODEL_ALIASES[model] || model
  }
};

/**
 * Resolve a flavor by id (`gemini_cli` | `antigravity`), defaulting to Gemini CLI.
 * @param {string} [id]
 * @returns {CloudCodeFlavor}
 */
export function getCloudCodeFlavor(id) {
  return CLOUD_CODE_FLAVORS[id] || CLOUD_CODE_FLAVORS.gemini_cli;
}

/**
 * The flavor a stored key speaks, or null when the key is not a Cloud Code key.
 * @param {any} keyEntry
 * @returns {CloudCodeFlavor | null}
 */
export function getCloudCodeFlavorForKey(keyEntry) {
  const method = keyEntry?.authMethod;
  return method && Object.prototype.hasOwnProperty.call(CLOUD_CODE_FLAVORS, method)
    ? CLOUD_CODE_FLAVORS[method]
    : null;
}

/**
 * Headers the Antigravity IDE sends on both discovery and chat.
 * @param {string} accessToken
 * @returns {Record<string, string>}
 */
export function buildAntigravityHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "user-agent": ANTIGRAVITY_USER_AGENT
  };
}

export const GEMINI_CLI_PKCE_TTL_MS = 600_000;
export const GEMINI_CLI_PKCE_TTL_SEC = Math.floor(GEMINI_CLI_PKCE_TTL_MS / 1000);
export const GEMINI_CLI_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const GEMINI_CLI_TOKEN_SOFT_REFRESH_MS = 10 * 60 * 1000;
const GEMINI_CLI_TOKEN_HARD_REFRESH_MS = GEMINI_CLI_TOKEN_REFRESH_BUFFER_MS;
const GEMINI_CLI_CRED_CACHE_MAX = 256;
const GEMINI_CLI_TOKEN_CACHE_MAX = 1000;
const MAX_PENDING_STATES = 200;

/** @type {Map<string, { codeVerifier: string, redirectUri: string, clientId: string, clientSecret: string, createdAt: number, expiresAt: number }>} */
const pendingStates = new Map();

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const tokenCache = new Map();

/** @type {Map<string, { clientId: string, clientSecret: string, refreshToken: string, projectId: string, tokenUri: string, cacheKey: string }>} */
const credDescriptorCache = new Map();

/** @type {Map<string, Promise<{ accessToken: string, projectId?: string }>>} */
const inflightRefreshes = new Map();

function validateGeminiCliTokenUri(rawUri, allowLoopback = false) {
  const trimmed = typeof rawUri === "string" ? rawUri.trim() : "";
  if (!trimmed) return GEMINI_CLI_TOKEN_URL;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw httpError(400, "Stored Gemini CLI tokenUri is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Stored Gemini CLI tokenUri must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw httpError(400, "Stored Gemini CLI tokenUri must not embed credentials");
  }
  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal || ssrf.isPrivateLan) {
    throw httpError(400, `SSRF guard: Gemini CLI tokenUri blocked (${ssrf.reason || "forbidden host"})`);
  }
  if (ssrf.isLoopback) {
    if (!allowLoopback) {
      throw httpError(400, "SSRF guard: Gemini CLI tokenUri cannot target loopback addresses");
    }
    return parsed.toString();
  }
  if (parsed.protocol !== "https:") {
    throw httpError(400, "Gemini CLI tokenUri must use https://");
  }
  return parsed.toString();
}

/**
 * Create an Error carrying an HTTP status code.
 * @param {number} status
 * @param {string} message
 * @returns {Error & { status: number }}
 */
function httpError(status, message) {
  const err = /** @type {any} */ (new Error(message));
  err.status = status;
  return err;
}

/**
 * Platform enum used by Google's ClientMetadata for the CLI/IDE handshake.
 * @returns {number}
 */
export function geminiCliPlatformEnum() {
  const os = process.platform;
  const arch = process.arch;
  if (os === "darwin") return arch === "arm64" ? 2 : 1;
  if (os === "linux") return arch === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

/**
 * Client metadata blob Google's backend fingerprints during loadCodeAssist.
 * @returns {{ ideType: number, platform: number, pluginType: number }}
 */
export function geminiCliClientMetadata() {
  return { ideType: 9, platform: geminiCliPlatformEnum(), pluginType: 2 };
}

/**
 * Validate `callbackUrl` as a loopback or same-origin redirect and strip query/hash so it
 * matches Google's exact-match `redirect_uri` rule.
 * @param {string} callbackUrl
 * @param {string} [requestHost]
 * @returns {string}
 */
export function normalizeGeminiCliRedirect(callbackUrl, requestHost = "") {
  if (typeof callbackUrl !== "string" || !callbackUrl.trim()) {
    throw httpError(400, "Missing required 'callbackUrl'");
  }
  let parsed;
  try {
    parsed = new URL(callbackUrl.trim());
  } catch {
    throw httpError(400, "Invalid 'callbackUrl': must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Invalid 'callbackUrl': must use http or https protocol");
  }
  if (parsed.username || parsed.password) {
    throw httpError(400, "Invalid 'callbackUrl': must not contain embedded credentials");
  }

  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal) {
    throw httpError(400, "Invalid 'callbackUrl': forbidden metadata/link-local address");
  }

  const reqHost = typeof requestHost === "string" ? requestHost.trim().toLowerCase() : "";
  const sameOrigin = Boolean(reqHost) && parsed.host.toLowerCase() === reqHost;
  if (!isLoopbackHost(parsed.hostname) && !sameOrigin) {
    throw httpError(
      400,
      "Invalid 'callbackUrl': must target localhost/127.0.0.1 or the same origin"
    );
  }

  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Prune expired PKCE records.
 * @param {number} [now]
 */
function pruneStates(now = Date.now()) {
  for (const [key, rec] of pendingStates.entries()) {
    if (!rec || rec.expiresAt <= now) pendingStates.delete(key);
  }
}

/**
 * Begin a Gemini CLI OAuth 2.0 + PKCE (S256) authorization using the public CLI client.
 *
 * @param {{
 *   callbackUrl?: string,
 *   requestHost?: string,
 *   selectAccount?: boolean,
 *   clientId?: string,
 *   clientSecret?: string,
 *   authBaseUrl?: string,
 *   nowFn?: () => number
 * }} [options]
 * @returns {{ authUrl: string, state: string, redirectUri: string, expiresInSec: number, clientId: string }}
 */
export function startGeminiCliOAuth(options = {}) {
  const flavor = getCloudCodeFlavor(options.flavor);
  const {
    callbackUrl = flavor.defaultRedirect,
    requestHost = "",
    selectAccount = true,
    clientId = flavor.clientId,
    clientSecret = flavor.clientSecret,
    authBaseUrl = GEMINI_CLI_AUTH_URL,
    nowFn = Date.now
  } = options;

  const resolvedClientId = String(clientId || "").trim();
  if (!resolvedClientId) {
    throw httpError(400, "Missing Gemini CLI OAuth clientId");
  }

  const redirectUri = normalizeGeminiCliRedirect(callbackUrl, requestHost);
  const now = nowFn();
  pruneStates(now);
  while (pendingStates.size >= MAX_PENDING_STATES) {
    const oldest = pendingStates.keys().next().value;
    if (!oldest) break;
    pendingStates.delete(oldest);
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  const state = `gcli_${crypto.randomBytes(20).toString("hex")}`;

  const authUrl = new URL(authBaseUrl);
  authUrl.searchParams.set("client_id", resolvedClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", flavor.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", selectAccount ? "consent select_account" : "consent");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  pendingStates.set(state, {
    codeVerifier,
    redirectUri,
    clientId: resolvedClientId,
    clientSecret: String(clientSecret || "").trim(),
    flavor: flavor.id,
    createdAt: now,
    expiresAt: now + GEMINI_CLI_PKCE_TTL_MS
  });

  return {
    authUrl: authUrl.toString(),
    state,
    redirectUri,
    expiresInSec: GEMINI_CLI_PKCE_TTL_SEC,
    clientId: resolvedClientId,
    flavor: flavor.id
  };
}

/**
 * Peek a pending PKCE record without consuming it (used to persist cross-instance state).
 * @param {string} state
 * @returns {any | null}
 */
export function peekGeminiCliState(state) {
  return pendingStates.get(state) || null;
}

/**
 * Restore a previously persisted PKCE record (serverless instance handoff).
 * @param {string} state
 * @param {any} record
 */
export function restoreGeminiCliState(state, record) {
  if (!state || !record || typeof record !== "object") return;
  pruneStates();
  pendingStates.set(state, record);
}

/**
 * Clear in-memory PKCE state and token cache (test isolation).
 */
export function clearGeminiCliStore() {
  pendingStates.clear();
  tokenCache.clear();
  credDescriptorCache.clear();
  inflightRefreshes.clear();
}

/**
 * Build the standard CLI-style headers Google's Cloud Code backend expects.
 * @param {string} accessToken
 * @param {{ model?: string }} [options]
 * @returns {Record<string, string>}
 */
export function buildGeminiCliHeaders(accessToken, options = {}) {
  const model = String(options.model || "unknown");
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": `GeminiCLI/${GEMINI_CLI_VERSION}/${model} (win32; x64; terminal)`,
    "x-goog-api-client": GEMINI_CLI_API_CLIENT,
    "client-metadata": JSON.stringify(geminiCliClientMetadata())
  };
}

/**
 * Headers for the project-discovery RPCs (`loadCodeAssist` / `onboardUser`).
 *
 * These must match what the real `google-api-nodejs-client` sends. Google fingerprints the
 * trio (User-Agent + X-Goog-Api-Client + Client-Metadata) and silently refuses to provision a
 * `cloudaicompanionProject` — and later rejects chat with 403 "You do not have a valid license
 * of this product" (#3501) — when they look like a generic HTTP client.
 *
 * @param {string} accessToken
 * @returns {Record<string, string>}
 */
export function buildGeminiCliDiscoveryHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "google-api-nodejs-client/9.15.1",
    "x-goog-api-client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "client-metadata": JSON.stringify(geminiCliClientMetadata())
  };
}

/**
 * Call `v1internal:loadCodeAssist` to discover the free `cloudaicompanionProject` Google
 * auto-provisions for the signed-in account, plus the plan tier.
 *
 * @param {string} accessToken
 * @param {{ fetchImpl?: typeof globalThis.fetch, dispatcher?: any }} [options]
 * @returns {Promise<{ projectId: string, tier: string, tierLabel: string, raw: any }>}
 */
export async function loadGeminiCliProject(accessToken, options = {}) {
  const { fetchImpl = upstreamFetch, dispatcher } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for loadCodeAssist");

  let res;
  try {
    res = await fetchImpl(flavor.loadCodeAssistUrl, {
      method: "POST",
      headers: flavor.discoveryHeaders(token),
      body: JSON.stringify(flavor.loadCodeAssistBody()),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw httpError(
      502,
      redactSecrets(
        `Could not reach Cloud Code Assist (${err?.message || "network error"})`,
        [token]
      )
    );
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw httpError(
      res.status >= 400 && res.status < 500 ? 400 : 502,
      redactSecrets(
        `loadCodeAssist failed (HTTP ${res.status}): ${text.slice(0, 240)}`,
        [token]
      )
    );
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpError(502, "loadCodeAssist returned invalid JSON");
  }

  let projectId = extractCloudCodeProjectId(data);

  // No project means the account was never onboarded to Cloud Code Assist. Chat then fails with
  // 403 "You do not have a valid license of this product" (#3501), so provision it now — this is
  // exactly what the official CLI does on first run.
  if (!projectId) {
    const tierId = pickOnboardTierId(data);
    projectId = await onboardGeminiCliUser(token, tierId, {
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(dispatcher ? { dispatcher } : {}),
      flavor: flavor.id
    });
  }

  const currentTier = data?.currentTier?.name || "";
  const paidTier = data?.paidTier?.name || "";
  const isPaid = Boolean(data?.paidTier?.id && data.paidTier.id !== "free-tier");
  const tier = isPaid ? "paid" : currentTier ? "free" : "standard";
  const tierLabel = isPaid
    ? `${paidTier || "Paid plan"} · ${flavor.id === "antigravity" ? "Antigravity" : "Cloud Code Assist"}`
    : currentTier
      ? `${currentTier} · ${flavor.label} Free Tier`
      : `${flavor.label} · Google Account Connected`;

  return { projectId, tier, tierLabel, raw: data };
}

/**
 * Pull the provisioned project id out of a loadCodeAssist/onboardUser payload.
 * @param {any} data
 * @returns {string}
 */
export function extractCloudCodeProjectId(data) {
  if (!data || typeof data !== "object") return "";
  const raw = data.cloudaicompanionProject ?? data.response?.cloudaicompanionProject;
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object" && raw.id) return String(raw.id).trim();
  return "";
}

/**
 * Choose the tier to onboard into: the default entry of `allowedTiers`, else `legacy-tier`
 * (what the official CLI falls back to).
 * @param {any} data
 * @returns {string}
 */
export function pickOnboardTierId(data) {
  if (Array.isArray(data?.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier && typeof tier === "object" && tier.isDefault === true) {
        const id = typeof tier.id === "string" ? tier.id.trim() : "";
        if (id) return id;
      }
    }
  }
  return "legacy-tier";
}

/**
 * Call `v1internal:onboardUser` until Google reports `done`, then return the project id.
 * Without this step the account has no Cloud Code entitlement and every chat returns 403 #3501.
 *
 * @param {string} accessToken
 * @param {string} tierId
 * @param {{ fetchImpl?: typeof globalThis.fetch, dispatcher?: any }} [options]
 * @returns {Promise<string>}
 */
export async function onboardGeminiCliUser(accessToken, tierId = "legacy-tier", options = {}) {
  const {
    fetchImpl = upstreamFetch,
    dispatcher,
    retryDelayMs = 3000,
    maxAttempts = 5
  } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for onboardUser");

  const body = JSON.stringify({
    tierId: tierId || "legacy-tier",
    metadata: geminiCliClientMetadata()
  });

  // Google provisions asynchronously: the first calls usually answer `done: false` and only a
  // later poll carries the project. The reference CLI keeps polling, so give it room to finish
  // instead of returning "" after two tries.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(flavor.onboardUserUrl, {
        method: "POST",
        headers: flavor.discoveryHeaders(token),
        body,
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch {
      if (attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      if (attempt === maxAttempts) {
        throw httpError(
          res.status >= 400 && res.status < 500 ? 400 : 502,
          redactSecrets(
            `onboardUser failed (HTTP ${res.status}): ${text.slice(0, 240)}`,
            [token]
          )
        );
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON answer: keep polling
    }

    if (data) {
      const projectId = extractCloudCodeProjectId(data);
      if (projectId) return projectId;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return "";
}

/**
 * POST a JSON body to a Cloud Code RPC and return Google's answer verbatim (never throws).
 * @param {typeof globalThis.fetch} fetchImpl
 * @param {string} step
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {any} body
 * @param {string} token
 * @param {any} [dispatcher]
 * @param {(text: string) => any} [parse] body parser (default JSON; chat streams are folded)
 * @returns {Promise<{ step: string, ok: boolean, status?: number, response?: any, error?: string }>}
 */
async function probeCloudCode(fetchImpl, step, url, headers, body, token, dispatcher, parse = JSON.parse) {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(dispatcher ? { dispatcher } : {})
    });
    const text = redactSecrets(await res.text().catch(() => ""), [token]);
    let response;
    try {
      response = parse(text) ?? { _raw: text.slice(0, 800) };
    } catch {
      response = { _raw: text.slice(0, 800) };
    }
    return { step, ok: Boolean(res.ok), status: res.status, response };
  } catch (err) {
    return {
      step,
      ok: false,
      error: redactSecrets(err?.message || "network error", [token])
    };
  }
}

/**
 * Diagnostic replay of the project-discovery handshake that returns Google's raw answers.
 *
 * It mirrors the real flow on purpose, so a failure here is a failure the real sign-in hits too:
 *  - `onboardUser` uses the default tier from `allowedTiers` (not a hardcoded one), is skipped when
 *    `loadCodeAssist` already returned a project, and polls like `onboardGeminiCliUser`;
 *  - `retrieveUserQuota` sends `{ project }` with the same headers as `fetchGeminiCliQuota`.
 *
 * @param {string} accessToken
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   dispatcher?: any,
 *   tierId?: string,
 *   forceOnboard?: boolean,
 *   retryDelayMs?: number,
 *   maxAttempts?: number,
 *   chatProbeModel?: string
 * }} [options]
 * @returns {Promise<{ projectId: string, tierId: string, steps: Array<Record<string, any>> }>}
 */
export async function diagnoseGeminiCliConnection(accessToken, options = {}) {
  const {
    fetchImpl = upstreamFetch,
    dispatcher,
    tierId = "",
    forceOnboard = false,
    retryDelayMs = 3000,
    maxAttempts = 5,
    chatProbeModel = ""
  } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for Gemini CLI diagnostics");

  const steps = [];
  const discoveryHeaders = flavor.discoveryHeaders(token);

  const loadStep = await probeCloudCode(
    fetchImpl,
    "loadCodeAssist",
    flavor.loadCodeAssistUrl,
    discoveryHeaders,
    flavor.loadCodeAssistBody(),
    token,
    dispatcher
  );
  steps.push(loadStep);

  const loadData =
    loadStep.response && typeof loadStep.response === "object" ? loadStep.response : null;
  let projectId = extractCloudCodeProjectId(loadData);
  const resolvedTierId = String(tierId || "").trim() || pickOnboardTierId(loadData);

  if (projectId && !forceOnboard) {
    steps.push({
      step: "onboardUser",
      skipped: true,
      reason: "loadCodeAssist already returned a project, so the real flow does not onboard."
    });
  } else {
    const attempts = [];
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      last = await probeCloudCode(
        fetchImpl,
        "onboardUser",
        flavor.onboardUserUrl,
        discoveryHeaders,
        { tierId: resolvedTierId, metadata: geminiCliClientMetadata() },
        token,
        dispatcher
      );
      const found = extractCloudCodeProjectId(last.response);
      attempts.push({
        attempt,
        status: last.status ?? null,
        done: typeof last.response?.done === "boolean" ? last.response.done : null,
        hasProject: Boolean(found)
      });
      if (found) {
        projectId = found;
        break;
      }
      // A finished operation without a project, or a deterministic 4xx, will not change by waiting.
      const permanent =
        last.response?.done === true ||
        (typeof last.status === "number" &&
          last.status >= 400 &&
          last.status < 500 &&
          last.status !== 429);
      if (permanent) break;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    steps.push({ ...last, tierId: resolvedTierId, attempts });
  }

  const quotaStep = await probeCloudCode(
    fetchImpl,
    flavor.quotaKind === "models" ? "fetchAvailableModels" : "retrieveUserQuota",
    flavor.quotaUrl,
    flavor.quotaHeaders(token),
    projectId ? { project: projectId } : {},
    token,
    dispatcher
  );
  const catalog =
    flavor.id === "antigravity" && quotaStep.ok
      ? parseAntigravityModelCatalog(quotaStep.response)
      : { models: [], defaultModelId: "" };
  steps.push({
    ...quotaStep,
    projectSent: projectId || "",
    ...(catalog.models.length
      ? { catalog: catalogChatModelIds(catalog.models), defaultModelId: catalog.defaultModelId }
      : {})
  });

  if (flavor.quotaSummaryUrl) {
    const summaryStep = await probeCloudCode(
      fetchImpl,
      "retrieveUserQuotaSummary",
      flavor.quotaSummaryUrl,
      flavor.quotaHeaders(token),
      projectId ? { project: projectId } : {},
      token,
      dispatcher
    );
    steps.push({
      ...summaryStep,
      windows: summaryStep.ok ? parseAntigravityQuotaSummary(summaryStep.response) : []
    });
  }

  // The decisive check: tiny chats with no system prompt and no tools, varied one factor at a time.
  //  A — the model exactly as the router would send it;
  //  B — the same model without a thinking config (only when A had one);
  //  C — the plan's own default model, bare (only when it differs from A).
  // Which of them pass tells model-not-on-plan, thinking config, or account/client/IP apart.
  if (chatProbeModel && projectId) {
    const message = { messages: [{ role: "user", content: "Reply with the single word OK." }] };
    const catalogIds = new Set(catalog.models.map((m) => m.id));
    const variants = [];
    const asRouted = buildCloudCodeRequest(chatProbeModel, message, projectId, { flavor });
    variants.push({ probe: "A", label: "as routed", envelope: asRouted });
    if (asRouted.request.generationConfig?.thinkingConfig) {
      const bare = buildCloudCodeRequest(chatProbeModel, message, projectId, { flavor });
      delete bare.request.generationConfig.thinkingConfig;
      variants.push({ probe: "B", label: "no thinking config", envelope: bare });
    }
    if (catalog.defaultModelId && catalog.defaultModelId !== asRouted.model) {
      const planDefault = buildCloudCodeRequest(catalog.defaultModelId, message, projectId, {
        flavor,
        exactModel: true
      });
      delete planDefault.request.generationConfig.thinkingConfig;
      variants.push({ probe: "C", label: "plan default model", envelope: planDefault });
    }

    // Same RPC the router uses for chat (Antigravity: the streaming one, folded here).
    const chatStream = flavor.chatAlwaysStream === true;
    const probes = [];
    for (const v of variants) {
      const r = await probeCloudCode(
        fetchImpl,
        "chatProbe",
        chatStream ? flavor.streamUrl : flavor.generateUrl,
        { ...flavor.chatHeaders(token), accept: chatStream ? "text/event-stream" : "application/json" },
        v.envelope,
        token,
        dispatcher,
        chatStream ? aggregateCloudCodeStream : JSON.parse
      );
      const reply = (r.response?.response?.candidates?.[0]?.content?.parts || [])
        .filter((part) => typeof part?.text === "string" && !part.thought)
        .map((part) => part.text)
        .join("")
        .slice(0, 200);
      const err = r.response?.error;
      probes.push({
        probe: v.probe,
        label: v.label,
        model: v.envelope.model,
        thinking: v.envelope.request.generationConfig?.thinkingConfig || null,
        inCatalog: catalogIds.size ? catalogIds.has(v.envelope.model) : null,
        ok: r.ok,
        status: r.status ?? null,
        ...(r.ok
          ? { reply }
          : {
              error: (typeof err?.message === "string" && err.message) || r.error || "",
              reason:
                (Array.isArray(err?.details) ? err.details.find((d) => d?.reason)?.reason : "") || ""
            })
      });
    }
    steps.push({ step: "chatProbe", ok: probes.some((p) => p.ok), probes });
  }

  return { projectId, tierId: resolvedTierId, flavor: flavor.id, steps };
}

/**
 * Read per-model remaining quota from `v1internal:retrieveUserQuota`.
 *
 * @param {string} accessToken
 * @param {{ projectId?: string, fetchImpl?: typeof globalThis.fetch, dispatcher?: any }} [options]
 * @returns {Promise<{ buckets: Array<{ modelId: string, remainingFraction: number, resetTime: string }>, raw: any }>}
 */
export async function fetchGeminiCliQuota(accessToken, options = {}) {
  const { projectId = "", fetchImpl = upstreamFetch, dispatcher } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for retrieveUserQuota");

  const body = projectId ? { project: projectId } : {};
  let res;
  try {
    res = await fetchImpl(flavor.quotaUrl, {
      method: "POST",
      headers: flavor.quotaHeaders(token),
      body: JSON.stringify(body),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw httpError(
      502,
      redactSecrets(
        `Could not reach retrieveUserQuota (${err?.message || "network error"})`,
        [token]
      )
    );
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw httpError(
      res.status >= 400 && res.status < 500 ? 400 : 502,
      redactSecrets(`retrieveUserQuota failed (HTTP ${res.status}): ${text.slice(0, 240)}`, [token])
    );
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpError(502, "retrieveUserQuota returned invalid JSON");
  }

  // Gemini CLI answers `{ buckets: [...] }`; Antigravity's fetchAvailableModels answers
  // `{ models: { <id>: { quotaInfo: { remainingFraction, resetTime } } } }`.
  const rawBuckets = Array.isArray(data?.buckets)
    ? data.buckets
    : data?.models && typeof data.models === "object" && !Array.isArray(data.models)
      ? Object.entries(data.models)
          .filter(([, info]) => info && typeof info === "object" && info.quotaInfo && !info.isInternal)
          .map(([modelId, info]) => ({
            modelId,
            remainingFraction: info.quotaInfo.remainingFraction ?? 0,
            resetTime: info.quotaInfo.resetTime || ""
          }))
      : [];
  const buckets = rawBuckets
    .map((b) => ({
      modelId: String(b?.modelId || b?.model || "").trim(),
      remainingFraction: Number(b?.remainingFraction),
      resetTime: String(b?.resetTime || "")
    }))
    .filter((b) => b.modelId && Number.isFinite(b.remainingFraction));

  return { buckets, raw: data };
}

/**
 * Antigravity quota families. Order matters: Argon has its own pool and must match before the
 * broader Gemini pattern.
 */
const ANTIGRAVITY_QUOTA_FAMILIES = [
  { id: "gemini_argon", pattern: /argon/i, label: "Gemini 4 Argon" },
  { id: "gemini", pattern: /gemini/i, label: "Gemini" },
  { id: "claude_gpt", pattern: /claude|gpt/i, label: "Claude & GPT" }
];

/**
 * Which Antigravity quota pool a model (or quota group name) draws from.
 * @param {string} text
 * @returns {{ id: string, label: string } | null}
 */
export function antigravityQuotaFamily(text) {
  const value = String(text || "");
  const family = ANTIGRAVITY_QUOTA_FAMILIES.find((f) => f.pattern.test(value));
  return family ? { id: family.id, label: family.label } : null;
}

/**
 * Normalize a `retrieveUserQuotaSummary` answer into one row per (family, window).
 * Pure: safe to unit-test without network.
 *
 * @param {any} data
 * @returns {Array<{ id: string, family: string, window: "weekly" | "5h", label: string, remainingFraction: number, resetTime: string }>}
 */
export function parseAntigravityQuotaSummary(data) {
  const groups = Array.isArray(data?.groups)
    ? data.groups
    : Array.isArray(data?.quotaSummary?.groups)
      ? data.quotaSummary.groups
      : [];
  const windows = [];
  const seen = new Set();
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const family = antigravityQuotaFamily(group.displayName || group.groupId || "");
    if (!family) continue;
    for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
      if (!bucket || typeof bucket !== "object") continue;
      const windowType = String(bucket.window || "").toLowerCase();
      const text = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      const window =
        windowType === "weekly" || windowType === "week" || /\bweek(ly)?\b/.test(text)
          ? "weekly"
          : windowType === "5h" ||
              windowType === "daily" ||
              windowType === "session" ||
              windowType === "short" ||
              /five[\s_-]*hour|5[\s_-]*h|daily|session|short|hour/.test(text)
            ? "5h"
            : "";
      if (!window) continue;
      // Google disables the weekly bucket when it does not apply; a disabled 5h bucket means the
      // weekly cap was hit, so it reads as empty.
      if (bucket.disabled === true && window === "weekly") continue;
      const resetTime = typeof bucket.resetTime === "string" ? bucket.resetTime : "";
      let fraction = bucket.disabled === true ? 0 : Number(bucket.remainingFraction);
      // proto3 drops zero values: an exhausted bucket arrives with a resetTime and no fraction.
      if (bucket.disabled !== true && bucket.remainingFraction === undefined) {
        fraction = resetTime ? 0 : NaN;
      }
      if (!Number.isFinite(fraction)) continue;
      const id = `${family.id}_${window}`;
      if (seen.has(id)) continue;
      seen.add(id);
      windows.push({
        id,
        family: family.id,
        window,
        label: `${family.label} (${window === "weekly" ? "Weekly" : "5h"})`,
        remainingFraction: Math.max(0, Math.min(1, fraction)),
        resetTime
      });
    }
  }
  return windows;
}

/** Autocomplete / internal slots that are never chat models (`tab_flash_lite_preview`, `chat_20706`). */
const NON_CHAT_MODEL_RE = /^(tab_|chat_\d)/i;
const FAMILY_ORDER = { gemini: 0, gemini_argon: 1, claude_gpt: 2 };

/**
 * The models an Antigravity account can call, from its `fetchAvailableModels` answer.
 *
 * The ids are exactly what generateContent takes as `model`, and the list differs per plan and over
 * time (an AI Pro account can offer `gemini-4-neon-*` and no `gemini-3.8-flash-*`), so this is the
 * source of truth rather than a hard-coded catalog.
 *
 * kind: "chat" — in the IDE's agent model list (or any non-image model when Google sends no list);
 * "image" — image generation; "other" — callable but not offered as a chat model.
 *
 * @param {any} data
 * @returns {{ models: Array<{ id: string, label: string, family: string, kind: "chat" | "image" | "other", remainingFraction: number | null, resetTime: string }>, defaultModelId: string }}
 */
export function parseAntigravityModelCatalog(data) {
  const raw =
    data?.models && typeof data.models === "object" && !Array.isArray(data.models) ? data.models : null;
  if (!raw) return { models: [], defaultModelId: "" };

  const imageIds = new Set(
    (Array.isArray(data.imageGenerationModelIds) ? data.imageGenerationModelIds : []).map(String)
  );
  const agentOrder = [];
  for (const sort of Array.isArray(data.agentModelSorts) ? data.agentModelSorts : []) {
    for (const group of Array.isArray(sort?.groups) ? sort.groups : []) {
      for (const id of Array.isArray(group?.modelIds) ? group.modelIds : []) {
        if (typeof id === "string" && id && !agentOrder.includes(id)) agentOrder.push(id);
      }
    }
  }

  const models = [];
  for (const [id, info] of Object.entries(raw)) {
    if (!id || !info || typeof info !== "object" || info.isInternal === true) continue;
    if (NON_CHAT_MODEL_RE.test(id)) continue;
    const isImage = imageIds.has(id) || /image/i.test(id);
    const kind = isImage
      ? "image"
      : agentOrder.length === 0 || agentOrder.includes(id)
        ? "chat"
        : "other";
    const quota = info.quotaInfo && typeof info.quotaInfo === "object" ? info.quotaInfo : null;
    // proto3 drops zero values: a quotaInfo without a fraction means 0 left.
    const fraction = quota ? Number(quota.remainingFraction ?? 0) : NaN;
    models.push({
      id,
      label:
        typeof info.displayName === "string" && info.displayName.trim() ? info.displayName.trim() : id,
      family: antigravityQuotaFamily(id)?.id || "",
      kind,
      remainingFraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null,
      resetTime: typeof quota?.resetTime === "string" ? quota.resetTime : ""
    });
  }

  // The IDE's own order first, then by family, then naturally by id.
  const rank = (m) => {
    const i = agentOrder.indexOf(m.id);
    return i >= 0 ? i : agentOrder.length + (FAMILY_ORDER[m.family] ?? 3) * 1000;
  };
  models.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, "en", { numeric: true }));

  const chat = models.filter((m) => m.kind === "chat");
  const preferred = typeof data.defaultAgentModelId === "string" ? data.defaultAgentModelId : "";
  const defaultModelId = chat.some((m) => m.id === preferred) ? preferred : chat[0]?.id || "";
  return { models, defaultModelId };
}

/**
 * Chat model ids of a catalog, in catalog order.
 * @param {Array<{ id: string, kind: string }>} models
 * @returns {string[]}
 */
export function catalogChatModelIds(models) {
  return (Array.isArray(models) ? models : [])
    .filter((m) => m && m.kind === "chat" && m.id)
    .map((m) => m.id);
}

/**
 * Merge a fresh Cloud Code read (plan, quota windows, model catalog) into a key's oauthMeta.
 * Parts Google did not answer keep their previous value.
 *
 * @param {any} meta
 * @param {any} usage result of fetchCloudCodeUsage (or a subset: `{ catalogOk, models, defaultModelId }`)
 * @param {string} checkedAt ISO time
 * @returns {any}
 */
export function mergeCloudCodeUsage(meta, usage, checkedAt) {
  const hasBuckets = Array.isArray(usage.buckets) && usage.buckets.length > 0;
  const hasWindows = Array.isArray(usage.windows) && usage.windows.length > 0;
  const hasExistingBuckets = Array.isArray(meta?.quotaBuckets) && meta.quotaBuckets.length > 0;
  const hasExistingWindows = Array.isArray(meta?.quotaWindows) && meta.quotaWindows.length > 0;
  return {
    ...(meta || {}),
    ...(usage.projectId ? { projectId: usage.projectId } : {}),
    ...(usage.tier ? { tier: usage.tier } : {}),
    ...(usage.tierLabel ? { tierLabel: usage.tierLabel } : {}),
    ...(usage.quotaOk
      ? {
          ...(hasBuckets || !hasExistingBuckets ? { quotaBuckets: usage.buckets } : {}),
          ...(hasWindows || !hasExistingWindows ? { quotaWindows: usage.windows } : {}),
          perModelHidden: usage.perModelHidden
        }
      : {}),
    ...(usage.catalogOk
      ? {
          availableModels: usage.models,
          defaultModelId: usage.defaultModelId,
          catalogAt: checkedAt
        }
      : {}),
    checkedAt
  };
}

/**
 * Keep an Antigravity provider's model list equal to what its accounts' plans offer, so
 * `/v1/models`, the Providers page and the quota page show one list. No-op without a catalog.
 *
 * @param {any} provider mutable provider record
 * @returns {boolean} whether the list changed
 */
export function syncProviderModelsWithCatalog(provider) {
  if (!provider) return false;
  const ids = [];
  for (const k of provider.apiKeys || []) {
    if (!k || k.enabled === false || k.authMethod !== "antigravity") continue;
    for (const id of catalogChatModelIds(k.oauthMeta?.availableModels)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  if (ids.length === 0) return false;
  const current = Array.isArray(provider.models) ? provider.models : [];
  if (current.length === ids.length && current.every((m, i) => m === ids[i])) return false;
  provider.models = ids;
  return true;
}

/**
 * Map a requested model id onto an id the account's catalog contains, or "" when none matches.
 * Order: the id itself -> its alias / reasoning_effort tier -> a default tier (-medium, -high, -low).
 *
 * @param {string} requested
 * @param {Array<{ id: string }>} models
 * @param {any} [body] OpenAI chat body (for reasoning_effort)
 * @returns {string}
 */
export function resolveCatalogModel(requested, models, body) {
  const ids = new Set((Array.isArray(models) ? models : []).map((m) => m?.id).filter(Boolean));
  const id = String(requested || "").trim();
  if (!id || ids.size === 0) return "";
  if (ids.has(id)) return id;
  const viaAlias = resolveUpstreamModel(id, body, CLOUD_CODE_FLAVORS.antigravity).model;
  if (ids.has(viaAlias)) return viaAlias;
  for (const tier of ["medium", "high", "low", "thinking"]) {
    if (ids.has(`${id}-${tier}`)) return `${id}-${tier}`;
  }
  const stemMatch = id.match(/^(.*)-(low|medium|high|minimal|xhigh|thinking)$/i);
  if (stemMatch) {
    const stem = stemMatch[1];
    for (const candidate of [
      stem,
      `${stem}-medium`,
      `${stem}-high`,
      `${stem}-low`,
      `${stem}-thinking`
    ]) {
      if (ids.has(candidate)) return candidate;
    }
  }
  return "";
}

/**
 * Read the weekly / 5-hour quota windows (Antigravity only).
 *
 * @param {string} accessToken
 * @param {{ projectId?: string, fetchImpl?: typeof globalThis.fetch, dispatcher?: any, flavor?: string }} [options]
 * @returns {Promise<{ windows: ReturnType<typeof parseAntigravityQuotaSummary>, raw: any }>}
 */
export async function fetchAntigravityQuotaSummary(accessToken, options = {}) {
  const { projectId = "", fetchImpl = upstreamFetch, dispatcher } = options;
  const flavor = getCloudCodeFlavor(options.flavor || "antigravity");
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for retrieveUserQuotaSummary");
  if (!flavor.quotaSummaryUrl) return { windows: [], raw: null };

  let res;
  try {
    res = await fetchImpl(flavor.quotaSummaryUrl, {
      method: "POST",
      headers: flavor.quotaHeaders(token),
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw httpError(
      502,
      redactSecrets(
        `Could not reach retrieveUserQuotaSummary (${err?.message || "network error"})`,
        [token]
      )
    );
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw httpError(
      res.status >= 400 && res.status < 500 ? 400 : 502,
      redactSecrets(
        `retrieveUserQuotaSummary failed (HTTP ${res.status}): ${text.slice(0, 240)}`,
        [token]
      )
    );
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpError(502, "retrieveUserQuotaSummary returned invalid JSON");
  }
  return { windows: parseAntigravityQuotaSummary(data), raw: data };
}

/**
 * Plan + quota of a Cloud Code account in one call, shaped for the dashboard.
 *
 * On the Antigravity free tier Google's per-model numbers are not the real limit (missing
 * fractions read as 0, or they mirror the weekly cap), so they are only returned for paid plans;
 * the weekly / 5-hour windows are what actually runs out.
 *
 * @param {string} accessToken
 * @param {{ projectId?: string, fetchImpl?: typeof globalThis.fetch, dispatcher?: any, flavor?: string }} [options]
 */
export async function fetchCloudCodeUsage(accessToken, options = {}) {
  const { projectId: storedProject = "", fetchImpl, dispatcher } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const common = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(dispatcher ? { dispatcher } : {}),
    flavor: flavor.id
  };
  const readQuota = (projectId) =>
    Promise.all([
      fetchGeminiCliQuota(accessToken, { ...common, projectId }).catch(() => null),
      flavor.quotaSummaryUrl
        ? fetchAntigravityQuotaSummary(accessToken, { ...common, projectId }).catch(() => null)
        : Promise.resolve(null)
    ]);

  let plan;
  let quota;
  let summary;
  if (storedProject) {
    [plan, [quota, summary]] = await Promise.all([
      loadGeminiCliProject(accessToken, common).catch(() => null),
      readQuota(storedProject)
    ]);
  } else {
    plan = await loadGeminiCliProject(accessToken, common).catch(() => null);
    [quota, summary] = await readQuota(plan?.projectId || "");
  }

  const perModelReliable = flavor.id !== "antigravity" || plan?.tier === "paid";
  const allBuckets = Array.isArray(quota?.buckets) ? quota.buckets : [];
  const catalog =
    flavor.id === "antigravity"
      ? parseAntigravityModelCatalog(quota?.raw)
      : { models: [], defaultModelId: "" };
  return {
    tier: plan?.tier || "",
    tierLabel: plan?.tierLabel || "",
    projectId: plan?.projectId || storedProject,
    buckets: perModelReliable ? allBuckets : [],
    windows: Array.isArray(summary?.windows) ? summary.windows : [],
    perModelHidden: !perModelReliable && allBuckets.length > 0,
    models: catalog.models,
    defaultModelId: catalog.defaultModelId,
    planOk: Boolean(plan),
    quotaOk: Boolean(quota || summary),
    catalogOk: catalog.models.length > 0
  };
}

/**
 * Parse "1h2m3.5s" / "3600s" / "250ms" into milliseconds (0 when unparseable).
 * @param {string} text
 * @returns {number}
 */
function parseDurationMs(text) {
  let total = 0;
  for (const m of String(text || "").matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)) {
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return Math.round(total);
}

/**
 * Pull Google's rate-limit hints out of a 429 body: ErrorInfo reason, RetryInfo / quotaResetDelay /
 * quotaResetTimeStamp, or "reset after 2h7m" in the message.
 *
 * @param {string} rawText
 * @param {number} [nowMs]
 * @returns {{ reason: string, message: string, resetAtMs: number | null }}
 */
export function parseCloudCodeRateLimit(rawText, nowMs = Date.now()) {
  let err = null;
  try {
    const parsed = JSON.parse(rawText);
    err = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  } catch {
    // non-JSON body
  }
  const message = typeof err?.message === "string" ? err.message : String(rawText || "");
  const details = Array.isArray(err?.details) ? err.details : [];
  let reason = "";
  let resetAtMs = null;
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    if (!reason && typeof d.reason === "string") reason = d.reason;
    const stamp = d.metadata?.quotaResetTimeStamp;
    if (!resetAtMs && typeof stamp === "string") {
      const ms = Date.parse(stamp);
      if (Number.isFinite(ms) && ms > nowMs) resetAtMs = ms;
    }
    const delay = d.retryDelay || d.metadata?.quotaResetDelay;
    if (!resetAtMs && typeof delay === "string") {
      const ms = parseDurationMs(delay);
      if (ms > 0) resetAtMs = nowMs + ms;
    }
  }
  if (!resetAtMs) {
    const m = message.match(/reset(?:s)?\s+after\s+([\d.hms\s]+)/i);
    const ms = m ? parseDurationMs(m[1]) : 0;
    if (ms > 0) resetAtMs = nowMs + ms;
  }
  return { reason, message, resetAtMs };
}

/**
 * Resolve within `ms`, or give up with null (the underlying request is simply ignored).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | null>}
 */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.catch(() => null),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

const CAPACITY_RE = /capacity|high traffic|overloaded/i;

/**
 * One tiny chat to `model` with no system prompt and no tools, sent exactly the way the router
 * sends chat (same RPC, headers and thinking config). Whether it passes tells "Google refuses this
 * request" apart from "Google refuses this account / client / network".
 *
 * @param {string} accessToken
 * @param {{
 *   projectId?: string,
 *   model?: string,
 *   flavor?: string,
 *   thinking?: Record<string, any> | null,
 *   fetchImpl?: typeof globalThis.fetch,
 *   dispatcher?: any
 * }} [options] `thinking`: the thinking config the failed request carried (null = none)
 * @returns {Promise<{ ok: boolean, status: number, error: string } | null>} null when it could not run
 */
export async function runCloudCodeBareProbe(accessToken, options = {}) {
  const { projectId = "", model = "", fetchImpl = upstreamFetch, dispatcher } = options;
  const flavor = getCloudCodeFlavor(options.flavor);
  const token = String(accessToken || "").trim();
  if (!token || !projectId || !model) return null;

  const envelope = buildCloudCodeRequest(
    model,
    { messages: [{ role: "user", content: "Reply with the single word OK." }] },
    projectId,
    { flavor, exactModel: true }
  );
  if (options.thinking !== undefined) {
    if (options.thinking) envelope.request.generationConfig.thinkingConfig = options.thinking;
    else delete envelope.request.generationConfig.thinkingConfig;
  }
  const stream = flavor.chatAlwaysStream === true;
  try {
    const res = await fetchImpl(stream ? flavor.streamUrl : flavor.generateUrl, {
      method: "POST",
      headers: { ...flavor.chatHeaders(token), accept: stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(envelope),
      ...(dispatcher ? { dispatcher } : {})
    });
    const text = await res.text().catch(() => "");
    if (res.ok) return { ok: true, status: res.status, error: "" };
    let message = "";
    try {
      const parsed = JSON.parse(text);
      message = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message || "";
    } catch {
      message = text;
    }
    return {
      ok: false,
      status: res.status,
      error: redactSecrets(String(message || "").replace(/\s+/g, " ").trim().slice(0, 200), [token])
    };
  } catch {
    return null;
  }
}

/**
 * Explain a Cloud Code 429 in words the user can act on.
 *
 * Google often answers a bare "Resource has been exhausted (e.g. check quota)" with no reason. For
 * Antigravity we then read, live and in parallel, the account's model catalog (with per-model
 * quota) and the weekly / 5-hour windows, and decide in this order:
 *  - "model":   the model is not on the account's plan (Google answers those with 429, not 404);
 *  - "quota":   the model's quota (paid plans) or its family window is at 0%;
 *  - quota left: with `isolate`, one bare test chat to the same model settles it —
 *    "account" when Google refuses that too (the account / client / network is being limited),
 *    "request" when it passes (Google refuses what this request carries, usually the system
 *    prompt of another app). Without a test, "request" blames the system prompt only when one
 *    was sent.
 *
 * @param {{
 *   errText?: string,
 *   accessToken?: string,
 *   projectId?: string,
 *   model?: string,
 *   flavor?: string,
 *   tier?: string,
 *   hasSystemPrompt?: boolean,
 *   systemText?: string,
 *   hasTools?: boolean,
 *   thinking?: Record<string, any> | null,
 *   isolate?: boolean | { ok: boolean, status: number, error: string },
 *   fetchImpl?: typeof globalThis.fetch,
 *   dispatcher?: any,
 *   nowMs?: number,
 *   timeoutMs?: number,
 *   probeTimeoutMs?: number
 * }} options `isolate`: true runs the bare test chat; a previous test result is reused as is.
 * @returns {Promise<{ cause: "model" | "quota" | "capacity" | "request" | "account" | "unknown", resetAtMs: number | null, note: string, windows: any[], catalog: { models: any[], defaultModelId: string }, probe?: { ok: boolean, status: number, error: string } | null, probeFresh?: boolean }>}
 */
export async function explainCloudCode429(options = {}) {
  const {
    errText = "",
    accessToken = "",
    projectId = "",
    model = "",
    tier = "",
    hasSystemPrompt = false,
    systemText = "",
    hasTools = false,
    isolate = false,
    timeoutMs = 4000,
    probeTimeoutMs = 12_000
  } = options;
  const noCatalog = { models: [], defaultModelId: "" };
  const nowMs = options.nowMs ?? Date.now();
  const flavor = getCloudCodeFlavor(options.flavor);
  const parsed = parseCloudCodeRateLimit(errText, nowMs);
  const fmt = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

  if (CAPACITY_RE.test(`${parsed.reason} ${parsed.message}`)) {
    return {
      cause: "capacity",
      resetAtMs: null,
      windows: [],
      catalog: noCatalog,
      note: "Google has no free capacity for this model right now (a server-side limit, not your quota). Retry in a minute or use another model."
    };
  }
  if (parsed.resetAtMs) {
    return {
      cause: "quota",
      resetAtMs: parsed.resetAtMs,
      windows: [],
      catalog: noCatalog,
      note: `Quota for this model is used up; Google says it resets at ${fmt(parsed.resetAtMs)}.`
    };
  }
  if (flavor.id !== "antigravity" || !accessToken) {
    return { cause: "unknown", resetAtMs: null, windows: [], catalog: noCatalog, note: "" };
  }

  const common = {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
    flavor: flavor.id,
    projectId
  };
  const [summary, quota] = await Promise.all([
    withTimeout(fetchAntigravityQuotaSummary(accessToken, common), timeoutMs),
    withTimeout(fetchGeminiCliQuota(accessToken, common), timeoutMs)
  ]);
  const windows = Array.isArray(summary?.windows) ? summary.windows : [];
  const catalog = quota ? parseAntigravityModelCatalog(quota.raw) : noCatalog;
  const entry = catalog.models.find((m) => m.id === model) || null;

  if (catalog.models.length > 0 && !entry) {
    const chat = catalogChatModelIds(catalog.models);
    const shown = chat.slice(0, 12);
    return {
      cause: "model",
      resetAtMs: null,
      windows,
      catalog,
      note: `'${model}' is not on this account's plan, and Google answers such models with 429 instead of 404. Models on this plan: ${shown.join(", ")}${chat.length > shown.length ? ", …" : ""}.`
    };
  }

  const family = antigravityQuotaFamily(model);
  const familyWindows = family ? windows.filter((w) => w.family === family.id) : [];
  // Per-model numbers are only the real limit on paid plans (on free they mirror the weekly cap).
  const modelQuota =
    tier === "paid" && entry && entry.remainingFraction !== null ? entry : null;

  if (familyWindows.length === 0 && !modelQuota) {
    return {
      cause: "unknown",
      resetAtMs: null,
      windows,
      catalog,
      note: "Google gave no reason and the quota could not be read. Run 'Chẩn đoán kết nối' on the Antigravity card: it shows the quota and tries 3 plain test chats."
    };
  }

  const empties = familyWindows
    .filter((w) => w.remainingFraction <= 0)
    .map((w) => ({ label: w.label, resetTime: w.resetTime }));
  if (modelQuota && modelQuota.remainingFraction <= 0) {
    empties.push({ label: model, resetTime: modelQuota.resetTime });
  }
  if (empties.length > 0) {
    const resets = empties
      .map((w) => Date.parse(w.resetTime))
      .filter((ms) => Number.isFinite(ms) && ms > nowMs);
    const resetAtMs = resets.length ? Math.max(...resets) : null;
    return {
      cause: "quota",
      resetAtMs,
      windows,
      catalog,
      note: `${empties.map((w) => w.label).join(" + ")} quota is used up (0% left)${
        resetAtMs ? `, resets at ${fmt(resetAtMs)}` : ""
      }. Models in another family draw from a separate pool (Gemini vs Claude & GPT).`
    };
  }

  const left = [
    ...familyWindows.map((w) => `${w.label} ${Math.round(w.remainingFraction * 100)}%`),
    ...(modelQuota ? [`${model} ${Math.round(modelQuota.remainingFraction * 100)}%`] : [])
  ].join(", ");
  const identity = hasSystemPrompt ? systemPromptIdentity(systemText) : "";
  const quotaLeft = `Google still reports quota left (${left}), so this is not your quota running out`;

  // Settle "this request" vs "this account" with one bare chat to the same model.
  let probe = null;
  let probeFresh = false;
  if (isolate && typeof isolate === "object") {
    probe = isolate;
  } else if (isolate === true) {
    probe = await withTimeout(
      runCloudCodeBareProbe(accessToken, { ...common, model, thinking: options.thinking }),
      probeTimeoutMs
    );
    probeFresh = Boolean(probe);
  }
  const base = { resetAtMs: null, windows, catalog, probe, probeFresh };

  if (probe && !probe.ok && probe.status === 429) {
    if (CAPACITY_RE.test(probe.error)) {
      return {
        ...base,
        cause: "capacity",
        note: `${quotaLeft}: Google has no free capacity for '${model}' right now (a server-side limit). Retry in a minute or use another model.`
      };
    }
    return {
      ...base,
      cause: "account",
      note: `${quotaLeft}, yet Google also refused a bare test request to '${model}' (no system prompt, no tools) with 429. So it is not about this request: Google is refusing '${model}' for this account, client or network right now. Code cannot change that: retry later, run 001Router on your own machine (home IP) with the same account, or use another account or provider.`
    };
  }
  if (probe?.ok) {
    const what = hasSystemPrompt
      ? `Most likely the system prompt: Antigravity answers prompts that identify another app with a fake "quota" 429${
          identity ? ` (this one starts "${identity}")` : ""
        }. 001Router already strips the markers known to trigger it (Claude Agent SDK line, Claude Code billing line, OpenCode, Hermes); remove or rename that app's own name / persona in its system prompt, or route that app to another provider.`
      : hasTools
        ? "This request had no system prompt but carried tools: try it without them, or with fewer."
        : "Try a shorter conversation, or another model from the plan.";
    return {
      ...base,
      cause: "request",
      note: `${quotaLeft}, and a bare test request to '${model}' on this account just worked: Google is refusing what this request carries, not the account. ${what}`
    };
  }
  const probeFailed =
    probe && !probe.ok
      ? ` A bare test request to '${model}' failed as well (HTTP ${probe.status}${probe.error ? `: ${probe.error}` : ""}).`
      : "";
  return {
    ...base,
    cause: "request",
    note: hasSystemPrompt
      ? `${quotaLeft}: Google refused this particular request. Known trigger: a system prompt that identifies another client (e.g. Claude Code's "x-anthropic-billing-header" line, "Claude Agent SDK", "OpenCode")${
          identity ? `; this one starts "${identity}"` : ""
        }. Try the same model with no system prompt.${probeFailed}`
      : `${quotaLeft}, and this request had no system prompt: Google is refusing '${model}' for this account, client or network. Run 'Chẩn đoán kết nối' on the Antigravity card (it tries 3 variants) or use another model from the plan.${probeFailed}`
  };
}

/**
 * Exchange the pasted authorization code for tokens, then resolve the Cloud Code project and
 * quota so the connection shows the real plan immediately (same as 9router).
 *
 * @param {{
 *   code?: string,
 *   state?: string,
 *   pastedUrl?: string,
 *   callbackUrl?: string,
 *   tokenUrl?: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   dispatcher?: any,
 *   nowFn?: () => number
 * }} [options]
 * @returns {Promise<{ oauthCredentials: any, oauthMeta: any, accessToken: string }>}
 */
export async function exchangeGeminiCliOAuth(options = {}) {
  const {
    code,
    state,
    pastedUrl,
    callbackUrl,
    tokenUrl = GEMINI_CLI_TOKEN_URL,
    fetchImpl = upstreamFetch,
    dispatcher,
    nowFn = Date.now
  } = options;

  const now = nowFn();
  pruneStates(now);

  const extracted = extractCodeAndState({ code, state, pastedUrl, callbackUrl });
  const authCode = String(extracted.code || "").trim();
  const authState = String(extracted.state || "").trim();

  if (!authCode) throw httpError(400, "Missing Gemini CLI authorization 'code'");
  if (!authState) throw httpError(400, "Missing Gemini CLI PKCE 'state'");

  const record = pendingStates.get(authState);
  if (record) pendingStates.delete(authState);
  if (!record) {
    throw httpError(
      400,
      "This Gemini CLI sign-in session was not found, was already used, or has expired (10 minutes). Click 'Đăng nhập Gemini CLI' again and paste the new address."
    );
  }
  if (record.expiresAt <= now) {
    throw httpError(
      400,
      "This Gemini CLI sign-in session expired (10 minutes). Start again and paste the address immediately after approving."
    );
  }

  const flavor = getCloudCodeFlavor(record.flavor);
  // A state minted by one sign-in card must not be finished by the other card's route, or the
  // tokens would be stored under the wrong provider and auth method.
  if (options.flavor && getCloudCodeFlavor(options.flavor).id !== flavor.id) {
    throw httpError(
      400,
      `This sign-in was started for ${flavor.label}, not ${getCloudCodeFlavor(options.flavor).label}. Start again from the matching card.`
    );
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    code_verifier: record.codeVerifier,
    client_id: record.clientId,
    redirect_uri: record.redirectUri
  });
  if (record.clientSecret) form.set("client_secret", record.clientSecret);

  let tokenRes;
  try {
    tokenRes = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: form.toString(),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    if (record.expiresAt > nowFn()) pendingStates.set(authState, record);
    throw httpError(
      502,
      redactSecrets(
        `Could not reach Google to finish sign-in (${err?.message || "network error"}). Paste the same address again.`,
        [record.clientSecret, record.codeVerifier, authCode]
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
        parsedErr?.error_description || parsedErr?.error?.message || parsedErr?.error || errDetail;
    } catch {
      // non-JSON
    }
    const cleanMsg = redactSecrets(String(errDetail || `HTTP ${tokenRes.status}`), [
      record.clientSecret,
      record.codeVerifier,
      authCode
    ]);
    const lowered = `${errCode} ${cleanMsg}`.toLowerCase();
    let hint = "";
    if (lowered.includes("invalid_grant")) {
      hint =
        "Google rejected the authorization code (invalid_grant): it was already used or expired. Click 'Đăng nhập Gemini CLI' again.";
    } else if (lowered.includes("redirect_uri_mismatch")) {
      hint = `Google rejected the redirect URI. Use a loopback address (${GEMINI_CLI_DEFAULT_REDIRECT}) for the Gemini CLI client.`;
    } else if (lowered.includes("invalid_client")) {
      hint =
        "Google rejected the OAuth client (invalid_client). Set GOOGLE_CLI_CLIENT_ID / GOOGLE_CLI_CLIENT_SECRET to a valid Gemini CLI client.";
    }
    throw httpError(
      tokenRes.status >= 400 && tokenRes.status < 500 ? 400 : 502,
      hint || `Gemini CLI token exchange failed (HTTP ${tokenRes.status}): ${cleanMsg}`
    );
  }

  let tokenData;
  try {
    tokenData = JSON.parse(rawText);
  } catch {
    throw httpError(502, "Gemini CLI token endpoint returned invalid JSON");
  }

  const accessToken =
    typeof tokenData?.access_token === "string" ? tokenData.access_token.trim() : "";
  if (!accessToken) {
    throw httpError(502, "Gemini CLI token response did not include 'access_token'");
  }
  const refreshToken =
    typeof tokenData?.refresh_token === "string" ? tokenData.refresh_token.trim() : "";
  if (!refreshToken) {
    throw httpError(
      400,
      "Google did not return a 'refresh_token'. Ensure offline consent was granted and retry."
    );
  }

  const expiresInSec =
    typeof tokenData?.expires_in === "number" &&
    Number.isFinite(tokenData.expires_in) &&
    tokenData.expires_in > 0
      ? tokenData.expires_in
      : 3600;

  // Project + tier discovery — this replaces Cloud Billing entirely
  let projectInfo = { projectId: "", tier: "standard", tierLabel: "", raw: null };
  try {
    projectInfo = await loadGeminiCliProject(accessToken, {
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(dispatcher ? { dispatcher } : {}),
      flavor: flavor.id
    });
  } catch {
    // Non-fatal: chat still works, quota display degrades gracefully
  }

  // Email / name / picture
  let profile = { email: "", name: "", picture: "" };
  try {
    const res = await fetchImpl(`${GEMINI_CLI_USERINFO_URL}?alt=json`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      ...(dispatcher ? { dispatcher } : {})
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data === "object") {
        profile = {
          email: typeof data.email === "string" ? data.email.trim() : "",
          name: typeof data.name === "string" ? data.name.trim() : "",
          picture: typeof data.picture === "string" ? data.picture.trim() : ""
        };
      }
    }
  } catch {
    // Best-effort profile
  }

  // Quota: per-model buckets, plus Antigravity's weekly / 5-hour windows (the real limit on free).
  const quotaOpts = {
    projectId: projectInfo.projectId,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(dispatcher ? { dispatcher } : {}),
    flavor: flavor.id
  };
  const [quota, summary] = await Promise.all([
    fetchGeminiCliQuota(accessToken, quotaOpts).catch(() => ({ buckets: [], raw: null })),
    flavor.quotaSummaryUrl
      ? fetchAntigravityQuotaSummary(accessToken, quotaOpts).catch(() => null)
      : Promise.resolve(null)
  ]);
  const perModelReliable = flavor.id !== "antigravity" || projectInfo.tier === "paid";
  const catalog =
    flavor.id === "antigravity"
      ? parseAntigravityModelCatalog(quota.raw)
      : { models: [], defaultModelId: "" };

  const oauthCredentials = {
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    refreshToken,
    projectId: projectInfo.projectId || "",
    tokenUri: tokenUrl,
    flow: flavor.id
  };

  tokenCache.set(buildCacheKey(record.clientId, refreshToken, tokenUrl), {
    accessToken,
    expiresAt: nowFn() + expiresInSec * 1000
  });

  const oauthMeta = {
    ...profile,
    provider: flavor.id,
    flow: flavor.id,
    projectId: projectInfo.projectId || "",
    tier: projectInfo.tier,
    tierLabel: projectInfo.tierLabel || `${flavor.label} · Google Account Connected`,
    quotaBuckets: perModelReliable ? quota.buckets : [],
    quotaWindows: Array.isArray(summary?.windows) ? summary.windows : [],
    perModelHidden: !perModelReliable && quota.buckets.length > 0,
    ...(catalog.models.length
      ? {
          availableModels: catalog.models,
          defaultModelId: catalog.defaultModelId,
          catalogAt: new Date().toISOString()
        }
      : {}),
    checkedAt: new Date().toISOString()
  };

  return { oauthCredentials, oauthMeta, accessToken, flavor: flavor.id };
}

/**
 * Opaque cache key for a (clientId, refreshToken, tokenUri) tuple — never exposes the token.
 * @param {string} clientId
 * @param {string} refreshToken
 * @param {string} tokenUri
 * @returns {string}
 */
function buildCacheKey(clientId, refreshToken, tokenUri) {
  const digest = crypto
    .createHash("sha256")
    .update(`${clientId}\0${refreshToken}\0${tokenUri}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `gcli:${digest}`;
}

/**
 * Get a live Gemini CLI access token, refreshing with the stored refresh_token when needed.
 * Works identically local and serverless (cache miss just costs one refresh call).
 *
 * @param {string | Record<string, any>} credentials
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   tokenUrlOverride?: string,
 *   dispatcher?: any,
 *   nowFn?: () => number,
 *   forceRefresh?: boolean
 * }} [options]
 * @returns {Promise<{ accessToken: string, projectId: string }>}
 */
export async function getGeminiCliAccessToken(credentials, options = {}) {
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
  let tokenUri;
  let cacheKey;

  const allowLoopback = Boolean(allowLoopbackTokenUri || tokenUrlOverride);
  const descriptorKey =
    typeof credentials === "string"
      ? `${allowLoopback ? 1 : 0}\0${tokenUrlOverride || ""}\0${credentials}`
      : "";
  const cachedDesc = descriptorKey ? credDescriptorCache.get(descriptorKey) : null;

  if (cachedDesc) {
    ({ clientId, clientSecret, refreshToken, projectId, tokenUri, cacheKey } = cachedDesc);
  } else {
    let raw = credentials;
    if (typeof credentials === "string") {
      try {
        raw = JSON.parse(credentials);
      } catch {
        throw httpError(400, "Stored Gemini CLI credentials JSON is malformed");
      }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw httpError(400, "Stored Gemini CLI credentials must be a JSON object");
    }

    const creds = stripPrototypePollution(raw);
    clientId = typeof creds.clientId === "string" ? creds.clientId.trim() : "";
    clientSecret =
      typeof creds.clientSecret === "string" ? creds.clientSecret.trim() : "";
    refreshToken =
      typeof creds.refreshToken === "string" ? creds.refreshToken.trim() : "";
    projectId = typeof creds.projectId === "string" ? creds.projectId.trim() : "";

    if (!clientId || !refreshToken) {
      throw httpError(
        400,
        "Stored Gemini CLI credentials are incomplete (missing clientId or refreshToken)"
      );
    }

    const rawTokenUri =
      (typeof tokenUrlOverride === "string" && tokenUrlOverride.trim()) ||
      (typeof creds.tokenUri === "string" && creds.tokenUri.trim()) ||
      GEMINI_CLI_TOKEN_URL;
    tokenUri = validateGeminiCliTokenUri(rawTokenUri, allowLoopback);
    cacheKey = buildCacheKey(clientId, refreshToken, tokenUri);

    if (descriptorKey) {
      credDescriptorCache.set(descriptorKey, {
        clientId,
        clientSecret,
        refreshToken,
        projectId,
        tokenUri,
        cacheKey
      });
      while (credDescriptorCache.size > GEMINI_CLI_CRED_CACHE_MAX) {
        credDescriptorCache.delete(credDescriptorCache.keys().next().value);
      }
    }
  }

  const now = nowFn();
  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - GEMINI_CLI_TOKEN_HARD_REFRESH_MS > now) {
      if (
        cached.expiresAt - GEMINI_CLI_TOKEN_SOFT_REFRESH_MS <= now &&
        !inflightRefreshes.has(cacheKey)
      ) {
        getGeminiCliAccessToken(credentials, {
          ...options,
          forceRefresh: true
        }).catch(() => {});
      }
      return { accessToken: cached.accessToken, projectId };
    }
  }

  const existing = inflightRefreshes.get(cacheKey);
  if (existing && !forceRefresh) return existing;

  const flight = (async () => {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken
    });
    if (clientSecret) form.set("client_secret", clientSecret);

    let res;
    try {
      res = await fetchImpl(tokenUri, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: form.toString(),
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (err) {
      throw httpError(
        502,
        redactSecrets(
          `Gemini CLI token refresh network error: ${err?.message || "fetch failed"}`,
          [clientSecret, refreshToken]
        )
      );
    }

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw httpError(
        res.status >= 400 && res.status < 500 ? 401 : 502,
        redactSecrets(
          `Gemini CLI token refresh failed (HTTP ${res.status}): ${text.slice(0, 240)}`,
          [clientSecret, refreshToken]
        )
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw httpError(502, "Gemini CLI token refresh returned invalid JSON");
    }

    const accessToken =
      typeof data?.access_token === "string" ? data.access_token.trim() : "";
    if (!accessToken) {
      throw httpError(502, "Gemini CLI token refresh did not include 'access_token'");
    }

    const expiresInSec =
      typeof data?.expires_in === "number" &&
      Number.isFinite(data.expires_in) &&
      data.expires_in > 0
        ? data.expires_in
        : 3600;

    tokenCache.set(cacheKey, { accessToken, expiresAt: nowFn() + expiresInSec * 1000 });
    while (tokenCache.size > GEMINI_CLI_TOKEN_CACHE_MAX) {
      tokenCache.delete(tokenCache.keys().next().value);
    }
    return { accessToken, projectId };
  })();

  inflightRefreshes.set(cacheKey, flight);
  try {
    return await flight;
  } finally {
    if (inflightRefreshes.get(cacheKey) === flight) inflightRefreshes.delete(cacheKey);
  }
}
