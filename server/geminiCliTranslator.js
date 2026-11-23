import crypto from "node:crypto";

/**
 * OpenAI Chat Completions ⇄ Google Cloud Code Assist (`v1internal`) translation.
 *
 * The CLI upstream does not speak the public Gemini REST shape: every call is wrapped in a
 * Cloud Code envelope `{ project, model, requestId, request: { contents, ... } }` and the
 * response comes back as `{ response: { candidates: [...] } }`. This module does both
 * directions, streaming included, with no external dependencies.
 */

/** @param {string} value */
function sanitizeFunctionName(value) {
  let name = String(value || "_unknown").replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(name)) name = `_${name}`;
  return name.substring(0, 64);
}

/** @param {any} value */
function tryParseJSON(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Flatten an OpenAI content value (string | parts array) into Gemini parts.
 * @param {any} content
 * @returns {Array<Record<string, any>>}
 */
function contentToParts(content) {
  if (typeof content === "string") {
    return content.trim() ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push({ text: item.text });
    } else if (item.type === "image_url" && item.image_url?.url) {
      const url = String(item.image_url.url);
      const match = /^data:([^;]+);base64,(.*)$/.exec(url);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      } else {
        parts.push({ text: `[image] ${url}` });
      }
    }
  }
  return parts;
}

/**
 * Strip JSON-Schema keywords Gemini's functionDeclarations reject.
 *
 * Gemini's proto schema is narrower than JSON Schema: it rejects `exclusiveMinimum` /
 * `exclusiveMaximum` / `additionalProperties` / `$schema` / `$id` and has no `anyOf` branch for
 * null unions. It also accepts `items` only as a single object (tuple-style `items: [...]` is
 * rejected), so tuple arrays are collapsed into one merged item schema.
 *
 * @param {any} schema
 * @returns {any}
 */
function cleanSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };

  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return node;
    }
    if (!node || typeof node !== "object") return node;

    delete node.$schema;
    delete node.$id;
    delete node.$defs;
    delete node.definitions;
    delete node.additionalProperties;
    delete node.exclusiveMinimum;
    delete node.exclusiveMaximum;
    delete node.patternProperties;
    delete node.dependencies;
    delete node.unevaluatedProperties;
    delete node.propertyNames;
    delete node.$ref;

    if (Array.isArray(node.required) && node.required.length === 0) delete node.required;

    // `const` has no Gemini equivalent — surface it as a single-value enum instead of dropping it.
    if (node.const !== undefined) {
      node.enum = [node.const];
      delete node.const;
    }

    // Gemini cannot express null unions; keep the non-null branch only.
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
      const key = Array.isArray(node.anyOf) ? "anyOf" : "oneOf";
      const branches = node[key].filter((n) => n && n.type !== "null");
      delete node.anyOf;
      delete node.oneOf;
      if (branches.length === 1) {
        Object.assign(node, branches[0]);
        walk(node);
        return node;
      }
      if (branches.length > 1) node.anyOf = branches;
    }

    // Gemini rejects tuple arrays — collapse to the merged shape of the members.
    if (Array.isArray(node.items)) {
      const merged = { type: "object", properties: {} };
      let mergedType = "";
      for (const child of node.items) {
        if (!child || typeof child !== "object") continue;
        if (child.type && !mergedType) mergedType = child.type;
        if (child.properties) Object.assign(merged.properties, child.properties);
        if (Array.isArray(child.required)) merged.required = child.required;
        if (child.items) merged.items = child.items;
      }
      node.items = mergedType && mergedType !== "object" ? { type: mergedType } : merged;
    }

    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties)) {
        node.properties[key] = walk(node.properties[key]);
      }
    }
    if (node.items) node.items = walk(node.items);
    if (Array.isArray(node.anyOf)) node.anyOf = node.anyOf.map(walk);
    if (Array.isArray(node.enum)) node.enum = node.enum.filter((v) => v !== null);

    return node;
  };

  const cleaned = walk(JSON.parse(JSON.stringify(schema)));
  if (!cleaned || typeof cleaned !== "object") return { type: "object", properties: {} };
  return cleaned;
}

/**
 * Convert an OpenAI chat request body into Gemini `contents` + config.
 * @param {any} body
 * @returns {{ contents: any[], systemInstruction?: any, generationConfig: any, tools?: any[] }}
 */
export function openAIToGeminiContents(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const contents = [];
  const systemTexts = [];

  /** @type {Record<string, string>} */
  const toolCallNames = {};
  for (const msg of messages) {
    if (msg?.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id && tc?.function?.name) toolCallNames[tc.id] = tc.function.name;
      }
    }
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role;

    if (role === "system" || role === "developer") {
      for (const p of contentToParts(msg.content)) {
        if (p.text) systemTexts.push(p.text);
      }
      continue;
    }

    if (role === "user") {
      const parts = contentToParts(msg.content);
      if (parts.length) contents.push({ role: "user", parts });
      continue;
    }

    if (role === "assistant") {
      const parts = contentToParts(msg.content);
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (!tc?.function) continue;
          parts.push({
            functionCall: {
              name: sanitizeFunctionName(tc.function.name),
              args: tryParseJSON(tc.function.arguments || "{}") || {}
            }
          });
        }
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }

    if (role === "tool") {
      const name = toolCallNames[msg.tool_call_id] || "tool";
      const parsed = tryParseJSON(msg.content);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: sanitizeFunctionName(name),
              response: { result: parsed === null ? String(msg.content ?? "") : parsed }
            }
          }
        ]
      });
    }
  }

  const generationConfig = {};
  if (typeof body?.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body?.top_p === "number") generationConfig.topP = body.top_p;
  if (typeof body?.top_k === "number") generationConfig.topK = body.top_k;
  const maxTokens = body?.max_tokens ?? body?.max_completion_tokens;
  if (typeof maxTokens === "number") generationConfig.maxOutputTokens = maxTokens;

  let tools;
  if (Array.isArray(body?.tools) && body.tools.length) {
    const functionDeclarations = body.tools
      .filter((t) => t?.type === "function" && t.function?.name)
      .map((t) => ({
        name: sanitizeFunctionName(t.function.name),
        description: String(t.function.description || ""),
        parameters: cleanSchema(t.function.parameters)
      }));
    if (functionDeclarations.length) tools = [{ functionDeclarations }];
  }

  return {
    contents,
    ...(systemTexts.length
      ? { systemInstruction: { role: "user", parts: [{ text: systemTexts.join("\n\n") }] } }
      : {}),
    generationConfig,
    ...(tools ? { tools } : {})
  };
}

/**
 * Cloud Code Assist expects a numeric `sessionId` — a UUID or missing value makes the request
 * look like a non-CLI client and Google answers 403 "You do not have a valid license of this
 * product" (#3501). Derive a stable 64-bit-ish number from the project/model pair.
 * @param {string} seed
 * @returns {number}
 */
function toNumericSessionId(seed) {
  const digest = crypto.createHash("sha256").update(String(seed || "gemini-cli")).digest();
  // Keep it inside Number.MAX_SAFE_INTEGER while staying deterministic per seed.
  return digest.readUIntBE(0, 6);
}

/**
 * Deterministic RFC-4122-shaped (v5-style) UUID from a seed.
 * @param {string} seed
 * @returns {string}
 */
function uuidFromSeed(seed) {
  const bytes = crypto.createHash("sha256").update(String(seed || "cloud-code")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Wrap Gemini contents in the Cloud Code envelope the upstream requires.
 *
 * `options.flavor` (from geminiCliOAuth.getCloudCodeFlavor) selects the client dialect:
 *  - gemini_cli: `userAgent: "gemini-cli"`, `requestId: "req-<uuid>"`;
 *  - antigravity: `userAgent: "antigravity"`, `requestId: "agent/<conv>/<ts>/<traj>/<step>"`,
 *    friendly model ids mapped to their effort-suffixed upstream ids, output tokens capped, and
 *    no `requestType` (sending one makes Google answer a detail-free 429).
 *
 * @param {string} model
 * @param {any} body OpenAI chat body
 * @param {string} projectId
 * @param {{ flavor?: { id: string, envelopeUserAgent: string, maxOutputTokens: number, resolveModel: (m: string) => string } }} [options]
 * @returns {any}
 */
export function buildCloudCodeRequest(model, body, projectId, options = {}) {
  const flavor = options.flavor || null;
  const isAntigravity = flavor?.id === "antigravity";
  const upstreamModel = flavor?.resolveModel ? flavor.resolveModel(model) : model;
  const gemini = openAIToGeminiContents(body);

  const generationConfig = { ...(gemini.generationConfig || {}) };
  const cap = Number(flavor?.maxOutputTokens) || 0;
  if (cap > 0 && Number(generationConfig.maxOutputTokens) > cap) {
    generationConfig.maxOutputTokens = cap;
  }

  const sessionSeed = `${projectId || "p"}:${model}`;
  const contents = gemini.contents;
  let requestId = `req-${crypto.randomUUID()}`;
  if (isAntigravity) {
    const conversationId = uuidFromSeed(`antigravity:conversation:${sessionSeed}`);
    const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionSeed}:agent`);
    const step = Math.max(1, (Array.isArray(contents) ? contents.length : 1) * 2 - 1);
    requestId = `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
  }

  const envelope = {
    project: projectId || "",
    model: upstreamModel,
    userAgent: flavor?.envelopeUserAgent || "gemini-cli",
    requestId,
    request: {
      sessionId: toNumericSessionId(sessionSeed),
      contents,
      generationConfig,
      ...(gemini.systemInstruction ? { systemInstruction: gemini.systemInstruction } : {}),
      ...(gemini.tools ? { tools: gemini.tools } : {})
    }
  };
  if (gemini.tools) {
    envelope.request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }
  return envelope;
}

/**
 * Map a Gemini finishReason onto the OpenAI finish_reason vocabulary.
 * @param {string} reason
 * @returns {string}
 */
export function mapFinishReason(reason) {
  const r = String(reason || "").toUpperCase();
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "RECITATION" || r === "BLOCKLIST" || r === "PROHIBITED_CONTENT") {
    return "content_filter";
  }
  return "stop";
}

/**
 * Convert one Cloud Code / Gemini candidate into OpenAI `choices[0]` pieces.
 * @param {any} candidate
 * @returns {{ text: string, toolCalls: any[], finishReason: string }}
 */
export function candidateToOpenAIParts(candidate) {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  let text = "";
  const toolCalls = [];
  let index = 0;

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string" && !part.thought) text += part.text;
    if (part.functionCall?.name) {
      toolCalls.push({
        index: index++,
        id: `call_${crypto.randomBytes(8).toString("hex")}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }
  }

  return {
    text,
    toolCalls,
    finishReason: mapFinishReason(candidate?.finishReason)
  };
}

/**
 * Unwrap `{ response: {...} }` envelopes that Cloud Code Assist puts around Gemini payloads.
 * @param {any} data
 * @returns {any}
 */
export function unwrapCloudCodeResponse(data) {
  if (data && typeof data === "object" && data.response && typeof data.response === "object") {
    return data.response;
  }
  return data;
}

/**
 * Build a full OpenAI Chat Completions response from a non-streaming Cloud Code payload.
 * @param {any} data
 * @param {string} model
 * @returns {any}
 */
export function cloudCodeToOpenAIResponse(data, model) {
  const payload = unwrapCloudCodeResponse(data);
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  const { text, toolCalls, finishReason } = candidateToOpenAIParts(candidate);
  const usage = payload?.usageMetadata || {};

  const message = { role: "assistant", content: text || (toolCalls.length ? null : "") };
  if (toolCalls.length) message.tool_calls = toolCalls.map(({ index, ...rest }) => rest);

  return {
    id: `chatcmpl-${crypto.randomBytes(12).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length ? "tool_calls" : finishReason
      }
    ],
    usage: {
      prompt_tokens: Number(usage.promptTokenCount) || 0,
      completion_tokens: Number(usage.candidatesTokenCount) || 0,
      total_tokens:
        Number(usage.totalTokenCount) ||
        (Number(usage.promptTokenCount) || 0) + (Number(usage.candidatesTokenCount) || 0)
    }
  };
}

/**
 * Translate one SSE `data:` payload from `streamGenerateContent` into an OpenAI chunk.
 * Returns null when the payload carries nothing worth emitting.
 * @param {any} data
 * @param {string} model
 * @param {string} id
 * @returns {any | null}
 */
export function cloudCodeChunkToOpenAI(data, model, id) {
  const payload = unwrapCloudCodeResponse(data);
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  if (!candidate) return null;

  const { text, toolCalls, finishReason } = candidateToOpenAIParts(candidate);
  const delta = {};
  if (text) delta.content = text;
  if (toolCalls.length) delta.tool_calls = toolCalls;
  if (!Object.keys(delta).length && !candidate.finishReason) return null;

  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: candidate.finishReason ? (toolCalls.length ? "tool_calls" : finishReason) : null
      }
    ]
  };
}
