"use strict";

const { MAX_RETRY_ATTEMPTS } = require("../constants");
const { createOpenAISSEAccumulator } = require("../stream/sseParser");
const { KNOWN_TOOL_NAMES, getToolsForMode } = require("../tools/toolDefinitions");
const { executeAgentTool } = require("../tools/toolExecutor");
const { buildSystemPrompt } = require("./systemPrompt");
const { formatErrorMessage } = require("../workspace/scanner");

function isTransientHttpStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isTransientNetworkError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket") ||
    msg.includes("premature close") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("rate limit")
  );
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error("Aborted");
      e.name = "AbortError";
      reject(e);
      return;
    }
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      const e = new Error("Aborted");
      e.name = "AbortError";
      reject(e);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Stream a single chat completions turn with automatic transient retry & anti-concatenation SSE parsing.
 */
async function streamSingleTurn(opts) {
  const {
    serverUrl,
    reqHeaders,
    bodyPayload,
    roundIndex,
    signal,
    allowRetry,
    onRetryStatus,
    onDelta,
    onAuthExpired
  } = opts;

  const maxAttempts = allowRetry ? MAX_RETRY_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp;
    try {
      resp = await fetch(`${serverUrl}/v1/chat/completions`, {
        method: "POST",
        signal,
        headers: reqHeaders,
        body: JSON.stringify(bodyPayload)
      });
    } catch (netErr) {
      if (netErr?.name === "AbortError") throw netErr;
      if (attempt < maxAttempts && isTransientNetworkError(netErr)) {
        const waitMs = 900 * attempt;
        onRetryStatus?.(attempt, maxAttempts, formatErrorMessage(netErr));
        await sleep(waitMs, signal);
        continue;
      }
      throw netErr;
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      let errMessage = `HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(errBody);
        errMessage = parsed?.error?.message || parsed?.error || errMessage;
      } catch {
        if (errBody) errMessage = errBody.slice(0, 400);
      }

      if (resp.status === 401) {
        await onAuthExpired?.();
        const err = new Error(errMessage);
        err.status = 401;
        throw err;
      }

      if (attempt < maxAttempts && isTransientHttpStatus(resp.status)) {
        const waitMs = 1100 * attempt;
        onRetryStatus?.(attempt, maxAttempts, errMessage);
        await sleep(waitMs, signal);
        continue;
      }

      const err = new Error(errMessage);
      err.status = resp.status;
      throw err;
    }

    const acc = createOpenAISSEAccumulator(roundIndex, KNOWN_TOOL_NAMES);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let emittedAnyContent = false;

    const feed = (rawLine) => {
      const ev = acc.feedLine(rawLine);
      if (ev && (ev.deltaText || ev.deltaReasoning)) {
        emittedAnyContent = true;
        onDelta?.(ev);
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          const rem = decoder.decode();
          if (rem) buffer += rem;
          if (buffer.trim()) {
            for (const trailingLine of buffer.split(/\r?\n/)) {
              feed(trailingLine);
            }
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let start = 0;
        let nl;
        while ((nl = buffer.indexOf("\n", start)) !== -1) {
          feed(buffer.slice(start, nl));
          start = nl + 1;
        }
        if (start > 0) {
          buffer = buffer.slice(start);
        }
      }
      return acc.getResult();
    } catch (streamErr) {
      await reader.cancel().catch(() => {});
      if (streamErr?.name === "AbortError") throw streamErr;
      if (!emittedAnyContent && attempt < maxAttempts && isTransientNetworkError(streamErr)) {
        const waitMs = 1000 * attempt;
        onRetryStatus?.(attempt, maxAttempts, formatErrorMessage(streamErr));
        await sleep(waitMs, signal);
        continue;
      }
      throw streamErr;
    }
  }

  throw new Error("Stream failed after retries.");
}

/**
 * Full Cline-grade autonomous multi-step execution engine.
 * Eliminates mid-task cutoffs, streams every step clearly to the UI, enforces granular permissions,
 * and guarantees a complete synthesized final answer.
 */
async function runAgentLoop(ctx) {
  const {
    serverUrl,
    routerKey,
    modelTarget,
    effort,
    mode,
    apiMessages,
    editorContext,
    includeWorkspace,
    toolsEnabled,
    permissions,
    approvalQueue,
    signal,
    emit,
    onAuthExpired,
    onAlwaysAllowCategory,
    onWorkspaceMutated,
    registerProcess
  } = ctx;

  const reqHeaders = { "Content-Type": "application/json" };
  if (routerKey) {
    reqHeaders.Authorization = `Bearer ${routerKey}`;
    reqHeaders["x-api-key"] = routerKey;
  }

  let contentAcc = "";
  let reasoningAcc = "";
  const steps = [];
  let planSteps = [];
  let useTools = toolsEnabled;
  let totalTokens = 0;
  let reachedStepCap = false;

  const livePermissions = { ...(permissions || {}) };
  const maxRounds = livePermissions.maxSteps === 0 ? 120 : Math.max(8, Math.min(120, Number(livePermissions.maxSteps) || 35));
  const upsertStep = (stepObj) => {
    const idx = steps.findIndex((s) => s.stepId === stepObj.stepId);
    if (idx >= 0) steps[idx] = stepObj;
    else steps.push(stepObj);
    emit({
      type: "stepUpdate",
      step: stepObj,
      stepCount: steps.length,
      maxSteps: livePermissions.maxSteps || 0
    });
  };

  for (let round = 0; round < maxRounds; round++) {
    const activeTools = useTools
      ? getToolsForMode(mode, livePermissions, { noProject: Boolean(editorContext?.isNoProject) })
      : [];
    const bodyPayload = {
      model: modelTarget,
      messages: apiMessages,
      stream: true
    };
    if (effort) bodyPayload.reasoning_effort = effort;
    if (activeTools.length > 0) {
      bodyPayload.tools = activeTools;
      bodyPayload.tool_choice = "auto";
    }

    let turnRes;
    try {
      turnRes = await streamSingleTurn({
        serverUrl,
        reqHeaders,
        bodyPayload,
        roundIndex: round,
        signal,
        allowRetry: permissions?.autoRetry !== false,
        onAuthExpired,
        onRetryStatus: (attempt, max, errMsg) => {
          emit({
            type: "phase",
            phase: "analyzing",
            phaseDetail: `Đang tự nối lại (${attempt}/${max}): ${errMsg.slice(0, 90)}`
          });
        },
        onDelta: ({ deltaText, deltaReasoning }) => {
          if (deltaText) contentAcc += deltaText;
          if (deltaReasoning) reasoningAcc += deltaReasoning;
          emit({
            type: "delta",
            deltaText,
            deltaReasoning,
            phase: deltaText ? "streaming" : "thinking"
          });
        }
      });
    } catch (err) {
      // Fallback: if model/provider does not support OpenAI `tools` (HTTP 400/422 on round 0), retry once without tools
      if (useTools && round === 0 && (err?.status === 400 || err?.status === 422)) {
        useTools = false;
        apiMessages[0] = {
          role: "system",
          content: buildSystemPrompt(mode, editorContext, includeWorkspace, false, permissions)
        };
        round--;
        continue;
      }
      throw err;
    }

    if (turnRes.usage?.total_tokens) {
      totalTokens += Number(turnRes.usage.total_tokens) || 0;
    }

    const pendingCalls = turnRes.toolCalls || [];
    if (pendingCalls.length === 0 || !useTools) {
      break;
    }

    // Record assistant tool-call message
    apiMessages.push({
      role: "assistant",
      content: turnRes.text || null,
      tool_calls: pendingCalls
    });

    // Execute every tool call in order with full live step visibility
    for (const tc of pendingCalls) {
      if (signal?.aborted) {
        const abortErr = new Error("Aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      const toolName = tc.function.name;
      emit({
        type: "phase",
        phase: toolName === "execute_command" ? "terminal" : "executing",
        phaseDetail: `Bước ${steps.length + 1}: Đang chạy ${toolName}...`
      });

      const execRes = await executeAgentTool({
        toolName,
        rawArgs: tc.function.arguments,
        editorContext,
        permissions: livePermissions,
        approvalQueue,
        signal,
        onStepUpdate: (stepObj) => {
          upsertStep(stepObj);
          if (stepObj.status === "awaiting_approval") {
            emit({
              type: "phase",
              phase: "approval",
              phaseDetail: `Chờ xác nhận quyền: ${stepObj.title} (${stepObj.target})`
            });
          } else if (stepObj.status === "running") {
            emit({
              type: "phase",
              phase: stepObj.category === "terminal" ? "terminal" : "executing",
              phaseDetail: `${stepObj.title}: ${stepObj.target}`
            });
          }
        },
        onStepOutput: (stepId, chunk, streamName) => {
          const targetStep = steps.find((s) => s.stepId === stepId);
          if (targetStep) {
            targetStep.output = `${targetStep.output || ""}${chunk}`.slice(-28000);
          }
          emit({ type: "stepOutput", stepId, chunk, streamName });
        },
        onAlwaysAllowCategory: async (category) => {
          if (category) livePermissions[category] = true;
          await onAlwaysAllowCategory?.(category);
        },
        onPlanUpdate: (nextPlan) => {
          planSteps = nextPlan;
          emit({ type: "planUpdate", plan: planSteps });
        },
        onWorkspaceMutated,
        registerProcess
      });

      apiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: toolName,
        content: execRes.resultJson
      });
    }

    if (contentAcc && !contentAcc.endsWith("\n")) {
      contentAcc += "\n\n";
      emit({ type: "delta", deltaText: "\n\n", deltaReasoning: "", phase: "analyzing" });
    }

    if (round === maxRounds - 1) {
      reachedStepCap = true;
    }
  }

  // Guarantee a complete final synthesis answer if the loop hit maxSteps or produced tools without final text
  if ((reachedStepCap || (!contentAcc.trim() && steps.length > 0)) && !signal?.aborted) {
    emit({
      type: "phase",
      phase: "thinking",
      phaseDetail: "Đang tổng hợp kết quả cuối cùng từ toàn bộ các bước đã chạy..."
    });

    apiMessages.push({
      role: "user",
      content: reachedStepCap
        ? "You reached the step budget for this turn. Now provide a clear, complete summary of everything you inspected/changed so far and any remaining next steps (do not call more tools)."
        : "Summarize your findings and final answer clearly based on the tool outputs above."
    });

    const synthPayload = {
      model: modelTarget,
      messages: apiMessages,
      stream: true
    };
    if (effort) synthPayload.reasoning_effort = effort;

    try {
      const synthRes = await streamSingleTurn({
        serverUrl,
        reqHeaders,
        bodyPayload: synthPayload,
        roundIndex: maxRounds,
        signal,
        allowRetry: permissions?.autoRetry !== false,
        onAuthExpired,
        onDelta: ({ deltaText, deltaReasoning }) => {
          if (deltaText) contentAcc += deltaText;
          if (deltaReasoning) reasoningAcc += deltaReasoning;
          emit({
            type: "delta",
            deltaText,
            deltaReasoning,
            phase: deltaText ? "streaming" : "thinking"
          });
        }
      });
      if (synthRes.usage?.total_tokens) {
        totalTokens += Number(synthRes.usage.total_tokens) || 0;
      }
    } catch (synthErr) {
      if (synthErr?.name === "AbortError") throw synthErr;
    }
  }

  return {
    text: contentAcc.trim() || "(Đã hoàn tất các bước thực thi.)",
    reasoning: reasoningAcc,
    steps,
    plan: planSteps,
    totalTokens,
    reachedStepCap
  };
}

module.exports = {
  streamSingleTurn,
  runAgentLoop
};
