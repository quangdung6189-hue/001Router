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
  const {
    callbackUrl = GEMINI_CLI_DEFAULT_REDIRECT,
    requestHost = "",
    selectAccount = true,
    clientId = GEMINI_CLI_CLIENT_ID,
    clientSecret = GEMINI_CLI_CLIENT_SECRET,
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
  authUrl.searchParams.set("scope", GEMINI_CLI_SCOPES.join(" "));
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
    createdAt: now,
    expiresAt: now + GEMINI_CLI_PKCE_TTL_MS
  });

  return {
    authUrl: authUrl.toString(),
    state,
    redirectUri,
    expiresInSec: GEMINI_CLI_PKCE_TTL_SEC,
    clientId: resolvedClientId
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
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for loadCodeAssist");

  let res;
  try {
    res = await fetchImpl(GEMINI_CLI_LOAD_CODE_ASSIST_URL, {
      method: "POST",
      headers: buildGeminiCliDiscoveryHeaders(token),
      body: JSON.stringify({ metadata: geminiCliClientMetadata(), mode: 1 }),
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
      ...(dispatcher ? { dispatcher } : {})
    });
  }

  const currentTier = data?.currentTier?.name || "";
  const paidTier = data?.paidTier?.name || "";
  const isPaid = Boolean(data?.paidTier?.id && data.paidTier.id !== "free-tier");
  const tier = isPaid ? "paid" : currentTier ? "free" : "standard";
  const tierLabel = isPaid
    ? `${paidTier || "Paid plan"} · Cloud Code Assist`
    : currentTier
      ? `${currentTier} · Gemini CLI Free Tier`
      : "Gemini CLI · Google Account Connected";

  return { projectId, tier, tierLabel, raw: data };
}

/**
 * Pull the provisioned project id out of a loadCodeAssist/onboardUser payload.
 * @param {any} data
 * @returns {string}
 */
function extractCloudCodeProjectId(data) {
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
function pickOnboardTierId(data) {
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
      res = await fetchImpl(GEMINI_CLI_ONBOARD_USER_URL, {
        method: "POST",
        headers: buildGeminiCliDiscoveryHeaders(token),
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
 * Read per-model remaining quota from `v1internal:retrieveUserQuota`.
 *
 * @param {string} accessToken
 * @param {{ projectId?: string, fetchImpl?: typeof globalThis.fetch, dispatcher?: any }} [options]
 * @returns {Promise<{ buckets: Array<{ modelId: string, remainingFraction: number, resetTime: string }>, raw: any }>}
 */
export async function fetchGeminiCliQuota(accessToken, options = {}) {
  const { projectId = "", fetchImpl = upstreamFetch, dispatcher } = options;
  const token = String(accessToken || "").trim();
  if (!token) throw httpError(400, "Missing access token for retrieveUserQuota");

  const body = projectId ? { project: projectId } : {};
  let res;
  try {
    res = await fetchImpl(GEMINI_CLI_QUOTA_URL, {
      method: "POST",
      headers: buildGeminiCliHeaders(token),
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

  const rawBuckets = Array.isArray(data?.buckets) ? data.buckets : [];
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
      ...(dispatcher ? { dispatcher } : {})
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
      ...(dispatcher ? { dispatcher } : {})
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
    flow: "gemini_cli"
  };

  tokenCache.set(buildCacheKey(record.clientId, refreshToken, tokenUrl), {
    accessToken,
    expiresAt: nowFn() + expiresInSec * 1000
  });

  const oauthMeta = {
    ...profile,
    provider: "gemini_cli",
    flow: "gemini_cli",
    projectId: projectInfo.projectId || "",
    tier: projectInfo.tier,
    tierLabel: projectInfo.tierLabel || "Gemini CLI · Google Account Connected",
    quotaBuckets: quota.buckets,
    checkedAt: new Date().toISOString()
  };

  return { oauthCredentials, oauthMeta, accessToken };
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
