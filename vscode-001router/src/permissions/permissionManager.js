"use strict";

const crypto = require("node:crypto");
const { DEFAULT_PERMISSIONS, PERMISSION_PRESETS } = require("../constants");

const SAFE_READONLY_CMD_RE =
  /^\s*(?:git\s+(?:status|log|diff|branch|show|rev-parse)|ls|dir|pwd|whoami|echo|cat|type|head|tail|wc|find|rg|grep|node\s+-v|npm\s+-v|npm\s+run\s+(?:build|test|lint|check)|npx\s+tsc|python\s+--version|Get-ChildItem|Get-Content|Select-String)\b/i;

const CATASTROPHIC_CMD_RE =
  /(?:rm\s+-rf\s+\/(?:\s|$|\*)|rm\s+-rf\s+~|mkfs\.|dd\s+if=.*of=\/dev\/|format\s+[a-z]:|(?:del|rd|rmdir)\s+\/[fqs\s]*[a-z]:\\(?:\s|$|\*)|Remove-Item\s+.*-Recurse\s+.*(?:[a-z]:\\(?:Windows|Users|Program Files)?(?:\s|$|\*|["'])|(?:^|\s)\/(?:\s|$))|:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;:)/i;

function normalizePermissions(raw) {
  const base = { ...DEFAULT_PERMISSIONS };
  if (!raw || typeof raw !== "object") return base;
  const preset = raw.preset === "ask" || raw.preset === "safe" || raw.preset === "yolo" ? raw.preset : base.preset;
  const maxStepsRaw = Number(raw.maxSteps);
  const maxSteps = Number.isFinite(maxStepsRaw) && maxStepsRaw >= 0 ? Math.min(200, Math.round(maxStepsRaw)) : base.maxSteps;
  return {
    preset,
    readFiles: typeof raw.readFiles === "boolean" ? raw.readFiles : base.readFiles,
    editFiles: typeof raw.editFiles === "boolean" ? raw.editFiles : base.editFiles,
    deleteFiles: typeof raw.deleteFiles === "boolean" ? raw.deleteFiles : base.deleteFiles,
    executeTerminal: typeof raw.executeTerminal === "boolean" ? raw.executeTerminal : base.executeTerminal,
    outsideWorkspace: typeof raw.outsideWorkspace === "boolean" ? raw.outsideWorkspace : base.outsideWorkspace,
    webAccess: typeof raw.webAccess === "boolean" ? raw.webAccess : base.webAccess,
    ideDiagnostics: typeof raw.ideDiagnostics === "boolean" ? raw.ideDiagnostics : base.ideDiagnostics,
    autoRetry: typeof raw.autoRetry === "boolean" ? raw.autoRetry : base.autoRetry,
    guardCatastrophic: typeof raw.guardCatastrophic === "boolean" ? raw.guardCatastrophic : base.guardCatastrophic,
    maxSteps
  };
}

function applyPermissionPreset(current, presetName) {
  const target = PERMISSION_PRESETS[presetName];
  if (!target) return normalizePermissions(current);
  return normalizePermissions({
    ...current,
    ...target
  });
}

function isSafeReadOnlyCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  if (/[;&|`$<>]/.test(cmd)) return false;
  return SAFE_READONLY_CMD_RE.test(cmd);
}

function isCatastrophicCommand(command) {
  return CATASTROPHIC_CMD_RE.test(String(command || ""));
}

/**
 * Evaluate whether a requested tool invocation should auto-run, ask the user inline, or be denied.
 */
function evaluateToolPermission(permissions, toolName, args, ctx = {}) {
  const p = normalizePermissions(permissions);
  const isOutside = Boolean(ctx.isOutsideWorkspace);

  // Outside workspace check applies to any filesystem tool
  if (isOutside && !p.outsideWorkspace) {
    return {
      decision: "ask",
      category: "outsideWorkspace",
      riskLevel: "high",
      reason: "Truy cập đường dẫn nằm ngoài thư mục workspace đang mở"
    };
  }

  switch (toolName) {
    case "list_files":
    case "list_workspace_files":
    case "read_file":
    case "read_workspace_file":
    case "search_files":
    case "search_workspace_text":
      return {
        decision: p.readFiles ? "allow" : "ask",
        category: "readFiles",
        riskLevel: "low",
        reason: "Đọc và tra cứu mã nguồn dự án"
      };

    case "get_diagnostics":
    case "open_file":
    case "git_info":
    case "update_plan":
      return {
        decision: p.ideDiagnostics ? "allow" : "ask",
        category: "ideDiagnostics",
        riskLevel: "low",
        reason: "Truy cập chẩn đoán IDE, Git và điều khiển editor"
      };

    case "write_to_file":
    case "replace_in_file":
      return {
        decision: p.editFiles ? "allow" : "ask",
        category: "editFiles",
        riskLevel: "medium",
        reason: "Ghi hoặc chỉnh sửa tệp trong dự án"
      };

    case "delete_file":
      return {
        decision: p.deleteFiles ? "allow" : "ask",
        category: "deleteFiles",
        riskLevel: "high",
        reason: "Xóa tệp khỏi hệ thống"
      };

    case "web_fetch":
      return {
        decision: p.webAccess ? "allow" : "ask",
        category: "webAccess",
        riskLevel: "medium",
        reason: "Gửi yêu cầu HTTP / tải tài liệu từ Web"
      };

    case "execute_command": {
      const cmd = String(args?.command || "").trim();
      if (p.guardCatastrophic && isCatastrophicCommand(cmd)) {
        return {
          decision: "ask",
          category: "executeTerminal",
          riskLevel: "critical",
          reason: "Lệnh có rủi ro phá hủy hệ thống cao — cần xác nhận thủ công"
        };
      }
      if (p.preset === "safe" && !isSafeReadOnlyCommand(cmd)) {
        return {
          decision: "ask",
          category: "executeTerminal",
          riskLevel: "medium",
          reason: "Chế độ An toàn: cần xác nhận lệnh Terminal có thể thay đổi trạng thái"
        };
      }
      return {
        decision: p.executeTerminal ? "allow" : "ask",
        category: "executeTerminal",
        riskLevel: isSafeReadOnlyCommand(cmd) ? "low" : "medium",
        reason: "Thực thi lệnh trong Terminal"
      };
    }

    default:
      return {
        decision: "allow",
        category: "readFiles",
        riskLevel: "low",
        reason: ""
      };
  }
}

/**
 * Coordinates inline approval requests between the autonomous agent loop and the Webview UI.
 */
class ApprovalQueue {
  constructor() {
    this.pending = new Map();
  }

  request(meta, signal) {
    const approvalId = `apr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    return {
      approvalId,
      promise: new Promise((resolve) => {
        const onAbort = () => {
          if (this.pending.has(approvalId)) {
            this.pending.delete(approvalId);
            resolve({ decision: "deny", aborted: true, note: "Đã hủy tác vụ." });
          }
        };
        if (signal) {
          if (signal.aborted) {
            resolve({ decision: "deny", aborted: true, note: "Đã hủy tác vụ." });
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
        this.pending.set(approvalId, {
          meta,
          resolve: (res) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            this.pending.delete(approvalId);
            resolve(res);
          }
        });
      })
    };
  }

  resolve(approvalId, decision, note = "") {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    entry.resolve({ decision, note });
    return true;
  }

  rejectAll(reason = "Đã hủy yêu cầu.") {
    for (const [id, entry] of this.pending.entries()) {
      this.pending.delete(id);
      entry.resolve({ decision: "deny", aborted: true, note: reason });
    }
  }
}

module.exports = {
  normalizePermissions,
  applyPermissionPreset,
  isSafeReadOnlyCommand,
  isCatastrophicCommand,
  evaluateToolPermission,
  ApprovalQueue
};
