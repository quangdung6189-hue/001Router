"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const vscode = require("vscode");

const SECRET_SERVER_URL = "001router.serverUrl";
const SECRET_ROUTER_KEY = "001router.routerKey";
const STATE_SESSIONS = "001router.sessions";
const STATE_ACTIVE_SESSION = "001router.activeSessionId";
const STATE_SELECTION = "001router.selection";
const STATE_MODE = "001router.mode";

const MAX_SESSIONS = 40;
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_ATTACHMENT_CHARS = 32000;

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

function buildSystemPrompt(mode) {
  if (mode === "ask") {
    return (
      "You are 001Router AI Coding Assistant in Ask mode inside the developer's IDE. " +
      "Give accurate, concise architectural and debugging answers grounded in the attached files and workspace context. " +
      "Do not invent file paths or APIs that were not provided."
    );
  }
  if (mode === "plan") {
    return (
      "You are 001Router AI Coding Assistant in Plan mode inside the developer's IDE. " +
      "Produce clear step-by-step engineering plans, trade-offs, exact files to inspect or change, " +
      "and verification commands before implementation."
    );
  }
  return (
    "You are 001Router AI Coding Assistant in Auto mode inside VS Code / Antigravity IDE. " +
    "Provide direct, production-ready code solutions, clear diffs/complete functions, and concise explanations. " +
    "Preserve existing conventions and cite exact file paths."
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
    this.catalog = { providers: [], combos: [], aliases: {} };
    this.connected = false;
    this.lastError = "";
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

  async syncStateToWebviews() {
    const [creds, sessionData] = await Promise.all([
      this.getStoredCredentials(),
      this.ensureActiveSession()
    ]);
    const selection = this.context.globalState.get(STATE_SELECTION) || null;
    const mode = this.context.globalState.get(STATE_MODE) || "auto";

    this.postToAll({
      type: "state",
      connected: this.connected && Boolean(creds.routerKey),
      serverUrl: creds.serverUrl,
      catalog: this.catalog,
      selection,
      mode,
      sessions: sessionData.sessions,
      activeSessionId: sessionData.activeId,
      lastError: this.lastError
    });
  }

  async refreshCatalogFromServer(silent = false) {
    const creds = await this.getStoredCredentials();
    if (!creds.serverUrl || !creds.routerKey) {
      this.connected = false;
      this.catalog = { providers: [], combos: [], aliases: {} };
      return false;
    }

    try {
      const resp = await fetch(`${creds.serverUrl}/v1/extension/catalog`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${creds.routerKey}`,
          Accept: "application/json"
        }
      });

      if (resp.status === 401 || resp.status === 403) {
        this.connected = false;
        this.lastError = "Phiên kết nối đã hết hạn hoặc key bị thu hồi. Vui lòng nhập lại mật khẩu web 001Router.";
        await this.context.secrets.delete(SECRET_ROUTER_KEY);
        return false;
      }

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.catalog) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${resp.status}`);
      }

      this.catalog = data.catalog;
      this.connected = true;
      this.lastError = "";
      await this.ensureValidSelection();
      return true;
    } catch (err) {
      this.connected = false;
      if (!silent) {
        this.lastError = `Không thể kết nối tới ${creds.serverUrl}: ${formatErrorMessage(err)}`;
      }
      return false;
    }
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
        const model =
          prov.models.find((m) => m.id === current.modelId) || prov.models[0];
        if (model) {
          const levels = model.effort?.effortLevels || [];
          const hasEffort = levels.some((l) => l.id === current.effort);
          const nextEffort = hasEffort
            ? current.effort
            : model.effort?.defaultEffort || levels[0]?.id || "medium";
          await this.context.globalState.update(STATE_SELECTION, {
            kind: "provider",
            providerSlug: prov.slug,
            providerName: prov.name,
            providerPreset: prov.preset,
            providerColor: prov.color,
            modelId: model.id,
            fullId: model.fullId,
            effort: nextEffort
          });
          return;
        }
      }
    }

    if (providers.length > 0) {
      const prov = providers[0];
      const model = prov.models[0];
      if (model) {
        await this.context.globalState.update(STATE_SELECTION, {
          kind: "provider",
          providerSlug: prov.slug,
          providerName: prov.name,
          providerPreset: prov.preset,
          providerColor: prov.color,
          modelId: model.id,
          fullId: model.fullId,
          effort: model.effort?.defaultEffort || "medium"
        });
      }
    } else if (combos.length > 0) {
      const combo = combos[0];
      await this.context.globalState.update(STATE_SELECTION, {
        kind: "combo",
        providerSlug: "combo",
        providerName: "Combo",
        providerPreset: "combo",
        providerColor: "#E56A4A",
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
          clientName: "001Router VS Code Extension"
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

      this.catalog = data.catalog || { providers: [], combos: [], aliases: {} };
      this.connected = true;
      this.lastError = "";
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
    this.lastError = "";
    await this.syncStateToWebviews();
  }

  async handlePickContext(kind, targetWebview) {
    if (kind === "activeFile" || kind === "selection") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("Chưa có tệp nào đang mở trong editor.");
        return;
      }
      const doc = editor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri, false) || path.basename(doc.fileName);
      const sel = editor.selection;
      let content = "";
      let rangeLabel = "";
      if (kind === "selection" && sel && !sel.isEmpty) {
        content = doc.getText(sel);
        rangeLabel = `L${sel.start.line + 1}-${sel.end.line + 1}`;
      } else {
        content = doc.getText();
      }
      if (content.length > MAX_ATTACHMENT_CHARS) {
        content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`;
      }
      targetWebview.postMessage({
        type: "attachedContext",
        item: {
          id: `${relPath}:${rangeLabel || "full"}:${Date.now()}`,
          label: rangeLabel ? `${relPath} (${rangeLabel})` : relPath,
          path: relPath,
          languageId: doc.languageId || "",
          content
        }
      });
      return;
    }

    if (kind === "workspaceFile") {
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
    const editor = vscode.window.activeTextEditor;
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

  async handleSendChat(payload) {
    const creds = await this.getStoredCredentials();
    if (!creds.routerKey) {
      this.connected = false;
      this.lastError = "Vui lòng nhập mật khẩu web 001Router để kết nối trước khi gửi yêu cầu.";
      await this.syncStateToWebviews();
      return;
    }

    const sessionId = payload.sessionId;
    const promptText = String(payload.text || "").trim();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const mode = payload.mode || this.context.globalState.get(STATE_MODE) || "auto";
    const selection = payload.selection || this.context.globalState.get(STATE_SELECTION);

    if (!promptText && attachments.length === 0) return;

    const modelTarget = selection?.fullId || selection?.modelId;
    if (!modelTarget) {
      this.postToAll({
        type: "streamError",
        sessionId,
        error: "Chưa chọn Provider & Model. Vui lòng chọn model ở thanh dưới cùng."
      });
      return;
    }

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

    const contextBlock = attachments
      .map((a) => `### File: ${a.path || a.label}\n\`\`\`${a.languageId || ""}\n${a.content || ""}\n\`\`\``)
      .join("\n\n");

    const llmUserContent = contextBlock
      ? `${contextBlock}\n\n${promptText}`
      : promptText;

    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      text: userDisplayText,
      attachments: attachments.map((a) => ({ label: a.label, path: a.path })),
      createdAt: new Date().toISOString()
    };

    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      reasoning: "",
      model: modelTarget,
      effort: selection?.effort || "medium",
      createdAt: new Date().toISOString()
    };

    // Build history before adding empty assistant placeholder
    const apiMessages = [
      { role: "system", content: buildSystemPrompt(mode) },
      ...session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-18)
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
      const bodyPayload = {
        model: modelTarget,
        messages: apiMessages,
        stream: true
      };
      if (selection?.effort) {
        bodyPayload.reasoning_effort = selection.effort;
      }

      const resp = await fetch(`${creds.serverUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.routerKey}`,
          "x-api-key": creds.routerKey
        },
        body: JSON.stringify(bodyPayload)
      });

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
      let contentAcc = "";
      let reasoningAcc = "";

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
            const chunkText = typeof delta.content === "string" ? delta.content : "";
            const chunkReason =
              typeof delta.reasoning_content === "string"
                ? delta.reasoning_content
                : typeof delta.reasoning === "string"
                  ? delta.reasoning
                  : "";

            if (chunkText || chunkReason) {
              contentAcc += chunkText;
              reasoningAcc += chunkReason;
              this.postToAll({
                type: "streamDelta",
                sessionId: session.id,
                messageId: assistantMsg.id,
                deltaText: chunkText,
                deltaReasoning: chunkReason
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

      // Update saved session with complete response
      const latestSessions = this.getSessions();
      const targetSession = latestSessions.find((s) => s.id === session.id);
      if (targetSession) {
        const targetMsg = targetSession.messages.find((m) => m.id === assistantMsg.id);
        if (targetMsg) {
          targetMsg.text = contentAcc || "(Không có phản hồi văn bản)";
          targetMsg.reasoning = reasoningAcc;
        }
        targetSession.updatedAt = new Date().toISOString();
        await this.saveSessions(latestSessions);
      }

      this.postToAll({
        type: "streamEnd",
        sessionId: session.id,
        messageId: assistantMsg.id
      });
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const messageText = isAbort ? "Đã dừng tạo phản hồi." : formatErrorMessage(err);
      const latestSessions = this.getSessions();
      const targetSession = latestSessions.find((s) => s.id === session.id);
      if (targetSession) {
        const targetMsg = targetSession.messages.find((m) => m.id === assistantMsg.id);
        if (targetMsg) {
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
    await this.refreshCatalogFromServer(true);
    await this.syncStateToWebviews();
  }

  bindWebviewMessages(webview) {
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ready": {
          await this.refreshCatalogFromServer(true);
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
        case "refreshCatalog": {
          await this.refreshCatalogFromServer(false);
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
          let sessions = this.getSessions().filter((s) => s.id !== msg.sessionId);
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
          await this.handlePickContext(msg.kind, webview);
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
<body data-surface="${surface}" data-logo-uri="${logoUri}" data-providers-uri="${providersUri}">
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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("001router.chatView", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("001router.openPanel", () => controller.openEditorTab()),
    vscode.commands.registerCommand("001router.newChat", () => controller.createNewChat()),
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
