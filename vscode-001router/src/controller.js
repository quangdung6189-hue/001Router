"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const vscode = require("vscode");

const {
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
  MAX_TERMINAL_OUTPUT_CHARS
} = require("./constants");
const {
  normalizePermissions,
  applyPermissionPreset,
  ApprovalQueue
} = require("./permissions/permissionManager");
const {
  toPosixPath,
  normalizeComparePath,
  formatErrorMessage,
  stripAnsi,
  findProjectRootFromPath,
  discoverNearbyProjects,
  scanWorkspaceRoots,
  resolveProjectPath,
  readNumberedTextFile,
  hydrateProjectContextFiles
} = require("./workspace/scanner");
const {
  normalizeServerUrl,
  splitEffortSuffix,
  detectHostIde,
  discoverLocalEcosystem,
  normalizeCatalogForExtension,
  buildUnifiedSelection
} = require("./env/ecosystem");
const { buildSystemPrompt } = require("./agent/systemPrompt");
const { runAgentLoop } = require("./agent/agentLoop");

function buildNonce() {
  return crypto.randomBytes(16).toString("base64url");
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
    this.approvalQueue = new ApprovalQueue();
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

  getPermissions() {
    const saved = this.context.globalState.get(STATE_PERMISSIONS);
    return normalizePermissions(saved);
  }

  async savePermissions(nextPerms) {
    const normalized = normalizePermissions(nextPerms);
    await this.context.globalState.update(STATE_PERMISSIONS, normalized);
    this.postToAll({ type: "permissionsUpdated", permissions: normalized });
    return normalized;
  }

  getCustomWorkspaces() {
    const saved = this.context.globalState.get(STATE_CUSTOM_WORKSPACES);
    if (!Array.isArray(saved)) return [];
    const out = [];
    const seen = new Set();
    for (const item of saved) {
      if (!item || typeof item.fsPath !== "string" || !item.fsPath.trim()) continue;
      const abs = path.resolve(item.fsPath.trim());
      const key = normalizeComparePath(abs);
      if (seen.has(key)) continue;
      try {
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      seen.add(key);
      out.push({
        name: item.name || path.basename(abs) || abs,
        fsPath: abs,
        pinnedAt: item.pinnedAt || Date.now()
      });
    }
    return out.slice(0, 16);
  }

  async saveCustomWorkspaces(list) {
    const dedup = [];
    const seen = new Set();
    for (const item of list || []) {
      if (!item?.fsPath) continue;
      const abs = path.resolve(item.fsPath);
      const key = normalizeComparePath(abs);
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push({
        name: item.name || path.basename(abs) || abs,
        fsPath: abs,
        pinnedAt: item.pinnedAt || Date.now()
      });
    }
    const trimmed = dedup.slice(0, 16);
    await this.context.globalState.update(STATE_CUSTOM_WORKSPACES, trimmed);
    return trimmed;
  }

  getActiveProjectRoot() {
    const raw = this.context.globalState.get(STATE_ACTIVE_PROJECT_ROOT);
    if (typeof raw !== "string" || !raw.trim()) return "";
    const abs = path.resolve(raw.trim());
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
    } catch {
      // ignore missing dir
    }
    return "";
  }

  async switchProjectRoot(rawFsPath) {
    const trimmed = String(rawFsPath || "").trim();
    if (!trimmed || trimmed === "__ide__") {
      await this.context.globalState.update(STATE_ACTIVE_PROJECT_ROOT, "");
      this.invalidateWorkspaceCache();
      const ctx = this.collectEditorContext(true);
      this.postToAll({ type: "editorContext", editorContext: ctx });
      return { ok: true, editorContext: ctx };
    }

    const abs = path.resolve(trimmed);
    let isDir = false;
    try {
      isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      vscode.window.showWarningMessage(`Thư mục không tồn tại trên máy: ${trimmed}`);
      return { ok: false, error: `Thư mục không tồn tại: ${trimmed}` };
    }

    const ideFolders = (vscode.workspace.workspaceFolders || []).map((f) => normalizeComparePath(f.uri.fsPath));
    const isIdeRoot = ideFolders.includes(normalizeComparePath(abs));
    if (!isIdeRoot) {
      const existing = this.getCustomWorkspaces();
      const nextList = [
        { name: path.basename(abs) || abs, fsPath: abs, pinnedAt: Date.now() },
        ...existing.filter((w) => normalizeComparePath(w.fsPath) !== normalizeComparePath(abs))
      ];
      await this.saveCustomWorkspaces(nextList);
    }

    await this.context.globalState.update(STATE_ACTIVE_PROJECT_ROOT, isIdeRoot && ideFolders.length === 1 ? "" : abs);
    this.invalidateWorkspaceCache();
    const ctx = this.collectEditorContext(true);

    // Tag active session with the newly selected project folder
    const sessions = this.getSessions();
    const activeId = this.context.globalState.get(STATE_ACTIVE_SESSION);
    const activeSess = sessions.find((s) => s.id === activeId);
    if (activeSess) {
      activeSess.projectName = ctx.workspaceName || path.basename(abs);
      activeSess.projectRoot = abs;
      await this.saveSessions(sessions);
    }

    this.postToAll({ type: "editorContext", editorContext: ctx });
    return { ok: true, editorContext: ctx };
  }

  async pickProjectFolder() {
    const currentDir = this.editorContext?.workingDir;
    const defaultUri = currentDir && fs.existsSync(currentDir) ? vscode.Uri.file(currentDir) : undefined;
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri,
      openLabel: "Chọn thư mục dự án làm việc"
    });
    if (!picked || !picked.length) return;
    await this.switchProjectRoot(picked[0].fsPath);
  }

  async removeProjectFolder(rawFsPath) {
    if (!rawFsPath) return;
    const targetKey = normalizeComparePath(rawFsPath);
    const filtered = this.getCustomWorkspaces().filter((w) => normalizeComparePath(w.fsPath) !== targetKey);
    await this.saveCustomWorkspaces(filtered);
    if (normalizeComparePath(this.getActiveProjectRoot()) === targetKey) {
      await this.context.globalState.update(STATE_ACTIVE_PROJECT_ROOT, "");
    }
    this.invalidateWorkspaceCache();
    const ctx = this.collectEditorContext(true);
    this.postToAll({ type: "editorContext", editorContext: ctx });
  }

  async pickComputerFile(targetWebview) {
    const currentDir = this.editorContext?.workingDir;
    const defaultUri = currentDir && fs.existsSync(currentDir) ? vscode.Uri.file(currentDir) : undefined;
    const pickedUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri,
      openLabel: "Đính kèm tệp từ máy tính"
    });
    if (!pickedUris || !pickedUris.length) return;

    for (const uri of pickedUris) {
      const readRes = readNumberedTextFile(uri.fsPath, 1, 0, MAX_ATTACHMENT_CHARS);
      if (!readRes.ok) {
        vscode.window.showWarningMessage(`Không thể đọc ${path.basename(uri.fsPath)}: ${readRes.error}`);
        continue;
      }
      targetWebview.postMessage({
        type: "attachedContext",
        item: {
          id: `${uri.fsPath}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
          label: path.basename(uri.fsPath),
          path: toPosixPath(uri.fsPath),
          languageId: path.extname(uri.fsPath).slice(1),
          content: readRes.content
        }
      });
    }
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
            ? s.messages.slice(-MAX_MESSAGES_PER_SESSION).map((m) => ({
                ...m,
                // Keep step previews compact in persistent globalState
                steps: Array.isArray(m.steps)
                  ? m.steps.slice(-40).map((st) => ({
                      ...st,
                      output: typeof st.output === "string" ? st.output.slice(-2500) : "",
                      diffPreview: typeof st.diffPreview === "string" ? st.diffPreview.slice(-2500) : ""
                    }))
                  : undefined
              }))
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
    if (this.sidebarView?.webview) this.sidebarView.webview.postMessage(message);
    if (this.editorPanel?.webview) this.editorPanel.webview.postMessage(message);
  }

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
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === fallbackUri.toString());
      if (openDoc) return { doc: openDoc, editor: null };
    }
    const anyDoc = vscode.workspace.textDocuments.find(
      (d) => (d.uri.scheme === "file" || d.uri.scheme === "untitled") && !d.isClosed
    );
    if (anyDoc) return { doc: anyDoc, editor: null };
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

    let scanRoots = [];
    let rootSource = "none";
    const activeProjectRoot = this.getActiveProjectRoot();
    if (activeProjectRoot) {
      const folderName = path.basename(activeProjectRoot) || activeProjectRoot;
      scanRoots = [{ name: folderName, fsPath: activeProjectRoot }];
      rootSource = "custom";
      workingDir = activeProjectRoot;
      workspaceName = folderName;
    } else if (hasWorkspaceFolder) {
      scanRoots = folders.map((f) => ({ name: f.name || path.basename(f.uri.fsPath), fsPath: f.uri.fsPath }));
      rootSource = "workspace";
    } else {
      const seedFile = activeFile?.fsPath || openTabs.find((t) => t.fsPath && path.isAbsolute(t.fsPath))?.fsPath || "";
      if (seedFile && path.isAbsolute(seedFile)) {
        const found = findProjectRootFromPath(path.dirname(seedFile));
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
      if (!forceRescan && this._workspaceScanCache?.key === cacheKey && now - this._workspaceScanCache.at < 4000) {
        workspaceSummary = this._workspaceScanCache.summary;
      } else {
        workspaceSummary = scanWorkspaceRoots(scanRoots, rootSource);
        this._workspaceScanCache = { key: cacheKey, at: now, summary: workspaceSummary };
      }
    }

    if ((rootSource === "custom" || !hasWorkspaceFolder) && workspaceSummary?.projectRoot) {
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

    // Build deduplicated list of switchable projects (IDE folders + Custom folders + Nearby sibling folders on disk)
    const activeRootKey = workspaceSummary?.projectRoot ? normalizeComparePath(workspaceSummary.projectRoot) : "";
    const availableProjects = [];
    const seenProjectKeys = new Set();
    const pushProj = (item) => {
      if (!item?.fsPath) return;
      const key = normalizeComparePath(item.fsPath);
      if (seenProjectKeys.has(key)) return;
      seenProjectKeys.add(key);
      availableProjects.push({
        name: item.name || path.basename(item.fsPath) || item.fsPath,
        fsPath: item.fsPath,
        source: item.source,
        isActive: key === activeRootKey
      });
    };

    for (const f of folders) {
      pushProj({ name: f.name || path.basename(f.uri.fsPath), fsPath: f.uri.fsPath, source: "ide" });
    }
    for (const cw of this.getCustomWorkspaces()) {
      pushProj({ name: cw.name, fsPath: cw.fsPath, source: "custom" });
    }
    const baseForNearby = workspaceSummary?.projectRoot || folders[0]?.uri?.fsPath || "";
    if (baseForNearby) {
      const nearby = discoverNearbyProjects(baseForNearby, Array.from(seenProjectKeys), 10);
      for (const nb of nearby) pushProj(nb);
    }

    this.editorContext = {
      hasWorkspaceFolder,
      hasProjectFolder: Boolean(workspaceSummary && workspaceSummary.fileCount > 0),
      isCustomProject: rootSource === "custom",
      activeProjectRoot: activeProjectRoot || "",
      workspaceName: workspaceSummary?.projectName || workspaceName,
      workingDir,
      activeFile,
      openTabs: openTabs.slice(0, 24),
      workspaceSummary,
      availableProjects
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
    if (routerKey) headers.Authorization = `Bearer ${routerKey}`;
    const resp = await fetch(`${serverUrl}/v1/extension/catalog`, { method: "GET", headers });
    if (resp.status === 401 || resp.status === 403) return { ok: false, authFailed: true, status: resp.status };
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.catalog) {
      return { ok: false, authFailed: false, error: data?.error?.message || data?.error || `HTTP ${resp.status}` };
    }
    return { ok: true, catalog: normalizeCatalogForExtension(data.catalog) };
  }

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
          if (res.authFailed) await this.context.secrets.delete(SECRET_ROUTER_KEY);
        } catch (err) {
          if (!silent) this.lastError = `Không thể kết nối tới ${stored.serverUrl}: ${formatErrorMessage(err)}`;
        }
      }

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
          // try next
        }
      }

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
              headers: { "Content-Type": "application/json", "X-Requested-With": "001router" },
              body: JSON.stringify({ password: "1234", clientName: `001Router (${this.envSync.ideName})` })
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
          // offline
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
    const permissions = this.getPermissions();
    const editorContext = this.collectEditorContext();

    this.postToAll({
      type: "state",
      connected: this.connected,
      serverUrl: creds.serverUrl,
      catalog: this.catalog,
      selection,
      mode,
      permissions,
      autoActiveFile: autoActiveFile !== false,
      autoWorkspace: autoWorkspace !== false,
      envSync: this.envSync,
      editorContext,
      sessions: sessionData.sessions,
      activeSessionId: sessionData.activeId,
      lastError: this.lastError
    });
  }

  async ensureValidSelection() {
    const providers = Array.isArray(this.catalog?.providers) ? this.catalog.providers : [];
    const combos = Array.isArray(this.catalog?.combos) ? this.catalog.combos : [];
    const current = this.context.globalState.get(STATE_SELECTION);

    if (current?.kind === "combo") {
      const combo = combos.find((c) => c.name === current.modelId);
      if (combo) {
        const levels = combo.effort?.effortLevels || [];
        if (!levels.some((l) => l.id === current.effort)) {
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
        const baseMatch = current.baseModelId ? prov.models.find((m) => m.id === current.baseModelId) : null;
        const directMatch = prov.models.find((m) => m.id === current.modelId);
        const variantMatch = prov.models.find(
          (m) => m.variantMap && Object.values(m.variantMap).some((v) => (v.id || v.modelId) === current.modelId)
        );
        const { baseId: stemmedId } = splitEffortSuffix(String(current.modelId || ""));
        const stemModel = stemmedId && stemmedId !== current.modelId ? prov.models.find((m) => m.id === stemmedId) : null;
        const model = baseMatch || directMatch || variantMatch || stemModel || prov.models[0];
        if (model) {
          await this.context.globalState.update(STATE_SELECTION, buildUnifiedSelection(prov, model, current.effort));
          return;
        }
      }
    }

    let preferredProv = providers[0] || null;
    if (this.envSync.ideKind === "antigravity") {
      const agProv = providers.find((p) => p.preset === "antigravity" || p.slug === "antigravity");
      if (agProv) preferredProv = agProv;
    }
    if (preferredProv && preferredProv.models[0]) {
      await this.context.globalState.update(STATE_SELECTION, buildUnifiedSelection(preferredProv, preferredProv.models[0], null));
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
        headers: { "Content-Type": "application/json", "X-Requested-With": "001router" },
        body: JSON.stringify({ password, clientName: `001Router (${this.envSync.ideName})` })
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
    this.abortActiveRun();
    await this.context.secrets.delete(SECRET_ROUTER_KEY);
    this.connected = false;
    this.autoSyncedFrom = null;
    this.envSync.autoSyncedFrom = null;
    this.lastError = "";
    await this.syncStateToWebviews();
  }

  abortActiveRun() {
    this.approvalQueue.rejectAll("Người dùng đã dừng tác vụ.");
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
  }

  registerProcess(id, child) {
    if (!id) return;
    if (child) this.activeProcesses.set(id, child);
    else this.activeProcesses.delete(id);
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

  runTerminalCommand(rawCommand, sessionId) {
    const command = String(rawCommand || "").trim();
    if (!command) return;
    const ctx = this.collectEditorContext();
    const cwd = ctx.workingDir && fs.existsSync(ctx.workingDir) ? ctx.workingDir : os.homedir();
    const runId = `term-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const startedAt = Date.now();

    this.postToAll({ type: "terminalStart", runId, sessionId, command, cwd, startedAt });

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
      if (acc.length < MAX_TERMINAL_OUTPUT_CHARS) acc += clean;
      this.postToAll({ type: "terminalOutput", runId, stream: streamName, chunk: clean });
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

  openInVsCodeTerminal(command) {
    const ctx = this.collectEditorContext();
    const cwd = ctx.workingDir && fs.existsSync(ctx.workingDir) ? ctx.workingDir : os.homedir();
    const term = vscode.window.createTerminal({ name: "001Router", cwd });
    term.show(true);
    if (command) term.sendText(String(command), true);
  }

  async readActiveFileAttachment(preferSelection = true) {
    const { doc, editor } = this.resolveActiveDocument();
    if (!doc) return null;
    const hasWorkspace = (vscode.workspace.workspaceFolders || []).length > 0;
    const fsPath = doc.uri.scheme === "file" ? doc.uri.fsPath : doc.fileName;
    const relPath = hasWorkspace ? vscode.workspace.asRelativePath(doc.uri, false) : fsPath;
    const displayLabel = path.basename(fsPath || relPath || "Untitled");
    const sel = editor?.selection;

    let content = preferSelection && sel && !sel.isEmpty ? doc.getText(sel) : doc.getText();
    const rangeLabel = preferSelection && sel && !sel.isEmpty ? `L${sel.start.line + 1}-${sel.end.line + 1}` : "";
    if (content.length > MAX_ATTACHMENT_CHARS) {
      content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
    }

    const diags = vscode.languages.getDiagnostics(doc.uri) || [];
    const diagSummary = diags
      .slice(0, 12)
      .map((d) => `- [${d.severity === vscode.DiagnosticSeverity.Error ? "ERROR" : "WARN"}] Line ${d.range.start.line + 1}: ${d.message}`)
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
      const resolved = resolveProjectPath(extraUri, ctx.workspaceSummary?.roots || [], { allowOutside: false, mustExist: true });
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
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(extraUri));
        const fsPath = doc.uri.scheme === "file" ? doc.uri.fsPath : doc.fileName;
        let content = doc.getText();
        if (content.length > MAX_ATTACHMENT_CHARS) content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
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

    if (kind === "computerFile") {
      await this.pickComputerFile(targetWebview);
      return;
    }

    if (kind === "workspaceFile") {
      const ctx = this.collectEditorContext();
      const wsFiles = ctx.workspaceSummary?.files || [];
      if (wsFiles.length > 0) {
        const browseOpt = { label: "$(folder-opened) Chọn tệp bất kỳ từ máy tính...", isBrowse: true };
        const items = [browseOpt, ...wsFiles.map((rel) => ({ label: rel, isBrowse: false }))];
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Chọn tệp trong ${ctx.workspaceName || "dự án"} hoặc mở từ máy tính`
        });
        if (!picked) return;
        if (picked.isBrowse) {
          await this.pickComputerFile(targetWebview);
          return;
        }
        const resolved = resolveProjectPath(picked.label, ctx.workspaceSummary?.roots || [], {
          allowOutside: false,
          mustExist: true
        });
        if (!resolved) return;
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

      await this.pickComputerFile(targetWebview);
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
      if (editor.selection && !editor.selection.isEmpty) editBuilder.replace(editor.selection, code);
      else editBuilder.insert(editor.selection.active, code);
    });
    vscode.window.showInformationMessage("Đã chèn đoạn mã từ 001Router vào editor.");
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
    const permissions = this.getPermissions();

    if (!promptText && attachments.length === 0) return;

    if (/^\/run\s+.+/i.test(promptText)) {
      this.runTerminalCommand(promptText.replace(/^\/run\s+/i, "").trim(), sessionId);
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
    const toolsEnabled = Boolean(includeWorkspace || permissions.executeTerminal || permissions.webAccess);

    if (includeActiveFile && editorContext.activeFile) {
      const already = attachments.some(
        (a) => a.path === editorContext.activeFile.displayPath || a.path === editorContext.activeFile.fsPath
      );
      if (!already) {
        const autoItem = await this.readActiveFileAttachment(true);
        if (autoItem) attachments.unshift(autoItem);
      }
    }

    const hydrated = includeWorkspace
      ? hydrateProjectContextFiles(promptText, editorContext, attachments)
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
      session.title = promptText.slice(0, 46).replace(/\s+/g, " ");
    }
    if (editorContext.workspaceName) {
      session.projectName = editorContext.workspaceName;
      session.projectRoot = editorContext.workspaceSummary?.projectRoot || editorContext.workingDir || "";
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
    if (hydrated.block) contextSections.push(hydrated.block);

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
      steps: [],
      plan: [],
      model: modelTarget,
      effort: selection?.effort || "medium",
      phase: "analyzing",
      phaseDetail: ws
        ? `Đang khởi chạy tác vụ trên ${ws.projectName} (${ws.fileCount} tệp)...`
        : "Đang phân tích yêu cầu & khởi tạo lõi 3D Singularity...",
      startedAt,
      durationMs: 0,
      reachedStepCap: false,
      createdAt: new Date().toISOString()
    };

    const apiMessages = [
      { role: "system", content: buildSystemPrompt(mode, editorContext, includeWorkspace, toolsEnabled, permissions) },
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

    this.abortActiveRun();
    const controller = new AbortController();
    this.activeAbort = controller;

    try {
      const result = await runAgentLoop({
        serverUrl,
        routerKey,
        modelTarget,
        effort: selection?.effort,
        mode,
        apiMessages,
        editorContext,
        includeWorkspace,
        toolsEnabled,
        permissions,
        approvalQueue: this.approvalQueue,
        signal: controller.signal,
        onAuthExpired: async () => {
          this.connected = false;
          await this.context.secrets.delete(SECRET_ROUTER_KEY);
        },
        onAlwaysAllowCategory: async (category) => {
          const cur = this.getPermissions();
          if (category in cur) {
            await this.savePermissions({ ...cur, [category]: true });
          }
        },
        onWorkspaceMutated: () => {
          this.invalidateWorkspaceCache();
          this.scheduleEditorContextPush(150);
        },
        registerProcess: (id, child) => this.registerProcess(id, child),
        emit: (ev) => {
          if (ev.type === "delta") {
            this.postToAll({
              type: "streamDelta",
              sessionId: session.id,
              messageId: assistantMsg.id,
              deltaText: ev.deltaText || "",
              deltaReasoning: ev.deltaReasoning || "",
              phase: ev.phase
            });
          } else if (ev.type === "phase") {
            this.postToAll({
              type: "streamDelta",
              sessionId: session.id,
              messageId: assistantMsg.id,
              deltaText: "",
              deltaReasoning: "",
              phase: ev.phase,
              phaseDetail: ev.phaseDetail
            });
          } else if (ev.type === "stepUpdate") {
            this.postToAll({
              type: "streamStep",
              sessionId: session.id,
              messageId: assistantMsg.id,
              step: ev.step,
              stepCount: ev.stepCount,
              maxSteps: ev.maxSteps
            });
          } else if (ev.type === "stepOutput") {
            this.postToAll({
              type: "streamStepOutput",
              sessionId: session.id,
              messageId: assistantMsg.id,
              stepId: ev.stepId,
              chunk: ev.chunk,
              streamName: ev.streamName
            });
          } else if (ev.type === "planUpdate") {
            this.postToAll({
              type: "streamPlan",
              sessionId: session.id,
              messageId: assistantMsg.id,
              plan: ev.plan
            });
          }
        }
      });

      const durationMs = Date.now() - startedAt;
      const latestSessions = this.getSessions();
      const targetSession = latestSessions.find((s) => s.id === session.id);
      if (targetSession) {
        const targetMsg = targetSession.messages.find((m) => m.id === assistantMsg.id);
        if (targetMsg) {
          targetMsg.text = result.text;
          targetMsg.reasoning = result.reasoning;
          targetMsg.steps = result.steps;
          targetMsg.plan = result.plan;
          targetMsg.totalTokens = result.totalTokens;
          targetMsg.reachedStepCap = result.reachedStepCap;
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
        durationMs,
        totalTokens: result.totalTokens,
        reachedStepCap: result.reachedStepCap,
        finalText: result.text
      });
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const messageText = isAbort ? "Đã dừng tác vụ." : formatErrorMessage(err);
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
            if (isAbort) targetMsg.text = "_(Đã dừng bởi người dùng)_";
          }
        }
        await this.saveSessions(latestSessions);
      }
      this.postToAll({
        type: "streamEnd",
        sessionId: session.id,
        messageId: assistantMsg.id,
        durationMs,
        aborted: isAbort,
        error: isAbort ? "" : messageText
      });
      if (!this.connected) await this.syncStateToWebviews();
    } finally {
      if (this.activeAbort === controller) this.activeAbort = null;
    }
  }

  async createNewChat() {
    const sessions = this.getSessions();
    const ctx = this.collectEditorContext();
    const fresh = {
      id: crypto.randomUUID(),
      title: "Untitled",
      projectName: ctx.workspaceName || "",
      projectRoot: ctx.workspaceSummary?.projectRoot || ctx.workingDir || "",
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
    const panel = vscode.window.createWebviewPanel("001router.editorPanel", "001Router", vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    panel.webview.html = this.getWebviewHtml(panel.webview, "panel");
    this.editorPanel = panel;
    panel.onDidDispose(() => {
      if (this.editorPanel === panel) this.editorPanel = null;
    });
    this.bindWebviewMessages(panel.webview);
    await this.autoSyncEnvironment(true);
    await this.syncStateToWebviews();
  }

  bindWebviewMessages(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ready":
          await this.autoSyncEnvironment(true);
          await this.syncStateToWebviews();
          break;
        case "connect":
          await this.connectWithPassword(msg.serverUrl, msg.password);
          break;
        case "disconnect":
          await this.disconnect();
          break;
        case "refreshCatalog":
        case "syncEnv":
          await this.autoSyncEnvironment(false);
          await this.syncStateToWebviews();
          break;
        case "saveSelection":
          await this.context.globalState.update(STATE_SELECTION, msg.selection);
          this.postToAll({ type: "selectionUpdated", selection: msg.selection });
          break;
        case "saveMode":
          await this.context.globalState.update(STATE_MODE, msg.mode || "auto");
          this.postToAll({ type: "modeUpdated", mode: msg.mode || "auto" });
          break;
        case "savePermissions":
          await this.savePermissions(msg.permissions);
          break;
        case "applyPermissionPreset": {
          const updated = applyPermissionPreset(this.getPermissions(), msg.preset);
          await this.savePermissions(updated);
          break;
        }
        case "resolveApproval":
          this.approvalQueue.resolve(msg.approvalId, msg.decision || "deny", msg.note || "");
          break;
        case "saveAutoActiveFile":
          await this.context.globalState.update(STATE_AUTO_ACTIVE_FILE, Boolean(msg.enabled));
          break;
        case "saveAutoWorkspace":
          await this.context.globalState.update(STATE_AUTO_WORKSPACE, Boolean(msg.enabled));
          break;
        case "refreshWorkspace": {
          this.invalidateWorkspaceCache();
          const ctx = this.collectEditorContext(true);
          this.postToAll({ type: "editorContext", editorContext: ctx });
          break;
        }
        case "pickProjectFolder":
          await this.pickProjectFolder();
          break;
        case "switchProjectRoot":
          await this.switchProjectRoot(msg.fsPath);
          break;
        case "removeProjectFolder":
          await this.removeProjectFolder(msg.fsPath);
          break;
        case "pickComputerFile":
          await this.pickComputerFile(webview);
          break;
        case "newChat":
          await this.createNewChat();
          break;
        case "selectSession":
          if (msg.sessionId) {
            await this.context.globalState.update(STATE_ACTIVE_SESSION, msg.sessionId);
            await this.syncStateToWebviews();
          }
          break;
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
            await this.context.globalState.update(STATE_ACTIVE_SESSION, sessions[0]?.id || null);
          }
          await this.syncStateToWebviews();
          break;
        }
        case "pickContext":
          await this.handlePickContext(msg.kind, webview, msg.uri);
          break;
        case "sendChat":
          await this.handleSendChat(msg);
          break;
        case "abortChat":
          this.abortActiveRun();
          break;
        case "applyCode":
          await this.applyCodeToEditor(msg.code);
          break;
        case "runCommand":
          this.runTerminalCommand(msg.command, msg.sessionId);
          break;
        case "killCommand":
          this.killTerminalCommand(msg.runId);
          break;
        case "openInTerminal":
          this.openInVsCodeTerminal(msg.command);
          break;
        case "revealFile":
          if (msg.uri) {
            try {
              const targetUri = String(msg.uri).includes("://") ? vscode.Uri.parse(msg.uri) : vscode.Uri.file(msg.uri);
              const doc = await vscode.workspace.openTextDocument(targetUri);
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch {
              // ignore
            }
          }
          break;
        case "openExternalPanel":
          await this.openEditorTab();
          break;
      }
    });
  }

  getWebviewHtml(webview, surface) {
    const nonce = buildNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css"));
    const grok3dUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "grok3d.js"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js"));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg"));
    const providersUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "providers"));

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>001Router</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body data-surface="${surface}" data-logo-uri="${logoUri}" data-providers-uri="${providersUri}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${grok3dUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

module.exports = { Router001Controller };
