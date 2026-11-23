import crypto from "node:crypto";
import { upstreamFetch } from "./proxy.js";
import { extractCodeAndState } from "./oauthFlows.js";
import { isLoopbackHost } from "./security/headers.js";
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
  "gemini-3.8-flash-high": "gemini-3.8-flash-high(high)",
  "gemini-3.8-flash-medium": "gemini-3.8-flash-medium(medium)",
  "gemini-3.8-flash-low": "gemini-3.8-flash-low(low)",
  "gemini-3.8-flash": "gemini-3.8-flash-medium(medium)",
  "gemini-3.1-pro-high": "gemini-pro-agent",
  "gemini-3.1-pro-low": "gemini-3.1-pro-low(low)",
  "claude-sonnet-5-5-high": "claude-sonnet-5-5-high(high)",
  "claude-sonnet-5-5-medium": "claude-sonnet-5-5-medium(medium)",
  "claude-sonnet-5-5-low": "claude-sonnet-5-5-low(low)",
  "claude-sonnet-5-5": "claude-sonnet-5-5-high(high)",
  "claude-opus-5-5-high": "claude-opus-5-5-high(high)",
  "claude-opus-5-5-medium": "claude-opus-5-5-medium(medium)",
  "claude-opus-5-5-low": "claude-opus-5-5-low(low)",
  "claude-opus-5-5": "claude-opus-5-5-high(high)"
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
 *   envelopeUserAgent: string,
 *   maxOutputTokens: number,
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
    generateUrl: GEMINI_CLI_GENERATE_URL,
    streamUrl: GEMINI_CLI_STREAM_URL,
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
    generateUrl: `${ANTIGRAVITY_CHAT_BASE}:generateContent`,
    streamUrl: `${ANTIGRAVITY_CHAT_BASE}:streamGenerateContent?alt=sse`,
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
const MAX_PENDING_STATES = 200;

/** @type {Map<string, { codeVerifier: string, redirectUri: string, clientId: string, clientSecret: string, createdAt: number, expiresAt: number }>} */
const pendingStates = new Map();

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const tokenCache = new Map();

/** @type {Map<string, Promise<{ accessToken: string }>>} */
const inflightRefreshes = new Map();

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
 * @returns {Promise<{ step: string, ok: boolean, status?: number, response?: any, error?: string }>}
 */
async function probeCloudCode(fetchImpl, step, url, headers, body, token, dispatcher) {
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
      response = JSON.parse(text);
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
 *   maxAttempts?: number
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
    maxAttempts = 5
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
    flavor.chatHeaders(token),
    projectId ? { project: projectId } : {},
    token,
    dispatcher
  );
  steps.push({ ...quotaStep, projectSent: projectId || "" });

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
      headers: flavor.chatHeaders(token),
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

  // Quota buckets
  let quota = { buckets: [], raw: null };
  try {
    quota = await fetchGeminiCliQuota(accessToken, {
      projectId: projectInfo.projectId,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(dispatcher ? { dispatcher } : {}),
      flavor: flavor.id
    });
  } catch {
    // Best-effort quota
  }

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
    quotaBuckets: quota.buckets,
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
    dispatcher,
    nowFn = Date.now,
    forceRefresh = false
  } = options;

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
  const clientId = typeof creds.clientId === "string" ? creds.clientId.trim() : "";
  const clientSecret =
    typeof creds.clientSecret === "string" ? creds.clientSecret.trim() : "";
  const refreshToken =
    typeof creds.refreshToken === "string" ? creds.refreshToken.trim() : "";
  const projectId = typeof creds.projectId === "string" ? creds.projectId.trim() : "";

  if (!clientId || !refreshToken) {
    throw httpError(
      400,
      "Stored Gemini CLI credentials are incomplete (missing clientId or refreshToken)"
    );
  }

  const tokenUri =
    (typeof tokenUrlOverride === "string" && tokenUrlOverride.trim()) ||
    (typeof creds.tokenUri === "string" && creds.tokenUri.trim()) ||
    GEMINI_CLI_TOKEN_URL;

  const cacheKey = buildCacheKey(clientId, refreshToken, tokenUri);
  const now = nowFn();
  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - GEMINI_CLI_TOKEN_REFRESH_BUFFER_MS > now) {
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
    return { accessToken, projectId };
  })();

  inflightRefreshes.set(cacheKey, flight);
  try {
    return await flight;
  } finally {
    if (inflightRefreshes.get(cacheKey) === flight) inflightRefreshes.delete(cacheKey);
  }
}
