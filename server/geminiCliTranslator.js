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
 * Schema fields Gemini's function-declaration `Schema` proto accepts. Anything else (`format`,
 * `title`, `default`, `examples`, `minLength`, `additionalProperties`, `x-*`, …) is rejected with
 * 400 "Unknown name … Cannot find field", and Antigravity's Claude models (VALIDATED mode) reject
 * `default` / `examples` too, so schema nodes keep only these.
 */
const GEMINI_SCHEMA_FIELDS = new Set([
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "nullable",
  "minimum",
  "maximum",
  "pattern"
]);

/** Gemini rejects an OBJECT schema without properties ("should be non-empty for OBJECT type"). */
const EMPTY_OBJECT_PLACEHOLDER = Object.freeze({
  type: "string",
  description: "Brief explanation of why you are calling this tool"
});

const MAX_SCHEMA_DEPTH = 32;

/** @param {any} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Inline local `#/$defs/X` / `#/definitions/X` references (Gemini has no `$ref`).
 * Unknown or too-deep references become an empty schema, which normalizes to a string.
 * @param {any} node
 * @param {Record<string, any>} defs
 * @param {number} depth
 * @returns {any}
 */
function resolveLocalRefs(node, defs, depth) {
  if (Array.isArray(node)) return node.map((child) => resolveLocalRefs(child, defs, depth));
  if (!isPlainObject(node)) return node;
  if (typeof node.$ref === "string") {
    const name = node.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)?.[1];
    const target = name ? defs[name] : undefined;
    const { $ref: _ref, ...rest } = node;
    if (!isPlainObject(target) || depth >= 8) return rest;
    return resolveLocalRefs({ ...target, ...rest }, defs, depth + 1);
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === "$defs" || key === "definitions" ? value : resolveLocalRefs(value, defs, depth);
  }
  return out;
}

/**
 * Pick the most structured branch of a union (object > array > typed scalar), as the
 * reference router does — Gemini cannot express unions.
 * @param {any[]} branches
 * @returns {any}
 */
function pickUnionBranch(branches) {
  let best = branches[0];
  let bestScore = -1;
  for (const branch of branches) {
    const score =
      branch.type === "object" || branch.properties
        ? 3
        : branch.type === "array" || branch.items
          ? 2
          : branch.type
            ? 1
            : 0;
    if (score > bestScore) {
      bestScore = score;
      best = branch;
    }
  }
  return best;
}

/**
 * Normalize one schema node into the subset Gemini accepts. Property NAMES are never filtered —
 * only schema keywords are (a parameter called `title` or `format` stays).
 * @param {any} input
 * @param {number} depth
 * @returns {Record<string, any>}
 */
function normalizeSchemaNode(input, depth) {
  if (depth > MAX_SCHEMA_DEPTH) return { type: "string" };
  let node = isPlainObject(input) ? { ...input } : {};

  if (Array.isArray(node.allOf)) {
    for (const member of node.allOf) {
      if (!isPlainObject(member)) continue;
      if (isPlainObject(member.properties)) {
        node.properties = { ...(isPlainObject(node.properties) ? node.properties : {}), ...member.properties };
      }
      if (Array.isArray(member.required)) {
        node.required = [...new Set([...(Array.isArray(node.required) ? node.required : []), ...member.required])];
      }
      if (!node.type && member.type) node.type = member.type;
      if (!node.description && typeof member.description === "string") node.description = member.description;
    }
    delete node.allOf;
  }

  for (const key of ["anyOf", "oneOf"]) {
    if (!Array.isArray(node[key])) continue;
    const branches = node[key].filter((b) => isPlainObject(b) && b.type !== "null");
    delete node[key];
    if (branches.length) {
      const { description } = node;
      node = { ...node, ...pickUnionBranch(branches) };
      if (typeof description === "string" && description) node.description = description;
      return normalizeSchemaNode(node, depth + 1);
    }
  }

  if (node.const !== undefined) {
    if (!Array.isArray(node.enum)) node.enum = [node.const];
    delete node.const;
  }

  if (Array.isArray(node.type)) {
    const types = node.type.filter((t) => typeof t === "string" && t !== "null");
    node.type =
      types.length === 0
        ? "string"
        : types.length === 1
          ? types[0]
          : node.properties && types.includes("object")
            ? "object"
            : node.items && types.includes("array")
              ? "array"
              : types.includes("string")
                ? "string"
                : types[0];
  }
  if (node.type === "null") node.type = "string";

  // Tuples (`prefixItems` or `items: [...]`) collapse into one merged item schema.
  const tuple = Array.isArray(node.prefixItems) ? node.prefixItems : Array.isArray(node.items) ? node.items : null;
  if (tuple) {
    const members = tuple.filter(isPlainObject);
    const objects = members.filter((m) => m.type === "object" || m.properties);
    if (objects.length) {
      const merged = { type: "object", properties: {} };
      for (const member of objects) Object.assign(merged.properties, member.properties || {});
      node.items = merged;
    } else {
      node.items = members[0] ? { type: members[0].type || "string" } : { type: "string" };
    }
    delete node.prefixItems;
  }

  if (Array.isArray(node.enum)) {
    // Gemini only takes string enums, on a string schema.
    const values = [...new Set(node.enum.filter((v) => v !== null && v !== undefined).map((v) => String(v)))];
    if (values.length) {
      node.enum = values;
      node.type = "string";
    } else {
      delete node.enum;
    }
  }

  if (typeof node.type !== "string" || !node.type) {
    node.type = node.properties ? "object" : node.items ? "array" : "string";
  }

  if (node.type === "object") {
    const properties = {};
    if (isPlainObject(node.properties)) {
      for (const [name, child] of Object.entries(node.properties)) {
        properties[name] = normalizeSchemaNode(child, depth + 1);
      }
    }
    let required = Array.isArray(node.required)
      ? [...new Set(node.required.filter((r) => typeof r === "string" && Object.hasOwn(properties, r)))]
      : [];
    if (!Object.keys(properties).length) {
      properties.reason = { ...EMPTY_OBJECT_PLACEHOLDER };
      required = ["reason"];
    }
    node.properties = properties;
    if (required.length) node.required = required;
    else delete node.required;
  } else {
    delete node.properties;
    delete node.required;
  }

  if (node.type === "array") {
    node.items = normalizeSchemaNode(isPlainObject(node.items) ? node.items : { type: "string" }, depth + 1);
  } else {
    delete node.items;
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (GEMINI_SCHEMA_FIELDS.has(key)) out[key] = value;
  }
  if (typeof out.description !== "string") delete out.description;
  if (typeof out.nullable !== "boolean") delete out.nullable;
  // Range only on numbers, pattern only on strings (Gemini ties each field to its type).
  const numeric = out.type === "number" || out.type === "integer";
  if (!numeric || typeof out.minimum !== "number") delete out.minimum;
  if (!numeric || typeof out.maximum !== "number") delete out.maximum;
  if (out.type !== "string" || typeof out.pattern !== "string") delete out.pattern;
  return out;
}

/**
 * Turn a tool's JSON Schema into parameters Gemini's functionDeclarations accept: local `$ref`s
 * inlined, `allOf` merged, unions / type arrays / tuples / `const` collapsed, enums as strings,
 * unsupported keywords dropped, and an empty object given a placeholder property.
 * @param {any} schema
 * @returns {Record<string, any>}
 */
function cleanSchema(schema) {
  const root = isPlainObject(schema) ? JSON.parse(JSON.stringify(schema)) : {};
  const defs = {
    ...(isPlainObject(root.definitions) ? root.definitions : {}),
    ...(isPlainObject(root.$defs) ? root.$defs : {})
  };
  const resolved = resolveLocalRefs(root, defs, 0);
  // Function parameters are always an object (a root union could otherwise pick a scalar branch).
  const out = normalizeSchemaNode({ ...resolved, type: "object" }, 0);
  return out.type === "object" ? out : normalizeSchemaNode({ type: "object" }, 0);
}

/**
 * Gemini 4 (Argon, Neon, Carbon, Hydrogen, …) removed the sampling parameters — forwarding
 * `temperature` / `topP` / `topK` fails the request — and accepts only the low / medium / high
 * thinking levels. Same test as the reference router.
 * @param {string} model
 * @returns {boolean}
 */
export function isGemini4Model(model) {
  return /(?:^|\/)gemini-4(?:$|[-.])/i.test(String(model || ""));
}

/**
 * Thought signature the reference router puts on the first functionCall of a replayed Antigravity
 * model turn. Gemini 3+/4 reject a functionCall without one ("missing thought_signature"), and
 * OpenAI-format clients never keep Google's signature in their history.
 */
const ANTIGRAVITY_THOUGHT_SIGNATURE =
  "EuwGCukGAXLI2nxwZIq54WWSoL/YN0P3TsDZ7zRnLi8g0S4aVr2HUGxvaHKySuY6HAVzcE0GPGjXrytLIldxthSvfxgUlJh6Qa9Z+Oj5QZBlYdg6HaJ6yuY5R7waE6rdwBsRf7Ft2j3DJ9rMi9qhWFqApewYtPhls3VHtuvND3l8Rm09+lbAXQs6KKWEWrxNLKTBkfpMgXhRERc/TQRMZu1twAablm6/Zk1tsYRvfWKLsNbeKF+CCojJdXJKvnR/8Ouuoa+Y2Ti20hcW7aZIIjZDFYPU//k6Ybmhg69J/imbFai2ckhfLaisqdDkdoIiBJScTOUvYqP6AE9d4MsydSC+UlhIMk4hoP76R8vUSCZRMkjOaDXstf/QoVZKbt94wyRZgAJ1G0BqI8L5ow86kLpA4wJEtxsRGymOE4bKUvApveBakYDNM9APkf+LbtbzWSseGjoZcSlycF9iN8Q2XNYKRrHbv3Lr5Y8JjdH/5y/6SHkNehTEZugaeGnSPSyCTWto1kQgHpxdWmhkLfJGNUGLmue7Mesj4TSms4J33mRpYVhNB/J333FCqIP0hr/E7BkkjEn7yZ4X7SQlh+xKPurapsnHRwiKmtsilmEFrnTE9iQr+pMr6M29qqFNv1tr5yumbaJw8JW9sB15tNsRv+dW6BjNanbsKz7HCgKUBc8tGy+7YuhXzAfViyRefcjK7eZW0Fbyt7AbybJTKz78W8NH7ye6LAwzOebXpeZ4D43fNIt8bKh26qgduSQv/7o+pAflkuqHZ99YWgHQ8h8OkZFi3eOiSYjsjhdZ/czWOdoPI/OnqIldzMPF5YlrKBLFX8VhRKVmqgsmWf5PHGulHhMkVlS+XG2UIseGy69ARa93D78Gsa+1n1kJr7EEB7Rh+27vUMxVYLdz1yMSvE5nalTAlg/ZeG8+XQ0cHuAI3KbQpHW2Q++RdXfm5JzD5WdJZUU+Zn8t8UUn85BH4RxZLeE0qJikgSsKoYVBc6YhiMjhPgkR95ReimY4Z0xCJdRo1gjexOFeODZMpQF6Yxnoic7IrdgsFA3iePTbFnPp3IAM1fAThWhXJUn3QInUOTd5o1qmTmn6REbL15g/JQNl+dqUoPkhleeb2V3kjqp1okmO3wMZbPknR3S1LZNmlS72/iBQUm+n2b/RCn4PjmM2";

/**
 * Competing-client branding that makes Antigravity answer a fake "429 Resource has been exhausted"
 * even with quota left. Same rule table as the reference router; applied to Antigravity only.
 * @type {Array<{ from: string | RegExp, to: string | ((match: string) => string) }>}
 */
const ANTIGRAVITY_PROMPT_REWRITES = [
  { from: "You are a Claude agent, built on Anthropic's Claude Agent SDK.", to: "" },
  {
    from: /You are Hermes(?: Agent)?(?:,\s*(?:an intelligent AI assistant|an AI assistant|an AI agent))?(?:,?\s*(?:built|created)\s+by\s+Nous Research)?\./gi,
    to: "You are an AI assistant."
  },
  // Claude Code prepends this line; OpenAI-format proxies of Claude Code pass it through.
  { from: /^x-anthropic-billing-header:[^\n]*(?:\r?\n)*/gim, to: "" },
  {
    from: /opencode/gi,
    to: (m) => (m === "OpenCode" ? "Antigravity" : m === "OPENCODE" ? "ANTIGRAVITY" : "antigravity")
  }
];

/**
 * Remove the competing-client markers Antigravity flags from a system prompt.
 * @param {string} text
 * @returns {string}
 */
export function rewriteAntigravitySystemText(text) {
  let out = String(text ?? "");
  for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES) {
    out = out.replaceAll(from, /** @type {any} */ (to));
  }
  return out;
}

/**
 * The line a system prompt introduces the assistant with ("You are X, …"), for error notes.
 * @param {string} text
 * @returns {string}
 */
export function systemPromptIdentity(text) {
  const s = String(text || "");
  const intro = s.match(/(?:^|[.!?]\s+|\n)\s*(You are [^\n.!?]{1,120})/)?.[1];
  const line = (intro || s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "").trim();
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/**
 * Gemini rejects a request whose functionCall ids repeat anywhere in the history, while OpenAI
 * tool_call ids are only unique within one assistant turn. Hand out the next free id.
 */
function createToolCallIdUniquifier() {
  const used = new Set();
  return (id) => {
    if (!id) return "";
    let candidate = id;
    let n = 2;
    while (used.has(candidate)) candidate = `${id}-${n++}`;
    used.add(candidate);
    return candidate;
  };
}

/**
 * Cloud Code reads a `$ref` key inside functionResponse.response as a pointer and rejects the
 * request; tool results that carry a JSON Schema document hit that. Rename the key.
 * @param {any} value
 * @param {number} [depth]
 * @returns {any}
 */
function sanitizeFunctionResponsePayload(value, depth = 0) {
  if (depth > 64) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeFunctionResponsePayload(v, depth + 1));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key === "$ref" ? "_ref" : key] = sanitizeFunctionResponsePayload(child, depth + 1);
  }
  return out;
}

/** @param {any} part */
function isEmptyPart(part) {
  if (!isPlainObject(part)) return true;
  const keys = Object.keys(part);
  return keys.length === 0 || (keys.length === 1 && keys[0] === "text" && !String(part.text ?? "").trim());
}

/**
 * Make a Gemini history the API accepts (same rules as the reference router):
 *  - empty parts dropped, adjacent same-role turns merged (parallel tool results become one turn);
 *  - every functionCall answered in the following user turn (missing answers filled);
 *  - Gemini 4: functionResponse parts last in their turn;
 *  - the history starts and ends with a user turn.
 * @param {any[]} contents
 * @param {{ gemini4?: boolean }} [options]
 * @returns {any[]}
 */
function normalizeGeminiContents(contents, options = {}) {
  const out = [];
  for (const c of contents) {
    const parts = (Array.isArray(c?.parts) ? c.parts : []).filter((p) => !isEmptyPart(p));
    if (!parts.length) continue;
    const last = out.at(-1);
    if (last && last.role === c.role) last.parts.push(...parts);
    else out.push({ role: c.role, parts: [...parts] });
  }

  for (let i = 0; i < out.length; i++) {
    if (out[i].role !== "model") continue;
    const calls = out[i].parts.filter((p) => p.functionCall);
    if (!calls.length) continue;
    const trailing = i === out.length - 1;
    let next = out[i + 1];
    if (!next || next.role !== "user") {
      next = { role: "user", parts: [] };
      out.splice(i + 1, 0, next);
    }
    const responses = next.parts.filter((p) => p.functionResponse);
    const answered = new Set(responses.map((p) => p.functionResponse.id).filter(Boolean));
    let unnamedAnswers = responses.filter((p) => !p.functionResponse.id).length;
    for (const call of calls) {
      const { id, name } = call.functionCall;
      if (id ? answered.has(id) : unnamedAnswers-- > 0) continue;
      next.parts.push({
        functionResponse: {
          ...(id ? { id } : {}),
          name,
          response: { result: trailing ? "Continue." : "" }
        }
      });
    }
  }

  if (options.gemini4) {
    for (const turn of out) {
      if (turn.role !== "user" || !turn.parts.some((p) => p.functionResponse)) continue;
      turn.parts = [
        ...turn.parts.filter((p) => !p.functionResponse),
        ...turn.parts.filter((p) => p.functionResponse)
      ];
    }
  }

  if (out.length && out[0].role !== "user") out.unshift({ role: "user", parts: [{ text: "..." }] });
  if (out.length && out.at(-1).role === "model") out.push({ role: "user", parts: [{ text: "Continue." }] });
  return out;
}

/**
 * Text of an OpenAI tool-message content (a string, or an array of text parts).
 * @param {any} content
 * @returns {string}
 */
function toolMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .join("");
  }
  return content === null || content === undefined ? "" : JSON.stringify(content);
}

/**
 * Convert an OpenAI chat request body into Gemini `contents` + config.
 *
 * `options.model` is the upstream model (Gemini 4 drops the sampling parameters);
 * `options.signature` is put on the first functionCall of every replayed model turn.
 *
 * @param {any} body
 * @param {{ model?: string, signature?: string }} [options]
 * @returns {{ contents: any[], systemInstruction?: any, generationConfig: any, tools?: any[] }}
 */
export function openAIToGeminiContents(body, options = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const gemini4 = isGemini4Model(options.model || body?.model || "");
  const signature = typeof options.signature === "string" ? options.signature : "";
  const contents = [];
  const systemTexts = [];
  const nextCallId = createToolCallIdUniquifier();
  /** Emitted functionCalls per OpenAI tool_call_id, oldest first, for pairing the results. */
  const pendingCalls = new Map();

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
        let signed = false;
        for (const tc of msg.tool_calls) {
          if (!tc?.function) continue;
          const name = sanitizeFunctionName(tc.function.name);
          const id = nextCallId(tc.id ? String(tc.id) : "");
          const part = {
            functionCall: {
              ...(id ? { id } : {}),
              name,
              args: tryParseJSON(tc.function.arguments || "{}") || {}
            }
          };
          // Only the first call of a parallel batch carries the signature (as Gemini emits it).
          if (signature && !signed) {
            part.thoughtSignature = signature;
            signed = true;
          }
          parts.push(part);
          if (tc.id) {
            const key = String(tc.id);
            if (!pendingCalls.has(key)) pendingCalls.set(key, []);
            pendingCalls.get(key).push({ id, name });
          }
        }
      }
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }

    if (role === "tool") {
      const key = String(msg.tool_call_id || "");
      const paired = key ? pendingCalls.get(key)?.shift() : undefined;
      const name = paired?.name || sanitizeFunctionName(toolCallNames[key] || "tool");
      const text = toolMessageText(msg.content);
      const parsed = tryParseJSON(text);
      const responseId = paired?.id || key;
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              ...(responseId ? { id: responseId } : {}),
              name,
              response: {
                result: parsed === null ? text : sanitizeFunctionResponsePayload(parsed)
              }
            }
          }
        ]
      });
    }
  }

  const generationConfig = {};
  if (!gemini4) {
    if (typeof body?.temperature === "number") generationConfig.temperature = body.temperature;
    if (typeof body?.top_p === "number") generationConfig.topP = body.top_p;
    if (typeof body?.top_k === "number") generationConfig.topK = body.top_k;
  }
  const maxTokens = body?.max_tokens ?? body?.max_completion_tokens;
  if (typeof maxTokens === "number") generationConfig.maxOutputTokens = maxTokens;

  let tools;
  if (Array.isArray(body?.tools) && body.tools.length) {
    const seen = new Set();
    const functionDeclarations = [];
    for (const t of body.tools) {
      if (t?.type !== "function" || !t.function?.name) continue;
      const name = sanitizeFunctionName(t.function.name);
      // Two tools that sanitize to the same name fail the whole request.
      if (seen.has(name)) continue;
      seen.add(name);
      functionDeclarations.push({
        name,
        description: String(t.function.description || ""),
        parameters: cleanSchema(t.function.parameters)
      });
    }
    if (functionDeclarations.length) tools = [{ functionDeclarations }];
  }

  return {
    contents: normalizeGeminiContents(contents, { gemini4 }),
    ...(systemTexts.length
      ? { systemInstruction: { role: "user", parts: [{ text: systemTexts.join("\n\n") }] } }
      : {}),
    generationConfig,
    ...(tools ? { tools } : {})
  };
}

/**
 * Cloud Code Assist expects `request.session_id` to be a *string of digits* — the proto field is
 * TYPE_STRING, so a JSON number is rejected with HTTP 400 "Invalid value at
 * 'request.session_id' (TYPE_STRING)", and a UUID or missing value makes the request look like a
 * non-CLI client (403 #3501). Match the official clients: a negative 63-bit decimal derived
 * deterministically from the project/model pair, e.g. "-4611686018427387904".
 * @param {string} seed
 * @returns {string}
 */
export function toNumericSessionId(seed) {
  const digest = crypto.createHash("sha256").update(String(seed || "gemini-cli")).digest();
  const n = digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${n.toString()}`;
}

/** Effort level -> Gemini 2.x thinkingBudget (Gemini CLI flavor, explicit "(level)" suffix only). */
const THINKING_LEVEL_TO_BUDGET = Object.freeze({
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 24576
});

/** Gemini 3+/4 `thinkingLevel` enum (what Antigravity models take instead of a budget). */
const GEMINI_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

/**
 * Output-token floor per thinking level, so thoughts cannot eat the whole answer
 * (same table as the reference router's `gemini-level` format).
 */
const GEMINI_LEVEL_OUTPUT_FLOOR = Object.freeze({
  minimal: 4096,
  low: 8192,
  medium: 16384,
  high: 65535
});

/**
 * Output-token floor for a thinking budget, so thoughts cannot eat the whole answer.
 * @param {number} budget
 * @returns {number}
 */
function thinkingOutputFloor(budget) {
  if (budget <= 1024) return 8192;
  if (budget <= 8192) return 16384;
  if (budget <= 24576) return 32768;
  return 65535;
}

/**
 * Turn a router model id into the id Google expects plus the thinking config to send.
 *
 * Antigravity catalogs effort-tiered models as `name(level)`, e.g.
 * `gemini-3.8-flash-medium(medium)`. The `(level)` part is NOT part of the upstream model name
 * — sending it verbatim makes Google answer 404 "Requested entity was not found".
 *
 * Thinking follows the reference router's wire format per model family:
 *  - Antigravity Gemini (3.x / 4): `thinkingLevel` from the "(level)" suffix or the "-<level>"
 *    tier in the name (`gemini-4-neon-medium` -> medium). An unknown tier such as "-xhigh" sends
 *    nothing, so Google applies the model's own default.
 *  - Antigravity Claude / GPT: no thinking config at all (the tier is in the model name).
 *  - Gemini CLI (Gemini 2.x): `thinkingBudget`, only for an explicit "(level)" suffix.
 *
 * A tierless friendly id (`gemini-3.8-flash`) follows the client's `reasoning_effort` when the
 * flavor knows a `<id>-<effort>` variant. With `opts.exact` (an id taken from the account's own
 * model catalog) neither aliases nor reasoning_effort change the id.
 *
 * @param {string} model
 * @param {any} body OpenAI chat body
 * @param {{ id?: string, resolveModel?: (m: string) => string } | null} flavor
 * @param {{ exact?: boolean }} [opts]
 * @returns {{ model: string, thinking: Record<string, any> | null, outputFloor: number }}
 */
export function resolveUpstreamModel(model, body, flavor, opts = {}) {
  const resolve =
    !opts.exact && typeof flavor?.resolveModel === "function" ? flavor.resolveModel : (m) => m;
  let requested = String(model || "");

  const effort =
    !opts.exact && typeof body?.reasoning_effort === "string"
      ? body.reasoning_effort.trim().toLowerCase()
      : "";
  const effortTier = effort === "xhigh" || effort === "max" ? "high" : effort === "minimal" ? "low" : effort;
  if (effortTier && THINKING_LEVEL_TO_BUDGET[effortTier] !== undefined) {
    const tiered = `${requested}-${effortTier}`;
    if (resolve(tiered) !== tiered) requested = tiered;
  }

  const resolved = resolve(requested);
  const suffix = resolved.match(/^(.*)\(([^()]+)\)\s*$/);
  const upstream = suffix ? suffix[1].trim() : resolved;
  const suffixLevel = suffix ? suffix[2].trim().toLowerCase() : "";

  if (flavor?.id === "antigravity") {
    if (!/^gemini-/i.test(upstream)) return { model: upstream, thinking: null, outputFloor: 0 };
    const nameTier = upstream.match(/-([a-z]+)$/i)?.[1]?.toLowerCase() || "";
    let level = suffixLevel || nameTier;
    if (!GEMINI_THINKING_LEVELS.has(level)) return { model: upstream, thinking: null, outputFloor: 0 };
    // Gemini 4 rejects thinkingLevel "minimal" with HTTP 400; its lowest level is "low".
    if (level === "minimal" && isGemini4Model(upstream)) level = "low";
    return {
      model: upstream,
      thinking: { thinkingLevel: level, includeThoughts: level !== "minimal" },
      outputFloor: GEMINI_LEVEL_OUTPUT_FLOOR[level]
    };
  }

  const budget = THINKING_LEVEL_TO_BUDGET[suffixLevel];
  if (budget === undefined) return { model: upstream, thinking: null, outputFloor: 0 };
  return {
    model: upstream,
    thinking: { thinkingBudget: budget, includeThoughts: true },
    outputFloor: thinkingOutputFloor(budget)
  };
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
 *    friendly model ids mapped to their upstream ids, Gemini thinking as `thinkingLevel`, output
 *    tokens capped, no `requestType` (sending one makes Google answer a detail-free 429), replayed
 *    tool calls signed, and the system prompt cleared of competing-client markers (those make
 *    Google answer a fake "429 Resource has been exhausted" too).
 *
 * @param {string} model
 * @param {any} body OpenAI chat body
 * @param {string} projectId
 * @param {{ flavor?: { id: string, envelopeUserAgent: string, maxOutputTokens: number, resolveModel: (m: string) => string }, exactModel?: boolean }} [options]
 *   `exactModel`: `model` is an id from the account's catalog — send it as is.
 * @returns {any}
 */
export function buildCloudCodeRequest(model, body, projectId, options = {}) {
  const flavor = options.flavor || null;
  const isAntigravity = flavor?.id === "antigravity";
  const { model: upstreamModel, thinking, outputFloor } = resolveUpstreamModel(
    model,
    body,
    flavor,
    { exact: options.exactModel === true }
  );
  const gemini = openAIToGeminiContents(body, {
    model: upstreamModel,
    ...(isAntigravity ? { signature: ANTIGRAVITY_THOUGHT_SIGNATURE } : {})
  });
  if (isAntigravity && gemini.systemInstruction) {
    const text = rewriteAntigravitySystemText(gemini.systemInstruction.parts[0].text).trim();
    if (text) gemini.systemInstruction = { role: "user", parts: [{ text }] };
    else delete gemini.systemInstruction;
  }

  const generationConfig = { ...(gemini.generationConfig || {}) };
  if (thinking) {
    // Thinking tokens count toward the output limit, so keep room for the answer.
    generationConfig.thinkingConfig = thinking;
    if (!(Number(generationConfig.maxOutputTokens) >= outputFloor)) {
      generationConfig.maxOutputTokens = outputFloor;
    }
  }
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
      // Keep Google's id when it sends one, so the result pairs with the same call next turn.
      const upstreamId = typeof part.functionCall.id === "string" ? part.functionCall.id.trim() : "";
      toolCalls.push({
        index: index++,
        id: upstreamId || `call_${crypto.randomBytes(8).toString("hex")}`,
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
 * Fold a `streamGenerateContent` body into one Cloud Code response, so a non-streaming client can
 * be served from the streaming RPC (the one the Antigravity IDE itself uses for chat). Adjacent
 * text parts of the same kind are joined; function calls, finish reason and usage are kept.
 * A body that is already one JSON object is returned parsed.
 *
 * @param {string} text SSE (`data: {...}` lines) or JSON
 * @returns {any | null} `{ response: { candidates: [...], usageMetadata? } }`, `{ error }`, or null
 */
export function aggregateCloudCodeStream(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  let frames = null;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return parsed;
      frames = parsed;
    } catch {
      // Not one JSON document: read it as SSE below.
    }
  }
  if (!frames) {
    frames = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      const data = m ? m[1].trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        frames.push(JSON.parse(data));
      } catch {
        // Skip a malformed frame; the rest still make a response.
      }
    }
  }
  if (!frames.length) return null;

  const parts = [];
  let finishReason = "";
  let usageMetadata = null;
  let error = null;
  for (const frame of frames) {
    if (frame?.error) {
      error = frame.error;
      continue;
    }
    const payload = unwrapCloudCodeResponse(frame);
    const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (!isPlainObject(part)) continue;
      const last = parts.at(-1);
      const joinable =
        typeof part.text === "string" &&
        !part.functionCall &&
        !part.thoughtSignature &&
        last &&
        typeof last.text === "string" &&
        !last.functionCall &&
        Boolean(last.thought) === Boolean(part.thought);
      if (joinable) last.text += part.text;
      else parts.push({ ...part });
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (payload?.usageMetadata) usageMetadata = payload.usageMetadata;
  }
  if (error && !parts.length) return { error };

  return {
    response: {
      candidates: [
        {
          content: { role: "model", parts },
          ...(finishReason ? { finishReason } : {})
        }
      ],
      ...(usageMetadata ? { usageMetadata } : {})
    }
  };
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
