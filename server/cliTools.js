import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maskKey } from "./auth.js";

export const CONFIGURABLE_CLI_TOOLS = new Set([
  "claude",
  "codex",
  "opencode",
  "cline",
  "kilo",
  "droid",
  "continue",
  "aider"
]);

const DEFAULT_ROUTER_PORT = 20128;

function createHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Resolve the target home directory (supports `options.homeDir` for isolated tests).
 * @param {string} [homeDirOverride]
 */
function resolveHomeDir(homeDirOverride) {
  if (typeof homeDirOverride === "string" && homeDirOverride.trim()) {
    return path.resolve(homeDirOverride.trim());
  }
  return os.homedir();
}

/**
 * Pure-filesystem binary check on PATH (never spawns a shell or child_process).
 * @param {string} binaryName
 * @param {string} [envPathOverride]
 */
function hasBinaryOnPath(binaryName, envPathOverride) {
  const rawPath =
    envPathOverride !== undefined ? String(envPathOverride) : process.env.PATH || "";
  if (!rawPath) return false;
  const dirs = rawPath.split(path.delimiter).filter(Boolean);
  const candidates =
    process.platform === "win32"
      ? [binaryName, `${binaryName}.exe`, `${binaryName}.cmd`, `${binaryName}.bat`]
      : [binaryName];

  for (const dir of dirs) {
    for (const exe of candidates) {
      try {
        const fullPath = path.join(dir, exe);
        if (fs.existsSync(fullPath)) {
          return true;
        }
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
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
  if (raw === null) return { exists: false, data: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      data: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    };
  } catch {
    return { exists: true, data: {}, malformed: true };
  }
}

function writeFileEnsureDir(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

function removeFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup failure
  }
}

/**
 * Snapshot original user files into `<backupPath>` before the first managed write.
 * Subsequent applies preserve the original user snapshot until reset/restore is invoked.
 */
function ensureBackup(backupPath, targetPaths) {
  if (fs.existsSync(backupPath)) return;
  const files = {};
  for (const filePath of targetPaths) {
    const exists = fs.existsSync(filePath);
    files[filePath] = {
      existed: exists,
      content: exists ? readTextSafe(filePath) : null
    };
  }
  writeFileEnsureDir(
    backupPath,
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        files
      },
      null,
      2
    )
  );
}

/**
 * Restore all files snapshotted in `<backupPath>` and remove the backup marker.
 * @returns {boolean} True if a backup file existed and was restored.
 */
function restoreFromBackup(backupPath) {
  if (!fs.existsSync(backupPath)) return false;
  const parsed = readJsonSafe(backupPath);
  const files = parsed.data?.files;
  if (files && typeof files === "object") {
    for (const [filePath, snap] of Object.entries(files)) {
      if (!snap || snap.existed === false || snap.content === null) {
        removeFileIfExists(filePath);
      } else {
        writeFileEnsureDir(filePath, String(snap.content));
      }
    }
  }
  removeFileIfExists(backupPath);
  return true;
}

function validateSafeSingleLine(value, fieldName, maxLen = 300) {
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw createHttpError(400, `${fieldName} cannot be empty`);
  }
  if (trimmed.length > maxLen) {
    throw createHttpError(400, `${fieldName} exceeds maximum length (${maxLen})`);
  }
  if (/[\r\n\0]/.test(trimmed)) {
    throw createHttpError(400, `${fieldName} must not contain control characters or newlines`);
  }
  return trimmed;
}

function validateOptionalSingleLine(value, fieldName) {
  if (value === undefined || value === null || value === "") return "";
  return validateSafeSingleLine(value, fieldName);
}

function validateTomlScalar(value, fieldName) {
  const s = validateSafeSingleLine(value, fieldName);
  if (/["\\]/.test(s)) {
    throw createHttpError(400, `${fieldName} contains characters disallowed in TOML strings`);
  }
  return s;
}

function normalizeRouterBaseUrl(rawUrl, fallbackPort = DEFAULT_ROUTER_PORT) {
  const candidate =
    typeof rawUrl === "string" && rawUrl.trim()
      ? validateSafeSingleLine(rawUrl, "baseUrl", 500)
      : `http://127.0.0.1:${fallbackPort}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw createHttpError(400, "Invalid baseUrl: must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createHttpError(400, "Invalid baseUrl: must use http or https protocol");
  }
  return candidate.replace(/\/+$/, "");
}

function ensureV1Suffix(baseUrl) {
  const stripped = String(baseUrl || "").replace(/\/+$/, "");
  return stripped.endsWith("/v1") ? stripped : `${stripped}/v1`;
}

function stripV1Suffix(baseUrl) {
  const stripped = String(baseUrl || "").replace(/\/+$/, "");
  return stripped.endsWith("/v1") ? stripped.slice(0, -3) : stripped;
}

function isMaskedPlaceholder(rawKey) {
  if (typeof rawKey !== "string") return false;
  const s = rawKey.trim();
  return !s || s.includes("…") || s.includes("***redacted***");
}

function isLikelyRouterUrl(candidateUrl, routerOrigins = []) {
  if (!candidateUrl || typeof candidateUrl !== "string") return false;
  const normalized = candidateUrl.trim().replace(/\/+$/, "").toLowerCase();
  if (!normalized) return false;
  for (const origin of routerOrigins) {
    const o = String(origin || "").trim().replace(/\/+$/, "").toLowerCase();
    if (!o) continue;
    if (normalized === o || normalized === `${o}/v1` || normalized.startsWith(`${o}/`)) {
      return true;
    }
  }
  return false;
}

function buildRouterOrigins(port = DEFAULT_ROUTER_PORT, customBaseUrl = "") {
  const p = Number(port) || DEFAULT_ROUTER_PORT;
  const origins = [
    `http://127.0.0.1:${p}`,
    `http://localhost:${p}`,
    `http://[::1]:${p}`
  ];
  if (customBaseUrl) {
    origins.push(stripV1Suffix(customBaseUrl));
  }
  return origins;
}

function resolveEffectiveApiKey(requestedApiKey, existingToolKey, storage) {
  if (
    typeof requestedApiKey === "string" &&
    requestedApiKey.trim() &&
    !isMaskedPlaceholder(requestedApiKey)
  ) {
    return validateSafeSingleLine(requestedApiKey, "apiKey", 512);
  }

  if (existingToolKey && typeof existingToolKey === "string" && existingToolKey.trim()) {
    return existingToolKey.trim();
  }

  const enabledRouterKeys = storage
    ? (storage.getKeys() || []).filter((k) => k.enabled !== false)
    : [];
  if (enabledRouterKeys.length === 0) {
    // No router API keys exist, so Anonymous local mode allows any bearer token string
    return "001router-local";
  }

  throw createHttpError(
    400,
    "A valid 001Router API key is required because router API key enforcement is active. Create a key in the UI or paste one before applying."
  );
}

// --- Per-Tool Path Builders, Inspectors, Appliers & Resetters ---

function getToolPaths(toolId, homeDir) {
  switch (toolId) {
    case "claude":
      return {
        configPath: path.join(homeDir, ".claude", "settings.json"),
        backupPath: path.join(homeDir, ".claude", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".claude")
      };
    case "codex":
      return {
        configPath: path.join(homeDir, ".codex", "config.toml"),
        authPath: path.join(homeDir, ".codex", "auth.json"),
        backupPath: path.join(homeDir, ".codex", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".codex")
      };
    case "opencode":
      return {
        configPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
        backupPath: path.join(homeDir, ".config", "opencode", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".config", "opencode")
      };
    case "cline":
      return {
        configPath: path.join(homeDir, ".cline", "data", "globalState.json"),
        secretsPath: path.join(homeDir, ".cline", "data", "secrets.json"),
        backupPath: path.join(homeDir, ".cline", "data", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".cline")
      };
    case "kilo":
      return {
        configPath: path.join(homeDir, ".config", "kilo", "opencode.json"),
        authPath: path.join(homeDir, ".local", "share", "kilo", "auth.json"),
        backupPath: path.join(homeDir, ".config", "kilo", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".config", "kilo")
      };
    case "droid":
      return {
        configPath: path.join(homeDir, ".factory", "settings.json"),
        backupPath: path.join(homeDir, ".factory", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".factory")
      };
    case "continue":
      return {
        configPath: path.join(homeDir, ".continue", "config.yaml"),
        backupPath: path.join(homeDir, ".continue", ".001router-backup.json"),
        dirPath: path.join(homeDir, ".continue")
      };
    case "aider":
      return {
        configPath: path.join(homeDir, ".aider.conf.yml"),
        backupPath: path.join(homeDir, ".aider.001router-backup.json"),
        dirPath: homeDir
      };
    default:
      return null;
  }
}

function parseCodexToml(tomlText) {
  if (!tomlText) {
    return {
      model: "",
      modelProvider: "",
      routerBaseUrl: "",
      wireApi: "responses"
    };
  }
  const topModelMatch = tomlText.match(/^\s*model\s*=\s*"([^"\r\n]*)"/m);
  const topProviderMatch = tomlText.match(/^\s*model_provider\s*=\s*"([^"\r\n]*)"/m);
  const routerSectionMatch = tomlText.match(
    /\[model_providers\.router_001\]([\s\S]*?)(?=\n\[|$)/
  );
  let routerBaseUrl = "";
  let wireApi = "responses";
  if (routerSectionMatch) {
    const body = routerSectionMatch[1];
    const baseMatch = body.match(/^\s*base_url\s*=\s*"([^"\r\n]*)"/m);
    const wireMatch = body.match(/^\s*wire_api\s*=\s*"([^"\r\n]*)"/m);
    if (baseMatch) routerBaseUrl = baseMatch[1];
    if (wireMatch) wireApi = wireMatch[1];
  }
  return {
    model: topModelMatch ? topModelMatch[1] : "",
    modelProvider: topProviderMatch ? topProviderMatch[1] : "",
    routerBaseUrl,
    wireApi
  };
}

function buildUpdatedCodexToml(existingText, { model, baseUrl, wireApi }) {
  let content = existingText ? existingText.replace(/\r\n/g, "\n") : "";

  const setTopLevel = (text, key, val) => {
    const headerIdx = text.search(/^\[/m);
    const topPart = headerIdx === -1 ? text : text.slice(0, headerIdx);
    const restPart = headerIdx === -1 ? "" : text.slice(headerIdx);
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    const line = `${key} = "${val}"`;
    const nextTop = re.test(topPart)
      ? topPart.replace(re, line)
      : `${line}\n${topPart.replace(/^\n+/, "")}`;
    return nextTop + restPart;
  };

  content = setTopLevel(content, "model", model);
  content = setTopLevel(content, "model_provider", "router_001");

  const sectionBlock = [
    "[model_providers.router_001]",
    `name = "001Router"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "${wireApi}"`,
    `env_key = "OPENAI_API_KEY"`
  ].join("\n");

  const sectionRe = /\n?\[model_providers\.router_001\][\s\S]*?(?=\n\[|$)/;
  if (sectionRe.test(content)) {
    content = content.replace(sectionRe, `\n${sectionBlock}`);
  } else {
    content = `${content.trimEnd()}\n\n${sectionBlock}\n`;
  }
  return content.trimStart();
}

function inspectClaudeTool(homeDir, opts) {
  const paths = getToolPaths("claude", homeDir);
  const { exists, data } = readJsonSafe(paths.configPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const binaryInstalled = hasBinaryOnPath("claude", opts.envPath);
  const env = data.env && typeof data.env === "object" ? data.env : {};
  const configuredBaseUrl = typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : "";
  const rawKey = typeof env.ANTHROPIC_AUTH_TOKEN === "string" ? env.ANTHROPIC_AUTH_TOKEN : "";
  const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
  const connected = isLikelyRouterUrl(configuredBaseUrl, routerOrigins);

  const status = connected
    ? "configured"
    : configuredBaseUrl || rawKey
      ? "other"
      : binaryInstalled || exists || dirExists
        ? "installed"
        : "not_detected";

  return {
    tool: "claude",
    status,
    installed: binaryInstalled || exists || dirExists,
    hasConfig: exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl: configuredBaseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model: typeof env.ANTHROPIC_MODEL === "string" ? env.ANTHROPIC_MODEL : "",
      opusModel:
        typeof env.ANTHROPIC_DEFAULT_OPUS_MODEL === "string"
          ? env.ANTHROPIC_DEFAULT_OPUS_MODEL
          : "",
      sonnetModel:
        typeof env.ANTHROPIC_DEFAULT_SONNET_MODEL === "string"
          ? env.ANTHROPIC_DEFAULT_SONNET_MODEL
          : "",
      haikuModel:
        typeof env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "string"
          ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL
          : ""
    },
    _existingKey: rawKey
  };
}

function inspectCodexTool(homeDir, opts) {
  const paths = getToolPaths("codex", homeDir);
  const rawToml = readTextSafe(paths.configPath);
  const authJson = readJsonSafe(paths.authPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const binaryInstalled = hasBinaryOnPath("codex", opts.envPath);
  const parsed = parseCodexToml(rawToml);
  const rawKey =
    typeof authJson.data?.OPENAI_API_KEY === "string" ? authJson.data.OPENAI_API_KEY : "";
  const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
  const connected =
    parsed.modelProvider === "router_001" && isLikelyRouterUrl(parsed.routerBaseUrl, routerOrigins);

  const status = connected
    ? "configured"
    : rawToml !== null && parsed.modelProvider
      ? "other"
      : binaryInstalled || rawToml !== null || dirExists
        ? "installed"
        : "not_detected";

  return {
    tool: "codex",
    status,
    installed: binaryInstalled || rawToml !== null || dirExists,
    hasConfig: rawToml !== null,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl: parsed.routerBaseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model: parsed.model,
      wireApi: parsed.wireApi || "responses"
    },
    _existingKey: rawKey
  };
}

function inspectOpenCodeLikeTool(toolId, homeDir, opts) {
  const paths = getToolPaths(toolId, homeDir);
  const { exists, data } = readJsonSafe(paths.configPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const binaryInstalled =
    toolId === "opencode"
      ? hasBinaryOnPath("opencode", opts.envPath)
      : hasBinaryOnPath("kilo", opts.envPath) || hasBinaryOnPath("kilocode", opts.envPath);

  const entry = data?.provider?.router001 || null;
  const configuredBaseUrl =
    typeof entry?.options?.baseURL === "string" ? entry.options.baseURL : "";
  let rawKey = typeof entry?.options?.apiKey === "string" ? entry.options.apiKey : "";
  if (!rawKey && toolId === "kilo" && paths.authPath) {
    const authJson = readJsonSafe(paths.authPath);
    if (typeof authJson.data?.router001?.key === "string") {
      rawKey = authJson.data.router001.key;
    }
  }

  const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
  const connected = Boolean(entry) && isLikelyRouterUrl(configuredBaseUrl, routerOrigins);
  const hasOtherProviders =
    data?.provider &&
    typeof data.provider === "object" &&
    Object.keys(data.provider).some((k) => k !== "router001");

  const status = connected
    ? "configured"
    : exists && (hasOtherProviders || data?.model)
      ? "other"
      : binaryInstalled || exists || dirExists
        ? "installed"
        : "not_detected";

  const activeModelRaw = typeof data?.model === "string" ? data.model : "";
  const model = activeModelRaw.startsWith("router001/")
    ? activeModelRaw.slice("router001/".length)
    : activeModelRaw;

  return {
    tool: toolId,
    status,
    installed: binaryInstalled || exists || dirExists,
    hasConfig: exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl: configuredBaseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model
    },
    _existingKey: rawKey
  };
}

function inspectClineTool(homeDir, opts) {
  const paths = getToolPaths("cline", homeDir);
  const globalState = readJsonSafe(paths.configPath);
  const secrets = readJsonSafe(paths.secretsPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const binaryInstalled = hasBinaryOnPath("cline", opts.envPath);
  const configuredBaseUrl =
    typeof globalState.data?.openAiBaseUrl === "string"
      ? globalState.data.openAiBaseUrl
      : "";
  const rawKey =
    typeof secrets.data?.openAiApiKey === "string" ? secrets.data.openAiApiKey : "";
  const model =
    typeof globalState.data?.openAiModelId === "string" ? globalState.data.openAiModelId : "";
  const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
  const connected =
    globalState.data?.apiProvider === "openai" &&
    isLikelyRouterUrl(configuredBaseUrl, routerOrigins);

  const status = connected
    ? "configured"
    : globalState.exists && globalState.data?.apiProvider
      ? "other"
      : binaryInstalled || globalState.exists || dirExists
        ? "installed"
        : "not_detected";

  return {
    tool: "cline",
    status,
    installed: binaryInstalled || globalState.exists || dirExists,
    hasConfig: globalState.exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl: configuredBaseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model
    },
    _existingKey: rawKey
  };
}

function inspectDroidTool(homeDir, opts) {
  const paths = getToolPaths("droid", homeDir);
  const { exists, data } = readJsonSafe(paths.configPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const binaryInstalled = hasBinaryOnPath("droid", opts.envPath);
  const models = Array.isArray(data.customModels) ? data.customModels : [];
  const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
  const matched = models.find(
    (m) =>
      m &&
      (m.id === "custom:001Router" ||
        (typeof m.displayName === "string" && m.displayName.startsWith("001Router")) ||
        isLikelyRouterUrl(m.baseUrl, routerOrigins))
  );
  const rawKey = typeof matched?.apiKey === "string" ? matched.apiKey : "";
  const connected = Boolean(matched && isLikelyRouterUrl(matched.baseUrl, routerOrigins));

  const status = connected
    ? "configured"
    : exists && models.length > 0
      ? "other"
      : binaryInstalled || exists || dirExists
        ? "installed"
        : "not_detected";

  return {
    tool: "droid",
    status,
    installed: binaryInstalled || exists || dirExists,
    hasConfig: exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl: typeof matched?.baseUrl === "string" ? matched.baseUrl : "",
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model: typeof matched?.model === "string" ? matched.model : ""
    },
    _existingKey: rawKey
  };
}

function unquoteYamlScalar(rawVal) {
  if (!rawVal) return "";
  const trimmed = rawVal.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function inspectContinueTool(homeDir, opts) {
  const paths = getToolPaths("continue", homeDir);
  const rawYaml = readTextSafe(paths.configPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const dirExists = fs.existsSync(paths.dirPath);
  const exists = rawYaml !== null;

  let baseUrl = "";
  let rawKey = "";
  let model = "";
  let connected = false;

  if (rawYaml) {
    const managedMatch = rawYaml.match(
      /# BEGIN 001ROUTER MANAGED[\s\S]*?# END 001ROUTER MANAGED/
    );
    const inspectSlice = managedMatch ? managedMatch[0] : rawYaml;
    const baseMatch = inspectSlice.match(/^\s*apiBase:\s*(.+)$/m);
    const keyMatch = inspectSlice.match(/^\s*apiKey:\s*(.+)$/m);
    const modelMatch = inspectSlice.match(/^\s*model:\s*(.+)$/m);
    baseUrl = baseMatch ? unquoteYamlScalar(baseMatch[1]) : "";
    rawKey = keyMatch ? unquoteYamlScalar(keyMatch[1]) : "";
    model = modelMatch ? unquoteYamlScalar(modelMatch[1]) : "";
    const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
    connected = Boolean(managedMatch) || isLikelyRouterUrl(baseUrl, routerOrigins);
  }

  const status = connected
    ? "configured"
    : exists && /^\s*models:/m.test(rawYaml || "")
      ? "other"
      : exists || dirExists
        ? "installed"
        : "not_detected";

  return {
    tool: "continue",
    status,
    installed: exists || dirExists,
    hasConfig: exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model
    },
    _existingKey: rawKey
  };
}

function inspectAiderTool(homeDir, opts) {
  const paths = getToolPaths("aider", homeDir);
  const rawYaml = readTextSafe(paths.configPath);
  const backupExists = fs.existsSync(paths.backupPath);
  const binaryInstalled = hasBinaryOnPath("aider", opts.envPath);
  const exists = rawYaml !== null;

  let baseUrl = "";
  let rawKey = "";
  let model = "";
  let connected = false;

  if (rawYaml) {
    const baseMatch = rawYaml.match(/^\s*openai-api-base:\s*(.+)$/m);
    const keyMatch = rawYaml.match(/^\s*openai-api-key:\s*(.+)$/m);
    const modelMatch = rawYaml.match(/^\s*model:\s*(.+)$/m);
    baseUrl = baseMatch ? unquoteYamlScalar(baseMatch[1]) : "";
    rawKey = keyMatch ? unquoteYamlScalar(keyMatch[1]) : "";
    const rawModel = modelMatch ? unquoteYamlScalar(modelMatch[1]) : "";
    model = rawModel.startsWith("openai/") ? rawModel.slice("openai/".length) : rawModel;
    const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
    connected = isLikelyRouterUrl(baseUrl, routerOrigins);
  }

  const status = connected
    ? "configured"
    : exists && (baseUrl || model)
      ? "other"
      : binaryInstalled || exists
        ? "installed"
        : "not_detected";

  return {
    tool: "aider",
    status,
    installed: binaryInstalled || exists,
    hasConfig: exists,
    hasBackup: backupExists,
    configPath: paths.configPath,
    summary: {
      baseUrl,
      maskedKey: rawKey ? maskKey(rawKey) : "",
      model
    },
    _existingKey: rawKey
  };
}

function inspectToolInternal(toolId, opts = {}) {
  const homeDir = resolveHomeDir(opts.homeDir);
  switch (toolId) {
    case "claude":
      return inspectClaudeTool(homeDir, opts);
    case "codex":
      return inspectCodexTool(homeDir, opts);
    case "opencode":
    case "kilo":
      return inspectOpenCodeLikeTool(toolId, homeDir, opts);
    case "cline":
      return inspectClineTool(homeDir, opts);
    case "droid":
      return inspectDroidTool(homeDir, opts);
    case "continue":
      return inspectContinueTool(homeDir, opts);
    case "aider":
      return inspectAiderTool(homeDir, opts);
    default:
      throw createHttpError(404, `Unsupported CLI tool '${toolId}'`);
  }
}

function stripInternalFields(statusObj) {
  const { _existingKey, ...publicStatus } = statusObj;
  return publicStatus;
}

/**
 * Inspect local configuration statuses across all supported configurable CLI/IDE tools.
 * Never returns plaintext API keys or spawns external processes.
 */
export function getCliToolStatus(toolId, opts = {}) {
  if (!CONFIGURABLE_CLI_TOOLS.has(toolId)) {
    throw createHttpError(404, `Unsupported CLI tool '${toolId}'`);
  }
  return stripInternalFields(inspectToolInternal(toolId, opts));
}

/**
 * Return status summaries for all auto-configurable tools.
 */
export function getAllCliToolStatuses(opts = {}) {
  const statuses = {};
  for (const toolId of CONFIGURABLE_CLI_TOOLS) {
    statuses[toolId] = getCliToolStatus(toolId, opts);
  }
  return statuses;
}

/**
 * Apply 001Router configuration to a local CLI tool config file, creating a pre-router
 * backup first so users can always restore cleanly with `resetCliToolConfig`.
 */
export function applyCliToolConfig(toolId, payload = {}, storage = null, opts = {}) {
  if (!CONFIGURABLE_CLI_TOOLS.has(toolId)) {
    throw createHttpError(404, `Unsupported CLI tool '${toolId}'`);
  }

  const homeDir = resolveHomeDir(opts.homeDir);
  const current = inspectToolInternal(toolId, opts);
  const effectiveKey = resolveEffectiveApiKey(
    payload.apiKey,
    current._existingKey,
    storage
  );
  const baseOrigin = stripV1Suffix(
    normalizeRouterBaseUrl(payload.baseUrl || opts.baseUrl, opts.port || DEFAULT_ROUTER_PORT)
  );
  const v1BaseUrl = ensureV1Suffix(baseOrigin);
  const model = payload.model
    ? validateSafeSingleLine(payload.model, "model")
    : current.summary?.model || "openai/gpt-4o-mini";

  const paths = getToolPaths(toolId, homeDir);

  if (toolId === "claude") {
    ensureBackup(paths.backupPath, [paths.configPath]);
    const existing = readJsonSafe(paths.configPath).data;
    const prevEnv = existing.env && typeof existing.env === "object" ? existing.env : {};
    const nextEnv = {
      ...prevEnv,
      ANTHROPIC_BASE_URL: baseOrigin,
      ANTHROPIC_AUTH_TOKEN: effectiveKey,
      ANTHROPIC_MODEL: model
    };

    const opus = validateOptionalSingleLine(payload.opusModel, "opusModel");
    const sonnet = validateOptionalSingleLine(payload.sonnetModel, "sonnetModel");
    const haiku = validateOptionalSingleLine(payload.haikuModel, "haikuModel");
    if (opus) nextEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (sonnet) nextEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (haiku) nextEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

    const nextConfig = { ...existing, env: nextEnv };
    writeFileEnsureDir(paths.configPath, JSON.stringify(nextConfig, null, 2) + "\n");
  } else if (toolId === "codex") {
    const safeModel = validateTomlScalar(model, "model");
    const safeBaseUrl = validateTomlScalar(v1BaseUrl, "baseUrl");
    const wireApi = payload.wireApi === "chat" ? "chat" : "responses";

    ensureBackup(paths.backupPath, [paths.configPath, paths.authPath]);
    const existingToml = readTextSafe(paths.configPath) || "";
    const nextToml = buildUpdatedCodexToml(existingToml, {
      model: safeModel,
      baseUrl: safeBaseUrl,
      wireApi
    });
    writeFileEnsureDir(paths.configPath, nextToml);

    const existingAuth = readJsonSafe(paths.authPath).data;
    const nextAuth = {
      ...existingAuth,
      OPENAI_API_KEY: effectiveKey
    };
    writeFileEnsureDir(paths.authPath, JSON.stringify(nextAuth, null, 2) + "\n");
  } else if (toolId === "opencode" || toolId === "kilo") {
    const backupTargets = paths.authPath
      ? [paths.configPath, paths.authPath]
      : [paths.configPath];
    ensureBackup(paths.backupPath, backupTargets);

    const existing = readJsonSafe(paths.configPath).data;
    const existingProviders =
      existing.provider && typeof existing.provider === "object" ? existing.provider : {};
    const existingModels =
      existingProviders.router001?.models &&
      typeof existingProviders.router001.models === "object"
        ? existingProviders.router001.models
        : {};

    const nextConfig = {
      ...existing,
      $schema: existing.$schema || "https://opencode.ai/config.json",
      model: `router001/${model}`,
      provider: {
        ...existingProviders,
        router001: {
          npm: "@ai-sdk/openai-compatible",
          name: "001Router",
          options: {
            baseURL: v1BaseUrl,
            apiKey: effectiveKey
          },
          models: {
            ...existingModels,
            [model]: { name: model }
          }
        }
      }
    };
    writeFileEnsureDir(paths.configPath, JSON.stringify(nextConfig, null, 2) + "\n");

    if (toolId === "kilo" && paths.authPath) {
      const existingAuth = readJsonSafe(paths.authPath).data;
      const nextAuth = {
        ...existingAuth,
        router001: { type: "api", key: effectiveKey }
      };
      writeFileEnsureDir(paths.authPath, JSON.stringify(nextAuth, null, 2) + "\n");
    }
  } else if (toolId === "cline") {
    ensureBackup(paths.backupPath, [paths.configPath, paths.secretsPath]);
    const existingState = readJsonSafe(paths.configPath).data;
    const nextState = {
      ...existingState,
      apiProvider: "openai",
      openAiBaseUrl: v1BaseUrl,
      openAiModelId: model
    };
    writeFileEnsureDir(paths.configPath, JSON.stringify(nextState, null, 2) + "\n");

    const existingSecrets = readJsonSafe(paths.secretsPath).data;
    const nextSecrets = {
      ...existingSecrets,
      openAiApiKey: effectiveKey
    };
    writeFileEnsureDir(paths.secretsPath, JSON.stringify(nextSecrets, null, 2) + "\n");
  } else if (toolId === "droid") {
    ensureBackup(paths.backupPath, [paths.configPath]);
    const existing = readJsonSafe(paths.configPath).data;
    const existingCustom = Array.isArray(existing.customModels) ? existing.customModels : [];
    const routerOrigins = buildRouterOrigins(opts.port, baseOrigin);
    const filtered = existingCustom.filter(
      (m) =>
        !m ||
        (m.id !== "custom:001Router" && !isLikelyRouterUrl(m.baseUrl, routerOrigins))
    );
    const routerEntry = {
      id: "custom:001Router",
      model,
      displayName: `001Router (${model})`,
      baseUrl: v1BaseUrl,
      apiKey: effectiveKey,
      provider: "generic-chat-completion-api",
      maxOutputTokens: 16384
    };
    const nextConfig = {
      ...existing,
      customModels: [routerEntry, ...filtered]
    };
    writeFileEnsureDir(paths.configPath, JSON.stringify(nextConfig, null, 2) + "\n");
  } else if (toolId === "continue") {
    ensureBackup(paths.backupPath, [paths.configPath]);
    const existingYaml = readTextSafe(paths.configPath) || "";
    const normalized = existingYaml.replace(/\r\n/g, "\n");
    const entryBlock = [
      "  # BEGIN 001ROUTER MANAGED",
      `  - name: "001Router"`,
      `    provider: "openai"`,
      `    model: ${JSON.stringify(model)}`,
      `    apiBase: ${JSON.stringify(v1BaseUrl)}`,
      `    apiKey: ${JSON.stringify(effectiveKey)}`,
      "    roles:",
      "      - chat",
      "      - edit",
      "      - apply",
      "  # END 001ROUTER MANAGED"
    ].join("\n");

    const existingManagedRe =
      /[ \t]*# BEGIN 001ROUTER MANAGED[\s\S]*?# END 001ROUTER MANAGED/;
    let nextYaml;
    if (existingManagedRe.test(normalized)) {
      nextYaml = normalized.replace(existingManagedRe, entryBlock);
    } else if (/^models:\s*\[\s*\]/m.test(normalized)) {
      nextYaml = normalized.replace(/^models:\s*\[\s*\]/m, `models:\n${entryBlock}`);
    } else if (/^models:\s*$/m.test(normalized)) {
      nextYaml = normalized.replace(/^models:\s*$/m, `models:\n${entryBlock}`);
    } else {
      const prefix = normalized.trimEnd() ? `${normalized.trimEnd()}\n\n` : "";
      nextYaml = `${prefix}models:\n${entryBlock}\n`;
    }
    writeFileEnsureDir(paths.configPath, nextYaml);
  } else if (toolId === "aider") {
    ensureBackup(paths.backupPath, [paths.configPath]);
    const existingYaml = readTextSafe(paths.configPath) || "";
    const aiderModel = model.startsWith("openai/") ? model : `openai/${model}`;

    let lines = existingYaml
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return (
          !t.startsWith("openai-api-base:") &&
          !t.startsWith("openai-api-key:") &&
          !t.startsWith("model:") &&
          t !== "# BEGIN 001ROUTER MANAGED" &&
          t !== "# END 001ROUTER MANAGED"
        );
      });

    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    const block = [
      "# BEGIN 001ROUTER MANAGED",
      `openai-api-base: ${JSON.stringify(v1BaseUrl)}`,
      `openai-api-key: ${JSON.stringify(effectiveKey)}`,
      `model: ${JSON.stringify(aiderModel)}`,
      "# END 001ROUTER MANAGED"
    ];

    const out = lines.length > 0 ? `${lines.join("\n")}\n\n${block.join("\n")}\n` : `${block.join("\n")}\n`;
    writeFileEnsureDir(paths.configPath, out);
  }

  return getCliToolStatus(toolId, opts);
}

/**
 * Restore pre-001Router CLI tool configuration from backup, or strip managed entries cleanly
 * when no backup exists.
 */
export function resetCliToolConfig(toolId, opts = {}) {
  if (!CONFIGURABLE_CLI_TOOLS.has(toolId)) {
    throw createHttpError(404, `Unsupported CLI tool '${toolId}'`);
  }

  const homeDir = resolveHomeDir(opts.homeDir);
  const paths = getToolPaths(toolId, homeDir);
  const restored = restoreFromBackup(paths.backupPath);

  if (!restored) {
    // Strip 001Router entries cleanly even if user deleted backup manually
    if (toolId === "claude" && fs.existsSync(paths.configPath)) {
      const existing = readJsonSafe(paths.configPath).data;
      if (existing.env && typeof existing.env === "object") {
        delete existing.env.ANTHROPIC_BASE_URL;
        delete existing.env.ANTHROPIC_AUTH_TOKEN;
        delete existing.env.ANTHROPIC_MODEL;
        delete existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
        delete existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
        delete existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      }
      writeFileEnsureDir(paths.configPath, JSON.stringify(existing, null, 2) + "\n");
    } else if (toolId === "codex" && fs.existsSync(paths.configPath)) {
      const toml = readTextSafe(paths.configPath) || "";
      const cleaned = toml
        .replace(/^\s*model_provider\s*=\s*"router_001"\s*\n?/m, "")
        .replace(/\n?\[model_providers\.router_001\][\s\S]*?(?=\n\[|$)/, "")
        .trim();
      writeFileEnsureDir(paths.configPath, cleaned ? `${cleaned}\n` : "");
    } else if ((toolId === "opencode" || toolId === "kilo") && fs.existsSync(paths.configPath)) {
      const existing = readJsonSafe(paths.configPath).data;
      if (existing.provider?.router001) delete existing.provider.router001;
      if (typeof existing.model === "string" && existing.model.startsWith("router001/")) {
        delete existing.model;
      }
      writeFileEnsureDir(paths.configPath, JSON.stringify(existing, null, 2) + "\n");
      if (toolId === "kilo" && paths.authPath && fs.existsSync(paths.authPath)) {
        const auth = readJsonSafe(paths.authPath).data;
        delete auth.router001;
        writeFileEnsureDir(paths.authPath, JSON.stringify(auth, null, 2) + "\n");
      }
    } else if (toolId === "droid" && fs.existsSync(paths.configPath)) {
      const existing = readJsonSafe(paths.configPath).data;
      if (Array.isArray(existing.customModels)) {
        const routerOrigins = buildRouterOrigins(opts.port, opts.baseUrl);
        existing.customModels = existing.customModels.filter(
          (m) => m && m.id !== "custom:001Router" && !isLikelyRouterUrl(m.baseUrl, routerOrigins)
        );
      }
      writeFileEnsureDir(paths.configPath, JSON.stringify(existing, null, 2) + "\n");
    } else if (toolId === "continue" && fs.existsSync(paths.configPath)) {
      const yaml = readTextSafe(paths.configPath) || "";
      const cleaned = yaml
        .replace(/\n?[ \t]*# BEGIN 001ROUTER MANAGED[\s\S]*?# END 001ROUTER MANAGED\n?/g, "\n")
        .trimEnd();
      writeFileEnsureDir(paths.configPath, cleaned ? `${cleaned}\n` : "");
    } else if (toolId === "aider" && fs.existsSync(paths.configPath)) {
      const yaml = readTextSafe(paths.configPath) || "";
      const cleaned = yaml
        .replace(/\n?# BEGIN 001ROUTER MANAGED[\s\S]*?# END 001ROUTER MANAGED\n?/g, "\n")
        .trimEnd();
      writeFileEnsureDir(paths.configPath, cleaned ? `${cleaned}\n` : "");
    }
  }

  return getCliToolStatus(toolId, opts);
}
