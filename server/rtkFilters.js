/**
 * 12-filter RTK (Rust Token Killer) auto-detect compression engine ported from 9Router.
 * Auto-detects structured CLI / tool output (git diff, git status, git log, build logs,
 * grep, find, tree, ls, search-list, numbered file dumps, duplicate logs, smart truncate)
 * and compresses losslessly before sending to upstream LLMs.
 */

export const RTK_CONSTANTS = {
  RAW_CAP: 10 * 1024 * 1024,
  MIN_COMPRESS_SIZE: 300,
  DETECT_WINDOW: 1024,
  GIT_DIFF_HUNK_MAX_LINES: 100,
  GIT_LOG_MAX_LINES: 200,
  DEDUP_LINE_MAX: 2000,
  GREP_PER_FILE_MAX: 10,
  FIND_PER_DIR_MAX: 10,
  FIND_TOTAL_DIR_MAX: 20,
  STATUS_MAX_FILES: 10,
  STATUS_MAX_UNTRACKED: 10,
  LS_EXT_SUMMARY_TOP: 5,
  TREE_MAX_LINES: 200,
  SEARCH_LIST_PER_DIR_MAX: 10,
  SEARCH_LIST_TOTAL_DIR_MAX: 20,
  SMART_TRUNCATE_HEAD: 120,
  SMART_TRUNCATE_TAIL: 60,
  SMART_TRUNCATE_MIN_LINES: 250,
  READ_NUMBERED_MIN_HIT_RATIO: 0.7
};

const LS_NOISE_DIRS = new Set([
  "node_modules", ".git", "target", "__pycache__",
  ".next", "dist", "build", ".cache", ".turbo",
  ".vercel", ".pytest_cache", ".mypy_cache", ".tox",
  ".venv", "venv", "env", "coverage", ".nyc_output",
  ".DS_Store", "Thumbs.db", ".idea", ".vscode", ".vs"
]);

export const RTK_FILTER_CATALOG = [
  { id: "git-diff", label: "git-diff", desc: "Compacts unified diffs with hunk caps & +/- counts" },
  { id: "git-status", label: "git-status", desc: "Summarizes staged, modified, untracked & conflict lists" },
  { id: "git-log", label: "git-log", desc: "Keeps commit hashes, authors, dates & subjects" },
  { id: "build-output", label: "build-output", desc: "Keeps errors, warnings & summary; drops compile noise" },
  { id: "grep", label: "grep", desc: "Groups file:line:match results per file (cap 10/file)" },
  { id: "find", label: "find", desc: "Groups file paths by parent directory" },
  { id: "tree", label: "tree", desc: "Trims summary lines & caps deep directory trees" },
  { id: "ls", label: "ls", desc: "Strips permissions/dates/noise dirs; keeps name + size" },
  { id: "search-list", label: "search-list", desc: "Compacts IDE glob search file lists by directory" },
  { id: "read-numbered", label: "read-numbered", desc: "Trims padded line-number gutters (never drops lines)" },
  { id: "dedup-log", label: "dedup-log", desc: "Collapses repeated consecutive log & blank lines" },
  { id: "smart-truncate", label: "smart-truncate", desc: "Only above Max Chars: keeps 60% head + 35% tail" }
];

// --- 1. git-diff ---
export function filterGitDiff(diff, maxLines = 500) {
  const result = [];
  let currentFile = "";
  let added = 0;
  let removed = 0;
  let inHunk = false;
  let hunkShown = 0;
  let hunkSkipped = 0;
  let wasTruncated = false;
  const maxHunkLines = RTK_CONSTANTS.GIT_DIFF_HUNK_MAX_LINES;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        wasTruncated = true;
        hunkSkipped = 0;
      }
      if (currentFile && (added > 0 || removed > 0)) {
        result.push(`  +${added} -${removed}`);
      }
      const parts = line.split(" b/");
      currentFile = parts.length > 1 ? parts.slice(1).join(" b/") : "unknown";
      result.push(`\n${currentFile}`);
      added = 0;
      removed = 0;
      inHunk = false;
      hunkShown = 0;
    } else if (line.startsWith("@@")) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        wasTruncated = true;
        hunkSkipped = 0;
      }
      inHunk = true;
      hunkShown = 0;
      result.push(`  ${line}`);
    } else if (inHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        added += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        removed += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (hunkShown < maxHunkLines && !line.startsWith("\\")) {
        if (hunkShown > 0) {
          result.push(`  ${line}`);
          hunkShown += 1;
        }
      }
    }

    if (result.length >= maxLines) {
      result.push("\n... (more changes truncated)");
      wasTruncated = true;
      break;
    }
  }

  if (hunkSkipped > 0) {
    result.push(`  ... (${hunkSkipped} lines truncated)`);
    wasTruncated = true;
  }
  if (currentFile && (added > 0 || removed > 0)) {
    result.push(`  +${added} -${removed}`);
  }
  if (wasTruncated) {
    result.push("[full diff omitted by RTK]");
  }
  return result.join("\n").trimStart();
}
filterGitDiff.filterName = "git-diff";

// --- 2. git-status ---
export function filterGitStatus(input) {
  const lines = input.split("\n");
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
    return "Clean working tree";
  }

  let branch = "";
  const stagedFiles = [];
  const modifiedFiles = [];
  const untrackedFiles = [];
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicts = 0;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const longBranch = raw.match(/^On branch (\S+)/);
    if (longBranch) { branch = longBranch[1]; continue; }
    if (raw.startsWith("##")) { branch = raw.replace(/^##\s*/, ""); continue; }

    if (raw.length >= 3 && /^[ MADRCU?!][ MADRCU?!] /.test(raw)) {
      const x = raw[0];
      const y = raw[1];
      const file = raw.slice(3);
      if (raw.slice(0, 2) === "??") {
        untracked++;
        untrackedFiles.push(file);
        continue;
      }
      if ("MADRC".includes(x)) { staged++; stagedFiles.push(file); }
      else if (x === "U") { conflicts++; }
      if (y === "M" || y === "D") { modified++; modifiedFiles.push(file); }
      continue;
    }

    const longMatch = raw.match(/^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$/);
    if (longMatch) {
      const kind = longMatch[1];
      const filePath = longMatch[2].trim();
      if (kind === "both modified") conflicts++;
      else if (kind === "modified" || kind === "deleted") { modified++; modifiedFiles.push(filePath); }
      else { staged++; stagedFiles.push(filePath); }
    }
  }

  let out = "";
  if (branch) out += `* ${branch}\n`;
  if (staged > 0) {
    out += `+ Staged: ${staged} files\n`;
    for (const f of stagedFiles.slice(0, RTK_CONSTANTS.STATUS_MAX_FILES)) out += `   ${f}\n`;
    if (stagedFiles.length > RTK_CONSTANTS.STATUS_MAX_FILES) {
      out += `   ... +${stagedFiles.length - RTK_CONSTANTS.STATUS_MAX_FILES} more\n`;
    }
  }
  if (modified > 0) {
    out += `~ Modified: ${modified} files\n`;
    for (const f of modifiedFiles.slice(0, RTK_CONSTANTS.STATUS_MAX_FILES)) out += `   ${f}\n`;
    if (modifiedFiles.length > RTK_CONSTANTS.STATUS_MAX_FILES) {
      out += `   ... +${modifiedFiles.length - RTK_CONSTANTS.STATUS_MAX_FILES} more\n`;
    }
  }
  if (untracked > 0) {
    out += `? Untracked: ${untracked} files\n`;
    for (const f of untrackedFiles.slice(0, RTK_CONSTANTS.STATUS_MAX_UNTRACKED)) out += `   ${f}\n`;
    if (untrackedFiles.length > RTK_CONSTANTS.STATUS_MAX_UNTRACKED) {
      out += `   ... +${untrackedFiles.length - RTK_CONSTANTS.STATUS_MAX_UNTRACKED} more\n`;
    }
  }
  if (conflicts > 0) out += `conflicts: ${conflicts} files\n`;
  if (staged === 0 && modified === 0 && untracked === 0 && conflicts === 0) {
    out += "clean — nothing to commit\n";
  }
  return out.replace(/\n+$/, "");
}
filterGitStatus.filterName = "git-status";

// --- 3. git-log ---
export function filterGitLog(text, maxLines = RTK_CONSTANTS.GIT_LOG_MAX_LINES) {
  const input = String(text || "");
  if (!input) return "";
  const out = [];
  let skipped = 0;
  let inCommit = false;
  let subjectSeen = false;

  const pushLine = (l) => {
    if (out.length < maxLines) { out.push(l); return true; }
    skipped++;
    return false;
  };

  for (const raw of input.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (/^commit [0-9a-f]{7,40}$/i.test(trimmed) || /^[*|/\\ ]+commit [0-9a-f]{7,40}/i.test(trimmed)) {
      inCommit = true;
      subjectSeen = false;
      pushLine(line);
      continue;
    }
    if (inCommit) {
      if (/^[*|/\\ ]*(Author|Date):/i.test(trimmed)) { pushLine(trimmed); continue; }
      if (trimmed === "") continue;
      if (!subjectSeen && /^[*|/\\ ]*    \S/.test(line)) {
        pushLine("  Subject: " + trimmed);
        subjectSeen = true;
        continue;
      }
      if (/^\d+ file\w* changed/.test(trimmed)) { pushLine("  " + trimmed); continue; }
      if (/^diff --git /.test(trimmed)) { pushLine("  ... diff body omitted"); continue; }
      continue;
    }
    const graphMatch = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graphMatch) { pushLine(graphMatch[1]); continue; }
    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) { pushLine(trimmed); continue; }
    if (/^[*|/\\ ]+$/.test(trimmed) && /[*|/\\]/.test(trimmed)) continue;
    pushLine(trimmed);
  }
  if (skipped > 0) out.push(`... (${skipped} more lines)`);
  const result = out.join("\n");
  return result && result.length < input.length ? result : input;
}
filterGitLog.filterName = "git-log";

// --- 4. build-output ---
const RE_CARGO_ERR_CONT = /^\s*(-->|\||\d+\s*\||=)/;
export function filterBuildOutput(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;
  const errors = [];
  const warnings = [];
  const deprecations = [];
  let summary = null;
  let compilingCount = 0;
  let downloadingCount = 0;
  let inCargoError = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inCargoError) {
      if (!trimmed) { inCargoError = false; continue; }
      if (RE_CARGO_ERR_CONT.test(line)) { errors.push(line); continue; }
      inCargoError = false;
    }
    if (!trimmed) continue;
    if (/^npm (ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) { errors.push(line); continue; }
    if (/^npm warn deprecated/i.test(trimmed)) { deprecations.push(line); continue; }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) { warnings.push(line); continue; }
    if (/^error(\[|:)/i.test(trimmed) || trimmed.startsWith("error -->")) { errors.push(line); inCargoError = true; continue; }
    if (/^warning(\[|:)/i.test(trimmed) || trimmed.startsWith("warning -->")) { warnings.push(line); inCargoError = true; continue; }
    if (/^ERROR:/i.test(trimmed) || /^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) { errors.push(line); continue; }
    if (/^\[WARNING\]/i.test(trimmed)) { warnings.push(line); continue; }
    if (/^\s*Compiling\s+\S+/i.test(trimmed)) { compilingCount++; continue; }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) { downloadingCount++; continue; }
    if (
      /^(added|removed|changed|audited|installed)\s+\d+\s+package/i.test(trimmed) ||
      /^\s*Finished\s+/i.test(trimmed) ||
      /^BUILD SUCCESS/i.test(trimmed) ||
      /^\d+\s+(vulnerabilities|packages?|warnings?|errors?)/i.test(trimmed) ||
      /^Successfully (installed|built)/i.test(trimmed) ||
      /^✓ built in/i.test(trimmed)
    ) {
      summary = summary ? `${summary}\n${line}` : line;
    }
  }

  let out = "";
  for (const d of deprecations.slice(0, 3)) out += `${d}\n`;
  if (deprecations.length > 3) out += `... +${deprecations.length - 3} more deprecated packages\n`;
  if (compilingCount > 0) out += `Compiled ${compilingCount} packages\n`;
  if (downloadingCount > 0) out += `Downloaded ${downloadingCount} packages\n`;
  for (const e of errors) out += `${e}\n`;
  for (const w of warnings.slice(0, 5)) out += `${w}\n`;
  if (warnings.length > 5) out += `... +${warnings.length - 5} more warnings\n`;
  if (summary) out += `${summary}\n`;
  return out.replace(/\n+$/, "") || input;
}
filterBuildOutput.filterName = "build-output";

// --- 5. grep ---
export function filterGrep(input) {
  const byFile = new Map();
  let total = 0;
  for (const line of input.split("\n")) {
    const first = line.indexOf(":");
    if (first === -1) continue;
    const second = line.indexOf(":", first + 1);
    if (second === -1) continue;
    const file = line.slice(0, first);
    const lineNumStr = line.slice(first + 1, second);
    const content = line.slice(second + 1);
    if (!/^\d+$/.test(lineNumStr)) continue;
    total++;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push([lineNumStr, content]);
  }
  if (total === 0) return input;
  const files = Array.from(byFile.keys()).sort();
  let out = `${total} matches in ${files.length}F:\n\n`;
  for (const file of files) {
    const matches = byFile.get(file);
    out += `[file] ${file} (${matches.length}):\n`;
    for (const [lineNum, content] of matches.slice(0, RTK_CONSTANTS.GREP_PER_FILE_MAX)) {
      out += `  ${lineNum.padStart(4)}: ${content.trim()}\n`;
    }
    if (matches.length > RTK_CONSTANTS.GREP_PER_FILE_MAX) {
      out += `  +${matches.length - RTK_CONSTANTS.GREP_PER_FILE_MAX}\n`;
    }
    out += "\n";
  }
  return out.replace(/\n+$/, "");
}
filterGrep.filterName = "grep";

// --- 6. find ---
export function filterFind(input) {
  const lines = input.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return input;
  const byDir = new Map();
  for (const filePath of lines) {
    const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    const dir = lastSep === -1 ? "." : filePath.slice(0, lastSep) || "/";
    const basename = lastSep === -1 ? filePath : filePath.slice(lastSep + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(basename);
  }
  const dirs = Array.from(byDir.keys()).sort();
  let out = `${lines.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, RTK_CONSTANTS.FIND_TOTAL_DIR_MAX)) {
    const files = byDir.get(dir);
    out += `${dir.replace(/\\/g, "/")}/ (${files.length})\n`;
    for (const f of files.slice(0, RTK_CONSTANTS.FIND_PER_DIR_MAX)) out += `  ${f}\n`;
    if (files.length > RTK_CONSTANTS.FIND_PER_DIR_MAX) {
      out += `  +${files.length - RTK_CONSTANTS.FIND_PER_DIR_MAX}\n`;
    }
  }
  if (dirs.length > RTK_CONSTANTS.FIND_TOTAL_DIR_MAX) {
    out += `\n+${dirs.length - RTK_CONSTANTS.FIND_TOTAL_DIR_MAX} more dirs`;
  }
  return out.replace(/\n+$/, "");
}
filterFind.filterName = "find";

// --- 7. tree ---
export function filterTree(input) {
  const lines = input.split("\n");
  const filtered = [];
  for (const line of lines) {
    if (line.includes("director") && line.includes("file")) continue;
    if (line.trim() === "" && filtered.length === 0) continue;
    filtered.push(line);
  }
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") filtered.pop();
  if (filtered.length > RTK_CONSTANTS.TREE_MAX_LINES) {
    const cut = filtered.length - RTK_CONSTANTS.TREE_MAX_LINES;
    return filtered.slice(0, RTK_CONSTANTS.TREE_MAX_LINES).join("\n") + `\n... +${cut} more lines`;
  }
  return filtered.join("\n");
}
filterTree.filterName = "tree";

// --- 8. ls ---
// Leading whitespace is matched with a lookbehind (not a consuming `\s+`) so an unanchored scan over a long
// whitespace-only line stays linear instead of O(n^2) (ReDoS).
const LS_DATE_RE = /(?<=\s)(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+/;
function humanSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}
export function filterLs(input) {
  const dirs = [];
  const files = [];
  const byExt = new Map();
  for (const line of input.split("\n")) {
    if (line.startsWith("total ") || !line) continue;
    const m = LS_DATE_RE.exec(line);
    if (!m) continue;
    const name = line.slice(m.index + m[0].length);
    if (name === "." || name === ".." || LS_NOISE_DIRS.has(name)) continue;
    const beforeParts = line.slice(0, m.index).split(/\s+/).filter(Boolean);
    if (beforeParts.length < 4) continue;
    const fileType = beforeParts[0].charAt(0);
    let size = 0;
    for (let i = beforeParts.length - 1; i >= 0; i--) {
      const n = Number(beforeParts[i]);
      if (Number.isInteger(n) && String(n) === beforeParts[i]) { size = n; break; }
    }
    if (fileType === "d") dirs.push(name);
    else if (fileType === "-" || fileType === "l") {
      const dot = name.lastIndexOf(".");
      const ext = dot > 0 ? name.slice(dot) : "no ext";
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
      files.push([name, humanSize(size)]);
    }
  }
  if (dirs.length === 0 && files.length === 0) return input;
  let out = "";
  for (const d of dirs) out += `${d}/\n`;
  for (const [name, size] of files) out += `${name}  ${size}\n`;
  let summary = `\nSummary: ${files.length} files, ${dirs.length} dirs`;
  if (byExt.size > 0) {
    const ext = Array.from(byExt.entries()).sort((a, b) => b[1] - a[1]);
    const parts = ext.slice(0, RTK_CONSTANTS.LS_EXT_SUMMARY_TOP).map(([e, c]) => `${c} ${e}`);
    summary += ` (${parts.join(", ")}${ext.length > RTK_CONSTANTS.LS_EXT_SUMMARY_TOP ? `, +${ext.length - RTK_CONSTANTS.LS_EXT_SUMMARY_TOP} more` : ""})`;
  }
  return out + summary;
}
filterLs.filterName = "ls";

// --- 9. search-list ---
export const SEARCH_LIST_HEADER_RE = /^Result of search in '[^']*' \(total (\d+) files?\):/;
export function filterSearchList(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;
  const header = lines[0] || "";
  const paths = [];
  for (const raw of lines.slice(1)) {
    const t = raw.trim();
    if (t.startsWith("- ")) paths.push(t.slice(2));
  }
  if (paths.length === 0) return input;
  const byDir = new Map();
  for (const p of paths) {
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "." : p.slice(0, slash) || "/";
    const name = slash === -1 ? p : p.slice(slash + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(name);
  }
  const dirs = Array.from(byDir.keys()).sort();
  let out = `${header}\n${paths.length} files in ${dirs.length} dirs:\n\n`;
  for (const dir of dirs.slice(0, RTK_CONSTANTS.SEARCH_LIST_TOTAL_DIR_MAX)) {
    const names = byDir.get(dir);
    out += `${dir}/ (${names.length}):\n`;
    for (const n of names.slice(0, RTK_CONSTANTS.SEARCH_LIST_PER_DIR_MAX)) out += `  ${n}\n`;
    if (names.length > RTK_CONSTANTS.SEARCH_LIST_PER_DIR_MAX) {
      out += `  +${names.length - RTK_CONSTANTS.SEARCH_LIST_PER_DIR_MAX}\n`;
    }
    out += "\n";
  }
  if (dirs.length > RTK_CONSTANTS.SEARCH_LIST_TOTAL_DIR_MAX) {
    out += `+${dirs.length - RTK_CONSTANTS.SEARCH_LIST_TOTAL_DIR_MAX} more dirs`;
  }
  return out.replace(/\n+$/, "");
}
filterSearchList.filterName = "search-list";

// --- 10. read-numbered ---
export const READ_NUMBERED_LINE_RE = /^\s*\d+\|/;
export function filterReadNumbered(input) {
  // Only strip the left padding of the line-number gutter ("   42|code" -> "42|code").
  // Never drop lines: agents rely on seeing the whole file they asked to read. Oversized reads
  // are clamped later by compressText's Max Chars budget (60% head / 35% tail).
  return input
    .split("\n")
    .map((line) => {
      let i = 0;
      while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
      return i > 0 && READ_NUMBERED_LINE_RE.test(line) ? line.slice(i) : line;
    })
    .join("\n");
}
filterReadNumbered.filterName = "read-numbered";

// --- 11. dedup-log ---
export function filterDedupLog(input) {
  const lines = input.split("\n");
  const out = [];
  let prev = null;
  let runCount = 0;
  let blankStreak = 0;

  const flushRun = () => {
    if (prev !== null && runCount > 1) {
      out.push(`  ... (${runCount - 1} duplicate lines)`);
    }
  };

  for (const line of lines) {
    if (line.trim() === "") {
      if (blankStreak < 1) out.push(line);
      blankStreak += 1;
      flushRun();
      prev = null;
      runCount = 0;
      continue;
    }
    blankStreak = 0;
    if (line === prev) {
      runCount += 1;
      continue;
    }
    flushRun();
    out.push(line);
    prev = line;
    runCount = 1;
    if (out.length >= RTK_CONSTANTS.DEDUP_LINE_MAX) {
      out.push(`... (truncated at ${RTK_CONSTANTS.DEDUP_LINE_MAX} lines)`);
      return out.join("\n");
    }
  }
  flushRun();
  return out.join("\n");
}
filterDedupLog.filterName = "dedup-log";

// --- 12. smart-truncate ---
export function filterSmartTruncate(input) {
  // Intentionally a no-op at the RTK stage. Cutting by line count dropped the middle of any
  // 250+ line output even when it fit under Max Chars. The real clamp is character-budget based
  // and lives in compressText (tokenSaver.js), which only runs when Max Chars is exceeded.
  return input;
}
filterSmartTruncate.filterName = "smart-truncate";

// --- Auto-detect ---
const RE_GIT_DIFF = /^diff --git /m;
const RE_GIT_DIFF_HUNK = /^@@ /m;
const RE_GIT_STATUS = /^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:/m;
const RE_GIT_LOG = /^[*|/\\ ]*commit [0-9a-f]{7,40}$/m;
const RE_PORCELAIN = /^[ MADRCU?!][ MADRCU?!] \S/m;
const RE_BUILD_OUTPUT = /^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)/im;
const RE_TREE_GLYPH = /[├└]──|│  /;
const RE_LS_ROW = /^[-dlbcps][rwx-]{9}/m;
const RE_LS_TOTAL = /^total \d+$/m;

function isGrepLine(line) {
  const first = line.indexOf(":");
  if (first === -1) return false;
  const second = line.indexOf(":", first + 1);
  if (second === -1) return false;
  return /^\d+$/.test(line.slice(first + 1, second));
}

function isPathLike(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.includes(":")) return false;
  return t.startsWith(".") || t.startsWith("/") || t.includes("/");
}

function isMostlyPorcelain(head) {
  const lines = head.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const hits = lines.filter((l) => RE_PORCELAIN.test(l)).length;
  return hits / lines.length >= 0.6;
}

function isLineNumbered(lines) {
  let hits = 0;
  let nonEmpty = 0;
  for (const l of lines.slice(0, 100)) {
    if (!l.length) continue;
    nonEmpty++;
    if (READ_NUMBERED_LINE_RE.test(l)) hits++;
  }
  return nonEmpty >= 5 && hits / nonEmpty >= RTK_CONSTANTS.READ_NUMBERED_MIN_HIT_RATIO;
}

export function autoDetectRtkFilter(text) {
  if (typeof text !== "string" || !text) return null;
  const head = text.length > RTK_CONSTANTS.DETECT_WINDOW
    ? text.slice(0, RTK_CONSTANTS.DETECT_WINDOW)
    : text;

  if (RE_GIT_LOG.test(head)) return filterGitLog;
  if (RE_GIT_DIFF.test(head) || RE_GIT_DIFF_HUNK.test(head)) return filterGitDiff;
  if (RE_GIT_STATUS.test(head)) return filterGitStatus;
  if (RE_BUILD_OUTPUT.test(head)) return filterBuildOutput;
  if (isMostlyPorcelain(head)) return filterGitStatus;

  const lines = head.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.slice(0, 5).some(isGrepLine)) return filterGrep;
  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return filterFind;
  if (RE_TREE_GLYPH.test(head)) return filterTree;
  if (RE_LS_TOTAL.test(head) || (head.match(/^[-dlbcps][rwx-]{9}/gm) || []).length >= 3) return filterLs;
  if (SEARCH_LIST_HEADER_RE.test(head)) return filterSearchList;
  if (isLineNumbered(lines)) return filterReadNumbered;
  return null;
}

/**
 * Safely apply an RTK filter to a text string. Never throws, never returns empty or larger text.
 * @param {string} text
 * @returns {{ text: string, filter: string | null, savedChars: number }}
 */
export function applyRtkStructuredFilter(text) {
  if (typeof text !== "string" || text.length < RTK_CONSTANTS.MIN_COMPRESS_SIZE || text.length > RTK_CONSTANTS.RAW_CAP) {
    return { text: text ?? "", filter: null, savedChars: 0 };
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const fn = autoDetectRtkFilter(normalized);
  if (!fn) return { text, filter: null, savedChars: 0 };

  try {
    const out = fn(normalized);
    if (typeof out === "string" && out.length > 0 && out.length < text.length) {
      return {
        text: out,
        filter: fn.filterName || fn.name,
        savedChars: text.length - out.length
      };
    }
  } catch {
    // Fail-safe: keep original text
  }
  return { text, filter: null, savedChars: 0 };
}
