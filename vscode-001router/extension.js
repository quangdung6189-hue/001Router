"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const vscode = require("vscode");

const SECRET_SERVER_URL = "001router.serverUrl";
const SECRET_ROUTER_KEY = "001router.routerKey";
const STATE_SESSIONS = "001router.sessions";
const STATE_ACTIVE_SESSION = "001router.activeSessionId";
const STATE_SELECTION = "001router.selection";
const STATE_MODE = "001router.mode";
const STATE_AUTO_ACTIVE_FILE = "001router.autoActiveFile";
const STATE_AUTO_WORKSPACE = "001router.autoWorkspace";

const MAX_SESSIONS = 40;
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_ATTACHMENT_CHARS = 32000;
const MAX_TERMINAL_OUTPUT_CHARS = 24000;
const MAX_WORKSPACE_SCAN_FILES = 320;
const MAX_WORKSPACE_SCAN_DEPTH = 6;
const MAX_WORKSPACE_TREE_LINES = 140;
const MAX_HYDRATED_TOTAL_CHARS = 44000;
const MAX_SINGLE_READ_CHARS = 18000;
const MAX_TOOL_ROUNDS = 6;

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_SUFFIX_RE = /^(.*?)-(minimal|low|medium|high|xhigh|max)$/i;
const PRODUCT_MAX_RE = /(?:qwen|codex|minimax|mistral|doubao|glm|kimi|ernie|step|hunyuan|deepseek|grok|nova|sonar|baichuan|yi)[^/]*-max$/i;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "vendor",
  "coverage",
  ".idea",
  ".vs",
  ".vscode-test",
  "bin",
  "obj",
  ".gradle"
]);

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".vsix",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".sqlite",
  ".db",
  ".lockb",
  ".pyc",
  ".class",
  ".jar"
]);

const PROJECT_ROOT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "CMakeLists.txt",
  "composer.json",
  "Gemfile",
  "Makefile",
  "README.md"
];

const MANIFEST_FILE_NAMES = new Set([
  "readme.md",
  "package.json",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "composer.json",
  "cmakelists.txt",
  "makefile",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "next.config.js",
  "next.config.mjs"
]);

function splitEffortSuffix(modelId) {
  const raw = String(modelId || "").trim();
  const match = EFFORT_SUFFIX_RE.exec(raw);
  if (!match || !match[1]) return { baseId: raw, suffix: null };
  let suffix = match[2].toLowerCase();
  if (suffix === "max" && PRODUCT_MAX_RE.test(raw)) {
    return { baseId: raw, suffix: null };
  }
  if (suffix === "minimal") suffix = "low";
  return { baseId: match[1], suffix };
}

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function isBinaryFileName(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return BINARY_EXTS.has(ext);
}

function findProjectRootFromPath(startDir) {
  let cur = startDir;
  for (let i = 0; i < 5; i++) {
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

/**
 * Scan one or more project root directories into a bounded, sorted directory tree and file index.
 * @param {Array<{ name: string, fsPath: string }>} roots
 * @param {"workspace" | "detected" | "folder"} source
 */
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
        if (depth === 0 && topEntries.length < 24) {
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
        if (depth === 0 && topEntries.length < 24) {
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
    manifests: manifests.slice(0, 8),
    topEntries,
    treePreview: treeLines.join("\n")
  };
}

/**
 * Safely resolve a user/model-supplied path inside the allowed project roots.
 * Rejects path traversal outside workspace boundaries.
 */
function resolveSafeProjectPath(requestedPath, roots) {
  const raw = String(requestedPath || "").trim().replace(/^['"`]|['"`]$/g, "");
  if (!raw || raw.includes("\0") || !Array.isArray(roots) || roots.length === 0) return null;

  const normRaw = toPosixPath(raw).replace(/^\.\//, "");
  const candidates = [];

  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else {
    if (roots.length > 1) {
      for (const r of roots) {
        const prefix = `${r.name}/`;
        if (normRaw.startsWith(prefix)) {
          candidates.push(path.resolve(r.fsPath, normRaw.slice(prefix.length)));
        }
      }
    }
    for (const r of roots) {
      candidates.push(path.resolve(r.fsPath, normRaw === "." ? "" : normRaw));
    }
  }

  for (const cand of candidates) {
    for (const r of roots) {
      const rootAbs = path.resolve(r.fsPath);
      const rel = path.relative(rootAbs, cand);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        if (fs.existsSync(cand)) {
          return {
            absPath: cand,
            root: r,
            relPath: roots.length > 1 ? `${r.name}/${toPosixPath(rel)}` : toPosixPath(rel || ".")
          };
        }
      }
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
  if (stat.size > 2 * 1024 * 1024) {
    return { ok: false, error: `File too large (${Math.round(stat.size / 1024)} KB). Use start_line/end_line or inspect smaller files.` };
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
      ? `${out}...[truncated at line ${lastLineIncluded}/${totalLines}; call read_workspace_file with start_line=${lastLineIncluded + 1} for more]`
      : out.trimEnd()
  };
}

const WORKSPACE_TOOLS = Object.freeze([
  {
    type: "function",
    function: {
      name: "list_workspace_files",
      description: "List files and directories inside the developer's opened project folder. Use this to explore the codebase structure.",
      parameters: {
        type: "object",
        properties: {
          dir: {
            type: "string",
            description: "Relative directory path inside the project (default '.' for project root)."
          },
          pattern: {
            type: "string",
            description: "Optional case-insensitive filename or path substring filter."
          },
          max_results: {
            type: "integer",
            description: "Maximum entries to return (default 80, max 200)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "Read the contents of any text file inside the developer's opened project folder with line numbers.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file inside the project (e.g. 'package.json' or 'src/index.js')."
          },
          start_line: {
            type: "integer",
            description: "Optional 1-based start line."
          },
          end_line: {
            type: "integer",
            description: "Optional 1-based inclusive end line."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_workspace_text",
      description: "Search for a text string across source files in the opened project folder and return matching file paths, line numbers, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Case-insensitive text to search for across the project."
          },
          dir: {
            type: "string",
            description: "Optional relative subdirectory to narrow the search."
          },
          max_matches: {
            type: "integer",
            description: "Maximum matching lines to return (default 35, max 80)."
          }
        },
        required: ["query"]
      }
    }
  }
]);

function normalizeServerUrl(rawUrl) {
  let clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (!/^https?:\/\//i.test(clean)) {
    const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(clean);
    clean = `${isLocal ? "http" : "https"}://${clean}`;
  }
  return clean.replace(/\/+$/, "").replace(/\/(v1|api)$/i, "");
}

function buildNonce() {
  return crypto.randomBytes(16).toString("base64url");
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

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJsonSafe(filePath) {
  const raw = readTextSafe(filePath);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function unquoteScalar(rawVal) {
  const trimmed = String(rawVal || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isRouterKeyLike(val) {
  return typeof val === "string" && val.trim().length >= 8 && !val.includes("…") && !val.includes("***");
}

function detectHostIde() {
  const appName = String(vscode.env.appName || "VS Code");
  const uriScheme = String(vscode.env.uriScheme || "vscode").toLowerCase();
  const lower = `${appName} ${uriScheme}`.toLowerCase();
  if (lower.includes("antigravity")) {
    return { ideName: "Antigravity IDE", ideKind: "antigravity", rawAppName: appName };
  }
  if (lower.includes("cursor")) {
    return { ideName: "Cursor", ideKind: "cursor", rawAppName: appName };
  }
  if (lower.includes("windsurf")) {
    return { ideName: "Windsurf", ideKind: "windsurf", rawAppName: appName };
  }
  return { ideName: appName.includes("Code") ? "VS Code" : appName, ideKind: "vscode", rawAppName: appName };
}

/**
 * Inspect local Antigravity, CLI tools (Claude, Codex, Cline, OpenCode, Continue, Aider, Gemini CLI),
 * and VS Code environment to auto-discover existing 001Router URL & API key for zero-friction sync.
 */
function discoverLocalEcosystem(defaultServerUrl) {
  const home = os.homedir();
  const hostIde = detectHostIde();
  const cliTools = [];
  const discoveredCredentials = [];

  const isLocalOrRouterUrl = (urlStr) => {
    const norm = normalizeServerUrl(urlStr).toLowerCase();
    if (!norm) return false;
    const defNorm = normalizeServerUrl(defaultServerUrl).toLowerCase();
    return (
      norm === defNorm ||
      norm.includes("127.0.0.1:20128") ||
      norm.includes("localhost:20128") ||
      norm.includes("001router")
    );
  };

  // 1) Host IDE (Antigravity / VS Code)
  const agDirExists =
    fs.existsSync(path.join(home, ".gemini", "antigravity")) ||
    fs.existsSync(path.join(home, ".antigravity"));
  cliTools.push({
    id: "antigravity",
    label: "Antigravity",
    detected: hostIde.ideKind === "antigravity" || agDirExists,
    synced: hostIde.ideKind === "antigravity" || agDirExists
  });
  cliTools.push({
    id: "vscode",
    label: hostIde.ideName,
    detected: true,
    synced: true
  });

  // 2) Gemini CLI
  const geminiCliDir = path.join(home, ".gemini");
  cliTools.push({
    id: "gemini-cli",
    label: "Gemini CLI",
    detected: fs.existsSync(geminiCliDir),
    synced: fs.existsSync(path.join(geminiCliDir, "oauth_creds.json")) || fs.existsSync(path.join(geminiCliDir, "settings.json"))
  });

  // 3) Claude Code CLI (~/.claude/settings.json)
  const claudeSettingsPath = path.join(home, ".claude", "settings.json");
  const claudeData = readJsonSafe(claudeSettingsPath);
  const claudeBase = claudeData?.env?.ANTHROPIC_BASE_URL || "";
  const claudeKey = claudeData?.env?.ANTHROPIC_AUTH_TOKEN || "";
  const claudeSynced = isLocalOrRouterUrl(claudeBase);
  if (claudeSynced && isRouterKeyLike(claudeKey)) {
    discoveredCredentials.push({ source: "Claude CLI", serverUrl: normalizeServerUrl(claudeBase), routerKey: claudeKey.trim() });
  }
  cliTools.push({
    id: "claude",
    label: "Claude CLI",
    detected: Boolean(claudeData) || fs.existsSync(path.join(home, ".claude")),
    synced: claudeSynced
  });

  // 4) Codex CLI (~/.codex/config.toml & auth.json)
  const codexToml = readTextSafe(path.join(home, ".codex", "config.toml"));
  const codexAuth = readJsonSafe(path.join(home, ".codex", "auth.json"));
  const codexBaseMatch = codexToml ? codexToml.match(/base_url\s*=\s*"([^"\r\n]*)"/i) : null;
  const codexBase = codexBaseMatch ? codexBaseMatch[1] : "";
  const codexKey = codexAuth?.OPENAI_API_KEY || "";
  const codexSynced = Boolean(codexToml && /router_001/i.test(codexToml) && isLocalOrRouterUrl(codexBase));
  if (codexSynced && isRouterKeyLike(codexKey)) {
    discoveredCredentials.push({ source: "Codex CLI", serverUrl: normalizeServerUrl(codexBase), routerKey: codexKey.trim() });
  }
  cliTools.push({
    id: "codex",
    label: "Codex CLI",
    detected: codexToml !== null || fs.existsSync(path.join(home, ".codex")),
    synced: codexSynced
  });

  // 5) Cline (~/.cline/data/globalState.json & secrets.json)
  const clineState = readJsonSafe(path.join(home, ".cline", "data", "globalState.json"));
  const clineSecrets = readJsonSafe(path.join(home, ".cline", "data", "secrets.json"));
  const clineBase = clineState?.openAiBaseUrl || "";
  const clineKey = clineSecrets?.openAiApiKey || "";
  const clineSynced = isLocalOrRouterUrl(clineBase);
  if (clineSynced && isRouterKeyLike(clineKey)) {
    discoveredCredentials.push({ source: "Cline", serverUrl: normalizeServerUrl(clineBase), routerKey: clineKey.trim() });
  }
  cliTools.push({
    id: "cline",
    label: "Cline",
    detected: Boolean(clineState) || fs.existsSync(path.join(home, ".cline")),
    synced: clineSynced
  });

  // 6) OpenCode (~/.config/opencode/opencode.json)
  const openCodeData = readJsonSafe(path.join(home, ".config", "opencode", "opencode.json"));
  const ocBase = openCodeData?.provider?.router001?.options?.baseURL || "";
  const ocKey = openCodeData?.provider?.router001?.options?.apiKey || "";
  const ocSynced = isLocalOrRouterUrl(ocBase);
  if (ocSynced && isRouterKeyLike(ocKey)) {
    discoveredCredentials.push({ source: "OpenCode", serverUrl: normalizeServerUrl(ocBase), routerKey: ocKey.trim() });
  }
  cliTools.push({
    id: "opencode",
    label: "OpenCode",
    detected: Boolean(openCodeData) || fs.existsSync(path.join(home, ".config", "opencode")),
    synced: ocSynced
  });

  // 7) Continue (~/.continue/config.yaml)
  const contYaml = readTextSafe(path.join(home, ".continue", "config.yaml"));
  const contBaseMatch = contYaml ? contYaml.match(/^\s*apiBase:\s*(.+)$/m) : null;
  const contKeyMatch = contYaml ? contYaml.match(/^\s*apiKey:\s*(.+)$/m) : null;
  const contBase = contBaseMatch ? unquoteScalar(contBaseMatch[1]) : "";
  const contKey = contKeyMatch ? unquoteScalar(contKeyMatch[1]) : "";
  const contSynced = Boolean(contYaml && (contYaml.includes("001ROUTER") || isLocalOrRouterUrl(contBase)));
  if (contSynced && isRouterKeyLike(contKey)) {
    discoveredCredentials.push({ source: "Continue", serverUrl: normalizeServerUrl(contBase), routerKey: contKey.trim() });
  }
  cliTools.push({
    id: "continue",
    label: "Continue",
    detected: contYaml !== null || fs.existsSync(path.join(home, ".continue")),
    synced: contSynced
  });

  return {
    hostIde,
    cliTools,
    discoveredCredentials
  };
}

/**
 * Defensive client-side normalization: ensures effort-suffixed models (e.g. gemini-4-carbon-low/medium/high)
 * are unified into one base model with accurate variantMap even if talking to an older server build.
 */
function normalizeCatalogForExtension(rawCatalog) {
  if (!rawCatalog || typeof rawCatalog !== "object") {
    return { providers: [], combos: [], aliases: {} };
  }
  const providers = (Array.isArray(rawCatalog.providers) ? rawCatalog.providers : []).map((prov) => {
    const rawModels = Array.isArray(prov.models) ? prov.models : [];
    const alreadyUnified = rawModels.some((m) => m && m.variantMap && typeof m.variantMap === "object");
    if (alreadyUnified) return prov;

    const groups = new Map();
    const order = [];
    for (const m of rawModels) {
      if (!m || !m.id) continue;
      const { baseId, suffix: tier } = splitEffortSuffix(m.id);
      if (!groups.has(baseId)) {
        groups.set(baseId, { baseId, baseModel: null, variants: new Map(), first: m });
        order.push(baseId);
      }
      const g = groups.get(baseId);
      if (tier) {
        if (!g.variants.has(tier)) g.variants.set(tier, m);
      } else {
        g.baseModel = m;
      }
    }

    const unified = [];
    for (const baseId of order) {
      const g = groups.get(baseId);
      if (g.variants.size < 2) {
        unified.push(g.baseModel || g.first);
        continue;
      }
      const availableTiers = EFFORT_ORDER.filter((t) => g.variants.has(t));
      const variantMap = {};
      for (const t of availableTiers) {
        const vm = g.variants.get(t);
        variantMap[t] = { id: vm.id, fullId: vm.fullId || `${prov.slug}/${vm.id}` };
      }
      const defaultEffort = availableTiers.includes("medium")
        ? "medium"
        : availableTiers.includes("high")
          ? "high"
          : availableTiers[0];
      const baseRef = g.baseModel || g.variants.get(defaultEffort) || g.first;
      const existingStops = baseRef.effort?.effortLevels || [];
      const stops = availableTiers.map((t, idx) => {
        const found = existingStops.find((s) => s.id === t);
        return {
          id: t,
          label: found?.label || (t === "xhigh" ? "XHigh" : t.charAt(0).toUpperCase() + t.slice(1)),
          shortLabel: found?.shortLabel || (t === "medium" ? "Med" : t === "xhigh" ? "XHigh" : t.charAt(0).toUpperCase() + t.slice(1)),
          power: idx + 1,
          maxScale: availableTiers.length,
          percent: Math.round(((idx + 1) / availableTiers.length) * 100),
          color: found?.color || "#3B82F6",
          accent: found?.accent || "#6366F1",
          glow: found?.glow || "rgba(59, 130, 246, 0.5)",
          description: found?.description || "Balanced speed & reasoning depth"
        };
      });
      const maxStop = stops[stops.length - 1];
      const defaultVariant = variantMap[defaultEffort];
      unified.push({
        ...baseRef,
        id: baseId,
        label: baseId,
        fullId: g.baseModel ? g.baseModel.fullId : defaultVariant.fullId,
        defaultVariantId: defaultVariant.id,
        variantMap,
        effort: {
          effortLevels: stops,
          defaultEffort,
          maxEffort: maxStop.id,
          maxLabel: maxStop.label,
          maxPower: stops.length
        }
      });
    }

    return {
      ...prov,
      modelCount: unified.length,
      models: unified
    };
  });

  return {
    ...rawCatalog,
    providers
  };
}

function buildUnifiedSelection(prov, model, desiredEffort) {
  const levels = model.effort?.effortLevels || [];
  const hasDesired = levels.some((l) => l.id === desiredEffort);
  const effort = hasDesired
    ? desiredEffort
    : model.effort?.defaultEffort || levels[0]?.id || "medium";
  const variant = model.variantMap?.[effort] || null;
  const resolvedId = variant ? variant.id || variant.modelId : model.id;
  return {
    kind: "provider",
    providerSlug: prov.slug,
    providerName: prov.name,
    providerPreset: prov.preset,
    providerColor: prov.color,
    baseModelId: model.id,
    displayLabel: model.label || model.id,
    modelId: resolvedId,
    fullId: variant ? variant.fullId : model.fullId,
    effort
  };
}

function buildSystemPrompt(mode, editorContext, includeWorkspace = true, toolsEnabled = false) {
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
    parts.push(
      "Live Workspace Tools available: list_workspace_files, read_workspace_file, search_workspace_text. " +
      "Whenever the user asks about the project, architecture, multiple files, or any file not already pasted in the prompt, proactively call read_workspace_file / list_workspace_files / search_workspace_text to inspect the real codebase before answering. " +
      "Never claim you cannot see project files when the directory structure or tools are available."
    );
  }

  const envBlock = parts.length ? `\n\n[Workspace Environment]\n${parts.join("\n")}\n\n` : " ";

  if (mode === "ask") {
    return (
      `You are Axiom, a senior systems architect AI inside 001Router for VS Code / Antigravity IDE (Ask mode).${envBlock}` +
      "Give accurate, structured architectural and debugging answers grounded strictly in the real project files, folder structure, and attached context. " +
      "Cite exact relative file paths and line numbers; never invent files or APIs."
    );
  }
  if (mode === "plan") {
    return (
      `You are Axiom, a senior systems architect AI inside 001Router for VS Code / Antigravity IDE (Plan mode).${envBlock}` +
      "Produce clear step-by-step engineering plans, architectural trade-offs, exact files to inspect or change, " +
      "and concrete verification commands before implementation."
    );
  }
  return (
    `You are Axiom, a senior systems architect AI inside 001Router for VS Code / Antigravity IDE (Auto mode).${envBlock}` +
    "Deliver production-ready code solutions, clean diffs/complete functions, runnable shell commands in fenced blocks when needed, and concise technical explanations grounded in the entire opened project folder. " +
    "Preserve existing conventions and cite exact relative file paths."
  );
}

class Router001Controller {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
    this.sidebarView = null;
    this.editorPanel = null;
    this.activeAbort = null;
    this.activeProcesses = new Map();
    this.catalog = { providers: [], combos: [], aliases: {} };
    this.connected = false;
    this.lastError = "";
    this.autoSyncedFrom = null;
    this.envSync = {
      ideName: detectHostIde().ideName,
      ideKind: detectHostIde().ideKind,
      autoSyncedFrom: null,
      cliTools: []
    };
    this.lastActiveUri = null;
    this._workspaceScanCache = null;
    this.editorContext = {
      hasWorkspaceFolder: false,
      hasProjectFolder: false,
      workspaceName: "",
      workingDir: os.homedir(),
      activeFile: null,
      openTabs: [],
      workspaceSummary: null
    };
    this._editorTimer = null;
    this._syncInFlight = null;
  }

  invalidateWorkspaceCache() {
    this._workspaceScanCache = null;
  }

  getDefaultServerUrl() {
    const cfg = vscode.workspace.getConfiguration("001router");
    return normalizeServerUrl(cfg.get("defaultServerUrl") || "http://127.0.0.1:20128");
  }

  async getStoredCredentials() {
    const [rawUrl, routerKey] = await Promise.all([
      this.context.secrets.get(SECRET_SERVER_URL),
      this.context.secrets.get(SECRET_ROUTER_KEY)
    ]);
    return {
      serverUrl: normalizeServerUrl(rawUrl) || this.getDefaultServerUrl(),
      routerKey: typeof routerKey === "string" ? routerKey.trim() : ""
    };
  }

  getSessions() {
    const list = this.context.globalState.get(STATE_SESSIONS);
    return Array.isArray(list) ? list : [];
  }

  async saveSessions(sessions) {
    const trimmed = Array.isArray(sessions)
      ? sessions.slice(0, MAX_SESSIONS).map((s) => ({
          ...s,
          messages: Array.isArray(s.messages)
            ? s.messages.slice(-MAX_MESSAGES_PER_SESSION)
            : []
        }))
      : [];
    await this.context.globalState.update(STATE_SESSIONS, trimmed);
    return trimmed;
  }

  async ensureActiveSession() {
    let sessions = this.getSessions();
    let activeId = this.context.globalState.get(STATE_ACTIVE_SESSION);
    let active = sessions.find((s) => s.id === activeId);
    if (!active) {
      if (sessions.length > 0) {
        active = sessions[0];
      } else {
        active = {
          id: crypto.randomUUID(),
          title: "Untitled",
          bookmarked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: []
        };
        sessions = [active];
        await this.saveSessions(sessions);
      }
      await this.context.globalState.update(STATE_ACTIVE_SESSION, active.id);
    }
    return { sessions, activeId: active.id };
  }

  postToAll(message) {
    if (this.sidebarView?.webview) {
      this.sidebarView.webview.postMessage(message);
    }
    if (this.editorPanel?.webview) {
      this.editorPanel.webview.postMessage(message);
    }
  }

  /**
   * Resolve the best active editor or open tab URI even when focus is inside the webview
   * and even when NO workspace folder is opened!
   */
  resolveActiveDocument() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document && activeEditor.document.uri.scheme !== "output") {
      this.lastActiveUri = activeEditor.document.uri;
      return { doc: activeEditor.document, editor: activeEditor };
    }

    for (const vis of vscode.window.visibleTextEditors || []) {
      if (vis?.document && vis.document.uri.scheme !== "output") {
        this.lastActiveUri = vis.document.uri;
        return { doc: vis.document, editor: vis };
      }
    }

    const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
    const tabUri = activeTab?.input && "uri" in activeTab.input ? activeTab.input.uri : null;
    const fallbackUri = tabUri || this.lastActiveUri;
    if (fallbackUri) {
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === fallbackUri.toString()
      );
      if (openDoc) {
        return { doc: openDoc, editor: null };
      }
    }

    const anyDoc = vscode.workspace.textDocuments.find(
      (d) => (d.uri.scheme === "file" || d.uri.scheme === "untitled") && !d.isClosed
    );
    if (anyDoc) {
      return { doc: anyDoc, editor: null };
    }
    return { doc: null, editor: null };
  }

  collectEditorContext(forceRescan = false) {
    const folders = vscode.workspace.workspaceFolders || [];
    const hasWorkspaceFolder = folders.length > 0;
    const { doc, editor } = this.resolveActiveDocument();

    let activeFile = null;
    let workingDir = hasWorkspaceFolder ? folders[0].uri.fsPath : os.homedir();
    let workspaceName = hasWorkspaceFolder ? folders[0].name : "";

    if (doc) {
      const fsPath = doc.uri.scheme === "file" ? doc.uri.fsPath : doc.fileName;
      const fileName = path.basename(fsPath || "Untitled");
      const rel = hasWorkspaceFolder ? vscode.workspace.asRelativePath(doc.uri, false) : fsPath;
      const displayPath = rel && rel !== fsPath ? rel : fileName;

      if (!hasWorkspaceFolder && doc.uri.scheme === "file" && fsPath) {
        workingDir = path.dirname(fsPath);
        workspaceName = path.basename(workingDir) || workingDir;
      } else if (hasWorkspaceFolder) {
        const owningFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (owningFolder) {
          workingDir = owningFolder.uri.fsPath;
          workspaceName = owningFolder.name;
        }
      }

      let selectionLabel = "";
      let selectedLines = 0;
      if (editor && editor.selection && !editor.selection.isEmpty) {
        selectionLabel = `L${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`;
        selectedLines = editor.selection.end.line - editor.selection.start.line + 1;
      }

      const diags = vscode.languages.getDiagnostics(doc.uri) || [];
      let diagnosticErrors = 0;
      let diagnosticWarnings = 0;
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) diagnosticErrors++;
        else if (d.severity === vscode.DiagnosticSeverity.Warning) diagnosticWarnings++;
      }

      activeFile = {
        uri: doc.uri.toString(),
        fsPath,
        fileName,
        displayPath,
        languageId: doc.languageId || path.extname(fileName).slice(1),
        lineCount: doc.lineCount,
        selectionLabel,
        selectedLines,
        diagnosticErrors,
        diagnosticWarnings,
        isDirty: doc.isDirty,
        isUntitled: doc.isUntitled
      };
    }

    // Collect all open file tabs across all tab groups
    const openTabs = [];
    const seenUris = new Set();
    for (const group of vscode.window.tabGroups?.all || []) {
      for (const tab of group.tabs || []) {
        const uri = tab.input && "uri" in tab.input ? tab.input.uri : null;
        if (!uri || (uri.scheme !== "file" && uri.scheme !== "untitled")) continue;
        const key = uri.toString();
        if (seenUris.has(key)) continue;
        seenUris.add(key);
        const fsPath = uri.scheme === "file" ? uri.fsPath : tab.label;
        const fileName = path.basename(fsPath || tab.label || "Untitled");
        const rel = hasWorkspaceFolder ? vscode.workspace.asRelativePath(uri, false) : fileName;
        openTabs.push({
          uri: key,
          fsPath,
          fileName,
          displayPath: rel || fileName,
          isActive: Boolean(activeFile && activeFile.uri === key)
        });
      }
    }

    // Resolve full project folder roots: prefer opened Workspace Folders;
    // otherwise walk up from the active file or first open tab to detect project root markers (.git, package.json, etc.).
    let scanRoots = [];
    let rootSource = "none";
    if (hasWorkspaceFolder) {
      scanRoots = folders.map((f) => ({ name: f.name || path.basename(f.uri.fsPath), fsPath: f.uri.fsPath }));
      rootSource = "workspace";
    } else {
      const seedFile = activeFile?.fsPath || openTabs.find((t) => t.fsPath && path.isAbsolute(t.fsPath))?.fsPath || "";
      if (seedFile && path.isAbsolute(seedFile)) {
        const startDir = path.dirname(seedFile);
        const found = findProjectRootFromPath(startDir);
        scanRoots = [{ name: path.basename(found.rootPath) || found.rootPath, fsPath: found.rootPath }];
        rootSource = found.detected ? "detected" : "folder";
        workingDir = found.rootPath;
        workspaceName = scanRoots[0].name;
      }
    }

    let workspaceSummary = null;
    if (scanRoots.length > 0) {
      const cacheKey = `${rootSource}|${scanRoots.map((r) => r.fsPath).join("|")}`;
      const now = Date.now();
      if (
        !forceRescan &&
        this._workspaceScanCache &&
        this._workspaceScanCache.key === cacheKey &&
        now - this._workspaceScanCache.at < 4000
      ) {
        workspaceSummary = this._workspaceScanCache.summary;
      } else {
        workspaceSummary = scanWorkspaceRoots(scanRoots, rootSource);
        this._workspaceScanCache = { key: cacheKey, at: now, summary: workspaceSummary };
      }
    }

    // Refine display paths relative to detected project root when no formal VS Code workspace was opened
    if (!hasWorkspaceFolder && workspaceSummary?.projectRoot) {
      if (activeFile?.fsPath && path.isAbsolute(activeFile.fsPath)) {
        const rel = toPosixPath(path.relative(workspaceSummary.projectRoot, activeFile.fsPath));
        if (rel && !rel.startsWith("..")) activeFile.displayPath = rel;
      }
      for (const tab of openTabs) {
        if (tab.fsPath && path.isAbsolute(tab.fsPath)) {
          const rel = toPosixPath(path.relative(workspaceSummary.projectRoot, tab.fsPath));
          if (rel && !rel.startsWith("..")) tab.displayPath = rel;
        }
      }
    }

    this.editorContext = {
      hasWorkspaceFolder,
      hasProjectFolder: Boolean(workspaceSummary && workspaceSummary.fileCount > 0),
      workspaceName: workspaceSummary?.projectName || workspaceName,
      workingDir,
      activeFile,
      openTabs: openTabs.slice(0, 24),
      workspaceSummary
    };
    return this.editorContext;
  }

  scheduleEditorContextPush(delayMs = 120) {
    if (this._editorTimer) clearTimeout(this._editorTimer);
    this._editorTimer = setTimeout(() => {
      this._editorTimer = null;
      const ctx = this.collectEditorContext();
      this.postToAll({ type: "editorContext", editorContext: ctx });
    }, delayMs);
  }

  async tryFetchCatalog(serverUrl, routerKey) {
    const headers = { Accept: "application/json" };
    if (routerKey) {
      headers.Authorization = `Bearer ${routerKey}`;
    }
    const resp = await fetch(`${serverUrl}/v1/extension/catalog`, {
      method: "GET",
      headers
    });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, authFailed: true, status: resp.status };
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.catalog) {
      return {
        ok: false,
        authFailed: false,
        error: data?.error?.message || data?.error || `HTTP ${resp.status}`
      };
    }
    return {
      ok: true,
      catalog: normalizeCatalogForExtension(data.catalog)
    };
  }

  /**
   * Automatically sync with Antigravity, local CLI tools (Claude, Codex, Cline, OpenCode, Continue, Gemini CLI),
   * and VS Code on startup or manual refresh.
   */
  async autoSyncEnvironment(silent = true) {
    if (this._syncInFlight) return this._syncInFlight;
    this._syncInFlight = (async () => {
      const defaultUrl = this.getDefaultServerUrl();
      const eco = discoverLocalEcosystem(defaultUrl);
      this.envSync = {
        ideName: eco.hostIde.ideName,
        ideKind: eco.hostIde.ideKind,
        autoSyncedFrom: this.autoSyncedFrom,
        cliTools: eco.cliTools
      };
      this.collectEditorContext();

      // 1) Try stored credentials first
      const stored = await this.getStoredCredentials();
      if (stored.serverUrl && stored.routerKey) {
        try {
          const res = await this.tryFetchCatalog(stored.serverUrl, stored.routerKey);
          if (res.ok) {
            this.catalog = res.catalog;
            this.connected = true;
            this.lastError = "";
            this.autoSyncedFrom = this.autoSyncedFrom || "saved";
            this.envSync.autoSyncedFrom = this.autoSyncedFrom;
            await this.ensureValidSelection();
            return true;
          }
          if (res.authFailed) {
            await this.context.secrets.delete(SECRET_ROUTER_KEY);
          }
        } catch (err) {
          if (!silent) {
            this.lastError = `Không thể kết nối tới ${stored.serverUrl}: ${formatErrorMessage(err)}`;
          }
        }
      }

      // 2) Auto-discover valid 001Router credentials from synced CLI tools (Claude, Codex, Cline, OpenCode, Continue)
      for (const cand of eco.discoveredCredentials) {
        if (!cand.serverUrl || !cand.routerKey) continue;
        try {
          const res = await this.tryFetchCatalog(cand.serverUrl, cand.routerKey);
          if (res.ok) {
            await Promise.all([
              this.context.secrets.store(SECRET_SERVER_URL, cand.serverUrl),
              this.context.secrets.store(SECRET_ROUTER_KEY, cand.routerKey)
            ]);
            this.catalog = res.catalog;
            this.connected = true;
            this.lastError = "";
            this.autoSyncedFrom = cand.source;
            this.envSync.autoSyncedFrom = cand.source;
            await this.ensureValidSelection();
            return true;
          }
        } catch {
          // try next discovered CLI source
        }
      }

      // 3) Try local server anonymous mode or one-time loopback default-password bootstrap
      if (defaultUrl) {
        try {
          const res = await this.tryFetchCatalog(defaultUrl, "");
          if (res.ok) {
            await this.context.secrets.store(SECRET_SERVER_URL, defaultUrl);
            this.catalog = res.catalog;
            this.connected = true;
            this.lastError = "";
            this.autoSyncedFrom = "Local 001Router";
            this.envSync.autoSyncedFrom = this.autoSyncedFrom;
            await this.ensureValidSelection();
            return true;
          }
          const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(defaultUrl);
          if (isLoopback && !this._triedDefaultHandshake) {
            this._triedDefaultHandshake = true;
            const bootResp = await fetch(`${defaultUrl}/api/extension/connect`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "001router"
              },
              body: JSON.stringify({
                password: "1234",
                clientName: `001Router (${this.envSync.ideName})`
              })
            });
            const bootData = await bootResp.json().catch(() => null);
            if (bootResp.ok && bootData?.ok && bootData?.routerKey) {
              await Promise.all([
                this.context.secrets.store(SECRET_SERVER_URL, defaultUrl),
                this.context.secrets.store(SECRET_ROUTER_KEY, bootData.routerKey)
              ]);
              this.catalog = normalizeCatalogForExtension(bootData.catalog || { providers: [], combos: [], aliases: {} });
              this.connected = true;
              this.lastError = "";
              this.autoSyncedFrom = "Local Auto-Bootstrap";
              this.envSync.autoSyncedFrom = this.autoSyncedFrom;
              await this.ensureValidSelection();
              return true;
            }
          }
        } catch {
          // local server not reachable or requires custom password
        }
      }

      this.connected = false;
      return false;
    })();

    try {
      return await this._syncInFlight;
    } finally {
      this._syncInFlight = null;
    }
  }

  async syncStateToWebviews() {
    const [creds, sessionData] = await Promise.all([
      this.getStoredCredentials(),
      this.ensureActiveSession()
    ]);
    const selection = this.context.globalState.get(STATE_SELECTION) || null;
    const mode = this.context.globalState.get(STATE_MODE) || "auto";
    const autoActiveFile = this.context.globalState.get(STATE_AUTO_ACTIVE_FILE);
    const autoWorkspace = this.context.globalState.get(STATE_AUTO_WORKSPACE);
    const editorContext = this.collectEditorContext();

    this.postToAll({
      type: "state",
      connected: this.connected,
      serverUrl: creds.serverUrl,
      catalog: this.catalog,
      selection,
      mode,
      autoActiveFile: autoActiveFile !== false,
      autoWorkspace: autoWorkspace !== false,
      envSync: this.envSync,
      editorContext,
      sessions: sessionData.sessions,
      activeSessionId: sessionData.activeId,
      lastError: this.lastError
    });
  }

  async refreshCatalogFromServer(silent = false) {
    return this.autoSyncEnvironment(silent);
  }

  async ensureValidSelection() {
    const providers = Array.isArray(this.catalog?.providers) ? this.catalog.providers : [];
    const combos = Array.isArray(this.catalog?.combos) ? this.catalog.combos : [];
    const current = this.context.globalState.get(STATE_SELECTION);

    if (current?.kind === "combo") {
      const combo = combos.find((c) => c.name === current.modelId);
      if (combo) {
        const levels = combo.effort?.effortLevels || [];
        const hasEffort = levels.some((l) => l.id === current.effort);
        if (!hasEffort) {
          await this.context.globalState.update(STATE_SELECTION, {
            ...current,
            effort: combo.effort?.defaultEffort || levels[0]?.id || "medium"
          });
        }
        return;
      }
    }

    if (current?.providerSlug) {
      const prov = providers.find((p) => p.slug === current.providerSlug);
      if (prov) {
        const baseMatch = current.baseModelId
          ? prov.models.find((m) => m.id === current.baseModelId)
          : null;
        const directMatch = prov.models.find((m) => m.id === current.modelId);
        const variantMatch = prov.models.find(
          (m) =>
            m.variantMap &&
            Object.values(m.variantMap).some((v) => (v.id || v.modelId) === current.modelId)
        );
        const { baseId: stemmedId } = splitEffortSuffix(String(current.modelId || ""));
        const stemModel = stemmedId && stemmedId !== current.modelId ? prov.models.find((m) => m.id === stemmedId) : null;
        const model = baseMatch || directMatch || variantMatch || stemModel || prov.models[0];
        if (model) {
          const unified = buildUnifiedSelection(prov, model, current.effort);
          await this.context.globalState.update(STATE_SELECTION, unified);
          return;
        }
      }
    }

    // Prefer Antigravity provider automatically if running inside Antigravity IDE
    let preferredProv = providers[0] || null;
    if (this.envSync.ideKind === "antigravity") {
      const agProv = providers.find((p) => p.preset === "antigravity" || p.slug === "antigravity");
      if (agProv) preferredProv = agProv;
    }

    if (preferredProv && preferredProv.models[0]) {
      const unified = buildUnifiedSelection(preferredProv, preferredProv.models[0], null);
      await this.context.globalState.update(STATE_SELECTION, unified);
    } else if (combos.length > 0) {
      const combo = combos[0];
      await this.context.globalState.update(STATE_SELECTION, {
        kind: "combo",
        providerSlug: "combo",
        providerName: "Combo",
        providerPreset: "combo",
        providerColor: "#E56A4A",
        baseModelId: combo.name,
        displayLabel: combo.name,
        modelId: combo.name,
        fullId: combo.name,
        effort: combo.effort?.defaultEffort || "medium"
      });
    }
  }

  async connectWithPassword(rawServerUrl, password) {
    const serverUrl = normalizeServerUrl(rawServerUrl) || this.getDefaultServerUrl();
    if (!serverUrl) {
      this.postToAll({ type: "connectResult", ok: false, error: "Vui lòng nhập URL web 001Router." });
      return;
    }
    if (!password) {
      this.postToAll({ type: "connectResult", ok: false, error: "Vui lòng nhập mật khẩu web 001Router." });
      return;
    }

    try {
      const resp = await fetch(`${serverUrl}/api/extension/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "001router"
        },
        body: JSON.stringify({
          password,
          clientName: `001Router (${this.envSync.ideName})`
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok || !data?.routerKey) {
        const errMsg = data?.error || `Kết nối thất bại (HTTP ${resp.status})`;
        this.lastError = errMsg;
        this.postToAll({ type: "connectResult", ok: false, error: errMsg });
        return;
      }

      await Promise.all([
        this.context.secrets.store(SECRET_SERVER_URL, serverUrl),
        this.context.secrets.store(SECRET_ROUTER_KEY, data.routerKey)
      ]);

      this.catalog = normalizeCatalogForExtension(data.catalog || { providers: [], combos: [], aliases: {} });
      this.connected = true;
      this.lastError = "";
      this.autoSyncedFrom = "Web Password";
      this.envSync.autoSyncedFrom = this.autoSyncedFrom;
      await this.ensureValidSelection();
      this.postToAll({ type: "connectResult", ok: true });
      await this.syncStateToWebviews();
    } catch (err) {
      const errMsg = `Không thể kết nối tới ${serverUrl}: ${formatErrorMessage(err)}`;
      this.lastError = errMsg;
      this.postToAll({ type: "connectResult", ok: false, error: errMsg });
    }
  }

  async disconnect() {
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
    await this.context.secrets.delete(SECRET_ROUTER_KEY);
    this.connected = false;
    this.autoSyncedFrom = null;
    this.envSync.autoSyncedFrom = null;
    this.lastError = "";
    await this.syncStateToWebviews();
  }

  async readActiveFileAttachment(preferSelection = true) {
    const { doc, editor } = this.resolveActiveDocument();
    if (!doc) return null;
    const hasWorkspace = (vscode.workspace.workspaceFolders || []).length > 0;
    const fsPath = doc.uri.scheme === "file" ? doc.uri.fsPath : doc.fileName;
    const relPath = hasWorkspace ? vscode.workspace.asRelativePath(doc.uri, false) : fsPath;
    const displayLabel = path.basename(fsPath || relPath || "Untitled");
    const sel = editor?.selection;

    let content = "";
    let rangeLabel = "";
    if (preferSelection && sel && !sel.isEmpty) {
      content = doc.getText(sel);
      rangeLabel = `L${sel.start.line + 1}-${sel.end.line + 1}`;
    } else {
      content = doc.getText();
    }
    if (content.length > MAX_ATTACHMENT_CHARS) {
      content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
    }

    const diags = vscode.languages.getDiagnostics(doc.uri) || [];
    const diagSummary = diags
      .slice(0, 12)
      .map((d) => {
        const sev = d.severity === vscode.DiagnosticSeverity.Error ? "ERROR" : "WARN";
        return `- [${sev}] Line ${d.range.start.line + 1}: ${d.message}`;
      })
      .join("\n");

    return {
      id: `auto:${doc.uri.toString()}:${rangeLabel || "full"}`,
      label: rangeLabel ? `${displayLabel} (${rangeLabel})` : displayLabel,
      path: relPath || fsPath,
      languageId: doc.languageId || "",
      content,
      diagnostics: diagSummary,
      isAuto: true
    };
  }

  async handlePickContext(kind, targetWebview, extraUri) {
    if (kind === "projectFile" && extraUri) {
      const ctx = this.collectEditorContext();
      const roots = ctx.workspaceSummary?.roots || [];
      const resolved = resolveSafeProjectPath(extraUri, roots);
      if (!resolved) {
        vscode.window.showWarningMessage(`Không tìm thấy tệp trong dự án: ${extraUri}`);
        return;
      }
      const readRes = readNumberedTextFile(resolved.absPath, 1, 0, MAX_ATTACHMENT_CHARS);
      if (!readRes.ok) {
        vscode.window.showWarningMessage(readRes.error || "Không thể đọc tệp.");
        return;
      }
      targetWebview.postMessage({
        type: "attachedContext",
        item: {
          id: `${resolved.relPath}:${Date.now()}`,
          label: path.basename(resolved.relPath),
          path: resolved.relPath,
          languageId: path.extname(resolved.relPath).slice(1),
          content: readRes.content
        }
      });
      return;
    }

    if (kind === "activeFile" || kind === "selection") {
      const item = await this.readActiveFileAttachment(kind === "selection");
      if (!item) {
        vscode.window.showInformationMessage("Chưa có tệp nào đang mở trong editor.");
        return;
      }
      item.id = `${item.path}:${Date.now()}`;
      item.isAuto = false;
      targetWebview.postMessage({ type: "attachedContext", item });
      return;
    }

    if (kind === "openTab" && extraUri) {
      try {
        const uri = vscode.Uri.parse(extraUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        const fsPath = doc.uri.scheme === "file" ? doc.uri.fsPath : doc.fileName;
        let content = doc.getText();
        if (content.length > MAX_ATTACHMENT_CHARS) {
          content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
        }
        targetWebview.postMessage({
          type: "attachedContext",
          item: {
            id: `${fsPath}:${Date.now()}`,
            label: path.basename(fsPath || "Untitled"),
            path: fsPath,
            languageId: doc.languageId || "",
            content
          }
        });
      } catch (err) {
        vscode.window.showWarningMessage(`Không thể đọc tab: ${formatErrorMessage(err)}`);
      }
      return;
    }

    if (kind === "workspaceFile") {
      const hasWorkspace = (vscode.workspace.workspaceFolders || []).length > 0;
      if (!hasWorkspace) {
        // Fallback when no folder is open: list sibling files in active file's directory or open file dialog!
        const ctx = this.collectEditorContext();
        const dir = ctx.workingDir;
        let items = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          items = entries
            .filter((e) => e.isFile())
            .slice(0, 120)
            .map((e) => ({
              label: e.name,
              description: dir,
              uri: vscode.Uri.file(path.join(dir, e.name))
            }));
        } catch {
          items = [];
        }

        if (items.length > 0) {
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: `Chọn tệp cùng thư mục (${dir})`
          });
          if (!picked) return;
          const bytes = await vscode.workspace.fs.readFile(picked.uri);
          let content = Buffer.from(bytes).toString("utf8");
          if (content.length > MAX_ATTACHMENT_CHARS) {
            content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
          }
          targetWebview.postMessage({
            type: "attachedContext",
            item: {
              id: `${picked.uri.fsPath}:${Date.now()}`,
              label: picked.label,
              path: picked.uri.fsPath,
              languageId: path.extname(picked.label).slice(1),
              content
            }
          });
          return;
        }

        const pickedUris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Đính kèm vào 001Router"
        });
        if (!pickedUris?.length) return;
        const uri = pickedUris[0];
        const bytes = await vscode.workspace.fs.readFile(uri);
        let content = Buffer.from(bytes).toString("utf8");
        if (content.length > MAX_ATTACHMENT_CHARS) {
          content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
        }
        targetWebview.postMessage({
          type: "attachedContext",
          item: {
            id: `${uri.fsPath}:${Date.now()}`,
            label: path.basename(uri.fsPath),
            path: uri.fsPath,
            languageId: path.extname(uri.fsPath).slice(1),
            content
          }
        });
        return;
      }

      const uris = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,dist,build,.next}/**", 250);
      if (!uris.length) {
        vscode.window.showInformationMessage("Không tìm thấy tệp nào trong workspace.");
        return;
      }
      const items = uris
        .map((uri) => ({
          label: vscode.workspace.asRelativePath(uri, false),
          uri
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Chọn tệp để đính kèm vào ngữ cảnh 001Router"
      });
      if (!picked) return;

      const bytes = await vscode.workspace.fs.readFile(picked.uri);
      let content = Buffer.from(bytes).toString("utf8");
      if (content.length > MAX_ATTACHMENT_CHARS) {
        content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
      }
      targetWebview.postMessage({
        type: "attachedContext",
        item: {
          id: `${picked.label}:${Date.now()}`,
          label: picked.label,
          path: picked.label,
          languageId: path.extname(picked.label).slice(1),
          content
        }
      });
    }
  }

  async applyCodeToEditor(code) {
    if (typeof code !== "string" || !code) return;
    const { editor } = this.resolveActiveDocument();
    if (!editor) {
      const doc = await vscode.workspace.openTextDocument({ content: code });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      return;
    }
    await editor.edit((editBuilder) => {
      if (editor.selection && !editor.selection.isEmpty) {
        editBuilder.replace(editor.selection, code);
      } else {
        editBuilder.insert(editor.selection.active, code);
      }
    });
    vscode.window.showInformationMessage("Đã chèn đoạn mã từ 001Router vào editor.");
  }

  /**
   * Execute a shell command with live streaming output to the chat UI (Cline / Claude Code style).
   * Works even when no workspace folder is open (auto-uses active open file's directory).
   */
  runTerminalCommand(rawCommand, sessionId) {
    const command = String(rawCommand || "").trim();
    if (!command) return;

    const ctx = this.collectEditorContext();
    const cwd = ctx.workingDir && fs.existsSync(ctx.workingDir) ? ctx.workingDir : os.homedir();
    const runId = `term-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const startedAt = Date.now();

    this.postToAll({
      type: "terminalStart",
      runId,
      sessionId,
      command,
      cwd,
      startedAt
    });

    let acc = "";
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
    });
    this.activeProcesses.set(runId, child);

    const pushChunk = (buf, streamName) => {
      const clean = stripAnsi(buf.toString("utf8"));
      if (!clean) return;
      if (acc.length < MAX_TERMINAL_OUTPUT_CHARS) {
        acc += clean;
      }
      this.postToAll({
        type: "terminalOutput",
        runId,
        stream: streamName,
        chunk: clean
      });
    };

    child.stdout?.on("data", (d) => pushChunk(d, "stdout"));
    child.stderr?.on("data", (d) => pushChunk(d, "stderr"));

    child.on("error", (err) => {
      this.activeProcesses.delete(runId);
      this.postToAll({
        type: "terminalEnd",
        runId,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        error: formatErrorMessage(err)
      });
    });

    child.on("close", (code, signal) => {
      this.activeProcesses.delete(runId);
      this.postToAll({
        type: "terminalEnd",
        runId,
        exitCode: typeof code === "number" ? code : signal ? 130 : 0,
        killed: Boolean(signal),
        durationMs: Date.now() - startedAt,
        output: acc.slice(-MAX_TERMINAL_OUTPUT_CHARS)
      });
    });
  }

  killTerminalCommand(runId) {
    const child = this.activeProcesses.get(runId);
    if (!child) return;
    try {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // ignore
    }
  }

  openInVsCodeTerminal(command) {
    const ctx = this.collectEditorContext();
    const cwd = ctx.workingDir && fs.existsSync(ctx.workingDir) ? ctx.workingDir : os.homedir();
    const term = vscode.window.createTerminal({ name: "001Router", cwd });
    term.show(true);
    if (command) term.sendText(String(command), true);
  }

  /**
   * Smart project file hydration: automatically loads relevant project files
   * (manifests, open tabs, mentioned filenames, and top entry files on whole-project questions)
   * so both tool-capable AND tool-less models accurately understand the entire opened folder.
   */
  hydrateProjectContextFiles(promptText, editorContext, existingAttachments) {
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
      /(toàn bộ|tất cả|cả dự án|cả folder|thư mục|cấu trúc|kiến trúc|tổng quan|nói về gì|làm gì|giới thiệu|tóm tắt|đọc.*file|quét|kiểm tra.*dự án|entire|all files|whole project|codebase|overview|project|repo|folder|architecture|explain.*repo|review.*project|check.*all)/i.test(
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

    // 1) Files explicitly mentioned by basename or path in the prompt
    for (const rel of ws.files) {
      const base = path.basename(rel).toLowerCase();
      if (
        (base.length >= 4 && lowerPrompt.includes(base)) ||
        (rel.length >= 5 && lowerPrompt.includes(rel.toLowerCase()))
      ) {
        addCandidate(rel, 100, 12000);
      }
    }

    // 2) Key manifest / README files (always high value for folder awareness)
    for (const mRel of ws.manifests || []) {
      addCandidate(mRel, 85, 6000);
    }

    // 3) Currently open IDE tabs inside the project
    for (const tab of editorContext.openTabs || []) {
      if (tab.displayPath && ws.files.includes(tab.displayPath)) {
        addCandidate(tab.displayPath, 75, 8000);
      }
    }

    // 4) On whole-project / folder-wide questions, include top entry source files sorted by depth & importance
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
      const resolved = resolveSafeProjectPath(cand.relPath, ws.roots);
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

  /**
   * Execute a read-only workspace inspection tool requested by the LLM.
   */
  executeWorkspaceTool(toolName, rawArgs, workspaceSummary) {
    let args = {};
    if (typeof rawArgs === "string" && rawArgs.trim()) {
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }
    } else if (rawArgs && typeof rawArgs === "object") {
      args = rawArgs;
    }

    const roots = workspaceSummary?.roots || [];
    if (roots.length === 0) {
      return {
        label: `${toolName}()`,
        result: JSON.stringify({ ok: false, error: "No project folder is currently open." })
      };
    }

    if (toolName === "list_workspace_files") {
      const dirArg = String(args.dir || ".").trim() || ".";
      const pattern = String(args.pattern || "").trim().toLowerCase();
      const maxResults = Math.max(1, Math.min(200, Number(args.max_results) || 80));
      const label = pattern ? `list_workspace_files(${dirArg}, "${pattern}")` : `list_workspace_files(${dirArg})`;

      if (dirArg === "." || dirArg === "./" || dirArg === "/") {
        let list = workspaceSummary.files || [];
        if (pattern) {
          list = list.filter((f) => f.toLowerCase().includes(pattern));
        }
        return {
          label,
          result: JSON.stringify({
            ok: true,
            project: workspaceSummary.projectName,
            totalFiles: list.length,
            files: list.slice(0, maxResults)
          })
        };
      }

      const resolved = resolveSafeProjectPath(dirArg, roots);
      if (!resolved) {
        return { label, result: JSON.stringify({ ok: false, error: `Directory not found inside workspace: ${dirArg}` }) };
      }
      const subScan = scanWorkspaceRoots([{ name: path.basename(resolved.absPath), fsPath: resolved.absPath }], "folder");
      let list = (subScan?.files || []).map((f) => toPosixPath(path.posix.join(resolved.relPath, f)));
      if (pattern) list = list.filter((f) => f.toLowerCase().includes(pattern));
      return {
        label,
        result: JSON.stringify({
          ok: true,
          dir: resolved.relPath,
          totalFiles: list.length,
          files: list.slice(0, maxResults)
        })
      };
    }

    if (toolName === "read_workspace_file") {
      const targetPath = String(args.path || "").trim();
      const startLine = Number(args.start_line) || 1;
      const endLine = Number(args.end_line) || 0;
      const label = startLine > 1 || endLine > 0
        ? `read_workspace_file(${targetPath} L${startLine}-${endLine || "end"})`
        : `read_workspace_file(${targetPath})`;

      const resolved = resolveSafeProjectPath(targetPath, roots);
      if (!resolved) {
        // Fallback: match by basename if unambiguous
        const matches = (workspaceSummary.files || []).filter(
          (f) => f.toLowerCase().endsWith(`/${targetPath.toLowerCase()}`) || f.toLowerCase() === targetPath.toLowerCase()
        );
        if (matches.length === 1) {
          const fallbackResolved = resolveSafeProjectPath(matches[0], roots);
          if (fallbackResolved) {
            const readRes = readNumberedTextFile(fallbackResolved.absPath, startLine, endLine, MAX_SINGLE_READ_CHARS);
            return {
              label: `read_workspace_file(${fallbackResolved.relPath})`,
              result: JSON.stringify({ path: fallbackResolved.relPath, ...readRes })
            };
          }
        }
        return {
          label,
          result: JSON.stringify({
            ok: false,
            error: `File not found in workspace: ${targetPath}`,
            suggestions: matches.slice(0, 8)
          })
        };
      }

      const readRes = readNumberedTextFile(resolved.absPath, startLine, endLine, MAX_SINGLE_READ_CHARS);
      return {
        label,
        result: JSON.stringify({ path: resolved.relPath, ...readRes })
      };
    }

    if (toolName === "search_workspace_text") {
      const query = String(args.query || "").trim();
      const dirArg = String(args.dir || "").trim();
      const maxMatches = Math.max(1, Math.min(80, Number(args.max_matches) || 35));
      const label = `search_workspace_text("${query}")`;
      if (!query) {
        return { label, result: JSON.stringify({ ok: false, error: "Empty search query." }) };
      }

      const qLower = query.toLowerCase();
      const dirPrefix = dirArg && dirArg !== "." ? `${toPosixPath(dirArg).replace(/\/+$/, "")}/` : "";
      const matches = [];
      let filesSearched = 0;

      for (const rel of workspaceSummary.files || []) {
        if (matches.length >= maxMatches) break;
        if (dirPrefix && !toPosixPath(rel).startsWith(dirPrefix)) continue;
        if (isBinaryFileName(rel)) continue;
        const resolved = resolveSafeProjectPath(rel, roots);
        if (!resolved) continue;
        let stat;
        try {
          stat = fs.statSync(resolved.absPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > 512 * 1024) continue;
        filesSearched++;
        let text;
        try {
          text = fs.readFileSync(resolved.absPath, "utf8");
        } catch {
          continue;
        }
        if (!text.toLowerCase().includes(qLower)) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(qLower)) {
            matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 180) });
            if (matches.length >= maxMatches) break;
          }
        }
      }

      return {
        label,
        result: JSON.stringify({
          ok: true,
          query,
          filesSearched,
          matchCount: matches.length,
          matches
        })
      };
    }

    return {
      label: `${toolName}()`,
      result: JSON.stringify({ ok: false, error: `Unknown workspace tool: ${toolName}` })
    };
  }

  async handleSendChat(payload) {
    const creds = await this.getStoredCredentials();
    if (!this.connected) {
      const synced = await this.autoSyncEnvironment(true);
      if (!synced) {
        this.lastError = "Vui lòng nhập mật khẩu web 001Router để kết nối trước khi gửi yêu cầu.";
        await this.syncStateToWebviews();
        return;
      }
    }
    const freshCreds = await this.getStoredCredentials();
    const serverUrl = freshCreds.serverUrl || creds.serverUrl;
    const routerKey = freshCreds.routerKey || creds.routerKey;

    const sessionId = payload.sessionId;
    const promptText = String(payload.text || "").trim();
    const attachments = Array.isArray(payload.attachments) ? [...payload.attachments] : [];
    const mode = payload.mode || this.context.globalState.get(STATE_MODE) || "auto";
    const selection = payload.selection || this.context.globalState.get(STATE_SELECTION);
    const includeActiveFile = payload.includeActiveFile !== false;
    const includeWorkspace = payload.includeWorkspace !== false;

    if (!promptText && attachments.length === 0) return;

    // Support `/run <command>` directly from chat!
    if (/^\/run\s+.+/i.test(promptText)) {
      const cmd = promptText.replace(/^\/run\s+/i, "").trim();
      this.runTerminalCommand(cmd, sessionId);
      return;
    }

    const modelTarget = selection?.fullId || selection?.modelId;
    if (!modelTarget) {
      this.postToAll({
        type: "streamError",
        sessionId,
        error: "Chưa chọn Provider & Model. Vui lòng chọn model ở thanh dưới cùng."
      });
      return;
    }

    const editorContext = this.collectEditorContext(true);
    const ws = includeWorkspace ? editorContext.workspaceSummary : null;
    const toolsEnabled = Boolean(includeWorkspace && ws && ws.fileCount > 0);

    // Auto-include currently open active file if enabled and not already attached
    if (includeActiveFile && editorContext.activeFile) {
      const alreadyAttached = attachments.some(
        (a) => a.path === editorContext.activeFile.displayPath || a.path === editorContext.activeFile.fsPath
      );
      if (!alreadyAttached) {
        const autoItem = await this.readActiveFileAttachment(true);
        if (autoItem) {
          attachments.unshift(autoItem);
        }
      }
    }

    // Smart project folder hydration (manifests, open tabs, mentioned files, entry points)
    const hydrated = includeWorkspace
      ? this.hydrateProjectContextFiles(promptText, editorContext, attachments)
      : { block: "", hydratedFiles: [] };

    let sessions = this.getSessions();
    let session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      session = {
        id: sessionId || crypto.randomUUID(),
        title: "Untitled",
        bookmarked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      sessions.unshift(session);
    }

    const userDisplayText = promptText || `(Đính kèm ${attachments.length} tệp)`;
    if (session.title === "Untitled" && promptText) {
      session.title = promptText.slice(0, 44).replace(/\s+/g, " ");
    }

    const contextSections = [];
    if (attachments.length > 0) {
      contextSections.push(
        attachments
          .map((a) => {
            const diagNote = a.diagnostics ? `\nDiagnostics:\n${a.diagnostics}\n` : "";
            return `### File: ${a.path || a.label}${diagNote}\n\`\`\`${a.languageId || ""}\n${a.content || ""}\n\`\`\``;
          })
          .join("\n\n")
      );
    }
    if (hydrated.block) {
      contextSections.push(hydrated.block);
    }

    const llmUserContent = contextSections.length
      ? `${contextSections.join("\n\n")}\n\n### Developer Request\n${promptText}`
      : promptText;

    const visibleAttachments = attachments.map((a) => ({ label: a.label, path: a.path, isAuto: Boolean(a.isAuto) }));
    if (ws && ws.fileCount > 0) {
      visibleAttachments.unshift({
        label: `${ws.projectName}/ (${ws.fileCount}${ws.truncated ? "+" : ""} files)`,
        path: ws.projectRoot,
        isWorkspace: true
      });
    }

    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      text: userDisplayText,
      attachments: visibleAttachments,
      createdAt: new Date().toISOString()
    };

    const startedAt = Date.now();
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      reasoning: "",
      toolLogs: [],
      model: modelTarget,
      effort: selection?.effort || "medium",
      phase: "analyzing",
      phaseDetail: ws
        ? `Đang quét dự án ${ws.projectName} (${ws.fileCount} tệp)...`
        : editorContext.activeFile
          ? `Đang phân tích ${editorContext.activeFile.fileName}...`
          : "Đang phân tích yêu cầu & khởi tạo suy luận...",
      startedAt,
      durationMs: 0,
      createdAt: new Date().toISOString()
    };

    const apiMessages = [
      { role: "system", content: buildSystemPrompt(mode, editorContext, includeWorkspace, toolsEnabled) },
      ...session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-16)
        .map((m) => ({
          role: m.role,
          content: m.llmContent || m.text || ""
        })),
      { role: "user", content: llmUserContent }
    ];

    userMsg.llmContent = llmUserContent;
    session.messages.push(userMsg, assistantMsg);
    session.updatedAt = new Date().toISOString();
    await this.saveSessions(sessions);
    await this.context.globalState.update(STATE_ACTIVE_SESSION, session.id);

    this.postToAll({
      type: "streamStart",
      sessionId: session.id,
      sessionTitle: session.title,
      userMessage: userMsg,
      assistantMessage: assistantMsg
    });

    if (this.activeAbort) {
      this.activeAbort.abort();
    }
    const controller = new AbortController();
    this.activeAbort = controller;

    try {
      const reqHeaders = {
        "Content-Type": "application/json"
      };
      if (routerKey) {
        reqHeaders.Authorization = `Bearer ${routerKey}`;
        reqHeaders["x-api-key"] = routerKey;
      }

      let contentAcc = "";
      let reasoningAcc = "";
      const toolLogs = [];
      let useToolsThisRun = toolsEnabled;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const bodyPayload = {
          model: modelTarget,
          messages: apiMessages,
          stream: true
        };
        if (selection?.effort) {
          bodyPayload.reasoning_effort = selection.effort;
        }
        if (useToolsThisRun) {
          bodyPayload.tools = WORKSPACE_TOOLS;
          bodyPayload.tool_choice = "auto";
        }

        let resp = await fetch(`${serverUrl}/v1/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: reqHeaders,
          body: JSON.stringify(bodyPayload)
        });

        // Graceful fallback: if a model/provider rejects OpenAI `tools` with 400/422, retry immediately without `tools`
        // (full project folder tree & hydrated project files are already present in the prompt!)
        if (!resp.ok && useToolsThisRun && (resp.status === 400 || resp.status === 422) && round === 0) {
          useToolsThisRun = false;
          delete bodyPayload.tools;
          delete bodyPayload.tool_choice;
          apiMessages[0] = {
            role: "system",
            content: buildSystemPrompt(mode, editorContext, includeWorkspace, false)
          };
          resp = await fetch(`${serverUrl}/v1/chat/completions`, {
            method: "POST",
            signal: controller.signal,
            headers: reqHeaders,
            body: JSON.stringify(bodyPayload)
          });
        }

        if (!resp.ok) {
          const errBody = await resp.text();
          let errMessage = `HTTP ${resp.status}`;
          try {
            const parsed = JSON.parse(errBody);
            errMessage = parsed?.error?.message || parsed?.error || errMessage;
          } catch {
            if (errBody) errMessage = errBody.slice(0, 400);
          }
          if (resp.status === 401) {
            this.connected = false;
            await this.context.secrets.delete(SECRET_ROUTER_KEY);
          }
          throw new Error(errMessage);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let roundText = "";
        let currentPhase = "analyzing";
        const toolCallMap = new Map();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (!line || !line.startsWith("data:")) continue;
            const payloadStr = line.slice(5).trim();
            if (payloadStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payloadStr);
              const choice = parsed?.choices?.[0];
              const delta = choice?.delta || {};

              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const tcIdx = typeof tc.index === "number" ? tc.index : 0;
                  let entry = toolCallMap.get(tcIdx);
                  if (!entry) {
                    entry = {
                      id: tc.id || `call_${round}_${tcIdx}`,
                      type: "function",
                      function: { name: "", arguments: "" }
                    };
                    toolCallMap.set(tcIdx, entry);
                  }
                  if (tc.id) entry.id = tc.id;
                  if (tc.function?.name) entry.function.name += tc.function.name;
                  if (typeof tc.function?.arguments === "string") {
                    entry.function.arguments += tc.function.arguments;
                  }
                }
              }

              const chunkText = typeof delta.content === "string" ? delta.content : "";
              const chunkReason =
                typeof delta.reasoning_content === "string"
                  ? delta.reasoning_content
                  : typeof delta.reasoning === "string"
                    ? delta.reasoning
                    : "";

              if (chunkText || chunkReason) {
                const nextPhase = chunkText ? "streaming" : "thinking";
                currentPhase = nextPhase;
                roundText += chunkText;
                contentAcc += chunkText;
                reasoningAcc += chunkReason;
                this.postToAll({
                  type: "streamDelta",
                  sessionId: session.id,
                  messageId: assistantMsg.id,
                  deltaText: chunkText,
                  deltaReasoning: chunkReason,
                  phase: currentPhase
                });
              } else if (parsed?.error) {
                throw new Error(parsed.error.message || parsed.error);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message && !parseErr.message.includes("JSON")) {
                throw parseErr;
              }
            }
          }
        }

        const pendingToolCalls = Array.from(toolCallMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, entry]) => entry)
          .filter((tc) => tc.function?.name);

        if (pendingToolCalls.length === 0 || !useToolsThisRun) {
          break;
        }

        // Append assistant tool-call turn + execute each read-only workspace tool locally
        apiMessages.push({
          role: "assistant",
          content: roundText || "",
          tool_calls: pendingToolCalls
        });

        for (const tc of pendingToolCalls) {
          const toolName = tc.function.name;
          const execRes = this.executeWorkspaceTool(toolName, tc.function.arguments, ws);
          toolLogs.push({ tool: toolName, label: execRes.label });

          this.postToAll({
            type: "streamDelta",
            sessionId: session.id,
            messageId: assistantMsg.id,
            deltaText: "",
            deltaReasoning: "",
            phase: "analyzing",
            phaseDetail: `Đang tra cứu: ${execRes.label}`,
            toolLog: { tool: toolName, label: execRes.label }
          });

          apiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: execRes.result
          });
        }

        if (contentAcc && !contentAcc.endsWith("\n")) {
          contentAcc += "\n\n";
          this.postToAll({
            type: "streamDelta",
            sessionId: session.id,
            messageId: assistantMsg.id,
            deltaText: "\n\n",
            deltaReasoning: "",
            phase: "analyzing"
          });
        }
      }

      const durationMs = Date.now() - startedAt;
      const latestSessions = this.getSessions();
      const targetSession = latestSessions.find((s) => s.id === session.id);
      if (targetSession) {
        const targetMsg = targetSession.messages.find((m) => m.id === assistantMsg.id);
        if (targetMsg) {
          targetMsg.text = contentAcc || "(Không có phản hồi văn bản)";
          targetMsg.reasoning = reasoningAcc;
          targetMsg.toolLogs = toolLogs;
          targetMsg.phase = "done";
          targetMsg.durationMs = durationMs;
        }
        targetSession.updatedAt = new Date().toISOString();
        await this.saveSessions(latestSessions);
      }

      this.postToAll({
        type: "streamEnd",
        sessionId: session.id,
        messageId: assistantMsg.id,
        durationMs
      });
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const messageText = isAbort ? "Đã dừng tạo phản hồi." : formatErrorMessage(err);
      const durationMs = Date.now() - startedAt;
      const latestSessions = this.getSessions();
      const targetSession = latestSessions.find((s) => s.id === session.id);
      if (targetSession) {
        const targetMsg = targetSession.messages.find((m) => m.id === assistantMsg.id);
        if (targetMsg) {
          targetMsg.phase = "done";
          targetMsg.durationMs = durationMs;
          if (!targetMsg.text) {
            targetMsg.error = isAbort ? "" : messageText;
            if (isAbort) targetMsg.text = "_(Đã dừng)_";
          }
        }
        await this.saveSessions(latestSessions);
      }
      this.postToAll({
        type: "streamEnd",
        sessionId: session.id,
        messageId: assistantMsg.id,
        durationMs,
        error: isAbort ? "" : messageText
      });
      if (!this.connected) {
        await this.syncStateToWebviews();
      }
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = null;
      }
    }
  }

  async createNewChat() {
    const sessions = this.getSessions();
    const fresh = {
      id: crypto.randomUUID(),
      title: "Untitled",
      bookmarked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    sessions.unshift(fresh);
    await this.saveSessions(sessions);
    await this.context.globalState.update(STATE_ACTIVE_SESSION, fresh.id);
    await this.syncStateToWebviews();
  }

  async openEditorTab() {
    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.Beside);
      this.postToAll({ type: "focusInput" });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "001router.editorPanel",
      "001Router",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      }
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    panel.webview.html = this.getWebviewHtml(panel.webview, "panel");
    this.editorPanel = panel;

    panel.onDidDispose(() => {
      if (this.editorPanel === panel) {
        this.editorPanel = null;
      }
    });

    this.bindWebviewMessages(panel.webview);
    await this.autoSyncEnvironment(true);
    await this.syncStateToWebviews();
  }

  bindWebviewMessages(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ready": {
          await this.autoSyncEnvironment(true);
          await this.syncStateToWebviews();
          break;
        }
        case "connect": {
          await this.connectWithPassword(msg.serverUrl, msg.password);
          break;
        }
        case "disconnect": {
          await this.disconnect();
          break;
        }
        case "refreshCatalog":
        case "syncEnv": {
          await this.autoSyncEnvironment(false);
          await this.syncStateToWebviews();
          break;
        }
        case "saveSelection": {
          await this.context.globalState.update(STATE_SELECTION, msg.selection);
          this.postToAll({ type: "selectionUpdated", selection: msg.selection });
          break;
        }
        case "saveMode": {
          await this.context.globalState.update(STATE_MODE, msg.mode || "auto");
          this.postToAll({ type: "modeUpdated", mode: msg.mode || "auto" });
          break;
        }
        case "saveAutoActiveFile": {
          await this.context.globalState.update(STATE_AUTO_ACTIVE_FILE, Boolean(msg.enabled));
          break;
        }
        case "saveAutoWorkspace": {
          await this.context.globalState.update(STATE_AUTO_WORKSPACE, Boolean(msg.enabled));
          break;
        }
        case "refreshWorkspace": {
          this.invalidateWorkspaceCache();
          const ctx = this.collectEditorContext(true);
          this.postToAll({ type: "editorContext", editorContext: ctx });
          break;
        }
        case "newChat": {
          await this.createNewChat();
          break;
        }
        case "selectSession": {
          if (msg.sessionId) {
            await this.context.globalState.update(STATE_ACTIVE_SESSION, msg.sessionId);
            await this.syncStateToWebviews();
          }
          break;
        }
        case "toggleBookmark": {
          const sessions = this.getSessions();
          const target = sessions.find((s) => s.id === msg.sessionId);
          if (target) {
            target.bookmarked = !target.bookmarked;
            await this.saveSessions(sessions);
            await this.syncStateToWebviews();
          }
          break;
        }
        case "deleteSession": {
          const sessions = this.getSessions().filter((s) => s.id !== msg.sessionId);
          await this.saveSessions(sessions);
          const activeId = this.context.globalState.get(STATE_ACTIVE_SESSION);
          if (activeId === msg.sessionId) {
            await this.context.globalState.update(
              STATE_ACTIVE_SESSION,
              sessions[0]?.id || null
            );
          }
          await this.syncStateToWebviews();
          break;
        }
        case "pickContext": {
          await this.handlePickContext(msg.kind, webview, msg.uri);
          break;
        }
        case "sendChat": {
          await this.handleSendChat(msg);
          break;
        }
        case "abortChat": {
          if (this.activeAbort) {
            this.activeAbort.abort();
          }
          break;
        }
        case "applyCode": {
          await this.applyCodeToEditor(msg.code);
          break;
        }
        case "runCommand": {
          this.runTerminalCommand(msg.command, msg.sessionId);
          break;
        }
        case "killCommand": {
          this.killTerminalCommand(msg.runId);
          break;
        }
        case "openInTerminal": {
          this.openInVsCodeTerminal(msg.command);
          break;
        }
        case "revealFile": {
          if (msg.uri) {
            try {
              const targetUri = msg.uri.includes("://") ? vscode.Uri.parse(msg.uri) : vscode.Uri.file(msg.uri);
              const doc = await vscode.workspace.openTextDocument(targetUri);
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch {
              // ignore unresolvable path
            }
          }
          break;
        }
        case "openExternalPanel": {
          await this.openEditorTab();
          break;
        }
      }
    });
  }

  /**
   * @param {vscode.Webview} webview
   * @param {"sidebar" | "panel"} surface
   */
  getWebviewHtml(webview, surface) {
    const nonce = buildNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js")
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg")
    );
    const aiFaceUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "ai-face-3d.jpg")
    );
    const providersUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "providers")
    );

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>001Router</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body data-surface="${surface}" data-logo-uri="${logoUri}" data-ai-face-uri="${aiFaceUri}" data-providers-uri="${providersUri}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

class Router001SidebarProvider {
  /**
   * @param {Router001Controller} controller
   */
  constructor(controller) {
    this.controller = controller;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.controller.context.extensionUri, "media")
      ]
    };
    this.controller.sidebarView = webviewView;
    webviewView.webview.html = this.controller.getWebviewHtml(webviewView.webview, "sidebar");
    this.controller.bindWebviewMessages(webviewView.webview);
    webviewView.onDidDispose(() => {
      if (this.controller.sidebarView === webviewView) {
        this.controller.sidebarView = null;
      }
    });
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const controller = new Router001Controller(context);
  const sidebarProvider = new Router001SidebarProvider(controller);

  // Immediately auto-sync Antigravity, CLI tools, and active open file on extension startup
  controller.collectEditorContext();
  controller.autoSyncEnvironment(true).catch(() => {});

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("001router.chatView", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => controller.scheduleEditorContextPush(60)),
    vscode.window.onDidChangeTextEditorSelection(() => controller.scheduleEditorContextPush(150)),
    vscode.window.tabGroups.onDidChangeTabs(() => controller.scheduleEditorContextPush(100)),
    vscode.languages.onDidChangeDiagnostics(() => controller.scheduleEditorContextPush(350)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(80);
    }),
    vscode.workspace.onDidCreateFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.workspace.onDidDeleteFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.workspace.onDidRenameFiles(() => {
      controller.invalidateWorkspaceCache();
      controller.scheduleEditorContextPush(200);
    }),
    vscode.commands.registerCommand("001router.openPanel", () => controller.openEditorTab()),
    vscode.commands.registerCommand("001router.newChat", () => controller.createNewChat()),
    vscode.commands.registerCommand("001router.syncEnv", async () => {
      await controller.autoSyncEnvironment(false);
      await controller.syncStateToWebviews();
      vscode.window.showInformationMessage(
        `001Router đã đồng bộ (${controller.envSync.ideName} · ${controller.connected ? "Connected" : "Offline"}).`
      );
    }),
    vscode.commands.registerCommand("001router.connect", () => {
      controller.postToAll({ type: "openAuthModal" });
      if (!controller.sidebarView && !controller.editorPanel) {
        controller.openEditorTab();
      }
    }),
    vscode.commands.registerCommand("001router.focus", () => {
      if (controller.editorPanel) {
        controller.editorPanel.reveal(undefined, false);
      } else if (controller.sidebarView) {
        controller.sidebarView.show(false);
      } else {
        vscode.commands.executeCommand("001router.chatView.focus");
      }
      controller.postToAll({ type: "focusInput" });
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
