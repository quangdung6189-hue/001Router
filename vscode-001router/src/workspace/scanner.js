"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  IGNORED_DIRS,
  BINARY_EXTS,
  PROJECT_ROOT_MARKERS,
  MANIFEST_FILE_NAMES,
  MAX_WORKSPACE_SCAN_FILES,
  MAX_WORKSPACE_SCAN_DEPTH,
  MAX_WORKSPACE_TREE_LINES,
  MAX_HYDRATED_TOTAL_CHARS,
  MAX_SINGLE_READ_CHARS
} = require("../constants");

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function isBinaryFileName(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return BINARY_EXTS.has(ext);
}

function formatErrorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

function stripAnsi(str) {
  return String(str || "").replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g,
    ""
  );
}

function findProjectRootFromPath(startDir) {
  let cur = startDir;
  for (let i = 0; i < 6; i++) {
    if (!cur) break;
    try {
      for (const marker of PROJECT_ROOT_MARKERS) {
        if (fs.existsSync(path.join(cur, marker))) {
          return { rootPath: cur, detected: true };
        }
      }
    } catch {
      break;
    }
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return { rootPath: startDir, detected: false };
}

function scanWorkspaceRoots(roots, source) {
  const validRoots = (roots || []).filter((r) => {
    try {
      return r?.fsPath && fs.existsSync(r.fsPath) && fs.statSync(r.fsPath).isDirectory();
    } catch {
      return false;
    }
  });
  if (validRoots.length === 0) return null;

  const multiRoot = validRoots.length > 1;
  const files = [];
  const manifests = [];
  const topEntries = [];
  const treeLines = [];
  let dirCount = 0;
  let truncated = false;

  const walk = (rootObj, absDir, relPrefix, depth) => {
    if (depth > MAX_WORKSPACE_SCAN_DEPTH || files.length >= MAX_WORKSPACE_SCAN_FILES) {
      if (files.length >= MAX_WORKSPACE_SCAN_FILES) truncated = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_SCAN_FILES) {
        truncated = true;
        return;
      }
      const name = entry.name;
      if (!name || name === "." || name === "..") continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(name) || (name.startsWith(".") && name !== ".github" && name !== ".env.example")) {
          continue;
        }
        dirCount++;
        const nextRel = relPrefix ? `${relPrefix}/${name}` : name;
        if (depth === 0 && topEntries.length < 30) {
          topEntries.push({ name: `${name}/`, kind: "dir", relPath: nextRel });
        }
        if (treeLines.length < MAX_WORKSPACE_TREE_LINES) {
          treeLines.push(`${"  ".repeat(depth)}${name}/`);
        }
        walk(rootObj, path.join(absDir, name), nextRel, depth + 1);
      } else if (entry.isFile()) {
        if (name === ".DS_Store" || name === "Thumbs.db") continue;
        const relPath = relPrefix ? `${relPrefix}/${name}` : name;
        const fullRel = multiRoot ? `${rootObj.name}/${relPath}` : relPath;
        files.push(fullRel);
        if (depth === 0 && topEntries.length < 30) {
          topEntries.push({ name, kind: "file", relPath: fullRel });
        }
        if (depth <= 1 && MANIFEST_FILE_NAMES.has(name.toLowerCase())) {
          manifests.push(fullRel);
        }
        if (treeLines.length < MAX_WORKSPACE_TREE_LINES) {
          treeLines.push(`${"  ".repeat(depth)}${name}`);
        }
      }
    }
  };

  for (const r of validRoots) {
    if (multiRoot && treeLines.length < MAX_WORKSPACE_TREE_LINES) {
      treeLines.push(`[${r.name}]/`);
    }
    walk(r, r.fsPath, "", 0);
  }

  if (truncated || files.length > treeLines.length) {
    treeLines.push(`... (${files.length}${truncated ? "+" : ""} files total)`);
  }

  const projectName = multiRoot
    ? `${validRoots[0].name} (+${validRoots.length - 1})`
    : validRoots[0].name || path.basename(validRoots[0].fsPath);

  return {
    source,
    projectName,
    projectRoot: validRoots[0].fsPath,
    roots: validRoots,
    fileCount: files.length,
    dirCount,
    truncated,
    files,
    manifests: manifests.slice(0, 10),
    topEntries,
    treePreview: treeLines.join("\n")
  };
}

/**
 * Resolve a requested path relative to workspace roots (or outside workspace when allowed).
 * Returns `{ absPath, relPath, root, isOutsideWorkspace }` or `null`.
 */
function resolveProjectPath(requestedPath, roots, opts = {}) {
  const { allowOutside = false, mustExist = true } = opts;
  const raw = String(requestedPath || "").trim().replace(/^['"`]|['"`]$/g, "");
  if (!raw || raw.includes("\0")) return null;

  const validRoots = Array.isArray(roots) ? roots.filter((r) => r?.fsPath) : [];
  const normRaw = toPosixPath(raw).replace(/^\.\//, "");
  const candidates = [];

  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else if (validRoots.length > 0) {
    if (validRoots.length > 1) {
      for (const r of validRoots) {
        const prefix = `${r.name}/`;
        if (normRaw.startsWith(prefix)) {
          candidates.push(path.resolve(r.fsPath, normRaw.slice(prefix.length)));
        }
      }
    }
    for (const r of validRoots) {
      candidates.push(path.resolve(r.fsPath, normRaw === "." ? "" : normRaw));
    }
  }

  // First try strictly inside workspace roots
  for (const cand of candidates) {
    for (const r of validRoots) {
      const rootAbs = path.resolve(r.fsPath);
      const rel = path.relative(rootAbs, cand);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        if (!mustExist || fs.existsSync(cand)) {
          return {
            absPath: cand,
            root: r,
            relPath: validRoots.length > 1 ? `${r.name}/${toPosixPath(rel)}` : toPosixPath(rel || "."),
            isOutsideWorkspace: false
          };
        }
      }
    }
  }

  // Fallback for paths outside workspace (permission-checked by permissionManager!)
  if (allowOutside || path.isAbsolute(raw)) {
    const outsideAbs = path.isAbsolute(raw)
      ? path.resolve(raw)
      : validRoots[0]
        ? path.resolve(validRoots[0].fsPath, raw)
        : null;
    if (outsideAbs && (!mustExist || fs.existsSync(outsideAbs))) {
      return {
        absPath: outsideAbs,
        root: validRoots[0] || null,
        relPath: toPosixPath(outsideAbs),
        isOutsideWorkspace: true
      };
    }
  }

  return null;
}

function readNumberedTextFile(absPath, startLine = 1, endLine = 0, maxChars = MAX_SINGLE_READ_CHARS) {
  if (isBinaryFileName(absPath)) {
    return { ok: false, error: `Skipped binary file: ${path.basename(absPath)}` };
  }
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    return { ok: false, error: formatErrorMessage(err) };
  }
  if (!stat.isFile()) {
    return { ok: false, error: "Target path is not a file." };
  }
  if (stat.size > 3 * 1024 * 1024) {
    return {
      ok: false,
      error: `File too large (${Math.round(stat.size / 1024)} KB). Use start_line/end_line to inspect ranges.`
    };
  }
  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf8");
  } catch (err) {
    return { ok: false, error: formatErrorMessage(err) };
  }
  const allLines = raw.split(/\r?\n/);
  const totalLines = allLines.length;
  const s = Math.max(1, Math.min(totalLines, Number(startLine) || 1));
  const e = endLine && Number(endLine) >= s ? Math.min(totalLines, Number(endLine)) : totalLines;

  let out = "";
  let lastLineIncluded = s - 1;
  let truncated = false;
  for (let i = s; i <= e; i++) {
    const formatted = `${i}: ${allLines[i - 1]}\n`;
    if (out.length + formatted.length > maxChars) {
      truncated = true;
      break;
    }
    out += formatted;
    lastLineIncluded = i;
  }

  return {
    ok: true,
    totalLines,
    startLine: s,
    endLine: Math.max(s, lastLineIncluded),
    truncated,
    content: truncated
      ? `${out}...[truncated at line ${lastLineIncluded}/${totalLines}; call read_file with start_line=${lastLineIncluded + 1} for more]`
      : out.trimEnd()
  };
}

function hydrateProjectContextFiles(promptText, editorContext, existingAttachments) {
  const ws = editorContext?.workspaceSummary;
  if (!ws || !Array.isArray(ws.roots) || ws.roots.length === 0 || !Array.isArray(ws.files) || ws.files.length === 0) {
    return { block: "", hydratedFiles: [] };
  }

  const existingPaths = new Set();
  for (const a of existingAttachments || []) {
    if (a?.path) existingPaths.add(toPosixPath(a.path).toLowerCase());
    if (a?.label) existingPaths.add(String(a.label).toLowerCase());
  }

  const lowerPrompt = String(promptText || "").toLowerCase();
  const isWholeProjectQuery =
    /(toàn bộ|tất cả|cả dự án|dữ án|cả folder|thư mục|cấu trúc|kiến trúc|tổng quan|nói về|làm gì|giới thiệu|tóm tắt|đọc.*file|quét|kiểm tra.*dự án|entire|all files|whole project|codebase|overview|project|repo|folder|architecture|explain.*repo|review.*project)/i.test(
      promptText || ""
    ) || existingAttachments.length === 0;

  const scoredCandidates = [];
  const seenRel = new Set();

  const addCandidate = (relPath, priority, perFileBudget) => {
    if (!relPath || seenRel.has(relPath)) return;
    if (isBinaryFileName(relPath)) return;
    const lowerRel = toPosixPath(relPath).toLowerCase();
    if (existingPaths.has(lowerRel)) return;
    seenRel.add(relPath);
    scoredCandidates.push({ relPath, priority, perFileBudget });
  };

  for (const rel of ws.files) {
    const base = path.basename(rel).toLowerCase();
    if ((base.length >= 4 && lowerPrompt.includes(base)) || (rel.length >= 5 && lowerPrompt.includes(rel.toLowerCase()))) {
      addCandidate(rel, 100, 12000);
    }
  }
  for (const mRel of ws.manifests || []) {
    addCandidate(mRel, 85, 6000);
  }
  for (const tab of editorContext.openTabs || []) {
    if (tab.displayPath && ws.files.includes(tab.displayPath)) {
      addCandidate(tab.displayPath, 75, 8000);
    }
  }

  if (isWholeProjectQuery) {
    const ENTRY_NAME_RE = /^(index|main|app|server|client|router|extension|program|mod|lib|cli|config|routes|schema|entry)\./i;
    const SOURCE_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|cs|cpp|c|h|hpp|rb|php|lua|vue|svelte|html|css|sql|yaml|yml|toml|json|md|sh|ps1)$/i;

    const sortedProjectFiles = ws.files
      .filter((f) => SOURCE_EXT_RE.test(f) && !/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/i.test(f))
      .map((f) => {
        const depth = f.split("/").length - 1;
        const base = path.basename(f);
        let score = 40 - depth * 6;
        if (ENTRY_NAME_RE.test(base)) score += 22;
        if (/^(src|app|server|lib|cmd|pkg|core)\//i.test(f)) score += 8;
        return { relPath: f, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const item of sortedProjectFiles.slice(0, 14)) {
      addCandidate(item.relPath, item.score, 5200);
    }
  }

  scoredCandidates.sort((a, b) => b.priority - a.priority);

  const hydratedSections = [];
  const hydratedFiles = [];
  let totalChars = 0;
  const maxFiles = isWholeProjectQuery ? 12 : 6;

  for (const cand of scoredCandidates) {
    if (hydratedFiles.length >= maxFiles || totalChars >= MAX_HYDRATED_TOTAL_CHARS) break;
    const resolved = resolveProjectPath(cand.relPath, ws.roots, { allowOutside: false, mustExist: true });
    if (!resolved) continue;
    const remaining = Math.min(cand.perFileBudget, MAX_HYDRATED_TOTAL_CHARS - totalChars);
    if (remaining < 400) break;
    const readRes = readNumberedTextFile(resolved.absPath, 1, 0, remaining);
    if (!readRes.ok || !readRes.content) continue;
    const ext = path.extname(cand.relPath).slice(1);
    hydratedSections.push(
      `#### ${cand.relPath} (${readRes.totalLines} lines)\n\`\`\`${ext}\n${readRes.content}\n\`\`\``
    );
    hydratedFiles.push(cand.relPath);
    totalChars += readRes.content.length;
  }

  if (hydratedSections.length === 0) {
    return { block: "", hydratedFiles: [] };
  }

  const block =
    `### Project Workspace Snapshot: ${ws.projectName} (${ws.fileCount}${ws.truncated ? "+" : ""} files in folder, ${hydratedFiles.length} key files preloaded)\n\n` +
    hydratedSections.join("\n\n");

  return { block, hydratedFiles };
}

function normalizeComparePath(p) {
  const resolved = path.resolve(String(p || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const SKIP_SIBLING_DIRS = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "appdata",
  "recovery",
  "perflogs",
  "msocache",
  "node_modules",
  "temp",
  "tmp"
]);

/**
 * Discover nearby sibling project folders next to the current workspace so users
 * can switch projects on disk with 1 click without reopening VS Code.
 */
function discoverNearbyProjects(baseDir, excludePaths = [], limit = 12) {
  if (!baseDir) return [];
  const parent = path.dirname(path.resolve(baseDir));
  if (!parent || parent === path.resolve(baseDir)) return [];

  const excluded = new Set((excludePaths || []).map(normalizeComparePath));
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!name || name.startsWith(".") || name.startsWith("$")) continue;
    if (SKIP_SIBLING_DIRS.has(name.toLowerCase()) || IGNORED_DIRS.has(name)) continue;
    const absPath = path.join(parent, name);
    if (excluded.has(normalizeComparePath(absPath))) continue;

    let hasMarker = false;
    try {
      for (const marker of PROJECT_ROOT_MARKERS) {
        if (fs.existsSync(path.join(absPath, marker))) {
          hasMarker = true;
          break;
        }
      }
    } catch {
      continue;
    }

    results.push({
      name,
      fsPath: absPath,
      source: "nearby",
      hasMarker
    });
  }

  results.sort((a, b) => {
    if (a.hasMarker !== b.hasMarker) return a.hasMarker ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results.slice(0, limit).map(({ name, fsPath, source }) => ({ name, fsPath, source }));
}

module.exports = {
  toPosixPath,
  normalizeComparePath,
  isBinaryFileName,
  formatErrorMessage,
  stripAnsi,
  findProjectRootFromPath,
  discoverNearbyProjects,
  scanWorkspaceRoots,
  resolveProjectPath,
  readNumberedTextFile,
  hydrateProjectContextFiles
};
