import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cloudCodeChunkToOpenAI } from "../server/geminiCliTranslator.js";

const require = createRequire(import.meta.url);
const { createOpenAISSEAccumulator, safeParseToolArgs } = require("../vscode-001router/src/stream/sseParser.js");
const {
  normalizePermissions,
  applyPermissionPreset,
  isSafeReadOnlyCommand,
  isCatastrophicCommand,
  evaluateToolPermission,
  ApprovalQueue
} = require("../vscode-001router/src/permissions/permissionManager.js");
const { KNOWN_TOOL_NAMES, getToolsForMode } = require("../vscode-001router/src/tools/toolDefinitions.js");

describe("001Router Extension v1.4 — Anti-Corruption SSE, CloudCode Offsets & Permission Matrix", () => {
  it("1. cloudCodeChunkToOpenAI assigns non-colliding sequential tool_call indices across SSE chunks", () => {
    let nextIdx = 0;
    const rawChunk1 = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "list_files", args: { dir: "." } } },
                { functionCall: { name: "read_file", args: { path: "package.json" } } }
              ]
            }
          }
        ]
      }
    };
    const rawChunk2 = {
      response: {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "read_file", args: { path: "README.md" } } }]
            }
          }
        ]
      }
    };

    const oai1 = cloudCodeChunkToOpenAI(rawChunk1, "gemini-4-hydrogen", "chatcmpl-1", {
      toolCallIndexOffset: nextIdx
    });
    const tools1 = oai1.choices[0].delta.tool_calls;
    assert.equal(tools1.length, 2);
    assert.equal(tools1[0].index, 0);
    assert.equal(tools1[1].index, 1);
    nextIdx += tools1.length;

    const oai2 = cloudCodeChunkToOpenAI(rawChunk2, "gemini-4-hydrogen", "chatcmpl-1", {
      toolCallIndexOffset: nextIdx
    });
    const tools2 = oai2.choices[0].delta.tool_calls;
    assert.equal(tools2.length, 1);
    assert.equal(tools2[0].index, 2);
    assert.equal(tools2[0].function.name, "read_file");
  });

  it("2. createOpenAISSEAccumulator isolates parallel tool calls even when upstream collides index: 0", () => {
    const acc = createOpenAISSEAccumulator(0, KNOWN_TOOL_NAMES);
    const collidingEvents = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "list_workspace_files", arguments: '{"dir":"."}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_2", function: { name: "list_workspace_files", arguments: '{"dir":"src"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_3", function: { name: "read_workspace_file", arguments: '{"path":"package.json"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_4", function: { name: "read_workspace_file", arguments: '{"path":"README.md"}' } }] } }] }
    ];
    for (const ev of collidingEvents) {
      acc.feedLine(`data: ${JSON.stringify(ev)}`);
    }
    const res = acc.getResult();
    assert.equal(res.toolCalls.length, 4);
    assert.deepEqual(
      res.toolCalls.map((c) => c.function.name),
      ["list_workspace_files", "list_workspace_files", "read_workspace_file", "read_workspace_file"]
    );
    assert.deepEqual(safeParseToolArgs(res.toolCalls[2].function.arguments), { path: "package.json" });
    assert.deepEqual(safeParseToolArgs(res.toolCalls[3].function.arguments), { path: "README.md" });
  });

  it("3. createOpenAISSEAccumulator also handles standard incremental OpenAI argument chunks without premature splitting", () => {
    const acc = createOpenAISSEAccumulator(1, KNOWN_TOOL_NAMES);
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_abc", function: { name: "execute_command", arguments: '{"com' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mand":"git ' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'status"}' } }] } }] }
    ];
    for (const ev of chunks) acc.feedLine(`data: ${JSON.stringify(ev)}`);
    const res = acc.getResult();
    assert.equal(res.toolCalls.length, 1);
    assert.equal(res.toolCalls[0].function.name, "execute_command");
    assert.deepEqual(safeParseToolArgs(res.toolCalls[0].function.arguments), { command: "git status" });
  });

  it("4. safeParseToolArgs gracefully recovers concatenated JSON objects", () => {
    const parsed = safeParseToolArgs('{"path":"src/index.js"}{"path":"src/other.js"}');
    assert.deepEqual(parsed, { path: "src/index.js" });
    assert.deepEqual(safeParseToolArgs(""), {});
  });

  it("5. permissionManager enforces presets (yolo/safe/ask), catastrophic command guard, and outsideWorkspace escalation", () => {
    const yolo = normalizePermissions(applyPermissionPreset({}, "yolo"));
    assert.equal(yolo.preset, "yolo");
    assert.equal(evaluateToolPermission(yolo, "execute_command", { command: "npm test" }).decision, "allow");
    assert.equal(evaluateToolPermission(yolo, "write_to_file", { path: "a.js" }).decision, "allow");
    assert.equal(evaluateToolPermission(yolo, "read_file", { path: "C:\\Windows\\win.ini" }, { isOutsideWorkspace: true }).decision, "allow");

    // Catastrophic command guard still asks even in YOLO when guardCatastrophic is on
    assert.equal(isCatastrophicCommand("rm -rf /"), true);
    assert.equal(isCatastrophicCommand("Remove-Item -Recurse -Force C:\\"), true);
    const catCheck = evaluateToolPermission(yolo, "execute_command", { command: "rm -rf /" });
    assert.equal(catCheck.decision, "ask");
    assert.equal(catCheck.riskLevel, "critical");

    // Safe preset auto-allows read-only terminal commands, asks for mutating ones
    const safe = normalizePermissions(applyPermissionPreset({}, "safe"));
    assert.equal(isSafeReadOnlyCommand("git status"), true);
    assert.equal(isSafeReadOnlyCommand("npm install express"), false);
    assert.equal(evaluateToolPermission(safe, "execute_command", { command: "git status" }).decision, "allow");
    assert.equal(evaluateToolPermission(safe, "execute_command", { command: "npm install express" }).decision, "ask");
    assert.equal(evaluateToolPermission(safe, "delete_file", { path: "old.js" }).decision, "ask");
    assert.equal(evaluateToolPermission(safe, "read_file", { path: "/etc/hosts" }, { isOutsideWorkspace: true }).decision, "ask");

    // Ask preset asks for edits & commands
    const ask = normalizePermissions(applyPermissionPreset({}, "ask"));
    assert.equal(evaluateToolPermission(ask, "write_to_file", { path: "a.js" }).decision, "ask");
    assert.equal(evaluateToolPermission(ask, "execute_command", { command: "git status" }).decision, "ask");
    assert.equal(evaluateToolPermission(ask, "read_file", { path: "a.js" }).decision, "allow");
  });

  it("6. ApprovalQueue resolves allow/always/deny decisions and cancels cleanly on AbortSignal", async () => {
    const queue = new ApprovalQueue();
    const req1 = queue.request({ tool: "execute_command" });
    assert.equal(queue.resolve(req1.approvalId, "always"), true);
    const res1 = await req1.promise;
    assert.equal(res1.decision, "always");

    const ac = new AbortController();
    const req2 = queue.request({ tool: "delete_file" }, ac.signal);
    ac.abort();
    const res2 = await req2.promise;
    assert.equal(res2.decision, "deny");
  });

  it("7. getToolsForMode exposes full autonomous toolset in auto mode and read-only tools in ask/plan mode", () => {
    const autoNames = getToolsForMode("auto", normalizePermissions({ preset: "yolo" })).map((t) => t.function.name);
    assert.ok(autoNames.includes("execute_command"));
    assert.ok(autoNames.includes("write_to_file"));
    assert.ok(autoNames.includes("replace_in_file"));
    assert.ok(autoNames.includes("delete_file"));
    assert.ok(autoNames.includes("web_fetch"));
    assert.ok(autoNames.includes("update_plan"));

    const askNames = getToolsForMode("ask", normalizePermissions({ preset: "yolo" })).map((t) => t.function.name);
    assert.ok(askNames.includes("read_file"));
    assert.ok(!askNames.includes("write_to_file"));
    assert.ok(!askNames.includes("execute_command"));
  });
});
