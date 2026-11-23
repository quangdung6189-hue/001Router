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
 * @param {any} schema
 * @returns {any}
 */
function cleanSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const clone = JSON.parse(JSON.stringify(schema));
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    delete node.$schema;
    delete node.$id;
    delete node.additionalProperties;
    delete node.exclusiveMinimum;
    delete node.exclusiveMaximum;
    if (Array.isArray(node.required) && node.required.length === 0) delete node.required;
    if (Array.isArray(node.anyOf)) {
      node.anyOf = node.anyOf.filter((n) => n && n.type !== "null");
      if (node.anyOf.length === 1) {
        Object.assign(node, node.anyOf[0]);
        delete node.anyOf;
      }
    }
    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties)) walk(node.properties[key]);
    }
    if (node.items) walk(node.items);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(walk);
  };
  walk(clone);
  return clone;
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
 * Wrap Gemini contents in the Cloud Code envelope the CLI upstream requires.
 * @param {string} model
 * @param {any} body OpenAI chat body
 * @param {string} projectId
 * @returns {any}
 */
export function buildCloudCodeRequest(model, body, projectId) {
  const gemini = openAIToGeminiContents(body);
  const envelope = {
    project: projectId || "",
    model,
    userAgent: "gemini-cli",
    requestId: `req-${crypto.randomUUID()}`,
    request: {
      contents: gemini.contents,
      generationConfig: gemini.generationConfig,
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
