"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const { EFFORT_ORDER, EFFORT_SUFFIX_RE, PRODUCT_MAX_RE } = require("../constants");

function normalizeServerUrl(rawUrl) {
  let clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (!/^https?:\/\//i.test(clean)) {
    const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(clean);
    clean = `${isLocal ? "http" : "https"}://${clean}`;
  }
  return clean.replace(/\/+$/, "").replace(/\/(v1|api)$/i, "");
}

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

  const agDirExists =
    fs.existsSync(path.join(home, ".gemini", "antigravity")) ||
    fs.existsSync(path.join(home, ".antigravity"));
  cliTools.push({
    id: "antigravity",
    label: "Antigravity",
    detected: hostIde.ideKind === "antigravity" || agDirExists,
    synced: hostIde.ideKind === "antigravity" || agDirExists
  });
  cliTools.push({ id: "vscode", label: hostIde.ideName, detected: true, synced: true });

  const geminiCliDir = path.join(home, ".gemini");
  cliTools.push({
    id: "gemini-cli",
    label: "Gemini CLI",
    detected: fs.existsSync(geminiCliDir),
    synced: fs.existsSync(path.join(geminiCliDir, "oauth_creds.json")) || fs.existsSync(path.join(geminiCliDir, "settings.json"))
  });

  const claudeData = readJsonSafe(path.join(home, ".claude", "settings.json"));
  const claudeBase = claudeData?.env?.ANTHROPIC_BASE_URL || "";
  const claudeKey = claudeData?.env?.ANTHROPIC_AUTH_TOKEN || "";
  const claudeSynced = isLocalOrRouterUrl(claudeBase);
  if (claudeSynced && isRouterKeyLike(claudeKey)) {
    discoveredCredentials.push({ source: "Claude CLI", serverUrl: normalizeServerUrl(claudeBase), routerKey: claudeKey.trim() });
  }
  cliTools.push({ id: "claude", label: "Claude CLI", detected: Boolean(claudeData) || fs.existsSync(path.join(home, ".claude")), synced: claudeSynced });

  const codexToml = readTextSafe(path.join(home, ".codex", "config.toml"));
  const codexAuth = readJsonSafe(path.join(home, ".codex", "auth.json"));
  const codexBaseMatch = codexToml ? codexToml.match(/base_url\s*=\s*"([^"\r\n]*)"/i) : null;
  const codexBase = codexBaseMatch ? codexBaseMatch[1] : "";
  const codexKey = codexAuth?.OPENAI_API_KEY || "";
  const codexSynced = Boolean(codexToml && /router_001/i.test(codexToml) && isLocalOrRouterUrl(codexBase));
  if (codexSynced && isRouterKeyLike(codexKey)) {
    discoveredCredentials.push({ source: "Codex CLI", serverUrl: normalizeServerUrl(codexBase), routerKey: codexKey.trim() });
  }
  cliTools.push({ id: "codex", label: "Codex CLI", detected: codexToml !== null || fs.existsSync(path.join(home, ".codex")), synced: codexSynced });

  const clineState = readJsonSafe(path.join(home, ".cline", "data", "globalState.json"));
  const clineSecrets = readJsonSafe(path.join(home, ".cline", "data", "secrets.json"));
  const clineBase = clineState?.openAiBaseUrl || "";
  const clineKey = clineSecrets?.openAiApiKey || "";
  const clineSynced = isLocalOrRouterUrl(clineBase);
  if (clineSynced && isRouterKeyLike(clineKey)) {
    discoveredCredentials.push({ source: "Cline", serverUrl: normalizeServerUrl(clineBase), routerKey: clineKey.trim() });
  }
  cliTools.push({ id: "cline", label: "Cline", detected: Boolean(clineState) || fs.existsSync(path.join(home, ".cline")), synced: clineSynced });

  const openCodeData = readJsonSafe(path.join(home, ".config", "opencode", "opencode.json"));
  const ocBase = openCodeData?.provider?.router001?.options?.baseURL || "";
  const ocKey = openCodeData?.provider?.router001?.options?.apiKey || "";
  const ocSynced = isLocalOrRouterUrl(ocBase);
  if (ocSynced && isRouterKeyLike(ocKey)) {
    discoveredCredentials.push({ source: "OpenCode", serverUrl: normalizeServerUrl(ocBase), routerKey: ocKey.trim() });
  }
  cliTools.push({ id: "opencode", label: "OpenCode", detected: Boolean(openCodeData) || fs.existsSync(path.join(home, ".config", "opencode")), synced: ocSynced });

  const contYaml = readTextSafe(path.join(home, ".continue", "config.yaml"));
  const contBaseMatch = contYaml ? contYaml.match(/^\s*apiBase:\s*(.+)$/m) : null;
  const contKeyMatch = contYaml ? contYaml.match(/^\s*apiKey:\s*(.+)$/m) : null;
  const contBase = contBaseMatch ? unquoteScalar(contBaseMatch[1]) : "";
  const contKey = contKeyMatch ? unquoteScalar(contKeyMatch[1]) : "";
  const contSynced = Boolean(contYaml && (contYaml.includes("001ROUTER") || isLocalOrRouterUrl(contBase)));
  if (contSynced && isRouterKeyLike(contKey)) {
    discoveredCredentials.push({ source: "Continue", serverUrl: normalizeServerUrl(contBase), routerKey: contKey.trim() });
  }
  cliTools.push({ id: "continue", label: "Continue", detected: contYaml !== null || fs.existsSync(path.join(home, ".continue")), synced: contSynced });

  return { hostIde, cliTools, discoveredCredentials };
}

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

    return { ...prov, modelCount: unified.length, models: unified };
  });

  return { ...rawCatalog, providers };
}

function buildUnifiedSelection(prov, model, desiredEffort) {
  const levels = model.effort?.effortLevels || [];
  const hasDesired = levels.some((l) => l.id === desiredEffort);
  const effort = hasDesired ? desiredEffort : model.effort?.defaultEffort || levels[0]?.id || "medium";
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

module.exports = {
  normalizeServerUrl,
  splitEffortSuffix,
  detectHostIde,
  discoverLocalEcosystem,
  normalizeCatalogForExtension,
  buildUnifiedSelection
};
