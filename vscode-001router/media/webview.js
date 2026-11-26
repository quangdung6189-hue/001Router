(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const root = document.getElementById("app");
  const surface = document.body.dataset.surface || "sidebar";
  const logoUri = document.body.dataset.logoUri || "";

  const EFFORT_THEME = {
    low: { color: "#10B981", accent: "#06B6D4", glow: "rgba(16, 185, 129, 0.42)", badge: "ECO · 25%" },
    medium: { color: "#3B82F6", accent: "#6366F1", glow: "rgba(59, 130, 246, 0.48)", badge: "BALANCED · 50%" },
    high: { color: "#E56A4A", accent: "#F59E0B", glow: "rgba(229, 106, 74, 0.58)", badge: "HIGH POWER · 75%" },
    xhigh: { color: "#EC4899", accent: "#A855F7", glow: "rgba(236, 72, 153, 0.72)", badge: "OVERDRIVE · 100%" },
    max: { color: "#A855F7", accent: "#EC4899", glow: "rgba(168, 85, 247, 0.76)", badge: "MAX POWER · 100%" }
  };

  const SLASH_COMMANDS = [
    { cmd: "/provider", desc: "Mở bộ chọn Provider -> Model" },
    { cmd: "/effort", desc: "Chỉnh mức sức mạnh Effort cho model hiện tại" },
    { cmd: "/new", desc: "Bắt đầu cuộc trò chuyện mới" },
    { cmd: "/connect", desc: "Mở xác nhận mật khẩu web 001Router" },
    { cmd: "/refresh", desc: "Đồng bộ lại danh sách Provider & Model" }
  ];

  const state = {
    connected: false,
    serverUrl: "http://127.0.0.1:20128",
    catalog: { providers: [], combos: [], aliases: {} },
    selection: null,
    mode: "auto",
    sessions: [],
    activeSessionId: null,
    draft: "",
    attachments: [],
    streamingSessionId: null,
    authModalOpen: false,
    authServerInput: "http://127.0.0.1:20128",
    authPasswordInput: "",
    authShowPassword: false,
    authLoading: false,
    authError: "",
    lastError: "",
    // Popover states: null | 'model' | 'history' | 'attach' | 'slash' | 'mode'
    activePopover: null,
    // 2-step Model Popover: 'providers' | 'models'
    pickerStep: "providers",
    inspectingProviderSlug: null,
    providerSearch: "",
    modelSearch: "",
    copiedBlockId: null
  };

  function getActiveSession() {
    return state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0] || null;
  }

  function findSelectedProvider() {
    const providers = state.catalog?.providers || [];
    const slug = state.selection?.providerSlug;
    return providers.find((p) => p.slug === slug) || providers[0] || null;
  }

  function findSelectedModelObj() {
    if (state.selection?.kind === "combo") {
      return (state.catalog?.combos || []).find((c) => c.name === state.selection.modelId) || null;
    }
    const prov = findSelectedProvider();
    if (!prov) return null;
    return (
      prov.models.find((m) => m.id === state.selection?.modelId) || prov.models[0] || null
    );
  }

  function getActiveEffortProfile() {
    const modelObj = findSelectedModelObj();
    if (modelObj?.effort?.effortLevels?.length) {
      return modelObj.effort;
    }
    return {
      effortLevels: [
        { id: "low", label: "Low", shortLabel: "Low", power: 1, maxScale: 4, percent: 25, color: "#10B981", accent: "#06B6D4", glow: "rgba(16, 185, 129, 0.42)", description: "Fast response" },
        { id: "medium", label: "Medium", shortLabel: "Med", power: 2, maxScale: 4, percent: 50, color: "#3B82F6", accent: "#6366F1", glow: "rgba(59, 130, 246, 0.48)", description: "Balanced" },
        { id: "high", label: "High", shortLabel: "High", power: 3, maxScale: 4, percent: 75, color: "#E56A4A", accent: "#F59E0B", glow: "rgba(229, 106, 74, 0.58)", description: "Deep reasoning" }
      ],
      defaultEffort: "medium",
      maxEffort: "high",
      maxLabel: "High",
      maxPower: 3
    };
  }

  function getCurrentEffortStop() {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const targetId = state.selection?.effort || profile.defaultEffort;
    return stops.find((s) => s.id === targetId) || stops[Math.min(1, stops.length - 1)] || stops[0];
  }

  function applyEffortCssVars() {
    const stop = getCurrentEffortStop();
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;
    document.documentElement.style.setProperty("--effort-color", stop.color || theme.color);
    document.documentElement.style.setProperty("--effort-accent", stop.accent || theme.accent);
    document.documentElement.style.setProperty("--effort-glow", stop.glow || theme.glow);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdown(rawText, messageId) {
    const text = String(rawText || "");
    const parts = [];
    const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let blockIdx = 0;
    let match;

    const formatInline = (chunk) => {
      const escaped = escapeHtml(chunk)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br/>");
      return escaped ? `<p>${escaped}</p>` : "";
    };

    while ((match = fenceRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(formatInline(text.slice(lastIndex, match.index)));
      }
      const lang = match[1] || "code";
      const code = match[2];
      const blockKey = `${messageId}:${blockIdx++}`;
      const copied = state.copiedBlockId === blockKey;
      parts.push(
        `<div class="r001-codeblock">` +
          `<div class="r001-codeblock-head">` +
            `<span>${escapeHtml(lang)}</span>` +
            `<div class="r001-codeblock-actions">` +
              `<button class="r001-mini-btn" data-action="copy-code" data-block="${escapeHtml(blockKey)}">${copied ? "Copied" : "Copy"}</button>` +
              `<button class="r001-mini-btn" data-action="apply-code" data-block="${escapeHtml(blockKey)}">Apply</button>` +
            `</div>` +
          `</div>` +
          `<pre>${escapeHtml(code)}</pre>` +
        `</div>`
      );
      codeBlockCache.set(blockKey, code);
      lastIndex = fenceRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(formatInline(text.slice(lastIndex)));
    }

    return parts.join("") || "<p>...</p>";
  }

  const codeBlockCache = new Map();

  function renderMascotSvg() {
    return `<svg class="r001-mascot" viewBox="0 0 64 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="44" height="24" rx="2" fill="#E56A4A"/>
      <rect x="4" y="18" width="6" height="10" fill="#E56A4A"/>
      <rect x="54" y="18" width="6" height="10" fill="#E56A4A"/>
      <rect x="18" y="17" width="6" height="7" fill="#1E1E1E"/>
      <rect x="40" y="17" width="6" height="7" fill="#1E1E1E"/>
      <rect x="12" y="34" width="6" height="10" fill="#E56A4A"/>
      <rect x="22" y="34" width="6" height="10" fill="#E56A4A"/>
      <rect x="36" y="34" width="6" height="10" fill="#E56A4A"/>
      <rect x="46" y="34" width="6" height="10" fill="#E56A4A"/>
      <circle cx="32" cy="6" r="3" fill="#F59E0B"/>
      <rect x="30.5" y="7" width="3" height="4" fill="#F59E0B"/>
    </svg>`;
  }

  function renderEffortBar() {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const stop = getCurrentEffortStop();
    const idx = Math.max(0, stops.findIndex((s) => s.id === stop.id));
    const maxIdx = Math.max(1, stops.length - 1);
    const fillPct = stops.length === 1 ? 100 : Math.round(((idx + 0.12) / (stops.length - 1 + 0.12)) * 100);
    const thumbLeftPct = stops.length === 1 ? 50 : Math.round(12 + (idx / maxIdx) * 76);
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;
    const provName = state.selection?.providerName || "Provider";
    const modelId = state.selection?.modelId || "Model";

    return `
      <div class="r001-effort-bar" data-power="${stop.power}" data-effort="${stop.id}">
        <div class="r001-effort-top">
          <div class="r001-effort-label-wrap">
            <span class="r001-effort-title">Effort (<span class="r001-effort-level-name">${escapeHtml(stop.label)}</span>)</span>
            <span class="r001-effort-power-tag">${escapeHtml(theme.badge)}</span>
          </div>
          <div class="r001-effort-track" id="r001-effort-track" role="slider" aria-valuemin="1" aria-valuemax="${stops.length}" aria-valuenow="${idx + 1}" title="Kéo hoặc bấm để tăng/giảm mức Effort">
            <div class="r001-effort-fill" style="width:${Math.max(22, fillPct)}%"></div>
            <div class="r001-effort-dots">
              ${stops
                .map(
                  (s, i) => `
                  <button type="button" class="r001-effort-dot-btn ${i <= idx ? "passed" : ""}" data-action="set-effort" data-effort-id="${escapeHtml(s.id)}" title="${escapeHtml(s.label)} — ${escapeHtml(s.description)}">
                    <span class="r001-effort-dot"></span>
                  </button>`
                )
                .join("")}
            </div>
            <div class="r001-effort-thumb" style="left:${thumbLeftPct}%"></div>
          </div>
        </div>
        <div class="r001-effort-sub">
          <span>${escapeHtml(stop.description)}</span>
          <span>Max: <strong>${escapeHtml(profile.maxLabel)}</strong> (${escapeHtml(provName)} / ${escapeHtml(modelId)})</span>
        </div>
      </div>
    `;
  }

  function renderModelPopover() {
    const providers = state.catalog?.providers || [];
    const combos = state.catalog?.combos || [];
    const activeSlug = state.inspectingProviderSlug || state.selection?.providerSlug || providers[0]?.slug;

    if (state.pickerStep === "providers") {
      const q = state.providerSearch.trim().toLowerCase();
      const filteredProviders = providers.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q)
      );
      const filteredCombos = combos.filter(
        (c) => !q || c.name.toLowerCase().includes(q)
      );

      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Chọn Provider kết nối (Bước 1 / 2)</span>
            <button type="button" class="r001-back-btn" data-action="refresh-catalog" title="Đồng bộ lại danh sách provider">↻ Đồng bộ</button>
          </div>
          <input type="text" class="r001-search" id="r001-provider-search" placeholder="Tìm nhà cung cấp (OpenAI, Anthropic, Antigravity...)" value="${escapeHtml(state.providerSearch)}" />
          <div class="r001-popover-list">
            <div class="r001-section-label">Connected Providers (${filteredProviders.length})</div>
            ${
              filteredProviders.length === 0
                ? `<div style="padding:16px;text-align:center;color:var(--text-secondary)">Chưa có provider nào khả dụng trên 001Router.</div>`
                : filteredProviders
                    .map((p) => {
                      const isCurrent = state.selection?.kind !== "combo" && state.selection?.providerSlug === p.slug;
                      const connLabel = p.connectedCount > 0 ? `${p.connectedCount} Connected` : `${p.totalKeys} Keys`;
                      return `
                        <button type="button" class="r001-prov-item ${isCurrent ? "selected" : ""}" data-action="open-provider" data-slug="${escapeHtml(p.slug)}">
                          <div class="r001-prov-left">
                            <span class="r001-prov-badge" style="background:${escapeHtml(p.color || "#E56A4A")}">${escapeHtml(p.monogram || p.slug.slice(0, 2).toUpperCase())}</span>
                            <div style="min-width:0">
                              <div class="r001-prov-name">${escapeHtml(p.name)}</div>
                              <div class="r001-prov-sub">${escapeHtml(connLabel)} · ${p.modelCount} models</div>
                            </div>
                          </div>
                          <div class="r001-prov-right">
                            ${isCurrent ? `<span style="color:#38bdf8;font-weight:700">✓</span>` : ""}
                            <span>›</span>
                          </div>
                        </button>`;
                    })
                    .join("")
            }
            ${
              filteredCombos.length > 0
                ? `<div class="r001-section-label">Smart Combos (${filteredCombos.length})</div>` +
                  filteredCombos
                    .map((c) => {
                      const isCurrent = state.selection?.kind === "combo" && state.selection?.modelId === c.name;
                      return `
                        <button type="button" class="r001-model-item ${isCurrent ? "selected" : ""}" data-action="select-combo" data-combo="${escapeHtml(c.name)}">
                          <div>
                            <div class="r001-model-name">${escapeHtml(c.name)}</div>
                            <div class="r001-model-desc">${escapeHtml(c.description)}</div>
                          </div>
                          ${isCurrent ? `<span>✓</span>` : ""}
                        </button>`;
                    })
                    .join("")
                : ""
            }
          </div>
          ${renderEffortBar()}
        </div>
      `;
    }

    // Step 2: Models for the chosen provider (cloning Image 3)
    const provider = providers.find((p) => p.slug === activeSlug) || providers[0];
    const q = state.modelSearch.trim().toLowerCase();
    const models = (provider?.models || []).filter(
      (m) =>
        !q ||
        m.id.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
    const defaultModel = provider?.models?.[0];

    return `
      <div class="r001-popover" id="r001-popover">
        <div class="r001-popover-head">
          <div class="r001-popover-title">
            <button type="button" class="r001-back-btn" data-action="back-providers">← Providers</button>
            <span style="color:#f4f4f5;font-weight:600">${escapeHtml(provider?.name || "Select a model")}</span>
          </div>
          <span style="font-size:11px;color:var(--text-muted)">${models.length} models</span>
        </div>
        <input type="text" class="r001-search" id="r001-model-search" placeholder="Lọc model trong ${escapeHtml(provider?.name || "")}..." value="${escapeHtml(state.modelSearch)}" />
        <div class="r001-popover-list">
          ${
            defaultModel && !q
              ? `<button type="button" class="r001-model-item ${state.selection?.providerSlug === provider.slug && state.selection?.modelId === defaultModel.id ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(defaultModel.id)}">
                  <div>
                    <div class="r001-model-name">Default (recommended)</div>
                    <div class="r001-model-desc">${escapeHtml(defaultModel.id)} · Best everyday choice</div>
                  </div>
                  ${state.selection?.providerSlug === provider.slug && state.selection?.modelId === defaultModel.id ? `<span>✓</span>` : ""}
                </button>`
              : ""
          }
          ${models
            .map((m) => {
              const isSelected =
                state.selection?.kind !== "combo" &&
                state.selection?.providerSlug === provider.slug &&
                state.selection?.modelId === m.id;
              return `
                <button type="button" class="r001-model-item ${isSelected ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(m.id)}">
                  <div style="min-width:0">
                    <div class="r001-model-title-row">
                      <span class="r001-model-name">${escapeHtml(m.label)}</span>
                      <span class="r001-cap-tag">Max ${escapeHtml(m.effort?.maxLabel || "High")}</span>
                      ${m.reasoning ? `<span class="r001-cap-tag">Thinking</span>` : ""}
                    </div>
                    <div class="r001-model-desc">${escapeHtml(m.description)}</div>
                  </div>
                  ${isSelected ? `<span style="font-size:15px;font-weight:700">✓</span>` : ""}
                </button>`;
            })
            .join("")}
        </div>
        ${renderEffortBar()}
      </div>
    `;
  }

  function renderSecondaryPopover() {
    if (state.activePopover === "history") {
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Lịch sử hội thoại (${state.sessions.length})</span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            ${state.sessions
              .map(
                (s) => `
                <div class="r001-model-item ${s.id === state.activeSessionId ? "selected" : ""}" style="justify-content:space-between">
                  <button type="button" data-action="select-session" data-id="${escapeHtml(s.id)}" style="flex:1;border:none;background:transparent;color:inherit;text-align:left;cursor:pointer">
                    <div class="r001-model-name">${s.bookmarked ? "★ " : ""}${escapeHtml(s.title || "Untitled")}</div>
                    <div class="r001-model-desc">${(s.messages || []).length} tin nhắn</div>
                  </button>
                  <button type="button" class="r001-mini-btn" data-action="delete-session" data-id="${escapeHtml(s.id)}">Xoá</button>
                </div>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "attach") {
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:220px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Đính kèm ngữ cảnh mã nguồn</span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="activeFile">
              <div><div class="r001-model-name">📄 Tệp đang mở (Active Editor)</div><div class="r001-model-desc">Đưa toàn bộ file đang mở vào prompt</div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="selection">
              <div><div class="r001-model-name">✂️ Đoạn code đang chọn (Selection)</div><div class="r001-model-desc">Chỉ đính kèm vùng dòng đang bôi đen</div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="workspaceFile">
              <div><div class="r001-model-name">🗂️ Chọn tệp từ Workspace...</div><div class="r001-model-desc">Tìm kiếm bất kỳ file nào trong dự án</div></div>
            </button>
          </div>
        </div>
      `;
    }

    if (state.activePopover === "slash") {
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:240px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Lệnh nhanh (Slash Commands)</span>
          </div>
          <div class="r001-popover-list">
            ${SLASH_COMMANDS.map(
              (c) => `
              <button type="button" class="r001-model-item" data-action="run-slash" data-cmd="${escapeHtml(c.cmd)}">
                <div><div class="r001-model-name">${escapeHtml(c.cmd)}</div><div class="r001-model-desc">${escapeHtml(c.desc)}</div></div>
              </button>`
            ).join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "mode") {
      const modes = [
        { id: "auto", label: "⚡ Auto", desc: "Tự động phân tích & đề xuất chỉnh sửa code trực tiếp" },
        { id: "ask", label: "💬 Ask", desc: "Hỏi đáp nhanh, giải thích code và debug" },
        { id: "plan", label: "🧭 Plan", desc: "Lập kế hoạch kiến trúc từng bước trước khi viết code" }
      ];
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:220px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Chế độ làm việc</span>
          </div>
          <div class="r001-popover-list">
            ${modes
              .map(
                (m) => `
              <button type="button" class="r001-model-item ${state.mode === m.id ? "selected" : ""}" data-action="set-mode" data-mode="${escapeHtml(m.id)}">
                <div><div class="r001-model-name">${escapeHtml(m.label)}</div><div class="r001-model-desc">${escapeHtml(m.desc)}</div></div>
                ${state.mode === m.id ? `<span>✓</span>` : ""}
              </button>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    return "";
  }

  function renderAuthOverlay() {
    if (!state.authModalOpen && state.connected) return "";
    const hasConnected = state.connected;
    return `
      <div class="r001-auth-backdrop" id="r001-auth-backdrop">
        <form class="r001-auth-card" id="r001-auth-form">
          <div class="r001-auth-head">
            <img src="${escapeHtml(logoUri)}" alt="001Router" />
            <div>
              <div class="r001-auth-title">Kết nối Web 001Router</div>
              <div class="r001-auth-desc">Nhập URL & mật khẩu trang quản trị 001Router để xác nhận quyền truy cập.</div>
            </div>
          </div>

          <div class="r001-field">
            <label for="r001-auth-url">001Router Web URL</label>
            <input id="r001-auth-url" class="r001-input" type="text" placeholder="http://127.0.0.1:20128 hoặc https://your-001router.vercel.app" value="${escapeHtml(state.authServerInput)}" required />
          </div>

          <div class="r001-field">
            <label for="r001-auth-pw">Mật khẩu Web 001Router</label>
            <div class="r001-input-wrap">
              <input id="r001-auth-pw" class="r001-input" type="${state.authShowPassword ? "text" : "password"}" placeholder="Nhập mật khẩu đăng nhập web 001Router..." value="${escapeHtml(state.authPasswordInput)}" required style="padding-right:34px" />
              <button type="button" class="r001-eye-btn" data-action="toggle-pw" title="Hiện/Ẩn mật khẩu">${state.authShowPassword ? "🙈" : "👁"}</button>
            </div>
          </div>

          ${
            state.authError || state.lastError
              ? `<div class="r001-error-banner">${escapeHtml(state.authError || state.lastError)}</div>`
              : ""
          }

          <button type="submit" class="r001-primary-btn" ${state.authLoading ? "disabled" : ""}>
            ${state.authLoading ? "Đang xác thực mật khẩu..." : "Xác nhận & Kết nối 001Router"}
          </button>

          ${
            hasConnected
              ? `<button type="button" class="r001-secondary-btn" data-action="disconnect" style="color:#fca5a5">Ngắt kết nối thiết bị này</button>
                 <button type="button" class="r001-secondary-btn" data-action="close-auth">Đóng</button>`
              : ""
          }
        </form>
      </div>
    `;
  }

  function render() {
    applyEffortCssVars();
    codeBlockCache.clear();

    const activeSession = getActiveSession();
    const messages = activeSession?.messages || [];
    const stop = getCurrentEffortStop();
    const pillProvider = state.selection?.providerName || "Select Provider";
    const pillModel = state.selection?.modelId || "Choose Model";
    const modeLabel = state.mode === "ask" ? "Ask" : state.mode === "plan" ? "Plan" : "Auto";
    const isStreaming = Boolean(state.streamingSessionId && state.streamingSessionId === activeSession?.id);
    const totalModels = (state.catalog?.providers || []).reduce((acc, p) => acc + (p.modelCount || 0), 0);

    const textareaEl = document.getElementById("r001-input");
    const selectionStart = textareaEl ? textareaEl.selectionStart : null;
    const selectionEnd = textareaEl ? textareaEl.selectionEnd : null;
    const hadFocus = document.activeElement && document.activeElement.id === "r001-input";

    root.innerHTML = `
      <div class="r001-shell">
        <header class="r001-topbar">
          <div class="r001-topbar-left">
            <span class="r001-session-title">${escapeHtml(activeSession?.title || "Untitled")}</span>
            <button type="button" class="r001-conn-pill ${state.connected ? "connected" : ""}" data-action="open-auth" title="Trạng thái xác thực web 001Router">
              <span class="r001-conn-dot"></span>
              <span>${state.connected ? "Connected" : "Locked"}</span>
            </button>
          </div>
          <div class="r001-topbar-actions">
            ${
              surface === "sidebar"
                ? `<button type="button" class="r001-icon-btn" data-action="open-tab" title="Mở thành Tab toàn màn hình (giống Claude Code)">⤢</button>`
                : ""
            }
            <button type="button" class="r001-icon-btn ${activeSession?.bookmarked ? "active" : ""}" data-action="toggle-bookmark" title="Đánh dấu hội thoại">★</button>
            <button type="button" class="r001-icon-btn" data-action="toggle-popover" data-popover="history" title="Lịch sử hội thoại">🕒</button>
            <button type="button" class="r001-icon-btn" data-action="new-chat" title="Cuộc trò chuyện mới">💬+</button>
          </div>
        </header>

        <main class="r001-main" id="r001-scroll">
          ${
            messages.length === 0
              ? `
              <div class="r001-hero">
                <div class="r001-hero-brand">
                  <img class="r001-hero-logo" src="${escapeHtml(logoUri)}" alt="001Router Logo" />
                  <span class="r001-hero-title">001Router</span>
                </div>
                <div class="r001-hero-center">
                  ${renderMascotSvg()}
                  <div class="r001-hero-subtitle">You've come to the absolutely right place!</div>
                  <div class="r001-hero-meta">
                    <span>${(state.catalog?.providers || []).length} providers</span>
                    <span>·</span>
                    <span>${totalModels} models</span>
                    <span>·</span>
                    <span>Effort: <strong style="color:var(--effort-color)">${escapeHtml(stop.label)}</strong></span>
                  </div>
                </div>
                <div></div>
              </div>
            `
              : `
              <div class="r001-messages">
                ${messages
                  .map((m) => {
                    if (m.role === "user") {
                      return `
                        <div class="r001-msg r001-msg-user">
                          ${
                            Array.isArray(m.attachments) && m.attachments.length
                              ? `<div class="r001-msg-attachments">${m.attachments
                                  .map((a) => `<span class="r001-chip">📄 ${escapeHtml(a.label || a.path)}</span>`)
                                  .join("")}</div>`
                              : ""
                          }
                          <div>${escapeHtml(m.text)}</div>
                        </div>`;
                    }
                    return `
                      <div class="r001-msg r001-msg-assistant">
                        <div class="r001-msg-header">
                          <img src="${escapeHtml(logoUri)}" style="width:15px;height:15px;border-radius:4px" alt="001" />
                          <strong style="color:var(--text-primary)">${escapeHtml(m.model || "001Router")}</strong>
                          <span class="r001-effort-badge">${escapeHtml((m.effort || "medium").toUpperCase())}</span>
                        </div>
                        ${
                          m.reasoning
                            ? `<details class="r001-reasoning"><summary>Thinking process (${m.reasoning.length} chars)</summary><div class="r001-reasoning-body">${escapeHtml(m.reasoning)}</div></details>`
                            : ""
                        }
                        <div class="r001-markdown">${renderMarkdown(m.text, m.id)}</div>
                        ${m.error ? `<div class="r001-error-banner">${escapeHtml(m.error)}</div>` : ""}
                      </div>`;
                  })
                  .join("")}
              </div>
            `
          }
        </main>

        <footer class="r001-dock">
          ${state.activePopover === "model" ? renderModelPopover() : renderSecondaryPopover()}
          <div class="r001-composer" data-power="${stop.power}">
            ${
              state.attachments.length
                ? `<div class="r001-composer-chips">
                    ${state.attachments
                      .map(
                        (a) => `<span class="r001-chip">📄 ${escapeHtml(a.label)} <button type="button" data-action="remove-attach" data-id="${escapeHtml(a.id)}">×</button></span>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
            <textarea id="r001-input" class="r001-textarea" rows="1" placeholder="ctrl esc to focus or unfocus 001Router">${escapeHtml(state.draft)}</textarea>
            <div class="r001-toolbar">
              <div class="r001-toolbar-left">
                <button type="button" class="r001-tool-btn" data-action="toggle-popover" data-popover="attach" title="Đính kèm file / code">+</button>
                <button type="button" class="r001-tool-btn" data-action="toggle-popover" data-popover="slash" title="Lệnh nhanh /">/</button>
                <button type="button" class="r001-model-pill" data-action="open-model-picker" title="Bước 1: Chọn Provider · Bước 2: Chọn Model · Chỉnh Effort">
                  <span class="r001-model-pill-dot"></span>
                  <span class="r001-model-pill-name">${escapeHtml(pillProvider)} · ${escapeHtml(pillModel)}</span>
                  <span class="r001-model-pill-effort">${escapeHtml(stop.label)}</span>
                </button>
              </div>
              <div class="r001-toolbar-right">
                <button type="button" class="r001-mode-btn" data-action="toggle-popover" data-popover="mode" title="Chế độ thực thi">
                  <span>⚡</span>
                  <span>${escapeHtml(modeLabel)}</span>
                </button>
                ${
                  isStreaming
                    ? `<button type="button" class="r001-send-btn streaming" data-action="abort-chat" title="Dừng phản hồi">■</button>`
                    : `<button type="button" class="r001-send-btn" id="r001-send-btn" data-action="send-chat" title="Gửi (Enter)">↑</button>`
                }
              </div>
            </div>
          </div>
        </footer>

        ${renderAuthOverlay()}
      </div>
    `;

    bindDynamicListeners(hadFocus, selectionStart, selectionEnd);
    const scrollEl = document.getElementById("r001-scroll");
    if (scrollEl && messages.length > 0) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function updateEffort(effortId) {
    const profile = getActiveEffortProfile();
    const stop = profile.effortLevels.find((s) => s.id === effortId);
    if (!stop) return;
    if (!state.selection) return;
    state.selection = { ...state.selection, effort: stop.id };
    vscode.postMessage({ type: "saveSelection", selection: state.selection });
    render();
  }

  function submitChat() {
    if (!state.connected) {
      state.authModalOpen = true;
      render();
      return;
    }
    const text = state.draft.trim();
    if (!text && state.attachments.length === 0) return;

    const session = getActiveSession();
    const attachments = [...state.attachments];
    state.draft = "";
    state.attachments = [];
    state.activePopover = null;
    state.streamingSessionId = session?.id || "pending";

    vscode.postMessage({
      type: "sendChat",
      sessionId: session?.id,
      text,
      attachments,
      mode: state.mode,
      selection: state.selection
    });
    render();
  }

  function bindDynamicListeners(hadFocus, selectionStart, selectionEnd) {
    const input = document.getElementById("r001-input");
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(150, Math.max(30, input.scrollHeight))}px`;
      if (hadFocus && !state.authModalOpen) {
        input.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          input.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      input.addEventListener("input", (e) => {
        state.draft = e.target.value;
        e.target.style.height = "auto";
        e.target.style.height = `${Math.min(150, Math.max(30, e.target.scrollHeight))}px`;
        if (state.draft === "/") {
          state.activePopover = "slash";
          render();
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitChat();
        }
      });
    }

    const authForm = document.getElementById("r001-auth-form");
    if (authForm) {
      authForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const urlEl = document.getElementById("r001-auth-url");
        const pwEl = document.getElementById("r001-auth-pw");
        state.authServerInput = urlEl ? urlEl.value : state.authServerInput;
        state.authPasswordInput = pwEl ? pwEl.value : state.authPasswordInput;
        state.authLoading = true;
        state.authError = "";
        render();
        vscode.postMessage({
          type: "connect",
          serverUrl: state.authServerInput,
          password: state.authPasswordInput
        });
      });
    }

    const urlInput = document.getElementById("r001-auth-url");
    if (urlInput) {
      urlInput.addEventListener("input", (e) => {
        state.authServerInput = e.target.value;
      });
    }

    const pwInput = document.getElementById("r001-auth-pw");
    if (pwInput) {
      pwInput.addEventListener("input", (e) => {
        state.authPasswordInput = e.target.value;
      });
    }

    const provSearch = document.getElementById("r001-provider-search");
    if (provSearch) {
      provSearch.addEventListener("input", (e) => {
        state.providerSearch = e.target.value;
        render();
        const next = document.getElementById("r001-provider-search");
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    }

    const modelSearch = document.getElementById("r001-model-search");
    if (modelSearch) {
      modelSearch.addEventListener("input", (e) => {
        state.modelSearch = e.target.value;
        render();
        const next = document.getElementById("r001-model-search");
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    }

    // Effort slider smooth pointer drag
    const track = document.getElementById("r001-effort-track");
    if (track) {
      const pickFromClientX = (clientX) => {
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        const stops = getActiveEffortProfile().effortLevels;
        const idx = Math.min(stops.length - 1, Math.max(0, Math.round(ratio * (stops.length - 1))));
        const picked = stops[idx];
        if (picked && picked.id !== state.selection?.effort) {
          updateEffort(picked.id);
        }
      };

      let dragging = false;
      track.addEventListener("pointerdown", (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        pickFromClientX(e.clientX);
      });
      track.addEventListener("pointermove", (e) => {
        if (dragging) pickFromClientX(e.clientX);
      });
      track.addEventListener("pointerup", () => {
        dragging = false;
      });
      track.addEventListener("pointercancel", () => {
        dragging = false;
      });
    }
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) {
      if (state.activePopover && !e.target.closest("#r001-popover") && !e.target.closest(".r001-toolbar")) {
        state.activePopover = null;
        render();
      }
      return;
    }

    const action = btn.dataset.action;
    switch (action) {
      case "open-auth":
        state.authModalOpen = true;
        state.authError = "";
        render();
        break;
      case "close-auth":
        state.authModalOpen = false;
        render();
        break;
      case "toggle-pw":
        state.authShowPassword = !state.authShowPassword;
        render();
        break;
      case "disconnect":
        state.authPasswordInput = "";
        state.authModalOpen = true;
        vscode.postMessage({ type: "disconnect" });
        break;
      case "open-tab":
        vscode.postMessage({ type: "openExternalPanel" });
        break;
      case "new-chat":
        state.activePopover = null;
        vscode.postMessage({ type: "newChat" });
        break;
      case "toggle-bookmark": {
        const s = getActiveSession();
        if (s) vscode.postMessage({ type: "toggleBookmark", sessionId: s.id });
        break;
      }
      case "toggle-popover": {
        const target = btn.dataset.popover;
        state.activePopover = state.activePopover === target ? null : target;
        render();
        break;
      }
      case "close-popover":
        state.activePopover = null;
        render();
        break;
      case "open-model-picker":
        if (state.activePopover === "model") {
          state.activePopover = null;
        } else {
          state.activePopover = "model";
          state.pickerStep = "providers";
          state.providerSearch = "";
          state.modelSearch = "";
        }
        render();
        break;
      case "open-provider":
        state.inspectingProviderSlug = btn.dataset.slug;
        state.pickerStep = "models";
        state.modelSearch = "";
        render();
        break;
      case "back-providers":
        state.pickerStep = "providers";
        render();
        break;
      case "select-model": {
        const slug = btn.dataset.slug;
        const modelId = btn.dataset.model;
        const prov = (state.catalog?.providers || []).find((p) => p.slug === slug);
        const mod = prov?.models?.find((m) => m.id === modelId);
        if (prov && mod) {
          const levels = mod.effort?.effortLevels || [];
          const prevEffort = state.selection?.effort;
          const keepEffort = levels.some((l) => l.id === prevEffort)
            ? prevEffort
            : mod.effort?.defaultEffort || levels[0]?.id || "medium";
          state.selection = {
            kind: "provider",
            providerSlug: prov.slug,
            providerName: prov.name,
            providerPreset: prov.preset,
            providerColor: prov.color,
            modelId: mod.id,
            fullId: mod.fullId,
            effort: keepEffort
          };
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
          render();
        }
        break;
      }
      case "select-combo": {
        const comboName = btn.dataset.combo;
        const combo = (state.catalog?.combos || []).find((c) => c.name === comboName);
        if (combo) {
          state.selection = {
            kind: "combo",
            providerSlug: "combo",
            providerName: "Combo",
            providerPreset: "combo",
            providerColor: "#E56A4A",
            modelId: combo.name,
            fullId: combo.name,
            effort: combo.effort?.defaultEffort || "medium"
          };
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
          state.activePopover = null;
          render();
        }
        break;
      }
      case "set-effort":
        updateEffort(btn.dataset.effortId);
        break;
      case "refresh-catalog":
        vscode.postMessage({ type: "refreshCatalog" });
        break;
      case "select-session":
        state.activePopover = null;
        vscode.postMessage({ type: "selectSession", sessionId: btn.dataset.id });
        break;
      case "delete-session":
        vscode.postMessage({ type: "deleteSession", sessionId: btn.dataset.id });
        break;
      case "attach-ctx":
        state.activePopover = null;
        render();
        vscode.postMessage({ type: "pickContext", kind: btn.dataset.kind });
        break;
      case "remove-attach":
        state.attachments = state.attachments.filter((a) => a.id !== btn.dataset.id);
        render();
        break;
      case "set-mode":
        state.mode = btn.dataset.mode || "auto";
        state.activePopover = null;
        vscode.postMessage({ type: "saveMode", mode: state.mode });
        render();
        break;
      case "run-slash": {
        const cmd = btn.dataset.cmd;
        state.activePopover = null;
        state.draft = "";
        if (cmd === "/provider") {
          state.activePopover = "model";
          state.pickerStep = "providers";
        } else if (cmd === "/effort") {
          state.activePopover = "model";
          state.pickerStep = "models";
        } else if (cmd === "/new") {
          vscode.postMessage({ type: "newChat" });
        } else if (cmd === "/connect") {
          state.authModalOpen = true;
        } else if (cmd === "/refresh") {
          vscode.postMessage({ type: "refreshCatalog" });
        }
        render();
        break;
      }
      case "send-chat":
        submitChat();
        break;
      case "abort-chat":
        vscode.postMessage({ type: "abortChat" });
        break;
      case "copy-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) {
          navigator.clipboard?.writeText(code);
          state.copiedBlockId = btn.dataset.block;
          render();
          setTimeout(() => {
            if (state.copiedBlockId === btn.dataset.block) {
              state.copiedBlockId = null;
              render();
            }
          }, 1500);
        }
        break;
      }
      case "apply-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) {
          vscode.postMessage({ type: "applyCode", code });
        }
        break;
      }
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "state":
        state.connected = Boolean(msg.connected);
        state.serverUrl = msg.serverUrl || state.serverUrl;
        if (!state.authModalOpen) {
          state.authServerInput = state.serverUrl;
        }
        state.catalog = msg.catalog || state.catalog;
        state.selection = msg.selection || state.selection;
        state.mode = msg.mode || state.mode;
        state.sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
        state.activeSessionId = msg.activeSessionId || state.sessions[0]?.id || null;
        state.lastError = msg.lastError || "";
        if (!state.connected) {
          state.authModalOpen = true;
        }
        render();
        break;

      case "connectResult":
        state.authLoading = false;
        if (msg.ok) {
          state.authError = "";
          state.authPasswordInput = "";
          state.authModalOpen = false;
          state.connected = true;
        } else {
          state.authError = msg.error || "Đăng nhập thất bại";
        }
        render();
        break;

      case "selectionUpdated":
        state.selection = msg.selection;
        render();
        break;

      case "modeUpdated":
        state.mode = msg.mode;
        render();
        break;

      case "attachedContext":
        if (msg.item) {
          state.attachments.push(msg.item);
          render();
        }
        break;

      case "streamStart": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        if (sess) {
          sess.title = msg.sessionTitle || sess.title;
          sess.messages.push(msg.userMessage, msg.assistantMessage);
        }
        state.activeSessionId = msg.sessionId;
        state.streamingSessionId = msg.sessionId;
        render();
        break;
      }

      case "streamDelta": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        if (target) {
          target.text = (target.text || "") + (msg.deltaText || "");
          target.reasoning = (target.reasoning || "") + (msg.deltaReasoning || "");
          render();
        }
        break;
      }

      case "streamError": {
        state.streamingSessionId = null;
        state.lastError = msg.error || "Có lỗi xảy ra khi gửi yêu cầu.";
        const sess = state.sessions.find((s) => s.id === (msg.sessionId || state.activeSessionId));
        if (sess) {
          sess.messages.push({
            id: `err-${Date.now()}`,
            role: "assistant",
            text: "",
            model: state.selection?.fullId || "001Router",
            effort: state.selection?.effort || "medium",
            error: state.lastError
          });
        }
        render();
        break;
      }

      case "streamEnd": {
        if (msg.error) {
          const sess = state.sessions.find((s) => s.id === msg.sessionId);
          const target = sess?.messages?.find((m) => m.id === msg.messageId);
          if (target) target.error = msg.error;
        }
        state.streamingSessionId = null;
        render();
        break;
      }

      case "focusInput": {
        const el = document.getElementById("r001-input");
        if (el) {
          if (document.activeElement === el) el.blur();
          else el.focus();
        }
        break;
      }

      case "openAuthModal":
        state.authModalOpen = true;
        render();
        break;
    }
  });

  render();
  vscode.postMessage({ type: "ready" });
})();
