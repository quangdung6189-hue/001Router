"use strict";

/**
 * Bulletproof OpenAI-compatible SSE stream parser & tool_calls accumulator.
 *
 * Prevents the classic streaming tool-call corruption bug where upstreams (such as
 * Gemini / Cloud Code / proxy gateways) emit multiple parallel tool calls all using
 * `index: 0` across separate SSE chunks. Instead of concatenating tool names into
 * `list_fileslist_filesread_file()`, this accumulator isolates each logical call cleanly.
 */

function isCompleteJsonObject(str) {
  const s = String(str || "").trim();
  if (!s || !s.startsWith("{") || !s.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(s);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Safely parse tool arguments, even if an upstream sent trailing garbage or concatenated JSON objects.
 */
function safeParseToolArgs(rawArgs) {
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return rawArgs;
  }
  const str = String(rawArgs || "").trim();
  if (!str) return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Attempt recovery: extract first balanced JSON object if concatenated
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const recovered = JSON.parse(str.slice(start, i + 1));
            if (recovered && typeof recovered === "object") return recovered;
          } catch {
            // continue searching
          }
          start = -1;
        }
      }
    }
    return {};
  }
}

function createOpenAISSEAccumulator(roundIndex, knownToolNames = new Set()) {
  let currentEvent = "";
  let text = "";
  let reasoning = "";
  let finishReason = null;
  let usage = null;

  /** @type {Array<{ id: string, type: "function", function: { name: string, arguments: string } }>} */
  const orderedCalls = [];
  /** @type {Map<string, any>} */
  const callsById = new Map();
  /** @type {Map<number, any>} */
  const activeCallByIndex = new Map();

  const allocateNewCall = (tcIdx, explicitId) => {
    const id = explicitId || `call_r${roundIndex}_${orderedCalls.length}`;
    const entry = {
      id,
      type: "function",
      function: { name: "", arguments: "" }
    };
    orderedCalls.push(entry);
    callsById.set(id, entry);
    activeCallByIndex.set(tcIdx, entry);
    return entry;
  };

  const mergeToolCallDelta = (tc) => {
    if (!tc || typeof tc !== "object") return;
    const tcIdx = typeof tc.index === "number" && Number.isFinite(tc.index) ? tc.index : 0;
    const incomingId = typeof tc.id === "string" && tc.id.trim() ? tc.id.trim() : "";
    const incomingName = typeof tc.function?.name === "string" ? tc.function.name : "";
    const incomingArgs = typeof tc.function?.arguments === "string" ? tc.function.arguments : "";

    let entry = null;

    // 1) Exact ID match always binds to the same tool call
    if (incomingId && callsById.has(incomingId)) {
      entry = callsById.get(incomingId);
      activeCallByIndex.set(tcIdx, entry);
    } else if (incomingId) {
      // 2) Brand-new ID => ALWAYS a new tool call, even if tc.index collided at 0!
      entry = allocateNewCall(tcIdx, incomingId);
    } else {
      // 3) No ID in delta (standard OpenAI continuation chunk, OR id-less new call at same index)
      const existing = activeCallByIndex.get(tcIdx);
      if (!existing) {
        entry = allocateNewCall(tcIdx, "");
      } else {
        const existingHasCompleteName =
          Boolean(existing.function.name) &&
          (knownToolNames.has(existing.function.name) || isCompleteJsonObject(existing.function.arguments));
        const incomingLooksLikeNewCall =
          Boolean(incomingName) &&
          (existingHasCompleteName || knownToolNames.has(incomingName));

        if (incomingLooksLikeNewCall) {
          entry = allocateNewCall(tcIdx, "");
        } else {
          entry = existing;
        }
      }
    }

    if (incomingName) {
      // Guard against duplicate full-name repetition on the same call ID
      if (entry.function.name !== incomingName) {
        entry.function.name += incomingName;
      }
    }
    if (incomingArgs) {
      // Guard against duplicate complete-JSON repetition on the same call ID
      if (!(entry.function.arguments && entry.function.arguments === incomingArgs && isCompleteJsonObject(incomingArgs))) {
        entry.function.arguments += incomingArgs;
      }
    }
  };

  /**
   * Feed a single SSE line. Returns `{ deltaText, deltaReasoning, sawToolDelta }` or throws on explicit SSE error.
   */
  const feedLine = (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) {
      currentEvent = "";
      return null;
    }
    if (line.startsWith(":")) return null;
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      return null;
    }
    if (!line.startsWith("data:")) return null;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr || payloadStr === "[DONE]") return null;

    let parsed;
    try {
      parsed = JSON.parse(payloadStr);
    } catch {
      if (currentEvent === "error") {
        throw new Error(payloadStr || "Upstream streaming error");
      }
      return null;
    }

    if (currentEvent === "error" || parsed?.error) {
      const errMsg =
        parsed?.error?.message ||
        (typeof parsed?.error === "string" ? parsed.error : parsed?.message) ||
        "Upstream streaming error";
      throw new Error(errMsg);
    }

    if (parsed?.usage && typeof parsed.usage === "object") {
      usage = parsed.usage;
    }

    const choice = parsed?.choices?.[0];
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }

    const delta = choice?.delta || choice?.message || {};
    let sawToolDelta = false;
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        mergeToolCallDelta(tc);
        sawToolDelta = true;
      }
    }

    const deltaText = typeof delta.content === "string" ? delta.content : "";
    const deltaReasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";

    if (deltaText) text += deltaText;
    if (deltaReasoning) reasoning += deltaReasoning;

    if (!deltaText && !deltaReasoning && !sawToolDelta) return null;
    return { deltaText, deltaReasoning, sawToolDelta };
  };

  const getResult = () => ({
    text,
    reasoning,
    finishReason,
    usage,
    toolCalls: orderedCalls.filter((tc) => tc.function?.name)
  });

  return { feedLine, getResult };
}

module.exports = {
  isCompleteJsonObject,
  safeParseToolArgs,
  createOpenAISSEAccumulator
};
