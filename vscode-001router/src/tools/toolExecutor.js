"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const vscode = require("vscode");
const {
  MAX_SINGLE_READ_CHARS,
  MAX_TERMINAL_OUTPUT_CHARS,
  DEFAULT_COMMAND_TIMEOUT_MS
} = require("../constants");
const { evaluateToolPermission } = require("../permissions/permissionManager");
const { safeParseToolArgs } = require("../stream/sseParser");
const {
  toPosixPath,
  isBinaryFileName,
  formatErrorMessage,
  stripAnsi,
  scanWorkspaceRoots,
  resolveProjectPath,
  readNumberedTextFile
} = require("../workspace/scanner");
const { TOOL_ALIASES } = require("./toolDefinitions");

function buildLineDiff(beforeText, afterText, maxLines = 80) {
  const a = String(beforeText || "").split(/\r?\n/);
  const b = String(afterText || "").split(/\r?\n/);

  // Find common prefix and suffix for clean, fast minimal hunk preview
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const removed = Math.max(0, endA - start + 1);
  const added = Math.max(0, endB - start + 1);
  const lines = [];

  const ctxStart = Math.max(0, start - 2);
  for (let i = ctxStart; i < start; i++) {
    lines.push(`  ${a[i]}`);
  }
  for (let i = start; i <= endA && lines.length < maxLines; i++) {
    lines.push(`- ${a[i]}`);
  }
  for (let i = start; i <= endB && lines.length < maxLines; i++) {
    lines.push(`+ ${b[i]}`);
  }
  const ctxEnd = Math.min(a.length - 1, endA + 2);
  for (let i = endA + 1; i <= ctxEnd && lines.length < maxLines; i++) {
    lines.push(`  ${a[i]}`);
  }

  if (removed + added > maxLines) {
    lines.push(`... (+${added} / -${removed} dòng tổng cộng)`);
  }

  return {
    added,
    removed,
    preview: lines.join("\n")
  };
}

function describeToolAction(canonicalTool, args) {
  switch (canonicalTool) {
    case "list_files": {
      const dir = String(args.dir || ".").trim() || ".";
      const pat = String(args.pattern || "").trim();
      return {
        category: "list",
        title: "Quét thư mục",
        target: pat ? `${dir} · lọc "${pat}"` : dir
      };
    }
    case "read_file": {
      const p = String(args.path || "").trim() || "(chưa rõ đường dẫn)";
      const s = Number(args.start_line) || 0;
      const e = Number(args.end_line) || 0;
      return {
        category: "read",
        title: "Đọc tệp",
        target: s > 0 || e > 0 ? `${p} · L${s || 1}-${e || "end"}` : p
      };
    }
    case "search_files": {
      const q = String(args.query || "").trim();
      const dir = String(args.dir || "").trim();
      return {
        category: "search",
        title: "Tìm kiếm mã nguồn",
        target: dir ? `"${q}" trong ${dir}` : `"${q}"`
      };
    }
    case "write_to_file":
      return {
        category: "edit",
        title: "Ghi tệp",
        target: String(args.path || "").trim() || "(tệp mới)"
      };
    case "replace_in_file":
      return {
        category: "edit",
        title: "Chỉnh sửa tệp",
        target: String(args.path || "").trim() || "(tệp)"
      };
    case "delete_file":
      return {
        category: "delete",
        title: "Xóa tệp",
        target: String(args.path || "").trim() || "(tệp)"
      };
    case "execute_command":
      return {
        category: "terminal",
        title: "Chạy lệnh Terminal",
        target: String(args.command || "").trim() || "(lệnh rỗng)"
      };
    case "get_diagnostics":
      return {
        category: "ide",
        title: "Kiểm tra lỗi IDE",
        target: String(args.path || "Toàn bộ dự án").trim()
      };
    case "git_info":
      return {
        category: "git",
        title: `Git ${String(args.action || "status").toLowerCase()}`,
        target: String(args.path || "workspace").trim()
      };
    case "web_fetch":
      return {
        category: "web",
        title: "Tải dữ liệu Web",
        target: String(args.url || "").trim()
      };
    case "open_file":
      return {
        category: "ide",
        title: "Mở tệp trong Editor",
        target: args.line ? `${args.path}:${args.line}` : String(args.path || "")
      };
    case "update_plan":
      return {
        category: "plan",
        title: "Cập nhật kế hoạch thực hiện",
        target: `${Array.isArray(args.steps) ? args.steps.length : 0} bước`
      };
    default:
      return {
        category: "other",
        title: canonicalTool,
        target: ""
      };
  }
}

function runShellCapture(command, cwd, opts = {}) {
  const { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, signal, onChunk, registerProcess, stepId } = opts;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let acc = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
    });

    if (registerProcess) registerProcess(stepId, child);

    const killChild = () => {
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // ignore
      }
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killChild();
          }, timeoutMs)
        : null;

    const onAbort = () => killChild();
    if (signal) {
      if (signal.aborted) {
        killChild();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const push = (buf, streamName) => {
      const clean = stripAnsi(buf.toString("utf8"));
      if (!clean) return;
      if (acc.length < MAX_TERMINAL_OUTPUT_CHARS) {
        acc += clean;
      }
      onChunk?.(clean, streamName);
    };

    child.stdout?.on("data", (d) => push(d, "stdout"));
    child.stderr?.on("data", (d) => push(d, "stderr"));

    const finish = (exitCode, errMsg = "") => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (registerProcess) registerProcess(stepId, null);
      resolve({
        exitCode,
        timedOut,
        aborted: Boolean(signal?.aborted),
        durationMs: Date.now() - startedAt,
        output: acc.slice(-MAX_TERMINAL_OUTPUT_CHARS),
        error: errMsg
      });
    };

    child.on("error", (err) => finish(1, formatErrorMessage(err)));
    child.on("close", (code, sig) => {
      const exitCode = typeof code === "number" ? code : sig ? 130 : 0;
      finish(exitCode, timedOut ? `Command timed out after ${Math.round(timeoutMs / 1000)}s` : "");
    });
  });
}

/**
 * Execute any autonomous agent tool with live Cline-style step callbacks and permission enforcement.
 */
async function executeAgentTool(params) {
  const {
    toolName,
    rawArgs,
    editorContext,
    permissions,
    approvalQueue,
    signal,
    onStepUpdate,
    onStepOutput,
    onAlwaysAllowCategory,
    onPlanUpdate,
    onWorkspaceMutated,
    registerProcess
  } = params;

  const canonical = TOOL_ALIASES[toolName] || toolName;
  const args = safeParseToolArgs(rawArgs);
  const meta = describeToolAction(canonical, args);
  const stepId = `step-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const startedAt = Date.now();
  const ws = editorContext?.workspaceSummary || null;
  const roots = ws?.roots || [];
  const defaultCwd =
    (editorContext?.workingDir && fs.existsSync(editorContext.workingDir) && editorContext.workingDir) ||
    roots[0]?.fsPath ||
    os.homedir();

  const baseStep = {
    stepId,
    tool: canonical,
    category: meta.category,
    title: meta.title,
    target: meta.target,
    status: "running",
    badge: "Đang chạy...",
    summary: "",
    output: "",
    diffPreview: "",
    diffStats: null,
    cwd: "",
    exitCode: null,
    absPath: "",
    startedAt,
    durationMs: 0
  };

  // Pre-check whether target path escapes workspace
  let isOutsideWorkspace = false;
  if (["read_file", "write_to_file", "replace_in_file", "delete_file", "list_files", "open_file"].includes(canonical)) {
    const rawTarget = canonical === "list_files" ? args.dir || "." : args.path || "";
    if (rawTarget && rawTarget !== ".") {
      const probe = resolveProjectPath(rawTarget, roots, {
        allowOutside: true,
        mustExist: false
      });
      if (probe?.isOutsideWorkspace) isOutsideWorkspace = true;
    }
  } else if (canonical === "execute_command" && args.cwd) {
    const probe = resolveProjectPath(args.cwd, roots, { allowOutside: true, mustExist: false });
    if (probe?.isOutsideWorkspace) isOutsideWorkspace = true;
  }

  // Evaluate granular permission
  const permCheck = evaluateToolPermission(permissions, canonical, args, { isOutsideWorkspace });

  if (permCheck.decision === "ask") {
    // Prepare pre-approval diff preview if editing a file
    let preDiff = "";
    if (canonical === "replace_in_file" && args.search !== undefined && args.replace !== undefined) {
      const diff = buildLineDiff(args.search, args.replace, 40);
      preDiff = diff.preview;
    } else if (canonical === "write_to_file" && typeof args.content === "string") {
      preDiff = args.content.split(/\r?\n/).slice(0, 35).map((l) => `+ ${l}`).join("\n");
    }

    const req = approvalQueue.request(
      { stepId, tool: canonical, category: permCheck.category, target: meta.target },
      signal
    );

    const awaitingStep = {
      ...baseStep,
      status: "awaiting_approval",
      badge: "Chờ duyệt",
      approvalId: req.approvalId,
      approvalCategory: permCheck.category,
      approvalReason: permCheck.reason,
      riskLevel: permCheck.riskLevel,
      diffPreview: preDiff
    };
    onStepUpdate?.(awaitingStep);

    const decisionRes = await req.promise;
    if (decisionRes.decision === "always" && permCheck.category) {
      await onAlwaysAllowCategory?.(permCheck.category);
    }
    if (decisionRes.decision !== "allow" && decisionRes.decision !== "always") {
      const deniedStep = {
        ...baseStep,
        status: "denied",
        badge: "Đã từ chối",
        summary: decisionRes.note || "Người dùng đã từ chối quyền thực thi bước này.",
        durationMs: Date.now() - startedAt
      };
      onStepUpdate?.(deniedStep);
      return {
        step: deniedStep,
        resultJson: JSON.stringify({
          ok: false,
          denied: true,
          error: deniedStep.summary
        })
      };
    }
  }

  onStepUpdate?.(baseStep);

  const finalize = (patch, payloadObj) => {
    const doneStep = {
      ...baseStep,
      ...patch,
      durationMs: Date.now() - startedAt
    };
    onStepUpdate?.(doneStep);
    return {
      step: doneStep,
      resultJson: JSON.stringify(payloadObj)
    };
  };

  try {
    // 1. list_files
    if (canonical === "list_files") {
      const dirArg = String(args.dir || ".").trim() || ".";
      const pattern = String(args.pattern || "").trim().toLowerCase();
      const maxResults = Math.max(1, Math.min(300, Number(args.max_results) || 100));

      if ((dirArg === "." || dirArg === "./" || dirArg === "/") && ws?.files) {
        let list = ws.files;
        if (pattern) list = list.filter((f) => f.toLowerCase().includes(pattern));
        const sliced = list.slice(0, maxResults);
        return finalize(
          {
            status: "success",
            badge: `${list.length} tệp`,
            summary: `Tìm thấy ${list.length} tệp trong ${ws.projectName}`,
            output: sliced.slice(0, 60).join("\n") + (list.length > 60 ? `\n... (+${list.length - 60} tệp khác)` : "")
          },
          { ok: true, project: ws.projectName, totalFiles: list.length, files: sliced }
        );
      }

      const resolved = resolveProjectPath(dirArg, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: true
      });
      if (!resolved) {
        return finalize(
          { status: "error", badge: "Không thấy", summary: `Không tìm thấy thư mục: ${dirArg}` },
          { ok: false, error: `Directory not found: ${dirArg}` }
        );
      }
      const subScan = scanWorkspaceRoots([{ name: path.basename(resolved.absPath), fsPath: resolved.absPath }], "folder");
      let list = (subScan?.files || []).map((f) =>
        resolved.isOutsideWorkspace ? toPosixPath(path.join(resolved.absPath, f)) : toPosixPath(path.posix.join(resolved.relPath, f))
      );
      if (pattern) list = list.filter((f) => f.toLowerCase().includes(pattern));
      const sliced = list.slice(0, maxResults);
      return finalize(
        {
          status: "success",
          badge: `${list.length} tệp`,
          summary: `${list.length} tệp trong ${resolved.relPath}`,
          output: sliced.slice(0, 60).join("\n")
        },
        { ok: true, dir: resolved.relPath, totalFiles: list.length, files: sliced }
      );
    }

    // 2. read_file
    if (canonical === "read_file") {
      const targetPath = String(args.path || "").trim();
      const startLine = Number(args.start_line) || 1;
      const endLine = Number(args.end_line) || 0;
      let resolved = resolveProjectPath(targetPath, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: true
      });

      if (!resolved && ws?.files && targetPath) {
        const matches = ws.files.filter(
          (f) => f.toLowerCase().endsWith(`/${targetPath.toLowerCase()}`) || f.toLowerCase() === targetPath.toLowerCase()
        );
        if (matches.length === 1) {
          resolved = resolveProjectPath(matches[0], roots, { allowOutside: false, mustExist: true });
        }
      }

      if (!resolved) {
        return finalize(
          { status: "error", badge: "Không thấy", summary: `Không tìm thấy tệp: ${targetPath}` },
          { ok: false, error: `File not found: ${targetPath}` }
        );
      }

      const readRes = readNumberedTextFile(resolved.absPath, startLine, endLine, MAX_SINGLE_READ_CHARS);
      if (!readRes.ok) {
        return finalize(
          { status: "error", badge: "Lỗi đọc", summary: readRes.error || "Không thể đọc tệp", absPath: resolved.absPath },
          { ok: false, path: resolved.relPath, error: readRes.error }
        );
      }

      const previewLines = readRes.content.split("\n").slice(0, 24).join("\n");
      return finalize(
        {
          status: "success",
          target: `${resolved.relPath} · L${readRes.startLine}-${readRes.endLine}`,
          badge: `${readRes.totalLines} dòng`,
          summary: `Đã đọc L${readRes.startLine}-${readRes.endLine}/${readRes.totalLines}`,
          output: previewLines + (readRes.totalLines > 24 ? "\n..." : ""),
          absPath: resolved.absPath
        },
        { path: resolved.relPath, ...readRes }
      );
    }

    // 3. search_files
    if (canonical === "search_files") {
      const query = String(args.query || "").trim();
      const dirArg = String(args.dir || "").trim();
      const isRegex = Boolean(args.is_regex);
      const maxMatches = Math.max(1, Math.min(120, Number(args.max_matches) || 40));
      if (!query) {
        return finalize(
          { status: "error", badge: "Rỗng", summary: "Từ khóa tìm kiếm rỗng" },
          { ok: false, error: "Empty search query." }
        );
      }

      let regex = null;
      if (isRegex) {
        try {
          regex = new RegExp(query, "i");
        } catch (err) {
          return finalize(
            { status: "error", badge: "Regex lỗi", summary: formatErrorMessage(err) },
            { ok: false, error: `Invalid regex: ${formatErrorMessage(err)}` }
          );
        }
      }

      const qLower = query.toLowerCase();
      const dirPrefix = dirArg && dirArg !== "." ? `${toPosixPath(dirArg).replace(/\/+$/, "")}/` : "";
      const matches = [];
      let filesSearched = 0;

      for (const rel of ws?.files || []) {
        if (matches.length >= maxMatches) break;
        if (dirPrefix && !toPosixPath(rel).startsWith(dirPrefix)) continue;
        if (isBinaryFileName(rel)) continue;
        const resolved = resolveProjectPath(rel, roots, { allowOutside: false, mustExist: true });
        if (!resolved) continue;
        let stat;
        try {
          stat = fs.statSync(resolved.absPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > 768 * 1024) continue;
        filesSearched++;
        let text;
        try {
          text = fs.readFileSync(resolved.absPath, "utf8");
        } catch {
          continue;
        }
        if (!regex && !text.toLowerCase().includes(qLower)) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const hit = regex ? regex.test(lines[i]) : lines[i].toLowerCase().includes(qLower);
          if (hit) {
            matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 180) });
            if (matches.length >= maxMatches) break;
          }
        }
      }

      const preview = matches.slice(0, 20).map((m) => `${m.file}:${m.line}  ${m.text}`).join("\n");
      return finalize(
        {
          status: "success",
          badge: `${matches.length} kết quả`,
          summary: `Tìm thấy ${matches.length} khớp trong ${filesSearched} tệp`,
          output: preview || "(Không có kết quả khớp)"
        },
        { ok: true, query, filesSearched, matchCount: matches.length, matches }
      );
    }

    // 4. write_to_file
    if (canonical === "write_to_file") {
      const targetPath = String(args.path || "").trim();
      const content = typeof args.content === "string" ? args.content : "";
      const resolved = resolveProjectPath(targetPath, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: false
      });
      if (!resolved) {
        return finalize(
          { status: "error", badge: "Lỗi đường dẫn", summary: `Không thể giải đường dẫn: ${targetPath}` },
          { ok: false, error: `Cannot resolve path: ${targetPath}` }
        );
      }

      const existed = fs.existsSync(resolved.absPath);
      const before = existed ? fs.readFileSync(resolved.absPath, "utf8") : "";
      fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
      fs.writeFileSync(resolved.absPath, content, "utf8");
      onWorkspaceMutated?.();

      const diff = buildLineDiff(before, content, 60);
      return finalize(
        {
          status: "success",
          title: existed ? "Ghi đè tệp" : "Tạo tệp mới",
          target: resolved.relPath,
          badge: `+${diff.added}${diff.removed ? ` / -${diff.removed}` : ""}`,
          summary: `${existed ? "Đã cập nhật" : "Đã tạo"} ${resolved.relPath}`,
          diffPreview: diff.preview,
          diffStats: { added: diff.added, removed: diff.removed },
          absPath: resolved.absPath
        },
        {
          ok: true,
          path: resolved.relPath,
          created: !existed,
          linesAdded: diff.added,
          linesRemoved: diff.removed
        }
      );
    }

    // 5. replace_in_file
    if (canonical === "replace_in_file") {
      const targetPath = String(args.path || "").trim();
      const searchStr = typeof args.search === "string" ? args.search : "";
      const replaceStr = typeof args.replace === "string" ? args.replace : "";
      const replaceAll = Boolean(args.replace_all);

      const resolved = resolveProjectPath(targetPath, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: true
      });
      if (!resolved) {
        return finalize(
          { status: "error", badge: "Không thấy", summary: `Không tìm thấy tệp để sửa: ${targetPath}` },
          { ok: false, error: `File not found: ${targetPath}` }
        );
      }

      const before = fs.readFileSync(resolved.absPath, "utf8");
      if (!searchStr || !before.includes(searchStr)) {
        // Retry with normalized LF matching if CRLF differed
        const normBefore = before.replace(/\r\n/g, "\n");
        const normSearch = searchStr.replace(/\r\n/g, "\n");
        if (!normSearch || !normBefore.includes(normSearch)) {
          return finalize(
            {
              status: "error",
              badge: "Không khớp",
              target: resolved.relPath,
              summary: "Không tìm thấy đoạn mã gốc khớp chính xác trong tệp.",
              absPath: resolved.absPath
            },
            {
              ok: false,
              path: resolved.relPath,
              error: "Exact search block not found in file. Call read_file first to verify exact text."
            }
          );
        }
        const eol = before.includes("\r\n") ? "\r\n" : "\n";
        const normReplace = replaceStr.replace(/\r\n/g, "\n");
        const updatedNorm = replaceAll
          ? normBefore.split(normSearch).join(normReplace)
          : normBefore.replace(normSearch, normReplace);
        const after = eol === "\r\n" ? updatedNorm.replace(/\n/g, "\r\n") : updatedNorm;
        fs.writeFileSync(resolved.absPath, after, "utf8");
        onWorkspaceMutated?.();
        const diff = buildLineDiff(before, after, 60);
        return finalize(
          {
            status: "success",
            target: resolved.relPath,
            badge: `+${diff.added} / -${diff.removed}`,
            summary: `Đã chỉnh sửa ${resolved.relPath}`,
            diffPreview: diff.preview,
            diffStats: { added: diff.added, removed: diff.removed },
            absPath: resolved.absPath
          },
          { ok: true, path: resolved.relPath, linesAdded: diff.added, linesRemoved: diff.removed }
        );
      }

      const after = replaceAll ? before.split(searchStr).join(replaceStr) : before.replace(searchStr, replaceStr);
      fs.writeFileSync(resolved.absPath, after, "utf8");
      onWorkspaceMutated?.();
      const diff = buildLineDiff(before, after, 60);
      return finalize(
        {
          status: "success",
          target: resolved.relPath,
          badge: `+${diff.added} / -${diff.removed}`,
          summary: `Đã chỉnh sửa ${resolved.relPath}`,
          diffPreview: diff.preview,
          diffStats: { added: diff.added, removed: diff.removed },
          absPath: resolved.absPath
        },
        { ok: true, path: resolved.relPath, linesAdded: diff.added, linesRemoved: diff.removed }
      );
    }

    // 6. delete_file
    if (canonical === "delete_file") {
      const targetPath = String(args.path || "").trim();
      const resolved = resolveProjectPath(targetPath, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: true
      });
      if (!resolved) {
        return finalize(
          { status: "error", badge: "Không thấy", summary: `Không tìm thấy tệp: ${targetPath}` },
          { ok: false, error: `File not found: ${targetPath}` }
        );
      }
      fs.unlinkSync(resolved.absPath);
      onWorkspaceMutated?.();
      return finalize(
        { status: "success", target: resolved.relPath, badge: "Đã xóa", summary: `Đã xóa ${resolved.relPath}` },
        { ok: true, deleted: resolved.relPath }
      );
    }

    // 7. execute_command (live streaming terminal inside agent step!)
    if (canonical === "execute_command") {
      const command = String(args.command || "").trim();
      if (!command) {
        return finalize(
          { status: "error", badge: "Lệnh rỗng", summary: "Thiếu lệnh để thực thi" },
          { ok: false, error: "Empty command." }
        );
      }
      let cwd = defaultCwd;
      if (args.cwd) {
        const resolvedCwd = resolveProjectPath(args.cwd, roots, {
          allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
          mustExist: true
        });
        if (resolvedCwd && fs.statSync(resolvedCwd.absPath).isDirectory()) {
          cwd = resolvedCwd.absPath;
        }
      }

      baseStep.cwd = cwd;
      onStepUpdate?.({ ...baseStep, cwd });

      const timeoutMs = Math.max(5000, Math.min(300000, Number(args.timeout_ms) || DEFAULT_COMMAND_TIMEOUT_MS));
      const res = await runShellCapture(command, cwd, {
        timeoutMs,
        signal,
        stepId,
        registerProcess,
        onChunk: (chunk, streamName) => onStepOutput?.(stepId, chunk, streamName)
      });

      const ok = res.exitCode === 0 && !res.timedOut && !res.aborted;
      return finalize(
        {
          status: ok ? "success" : "error",
          cwd,
          exitCode: res.exitCode,
          badge: res.aborted ? "Đã dừng" : `Exit ${res.exitCode} · ${(res.durationMs / 1000).toFixed(1)}s`,
          summary: res.error || (ok ? `Hoàn tất (Exit 0)` : `Kết thúc với mã lỗi ${res.exitCode}`),
          output: res.output || (res.error ? res.error : "(Không có output)")
        },
        {
          ok,
          command,
          cwd,
          exitCode: res.exitCode,
          timedOut: res.timedOut,
          durationMs: res.durationMs,
          output: res.output.slice(-14000),
          error: res.error || undefined
        }
      );
    }

    // 8. get_diagnostics
    if (canonical === "get_diagnostics") {
      const targetPath = String(args.path || "").trim();
      const items = [];
      const allDiags = vscode.languages.getDiagnostics();
      for (const [uri, diags] of allDiags) {
        if (!diags || diags.length === 0) continue;
        const rel =
          vscode.workspace.workspaceFolders?.length > 0
            ? toPosixPath(vscode.workspace.asRelativePath(uri, false))
            : toPosixPath(uri.fsPath || uri.toString());
        if (targetPath && !rel.toLowerCase().includes(targetPath.toLowerCase())) continue;
        for (const d of diags) {
          if (items.length >= 80) break;
          const severity =
            d.severity === vscode.DiagnosticSeverity.Error
              ? "ERROR"
              : d.severity === vscode.DiagnosticSeverity.Warning
                ? "WARN"
                : "INFO";
          items.push({
            file: rel,
            line: d.range.start.line + 1,
            severity,
            source: d.source || "",
            message: d.message
          });
        }
      }
      const preview = items.slice(0, 20).map((d) => `[${d.severity}] ${d.file}:${d.line} — ${d.message}`).join("\n");
      return finalize(
        {
          status: "success",
          badge: `${items.length} vấn đề`,
          summary: items.length ? `Phát hiện ${items.length} chẩn đoán IDE` : "Không có lỗi hoặc cảnh báo nào",
          output: preview || "Không có lỗi trong bảng Problems."
        },
        { ok: true, count: items.length, diagnostics: items }
      );
    }

    // 9. git_info
    if (canonical === "git_info") {
      const action = ["status", "diff", "log"].includes(String(args.action || "").toLowerCase())
        ? String(args.action).toLowerCase()
        : "status";
      const safePath = args.path ? ` -- "${String(args.path).replace(/"/g, "")}"` : "";
      const cmd =
        action === "log"
          ? `git log -n 12 --oneline${safePath}`
          : action === "diff"
            ? `git diff --stat${safePath}`
            : `git status -sb${safePath}`;

      const res = await runShellCapture(cmd, defaultCwd, { timeoutMs: 20000, signal, stepId, registerProcess });
      return finalize(
        {
          status: res.exitCode === 0 ? "success" : "error",
          cwd: defaultCwd,
          exitCode: res.exitCode,
          badge: res.exitCode === 0 ? "OK" : `Exit ${res.exitCode}`,
          summary: res.exitCode === 0 ? `git ${action} hoàn tất` : `git ${action} lỗi (${res.exitCode})`,
          output: res.output || "(Sạch — không có thay đổi)"
        },
        { ok: res.exitCode === 0, action, output: res.output.slice(-12000) }
      );
    }

    // 10. web_fetch
    if (canonical === "web_fetch") {
      const rawUrl = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(rawUrl)) {
        return finalize(
          { status: "error", badge: "URL lỗi", summary: "Chỉ hỗ trợ URL http:// hoặc https://" },
          { ok: false, error: "URL must start with http:// or https://" }
        );
      }
      const maxChars = Math.max(1000, Math.min(40000, Number(args.max_chars) || 18000));
      const resp = await fetch(rawUrl, {
        method: "GET",
        signal,
        headers: { "User-Agent": "001Router-Agent/1.4" }
      });
      const contentType = resp.headers.get("content-type") || "";
      let body = await resp.text();
      if (/text\/html/i.test(contentType)) {
        body = body
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const clipped = body.slice(0, maxChars);
      return finalize(
        {
          status: resp.ok ? "success" : "error",
          badge: `HTTP ${resp.status}`,
          summary: `${resp.status} · ${clipped.length} ký tự`,
          output: clipped.slice(0, 1200) + (clipped.length > 1200 ? "\n..." : "")
        },
        { ok: resp.ok, status: resp.status, contentType, content: clipped }
      );
    }

    // 11. open_file
    if (canonical === "open_file") {
      const targetPath = String(args.path || "").trim();
      const resolved = resolveProjectPath(targetPath, roots, {
        allowOutside: Boolean(permissions?.outsideWorkspace) || permCheck.decision === "ask",
        mustExist: true
      });
      if (!resolved) {
        return finalize(
          { status: "error", badge: "Không thấy", summary: `Không tìm thấy tệp: ${targetPath}` },
          { ok: false, error: `File not found: ${targetPath}` }
        );
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved.absPath));
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const lineNum = Math.max(1, Number(args.line) || 1);
      const pos = new vscode.Position(Math.min(doc.lineCount - 1, lineNum - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      return finalize(
        {
          status: "success",
          target: resolved.relPath,
          badge: `L${lineNum}`,
          summary: `Đã mở ${resolved.relPath} tại dòng ${lineNum}`,
          absPath: resolved.absPath
        },
        { ok: true, opened: resolved.relPath, line: lineNum }
      );
    }

    // 12. update_plan
    if (canonical === "update_plan") {
      const steps = Array.isArray(args.steps)
        ? args.steps.slice(0, 14).map((s) => ({
            title: String(s?.title || "").trim(),
            status: ["pending", "in_progress", "done", "failed"].includes(s?.status) ? s.status : "pending"
          })).filter((s) => s.title)
        : [];
      onPlanUpdate?.(steps);
      const doneCount = steps.filter((s) => s.status === "done").length;
      return finalize(
        {
          status: "success",
          badge: `${doneCount}/${steps.length}`,
          summary: `Kế hoạch gồm ${steps.length} bước (${doneCount} xong)`,
          output: steps.map((s) => `[${s.status}] ${s.title}`).join("\n")
        },
        { ok: true, steps }
      );
    }

    return finalize(
      { status: "error", badge: "Không hỗ trợ", summary: `Công cụ không tồn tại: ${toolName}` },
      { ok: false, error: `Unknown tool: ${toolName}` }
    );
  } catch (err) {
    const msg = formatErrorMessage(err);
    return finalize(
      { status: "error", badge: "Lỗi", summary: msg, output: msg },
      { ok: false, error: msg }
    );
  }
}

module.exports = {
  buildLineDiff,
  describeToolAction,
  runShellCapture,
  executeAgentTool
};
