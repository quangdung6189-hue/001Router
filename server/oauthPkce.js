import crypto from "node:crypto";
import { isLoopbackHost } from "./security/headers.js";
import { classifyHostForSSRF, redactSecrets } from "./security/redact.js";

export const DEFAULT_OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const DEFAULT_OPENROUTER_EXCHANGE_URL =
  "https://openrouter.ai/api/v1/auth/keys";
export const PKCE_TTL_MS = 600_000;
export const PKCE_TTL_SEC = Math.floor(PKCE_TTL_MS / 1000);
const MAX_PENDING_PKCE_STATES = 200;

/** @type {Map<string, { codeVerifier: string, createdAt: number, expiresAt: number }>} */
const pkceStates = new Map();

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
 * Prune expired PKCE state entries from memory.
 * @param {number} [now]
 */
function pruneExpiredStates(now = Date.now()) {
  for (const [stateKey, record] of pkceStates.entries()) {
    if (!record || record.expiresAt <= now) {
      pkceStates.delete(stateKey);
    }
  }
}

/**
 * Validate `callbackUrl` is a safe `http(s)` URL targeting loopback (`127.0.0.1` / `localhost` / `::1`)
 * or the same origin as the incoming dashboard request.
 * @param {string} callbackUrl
 * @param {string} [requestHost]
 * @returns {URL}
 */
function validateCallbackUrl(callbackUrl, requestHost = "") {
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

  return parsed;
}

/**
 * Start an official OpenRouter OAuth PKCE (`S256`) flow.
 * Generates a 32-byte `code_verifier`, SHA-256 `code_challenge`, and one-time 24-byte hex `state` nonce.
 *
 * @param {{
 *   callbackUrl: string,
 *   authBaseUrl?: string,
 *   requestHost?: string,
 *   nowFn?: () => number
 * }} options
 * @returns {{ authUrl: string, state: string, expiresInSec: number }}
 */
export function startOpenRouterPkce({
  callbackUrl,
  authBaseUrl = DEFAULT_OPENROUTER_AUTH_URL,
  requestHost = "",
  nowFn = Date.now
} = {}) {
  const cbUrl = validateCallbackUrl(callbackUrl, requestHost);

  let authUrlObj;
  try {
    authUrlObj = new URL(authBaseUrl);
    if (authUrlObj.protocol !== "http:" && authUrlObj.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw createHttpError(400, "Invalid OpenRouter authBaseUrl");
  }

  const now = nowFn();
  pruneExpiredStates(now);

  // Cap in-memory pending PKCE states to guard against memory exhaustion
  while (pkceStates.size >= MAX_PENDING_PKCE_STATES) {
    const oldestKey = pkceStates.keys().next().value;
    if (!oldestKey) break;
    pkceStates.delete(oldestKey);
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  const state = crypto.randomBytes(24).toString("hex");

  // Preserve any existing query params on callbackUrl and append oauth=openrouter&state=<state>
  cbUrl.searchParams.set("oauth", "openrouter");
  cbUrl.searchParams.set("state", state);

  authUrlObj.searchParams.set("callback_url", cbUrl.toString());
  authUrlObj.searchParams.set("code_challenge", codeChallenge);
  authUrlObj.searchParams.set("code_challenge_method", "S256");

  pkceStates.set(state, {
    codeVerifier,
    createdAt: now,
    expiresAt: now + PKCE_TTL_MS
  });

  return {
    authUrl: authUrlObj.toString(),
    state,
    expiresInSec: PKCE_TTL_SEC
  };
}

/**
 * Complete an official OpenRouter OAuth PKCE flow by validating and consuming the one-time `state`
 * and exchanging `code` + `code_verifier` (`S256`) at OpenRouter's official key exchange endpoint.
 *
 * @param {{
 *   code: string,
 *   state: string,
 *   exchangeUrl?: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   dispatcher?: any,
 *   nowFn?: () => number
 * }} options
 * @returns {Promise<{ key: string }>}
 */
export async function exchangeOpenRouterPkce({
  code,
  state,
  exchangeUrl = DEFAULT_OPENROUTER_EXCHANGE_URL,
  fetchImpl = globalThis.fetch,
  dispatcher,
  nowFn = Date.now
} = {}) {
  const now = nowFn();
  pruneExpiredStates(now);

  const trimmedCode = typeof code === "string" ? code.trim() : "";
  if (!trimmedCode) {
    throw createHttpError(400, "Missing required OAuth authorization 'code'");
  }

  const trimmedState = typeof state === "string" ? state.trim() : "";
  if (!trimmedState) {
    throw createHttpError(400, "Missing required OAuth PKCE 'state'");
  }

  const record = pkceStates.get(trimmedState);
  // One-time consumption: delete immediately even if expired or exchange subsequently fails
  if (record) {
    pkceStates.delete(trimmedState);
  }

  if (!record) {
    throw createHttpError(400, "Invalid or already-used OAuth PKCE state");
  }
  if (record.expiresAt <= now) {
    throw createHttpError(400, "OAuth PKCE state has expired");
  }

  let parsedExchange;
  try {
    parsedExchange = new URL(exchangeUrl);
    if (parsedExchange.protocol !== "http:" && parsedExchange.protocol !== "https:") {
      throw new Error("bad protocol");
    }
    const ssrf = classifyHostForSSRF(parsedExchange.hostname);
    if (ssrf.isMetadataOrLinkLocal) {
      throw new Error("forbidden host");
    }
  } catch {
    throw createHttpError(400, "Invalid OpenRouter OAuth exchange URL");
  }

  let res;
  try {
    res = await fetchImpl(parsedExchange.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        code: trimmedCode,
        code_verifier: record.codeVerifier,
        code_challenge_method: "S256"
      }),
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (err) {
    throw createHttpError(
      502,
      redactSecrets(
        `OpenRouter OAuth exchange network error: ${err?.message || "fetch failed"}`,
        [record.codeVerifier, trimmedCode]
      )
    );
  }

  const rawText = await res.text().catch(() => "");
  if (!res.ok) {
    let errDetail = rawText.slice(0, 240);
    try {
      const parsed = JSON.parse(rawText);
      errDetail = parsed?.error?.message || parsed?.error || parsed?.message || errDetail;
    } catch {
      // non-JSON error
    }
    const cleanMsg = redactSecrets(String(errDetail || `HTTP ${res.status}`), [
      record.codeVerifier,
      trimmedCode
    ]);
    throw createHttpError(
      res.status >= 400 && res.status < 500 ? 400 : 502,
      `OpenRouter OAuth exchange failed (HTTP ${res.status}): ${cleanMsg}`
    );
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw createHttpError(502, "OpenRouter OAuth exchange returned invalid JSON");
  }

  const key = typeof data?.key === "string" ? data.key.trim() : "";
  if (!key) {
    throw createHttpError(
      502,
      "OpenRouter OAuth exchange response did not contain a valid API key"
    );
  }

  return { key };
}

/**
 * Clear all pending PKCE states (for test isolation).
 */
export function clearOpenRouterPkceStore() {
  pkceStates.clear();
}
