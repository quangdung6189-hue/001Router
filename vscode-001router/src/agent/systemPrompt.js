"use strict";

function buildSystemPrompt(mode, editorContext, includeWorkspace = true, toolsEnabled = false, permissions = {}) {
  const parts = [];
  const ws = includeWorkspace ? editorContext?.workspaceSummary : null;

  if (ws && ws.fileCount > 0) {
    parts.push(
      `Opened Project Folder: "${ws.projectName}" (${ws.projectRoot}) — ${ws.fileCount}${ws.truncated ? "+" : ""} files across ${ws.dirCount} folders.`
    );
  } else if (editorContext?.workingDir) {
    parts.push(`Working directory: ${editorContext.workingDir}.`);
  }

  if (editorContext?.activeFile) {
    parts.push(
      `Active editor file: ${editorContext.activeFile.displayPath} (${editorContext.activeFile.languageId || "text"}, ${editorContext.activeFile.lineCount} lines).`
    );
  }

  if (Array.isArray(editorContext?.openTabs) && editorContext.openTabs.length > 0) {
    const tabNames = editorContext.openTabs.slice(0, 12).map((t) => t.displayPath || t.fileName).join(", ");
    parts.push(`Open editor tabs: ${tabNames}.`);
  }

  if (ws?.treePreview) {
    parts.push(`Project directory structure:\n\`\`\`text\n${ws.treePreview}\n\`\`\``);
  }

  if (toolsEnabled) {
    const caps = [];
    if (permissions.readFiles !== false) caps.push("list_files", "read_file", "search_files");
    if (mode === "auto") {
      caps.push("write_to_file", "replace_in_file", "delete_file", "execute_command");
    }
    caps.push("get_diagnostics", "git_info", "web_fetch", "open_file", "update_plan");
    const accessSummary = [
      `preset=${permissions.preset || "yolo"}`,
      `terminal=${permissions.executeTerminal ? "enabled" : "approval"}`,
      `edit=${permissions.editFiles ? "enabled" : "approval"}`,
      `outsideWorkspace=${permissions.outsideWorkspace ? "enabled" : "approval"}`,
      `web=${permissions.webAccess ? "enabled" : "approval"}`
    ].join(", ");

    parts.push(
      `Autonomous Tools Available (${accessSummary}): ${caps.join(", ")}.\n` +
        "Execution discipline:\n" +
        "- Inspect real files with read_file / list_files / search_files before making claims.\n" +
        "- For multi-step engineering work, call update_plan to track clear milestones.\n" +
        "- Execute real file edits (replace_in_file / write_to_file) and verify with execute_command (build/test) when asked to implement or fix.\n" +
        "- Keep tool calls focused and efficient (avoid redundant reads of files already provided in the snapshot).\n" +
        "- ALWAYS conclude with a clear, complete final response summarizing exact findings, files changed, and commands run. Never stop mid-task without delivering your final answer."
    );
  }

  const envBlock = parts.length ? `\n\n[Workspace Environment]\n${parts.join("\n")}\n\n` : " ";

  if (mode === "ask") {
    return (
      `You are 001Router Axiom, a senior systems architect AI inside VS Code / Antigravity IDE (Ask mode).${envBlock}` +
      "Give accurate, structured architectural and debugging answers grounded strictly in the real project files, folder structure, and tool results. " +
      "Cite exact relative file paths and line numbers; never invent files or APIs."
    );
  }
  if (mode === "plan") {
    return (
      `You are 001Router Axiom, a senior systems architect AI inside VS Code / Antigravity IDE (Plan mode).${envBlock}` +
      "Inspect the codebase thoroughly with read-only tools and produce a crisp step-by-step engineering plan with exact files to change and verification commands."
    );
  }
  return (
    `You are 001Router Axiom, an autonomous senior coding agent inside VS Code / Antigravity IDE (Auto Agent mode).${envBlock}` +
    "Complete the developer's request end-to-end using your workspace, file-edit, terminal, diagnostics, git, and web tools. " +
    "Preserve existing conventions, verify builds/tests via execute_command when you modify code, and report exact paths and results clearly."
  );
}

module.exports = { buildSystemPrompt };
