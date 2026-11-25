import { upstreamFetch } from "./proxy.js";
import crypto from "node:crypto";
import { getGoogleOAuthAccessToken } from "./googleOAuth.js";
import { getGeminiCliAccessToken } from "./geminiCliOAuth.js";
import {
  CLAUDE_CLI_VERSION,
  buildKimiHeaders,
  getGenericOAuthAccessToken,
  isClaudeOAuthKey,
  isKimiOAuthKey
} from "./oauthFlows.js";
import {
  classifyHostForSSRF,
  redactSecrets,
  stripPrototypePollution
} from "./security/redact.js";

export const DEFAULT_GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
export const DEFAULT_CLOUD_PLATFORM_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform";
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** @type {Map<string, { accessToken: string, expiresAt: number }>} */
const tokenCache = new Map();

/** @type {Map<string, Promise<string>>} */
const inFlightRequests = new Map();

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
 * Validate a token URI against HTTPS and SSRF rules.
 * Always blocks cloud metadata, link-local, and private LAN addresses.
 * Loopback `http://` is ONLY permitted when explicitly enabled for offline tests.
 * @param {string} rawUri
 * @param {{ allowLoopbackTokenUri?: boolean }} [options]
 * @returns {string}
 */
function validateTokenUri(rawUri, options = {}) {
  const trimmed = typeof rawUri === "string" ? rawUri.trim() : "";
  if (!trimmed) {
    return DEFAULT_GOOGLE_TOKEN_URI;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createHttpError(400, "Service account token_uri is not a valid URL");
  }

  if (parsed.username || parsed.password) {
    throw createHttpError(400, "Service account token_uri must not contain embedded credentials");
  }

  const ssrf = classifyHostForSSRF(parsed.hostname);
  if (ssrf.isMetadataOrLinkLocal) {
    throw createHttpError(
      400,
      `SSRF guard: service account token_uri blocked (${ssrf.reason || "forbidden host"})`
    );
  }
  if (ssrf.isPrivateLan) {
    throw createHttpError(
      400,
      `SSRF guard: service account token_uri cannot target private LAN address '${parsed.hostname}'`
    );
  }

  if (options.allowLoopbackTokenUri === true && ssrf.isLoopback) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw createHttpError(400, "Service account token_uri must use http or https protocol");
    }
    return trimmed;
  }

  if (parsed.protocol !== "https:") {
    throw createHttpError(
      400,
      "Service account token_uri must use https:// (e.g. https://oauth2.googleapis.com/token)"
    );
  }
  if (ssrf.isLoopback) {
    throw createHttpError(
      400,
      "SSRF guard: service account token_uri cannot target loopback addresses"
    );
  }

  return trimmed;
}

/**
 * Validate a Google Cloud Service Account JSON object.
 * Validates `type === "service_account"`, `project_id`, `client_email`, `private_key` (PEM),
 * and optional `token_uri` (must be https://oauth2.googleapis.com/token or valid https URL
 * passing SSRF checks unless overridden for offline tests).
 *
 * @param {unknown} obj
 * @param {{ allowLoopbackTokenUri?: boolean }} [options]
 */
export function validateGoogleServiceAccountJson(obj, options = {}) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw createHttpError(400, "Service account credentials must be a JSON object");
  }

  const cleaned = stripPrototypePollution(obj);

  if (cleaned.type !== "service_account") {
    throw createHttpError(
      400,
      "Invalid service account JSON: 'type' must be 'service_account'"
    );
  }

  const projectId =
    typeof cleaned.project_id === "string" ? cleaned.project_id.trim() : "";
  if (!projectId || !/^[a-zA-Z0-9._:-]+$/.test(projectId)) {
    throw createHttpError(
      400,
      "Invalid service account JSON: missing or invalid 'project_id'"
    );
  }

  const clientEmail =
    typeof cleaned.client_email === "string" ? cleaned.client_email.trim() : "";
  if (!clientEmail || !clientEmail.includes("@") || /\s/.test(clientEmail)) {
    throw createHttpError(
      400,
      "Invalid service account JSON: missing or invalid 'client_email'"
    );
  }

  let privateKey =
    typeof cleaned.private_key === "string" ? cleaned.private_key.trim() : "";
  if (privateKey.includes("\\n") && !privateKey.includes("\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (
    /REPLACE_WITH_YOUR|YOUR_PRIVATE_KEY|<PRIVATE_KEY>|\.\.\.PRIVATE_KEY/i.test(
      privateKey
    )
  ) {
    throw createHttpError(
      400,
      'private_key in Service Account JSON is still a sample placeholder. Paste your real Google Cloud Service Account JSON file, or use { "apiKey": "..." } config JSON.'
    );
  }
  if (
    !privateKey ||
    !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey) ||
    !/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey)
  ) {
    throw createHttpError(
      400,
      "Invalid service account JSON: missing or malformed PEM 'private_key'"
    );
  }

  // Verify Node crypto can parse the PEM private key
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    throw createHttpError(
      400,
      "Invalid service account JSON: 'private_key' is not a valid PEM private key"
    );
  }

  const tokenUri = validateTokenUri(cleaned.token_uri, options);

  return {
    ...cleaned,
    type: "service_account",
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri
  };
}

/**
 * Build the official Google Vertex AI OpenAI-compatible base URL for a project and location.
 * @param {string} projectId
 * @param {string} [location]
 * @returns {string}
 */
export function buildVertexOpenAiBaseUrl(projectId, location = "us-central1") {
  const cleanProject = typeof projectId === "string" ? projectId.trim() : "";
  if (!cleanProject || !/^[a-zA-Z0-9._:-]+$/.test(cleanProject)) {
    throw createHttpError(400, "Invalid GCP projectId for Vertex AI base URL");
  }

  const cleanLocation =
    typeof location === "string" && location.trim()
      ? location.trim().toLowerCase()
      : "us-central1";
  if (!/^[a-z0-9-]+$/.test(cleanLocation)) {
    throw createHttpError(400, "Invalid GCP location for Vertex AI base URL");
  }

  if (cleanLocation === "global") {
    return `https://aiplatform.googleapis.com/v1/projects/${cleanProject}/locations/global/endpoints/openapi`;
  }
  return `https://${cleanLocation}-aiplatform.googleapis.com/v1/projects/${cleanProject}/locations/${cleanLocation}/endpoints/openapi`;
}

/**
 * Exchange a Google Cloud Service Account JSON for an OAuth2 Bearer access token
 * using an RS256-signed JWT assertion (RFC 7523).
 * Caches tokens in memory by `client_email + token_uri` until 5 minutes before expiry.
 *
 * @param {string | Record<string, any>} saJsonStringOrObj
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   scope?: string,
 *   tokenUriOverride?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   dispatcher?: any,
 *   nowFn?: () => number
 * }} [options]
 * @returns {Promise<string>}
 */
/** @type {Map<string, any>} */
const parsedSaCache = new Map();
const PARSED_SA_CACHE_MAX = 256;
const TOKEN_CACHE_MAX = 1000;
const TOKEN_SOFT_REFRESH_BUFFER_MS = 10 * 60 * 1000;
const TOKEN_HARD_REFRESH_BUFFER_MS = TOKEN_REFRESH_BUFFER_MS;

export async function getServiceAccountAccessToken(saJsonStringOrObj, options = {}) {
  const {
    fetchImpl = upstreamFetch,
    scope = DEFAULT_CLOUD_PLATFORM_SCOPE,
    tokenUriOverride,
    allowLoopbackTokenUri = false,
    forceRefresh = false,
    dispatcher,
    nowFn = Date.now
  } = options;

  const allowLoopback = allowLoopbackTokenUri || Boolean(tokenUriOverride);
  let sa;
  if (typeof saJsonStringOrObj === "string") {
    const saKey = `${allowLoopback ? 1 : 0}\0${saJsonStringOrObj}`;
    sa = parsedSaCache.get(saKey);
    if (!sa) {
      let rawObj;
      try {
        rawObj = JSON.parse(saJsonStringOrObj);
      } catch {
        throw createHttpError(400, "Stored service account JSON is malformed");
      }
      sa = validateGoogleServiceAccountJson(rawObj, { allowLoopbackTokenUri: allowLoopback });
      parsedSaCache.set(saKey, sa);
      while (parsedSaCache.size > PARSED_SA_CACHE_MAX) {
        parsedSaCache.delete(parsedSaCache.keys().next().value);
      }
    }
  } else {
    sa = validateGoogleServiceAccountJson(saJsonStringOrObj, {
      allowLoopbackTokenUri: allowLoopback
    });
  }

  const effectiveTokenUri =
    typeof tokenUriOverride === "string" && tokenUriOverride.trim()
      ? validateTokenUri(tokenUriOverride, { allowLoopbackTokenUri: true })
      : sa.token_uri || DEFAULT_GOOGLE_TOKEN_URI;

  const cacheKey = `${sa.client_email}\0${effectiveTokenUri}\0${scope}`;
  const now = nowFn();
  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - TOKEN_HARD_REFRESH_BUFFER_MS > now) {
      // Soft pre-emptive background refresh when <10 min remain (zero TTFT stall)
      if (
        cached.expiresAt - TOKEN_SOFT_REFRESH_BUFFER_MS <= now &&
        !inFlightRequests.has(cacheKey)
      ) {
        getServiceAccountAccessToken(sa, {
          ...options,
          forceRefresh: true
        }).catch(() => {});
      }
      return cached.accessToken;
    }

    const existingFlight = inFlightRequests.get(cacheKey);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const flightPromise = (async () => {
    const iat = Math.floor(nowFn() / 1000);
    const exp = iat + 3600;
    const header = {
      alg: "RS256",
      typ: "JWT",
      ...(typeof sa.private_key_id === "string" && sa.private_key_id.trim()
        ? { kid: sa.private_key_id.trim() }
        : {})
    };
    const claimSet = {
      iss: sa.client_email,
      sub: sa.client_email,
      scope,
      aud: sa.token_uri || DEFAULT_GOOGLE_TOKEN_URI,
      iat,
      exp
    };

    const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(claimSet), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${payloadB64}`;

    let signatureB64;
    try {
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(signingInput);
      signer.end();
      signatureB64 = signer.sign(sa.private_key).toString("base64url");
    } catch (err) {
      throw createHttpError(
        500,
        redactSecrets(
          `Failed to sign service account JWT assertion: ${err?.message || "signing error"}`,
          [sa.private_key]
        )
      );
    }

    const assertion = `${signingInput}.${signatureB64}`;
    const formBody = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
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
          `Service account token exchange network error: ${err?.message || "fetch failed"}`,
          [sa.private_key, assertion]
        )
      );
    }

    const responseText = await tokenRes.text().catch(() => "");
    if (!tokenRes.ok) {
      const cleanDetail = redactSecrets(responseText.slice(0, 240), [
        sa.private_key,
        assertion
      ]);
      throw createHttpError(
        tokenRes.status >= 400 && tokenRes.status < 500 ? 401 : 502,
        `Service account token exchange failed (HTTP ${tokenRes.status})${cleanDetail ? `: ${cleanDetail}` : ""}`
      );
    }

    let tokenData;
    try {
      tokenData = JSON.parse(responseText);
    } catch {
      throw createHttpError(502, "Service account token endpoint returned invalid JSON");
    }

    const accessToken =
      typeof tokenData?.access_token === "string" ? tokenData.access_token.trim() : "";
    if (!accessToken) {
      throw createHttpError(
        502,
        "Service account token endpoint response did not include access_token"
      );
    }

    const expiresInSec =
      typeof tokenData.expires_in === "number" &&
      Number.isFinite(tokenData.expires_in) &&
      tokenData.expires_in > 0
        ? tokenData.expires_in
        : 3600;

    tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: nowFn() + expiresInSec * 1000
    });
    while (tokenCache.size > TOKEN_CACHE_MAX) {
      tokenCache.delete(tokenCache.keys().next().value);
    }

    return accessToken;
  })();

  inFlightRequests.set(cacheKey, flightPromise);
  try {
    return await flightPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Resolve the upstream authorization secret and any required official provider headers
 * (e.g., `x-goog-user-project` for Google OAuth) for a provider key entry.
 *
 * @param {any} keyEntry
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   googleOAuthFetchImpl?: typeof globalThis.fetch,
 *   googleOAuthTokenUrl?: string,
 *   scope?: string,
 *   tokenUriOverride?: string,
 *   tokenUrlOverride?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   dispatcher?: any,
 *   nowFn?: () => number,
 *   forceRefresh?: boolean
 * }} [options]
 * @returns {Promise<{ secret: string, extraHeaders: Record<string, string> }>}
 */
export async function resolveAuthContextForKey(keyEntry, options = {}) {
  if (!keyEntry || typeof keyEntry !== "object") {
    return { secret: "", extraHeaders: {} };
  }
  if (keyEntry.authMethod === "google_oauth" && keyEntry.oauthCredentials) {
    const { accessToken, projectId } = await getGoogleOAuthAccessToken(
      keyEntry.oauthCredentials,
      {
        fetchImpl: options.googleOAuthFetchImpl || options.fetchImpl,
        tokenUrlOverride: options.googleOAuthTokenUrl || options.tokenUrlOverride,
        allowLoopbackTokenUri: Boolean(
          options.allowLoopbackTokenUri ||
            options.googleOAuthTokenUrl ||
            options.tokenUrlOverride
        ),
        dispatcher: options.dispatcher,
        nowFn: options.nowFn,
        forceRefresh: options.forceRefresh
      }
    );
    return {
      secret: accessToken,
      extraHeaders: projectId ? { "x-goog-user-project": projectId } : {}
    };
  }
  // Gemini CLI / Antigravity (Cloud Code Assist) credentials — Bearer only, project rides in the
  // body envelope. Both refresh the same way; the client id/secret live in the stored credentials.
  if (
    (keyEntry.authMethod === "gemini_cli" || keyEntry.authMethod === "antigravity") &&
    keyEntry.oauthCredentials
  ) {
    const { accessToken } = await getGeminiCliAccessToken(keyEntry.oauthCredentials, {
      fetchImpl: options.googleOAuthFetchImpl || options.fetchImpl,
      tokenUrlOverride: options.googleOAuthTokenUrl || options.tokenUrlOverride,
      dispatcher: options.dispatcher,
      nowFn: options.nowFn,
      forceRefresh: options.forceRefresh
    });
    return { secret: accessToken, extraHeaders: {} };
  }
  if (keyEntry.authMethod === "oauth2" && keyEntry.oauthCredentials) {
    const { accessToken } = await getGenericOAuthAccessToken(keyEntry.oauthCredentials, {
      fetchImpl: options.oauthFetchImpl || options.fetchImpl,
      tokenUrlOverride: options.oauthTokenUrlOverride || options.tokenUrlOverride,
      allowLoopback: Boolean(
        options.allowLoopbackTokenUri ||
          options.oauthTokenUrlOverride ||
          options.tokenUrlOverride
      ),
      dispatcher: options.dispatcher,
      nowFn: options.nowFn,
      forceRefresh: options.forceRefresh
    });
    const extraHeaders = {};
    if (isClaudeOAuthKey(keyEntry, accessToken)) {
      extraHeaders.authorization = `Bearer ${accessToken}`;
      extraHeaders["anthropic-beta"] =
        "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27";
      extraHeaders["anthropic-dangerous-direct-browser-access"] = "true";
      extraHeaders["user-agent"] = `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`;
      extraHeaders["x-app"] = "cli";
    } else if (isKimiOAuthKey(keyEntry)) {
      Object.assign(extraHeaders, buildKimiHeaders(keyEntry.oauthMeta?.deviceId || keyEntry.id));
    }
    if (keyEntry.oauthMeta?.orgId) {
      extraHeaders["x-kilocode-organizationid"] = String(keyEntry.oauthMeta.orgId);
    }
    return { secret: accessToken, extraHeaders };
  }
  if (keyEntry.authMethod === "service_account" && keyEntry.serviceAccountJson) {
    const accessToken = await getServiceAccountAccessToken(
      keyEntry.serviceAccountJson,
      options
    );
    return { secret: accessToken, extraHeaders: {} };
  }
  const extraHeaders = {};
  const rawSecret = typeof keyEntry.key === "string" ? keyEntry.key : "";
  if (isClaudeOAuthKey(keyEntry, rawSecret) && rawSecret) {
    extraHeaders.authorization = `Bearer ${rawSecret}`;
    extraHeaders["anthropic-beta"] =
      "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27";
    extraHeaders["anthropic-dangerous-direct-browser-access"] = "true";
    extraHeaders["user-agent"] = `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`;
    extraHeaders["x-app"] = "cli";
  }
  if (keyEntry.oauthMeta?.orgId) {
    extraHeaders["x-kilocode-organizationid"] = String(keyEntry.oauthMeta.orgId);
  }
  return {
    secret: rawSecret,
    extraHeaders
  };
}

/**
 * Resolve the upstream authorization secret for a provider key entry.
 * Supports official static API keys, Google Cloud `service_account` JWT tokens,
 * and Google OAuth 2.0 (`google_oauth`) refreshable Bearer access tokens.
 *
 * @param {any} keyEntry
 * @param {{
 *   fetchImpl?: typeof globalThis.fetch,
 *   googleOAuthFetchImpl?: typeof globalThis.fetch,
 *   googleOAuthTokenUrl?: string,
 *   scope?: string,
 *   tokenUriOverride?: string,
 *   tokenUrlOverride?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   dispatcher?: any,
 *   nowFn?: () => number,
 *   forceRefresh?: boolean
 * }} [options]
 * @returns {Promise<string>}
 */
export async function resolveAuthSecretForKey(keyEntry, options = {}) {
  const { secret } = await resolveAuthContextForKey(keyEntry, options);
  return secret;
}

/**
 * Clear the in-memory service account access token cache (useful in tests).
 */
export function clearServiceAccountTokenCache() {
  tokenCache.clear();
  inFlightRequests.clear();
}

/**
 * Strip `// single-line` and `/* block * /` comments and trailing commas outside JSON string literals.
 * @param {string} text
 * @returns {string}
 */
function stripJsonCommentsAndTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      if (i < text.length) out += text[i];
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i++; // skip closing '/'
      continue;
    }

    out += ch;
  }

  // Strip trailing commas before } or ] outside strings
  let cleaned = "";
  inString = false;
  escapeNext = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      cleaned += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) {
        j++;
      }
      if (out[j] === "}" || out[j] === "]") {
        continue;
      }
    }
    cleaned += ch;
  }
  return cleaned;
}

/**
 * Coerce flexible user input into a parsed JSON object.
 * Supports:
 * - Already-parsed objects or arrays (wraps arrays as `{ items: [...] }`)
 * - UTF-8 BOM (`\uFEFF`), Markdown code fences (```json ... ```), and smart quotes
 * - JSONC with `//` or `/* * /` comments and trailing commas
 * - `.env` / `KEY=VALUE` lines (e.g., `OPENAI_API_KEY=sk-...`)
 * - Bare API key tokens (e.g., `sk-...`, `AIza...`, `gsk_...`, `xai-...`, `hf_...`)
 *
 * @param {unknown} rawInput
 * @returns {Record<string, any>}
 */
export function coerceFlexibleJsonInput(rawInput) {
  if (rawInput && typeof rawInput === "object") {
    if (Array.isArray(rawInput)) {
      return { items: rawInput };
    }
    return /** @type {Record<string, any>} */ (rawInput);
  }

  if (typeof rawInput !== "string") {
    throw createHttpError(400, "Credential JSON must be a JSON object");
  }

  let text = rawInput.replace(/^\uFEFF/, "").trim();
  if (!text) {
    throw createHttpError(400, "JSON input is empty");
  }

  // Strip surrounding markdown code fences (```json ... ``` or ``` ... ```) in linear O(n) time
  if (text.startsWith("```") && text.endsWith("```") && text.length >= 6) {
    let bodyStart = 3;
    const afterOpen = text.slice(3, 16);
    const langMatch = /^(?:jsonc|json|js|env|text)\b/i.exec(afterOpen);
    if (langMatch) {
      bodyStart += langMatch[0].length;
    }
    text = text.slice(bodyStart, text.length - 3).trim();
  }

  // Normalize smart/curly double quotes to ASCII double quotes
  const normalizedQuotes = text.replace(/[\u201C\u201D]/g, '"');

  const tryParseObject = (candidate) => {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return { items: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  };

  try {
    const direct = tryParseObject(normalizedQuotes);
    if (direct) return direct;
  } catch {
    // Fall through to JSONC / .env / bare token coercion
  }

  try {
    const stripped = stripJsonCommentsAndTrailingCommas(normalizedQuotes);
    const jsonc = tryParseObject(stripped);
    if (jsonc) return jsonc;
  } catch {
    // Fall through
  }

  // Check if input is .env / KEY=VALUE lines (only when it does not start with '{' or '[')
  if (!normalizedQuotes.startsWith("{") && !normalizedQuotes.startsWith("[")) {
    const lines = normalizedQuotes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

    if (lines.length > 0 && lines.every((l) => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(l))) {
      /** @type {Record<string, string>} */
      const envMap = {};
      for (const line of lines) {
        const cleanLine = line.replace(/^export\s+/, "");
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx <= 0) continue;
        const k = cleanLine.slice(0, eqIdx).trim();
        let v = cleanLine.slice(eqIdx + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1).trim();
        }
        if (k && v) {
          envMap[k] = v;
        }
      }
      if (Object.keys(envMap).length > 0) {
        return { env: envMap };
      }
    }

    // Check if input is a single bare API key token (no whitespace or braces)
    if (
      lines.length === 1 &&
      !/[\s{}[\]",;]/.test(lines[0]) &&
      /^(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{10,}|xai-[A-Za-z0-9_-]{10,}|hf_[A-Za-z0-9_-]{10,}|nvapi-[A-Za-z0-9_-]{10,}|csk-[A-Za-z0-9_-]{10,}|fw_[A-Za-z0-9_-]{10,}|pplx-[A-Za-z0-9_-]{10,}|tvly-[A-Za-z0-9_-]{8,}|fc-[A-Za-z0-9_-]{8,}|jina_[A-Za-z0-9_-]{8,}|r8_[A-Za-z0-9_-]{8,})$/.test(
        lines[0]
      )
    ) {
      return { apiKey: lines[0] };
    }
  }

  throw createHttpError(400, "Invalid JSON syntax");
}

const DIRECT_KEY_FIELDS = [
  "apiKey",
  "api_key",
  "apikey",
  "key",
  "token",
  "accessToken",
  "access_token",
  "authToken",
  "auth_token",
  "secretKey",
  "secret_key",
  "bearerToken",
  "bearer_token",
  "x_api_key",
  "x-api-key",
  "subscription_key"
];

const ARRAY_KEY_FIELDS = ["apiKeys", "api_keys", "keys", "tokens"];

const NON_SECRET_ENV_KEY_NAMES = new Set([
  "private_key_id",
  "env_key",
  "translation_key",
  "sort_key",
  "cache_key",
  "routing_key",
  "primary_key",
  "foreign_key",
  "partition_key",
  "idempotency_key",
  "public_key",
  "host_key",
  "ssh_key",
  "license_key",
  "product_key"
]);

const BASE_URL_FIELDS = [
  "baseUrl",
  "base_url",
  "baseURL",
  "apiBase",
  "api_base",
  "endpoint",
  "url",
  "apiUrl",
  "api_url",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "ANTHROPIC_BASE_URL",
  "GEMINI_BASE_URL"
];

const PROJECT_ID_FIELDS = [
  "projectId",
  "project_id",
  "project",
  "quota_project_id",
  "GOOGLE_CLOUD_PROJECT",
  "GCP_PROJECT_ID",
  "VERTEX_PROJECT_ID"
];

const LOCATION_FIELDS = [
  "location",
  "region",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_CLOUD_LOCATION",
  "VERTEX_LOCATION"
];

const ACCOUNT_ID_FIELDS = [
  "accountId",
  "account_id",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_ACCOUNT_ID"
];

const RESOURCE_NAME_FIELDS = [
  "resourceName",
  "resource_name",
  "resource",
  "AZURE_RESOURCE_NAME",
  "AZURE_OPENAI_RESOURCE"
];

const DEPLOYMENT_FIELDS = [
  "deployment",
  "deploymentId",
  "deployment_id",
  "AZURE_DEPLOYMENT",
  "AZURE_OPENAI_DEPLOYMENT"
];

const KEYLESS_LOCAL_PRESETS = new Set([
  "ollama",
  "lmstudio",
  "vllm",
  "llamacpp",
  "searxng",
  "jina",
  "comfyui",
  "sdwebui"
]);

/**
 * Check if a candidate secret value looks like a placeholder or an unexpanded environment variable reference.
 * @param {string} val
 * @returns {boolean}
 */
function isPlaceholderOrEnvVarRef(val) {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(trimmed)) return true;
  if (/^%[A-Za-z_][A-Za-z0-9_]*%$/.test(trimmed)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed)) return true;
  if (/^env:[A-Za-z_]/i.test(trimmed)) return true;
  return false;
}

/**
 * Check if a base URL string is empty or contains an unreplaced template placeholder.
 * @param {string} url
 * @returns {boolean}
 */
export function hasBaseUrlTemplatePlaceholder(url) {
  if (!url || typeof url !== "string") return true;
  return (
    url.includes("<ACCOUNT_ID>") ||
    url.includes("/accounts/ACCOUNT_ID/") ||
    url.includes("/projects/PROJECT/") ||
    url.includes("YOUR_PROJECT_ID") ||
    url.includes("YOUR_RESOURCE") ||
    url.includes("<PROJECT_ID>") ||
    url.includes("<RESOURCE>")
  );
}

/**
 * Parse a user-supplied provider credential JSON string or object.
 * Supports:
 * 1. Google Cloud Service Account JSON (`type === "service_account"`) for Vertex AI
 * 2. Google ADC Authorized User JSON (`type === "authorized_user"`)
 * 3. Google Cloud OAuth 2.0 Client Secret JSON (`{ web: { client_id, client_secret } }` or `{ installed: { ... } }`)
 * 4. Universal Provider / Tool Config JSON (`apiKey`, `env`, OpenCode, Continue, Claude Code, headers, multi-key arrays, etc.)
 *
 * Strips prototype-pollution keys and throws a descriptive HTTP 400 error if invalid.
 *
 * @param {string | Record<string, any>} rawInput
 * @param {{
 *   preset?: string,
 *   location?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   keyOptional?: boolean
 * }} [options]
 */
export function parseProviderCredentialJson(rawInput, options = {}) {
  const parsed = coerceFlexibleJsonInput(rawInput);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createHttpError(400, "Credential JSON must be a JSON object");
  }

  const cleaned = stripPrototypePollution(parsed);

  // Case 1: Google Cloud Service Account JSON (`type === "service_account"`)
  if (cleaned.type === "service_account") {
    const rawPk = typeof cleaned.private_key === "string" ? cleaned.private_key : "";
    if (
      /REPLACE_WITH_YOUR|YOUR_PRIVATE_KEY|<PRIVATE_KEY>|\.\.\.PRIVATE_KEY/i.test(
        rawPk
      )
    ) {
      throw createHttpError(
        400,
        'private_key in Service Account JSON is still a sample placeholder. Paste your real Google Cloud Service Account JSON file, or use { "apiKey": "..." } config JSON.'
      );
    }

    const sa = validateGoogleServiceAccountJson(cleaned, {
      allowLoopbackTokenUri: Boolean(options.allowLoopbackTokenUri)
    });
    const loc =
      (typeof options.location === "string" && options.location.trim()) ||
      (typeof cleaned.location === "string" && cleaned.location.trim()) ||
      "us-central1";
    const suggestedBaseUrl = buildVertexOpenAiBaseUrl(sa.project_id, loc);

    return {
      mode: "service_account",
      serviceAccountJson: JSON.stringify(sa),
      serviceAccountMeta: {
        clientEmail: sa.client_email,
        projectId: sa.project_id,
        location: loc.toLowerCase(),
        tokenUri: sa.token_uri
      },
      suggestedBaseUrl,
      suggestedFormatType: "openai"
    };
  }

  // Case 2: Google ADC Authorized User JSON (`type === "authorized_user"`)
  if (cleaned.type === "authorized_user") {
    const clientId = String(cleaned.client_id ?? cleaned.clientId ?? "").trim();
    const clientSecret = String(
      cleaned.client_secret ?? cleaned.clientSecret ?? ""
    ).trim();
    const refreshToken = String(
      cleaned.refresh_token ?? cleaned.refreshToken ?? ""
    ).trim();
    const rawProjectId = String(
      cleaned.quota_project_id ??
        cleaned.project_id ??
        cleaned.projectId ??
        ""
    ).trim();

    if (!clientId || !clientSecret || !refreshToken) {
      throw createHttpError(
        400,
        "Invalid Google Authorized User JSON: 'client_id', 'client_secret', and 'refresh_token' are required"
      );
    }
    if (rawProjectId && !/^[a-zA-Z0-9._:-]+$/.test(rawProjectId)) {
      throw createHttpError(
        400,
        "Invalid Google Authorized User JSON: invalid 'quota_project_id' / 'project_id'"
      );
    }

    const tokenUri = validateTokenUri(cleaned.token_uri, {
      allowLoopbackTokenUri: Boolean(options.allowLoopbackTokenUri)
    });
    const loc =
      (typeof options.location === "string" && options.location.trim()) ||
      (typeof cleaned.location === "string" && cleaned.location.trim()) ||
      "us-central1";

    return {
      mode: "google_authorized_user",
      oauthCredentials: JSON.stringify({
        clientId,
        clientSecret,
        refreshToken,
        projectId: rawProjectId,
        tokenUri
      }),
      oauthMeta: {
        email:
          (typeof cleaned.client_email === "string" && cleaned.client_email.trim()) ||
          (typeof cleaned.email === "string" && cleaned.email.trim()) ||
          "adc-authorized-user@google.cloud",
        name: "Google ADC Authorized User",
        projectId: rawProjectId || "",
        tier: "standard",
        tierLabel: "Google ADC (Authorized User JSON)",
        billingEnabled: null,
        modelsCount: null,
        checkedAt: new Date().toISOString()
      },
      ...(rawProjectId && options.preset === "vertex"
        ? { suggestedBaseUrl: buildVertexOpenAiBaseUrl(rawProjectId, loc) }
        : {})
    };
  }

  // Case 3: Google OAuth Client Secret JSON (`cleaned.web || cleaned.installed`)
  if (
    (cleaned.web && typeof cleaned.web === "object" && !Array.isArray(cleaned.web)) ||
    (cleaned.installed &&
      typeof cleaned.installed === "object" &&
      !Array.isArray(cleaned.installed))
  ) {
    const root =
      cleaned.web && typeof cleaned.web === "object" && !Array.isArray(cleaned.web)
        ? cleaned.web
        : cleaned.installed;
    const clientId = String(root.client_id ?? root.clientId ?? "").trim();
    const clientSecret = String(root.client_secret ?? root.clientSecret ?? "").trim();
    const refreshToken = String(
      root.refresh_token ??
        root.refreshToken ??
        cleaned.refresh_token ??
        cleaned.refreshToken ??
        ""
    ).trim();
    const projectId = String(
      root.project_id ??
        root.projectId ??
        cleaned.project_id ??
        cleaned.projectId ??
        cleaned.quota_project_id ??
        ""
    ).trim();

    if (!clientId || !clientSecret) {
      throw createHttpError(
        400,
        "Invalid Google OAuth Client Secret JSON: missing 'client_id' or 'client_secret'"
      );
    }
    if (projectId && !/^[a-zA-Z0-9._:-]+$/.test(projectId)) {
      throw createHttpError(
        400,
        "Invalid Google OAuth Client Secret JSON: invalid 'project_id'"
      );
    }

    if (refreshToken) {
      const tokenUri = validateTokenUri(root.token_uri || cleaned.token_uri, {
        allowLoopbackTokenUri: Boolean(options.allowLoopbackTokenUri)
      });
      const loc =
        (typeof options.location === "string" && options.location.trim()) ||
        (typeof cleaned.location === "string" && cleaned.location.trim()) ||
        "us-central1";
      return {
        mode: "google_authorized_user",
        oauthCredentials: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          projectId,
          tokenUri
        }),
        oauthMeta: {
          email:
            (typeof cleaned.email === "string" && cleaned.email.trim()) ||
            "adc-authorized-user@google.cloud",
          name: "Google ADC Authorized User",
          projectId: projectId || "",
          tier: "standard",
          tierLabel: "Google ADC (Authorized User JSON)",
          billingEnabled: null,
          modelsCount: null,
          checkedAt: new Date().toISOString()
        },
        ...(projectId && options.preset === "vertex"
          ? { suggestedBaseUrl: buildVertexOpenAiBaseUrl(projectId, loc) }
          : {})
      };
    }

    return {
      mode: "google_oauth_client",
      clientId,
      clientSecret,
      projectId
    };
  }

  // Case 4: Universal Provider / Tool Config JSON (`mode: "config_json"`)
  /** @type {Array<{ key: string, label: string, enabled: boolean }>} */
  const apiKeys = [];
  const seenKeys = new Set();
  const pushKey = (rawKey, label = "", enabled = true) => {
    if (typeof rawKey !== "string") return;
    let trimmed = rawKey.trim();
    if (/^Bearer\s+/i.test(trimmed)) {
      trimmed = trimmed.replace(/^Bearer\s+/i, "").trim();
    }
    if (!trimmed || seenKeys.has(trimmed)) return;
    seenKeys.add(trimmed);
    apiKeys.push({
      key: trimmed,
      label: typeof label === "string" ? label.trim() : "",
      enabled: enabled !== false
    });
  };

  let rawBaseUrl = "";
  let projectId = "";
  let location =
    typeof options.location === "string" && options.location.trim()
      ? options.location.trim()
      : "";
  let accountId = "";
  let resourceName = "";
  let deployment = "";
  const models = [];
  const seenModels = new Set();

  const pushModel = (rawModel) => {
    if (typeof rawModel !== "string") return;
    const id = rawModel.trim();
    if (!id || seenModels.has(id)) return;
    seenModels.add(id);
    models.push(id);
  };

  const pickFirstString = (obj, fields) => {
    for (const f of fields) {
      if (typeof obj[f] === "string" && obj[f].trim()) {
        return obj[f].trim();
      }
    }
    return "";
  };

  const extractHeadersFromNode = (headersObj, defaultLabel = "") => {
    if (!headersObj || typeof headersObj !== "object" || Array.isArray(headersObj)) {
      return;
    }
    for (const [hKey, hVal] of Object.entries(headersObj)) {
      if (typeof hVal !== "string" || !hVal.trim()) continue;
      const lower = hKey.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "x-api-key" ||
        lower === "x-subscription-token" ||
        lower === "api-key" ||
        lower === "xi-api-key" ||
        lower === "x-key"
      ) {
        let secret = hVal.trim();
        if (/^(?:Bearer|Token|Key)\s+/i.test(secret)) {
          secret = secret.replace(/^(?:Bearer|Token|Key)\s+/i, "").trim();
        }
        if (secret && !isPlaceholderOrEnvVarRef(secret)) {
          pushKey(secret, defaultLabel);
        }
      }
    }
  };

  const extractModelsFromNode = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.models)) {
      for (const m of node.models) {
        if (typeof m === "string") {
          pushModel(m);
        } else if (m && typeof m === "object") {
          const id =
            (typeof m.id === "string" && m.id) ||
            (typeof m.model === "string" && m.model) ||
            (typeof m.name === "string" && m.name) ||
            "";
          pushModel(id);
        }
      }
    } else if (node.models && typeof node.models === "object") {
      // OpenCode style: { models: { "model-id": { ... } } }
      for (const [mKey, mVal] of Object.entries(node.models)) {
        if (mVal && typeof mVal === "object" && typeof mVal.id === "string") {
          pushModel(mVal.id);
        } else {
          pushModel(mKey);
        }
      }
    }
    if (typeof node.model === "string") {
      pushModel(node.model);
    }
    if (typeof node.defaultModel === "string") {
      pushModel(node.defaultModel);
    }
    if (typeof node.default_model === "string") {
      pushModel(node.default_model);
    }
  };

  /**
   * Recursively inspect a config object node up to depth 4.
   * @param {any} node
   * @param {number} depth
   */
  const inspectNode = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 4) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        inspectNode(item, depth + 1);
      }
      return;
    }

    const nodeLabel =
      typeof node.label === "string"
        ? node.label
        : typeof node.title === "string"
          ? node.title
          : typeof node.name === "string" && depth > 0
            ? node.name
            : "";
    const nodeEnabled = node.enabled !== false;

    // 1. Direct API key fields
    for (const field of DIRECT_KEY_FIELDS) {
      if (typeof node[field] === "string" && node[field].trim()) {
        const val = node[field].trim();
        if (!isPlaceholderOrEnvVarRef(val)) {
          pushKey(val, nodeLabel, nodeEnabled);
        }
      }
    }

    // 2. Array key fields
    for (const listField of ARRAY_KEY_FIELDS) {
      const list = node[listField];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === "string") {
          if (!isPlaceholderOrEnvVarRef(item)) {
            pushKey(item, nodeLabel, nodeEnabled);
          }
        } else if (item && typeof item === "object") {
          for (const f of DIRECT_KEY_FIELDS) {
            if (typeof item[f] === "string" && item[f].trim()) {
              pushKey(
                item[f],
                typeof item.label === "string" ? item.label : nodeLabel,
                item.enabled !== false
              );
              break;
            }
          }
        }
      }
    }

    // 3. Headers object
    if (node.headers && typeof node.headers === "object") {
      extractHeadersFromNode(node.headers, nodeLabel);
    }

    // 4. Environment variable style keys (`*_API_KEY`, `*_AUTH_TOKEN`, etc.)
    for (const [k, v] of Object.entries(node)) {
      if (typeof v !== "string" || !v.trim()) continue;
      const lowerK = k.toLowerCase();
      if (NON_SECRET_ENV_KEY_NAMES.has(lowerK)) continue;
      if (
        /(_api_key|_auth_token|_access_token|_secret_key|_subscription_key|_bearer_token|_token|_key)$/i.test(
          k
        ) &&
        !BASE_URL_FIELDS.includes(k) &&
        !PROJECT_ID_FIELDS.includes(k) &&
        !LOCATION_FIELDS.includes(k) &&
        !ACCOUNT_ID_FIELDS.includes(k) &&
        !RESOURCE_NAME_FIELDS.includes(k)
      ) {
        if (!isPlaceholderOrEnvVarRef(v)) {
          pushKey(v, nodeLabel || k, nodeEnabled);
        }
      }
    }

    // 5. Base URL, projectId, location, accountId, resourceName, deployment, models
    if (!rawBaseUrl) {
      const candidateUrl = pickFirstString(node, BASE_URL_FIELDS);
      if (candidateUrl && /^https?:\/\//i.test(candidateUrl)) {
        rawBaseUrl = candidateUrl;
      }
    }
    if (!projectId) {
      projectId = pickFirstString(node, PROJECT_ID_FIELDS);
    }
    if (!location) {
      location = pickFirstString(node, LOCATION_FIELDS);
    }
    if (!accountId) {
      accountId = pickFirstString(node, ACCOUNT_ID_FIELDS);
    }
    if (!resourceName) {
      resourceName = pickFirstString(node, RESOURCE_NAME_FIELDS);
    }
    if (!deployment) {
      deployment = pickFirstString(node, DEPLOYMENT_FIELDS);
    }

    extractModelsFromNode(node);

    // 6. Recurse into known container sections and preset-named sub-objects
    if (
      options.preset &&
      node[options.preset] &&
      typeof node[options.preset] === "object"
    ) {
      inspectNode(node[options.preset], depth + 1);
    }

    const containerKeys = [
      "env",
      "options",
      "credentials",
      "auth",
      "config",
      "settings",
      "provider",
      "providers",
      "models",
      "items",
      "customHeaders",
      "requestOptions"
    ];
    for (const cKey of containerKeys) {
      if (node[cKey] && typeof node[cKey] === "object") {
        inspectNode(node[cKey], depth + 1);
      }
    }

    // Also inspect top-level object children at depth <= 2 (e.g., `{ openai: { apiKey: "..." } }` or `{ providers: { anthropic: { options: { apiKey: "..." } } } }`)
    if (depth <= 2) {
      for (const [childKey, childVal] of Object.entries(node)) {
        if (
          childVal &&
          typeof childVal === "object" &&
          !containerKeys.includes(childKey) &&
          childKey !== "headers" &&
          childKey !== options.preset
        ) {
          inspectNode(childVal, depth + 1);
        }
      }
    }
  };

  inspectNode(cleaned, 0);

  const name = typeof cleaned.name === "string" ? cleaned.name.trim() : "";
  const slug = typeof cleaned.slug === "string" ? cleaned.slug.trim() : "";
  const formatType =
    (typeof cleaned.formatType === "string" && cleaned.formatType.trim()) ||
    (typeof cleaned.format_type === "string" && cleaned.format_type.trim()) ||
    "";

  // Smart Provider-Specific Base URL Resolution when rawBaseUrl is empty or has a template placeholder
  let suggestedBaseUrl = "";
  const effectivePreset =
    (typeof options.preset === "string" && options.preset.trim().toLowerCase()) ||
    (typeof cleaned.preset === "string" && cleaned.preset.trim().toLowerCase()) ||
    "";

  if (!rawBaseUrl || hasBaseUrlTemplatePlaceholder(rawBaseUrl)) {
    if (effectivePreset === "vertex" && projectId) {
      suggestedBaseUrl = buildVertexOpenAiBaseUrl(projectId, location || "us-central1");
    } else if (effectivePreset === "cloudflare" && accountId) {
      suggestedBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/ai/v1`;
    } else if (effectivePreset === "azure" && resourceName) {
      const cleanRes = encodeURIComponent(resourceName);
      suggestedBaseUrl = deployment
        ? `https://${cleanRes}.openai.azure.com/openai/deployments/${encodeURIComponent(
            deployment
          )}`
        : `https://${cleanRes}.openai.azure.com/openai/v1`;
    } else if ((effectivePreset === "bedrock" || effectivePreset === "bedrock-xai") && location) {
      const cleanRegion = location.toLowerCase();
      if (/^[a-z0-9-]+$/.test(cleanRegion)) {
        suggestedBaseUrl = `https://bedrock-runtime.${cleanRegion}.amazonaws.com/openai/v1`;
      }
    }

    if (rawBaseUrl && hasBaseUrlTemplatePlaceholder(rawBaseUrl) && suggestedBaseUrl) {
      rawBaseUrl = "";
    }
  }

  const isKeylessAllowed =
    Boolean(options.keyOptional) || KEYLESS_LOCAL_PRESETS.has(effectivePreset);

  if (apiKeys.length === 0 && !rawBaseUrl && !suggestedBaseUrl && !isKeylessAllowed) {
    throw createHttpError(
      400,
      "JSON must contain a valid Google Service Account (type: 'service_account'), Google ADC ('authorized_user'), OAuth client_secret JSON, or usable provider config (apiKey/api_key/key/token/env/headers or baseUrl)"
    );
  }

  return {
    mode: "config_json",
    apiKeys,
    ...(rawBaseUrl ? { baseUrl: rawBaseUrl } : {}),
    ...(suggestedBaseUrl ? { suggestedBaseUrl } : {}),
    ...(models.length > 0 ? { models } : {}),
    ...(name ? { name } : {}),
    ...(slug ? { slug } : {}),
    ...(formatType ? { formatType } : {}),
    ...(projectId ? { projectId } : {}),
    ...(location ? { location } : {}),
    ...(accountId ? { accountId } : {}),
    ...(resourceName ? { resourceName } : {}),
    ...(deployment ? { deployment } : {})
  };
}
