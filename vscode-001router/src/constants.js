"use strict";

const SECRET_SERVER_URL = "001router.serverUrl";
const SECRET_ROUTER_KEY = "001router.routerKey";
const STATE_SESSIONS = "001router.sessions";
const STATE_ACTIVE_SESSION = "001router.activeSessionId";
const STATE_SELECTION = "001router.selection";
const STATE_MODE = "001router.mode";
const STATE_AUTO_ACTIVE_FILE = "001router.autoActiveFile";
const STATE_AUTO_WORKSPACE = "001router.autoWorkspace";
const STATE_PERMISSIONS = "001router.permissions.v2";
const STATE_CUSTOM_WORKSPACES = "001router.customWorkspaces.v1";
const STATE_ACTIVE_PROJECT_ROOT = "001router.activeProjectRoot.v1";

const MAX_SESSIONS = 40;
const MAX_MESSAGES_PER_SESSION = 100;
const MAX_ATTACHMENT_CHARS = 40000;
const MAX_TERMINAL_OUTPUT_CHARS = 32000;
const MAX_WORKSPACE_SCAN_FILES = 600;
const MAX_WORKSPACE_SCAN_DEPTH = 7;
const MAX_WORKSPACE_TREE_LINES = 180;
const MAX_HYDRATED_TOTAL_CHARS = 48000;
const MAX_SINGLE_READ_CHARS = 28000;
const DEFAULT_MAX_STEPS = 35;
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_SUFFIX_RE = /^(.*?)-(minimal|low|medium|high|xhigh|max)$/i;
const PRODUCT_MAX_RE =
  /(?:qwen|codex|minimax|mistral|doubao|glm|kimi|ernie|step|hunyuan|deepseek|grok|nova|sonar|baichuan|yi)[^/]*-max$/i;

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
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svgz",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar", ".vsix",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".sqlite", ".db", ".lockb", ".pyc", ".class", ".jar"
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

/**
 * Default granular permission matrix (Cline / Claude Code / BotChat full-access model).
 * Defaults to "yolo" (full autonomous terminal + file + web + IDE access) so long tasks run
 * continuously without getting blocked mid-flight, while still letting the user switch to
 * "safe" or "ask" or toggle any individual permission switch with one click.
 */
const DEFAULT_PERMISSIONS = Object.freeze({
  preset: "yolo", // "ask" | "safe" | "yolo"
  readFiles: true,
  editFiles: true,
  deleteFiles: true,
  executeTerminal: true,
  outsideWorkspace: true,
  webAccess: true,
  ideDiagnostics: true,
  autoRetry: true,
  guardCatastrophic: true,
  maxSteps: DEFAULT_MAX_STEPS // 0 = unlimited
});

const PERMISSION_PRESETS = Object.freeze({
  ask: {
    preset: "ask",
    readFiles: true,
    editFiles: false,
    deleteFiles: false,
    executeTerminal: false,
    outsideWorkspace: false,
    webAccess: false,
    ideDiagnostics: true,
    autoRetry: true,
    guardCatastrophic: true
  },
  safe: {
    preset: "safe",
    readFiles: true,
    editFiles: true,
    deleteFiles: false,
    executeTerminal: true,
    outsideWorkspace: false,
    webAccess: true,
    ideDiagnostics: true,
    autoRetry: true,
    guardCatastrophic: true
  },
  yolo: {
    preset: "yolo",
    readFiles: true,
    editFiles: true,
    deleteFiles: true,
    executeTerminal: true,
    outsideWorkspace: true,
    webAccess: true,
    ideDiagnostics: true,
    autoRetry: true,
    guardCatastrophic: true
  }
});

module.exports = {
  SECRET_SERVER_URL,
  SECRET_ROUTER_KEY,
  STATE_SESSIONS,
  STATE_ACTIVE_SESSION,
  STATE_SELECTION,
  STATE_MODE,
  STATE_AUTO_ACTIVE_FILE,
  STATE_AUTO_WORKSPACE,
  STATE_PERMISSIONS,
  STATE_CUSTOM_WORKSPACES,
  STATE_ACTIVE_PROJECT_ROOT,
  MAX_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  MAX_ATTACHMENT_CHARS,
  MAX_TERMINAL_OUTPUT_CHARS,
  MAX_WORKSPACE_SCAN_FILES,
  MAX_WORKSPACE_SCAN_DEPTH,
  MAX_WORKSPACE_TREE_LINES,
  MAX_HYDRATED_TOTAL_CHARS,
  MAX_SINGLE_READ_CHARS,
  DEFAULT_MAX_STEPS,
  MAX_RETRY_ATTEMPTS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  EFFORT_ORDER,
  EFFORT_SUFFIX_RE,
  PRODUCT_MAX_RE,
  IGNORED_DIRS,
  BINARY_EXTS,
  PROJECT_ROOT_MARKERS,
  MANIFEST_FILE_NAMES,
  DEFAULT_PERMISSIONS,
  PERMISSION_PRESETS
};
