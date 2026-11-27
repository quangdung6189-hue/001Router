(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const root = document.getElementById("app");
  const surface = document.body.dataset.surface || "sidebar";
  const providersBaseUri = (document.body.dataset.providersUri || "").replace(/\/+$/, "");

  const REDUCED_MOTION_MQ = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  const SHELL_LANGS = new Set([
    "bash", "sh", "zsh", "shell", "console", "powershell", "ps1", "pwsh", "cmd", "bat"
  ]);

  const ICONS = {
    brandPrism:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"/><polyline points="3.5 7.5 12 12.2 20.5 7.5"/><line x1="12" y1="22" x2="12" y2="12.2"/></svg>',
    popout:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
    bookmark:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    bookmarkFilled:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    history:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><polyline points="12 7.5 12 12 15.2 13.8"/></svg>',
    newChat:
      '<svg class="r001-svg" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    plus:
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    slash:
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="15.5" y1="4" x2="8.5" y2="20"/></svg>',
    bolt:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/></svg>',
    shield:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    sliders:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2" fill="currentColor"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.2" fill="currentColor"/></svg>',
    arrowUp:
      '<svg class="r001-svg" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>',
    stop:
      '<svg class="r001-svg" aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
    back:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 18 5 12 11 6"/></svg>',
    refresh:
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    check:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    x:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevronRight:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    file:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    edit:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    trash:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    globe:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>',
    git:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>',
    scissors:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    folder:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    folderTree:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="5" rx="1.2"/><rect x="14" y="10" width="7" height="4.5" rx="1.2"/><rect x="14" y="17" width="7" height="4.5" rx="1.2"/><path d="M6 8v11h8"/><line x1="6" y1="12.2" x2="14" y2="12.2"/></svg>',
    search:
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/></svg>',
    eye:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    eyeOff:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19.5c-7 0-11-7.5-11-7.5a18.45 18.45 0 0 1 5.06-5.5"/><path d="M9.9 4.7A9.12 9.12 0 0 1 12 4.5c7 0 11 7.5 11 7.5a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
    copy:
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    apply:
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
    terminal:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    brain:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.6"/><circle cx="5.5" cy="7.5" r="2"/><circle cx="18.5" cy="7.5" r="2"/><circle cx="5.5" cy="16.5" r="2"/><circle cx="18.5" cy="16.5" r="2"/><line x1="7.2" y1="8.7" x2="9.8" y2="10.6"/><line x1="16.8" y1="8.7" x2="14.2" y2="10.6"/><line x1="7.2" y1="15.3" x2="9.8" y2="13.4"/><line x1="16.8" y1="15.3" x2="14.2" y2="13.4"/></svg>',
    listChecks:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 5 9 8 5"/><line x1="11" y1="7" x2="21" y2="7"/><polyline points="3 17 5 19 8 15"/><line x1="11" y1="17" x2="21" y2="17"/></svg>',
    blueprint:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>'
  };

  const LIGHT_PLATE_FILES = new Set([
    "xai.png", "openai.png", "deepseek.png", "gemini.png", "antigravity.png", "gemini-cli.png",
    "openrouter.png", "glm.png", "nous.png", "cohere.png", "vertex.png", "tencent.png",
    "byteplus.png", "cloudflare-ai.png", "azure.png", "gitlab.png", "huggingface.png", "github.png",
    "vercel-ai-gateway.png", "venice.png", "ollama.png", "chutes.png", "featherless.png", "novita.png",
    "agentrouter.png"
  ]);
  const DEEPEN_GRAY_FILES = new Set(["xai.png", "glm.png", "nous.png", "openrouter.png"]);

  const EFFORT_THEME = {
    low: { color: "#10B981", accent: "#2DD4BF", glow: "rgba(16, 185, 129, 0.48)", badge: "AETHER · LOW", realm: "Phản hồi siêu nhanh & tiết kiệm token" },
    medium: { color: "#38BDF8", accent: "#6366F1", glow: "rgba(56, 189, 248, 0.54)", badge: "ASTRAL · MED", realm: "Cân bằng tốc độ & độ sâu kỹ thuật" },
    high: { color: "#F97316", accent: "#F59E0B", glow: "rgba(249, 115, 22, 0.64)", badge: "SOLAR · HIGH", realm: "Suy luận đa tầng & kiểm chứng sâu" },
    xhigh: { color: "#EC4899", accent: "#A855F7", glow: "rgba(236, 72, 153, 0.8)", badge: "SINGULARITY · XHIGH", realm: "Chân trời Sự kiện — tư duy kiến trúc cực đại" },
    max: { color: "#D946EF", accent: "#A855F7", glow: "rgba(217, 70, 239, 0.84)", badge: "SINGULARITY · MAX", realm: "Hố Đen Vô Cực — giải phóng toàn bộ năng lực" }
  };

  const PERMISSION_ITEMS = [
    { key: "executeTerminal", icon: "terminal", title: "Chạy lệnh Terminal", desc: "PowerShell, Git, npm, build, test, script trực tiếp" },
    { key: "readFiles", icon: "file", title: "Đọc tệp & Quét dự án", desc: "Tự động tra cứu cây thư mục, mã nguồn và tìm kiếm" },
    { key: "editFiles", icon: "edit", title: "Tạo & Sửa tệp", desc: "Áp dụng bản vá diff và tạo file mới trong dự án" },
    { key: "deleteFiles", icon: "trash", title: "Xóa tệp", desc: "Cho phép xóa tệp thừa hoặc file tạm khi dọn dẹp" },
    { key: "outsideWorkspace", icon: "folder", title: "Truy cập ngoài Workspace", desc: "Đọc/ghi đường dẫn tuyệt đối ngoài thư mục đang mở" },
    { key: "webAccess", icon: "globe", title: "Truy cập Web / API", desc: "Fetch tài liệu GitHub, Docs, HTTP API trực tiếp" },
    { key: "ideDiagnostics", icon: "blueprint", title: "IDE Problems & Git", desc: "Đọc lỗi Problems, kiểm tra Git & mở tệp trong editor" },
    { key: "autoRetry", icon: "refresh", title: "Tự nối lại khi lỗi mạng", desc: "Tự thử lại khi gặp 429/5xx, không ngắt giữa quãng" },
    { key: "guardCatastrophic", icon: "shield", title: "Chặn lệnh hủy hệ thống", desc: "Luôn hỏi lại trước lệnh cực nguy hiểm (rm -rf /, format)" }
  ];

  const SLASH_COMMANDS = [
    { cmd: "/permissions", desc: "Mở bảng cấp quyền Terminal, File, Web, YOLO (Cline/BotChat)" },
    { cmd: "/provider", desc: "Mở bộ chọn Provider -> Model & Effort" },
    { cmd: "/workspace", desc: "Xem toàn bộ cây thư mục dự án đang mở" },
    { cmd: "/run ", desc: "Chạy nhanh một lệnh Terminal ngay trong khung chat" },
    { cmd: "/sync", desc: "Đồng bộ lại Antigravity, CLI & VS Code" },
    { cmd: "/new", desc: "Tạo tác vụ / cuộc trò chuyện mới" },
    { cmd: "/connect", desc: "Mở xác thực mật khẩu web 001Router" }
  ];

  const DEFAULT_PERMS = {
    preset: "yolo",
    readFiles: true,
    editFiles: true,
    deleteFiles: true,
    executeTerminal: true,
    outsideWorkspace: true,
    webAccess: true,
    ideDiagnostics: true,
    autoRetry: true,
    guardCatastrophic: true,
    maxSteps: 35
  };

  const state = {
    connected: false,
    serverUrl: "http://127.0.0.1:20128",
    catalog: { providers: [], combos: [], aliases: {} },
    selection: null,
    mode: "auto",
    permissions: { ...DEFAULT_PERMS },
    autoActiveFile: true,
    autoWorkspace: true,
    envSync: { ideName: "VS Code", ideKind: "vscode", autoSyncedFrom: null, cliTools: [] },
    editorContext: {
      hasWorkspaceFolder: false,
      hasProjectFolder: false,
      workspaceName: "",
      workingDir: "",
      activeFile: null,
      openTabs: [],
      workspaceSummary: null
    },
    sessions: [],
    activeSessionId: null,
    draft: "",
    attachments: [],
    terminalRuns: [],
    streamingSessionId: null,
    authModalOpen: false,
    authServerInput: "http://127.0.0.1:20128",
    authPasswordInput: "",
    authShowPassword: false,
    authLoading: false,
    authError: "",
    lastError: "",
    activePopover: null,
    pickerStep: "providers",
    inspectingProviderSlug: null,
    providerSearch: "",
    modelSearch: "",
    workspaceSearch: "",
    copiedBlockId: null,
    fxPaused: false,
    isTypingDraft: false
  };

  let liveTimerInterval = null;
  let typingIdleTimer = null;
  const codeBlockCache = new Map();

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(ms) {
    const sec = Math.max(0.1, (Number(ms) || 0) / 1000);
    return `${sec.toFixed(1)}s`;
  }

  function resolveProviderLogoFile(provider) {
    if (provider?.logoFile) return provider.logoFile;
    const c = `${provider?.preset || ""} ${provider?.slug || ""} ${provider?.name || ""}`.toLowerCase();
    const map = [
      ["antigravity", "antigravity.png"], ["anthropic", "anthropic.png"], ["claude", "anthropic.png"],
      ["openai", "openai.png"], ["codex", "openai.png"], ["gemini-cli", "gemini-cli.png"],
      ["gemini", "gemini.png"], ["google", "gemini.png"], ["xai", "xai.png"], ["grok", "xai.png"],
      ["deepseek", "deepseek.png"], ["qwen", "qwen.png"], ["alibaba", "qwen.png"], ["kimi", "kimi.png"],
      ["glm", "glm.png"], ["groq", "groq.png"], ["openrouter", "openrouter.png"], ["mistral", "mistral.png"],
      ["minimax", "minimax.png"], ["cohere", "cohere.png"], ["nvidia", "nvidia.png"], ["cerebras", "cerebras.png"],
      ["sambanova", "sambanova.png"], ["huggingface", "huggingface.png"], ["perplexity", "perplexity.png"],
      ["together", "together.png"], ["fireworks", "fireworks.png"], ["ollama", "ollama.png"],
      ["azure", "azure.png"], ["bedrock", "bedrock.png"], ["vertex", "vertex.png"], ["gitlab", "gitlab.png"],
      ["vercel", "vercel-ai-gateway.png"], ["siliconflow", "siliconflow.png"], ["venice", "venice.png"],
      ["nous", "nous.png"], ["xiaomi", "xiaomi-mimo.png"], ["agentrouter", "agentrouter.png"]
    ];
    for (const [needle, file] of map) {
      if (c.includes(needle)) return file;
    }
    return "";
  }

  function resolveModelLogoFile(modelId, provider, explicitLogoFile) {
    if (explicitLogoFile) return explicitLogoFile;
    const lower = String(modelId || "").toLowerCase();
    if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus") || lower.includes("haiku")) return "claude.png";
    if (lower.includes("gemini") || lower.includes("gemma")) return "gemini.png";
    if (lower.includes("codex")) return "codex.png";
    if (lower.includes("gpt-") || lower.includes("chatgpt") || /^o[134]($|-)/.test(lower)) return "openai.png";
    if (lower.includes("grok")) return "xai.png";
    if (lower.includes("deepseek")) return "deepseek.png";
    if (lower.includes("qwen") || lower.includes("qwq")) return "qwen.png";
    if (lower.includes("kimi")) return "kimi.png";
    if (lower.includes("glm")) return "glm.png";
    if (lower.includes("llama") || lower.includes("meta")) return "muse.png";
    if (lower.includes("mistral") || lower.includes("codestral")) return "mistral.png";
    if (lower.includes("minimax")) return "minimax.png";
    return resolveProviderLogoFile(provider);
  }

  function renderLogoPlate(logoFile, monogram, color, sizeClass) {
    const clean = String(logoFile || "").trim();
    if (clean && providersBaseUri) {
      const isLight = LIGHT_PLATE_FILES.has(clean);
      const isDeep = DEEPEN_GRAY_FILES.has(clean);
      const src = `${providersBaseUri}/${encodeURIComponent(clean)}`;
      return `<span class="r001-logo-plate ${sizeClass} ${isLight ? "light-plate" : ""} ${isDeep ? "deepen-gray" : ""}"><img src="${escapeHtml(src)}" alt="${escapeHtml(monogram || "AI")}" loading="eager" /></span>`;
    }
    return `<span class="r001-logo-plate ${sizeClass}"><span class="r001-logo-monogram" style="background:${escapeHtml(color || "#e57452")}">${escapeHtml(monogram || "01")}</span></span>`;
  }

  /**
   * Render Grok-inspired 3D Interactive Singularity Canvas Core (Hero or Avatar).
   */
  function renderGrok3DCore(variant, mood, isSing) {
    const isHero = variant === "hero";
    const cls = isHero ? "grok3d-hero-wrap" : "grok3d-avatar-wrap";
    const sizeAttr = isHero ? 'width="152" height="152"' : 'width="36" height="36"';
    return (
      `<div class="${cls}" data-mood="${escapeHtml(mood || "idle")}" data-singularity="${isSing ? "1" : "0"}" title="${isHero ? "Kéo thả để xoay lõi 3D Singularity" : "001Router Axiom 3D Core"}">` +
        `<canvas class="grok3d-canvas" data-grok3d="${escapeHtml(variant)}" data-mood="${escapeHtml(mood || "idle")}" data-singularity="${isSing ? "1" : "0"}" ${sizeAttr} aria-hidden="true"></canvas>` +
      `</div>`
    );
  }

  function getActiveSession() {
    return state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0] || null;
  }

  function findSelectedProvider() {
    const providers = state.catalog?.providers || [];
    if (!state.selection || state.selection.kind === "combo") return null;
    return providers.find((p) => p.slug === state.selection.providerSlug) || providers[0] || null;
  }

  function findModelInProvider(prov, selection) {
    if (!prov || !Array.isArray(prov.models)) return null;
    if (!selection) return prov.models[0] || null;
    return (
      prov.models.find((m) => m.id === selection.baseModelId) ||
      prov.models.find((m) => m.id === selection.modelId) ||
      prov.models.find(
        (m) => m.variantMap && Object.values(m.variantMap).some((v) => (v.id || v.modelId) === selection.modelId)
      ) ||
      prov.models[0] ||
      null
    );
  }

  function findSelectedModelObj() {
    if (state.selection?.kind === "combo") {
      return (state.catalog?.combos || []).find((c) => c.name === state.selection.modelId) || null;
    }
    return findModelInProvider(findSelectedProvider(), state.selection);
  }

  function buildSyncedSelection(prov, modelObj, desiredEffort) {
    const levels = modelObj?.effort?.effortLevels || [];
    const eff = levels.some((l) => l.id === desiredEffort)
      ? desiredEffort
      : modelObj?.effort?.defaultEffort || levels[0]?.id || "medium";
    const variant = modelObj?.variantMap?.[eff] || null;
    return {
      kind: "provider",
      providerSlug: prov.slug,
      providerName: prov.name,
      providerPreset: prov.preset,
      providerColor: prov.color,
      baseModelId: modelObj.id,
      displayLabel: modelObj.label || modelObj.id,
      modelId: variant ? variant.id || variant.modelId : modelObj.id,
      fullId: variant ? variant.fullId : modelObj.fullId,
      effort: eff
    };
  }

  function getActiveEffortProfile() {
    const fallback = {
      effortLevels: [
        { id: "low", label: "Low", shortLabel: "Low", power: 1, percent: 33, ...EFFORT_THEME.low },
        { id: "medium", label: "Medium", shortLabel: "Med", power: 2, percent: 66, ...EFFORT_THEME.medium },
        { id: "high", label: "High", shortLabel: "High", power: 3, percent: 100, ...EFFORT_THEME.high }
      ],
      defaultEffort: "medium",
      maxEffort: "high",
      maxLabel: "High"
    };
    const mod = findSelectedModelObj();
    if (mod?.effort?.effortLevels?.length) return mod.effort;
    return fallback;
  }

  function getCurrentEffortStop() {
    const profile = getActiveEffortProfile();
    const curId = state.selection?.effort || profile.defaultEffort;
    return profile.effortLevels.find((s) => s.id === curId) || profile.effortLevels[0];
  }

  function isSingularityStop(stop, profile) {
    if (!stop) return false;
    return stop.id === "xhigh" || stop.id === "max" || (profile?.effortLevels?.length >= 4 && stop.id === profile.maxEffort);
  }

  function applyRootEffortVars(stop, profile) {
    const theme = EFFORT_THEME[stop?.id] || EFFORT_THEME.medium;
    const isSing = isSingularityStop(stop, profile);
    document.documentElement.style.setProperty("--effort-color", stop?.color || theme.color);
    document.documentElement.style.setProperty("--effort-accent", stop?.accent || theme.accent);
    document.documentElement.style.setProperty("--effort-glow", stop?.glow || theme.glow);
    document.documentElement.style.setProperty("--singularity", isSing ? "1" : "0");
  }

  function getPermissionBadgeMeta() {
    const p = state.permissions || DEFAULT_PERMS;
    if (p.preset === "yolo" && p.executeTerminal && p.editFiles) {
      return { label: "Toàn quyền", cls: "perm-yolo", title: "Full Access: Terminal + File + Web + Auto-Retry" };
    }
    if (p.preset === "ask" || (!p.executeTerminal && !p.editFiles)) {
      return { label: "Hỏi duyệt", cls: "perm-ask", title: "Hỏi xác nhận trước khi sửa file hoặc chạy Terminal" };
    }
    return { label: "An toàn", cls: "perm-safe", title: "Tự động đọc/sửa an toàn, hỏi lệnh rủi ro" };
  }

  function formatInlineText(raw) {
    let s = escapeHtml(raw);
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    return s;
  }

  function renderTextChunk(chunk) {
    const lines = String(chunk || "").split(/\r?\n/);
    const out = [];
    let inUl = false;
    let inOl = false;
    const closeLists = () => {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { closeLists(); continue; }
      const h3 = /^###\s+(.+)$/.exec(trimmed);
      if (h3) { closeLists(); out.push(`<h3>${formatInlineText(h3[1])}</h3>`); continue; }
      const h2 = /^##\s+(.+)$/.exec(trimmed);
      if (h2) { closeLists(); out.push(`<h2>${formatInlineText(h2[1])}</h2>`); continue; }
      const h1 = /^#\s+(.+)$/.exec(trimmed);
      if (h1) { closeLists(); out.push(`<h1>${formatInlineText(h1[1])}</h1>`); continue; }
      const bq = /^>\s?(.*)$/.exec(trimmed);
      if (bq) { closeLists(); out.push(`<blockquote>${formatInlineText(bq[1])}</blockquote>`); continue; }
      const ul = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (ul) {
        if (inOl) { out.push("</ol>"); inOl = false; }
        if (!inUl) { out.push("<ul>"); inUl = true; }
        out.push(`<li>${formatInlineText(ul[1])}</li>`);
        continue;
      }
      const ol = /^\d+\.\s+(.+)$/.exec(trimmed);
      if (ol) {
        if (inUl) { out.push("</ul>"); inUl = false; }
        if (!inOl) { out.push("<ol>"); inOl = true; }
        out.push(`<li>${formatInlineText(ol[1])}</li>`);
        continue;
      }
      closeLists();
      out.push(`<p>${formatInlineText(line)}</p>`);
    }
    closeLists();
    return out.join("");
  }

  function renderMarkdown(rawText, messageId, isStreamingThis) {
    const text = String(rawText || "");
    const parts = [];
    const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let blockIdx = 0;
    let match;

    while ((match = fenceRegex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(renderTextChunk(text.slice(lastIndex, match.index)));
      const lang = (match[1] || "code").trim();
      const code = match[2];
      const blockKey = `${messageId}:${blockIdx++}`;
      const copied = state.copiedBlockId === blockKey;
      const isShell = SHELL_LANGS.has(lang.toLowerCase());
      parts.push(
        `<div class="r001-codeblock">` +
          `<div class="r001-codeblock-head">` +
            `<span>${escapeHtml(lang)}</span>` +
            `<div class="r001-codeblock-actions">` +
              (isShell ? `<button type="button" class="r001-mini-btn run-btn" data-action="run-code" data-block="${escapeHtml(blockKey)}">${ICONS.terminal}<span>Run</span></button>` : "") +
              `<button type="button" class="r001-mini-btn" data-action="copy-code" data-block="${escapeHtml(blockKey)}">${ICONS.copy}<span>${copied ? "Copied" : "Copy"}</span></button>` +
              `<button type="button" class="r001-mini-btn" data-action="apply-code" data-block="${escapeHtml(blockKey)}">${ICONS.apply}<span>Apply</span></button>` +
            `</div>` +
          `</div>` +
          `<pre>${escapeHtml(code)}</pre>` +
        `</div>`
      );
      codeBlockCache.set(blockKey, code);
      lastIndex = fenceRegex.lastIndex;
    }

    if (lastIndex < text.length) parts.push(renderTextChunk(text.slice(lastIndex)));
    const html = parts.join("");
    if (!html && isStreamingThis) return "";
    return isStreamingThis ? `${html}<span class="r001-stream-caret"></span>` : html;
  }

  function getStepCategoryIcon(category) {
    switch (category) {
      case "terminal": return ICONS.terminal;
      case "edit": return ICONS.edit;
      case "delete": return ICONS.trash;
      case "search": return ICONS.search;
      case "list": return ICONS.folderTree;
      case "web": return ICONS.globe;
      case "git": return ICONS.git;
      case "plan": return ICONS.listChecks;
      case "ide": return ICONS.blueprint;
      default: return ICONS.file;
    }
  }

  function renderDiffHtml(diffPreview) {
    if (!diffPreview) return "";
    const lines = String(diffPreview).split(/\r?\n/);
    return (
      `<div class="r001-diff-box">` +
      lines
        .map((line) => {
          const cls = line.startsWith("+ ") ? "diff-add" : line.startsWith("- ") ? "diff-del" : "diff-ctx";
          return `<div class="r001-diff-line ${cls}">${escapeHtml(line)}</div>`;
        })
        .join("") +
      `</div>`
    );
  }

  /**
   * Render a single Cline-style structured Step Execution Card (<details>).
   * Clearly exposes the exact command, file path, diff preview, live stdout, and inline approvals.
   */
  function renderStepCard(step, index) {
    const isRunning = step.status === "running";
    const isAwaiting = step.status === "awaiting_approval";
    const isErr = step.status === "error" || step.status === "denied";
    const isOk = step.status === "success";
    const autoOpen =
      isAwaiting ||
      (isRunning && step.category === "terminal") ||
      (step.category === "edit" && Boolean(step.diffPreview)) ||
      isErr;

    const statusBadge = isRunning
      ? `<span class="r001-step-badge running"><progress aria-label="Đang chạy" class="r001-spinner"></progress><span>${escapeHtml(step.badge || "Đang chạy...")}</span></span>`
      : isAwaiting
        ? `<span class="r001-step-badge approval">Chờ duyệt</span>`
        : isErr
          ? `<span class="r001-step-badge error">${ICONS.x}<span>${escapeHtml(step.badge || "Lỗi")}</span></span>`
          : `<span class="r001-step-badge ok">${ICONS.check}<span>${escapeHtml(step.badge || "Xong")}</span></span>`;

    const hasBody = Boolean(
      isAwaiting ||
        step.diffPreview ||
        step.output ||
        step.summary ||
        step.absPath ||
        step.category === "terminal"
    );

    return (
      `<details class="r001-step-card status-${escapeHtml(step.status)} cat-${escapeHtml(step.category)}" id="step-${escapeHtml(step.stepId)}" ${autoOpen ? "open" : ""}>` +
        `<summary class="r001-step-summary">` +
          `<span class="r001-step-idx">${index + 1}</span>` +
          `<span class="r001-step-icon">${getStepCategoryIcon(step.category)}</span>` +
          `<span class="r001-step-main">` +
            `<span class="r001-step-verb">${escapeHtml(step.title || step.tool)}</span>` +
            (step.target
              ? `<code class="r001-step-target" title="${escapeHtml(step.target)}">${escapeHtml(step.target)}</code>`
              : "") +
          `</span>` +
          statusBadge +
        `</summary>` +
        (hasBody
          ? `<div class="r001-step-body">` +
              (isAwaiting
                ? `<div class="r001-approval-box risk-${escapeHtml(step.riskLevel || "medium")}">` +
                    `<div class="r001-approval-reason">${ICONS.shield}<span>${escapeHtml(step.approvalReason || "Yêu cầu xác nhận quyền thực thi")}</span></div>` +
                    `<div class="r001-approval-actions">` +
                      `<button type="button" class="r001-apr-btn allow" data-action="resolve-approval" data-approval="${escapeHtml(step.approvalId)}" data-decision="allow">${ICONS.check}<span>Cho phép</span></button>` +
                      `<button type="button" class="r001-apr-btn always" data-action="resolve-approval" data-approval="${escapeHtml(step.approvalId)}" data-decision="always">${ICONS.bolt}<span>Luôn cho phép nhóm này</span></button>` +
                      `<button type="button" class="r001-apr-btn deny" data-action="resolve-approval" data-approval="${escapeHtml(step.approvalId)}" data-decision="deny">${ICONS.x}<span>Từ chối</span></button>` +
                    `</div>` +
                  `</div>`
                : "") +
              (step.cwd ? `<div class="r001-step-meta">cwd: ${escapeHtml(step.cwd)}</div>` : "") +
              (step.summary && !isAwaiting ? `<div class="r001-step-summary-line">${escapeHtml(step.summary)}</div>` : "") +
              (step.diffPreview ? renderDiffHtml(step.diffPreview) : "") +
              (step.output || (isRunning && step.category === "terminal")
                ? `<pre class="r001-step-pre ${step.category === "terminal" ? "is-term" : ""}">${escapeHtml(step.output || "Đang nhận dữ liệu đầu ra từ Terminal...")}</pre>`
                : "") +
              `<div class="r001-step-foot">` +
                (isRunning && step.category === "terminal"
                  ? `<button type="button" class="r001-mini-btn danger-btn" data-action="kill-term" data-run="${escapeHtml(step.stepId)}">${ICONS.stop}<span>Dừng lệnh</span></button>`
                  : "") +
                (step.category === "terminal" && step.target
                  ? `<button type="button" class="r001-mini-btn" data-action="open-ide-term" data-cmd="${escapeHtml(step.target)}">${ICONS.terminal}<span>Mở IDE Terminal</span></button>`
                  : "") +
                (step.absPath
                  ? `<button type="button" class="r001-mini-btn" data-action="reveal-path" data-path="${escapeHtml(step.absPath)}">${ICONS.file}<span>Mở tệp</span></button>`
                  : "") +
                (step.durationMs > 0 && (isOk || isErr)
                  ? `<span class="r001-step-dur">${formatDuration(step.durationMs)}</span>`
                  : "") +
              `</div>` +
            `</div>`
          : "") +
      `</details>`
    );
  }

  function renderPlanCard(plan) {
    if (!Array.isArray(plan) || plan.length === 0) return "";
    const done = plan.filter((s) => s.status === "done").length;
    const pct = Math.round((done / plan.length) * 100);
    return (
      `<div class="r001-plan-card">` +
        `<div class="r001-plan-head">` +
          `<span class="r001-plan-title">${ICONS.listChecks}<span>Kế hoạch thực thi (${done}/${plan.length})</span></span>` +
          `<span class="r001-plan-pct">${pct}%</span>` +
        `</div>` +
        `<div class="r001-plan-bar"><span style="width:${pct}%"></span></div>` +
        `<ul class="r001-plan-list">` +
          plan
            .map(
              (s) =>
                `<li class="plan-${escapeHtml(s.status)}">` +
                  `<span class="r001-plan-dot">${s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.status === "in_progress" ? "●" : "○"}</span>` +
                  `<span>${escapeHtml(s.title)}</span>` +
                `</li>`
            )
            .join("") +
        `</ul>` +
      `</div>`
    );
  }

  function renderTaskTimeline(msg, isLastStreaming) {
    const steps = Array.isArray(msg.steps) ? msg.steps : [];
    const legacyLogs = Array.isArray(msg.toolLogs) ? msg.toolLogs : [];
    const hasSteps = steps.length > 0;
    const hasLegacy = !hasSteps && legacyLogs.length > 0;
    if (!hasSteps && !hasLegacy) return "";

    if (hasLegacy) {
      return (
        `<details class="r001-thinking-card">` +
          `<summary><span class="r001-thinking-head-left">${ICONS.folderTree}<span>Đã tra cứu ${legacyLogs.length} bước</span></span></summary>` +
          `<div class="r001-reasoning-body">${legacyLogs.map((l) => `• ${escapeHtml(l.label || l.tool)}`).join("\n")}</div>` +
        `</details>`
      );
    }

    const doneCount = steps.filter((s) => s.status === "success").length;
    const runningStep = steps.find((s) => s.status === "running" || s.status === "awaiting_approval");
    const maxLbl = state.permissions?.maxSteps ? `${state.permissions.maxSteps}` : "∞";

    return (
      `<div class="r001-timeline-wrap">` +
        `<div class="r001-timeline-bar">` +
          `<span class="r001-timeline-bar-left">` +
            (isLastStreaming && runningStep ? `<progress aria-label="Đang chạy" class="r001-spinner"></progress>` : ICONS.bolt) +
            `<span>${isLastStreaming && runningStep ? `Đang chạy bước ${steps.length}/${maxLbl}: ${escapeHtml(runningStep.title)}` : `Chuỗi thực thi · ${doneCount}/${steps.length} bước hoàn tất`}</span>` +
          `</span>` +
          (isLastStreaming
            ? `<button type="button" class="r001-mini-btn danger-btn" data-action="abort-chat">${ICONS.stop}<span>Dừng</span></button>`
            : "") +
        `</div>` +
        `<div class="r001-steps-stack">${steps.map((s, i) => renderStepCard(s, i)).join("")}</div>` +
      `</div>`
    );
  }

  function renderAssistantHeader(msg, isLastStreaming, hasRunningTerminal, isSing) {
    const hasError = Boolean(msg.error && !msg.text);
    const awaiting = Array.isArray(msg.steps) && msg.steps.some((s) => s.status === "awaiting_approval");
    const rawPhase = awaiting
      ? "approval"
      : hasRunningTerminal
        ? "terminal"
        : isLastStreaming
          ? msg.phase || (msg.text ? "streaming" : msg.reasoning ? "thinking" : "analyzing")
          : hasError
            ? "error"
            : "done";

    const elapsedMs = isLastStreaming && msg.startedAt ? Date.now() - msg.startedAt : msg.durationMs || 0;
    const titles = {
      approval: "Axiom · Chờ xác nhận quyền",
      terminal: "Axiom · Đang chạy Terminal",
      executing: "Axiom · Đang thực thi công cụ",
      analyzing: "Axiom · Đang quét hệ thống",
      thinking: "Axiom · Đang suy luận sâu",
      streaming: "Axiom · Đang phản hồi",
      error: "Axiom · Gặp sự cố",
      done: "Axiom"
    };
    const subText =
      rawPhase === "done"
        ? `Hoàn tất trong ${formatDuration(elapsedMs)}${msg.steps?.length ? ` · ${msg.steps.length} bước` : ""}${msg.totalTokens ? ` · ${msg.totalTokens} tok` : ""}`
        : rawPhase === "error"
          ? "Không thể hoàn tất yêu cầu"
          : msg.phaseDetail || "Đang xử lý tác vụ tự hành...";

    return (
      `<div class="r001-msg-header" data-msg-header="${escapeHtml(msg.id)}">` +
        renderGrok3DCore("avatar", rawPhase, isSing) +
        `<div class="r001-ai-status-col">` +
          `<div class="r001-ai-status-row">` +
            `<span class="r001-ai-persona-label">${escapeHtml(titles[rawPhase] || "Axiom")}</span>` +
          `</div>` +
          `<div class="r001-ai-substatus">` +
            (rawPhase !== "done" && rawPhase !== "error" ? `<progress aria-label="Đang xử lý" class="r001-spinner"></progress>` : "") +
            `<span class="r001-live-sub-text">${escapeHtml(subText)}</span>` +
            (isLastStreaming && msg.startedAt ? `<span class="r001-live-elapsed" data-started="${msg.startedAt}">· ${formatDuration(elapsedMs)}</span>` : "") +
          `</div>` +
        `</div>` +
      `</div>`
    );
  }

  function renderThinkingCard(msg, isLastStreaming) {
    const isThinkingNow = isLastStreaming && !msg.text && msg.phase === "thinking";
    if (!msg.reasoning && !isThinkingNow) return "";
    const lines = String(msg.reasoning || "").trim().split("\n").filter(Boolean);
    const lastLine = lines.length ? lines[lines.length - 1] : "Đang tổng hợp chuỗi suy luận...";
    return (
      `<details class="r001-thinking-card ${isThinkingNow ? "active" : ""}" data-thinking-card="${escapeHtml(msg.id)}" ${isThinkingNow ? "open" : ""}>` +
        `<summary>` +
          `<span class="r001-thinking-head-left">${isThinkingNow ? `<progress aria-label="Đang suy nghĩ" class="r001-spinner"></progress>` : ICONS.brain}<span>${isThinkingNow ? "Đang suy luận kiến trúc..." : `Chuỗi suy luận (${msg.reasoning.length} ký tự)`}</span></span>` +
          `<span class="r001-subtle-tag">${isThinkingNow ? "Live" : "Chi tiết"}</span>` +
        `</summary>` +
        `<div class="r001-reasoning-body">${escapeHtml(msg.reasoning || lastLine)}</div>` +
      `</details>`
    );
  }

  function renderTerminalCard(run) {
    const isRunning = run.status === "running";
    const isFailed = !isRunning && run.exitCode !== 0;
    const elapsed = isRunning ? Date.now() - run.startedAt : run.durationMs || 0;
    return (
      `<div class="r001-terminal-card ${isRunning ? "running" : ""} ${isFailed ? "failed" : ""}" id="term-${escapeHtml(run.runId)}">` +
        `<div class="r001-terminal-head">` +
          `<div class="r001-terminal-cmd"><span class="r001-terminal-prompt">$</span><span>${escapeHtml(run.command)}</span></div>` +
          `<div class="r001-terminal-meta">` +
            (isRunning
              ? `<progress aria-label="Đang chạy" class="r001-spinner"></progress><span class="r001-term-status run" data-started="${run.startedAt}">RUNNING · ${formatDuration(elapsed)}</span><button type="button" class="r001-mini-btn danger-btn" data-action="kill-term" data-run="${escapeHtml(run.runId)}">Dừng</button>`
              : `<span class="r001-term-status ${isFailed ? "err" : "ok"}">${isFailed ? `✕ Exit ${run.exitCode}` : "✓ Exit 0"} · ${formatDuration(elapsed)}</span>`) +
          `</div>` +
        `</div>` +
        `<div class="r001-terminal-cwd">cwd: ${escapeHtml(run.cwd || "")}</div>` +
        `<pre class="r001-terminal-out">${escapeHtml(run.output || (isRunning ? "Đang chờ output..." : "(Không có output)"))}</pre>` +
        `<div class="r001-terminal-foot">` +
          `<button type="button" class="r001-mini-btn" data-action="open-ide-term" data-cmd="${escapeHtml(run.command)}">${ICONS.terminal}<span>Mở IDE Terminal</span></button>` +
          (isFailed ? `<button type="button" class="r001-mini-btn run-btn" data-action="fix-term-error" data-run="${escapeHtml(run.runId)}">${ICONS.bolt}<span>Nhờ Axiom sửa lỗi</span></button>` : "") +
        `</div>` +
      `</div>`
    );
  }

  function renderEffortBar() {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const stop = getCurrentEffortStop();
    const isSing = isSingularityStop(stop, profile);
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;
    return `
      <div class="r001-effort-bar" data-singularity="${isSing ? "1" : "0"}">
        <div class="r001-effort-top">
          <span class="r001-effort-title">Effort: <strong style="color:var(--effort-color)">${escapeHtml(stop.label)}</strong></span>
          <span class="r001-effort-power-tag">${escapeHtml(theme.badge)}</span>
        </div>
        <div class="r001-effort-tiers" role="group" aria-label="Chọn mức Effort">
          ${stops
            .map(
              (s) =>
                `<button type="button" class="r001-tier-pill ${s.id === stop.id ? "active" : ""}" data-action="pick-effort-tier" data-tier="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`
            )
            .join("")}
        </div>
        <div class="r001-effort-sub">
          <span>${escapeHtml(theme.realm || stop.description || "")}</span>
          ${
            !REDUCED_MOTION_MQ.matches
              ? `<button type="button" class="r001-fx-pause-btn" data-action="toggle-fx">${state.fxPaused ? "Play 3D FX" : "Pause 3D FX"}</button>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderPermissionsPopover() {
    const p = state.permissions || DEFAULT_PERMS;
    const presets = [
      { id: "yolo", title: "Toàn quyền (YOLO)", desc: "Auto Terminal + File + Web + ngoài Workspace" },
      { id: "safe", title: "An toàn", desc: "Auto đọc/sửa, hỏi trước khi Xóa / Terminal rủi ro" },
      { id: "ask", title: "Hỏi duyệt", desc: "Xác nhận thủ công từng thao tác sửa & Terminal" }
    ];
    const stepChoices = [
      { val: 15, label: "15 bước" },
      { val: 35, label: "35 bước" },
      { val: 60, label: "60 bước" },
      { val: 0, label: "∞ Vô hạn" }
    ];
    return `
      <div class="r001-popover r001-perm-popover" id="r001-popover">
        <div class="r001-popover-head">
          <span class="r001-popover-title">${ICONS.shield}<span>Quyền truy cập & Tự hành (Cline / BotChat)</span></span>
          <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
        </div>
        <div class="r001-perm-presets">
          ${presets
            .map(
              (pr) => `
              <button type="button" class="r001-perm-preset-btn ${p.preset === pr.id ? "active" : ""}" data-action="set-perm-preset" data-preset="${pr.id}">
                <div class="r001-perm-preset-title">${escapeHtml(pr.title)}</div>
                <div class="r001-perm-preset-desc">${escapeHtml(pr.desc)}</div>
              </button>`
            )
            .join("")}
        </div>
        <div class="r001-perm-steps-row">
          <span class="r001-perm-steps-label">Giới hạn bước tự hành:</span>
          <div class="r001-perm-steps-pills">
            ${stepChoices
              .map(
                (c) =>
                  `<button type="button" class="r001-tier-pill ${Number(p.maxSteps) === c.val ? "active" : ""}" data-action="set-max-steps" data-steps="${c.val}">${escapeHtml(c.label)}</button>`
              )
              .join("")}
          </div>
        </div>
        <div class="r001-popover-list r001-perm-list">
          ${PERMISSION_ITEMS.map(
            (item) => `
            <button type="button" class="r001-perm-row ${p[item.key] ? "on" : ""}" data-action="toggle-perm" data-key="${item.key}" aria-pressed="${p[item.key] ? "true" : "false"}">
              <div class="r001-perm-row-left">
                <span class="r001-perm-ico">${ICONS[item.icon] || ICONS.shield}</span>
                <div>
                  <div class="r001-perm-name">${escapeHtml(item.title)}</div>
                  <div class="r001-perm-desc">${escapeHtml(item.desc)}</div>
                </div>
              </div>
              <span class="r001-switch ${p[item.key] ? "checked" : ""}" aria-hidden="true"><i></i></span>
            </button>`
          ).join("")}
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
      const filteredProviders = providers.filter((p) => !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
      const filteredCombos = combos.filter((c) => !q || c.name.toLowerCase().includes(q));
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.sliders}<span>Chọn nhà cung cấp (Provider)</span></span>
            <button type="button" class="r001-back-btn" data-action="refresh-catalog">${ICONS.refresh}<span>Sync</span></button>
          </div>
          <input type="text" class="r001-search" id="r001-provider-search" placeholder="Tìm provider (Antigravity, Anthropic, OpenAI, Gemini...)" value="${escapeHtml(state.providerSearch)}" />
          <div class="r001-popover-list">
            <div class="r001-section-label">Connected Providers (${filteredProviders.length})</div>
            ${filteredProviders
              .map((p) => {
                const isCur = state.selection?.kind !== "combo" && state.selection?.providerSlug === p.slug;
                return `
                  <button type="button" class="r001-prov-item ${isCur ? "selected" : ""}" data-action="open-provider" data-slug="${escapeHtml(p.slug)}">
                    <div class="r001-prov-left">
                      ${renderLogoPlate(resolveProviderLogoFile(p), p.monogram || p.slug.slice(0, 2).toUpperCase(), p.color, "lg")}
                      <div style="min-width:0">
                        <div class="r001-prov-name">${escapeHtml(p.name)}</div>
                        <div class="r001-prov-sub">${p.modelCount} models</div>
                      </div>
                    </div>
                    <div class="r001-prov-right">${isCur ? ICONS.check : ""}${ICONS.chevronRight}</div>
                  </button>`;
              })
              .join("")}
            ${
              filteredCombos.length > 0
                ? `<div class="r001-section-label">Smart Combos (${filteredCombos.length})</div>` +
                  filteredCombos
                    .map(
                      (c) => `
                    <button type="button" class="r001-model-item ${state.selection?.kind === "combo" && state.selection?.modelId === c.name ? "selected" : ""}" data-action="select-combo" data-combo="${escapeHtml(c.name)}">
                      <div class="r001-model-left">${renderLogoPlate("", "CB", "#e57452", "md")}<div style="min-width:0"><div class="r001-model-name">${escapeHtml(c.name)}</div><div class="r001-model-desc">${escapeHtml(c.description || "")}</div></div></div>
                    </button>`
                    )
                    .join("")
                : ""
            }
          </div>
          ${renderEffortBar()}
        </div>
      `;
    }

    const provider = providers.find((p) => p.slug === activeSlug) || providers[0];
    const q = state.modelSearch.trim().toLowerCase();
    const models = (provider?.models || []).filter(
      (m) => !q || m.id.toLowerCase().includes(q) || (m.label || "").toLowerCase().includes(q)
    );
    const curObj = state.selection?.providerSlug === provider?.slug ? findModelInProvider(provider, state.selection) : null;
    return `
      <div class="r001-popover" id="r001-popover">
        <div class="r001-popover-head">
          <div class="r001-popover-title">
            <button type="button" class="r001-back-btn" data-action="back-providers">${ICONS.back}<span>Providers</span></button>
            ${renderLogoPlate(resolveProviderLogoFile(provider), provider?.monogram || "AI", provider?.color, "sm")}
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(provider?.name || "Models")}</span>
          </div>
          <span class="r001-subtle-tag">${models.length}</span>
        </div>
        <input type="text" class="r001-search" id="r001-model-search" placeholder="Lọc model trong ${escapeHtml(provider?.name || "")}..." value="${escapeHtml(state.modelSearch)}" />
        <div class="r001-popover-list">
          ${models
            .map((m) => {
              const isSel = Boolean(curObj && curObj.id === m.id);
              const levelsText = (m.effort?.effortLevels || []).map((l) => l.shortLabel || l.label).join(" · ");
              return `
                <button type="button" class="r001-model-item ${isSel ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(m.id)}">
                  <div class="r001-model-left">
                    ${renderLogoPlate(resolveModelLogoFile(m.id, provider, m.logoFile), provider?.monogram || "AI", provider?.color, "md")}
                    <div style="min-width:0;flex:1">
                      <div class="r001-model-name">${escapeHtml(m.label || m.id)}</div>
                      <div class="r001-model-desc">${escapeHtml(levelsText)}</div>
                    </div>
                  </div>
                  ${isSel ? `<span style="color:#38bdf8">${ICONS.check}</span>` : ""}
                </button>`;
            })
            .join("")}
        </div>
        ${renderEffortBar()}
      </div>
    `;
  }

  function renderSecondaryPopover() {
    if (state.activePopover === "permissions") return renderPermissionsPopover();

    if (state.activePopover === "workspace") {
      const ws = state.editorContext?.workspaceSummary;
      const q = state.workspaceSearch.trim().toLowerCase();
      const files = (ws?.files || []).filter((f) => !q || f.toLowerCase().includes(q));
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.folderTree}<span>Dự án (${escapeHtml(ws?.projectName || "Chưa mở")})</span></span>
            <div style="display:flex;gap:5px">
              <button type="button" class="r001-back-btn" data-action="refresh-workspace">${ICONS.refresh}<span>Quét</span></button>
              <button type="button" class="r001-back-btn" data-action="toggle-auto-workspace">${state.autoWorkspace ? "Đang bật" : "Đang tắt"}</button>
            </div>
          </div>
          ${
            ws && ws.fileCount > 0
              ? `<input type="text" class="r001-search" id="r001-ws-search" placeholder="Tìm nhanh tệp để đính kèm..." value="${escapeHtml(state.workspaceSearch)}" />
                 <div class="r001-popover-list">
                   ${!q && ws.treePreview ? `<pre class="r001-tree-pre">${escapeHtml(ws.treePreview)}</pre>` : ""}
                   ${files
                     .slice(0, 60)
                     .map((rel) => `<button type="button" class="r001-model-item" data-action="attach-project-file" data-rel="${escapeHtml(rel)}"><div class="r001-model-left">${ICONS.file}<span class="r001-mono-name">${escapeHtml(rel)}</span></div></button>`)
                     .join("")}
                 </div>`
              : `<div class="r001-empty-pop">Chưa mở thư mục dự án.</div>`
          }
        </div>
      `;
    }

    if (state.activePopover === "sync") {
      const tools = state.envSync?.cliTools || [];
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.blueprint}<span>Đồng bộ IDE & CLI (${escapeHtml(state.envSync?.ideName || "IDE")})</span></span>
            <button type="button" class="r001-back-btn" data-action="sync-env">${ICONS.refresh}<span>Đồng bộ</span></button>
          </div>
          <div class="r001-popover-list" style="padding:8px;gap:5px">
            ${tools
              .map((t) => `<div class="r001-eco-row"><span>${escapeHtml(t.label)}</span><span class="r001-eco-badge ${t.synced ? "synced" : t.detected ? "detected" : "idle"}">${t.synced ? "Đã đồng bộ" : t.detected ? "Đã phát hiện" : "Chưa cài"}</span></div>`)
              .join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "history") {
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.history}<span>Lịch sử tác vụ (${state.sessions.length})</span></span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            ${state.sessions
              .map(
                (s) => `
                <div class="r001-model-item ${s.id === state.activeSessionId ? "selected" : ""}" style="justify-content:space-between">
                  <button type="button" data-action="select-session" data-id="${escapeHtml(s.id)}" style="flex:1;min-width:0;border:none;background:transparent;color:inherit;text-align:left;cursor:pointer">
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
      const openTabs = state.editorContext?.openTabs || [];
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.folderTree}<span>Đính kèm ngữ cảnh</span></span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            <button type="button" class="r001-model-item" data-action="toggle-popover" data-popover="workspace"><div class="r001-model-left">${ICONS.folderTree}<div><div class="r001-model-name">Cây thư mục dự án</div><div class="r001-model-desc">Chọn tệp bất kỳ trong workspace</div></div></div></button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="activeFile"><div class="r001-model-left">${ICONS.file}<div><div class="r001-model-name">Tệp đang mở</div><div class="r001-model-desc">Đính kèm file hiện tại + Diagnostics</div></div></div></button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="selection"><div class="r001-model-left">${ICONS.scissors}<div><div class="r001-model-name">Đoạn đang bôi đen</div><div class="r001-model-desc">Chỉ gửi vùng chọn</div></div></div></button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="workspaceFile"><div class="r001-model-left">${ICONS.folder}<div><div class="r001-model-name">Quick Pick tệp...</div><div class="r001-model-desc">Tìm bằng hộp thoại IDE</div></div></div></button>
            ${openTabs.map((t) => `<button type="button" class="r001-model-item" data-action="attach-tab" data-uri="${escapeHtml(t.uri)}"><div class="r001-model-left">${ICONS.file}<div><div class="r001-model-name">${escapeHtml(t.fileName)}</div><div class="r001-model-desc">${escapeHtml(t.displayPath)}</div></div></div></button>`).join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "slash") {
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head"><span class="r001-popover-title">${ICONS.terminal}<span>Slash Commands</span></span></div>
          <div class="r001-popover-list">
            ${SLASH_COMMANDS.map((c) => `<button type="button" class="r001-model-item" data-action="run-slash" data-cmd="${escapeHtml(c.cmd)}"><div><div class="r001-mono-name">${escapeHtml(c.cmd)}</div><div class="r001-model-desc">${escapeHtml(c.desc)}</div></div></button>`).join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "mode") {
      const modes = [
        { id: "auto", label: "Auto Agent", desc: "Tự hành hoàn chỉnh: đọc, sửa tệp, chạy Terminal & xác minh" },
        { id: "plan", label: "Plan", desc: "Phân tích chỉ đọc & lập bản kế hoạch trước khi chỉnh sửa" },
        { id: "ask", label: "Ask", desc: "Hỏi đáp kiến trúc & tra cứu mã nguồn không sửa tệp" }
      ];
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head"><span class="r001-popover-title">${ICONS.bolt}<span>Chế độ thực thi</span></span></div>
          <div class="r001-popover-list">
            ${modes
              .map(
                (m) => `
              <button type="button" class="r001-model-item ${state.mode === m.id ? "selected" : ""}" data-action="set-mode" data-mode="${m.id}">
                <div class="r001-model-left">${ICONS.bolt}<div><div class="r001-model-name">${escapeHtml(m.label)}</div><div class="r001-model-desc">${escapeHtml(m.desc)}</div></div></div>
                ${state.mode === m.id ? `<span style="color:#38bdf8">${ICONS.check}</span>` : ""}
              </button>`
              )
              .join("")}
          </div>
        </div>
      `;
    }

    return "";
  }

  function renderAuthDialog() {
    return `
      <dialog id="r001-auth-dialog" class="r001-auth-dialog" closedby="any" aria-labelledby="r001-auth-title">
        <form class="r001-auth-card" id="r001-auth-form">
          <div class="r001-auth-head">
            ${renderGrok3DCore("avatar", "idle", false)}
            <div>
              <h1 id="r001-auth-title" class="r001-auth-title">Kết nối 001Router</h1>
              <div class="r001-auth-desc">Nhập URL & mật khẩu web 001Router để đồng bộ toàn bộ model.</div>
            </div>
          </div>
          <div class="r001-field">
            <label for="r001-auth-url">001Router Web URL</label>
            <input id="r001-auth-url" class="r001-input" type="text" placeholder="http://127.0.0.1:20128" value="${escapeHtml(state.authServerInput)}" required />
          </div>
          <div class="r001-field">
            <label for="r001-auth-pw">Mật khẩu Web</label>
            <div class="r001-input-wrap">
              <input id="r001-auth-pw" class="r001-input" type="${state.authShowPassword ? "text" : "password"}" placeholder="Nhập mật khẩu đăng nhập..." value="${escapeHtml(state.authPasswordInput)}" autofocus required style="padding-right:34px" />
              <button type="button" class="r001-eye-btn" data-action="toggle-pw" aria-label="Hiện/ẩn mật khẩu">${state.authShowPassword ? ICONS.eyeOff : ICONS.eye}</button>
            </div>
          </div>
          ${state.authError || state.lastError ? `<div class="r001-error-banner">${escapeHtml(state.authError || state.lastError)}</div>` : ""}
          <button type="submit" class="r001-primary-btn" ${state.authLoading ? "disabled" : ""}>${state.authLoading ? "Đang xác thực..." : "Xác nhận & Đồng bộ"}</button>
          ${state.connected ? `<button type="button" class="r001-secondary-btn" data-action="disconnect" style="color:#fca5a5">Ngắt kết nối</button>` : ""}
          <button type="button" class="r001-secondary-btn" data-action="close-auth">Đóng</button>
        </form>
      </dialog>
    `;
  }

  function renderContextStrip() {
    const ws = state.editorContext?.workspaceSummary;
    const af = state.editorContext?.activeFile;
    const folderPill =
      ws && ws.fileCount > 0
        ? `<button type="button" class="r001-folder-pill ${state.autoWorkspace ? "" : "muted"}" data-action="toggle-popover" data-popover="workspace">${ICONS.folderTree}<span class="r001-active-file-name">${escapeHtml(ws.projectName)}</span><span class="r001-folder-count">${ws.fileCount}${ws.truncated ? "+" : ""}</span></button>`
        : "";
    const activePill = af
      ? `<button type="button" class="r001-active-file-pill ${state.autoActiveFile ? "" : "muted"}" data-action="toggle-auto-file">${state.autoActiveFile ? ICONS.eye : ICONS.eyeOff}<span class="r001-active-file-name">${escapeHtml(af.fileName)} · ${escapeHtml(af.selectionLabel || `${af.lineCount}L`)}</span>${af.diagnosticErrors > 0 ? `<span class="r001-diag-tag">${af.diagnosticErrors}E</span>` : af.diagnosticWarnings > 0 ? `<span class="r001-diag-tag warn">${af.diagnosticWarnings}W</span>` : ""}</button>`
      : "";
    return `
      <div class="r001-context-strip">
        <div class="r001-context-pills">${folderPill || activePill ? `${folderPill}${activePill}` : `<span class="r001-subtle-tag">Mở thư mục dự án để Axiom tự hành</span>`}</div>
        <button type="button" class="r001-at-btn" data-action="toggle-popover" data-popover="attach">@ Tệp</button>
      </div>
    `;
  }

  function ensureLiveTicker() {
    const hasWork = Boolean(state.streamingSessionId) || state.terminalRuns.some((r) => r.status === "running");
    if (!hasWork) {
      if (liveTimerInterval) { clearInterval(liveTimerInterval); liveTimerInterval = null; }
      return;
    }
    if (liveTimerInterval) return;
    liveTimerInterval = setInterval(() => {
      document.querySelectorAll(".r001-live-elapsed[data-started]").forEach((el) => {
        const st = Number(el.dataset.started);
        if (st > 0) el.textContent = `· ${formatDuration(Date.now() - st)}`;
      });
      document.querySelectorAll(".r001-term-status.run[data-started]").forEach((el) => {
        const st = Number(el.dataset.started);
        if (st > 0) el.textContent = `RUNNING · ${formatDuration(Date.now() - st)}`;
      });
    }, 200);
  }

  function scrollToBottomIfNear() {
    const scrollEl = document.getElementById("r001-scroll");
    if (!scrollEl) return;
    if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function patchStreamingAssistantDom(msg, options = {}) {
    const container = document.getElementById(`msg-${msg.id}`);
    if (!container) { render(); return; }

    const awaiting = Array.isArray(msg.steps) && msg.steps.some((s) => s.status === "awaiting_approval");
    const phase = awaiting ? "approval" : msg.phase || (msg.text ? "streaming" : msg.reasoning ? "thinking" : "analyzing");

    const avatarCanvas = container.querySelector("canvas[data-grok3d]");
    if (avatarCanvas) avatarCanvas.dataset.mood = phase;
    const avatarWrap = container.querySelector(".grok3d-avatar-wrap");
    if (avatarWrap) avatarWrap.dataset.mood = phase;

    const titles = {
      approval: "Axiom · Chờ xác nhận quyền",
      terminal: "Axiom · Đang chạy Terminal",
      executing: "Axiom · Đang thực thi công cụ",
      analyzing: "Axiom · Đang quét hệ thống",
      thinking: "Axiom · Đang suy luận sâu",
      streaming: "Axiom · Đang phản hồi"
    };
    const personaEl = container.querySelector(".r001-ai-persona-label");
    if (personaEl) personaEl.textContent = titles[phase] || "Axiom";
    const subEl = container.querySelector(".r001-live-sub-text");
    if (subEl && msg.phaseDetail) subEl.textContent = msg.phaseDetail;

    if (options.updatePlan) {
      const planSlot = container.querySelector(".r001-plan-slot");
      if (planSlot) planSlot.innerHTML = renderPlanCard(msg.plan);
    }

    if (options.updateSteps) {
      const stepSlot = container.querySelector(".r001-steps-slot");
      if (stepSlot) {
        const openStates = new Map();
        stepSlot.querySelectorAll("details.r001-step-card").forEach((d) => {
          openStates.set(d.id, d.open);
        });
        stepSlot.innerHTML = renderTaskTimeline(msg, true);
        stepSlot.querySelectorAll("details.r001-step-card").forEach((d) => {
          if (openStates.has(d.id) && !d.classList.contains("status-awaiting_approval")) {
            d.open = openStates.get(d.id);
          }
        });
      }
    }

    if (options.updateText) {
      const mdEl = container.querySelector(".r001-markdown");
      if (mdEl) mdEl.innerHTML = renderMarkdown(msg.text, msg.id, true);
    }

    if (options.updateThinking) {
      const thinkWrap = container.querySelector(".r001-thinking-slot");
      if (thinkWrap) {
        const wasOpen = thinkWrap.querySelector("details")?.open ?? true;
        thinkWrap.innerHTML = renderThinkingCard(msg, true);
        const det = thinkWrap.querySelector("details");
        if (det) det.open = msg.text ? false : wasOpen;
      }
    }

    scrollToBottomIfNear();
  }

  function syncAuthDialogModal() {
    const dlg = document.getElementById("r001-auth-dialog");
    if (!dlg) return;
    if (state.authModalOpen && !dlg.open) {
      try { dlg.showModal(); } catch { /* ignore */ }
    } else if (!state.authModalOpen && dlg.open) {
      dlg.close();
    }
  }

  function render() {
    codeBlockCache.clear();
    const activeSession = getActiveSession();
    const messages = activeSession?.messages || [];
    const profile = getActiveEffortProfile();
    const stop = getCurrentEffortStop();
    const isSing = isSingularityStop(stop, profile);
    applyRootEffortVars(stop, profile);

    const selProvider = findSelectedProvider();
    const selModelObj = findSelectedModelObj();
    const cleanModelLabel =
      state.selection?.displayLabel || state.selection?.baseModelId || selModelObj?.label || selModelObj?.id || "Select Model";
    const selLogoFile = resolveModelLogoFile(cleanModelLabel, selProvider, selModelObj?.logoFile);
    const modeLabel = state.mode === "ask" ? "Ask" : state.mode === "plan" ? "Plan" : "Auto";
    const permBadge = getPermissionBadgeMeta();
    const isStreaming = Boolean(state.streamingSessionId && state.streamingSessionId === activeSession?.id);
    const totalModels = (state.catalog?.providers || []).reduce((acc, p) => acc + (p.modelCount || 0), 0);
    const syncedCliCount = (state.envSync?.cliTools || []).filter((t) => t.synced).length;
    const sessionTerminals = state.terminalRuns.filter((r) => !r.sessionId || r.sessionId === activeSession?.id);
    const hasRunningTerminal = sessionTerminals.some((r) => r.status === "running");
    const ws = state.editorContext?.workspaceSummary;

    const prevInput = document.getElementById("r001-input");
    const selStart = prevInput ? prevInput.selectionStart : null;
    const selEnd = prevInput ? prevInput.selectionEnd : null;
    const hadFocus = document.activeElement?.id === "r001-input";
    const heroMood = hasRunningTerminal ? "terminal" : state.isTypingDraft ? "listening" : "idle";

    root.innerHTML = `
      <div class="r001-shell">
        <header class="r001-topbar">
          <div class="r001-topbar-left">
            <span class="r001-brand-mark" aria-hidden="true">${ICONS.brandPrism}</span>
            <span class="r001-session-title">${escapeHtml(activeSession?.title || "001Router Agent")}</span>
            <button type="button" class="r001-conn-pill ${state.connected ? "connected" : ""}" data-action="open-auth" title="${escapeHtml(state.serverUrl)}">
              <span class="r001-conn-dot"></span>
              <span>${state.connected ? "Online" : "Connect"}</span>
            </button>
            <button type="button" class="r001-sync-pill" data-action="toggle-popover" data-popover="sync" title="Trạng thái đồng bộ IDE & CLI">
              <span>${escapeHtml(state.envSync?.ideKind === "antigravity" ? "AG" : "IDE")} · ${syncedCliCount}</span>
            </button>
          </div>
          <div class="r001-topbar-actions">
            ${surface === "sidebar" ? `<button type="button" class="r001-icon-btn" data-action="open-tab" aria-label="Mở sang Editor Tab" title="Mở sang Editor Tab">${ICONS.popout}</button>` : ""}
            <button type="button" class="r001-icon-btn ${activeSession?.bookmarked ? "active" : ""}" data-action="toggle-bookmark" aria-label="Đánh dấu" title="Đánh dấu">${activeSession?.bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</button>
            <button type="button" class="r001-icon-btn" data-action="toggle-popover" data-popover="history" aria-label="Lịch sử" title="Lịch sử">${ICONS.history}</button>
            <button type="button" class="r001-icon-btn" data-action="new-chat" aria-label="Tác vụ mới" title="Tác vụ mới">${ICONS.newChat}</button>
          </div>
        </header>

        <main class="r001-main" id="r001-scroll">
          ${
            messages.length === 0 && sessionTerminals.length === 0
              ? `
              <div class="r001-hero">
                <div class="r001-hero-brand">
                  <span style="color:var(--accent-primary-bright)">${ICONS.brandPrism}</span>
                  <span class="r001-hero-title">001Router</span>
                  <span class="r001-hero-subtag">v1.4 · Singularity Agent</span>
                </div>
                <div class="r001-hero-center">
                  ${renderGrok3DCore("hero", heroMood, isSing)}
                  <div class="r001-hero-name">Axiom Core</div>
                  <div class="r001-hero-subtitle">${
                    ws && ws.fileCount > 0
                      ? `Đã kết nối <strong>${escapeHtml(ws.projectName)}</strong> (${ws.fileCount}${ws.truncated ? "+" : ""} tệp) · Sẵn sàng đọc, sửa tệp & chạy Terminal liên tục.`
                      : `Trợ lý lập trình tự hành đồng bộ ${escapeHtml(state.envSync?.ideName || "IDE")}. Kéo thả lõi 3D để xoay.`
                  }</div>
                  <div class="r001-hero-telemetry">
                    <span>${(state.catalog?.providers || []).length} providers</span>
                    <span>·</span>
                    <span>${totalModels} models</span>
                    <span>·</span>
                    <button type="button" class="r001-inline-perm ${permBadge.cls}" data-action="toggle-popover" data-popover="permissions">${ICONS.shield}<span>${escapeHtml(permBadge.label)}</span></button>
                  </div>
                  <div class="r001-hero-quick">
                    <button type="button" class="r001-quick-pill" data-action="quick-prompt" data-prompt="Quét toàn bộ dự án đang mở, liệt kê cấu trúc thư mục, kiến trúc chính và các file quan trọng nhất">${ICONS.folderTree}<span>Quét toàn bộ dự án</span></button>
                    <button type="button" class="r001-quick-pill" data-action="quick-prompt" data-prompt="Kiểm tra lỗi Diagnostics trong IDE và chạy git status để báo cáo trạng thái hiện tại">${ICONS.terminal}<span>Kiểm tra lỗi & Git</span></button>
                    <button type="button" class="r001-quick-pill" data-action="toggle-popover" data-popover="permissions">${ICONS.shield}<span>Quyền & Terminal</span></button>
                  </div>
                </div>
                <div></div>
              </div>
            `
              : `
              <div class="r001-messages">
                ${messages
                  .map((m, idx) => {
                    if (m.role === "user") {
                      return `
                        <div class="r001-msg r001-msg-user">
                          ${
                            Array.isArray(m.attachments) && m.attachments.length
                              ? `<div class="r001-msg-attachments">${m.attachments.map((a) => `<span class="r001-chip ${a.isWorkspace ? "ws-chip" : ""}">${a.isWorkspace ? ICONS.folderTree : ICONS.file}<span>${escapeHtml(a.label || a.path)}</span></span>`).join("")}</div>`
                              : ""
                          }
                          <div>${escapeHtml(m.text)}</div>
                        </div>`;
                    }
                    const isLastStreaming = isStreaming && idx === messages.length - 1;
                    return `
                      <div class="r001-msg r001-msg-assistant" id="msg-${escapeHtml(m.id)}">
                        ${renderAssistantHeader(m, isLastStreaming, isLastStreaming && hasRunningTerminal, isSing)}
                        <div class="r001-plan-slot">${renderPlanCard(m.plan)}</div>
                        <div class="r001-steps-slot">${renderTaskTimeline(m, isLastStreaming)}</div>
                        <div class="r001-thinking-slot">${renderThinkingCard(m, isLastStreaming)}</div>
                        <div class="r001-markdown">${renderMarkdown(m.text, m.id, isLastStreaming)}</div>
                        ${m.error ? `<div class="r001-error-banner">${escapeHtml(m.error)}</div>` : ""}
                        ${
                          !isLastStreaming && idx === messages.length - 1 && (m.reachedStepCap || m.aborted)
                            ? `<div class="r001-continue-row"><button type="button" class="r001-continue-btn" data-action="continue-task">${ICONS.refresh}<span>Tiếp tục tác vụ còn dang dở</span></button></div>`
                            : ""
                        }
                      </div>`;
                  })
                  .join("")}
                ${sessionTerminals.map((r) => renderTerminalCard(r)).join("")}
              </div>
            `
          }
        </main>

        <footer class="r001-dock">
          ${state.activePopover === "model" ? renderModelPopover() : renderSecondaryPopover()}
          <div class="r001-composer" data-singularity="${isSing ? "1" : "0"}">
            ${renderContextStrip()}
            ${
              state.attachments.length
                ? `<div class="r001-composer-chips">${state.attachments.map((a) => `<span class="r001-chip">${ICONS.file}<span>${escapeHtml(a.label)}</span><button type="button" data-action="remove-attach" data-id="${escapeHtml(a.id)}">×</button></span>`).join("")}</div>`
                : ""
            }
            <textarea id="r001-input" class="r001-textarea" rows="1" placeholder="Giao việc cho Axiom (tự đọc, sửa file, chạy Terminal), @ tệp, hoặc /permissions...">${escapeHtml(state.draft)}</textarea>
            <div class="r001-toolbar">
              <div class="r001-toolbar-left">
                <button type="button" class="r001-tool-btn" data-action="toggle-popover" data-popover="attach" title="Đính kèm tệp">${ICONS.plus}</button>
                <button type="button" class="r001-tool-btn framed" data-action="toggle-popover" data-popover="slash" title="Slash Commands">${ICONS.slash}</button>
                <button type="button" class="r001-model-pill" data-action="open-model-picker" data-singularity="${isSing ? "1" : "0"}" title="${escapeHtml(`${state.selection?.providerName || "Provider"} · ${cleanModelLabel} (${stop.label})`)}">
                  ${renderLogoPlate(selLogoFile, selProvider?.monogram || "01", selProvider?.color, "sm")}
                  <span class="r001-model-pill-name">${escapeHtml(cleanModelLabel)}</span>
                  <span class="r001-model-pill-effort"><span class="r001-pill-orb"></span><span>${escapeHtml(stop.shortLabel || stop.label)}</span></span>
                </button>
              </div>
              <div class="r001-toolbar-right">
                <button type="button" class="r001-perm-btn ${permBadge.cls}" data-action="toggle-popover" data-popover="permissions" title="${escapeHtml(permBadge.title)}">
                  ${ICONS.shield}
                  <span>${escapeHtml(permBadge.label)}</span>
                </button>
                <button type="button" class="r001-mode-btn" data-action="toggle-popover" data-popover="mode" title="Chế độ thực thi">
                  ${ICONS.bolt}
                  <span>${escapeHtml(modeLabel)}</span>
                </button>
                ${
                  isStreaming
                    ? `<button type="button" class="r001-send-btn streaming" data-action="abort-chat" aria-label="Dừng" title="Dừng tác vụ">${ICONS.stop}</button>`
                    : `<button type="button" class="r001-send-btn" id="r001-send-btn" data-action="send-chat" aria-label="Gửi" title="Gửi (Enter)">${ICONS.arrowUp}</button>`
                }
              </div>
            </div>
          </div>
        </footer>

        ${renderAuthDialog()}
      </div>
    `;

    bindDynamicListeners(hadFocus, selStart, selEnd);
    syncAuthDialogModal();
    ensureLiveTicker();
    window.GrokSingularity3D?.setPaused(state.fxPaused);
    window.GrokSingularity3D?.mountAll(root);
    if (messages.length > 0 || sessionTerminals.length > 0) {
      const scrollEl = document.getElementById("r001-scroll");
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function submitChat(overrideText) {
    if (!state.connected) {
      state.authModalOpen = true;
      render();
      return;
    }
    const text = (overrideText !== undefined ? overrideText : state.draft).trim();
    if (!text && state.attachments.length === 0) return;

    const session = getActiveSession();
    const attachments = [...state.attachments];
    state.draft = "";
    state.isTypingDraft = false;
    state.attachments = [];
    state.activePopover = null;
    if (!/^\/run\s+/i.test(text)) {
      state.streamingSessionId = session?.id || "pending";
    }

    vscode.postMessage({
      type: "sendChat",
      sessionId: session?.id,
      text,
      attachments,
      includeActiveFile: state.autoActiveFile,
      includeWorkspace: state.autoWorkspace,
      mode: state.mode,
      selection: state.selection
    });
    render();
  }

  function bindDynamicListeners(hadFocus, selStart, selEnd) {
    const inputEl = document.getElementById("r001-input");
    if (inputEl) {
      const autoResize = () => {
        inputEl.style.height = "auto";
        inputEl.style.height = `${Math.min(160, Math.max(36, inputEl.scrollHeight))}px`;
      };
      autoResize();
      if (hadFocus) {
        inputEl.focus();
        if (selStart !== null && selEnd !== null) inputEl.setSelectionRange(selStart, selEnd);
      }
      inputEl.addEventListener("input", () => {
        state.draft = inputEl.value;
        autoResize();
        state.isTypingDraft = Boolean(state.draft.trim());
        const heroCv = document.querySelector(".grok3d-hero-wrap canvas");
        if (heroCv) heroCv.dataset.mood = state.isTypingDraft ? "listening" : "idle";
        if (typingIdleTimer) clearTimeout(typingIdleTimer);
        typingIdleTimer = setTimeout(() => {
          state.isTypingDraft = false;
          const cv = document.querySelector(".grok3d-hero-wrap canvas");
          if (cv) cv.dataset.mood = "idle";
        }, 1200);
        if (state.draft === "/") { state.activePopover = "slash"; render(); }
        else if (state.draft.endsWith("@")) { state.activePopover = "attach"; render(); }
      });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (state.draft.trim() === "/permissions") {
            state.draft = "";
            state.activePopover = "permissions";
            render();
            return;
          }
          submitChat();
        } else if (e.key === "Escape" && state.activePopover) {
          state.activePopover = null;
          render();
        }
      });
    }

    const authForm = document.getElementById("r001-auth-form");
    if (authForm) {
      authForm.addEventListener("submit", (e) => {
        e.preventDefault();
        state.authServerInput = document.getElementById("r001-auth-url")?.value || state.authServerInput;
        state.authPasswordInput = document.getElementById("r001-auth-pw")?.value || "";
        state.authLoading = true;
        state.authError = "";
        render();
        vscode.postMessage({ type: "connect", serverUrl: state.authServerInput, password: state.authPasswordInput });
      });
    }

    const authDlg = document.getElementById("r001-auth-dialog");
    if (authDlg) {
      authDlg.addEventListener("close", () => {
        authDlg.returnValue = "";
        if (state.authModalOpen) {
          state.authModalOpen = false;
          render();
        }
      });
    }

    const bindSearch = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", (e) => {
        state[key] = e.target.value;
        render();
        const next = document.getElementById(id);
        if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      });
    };
    bindSearch("r001-provider-search", "providerSearch");
    bindSearch("r001-model-search", "modelSearch");
    bindSearch("r001-ws-search", "workspaceSearch");
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) {
      if (state.activePopover && !e.target.closest("#r001-popover") && !e.target.closest(".r001-toolbar") && !e.target.closest(".r001-topbar") && !e.target.closest(".r001-context-strip")) {
        state.activePopover = null;
        render();
      }
      return;
    }

    const action = btn.dataset.action;
    switch (action) {
      case "open-auth": state.authModalOpen = true; state.authError = ""; render(); break;
      case "close-auth": state.authModalOpen = false; render(); break;
      case "toggle-pw": state.authShowPassword = !state.authShowPassword; render(); break;
      case "toggle-fx":
        state.fxPaused = !state.fxPaused;
        window.GrokSingularity3D?.setPaused(state.fxPaused);
        render();
        break;
      case "disconnect":
        state.authPasswordInput = "";
        state.authModalOpen = true;
        vscode.postMessage({ type: "disconnect" });
        break;
      case "open-tab": vscode.postMessage({ type: "openExternalPanel" }); break;
      case "new-chat": state.activePopover = null; vscode.postMessage({ type: "newChat" }); break;
      case "toggle-bookmark": {
        const s = getActiveSession();
        if (s) vscode.postMessage({ type: "toggleBookmark", sessionId: s.id });
        break;
      }
      case "toggle-popover": {
        const target = btn.dataset.popover;
        state.activePopover = state.activePopover === target ? null : target;
        if (state.activePopover === "workspace") {
          state.workspaceSearch = "";
          vscode.postMessage({ type: "refreshWorkspace" });
        }
        render();
        break;
      }
      case "close-popover": state.activePopover = null; render(); break;
      case "sync-env": vscode.postMessage({ type: "syncEnv" }); break;
      case "refresh-workspace": vscode.postMessage({ type: "refreshWorkspace" }); break;
      case "toggle-auto-workspace":
        state.autoWorkspace = !state.autoWorkspace;
        vscode.postMessage({ type: "saveAutoWorkspace", enabled: state.autoWorkspace });
        render();
        break;
      case "toggle-auto-file":
        state.autoActiveFile = !state.autoActiveFile;
        vscode.postMessage({ type: "saveAutoActiveFile", enabled: state.autoActiveFile });
        render();
        break;
      case "set-perm-preset": {
        const preset = btn.dataset.preset;
        vscode.postMessage({ type: "applyPermissionPreset", preset });
        break;
      }
      case "toggle-perm": {
        const key = btn.dataset.key;
        if (key) {
          const next = { ...state.permissions, [key]: !state.permissions[key] };
          state.permissions = next;
          vscode.postMessage({ type: "savePermissions", permissions: next });
          render();
        }
        break;
      }
      case "set-max-steps": {
        const val = Number(btn.dataset.steps);
        const next = { ...state.permissions, maxSteps: Number.isFinite(val) ? val : 35 };
        state.permissions = next;
        vscode.postMessage({ type: "savePermissions", permissions: next });
        render();
        break;
      }
      case "resolve-approval":
        vscode.postMessage({
          type: "resolveApproval",
          approvalId: btn.dataset.approval,
          decision: btn.dataset.decision || "deny"
        });
        break;
      case "continue-task":
        submitChat("Hãy tiếp tục hoàn thành các bước còn lại của tác vụ ngay từ điểm vừa dừng.");
        break;
      case "attach-project-file":
        if (btn.dataset.rel) {
          state.activePopover = null;
          render();
          vscode.postMessage({ type: "pickContext", kind: "projectFile", uri: btn.dataset.rel });
        }
        break;
      case "reveal-path":
        if (btn.dataset.path) vscode.postMessage({ type: "revealFile", uri: btn.dataset.path });
        break;
      case "quick-prompt": submitChat(btn.dataset.prompt || ""); break;
      case "open-model-picker":
        if (state.activePopover === "model") state.activePopover = null;
        else {
          state.activePopover = "model";
          state.inspectingProviderSlug = state.selection?.providerSlug || null;
          state.pickerStep = state.selection?.providerSlug ? "models" : "providers";
        }
        render();
        break;
      case "open-provider":
        state.inspectingProviderSlug = btn.dataset.slug;
        state.pickerStep = "models";
        state.modelSearch = "";
        render();
        break;
      case "back-providers": state.pickerStep = "providers"; render(); break;
      case "select-model": {
        const prov = (state.catalog?.providers || []).find((p) => p.slug === btn.dataset.slug);
        const mod = prov?.models?.find((m) => m.id === btn.dataset.model);
        if (prov && mod) {
          state.selection = buildSyncedSelection(prov, mod, state.selection?.effort);
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
          render();
        }
        break;
      }
      case "pick-effort-tier": {
        const tierId = btn.dataset.tier;
        const prov = findSelectedProvider();
        const mod = findModelInProvider(prov, state.selection);
        if (prov && mod && state.selection?.kind !== "combo") {
          state.selection = buildSyncedSelection(prov, mod, tierId);
        } else if (state.selection) {
          state.selection = { ...state.selection, effort: tierId };
        }
        vscode.postMessage({ type: "saveSelection", selection: state.selection });
        render();
        break;
      }
      case "select-combo": {
        const combo = (state.catalog?.combos || []).find((c) => c.name === btn.dataset.combo);
        if (combo) {
          state.selection = {
            kind: "combo", providerSlug: "combo", providerName: "Combo", providerPreset: "combo",
            providerColor: "#e57452", baseModelId: combo.name, displayLabel: combo.name,
            modelId: combo.name, fullId: combo.name, effort: combo.effort?.defaultEffort || "medium"
          };
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
          state.activePopover = null;
          render();
        }
        break;
      }
      case "refresh-catalog": vscode.postMessage({ type: "refreshCatalog" }); break;
      case "select-session": state.activePopover = null; vscode.postMessage({ type: "selectSession", sessionId: btn.dataset.id }); break;
      case "delete-session": vscode.postMessage({ type: "deleteSession", sessionId: btn.dataset.id }); break;
      case "attach-ctx":
        if (state.draft.endsWith("@")) state.draft = state.draft.slice(0, -1);
        state.activePopover = null;
        render();
        vscode.postMessage({ type: "pickContext", kind: btn.dataset.kind });
        break;
      case "attach-tab":
        if (state.draft.endsWith("@")) state.draft = state.draft.slice(0, -1);
        state.activePopover = null;
        render();
        vscode.postMessage({ type: "pickContext", kind: "openTab", uri: btn.dataset.uri });
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
        if (cmd === "/permissions") state.activePopover = "permissions";
        else if (cmd === "/provider") { state.activePopover = "model"; state.pickerStep = "providers"; }
        else if (cmd === "/workspace") { state.activePopover = "workspace"; vscode.postMessage({ type: "refreshWorkspace" }); }
        else if (cmd === "/sync") vscode.postMessage({ type: "syncEnv" });
        else if (cmd === "/run ") state.draft = "/run ";
        else if (cmd === "/new") vscode.postMessage({ type: "newChat" });
        else if (cmd === "/connect") state.authModalOpen = true;
        render();
        break;
      }
      case "send-chat": submitChat(); break;
      case "abort-chat": vscode.postMessage({ type: "abortChat" }); break;
      case "copy-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) {
          navigator.clipboard?.writeText(code);
          state.copiedBlockId = btn.dataset.block;
          render();
          setTimeout(() => { if (state.copiedBlockId === btn.dataset.block) { state.copiedBlockId = null; render(); } }, 1400);
        }
        break;
      }
      case "apply-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) vscode.postMessage({ type: "applyCode", code });
        break;
      }
      case "run-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) vscode.postMessage({ type: "runCommand", command: code.trim(), sessionId: getActiveSession()?.id });
        break;
      }
      case "kill-term": vscode.postMessage({ type: "killCommand", runId: btn.dataset.run }); break;
      case "open-ide-term": vscode.postMessage({ type: "openInTerminal", command: btn.dataset.cmd || "" }); break;
      case "fix-term-error": {
        const run = state.terminalRuns.find((r) => r.runId === btn.dataset.run);
        if (run) {
          submitChat(`Lệnh \`${run.command}\` thất bại (Exit ${run.exitCode}).\nOutput:\n\`\`\`\n${(run.output || "").slice(-3000)}\n\`\`\`\nHãy phân tích nguyên nhân và sửa trực tiếp.`);
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
        if (!state.authModalOpen) state.authServerInput = state.serverUrl;
        state.catalog = msg.catalog || state.catalog;
        state.selection = msg.selection || state.selection;
        state.mode = msg.mode || state.mode;
        if (msg.permissions) state.permissions = { ...DEFAULT_PERMS, ...msg.permissions };
        if (typeof msg.autoActiveFile === "boolean") state.autoActiveFile = msg.autoActiveFile;
        if (typeof msg.autoWorkspace === "boolean") state.autoWorkspace = msg.autoWorkspace;
        if (msg.envSync) state.envSync = msg.envSync;
        if (msg.editorContext) state.editorContext = msg.editorContext;
        state.sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
        state.activeSessionId = msg.activeSessionId || state.sessions[0]?.id || null;
        state.lastError = msg.lastError || "";
        if (!state.connected && state.lastError) state.authModalOpen = true;
        render();
        break;

      case "permissionsUpdated":
        if (msg.permissions) {
          state.permissions = { ...DEFAULT_PERMS, ...msg.permissions };
          render();
        }
        break;

      case "editorContext":
        if (msg.editorContext) {
          state.editorContext = msg.editorContext;
          if (!state.streamingSessionId) render();
        }
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
        if (msg.item) { state.attachments.push(msg.item); render(); }
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
          if (msg.deltaText) target.text = (target.text || "") + msg.deltaText;
          if (msg.deltaReasoning) target.reasoning = (target.reasoning || "") + msg.deltaReasoning;
          if (msg.phase) target.phase = msg.phase;
          if (msg.phaseDetail) target.phaseDetail = msg.phaseDetail;
          patchStreamingAssistantDom(target, {
            updateText: Boolean(msg.deltaText),
            updateThinking: Boolean(msg.deltaReasoning || msg.deltaText)
          });
        }
        break;
      }

      case "streamStep": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        if (target && msg.step) {
          if (!Array.isArray(target.steps)) target.steps = [];
          const idx = target.steps.findIndex((s) => s.stepId === msg.step.stepId);
          if (idx >= 0) target.steps[idx] = msg.step;
          else target.steps.push(msg.step);
          patchStreamingAssistantDom(target, { updateSteps: true });
        }
        break;
      }

      case "streamStepOutput": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        const step = target?.steps?.find((s) => s.stepId === msg.stepId);
        if (step) {
          step.output = `${step.output || ""}${msg.chunk || ""}`.slice(-28000);
          const pre = document.querySelector(`#step-${CSS.escape(step.stepId)} .r001-step-pre`);
          if (pre) {
            pre.textContent = step.output;
            pre.scrollTop = pre.scrollHeight;
            scrollToBottomIfNear();
          } else {
            patchStreamingAssistantDom(target, { updateSteps: true });
          }
        }
        break;
      }

      case "streamPlan": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        if (target && Array.isArray(msg.plan)) {
          target.plan = msg.plan;
          patchStreamingAssistantDom(target, { updatePlan: true });
        }
        break;
      }

      case "streamError": {
        state.streamingSessionId = null;
        state.lastError = msg.error || "Có lỗi xảy ra.";
        const sess = state.sessions.find((s) => s.id === (msg.sessionId || state.activeSessionId));
        if (sess) {
          sess.messages.push({ id: `err-${Date.now()}`, role: "assistant", text: "", phase: "done", error: state.lastError });
        }
        render();
        break;
      }

      case "streamEnd": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        if (target) {
          target.phase = "done";
          if (!target.text && msg.finalText) target.text = msg.finalText;
          if (msg.durationMs) target.durationMs = msg.durationMs;
          if (msg.totalTokens) target.totalTokens = msg.totalTokens;
          if (msg.reachedStepCap) target.reachedStepCap = true;
          if (msg.aborted) target.aborted = true;
          if (msg.error) target.error = msg.error;
        }
        state.streamingSessionId = null;
        render();
        break;
      }

      case "terminalStart":
        state.terminalRuns.push({
          runId: msg.runId, sessionId: msg.sessionId || state.activeSessionId, command: msg.command,
          cwd: msg.cwd, startedAt: msg.startedAt || Date.now(), status: "running", output: "", exitCode: null, durationMs: 0
        });
        render();
        break;

      case "terminalOutput": {
        const run = state.terminalRuns.find((r) => r.runId === msg.runId);
        if (run) {
          run.output = (run.output || "") + (msg.chunk || "");
          const outEl = document.querySelector(`#term-${CSS.escape(run.runId)} .r001-terminal-out`);
          if (outEl) { outEl.textContent = run.output; outEl.scrollTop = outEl.scrollHeight; }
          else render();
        }
        break;
      }

      case "terminalEnd": {
        const run = state.terminalRuns.find((r) => r.runId === msg.runId);
        if (run) {
          run.status = "done";
          run.exitCode = typeof msg.exitCode === "number" ? msg.exitCode : 0;
          run.durationMs = msg.durationMs || Date.now() - run.startedAt;
          if (msg.output) run.output = msg.output;
          if (msg.error) run.output = `${run.output ? `${run.output}\n` : ""}${msg.error}`;
          render();
        }
        break;
      }

      case "focusInput": {
        const el = document.getElementById("r001-input");
        if (el) { if (document.activeElement === el) el.blur(); else el.focus(); }
        break;
      }

      case "openAuthModal":
        state.authModalOpen = true;
        render();
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
