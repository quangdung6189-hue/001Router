import { nanoid } from "nanoid";

/**
 * Safely parse JSON tool arguments into an object.
 * @param {unknown} raw
 * @returns {Record<string, any>}
 */
function safeParseToolInput(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return {};
  }
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { raw: trimmed };
  }
}

/**
 * Extract plain text from string or content block array.
 * @param {unknown} content
 * @returns {string}
 */
function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item && item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (item && typeof item === "object") {
      parts.push(JSON.stringify(item));
    }
  }
  return parts.join("\n");
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 * @param {string | null | undefined} finishReason
 * @returns {string}
 */
export function mapOpenAIFinishToAnthropicStop(finishReason) {
  switch (finishReason) {
    case "stop":
    case "content_filter":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Map Anthropic stop_reason to OpenAI finish_reason.
 * @param {string | null | undefined} stopReason
 * @returns {string}
 */
export function mapAnthropicStopToOpenAIFinish(stopReason) {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

/**
 * Format an Anthropic SSE frame (`event:` + `data:`).
 * @param {string} eventName
 * @param {any} data
 * @returns {string}
 */
export function formatAnthropicSSE(eventName, data) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create an incremental SSE frame parser capable of handling arbitrary TCP/stream chunk splits.
 * @param {(evt: { event: string, data: string }) => void} onEvent
 */
export function createSSEParser(onEvent) {
  let buffer = "";
  let currentEvent = "";
  let dataLines = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      currentEvent = "";
      return;
    }
    const payload = dataLines.join("\n");
    const eventName = currentEvent || "message";
    currentEvent = "";
    dataLines = [];
    onEvent({ event: eventName, data: payload });
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      const val = line.slice(5);
      dataLines.push(val.startsWith(" ") ? val.slice(1) : val);
    }
  };

  return {
    feed(chunkText) {
      buffer += chunkText;
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        processLine(line);
      }
    },
    flush() {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = "";
      }
      dispatch();
    }
  };
}

/**
 * Convert an Anthropic `/v1/messages` request body into an OpenAI `/v1/chat/completions` request body.
 * Pure structural translation (no header spoofing or OAuth injection).
 * @param {any} anthropicReq
 * @param {string} upstreamModel
 * @returns {any}
 */
export function claudeToOpenAIRequest(anthropicReq, upstreamModel) {
  const messages = [];

  // System prompt (string or array of text blocks)
  if (typeof anthropicReq.system === "string" && anthropicReq.system.trim() !== "") {
    messages.push({ role: "system", content: anthropicReq.system });
  } else if (Array.isArray(anthropicReq.system)) {
    const sysText = anthropicReq.system
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n\n");
    if (sysText.trim() !== "") {
      messages.push({ role: "system", content: sysText });
    }
  }

  for (const msg of anthropicReq.messages || []) {
    if (!msg || !msg.role) continue;

    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: "" });
      continue;
    }

    if (msg.role === "user") {
      const userParts = [];
      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;

        if (block.type === "tool_result") {
          let resultText = extractText(block.content);
          if (block.is_error && resultText === "") {
            resultText = "[Error]";
          }
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id || "",
            content: resultText
          });
        } else if (block.type === "text") {
          userParts.push({ type: "text", text: block.text ?? "" });
        } else if (block.type === "image" && block.source) {
          if (block.source.type === "base64" && block.source.data) {
            const mediaType = block.source.media_type || "image/png";
            userParts.push({
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${block.source.data}`
              }
            });
          } else if (block.source.type === "url" && block.source.url) {
            userParts.push({
              type: "image_url",
              image_url: { url: block.source.url }
            });
          }
        }
      }

      if (userParts.length > 0) {
        const hasImages = userParts.some((p) => p.type === "image_url");
        if (!hasImages) {
          messages.push({
            role: "user",
            content: userParts.map((p) => p.text).join("\n")
          });
        } else {
          messages.push({
            role: "user",
            content: userParts
          });
        }
      }
      continue;
    }

    if (msg.role === "assistant") {
      const textParts = [];
      const toolCalls = [];

      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id || `call_${nanoid(12)}`,
            type: "function",
            function: {
              name: block.name || "tool",
              arguments:
                typeof block.input === "string"
                  ? block.input
                  : JSON.stringify(block.input ?? {})
            }
          });
        }
      }

      const combinedText = textParts.join("");
      const outMsg = {
        role: "assistant",
        content: combinedText || (toolCalls.length > 0 ? null : "")
      };
      if (toolCalls.length > 0) {
        outMsg.tool_calls = toolCalls;
      }
      messages.push(outMsg);
    }
  }

  const out = {
    model: upstreamModel,
    messages
  };

  if (typeof anthropicReq.max_tokens === "number") {
    out.max_tokens = anthropicReq.max_tokens;
  }
  if (typeof anthropicReq.temperature === "number") {
    out.temperature = anthropicReq.temperature;
  }
  if (typeof anthropicReq.top_p === "number") {
    out.top_p = anthropicReq.top_p;
  }
  if (Array.isArray(anthropicReq.stop_sequences) && anthropicReq.stop_sequences.length > 0) {
    out.stop = anthropicReq.stop_sequences;
  }
  if (typeof anthropicReq.stream === "boolean") {
    out.stream = anthropicReq.stream;
    if (anthropicReq.stream) {
      out.stream_options = { include_usage: true };
    }
  }

  if (Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0) {
    out.tools = anthropicReq.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.input_schema || { type: "object", properties: {} }
      }
    }));
  }

  if (anthropicReq.tool_choice) {
    const tc = anthropicReq.tool_choice;
    if (tc.type === "auto") {
      out.tool_choice = "auto";
    } else if (tc.type === "any") {
      out.tool_choice = "required";
    } else if (tc.type === "none") {
      out.tool_choice = "none";
    } else if (tc.type === "tool" && tc.name) {
      out.tool_choice = {
        type: "function",
        function: { name: tc.name }
      };
    }
  }

  return out;
}

/**
 * Convert a non-streaming OpenAI Chat Completions response into an Anthropic Message response.
 * @param {any} openaiResp
 * @param {string} requestedModel
 * @returns {any}
 */
export function openaiToClaudeResponse(openaiResp, requestedModel) {
  const choice = openaiResp?.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];

  const reasoning = msg.reasoning_content ?? msg.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    content.push({ type: "thinking", thinking: reasoning });
  }

  if (typeof msg.content === "string" && msg.content.length > 0) {
    content.push({ type: "text", text: msg.content });
  } else if (Array.isArray(msg.content)) {
    const text = extractText(msg.content);
    if (text.length > 0) {
      content.push({ type: "text", text });
    }
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id || `toolu_${nanoid(12)}`,
        name: tc.function?.name || "tool",
        input: safeParseToolInput(tc.function?.arguments)
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const rawId = openaiResp?.id ? String(openaiResp.id) : nanoid(16);
  const msgId = rawId.startsWith("msg_") ? rawId : `msg_${rawId}`;

  return {
    id: msgId,
    type: "message",
    role: "assistant",
    model: requestedModel || openaiResp?.model || "unknown",
    content,
    stop_reason: mapOpenAIFinishToAnthropicStop(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp?.usage?.prompt_tokens ?? 0,
      output_tokens: openaiResp?.usage?.completion_tokens ?? 0
    }
  };
}

/**
 * Stateful stream transformer converting OpenAI SSE chunks into exact Anthropic SSE events:
 * message_start -> (content_block_start -> content_block_delta* -> content_block_stop)* -> message_delta -> message_stop.
 * @param {string} requestedModel
 */
export function createOpenAIToClaudeStreamTransformer(requestedModel) {
  let started = false;
  let finished = false;
  let msgId = `msg_${nanoid(16)}`;
  let nextBlockIndex = 0;
  /** @type {{ index: number, type: "thinking" | "text" | "tool_use", toolIndex?: number } | null} */
  let activeBlock = null;
  /** @type {Map<number, { index: number, type: "tool_use", toolIndex: number }>} */
  const toolCallMap = new Map();
  let finishReason = null;
  let inputTokens = 0;
  let outputTokens = 0;

  const ensureStarted = (out) => {
    if (started) return;
    started = true;
    out.push(
      formatAnthropicSSE("message_start", {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          model: requestedModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: inputTokens,
            output_tokens: 0
          }
        }
      })
    );
  };

  const closeActiveBlock = (out) => {
    if (!activeBlock) return;
    out.push(
      formatAnthropicSSE("content_block_stop", {
        type: "content_block_stop",
        index: activeBlock.index
      })
    );
    activeBlock = null;
  };

  return {
    /**
     * Process a parsed OpenAI SSE chunk object.
     * @param {any} chunk
     * @returns {string} Formatted Anthropic SSE output (may be empty if nothing to emit yet)
     */
    pushChunk(chunk) {
      if (finished || !chunk || typeof chunk !== "object") return "";
      const out = [];

      if (!started && chunk.id) {
        const rawId = String(chunk.id);
        msgId = rawId.startsWith("msg_") ? rawId : `msg_${rawId}`;
      }

      if (chunk.usage) {
        if (typeof chunk.usage.prompt_tokens === "number") {
          inputTokens = chunk.usage.prompt_tokens;
        }
        if (typeof chunk.usage.completion_tokens === "number") {
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (choice || chunk.usage) {
        ensureStarted(out);
      }

      if (delta && typeof delta === "object") {
        // 1. Thinking / reasoning delta
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === "string" && reasoning.length > 0) {
          if (!activeBlock || activeBlock.type !== "thinking") {
            closeActiveBlock(out);
            const idx = nextBlockIndex++;
            activeBlock = { index: idx, type: "thinking" };
            out.push(
              formatAnthropicSSE("content_block_start", {
                type: "content_block_start",
                index: idx,
                content_block: { type: "thinking", thinking: "" }
              })
            );
          }
          out.push(
            formatAnthropicSSE("content_block_delta", {
              type: "content_block_delta",
              index: activeBlock.index,
              delta: { type: "thinking_delta", thinking: reasoning }
            })
          );
        }

        // 2. Text delta
        if (typeof delta.content === "string" && delta.content.length > 0) {
          if (!activeBlock || activeBlock.type !== "text") {
            closeActiveBlock(out);
            const idx = nextBlockIndex++;
            activeBlock = { index: idx, type: "text" };
            out.push(
              formatAnthropicSSE("content_block_start", {
                type: "content_block_start",
                index: idx,
                content_block: { type: "text", text: "" }
              })
            );
          }
          out.push(
            formatAnthropicSSE("content_block_delta", {
              type: "content_block_delta",
              index: activeBlock.index,
              delta: { type: "text_delta", text: delta.content }
            })
          );
        }

        // 3. Tool call deltas
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const tcIdx = tc.index ?? 0;
            let entry = toolCallMap.get(tcIdx);
            if (!entry) {
              closeActiveBlock(out);
              const idx = nextBlockIndex++;
              const toolId = tc.id || `toolu_${nanoid(12)}`;
              const toolName = tc.function?.name || "tool";
              entry = { index: idx, type: "tool_use", toolIndex: tcIdx };
              toolCallMap.set(tcIdx, entry);
              activeBlock = entry;
              out.push(
                formatAnthropicSSE("content_block_start", {
                  type: "content_block_start",
                  index: idx,
                  content_block: {
                    type: "tool_use",
                    id: toolId,
                    name: toolName,
                    input: {}
                  }
                })
              );
            }
            const argsPart = tc.function?.arguments;
            if (typeof argsPart === "string" && argsPart.length > 0) {
              if (activeBlock && activeBlock.index === entry.index) {
                out.push(
                  formatAnthropicSSE("content_block_delta", {
                    type: "content_block_delta",
                    index: entry.index,
                    delta: {
                      type: "input_json_delta",
                      partial_json: argsPart
                    }
                  })
                );
              }
            }
          }
        }
      }

      if (choice?.finish_reason) {
        finishReason = mapOpenAIFinishToAnthropicStop(choice.finish_reason);
      }

      return out.join("");
    },

    /**
     * Close any open content block and emit `message_delta` + `message_stop`.
     * @returns {string}
     */
    finalize() {
      if (finished) return "";
      finished = true;
      const out = [];
      ensureStarted(out);
      closeActiveBlock(out);

      const finalStop =
        finishReason || (toolCallMap.size > 0 ? "tool_use" : "end_turn");

      out.push(
        formatAnthropicSSE("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: finalStop,
            stop_sequence: null
          },
          usage: {
            output_tokens: outputTokens
          }
        })
      );
      out.push(
        formatAnthropicSSE("message_stop", {
          type: "message_stop"
        })
      );
      return out.join("");
    },

    getUsage() {
      return {
        promptTokens: inputTokens,
        completionTokens: outputTokens
      };
    }
  };
}

/**
 * Convert an OpenAI `/v1/chat/completions` request body into an Anthropic `/v1/messages` request body.
 * Merges consecutive same-role messages (e.g. multiple consecutive `tool` responses) to satisfy Anthropic's
 * strict alternating user/assistant message sequence requirement.
 * @param {any} openaiReq
 * @param {string} upstreamModel
 * @returns {any}
 */
export function openaiToClaudeRequest(openaiReq, upstreamModel) {
  const systemParts = [];
  const rawClaudeMsgs = [];

  for (const msg of openaiReq.messages || []) {
    if (!msg || !msg.role) continue;

    if (msg.role === "system" || msg.role === "developer") {
      const txt = extractText(msg.content);
      if (txt.trim() !== "") {
        systemParts.push(txt);
      }
      continue;
    }

    if (msg.role === "tool") {
      rawClaudeMsgs.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id || "",
            content: extractText(msg.content)
          }
        ]
      });
      continue;
    }

    if (msg.role === "user") {
      const blocks = [];
      if (typeof msg.content === "string") {
        blocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "text") {
            blocks.push({ type: "text", text: part.text ?? "" });
          } else if (part.type === "image_url" && part.image_url?.url) {
            const url = String(part.image_url.url);
            const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/);
            if (dataMatch) {
              blocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: dataMatch[1],
                  data: dataMatch[2]
                }
              });
            } else {
              blocks.push({
                type: "image",
                source: { type: "url", url }
              });
            }
          }
        }
      }
      const nonEmptyBlocks = blocks.filter((b) => b.type !== "text" || b.text !== "");
      rawClaudeMsgs.push({
        role: "user",
        content: nonEmptyBlocks.length > 0 ? nonEmptyBlocks : [{ type: "text", text: " " }]
      });
      continue;
    }

    if (msg.role === "assistant") {
      const blocks = [];
      if (typeof msg.content === "string" && msg.content.length > 0) {
        blocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        const text = extractText(msg.content);
        if (text.length > 0) {
          blocks.push({ type: "text", text });
        }
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: "tool_use",
            id: tc.id || `toolu_${nanoid(12)}`,
            name: tc.function?.name || "tool",
            input: safeParseToolInput(tc.function?.arguments)
          });
        }
      }

      if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
      }
      rawClaudeMsgs.push({ role: "assistant", content: blocks });
    }
  }

  // Merge consecutive same-role messages so roles strictly alternate
  const mergedMessages = [];
  for (const msg of rawClaudeMsgs) {
    const prev = mergedMessages[mergedMessages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = [...prev.content, ...msg.content];
    } else {
      mergedMessages.push({ role: msg.role, content: [...msg.content] });
    }
  }

  const out = {
    model: upstreamModel,
    max_tokens: openaiReq.max_tokens ?? openaiReq.max_completion_tokens ?? 4096,
    messages: mergedMessages
  };

  if (systemParts.length > 0) {
    out.system = systemParts.join("\n\n");
  }
  if (typeof openaiReq.temperature === "number") {
    out.temperature = Math.min(1, Math.max(0, openaiReq.temperature));
  }
  if (typeof openaiReq.top_p === "number") {
    out.top_p = openaiReq.top_p;
  }
  if (typeof openaiReq.stop === "string") {
    out.stop_sequences = [openaiReq.stop];
  } else if (Array.isArray(openaiReq.stop) && openaiReq.stop.length > 0) {
    out.stop_sequences = openaiReq.stop;
  }
  if (typeof openaiReq.stream === "boolean") {
    out.stream = openaiReq.stream;
  }

  if (Array.isArray(openaiReq.tools) && openaiReq.tools.length > 0) {
    out.tools = openaiReq.tools
      .filter((t) => t && t.type === "function" && t.function)
      .map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        input_schema: t.function.parameters || { type: "object", properties: {} }
      }));
  }

  if (openaiReq.tool_choice && Array.isArray(out.tools) && out.tools.length > 0) {
    const tc = openaiReq.tool_choice;
    if (tc === "auto") {
      out.tool_choice = { type: "auto" };
    } else if (tc === "required") {
      out.tool_choice = { type: "any" };
    } else if (tc === "none") {
      out.tool_choice = { type: "none" };
    } else if (typeof tc === "object" && tc.type === "function" && tc.function?.name) {
      out.tool_choice = { type: "tool", name: tc.function.name };
    }
  }

  return out;
}

/**
 * Convert a non-streaming Anthropic `/v1/messages` response into an OpenAI Chat Completions response.
 * @param {any} anthropicResp
 * @param {string} requestedModel
 * @returns {any}
 */
export function claudeToOpenAIResponse(anthropicResp, requestedModel) {
  const blocks = Array.isArray(anthropicResp?.content) ? anthropicResp.content : [];
  const thinkingParts = [];
  const textParts = [];
  const toolCalls = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "thinking" && typeof block.thinking === "string") {
      thinkingParts.push(block.thinking);
    } else if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id || `call_${nanoid(12)}`,
        type: "function",
        function: {
          name: block.name || "tool",
          arguments:
            typeof block.input === "string"
              ? block.input
              : JSON.stringify(block.input ?? {})
        }
      });
    }
  }

  const text = textParts.join("");
  const thinking = thinkingParts.join("");

  const message = {
    role: "assistant",
    content: text || (toolCalls.length > 0 ? null : "")
  };
  if (thinking) {
    message.reasoning_content = thinking;
  }
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  const finishReason = anthropicResp?.stop_reason
    ? mapAnthropicStopToOpenAIFinish(anthropicResp.stop_reason)
    : toolCalls.length > 0
      ? "tool_calls"
      : "stop";

  const promptTokens = anthropicResp?.usage?.input_tokens ?? 0;
  const completionTokens = anthropicResp?.usage?.output_tokens ?? 0;

  return {
    id: anthropicResp?.id || `chatcmpl-${nanoid(16)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel || anthropicResp?.model || "unknown",
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };
}

/**
 * Stateful stream transformer converting Anthropic SSE events into OpenAI Chat Completions SSE chunks.
 * @param {string} requestedModel
 */
export function createClaudeToOpenAIStreamTransformer(requestedModel) {
  let msgId = `chatcmpl-${nanoid(16)}`;
  const created = Math.floor(Date.now() / 1000);
  let inputTokens = 0;
  let outputTokens = 0;
  let nextToolCallIndex = 0;
  /** @type {Map<number, number>} */
  const blockToToolIdx = new Map();
  let finishSent = false;
  let doneSent = false;

  const formatChunk = (delta, finishReason = null, usage = undefined) => {
    const payload = {
      id: msgId,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason
        }
      ]
    };
    if (usage) {
      payload.usage = usage;
    }
    return `data: ${JSON.stringify(payload)}\n\n`;
  };

  return {
    /**
     * Process a parsed Anthropic SSE event payload.
     * @param {string} eventName
     * @param {any} data
     * @returns {string}
     */
    pushEvent(eventName, data) {
      if (!data || typeof data !== "object") return "";
      const type = data.type || eventName;

      if (type === "message_start") {
        if (data.message?.id) {
          msgId = data.message.id;
        }
        if (typeof data.message?.usage?.input_tokens === "number") {
          inputTokens = data.message.usage.input_tokens;
        }
        return formatChunk({ role: "assistant", content: "" }, null);
      }

      if (type === "content_block_start") {
        if (data.content_block?.type === "tool_use") {
          const toolIdx = nextToolCallIndex++;
          blockToToolIdx.set(data.index ?? 0, toolIdx);
          return formatChunk({
            tool_calls: [
              {
                index: toolIdx,
                id: data.content_block.id || `call_${nanoid(12)}`,
                type: "function",
                function: {
                  name: data.content_block.name || "tool",
                  arguments: ""
                }
              }
            ]
          });
        }
        return "";
      }

      if (type === "content_block_delta") {
        const delta = data.delta;
        if (!delta) return "";
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          return formatChunk({ content: delta.text });
        }
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          return formatChunk({ reasoning_content: delta.thinking });
        }
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const toolIdx = blockToToolIdx.get(data.index ?? 0) ?? 0;
          return formatChunk({
            tool_calls: [
              {
                index: toolIdx,
                function: {
                  arguments: delta.partial_json
                }
              }
            ]
          });
        }
        return "";
      }

      if (type === "message_delta") {
        if (typeof data.usage?.output_tokens === "number") {
          outputTokens = data.usage.output_tokens;
        }
        const finishReason = mapAnthropicStopToOpenAIFinish(data.delta?.stop_reason);
        finishSent = true;
        return formatChunk({}, finishReason, {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        });
      }

      if (type === "message_stop") {
        let out = "";
        if (!finishSent) {
          finishSent = true;
          out += formatChunk({}, "stop", {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens
          });
        }
        if (!doneSent) {
          doneSent = true;
          out += "data: [DONE]\n\n";
        }
        return out;
      }

      return "";
    },

    finalize() {
      if (doneSent) return "";
      let out = "";
      if (!finishSent) {
        finishSent = true;
        out += formatChunk({}, "stop", {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        });
      }
      doneSent = true;
      out += "data: [DONE]\n\n";
      return out;
    },

    getUsage() {
      return {
        promptTokens: inputTokens,
        completionTokens: outputTokens
      };
    }
  };
}

/**
 * Estimate input token count for `/v1/messages/count_tokens`.
 * @param {any} body
 * @returns {number}
 */
export function estimateAnthropicInputTokens(body) {
  if (!body || typeof body !== "object") return 0;
  let totalChars = 0;

  if (typeof body.system === "string") {
    totalChars += body.system.length;
  } else if (Array.isArray(body.system)) {
    totalChars += JSON.stringify(body.system).length;
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      totalChars += 12; // role/message framing overhead
      if (typeof msg?.content === "string") {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg?.content)) {
        for (const block of msg.content) {
          if (block?.type === "text" && typeof block.text === "string") {
            totalChars += block.text.length;
          } else if (block?.type === "tool_use") {
            totalChars += (block.name?.length || 0) + JSON.stringify(block.input ?? {}).length + 16;
          } else if (block?.type === "tool_result") {
            totalChars += extractText(block.content).length + 16;
          } else if (block?.type === "image") {
            totalChars += 1200; // image token proxy
          } else if (block) {
            totalChars += JSON.stringify(block).length;
          }
        }
      }
    }
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    totalChars += JSON.stringify(body.tools).length;
  }

  if (totalChars === 0) return 0;
  return Math.max(1, Math.ceil(totalChars / 4));
}

/**
 * Convert an OpenAI Responses API (`/v1/responses`) request body into an OpenAI `/v1/chat/completions` body.
 * Enables modern Codex CLI (`wire_api = "responses"`) and OpenAI Responses SDK clients to route through any provider.
 * @param {any} respReq
 * @param {string} upstreamModel
 * @returns {any}
 */
export function responsesToOpenAIRequest(respReq, upstreamModel) {
  const messages = [];

  if (typeof respReq?.instructions === "string" && respReq.instructions.trim() !== "") {
    messages.push({ role: "system", content: respReq.instructions });
  }

  const input = respReq?.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    let pendingToolCalls = [];
    const flushToolCalls = () => {
      if (pendingToolCalls.length > 0) {
        messages.push({ role: "assistant", content: null, tool_calls: pendingToolCalls });
        pendingToolCalls = [];
      }
    };

    for (const item of input) {
      if (!item) continue;
      if (typeof item === "string") {
        flushToolCalls();
        messages.push({ role: "user", content: item });
        continue;
      }

      if (item.type === "function_call") {
        pendingToolCalls.push({
          id: item.call_id || item.id || `call_${nanoid(12)}`,
          type: "function",
          function: {
            name: item.name || "tool",
            arguments:
              typeof item.arguments === "string"
                ? item.arguments
                : JSON.stringify(item.arguments ?? {})
          }
        });
        continue;
      }

      flushToolCalls();

      if (item.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id || "",
          content:
            typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output ?? "")
        });
        continue;
      }

      const role =
        item.role === "developer" ? "system" : item.role || "user";
      if (typeof item.content === "string") {
        messages.push({ role, content: item.content });
      } else if (Array.isArray(item.content)) {
        const parts = [];
        for (const part of item.content) {
          if (typeof part === "string") {
            parts.push({ type: "text", text: part });
          } else if (
            (part?.type === "input_text" ||
              part?.type === "output_text" ||
              part?.type === "text") &&
            typeof part.text === "string"
          ) {
            parts.push({ type: "text", text: part.text });
          } else if (part?.type === "input_image" && part.image_url) {
            parts.push({
              type: "image_url",
              image_url:
                typeof part.image_url === "string"
                  ? { url: part.image_url }
                  : part.image_url
            });
          } else if (part?.type === "image_url" && part.image_url) {
            parts.push(part);
          }
        }
        const hasImages = parts.some((p) => p.type === "image_url");
        if (!hasImages) {
          messages.push({
            role,
            content: parts.map((p) => p.text || "").join("\n")
          });
        } else {
          messages.push({ role, content: parts });
        }
      }
    }
    flushToolCalls();
  }

  const out = {
    model: upstreamModel,
    messages
  };
  if (typeof respReq?.temperature === "number") out.temperature = respReq.temperature;
  if (typeof respReq?.top_p === "number") out.top_p = respReq.top_p;
  if (typeof respReq?.max_output_tokens === "number") {
    out.max_tokens = respReq.max_output_tokens;
  } else if (typeof respReq?.max_tokens === "number") {
    out.max_tokens = respReq.max_tokens;
  }
  if (typeof respReq?.stream === "boolean") out.stream = respReq.stream;

  if (Array.isArray(respReq?.tools) && respReq.tools.length > 0) {
    const mappedTools = [];
    for (const t of respReq.tools) {
      if (!t || t.type !== "function") continue;
      if (t.function) {
        mappedTools.push(t);
      } else if (t.name) {
        mappedTools.push({
          type: "function",
          function: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            parameters: t.parameters || { type: "object", properties: {} }
          }
        });
      }
    }
    if (mappedTools.length > 0) out.tools = mappedTools;
  }

  if (respReq?.tool_choice !== undefined) {
    const tc = respReq.tool_choice;
    if (typeof tc === "string") {
      out.tool_choice = tc;
    } else if (tc && typeof tc === "object" && tc.type === "function" && tc.name) {
      out.tool_choice = { type: "function", function: { name: tc.name } };
    } else {
      out.tool_choice = tc;
    }
  }

  return out;
}

/**
 * Convert an OpenAI Chat Completions response into an OpenAI Responses API JSON envelope.
 * @param {any} openaiResp
 * @param {string} requestedModel
 */
export function openAIToResponsesResponse(openaiResp, requestedModel) {
  const choice = openaiResp?.choices?.[0] || {};
  const msg = choice.message || {};
  const output = [];
  const textContent = typeof msg.content === "string" ? msg.content : "";

  if (textContent) {
    output.push({
      id: `msg_${nanoid(12)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: textContent,
          annotations: []
        }
      ]
    });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (!tc) continue;
      output.push({
        id: `fc_${nanoid(12)}`,
        type: "function_call",
        status: "completed",
        call_id: tc.id || `call_${nanoid(12)}`,
        name: tc.function?.name || "tool",
        arguments:
          typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {})
      });
    }
  }

  const inputTokens = openaiResp?.usage?.prompt_tokens ?? 0;
  const outputTokens = openaiResp?.usage?.completion_tokens ?? 0;

  return {
    id: openaiResp?.id ? `resp_${openaiResp.id}` : `resp_${nanoid(16)}`,
    object: "response",
    created_at: openaiResp?.created || Math.floor(Date.now() / 1000),
    status: "completed",
    model: requestedModel || openaiResp?.model || "unknown",
    output,
    output_text: textContent,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

/**
 * Stateful stream transformer converting OpenAI Chat Completions SSE chunks into OpenAI Responses API SSE events.
 * @param {string} requestedModel
 */
export function createOpenAIToResponsesStreamTransformer(requestedModel) {
  const responseId = `resp_${nanoid(16)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let seq = 0;
  let started = false;
  let completed = false;
  let msgItemId = `msg_${nanoid(12)}`;
  let msgStarted = false;
  let msgClosed = false;
  let textBuffer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  /** @type {Map<number, { itemId: string, callId: string, name: string, arguments: string, outputIndex: number }>} */
  const toolItems = new Map();
  let nextOutputIndex = 0;

  const emit = (eventType, payload) => {
    const data = { type: eventType, sequence_number: ++seq, ...payload };
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  };

  const ensureStarted = () => {
    if (started) return "";
    started = true;
    return (
      emit("response.created", {
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          status: "in_progress",
          model: requestedModel,
          output: []
        }
      }) +
      emit("response.in_progress", {
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          status: "in_progress",
          model: requestedModel
        }
      })
    );
  };

  const ensureMsgStarted = () => {
    if (msgStarted) return "";
    msgStarted = true;
    const outputIndex = nextOutputIndex++;
    return (
      emit("response.output_item.added", {
        output_index: outputIndex,
        item: {
          id: msgItemId,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: []
        }
      }) +
      emit("response.content_part.added", {
        item_id: msgItemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] }
      })
    );
  };

  const closeMsgIfOpen = () => {
    if (!msgStarted || msgClosed) return "";
    msgClosed = true;
    return (
      emit("response.output_text.done", {
        item_id: msgItemId,
        output_index: 0,
        content_index: 0,
        text: textBuffer
      }) +
      emit("response.content_part.done", {
        item_id: msgItemId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: textBuffer, annotations: [] }
      }) +
      emit("response.output_item.done", {
        output_index: 0,
        item: {
          id: msgItemId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: textBuffer, annotations: [] }]
        }
      })
    );
  };

  return {
    pushChunk(chunk) {
      if (!chunk || typeof chunk !== "object") return "";
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
      let out = ensureStarted();
      const choice = chunk.choices?.[0];
      if (!choice) return out;
      const delta = choice.delta || {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        out += ensureMsgStarted();
        textBuffer += delta.content;
        out += emit("response.output_text.delta", {
          item_id: msgItemId,
          output_index: 0,
          content_index: 0,
          delta: delta.content
        });
      }

      if (Array.isArray(delta.tool_calls)) {
        out += closeMsgIfOpen();
        for (const tc of delta.tool_calls) {
          const tIdx = tc.index ?? 0;
          let entry = toolItems.get(tIdx);
          if (!entry) {
            entry = {
              itemId: `fc_${nanoid(12)}`,
              callId: tc.id || `call_${nanoid(12)}`,
              name: tc.function?.name || "tool",
              arguments: "",
              outputIndex: nextOutputIndex++
            };
            toolItems.set(tIdx, entry);
            out += emit("response.output_item.added", {
              output_index: entry.outputIndex,
              item: {
                id: entry.itemId,
                type: "function_call",
                status: "in_progress",
                call_id: entry.callId,
                name: entry.name,
                arguments: ""
              }
            });
          } else {
            if (tc.id) entry.callId = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
          }
          if (typeof tc.function?.arguments === "string" && tc.function.arguments.length > 0) {
            entry.arguments += tc.function.arguments;
            out += emit("response.function_call_arguments.delta", {
              item_id: entry.itemId,
              output_index: entry.outputIndex,
              delta: tc.function.arguments
            });
          }
        }
      }

      if (choice.finish_reason) {
        out += this.finalize();
      }
      return out;
    },

    finalize() {
      if (completed) return "";
      completed = true;
      let out = ensureStarted();
      out += closeMsgIfOpen();

      const output = [];
      if (msgStarted) {
        output.push({
          id: msgItemId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: textBuffer, annotations: [] }]
        });
      }

      for (const entry of toolItems.values()) {
        out += emit("response.function_call_arguments.done", {
          item_id: entry.itemId,
          output_index: entry.outputIndex,
          arguments: entry.arguments
        });
        const item = {
          id: entry.itemId,
          type: "function_call",
          status: "completed",
          call_id: entry.callId,
          name: entry.name,
          arguments: entry.arguments
        };
        out += emit("response.output_item.done", {
          output_index: entry.outputIndex,
          item
        });
        output.push(item);
      }

      out += emit("response.completed", {
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          status: "completed",
          model: requestedModel,
          output,
          output_text: textBuffer,
          usage: {
            input_tokens: promptTokens,
            output_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        }
      });
      return out;
    },

    getUsage() {
      return { promptTokens, completionTokens };
    }
  };
}
