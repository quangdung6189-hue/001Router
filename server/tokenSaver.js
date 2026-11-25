import crypto from "node:crypto";
import { applyRtkStructuredFilter, RTK_FILTER_CATALOG } from "./rtkFilters.js";
import {
  getPolicyGuardedDispatcher,
  readResponseTextBounded,
  upstreamFetch
} from "./proxy.js";

export { RTK_FILTER_CATALOG };

const COMPRESS_CACHE_MAX_ENTRIES = 256;
const COMPRESS_CACHE_MAX_CHARS = 6_000_000;
/** @type {Map<string, { text: string, savedChars: number, filter: string | null, weight: number }>} */
const compressLruCache = new Map();
let compressLruChars = 0;

/** @type {Map<string, { failures: number, openUntil: number }>} */
const headroomCircuitBreakers = new Map();
const HEADROOM_BREAKER_THRESHOLD = 2;
const HEADROOM_BREAKER_COOLDOWN_MS = 30_000;

function makeCompressCacheKey(text, limit) {
  const digest = crypto.createHash("sha256").update(text).digest("base64url");
  return `${limit}:${text.length}:${digest}`;
}

function getCachedCompression(key) {
  const hit = compressLruCache.get(key);
  if (!hit) return null;
  compressLruCache.delete(key);
  compressLruCache.set(key, hit);
  return hit;
}

function setCachedCompression(key, value) {
  const weight = value.text.length;
  if (weight > 512_000) return;
  if (compressLruCache.has(key)) {
    compressLruChars -= compressLruCache.get(key).weight;
    compressLruCache.delete(key);
  }
  compressLruCache.set(key, { ...value, weight });
  compressLruChars += weight;
  while (
    compressLruCache.size > COMPRESS_CACHE_MAX_ENTRIES ||
    compressLruChars > COMPRESS_CACHE_MAX_CHARS
  ) {
    const oldestKey = compressLruCache.keys().next().value;
    if (oldestKey === undefined) break;
    compressLruChars -= compressLruCache.get(oldestKey).weight;
    compressLruCache.delete(oldestKey);
  }
}

export const DEFAULT_MAX_CHARS = 20000;
export const DEFAULT_USER_THRESHOLD = 2000;

export const VALID_CAVEMAN_LEVELS = new Set([
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-ultra"
]);

export const VALID_PONYTAIL_LEVELS = new Set(["lite", "full", "ultra"]);

export const CAVEMAN_PROMPTS = {
  lite: "[Caveman Mode: LITE] Respond concisely. Skip filler, pleasantries, and redundant explanations. Keep technical accuracy and code blocks intact.",
  full: "[Caveman Mode: FULL] Respond in ultra-terse caveman style. Use minimal words, short fragments, no fluff, no intro/outro. Preserve exact code, JSON, and tool calls.",
  ultra: "[Caveman Mode: ULTRA] Maximum output compression. Telegraphic fragments only. Zero prose around code/answers. Minimum tokens possible while staying accurate.",
  "wenyan-lite": "[Caveman Mode: WENYAN-LITE] Respond in semi-classical terse prose (文言文 Lite). Drop filler/hedging; keep exact code, commands, paths, and identifiers.",
  wenyan: "[Caveman Mode: WENYAN] Respond in concise classical Chinese (文言文) for maximum token reduction. Keep English for code, commands, paths, API names, and error strings.",
  "wenyan-ultra": "[Caveman Mode: WENYAN-ULTRA] Extreme classical Chinese compression (文言文 Ultra). Telegraphic clauses only; keep exact code blocks and identifiers."
};

const PONYTAIL_SHARED =
  "You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written. " +
  "YAGNI ladder: 1) Does this need to exist? 2) Stdlib covers it? 3) Native platform covers it? 4) Installed dependency solves it? 5) One-liner? 6) Minimum working diff. " +
  "Never skip input validation at trust boundaries, error handling that prevents data loss, security, accessibility, or explicitly requested features.";

export const PONYTAIL_PROMPTS = {
  lite: `[Ponytail: LITE] ${PONYTAIL_SHARED} Build what is asked, and name the lazier alternative in one short line.`,
  full: `[Ponytail: FULL] ${PONYTAIL_SHARED} Enforce the YAGNI ladder: stdlib and native first, zero unrequested abstractions, shortest working diff.`,
  ultra: `[Ponytail: ULTRA] ${PONYTAIL_SHARED} YAGNI extremist: deletion before addition, ship the minimal diff/one-liner and challenge unnecessary scope concisely.`
};

/**
 * Check if the incoming request explicitly bypasses all token savers via
 * `X-9Router-Token-Saver: off` or `X-001Router-Token-Saver: off`.
 * @param {any} req
 * @returns {boolean}
 */
export function isTokenSaverBypassed(req) {
  const headers = req?.headers || {};
  const val = String(
    headers["x-9router-token-saver"] ??
      headers["x-001router-token-saver"] ??
      ""
  )
    .trim()
    .toLowerCase();
  return val === "off" || val === "false" || val === "0" || val === "none";
}

/**
 * Inject a system instruction into an OpenAI or Anthropic chat request body without mutating input.
 * @param {any} body
 * @param {"openai" | "anthropic"} format
 * @param {string} instruction
 * @returns {{ body: any, applied: boolean }}
 */
export function injectSystemInstruction(body, format = "openai", instruction = "") {
  const clean = typeof instruction === "string" ? instruction.trim() : "";
  if (!body || typeof body !== "object" || !clean) {
    return { body, applied: false };
  }

  if (format === "anthropic") {
    let nextSystem;
    if (typeof body.system === "string" && body.system.trim()) {
      nextSystem = body.system.includes(clean)
        ? body.system
        : `${clean}\n\n${body.system}`;
    } else if (Array.isArray(body.system)) {
      const exists = body.system.some((b) => b?.type === "text" && b.text === clean);
      nextSystem = exists ? body.system : [{ type: "text", text: clean }, ...body.system];
    } else {
      nextSystem = clean;
    }
    return { body: { ...body, system: nextSystem }, applied: true };
  }

  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const sysIdx = messages.findIndex(
    (m) => m && (m.role === "system" || m.role === "developer")
  );

  if (sysIdx >= 0) {
    const sysMsg = messages[sysIdx];
    if (typeof sysMsg.content === "string") {
      const merged = sysMsg.content.includes(clean)
        ? sysMsg.content
        : sysMsg.content.trim()
          ? `${clean}\n\n${sysMsg.content}`
          : clean;
      messages[sysIdx] = { ...sysMsg, content: merged };
    } else if (Array.isArray(sysMsg.content)) {
      const exists = sysMsg.content.some((b) => b?.type === "text" && b.text === clean);
      messages[sysIdx] = exists
        ? sysMsg
        : { ...sysMsg, content: [{ type: "text", text: clean }, ...sysMsg.content] };
    } else {
      messages[sysIdx] = { ...sysMsg, content: clean };
    }
  } else {
    messages.unshift({ role: "system", content: clean });
  }

  return { body: { ...body, messages }, applied: true };
}

/**
 * Inject Caveman Mode system instruction.
 */
export function applyCavemanMode(body, format = "openai", settings = {}) {
  if (!body || typeof body !== "object" || settings?.cavemanEnabled !== true) {
    return { body, cavemanApplied: false };
  }
  const level = VALID_CAVEMAN_LEVELS.has(settings.cavemanLevel)
    ? settings.cavemanLevel
    : "full";
  const instruction = CAVEMAN_PROMPTS[level];
  const { body: nextBody, applied } = injectSystemInstruction(body, format, instruction);
  return { body: nextBody, cavemanApplied: applied, level };
}

/**
 * Inject Ponytail Mode ("Lazy Senior Dev") system instruction.
 */
export function applyPonytailMode(body, format = "openai", settings = {}) {
  if (!body || typeof body !== "object" || settings?.ponytailEnabled !== true) {
    return { body, ponytailApplied: false };
  }
  const level = VALID_PONYTAIL_LEVELS.has(settings.ponytailLevel)
    ? settings.ponytailLevel
    : "full";
  const instruction = PONYTAIL_PROMPTS[level];
  const { body: nextBody, applied } = injectSystemInstruction(body, format, instruction);
  return { body: nextBody, ponytailApplied: applied, level };
}

/**
 * Inject user-authored Custom Global System Prompt.
 */
export function applyCustomPrompt(body, format = "openai", settings = {}) {
  if (
    !body ||
    typeof body !== "object" ||
    settings?.customPromptEnabled !== true ||
    typeof settings?.customPrompt !== "string" ||
    !settings.customPrompt.trim()
  ) {
    return { body, customPromptApplied: false };
  }
  const { body: nextBody, applied } = injectSystemInstruction(
    body,
    format,
    settings.customPrompt
  );
  return { body: nextBody, customPromptApplied: applied };
}

/**
 * Compress a text block using 9Router's 12-filter RTK structured detector first,
 * followed by whitespace/blank-line/dedup normalization and head/tail truncation.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {{ text: string, savedChars: number, filter: string | null }}
 */
export function compressText(text, maxChars = DEFAULT_MAX_CHARS) {
  if (typeof text !== "string" || text.length === 0) {
    return { text: text ?? "", savedChars: 0, filter: null };
  }

  const originalLen = text.length;
  const limit =
    Number.isFinite(maxChars) && maxChars > 0
      ? Math.floor(maxChars)
      : DEFAULT_MAX_CHARS;

  // Fast path: short single-line clean outputs cannot benefit from RTK/dedup/truncation
  if (originalLen < 300 && originalLen <= limit && text.indexOf("\n") === -1 && text.indexOf("\r") === -1) {
    const lastCh = text.charCodeAt(originalLen - 1);
    if (lastCh !== 32 && lastCh !== 9) {
      return { text, savedChars: 0, filter: null };
    }
  }

  const useCache = originalLen >= 1024;
  let cacheKey = "";
  if (useCache) {
    cacheKey = makeCompressCacheKey(text, limit);
    const cached = getCachedCompression(cacheKey);
    if (cached) {
      return { text: cached.text, savedChars: cached.savedChars, filter: cached.filter };
    }
  }

  // Step 0: Try structured 12-filter RTK auto-detector (git-diff, git-status, git-log, grep, find, ls, tree, build-output, etc.)
  let working = text;
  let matchedFilter = null;
  const rtkRes = applyRtkStructuredFilter(text);
  if (rtkRes.filter && rtkRes.savedChars > 0) {
    working = rtkRes.text;
    matchedFilter = rtkRes.filter;
  }

  // Steps 1 + 2 + 3 fused into a single linear pass:
  // normalize CRLF (only when '\r' present), strip trailing spaces/tabs, collapse >2 blank lines,
  // and deduplicate 3+ consecutive identical non-empty lines.
  const normalized = working.indexOf("\r") !== -1
    ? working.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    : working;
  const rawLines = normalized.split("\n");
  const outLines = [];
  let blankRun = 0;
  let prevLine = null;
  let sameRun = 0;

  const flushRun = () => {
    if (prevLine === null) return;
    if (sameRun >= 3) {
      outLines.push(prevLine, prevLine, `... (${sameRun - 2} similar lines)`);
      if (!matchedFilter) matchedFilter = "dedup-log";
    } else {
      for (let k = 0; k < sameRun; k++) outLines.push(prevLine);
    }
    prevLine = null;
    sameRun = 0;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    let end = raw.length;
    while (end > 0 && (raw.charCodeAt(end - 1) === 32 || raw.charCodeAt(end - 1) === 9)) end--;
    const line = end === raw.length ? raw : raw.slice(0, end);

    if (line === "") {
      flushRun();
      blankRun += 1;
      if (blankRun <= 2) outLines.push("");
      continue;
    }
    blankRun = 0;
    if (line === prevLine) {
      sameRun += 1;
    } else {
      flushRun();
      prevLine = line;
      sameRun = 1;
    }
  }
  flushRun();

  let result = outLines.join("\n");

  // Step 4: Truncate exceeding maxChars keeping head (60%) and tail (35%)
  if (result.length > limit) {
    let headLen = Math.floor(limit * 0.6);
    let tailLen = Math.floor(limit * 0.35);
    let omitted = result.length - headLen - tailLen;
    let marker = `\n... [truncated ${omitted} chars by 001Router Token Saver] ...\n`;

    if (headLen + tailLen + marker.length > limit && limit > marker.length + 20) {
      const budget = limit - marker.length;
      headLen = Math.floor(budget * (60 / 95));
      tailLen = budget - headLen;
      omitted = result.length - headLen - tailLen;
      marker = `\n... [truncated ${omitted} chars by 001Router Token Saver] ...\n`;
    }

    if (omitted > 0 && headLen + tailLen + marker.length < result.length) {
      result =
        result.slice(0, headLen) +
        marker +
        (tailLen > 0 ? result.slice(result.length - tailLen) : "");
      if (!matchedFilter) matchedFilter = "smart-truncate";
    }
  }

  const finalOut =
    result.length >= originalLen
      ? { text, savedChars: 0, filter: null }
      : {
          text: result,
          savedChars: originalLen - result.length,
          filter: matchedFilter || "normalize"
        };

  if (useCache) {
    setCachedCompression(cacheKey, finalOut);
  }
  return finalOut;
}

/**
 * Apply RTK Token Saver compression to an OpenAI or Anthropic request body without mutating the original.
 * @param {any} body
 * @param {"openai" | "anthropic"} format
 * @param {{ tokenSaverEnabled?: boolean, tokenSaverMaxChars?: number, tokenSaverUserThreshold?: number }} [settings]
 * @returns {{ body: any, savedChars: number, filters: string[] }}
 */
export function applyTokenSaver(body, format = "openai", settings = {}) {
  if (!body || !Array.isArray(body.messages) || settings.tokenSaverEnabled === false) {
    return { body, savedChars: 0, filters: [] };
  }

  const maxChars =
    typeof settings.tokenSaverMaxChars === "number" && settings.tokenSaverMaxChars > 0
      ? settings.tokenSaverMaxChars
      : DEFAULT_MAX_CHARS;
  const userThreshold =
    typeof settings.tokenSaverUserThreshold === "number" && settings.tokenSaverUserThreshold >= 0
      ? settings.tokenSaverUserThreshold
      : DEFAULT_USER_THRESHOLD;

  let totalSaved = 0;
  let anyChanged = false;
  const filterHits = new Set();

  const recordRes = (res) => {
    totalSaved += res.savedChars;
    anyChanged = true;
    if (res.filter) filterHits.add(res.filter);
  };

  const nextMessages = body.messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;

    if (format === "anthropic") {
      if (typeof msg.content === "string") {
        if (msg.role === "user" && msg.content.length > userThreshold) {
          const res = compressText(msg.content, maxChars);
          if (res.savedChars > 0) {
            recordRes(res);
            return { ...msg, content: res.text };
          }
        }
        return msg;
      }

      if (Array.isArray(msg.content)) {
        let blockChanged = false;
        const nextBlocks = msg.content.map((block) => {
          if (!block || typeof block !== "object") return block;

          if (block.type === "tool_result") {
            if (block.is_error === true) return block; // preserve error traces
            if (typeof block.content === "string") {
              const res = compressText(block.content, maxChars);
              if (res.savedChars > 0) {
                recordRes(res);
                blockChanged = true;
                return { ...block, content: res.text };
              }
            } else if (Array.isArray(block.content)) {
              let innerChanged = false;
              const nextInner = block.content.map((sub) => {
                if (sub && sub.type === "text" && typeof sub.text === "string") {
                  const res = compressText(sub.text, maxChars);
                  if (res.savedChars > 0) {
                    recordRes(res);
                    innerChanged = true;
                    return { ...sub, text: res.text };
                  }
                }
                return sub;
              });
              if (innerChanged) {
                blockChanged = true;
                return { ...block, content: nextInner };
              }
            }
            return block;
          }

          if (
            msg.role === "user" &&
            block.type === "text" &&
            typeof block.text === "string" &&
            block.text.length > userThreshold
          ) {
            const res = compressText(block.text, maxChars);
            if (res.savedChars > 0) {
              recordRes(res);
              blockChanged = true;
              return { ...block, text: res.text };
            }
          }

          return block;
        });

        if (blockChanged) {
          return { ...msg, content: nextBlocks };
        }
      }

      return msg;
    }

    // OpenAI format
    const isToolMsg = msg.role === "tool";
    const isUserMsg = msg.role === "user";
    if (!isToolMsg && !isUserMsg) return msg;

    if (typeof msg.content === "string") {
      if (isToolMsg || (isUserMsg && msg.content.length > userThreshold)) {
        const res = compressText(msg.content, maxChars);
        if (res.savedChars > 0) {
          recordRes(res);
          return { ...msg, content: res.text };
        }
      }
      return msg;
    }

    if (Array.isArray(msg.content)) {
      let partChanged = false;
      const nextParts = msg.content.map((part) => {
        if (part && part.type === "text" && typeof part.text === "string") {
          if (isToolMsg || (isUserMsg && part.text.length > userThreshold)) {
            const res = compressText(part.text, maxChars);
            if (res.savedChars > 0) {
              recordRes(res);
              partChanged = true;
              return { ...part, text: res.text };
            }
          }
        }
        return part;
      });
      if (partChanged) {
        return { ...msg, content: nextParts };
      }
    }

    return msg;
  });

  if (!anyChanged) {
    return { body, savedChars: 0, filters: [] };
  }

  return {
    body: { ...body, messages: nextMessages },
    savedChars: totalSaved,
    filters: [...filterHits]
  };
}

/**
 * Call an optional external Headroom proxy (`/v1/compress`) with fail-open semantics.
 * Never throws or blocks requests if Headroom is offline or times out.
 * @param {any} body
 * @param {"openai" | "anthropic"} format
 * @param {{ headroomEnabled?: boolean, headroomUrl?: string, headroomTimeoutMs?: number }} settings
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [opts]
 * @returns {Promise<{ body: any, headroomApplied: boolean, tokensSaved: number }>}
 */
export async function applyHeadroomCompression(body, format = "openai", settings = {}, opts = {}) {
  if (
    !body ||
    typeof body !== "object" ||
    settings?.headroomEnabled !== true ||
    !settings?.headroomUrl
  ) {
    return { body, headroomApplied: false, tokensSaved: 0 };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { body, headroomApplied: false, tokensSaved: 0 };
  }

  const baseUrl = String(settings.headroomUrl).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { body, headroomApplied: false, tokensSaved: 0 };
  }

  const timeoutMs =
    Number.isFinite(Number(settings.headroomTimeoutMs)) && Number(settings.headroomTimeoutMs) >= 200
      ? Math.min(Number(settings.headroomTimeoutMs), 30000)
      : 3000;
  const fetchFn = opts.fetchImpl || upstreamFetch;
  const useCustomFetch = Boolean(opts.fetchImpl);

  // Fast fail-open circuit breaker when local Headroom daemon is offline
  if (!useCustomFetch) {
    const breaker = headroomCircuitBreakers.get(baseUrl);
    if (breaker && breaker.openUntil > Date.now()) {
      return { body, headroomApplied: false, tokensSaved: 0 };
    }
  }

  const dispatcher = !useCustomFetch
    ? getPolicyGuardedDispatcher({
        blockPrivate: settings.allowPrivateUpstreams !== true,
        blockLoopback: settings.allowPrivateUpstreams === false
      })
    : undefined;

  try {
    const endpoint = `${baseUrl}/v1/compress`;
    // Only project simple OpenAI messages directly to keep Anthropic tool blocks safe
    if (format !== "openai") {
      return { body, headroomApplied: false, tokensSaved: 0 };
    }
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: body.messages,
        model: body.model || "gpt-4o"
      }),
      signal: AbortSignal.timeout(timeoutMs),
      ...(dispatcher ? { dispatcher } : {})
    });
    headroomCircuitBreakers.delete(baseUrl);
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {});
      return { body, headroomApplied: false, tokensSaved: 0 };
    }
    const text = await readResponseTextBounded(res, 15 * 1024 * 1024, timeoutMs).catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!Array.isArray(data?.messages) || data.messages.length === 0) {
      return { body, headroomApplied: false, tokensSaved: 0 };
    }
    return {
      body: { ...body, messages: data.messages },
      headroomApplied: true,
      tokensSaved: Number(data.tokens_saved) || 0
    };
  } catch {
    if (!useCustomFetch) {
      const prev = headroomCircuitBreakers.get(baseUrl) || { failures: 0, openUntil: 0 };
      const failures = prev.failures + 1;
      headroomCircuitBreakers.set(baseUrl, {
        failures,
        openUntil: failures >= HEADROOM_BREAKER_THRESHOLD ? Date.now() + HEADROOM_BREAKER_COOLDOWN_MS : 0
      });
    }
    // Fail-open by design
    return { body, headroomApplied: false, tokensSaved: 0 };
  }
}

/**
 * Probe Headroom external proxy health (`GET /health`).
 * @param {string} url
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @param {{ allowPrivateUpstreams?: boolean }} [policyOpts]
 */
export async function checkHeadroomStatus(
  url = "http://localhost:8787",
  fetchImpl = null,
  policyOpts = {}
) {
  const base = String(url || "http://localhost:8787").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    return { running: false, url: base, error: "Invalid URL" };
  }
  const fn = fetchImpl || upstreamFetch;
  const dispatcher = !fetchImpl
    ? getPolicyGuardedDispatcher({
        blockPrivate: policyOpts.allowPrivateUpstreams !== true,
        blockLoopback: policyOpts.allowPrivateUpstreams === false
      })
    : undefined;
  const started = Date.now();
  try {
    const res = await fn(`${base}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2500),
      ...(dispatcher ? { dispatcher } : {})
    });
    await res.body?.cancel?.().catch(() => {});
    return {
      running: res.ok,
      online: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
      url: base
    };
  } catch (err) {
    return {
      running: false,
      online: false,
      status: 0,
      latencyMs: Date.now() - started,
      url: base,
      error: err?.message || "Headroom proxy unreachable"
    };
  }
}
