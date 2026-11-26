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
    "bash",
    "sh",
    "zsh",
    "shell",
    "console",
    "powershell",
    "ps1",
    "pwsh",
    "cmd",
    "bat"
  ]);

  // Precision geometric architectural SVG icon set (24x24 grid, 1.65px stroke, decorative aria-hidden)
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
      '<svg class="r001-svg" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    chevronRight:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    file:
      '<svg class="r001-svg" aria-hidden="true" width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
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
      '<svg class="r001-svg" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    brain:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.6"/><circle cx="5.5" cy="7.5" r="2"/><circle cx="18.5" cy="7.5" r="2"/><circle cx="5.5" cy="16.5" r="2"/><circle cx="18.5" cy="16.5" r="2"/><line x1="7.2" y1="8.7" x2="9.8" y2="10.6"/><line x1="16.8" y1="8.7" x2="14.2" y2="10.6"/><line x1="7.2" y1="15.3" x2="9.8" y2="13.4"/><line x1="16.8" y1="15.3" x2="14.2" y2="13.4"/></svg>',
    blueprint:
      '<svg class="r001-svg" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>'
  };

  const LIGHT_PLATE_FILES = new Set([
    "xai.png",
    "openai.png",
    "deepseek.png",
    "gemini.png",
    "antigravity.png",
    "gemini-cli.png",
    "openrouter.png",
    "glm.png",
    "nous.png",
    "cohere.png",
    "vertex.png",
    "tencent.png",
    "byteplus.png",
    "cloudflare-ai.png",
    "azure.png",
    "gitlab.png",
    "huggingface.png",
    "github.png",
    "vercel-ai-gateway.png",
    "venice.png",
    "ollama.png",
    "chutes.png",
    "featherless.png",
    "novita.png",
    "agentrouter.png"
  ]);

  const DEEPEN_GRAY_FILES = new Set(["xai.png", "glm.png", "nous.png", "openrouter.png"]);

  const EFFORT_THEME = {
    low: {
      color: "#10B981",
      accent: "#2DD4BF",
      glow: "rgba(16, 185, 129, 0.48)",
      badge: "AETHER · LOW",
      realm: "Làn sương Ngọc Lục — phản hồi tức thì & tiết kiệm",
      rgbA: [16, 185, 129],
      rgbB: [45, 212, 191],
      rgbC: [110, 231, 183]
    },
    medium: {
      color: "#38BDF8",
      accent: "#6366F1",
      glow: "rgba(56, 189, 248, 0.54)",
      badge: "ASTRAL · MED",
      realm: "Tinh vân Lam Ngọc — cân bằng tốc độ & phân tích",
      rgbA: [56, 189, 248],
      rgbB: [99, 102, 241],
      rgbC: [129, 140, 248]
    },
    high: {
      color: "#F97316",
      accent: "#F59E0B",
      glow: "rgba(249, 115, 22, 0.64)",
      badge: "SOLAR · HIGH",
      realm: "Siêu tân tinh Nhật Hoa — suy luận đa tầng sâu sắc",
      rgbA: [249, 115, 22],
      rgbB: [251, 191, 36],
      rgbC: [251, 113, 133]
    },
    xhigh: {
      color: "#EC4899",
      accent: "#A855F7",
      glow: "rgba(236, 72, 153, 0.8)",
      badge: "SINGULARITY · XHIGH",
      realm: "Chân trời Sự kiện — huyền ảo cực hạn & tư duy sâu nhất",
      rgbA: [236, 72, 153],
      rgbB: [168, 85, 247],
      rgbC: [253, 224, 71]
    },
    max: {
      color: "#D946EF",
      accent: "#A855F7",
      glow: "rgba(217, 70, 239, 0.84)",
      badge: "SINGULARITY · MAX",
      realm: "Hố Đen Vô Cực — giải phóng toàn bộ năng lực suy luận",
      rgbA: [217, 70, 239],
      rgbB: [168, 85, 247],
      rgbC: [253, 224, 71]
    }
  };

  const SLASH_COMMANDS = [
    { cmd: "/provider", desc: "Mở bộ chọn Provider -> Model đồng bộ" },
    { cmd: "/effort", desc: "Tinh chỉnh sức mạnh Effort (Low / Med / High / XHigh / Max)" },
    { cmd: "/workspace", desc: "Xem toàn bộ cây thư mục dự án đang mở" },
    { cmd: "/sync", desc: "Đồng bộ lại Antigravity, CLI & VS Code ngay lập tức" },
    { cmd: "/run ", desc: "Chạy lệnh Terminal trực tiếp ngay trong khung chat" },
    { cmd: "/new", desc: "Bắt đầu cuộc trò chuyện mới" },
    { cmd: "/connect", desc: "Mở xác thực mật khẩu web 001Router" }
  ];

  const state = {
    connected: false,
    serverUrl: "http://127.0.0.1:20128",
    catalog: { providers: [], combos: [], aliases: {} },
    selection: null,
    mode: "auto",
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

  const fxState = {
    ratio: 0.33,
    singularity: 0,
    targetSingularity: 0,
    lastTierId: "",
    rgbA: [56, 189, 248],
    rgbB: [99, 102, 241],
    rgbC: [129, 140, 248],
    rafId: null,
    particles: [],
    bursts: [],
    time: 0
  };

  let liveTimerInterval = null;
  let typingIdleTimer = null;
  let botSvgCounter = 0;
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
    const combined = `${provider?.preset || ""} ${provider?.slug || ""} ${provider?.name || ""}`.toLowerCase();
    if (combined.includes("antigravity")) return "antigravity.png";
    if (combined.includes("anthropic") || combined.includes("claude")) return "anthropic.png";
    if (combined.includes("openai") || combined.includes("codex")) return "openai.png";
    if (combined.includes("gemini-cli")) return "gemini-cli.png";
    if (combined.includes("gemini") || combined.includes("google")) return "gemini.png";
    if (combined.includes("xai") || combined.includes("grok")) return "xai.png";
    if (combined.includes("deepseek")) return "deepseek.png";
    if (combined.includes("qwen") || combined.includes("alibaba")) return "qwen.png";
    if (combined.includes("kimi") || combined.includes("moonshot")) return "kimi.png";
    if (combined.includes("glm") || combined.includes("zhipu")) return "glm.png";
    if (combined.includes("groq")) return "groq.png";
    if (combined.includes("openrouter")) return "openrouter.png";
    if (combined.includes("mistral")) return "mistral.png";
    if (combined.includes("minimax")) return "minimax.png";
    if (combined.includes("cohere")) return "cohere.png";
    if (combined.includes("nvidia")) return "nvidia.png";
    if (combined.includes("cerebras")) return "cerebras.png";
    if (combined.includes("sambanova")) return "sambanova.png";
    if (combined.includes("huggingface")) return "huggingface.png";
    if (combined.includes("perplexity")) return "perplexity.png";
    if (combined.includes("together")) return "together.png";
    if (combined.includes("fireworks")) return "fireworks.png";
    if (combined.includes("ollama")) return "ollama.png";
    if (combined.includes("azure")) return "azure.png";
    if (combined.includes("bedrock")) return "bedrock.png";
    if (combined.includes("vertex")) return "vertex.png";
    if (combined.includes("gitlab")) return "gitlab.png";
    if (combined.includes("vercel")) return "vercel-ai-gateway.png";
    if (combined.includes("siliconflow")) return "siliconflow.png";
    if (combined.includes("venice")) return "venice.png";
    if (combined.includes("nous")) return "nous.png";
    if (combined.includes("xiaomi")) return "xiaomi-mimo.png";
    if (combined.includes("agentrouter")) return "agentrouter.png";
    return "";
  }

  function resolveModelLogoFile(modelId, provider, explicitLogoFile) {
    if (explicitLogoFile) return explicitLogoFile;
    const lower = String(modelId || "").toLowerCase();
    if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus") || lower.includes("haiku") || lower.includes("fable")) {
      return "claude.png";
    }
    if (lower.includes("gemini") || lower.includes("gemma") || lower.includes("imagen")) {
      return "gemini.png";
    }
    if (lower.includes("codex")) return "codex.png";
    if (lower.includes("gpt-") || lower.includes("chatgpt") || /^o[134]($|-)/.test(lower) || lower.includes("openai/")) {
      return "openai.png";
    }
    if (lower.includes("grok") || lower.includes("x-ai/")) return "xai.png";
    if (lower.includes("deepseek")) return "deepseek.png";
    if (lower.includes("qwen") || lower.includes("qwq")) return "qwen.png";
    if (lower.includes("kimi") || lower.includes("moonshot")) return "kimi.png";
    if (lower.includes("glm") || lower.includes("zhipu")) return "glm.png";
    if (lower.includes("llama") || lower.includes("meta-llama") || lower.includes("meta/")) return "muse.png";
    if (lower.includes("mistral") || lower.includes("mixtral") || lower.includes("codestral")) return "mistral.png";
    if (lower.includes("minimax") || lower.includes("abab")) return "minimax.png";
    if (lower.includes("command-") || lower.includes("cohere")) return "cohere.png";
    if (lower.includes("sonar") || lower.includes("perplexity")) return "perplexity.png";
    if (lower.includes("mimo")) return "xiaomi-mimo.png";
    return resolveProviderLogoFile(provider);
  }

  function renderLogoPlate(logoFile, monogram, color, sizeClass) {
    const cleanFile = String(logoFile || "").trim();
    if (cleanFile && providersBaseUri) {
      const isLight = LIGHT_PLATE_FILES.has(cleanFile);
      const isDeep = DEEPEN_GRAY_FILES.has(cleanFile);
      const src = `${providersBaseUri}/${encodeURIComponent(cleanFile)}`;
      return (
        `<span class="r001-logo-plate ${sizeClass} ${isLight ? "light-plate" : ""} ${isDeep ? "deepen-gray" : ""}">` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(monogram || "AI")}" loading="eager" />` +
        `</span>`
      );
    }
    return (
      `<span class="r001-logo-plate ${sizeClass}">` +
      `<span class="r001-logo-monogram" style="background:${escapeHtml(color || "#e57452")}">${escapeHtml(monogram || "01")}</span>` +
      `</span>`
    );
  }

  /**
   * Render Axiom — Grok-inspired expressive animated SVG companion bot with live facial expressions,
   * blinking, gaze tracking, voice-waveform mouth, scanning optics, and singularity star-eyes.
   */
  function renderAxiomBot(sizeVariant, mood, isSingularity) {
    const cleanMood = mood || "idle";
    const uid = `ax${++botSvgCounter}`;
    return `
      <div class="axiom-bot ${escapeHtml(sizeVariant)}" data-mood="${escapeHtml(cleanMood)}" data-singularity="${isSingularity ? "1" : "0"}" data-fx-paused="${state.fxPaused ? "1" : "0"}" role="img" aria-label="Axiom AI">
        <span class="axiom-bot-aura" aria-hidden="true"></span>
        <span class="axiom-bot-ring" aria-hidden="true"></span>
        <svg class="axiom-bot-svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-shell" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#353d4f" />
              <stop offset="48%" stop-color="#1e2430" />
              <stop offset="100%" stop-color="#10131b" />
            </linearGradient>
            <linearGradient id="${uid}-rim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(255,255,255,0.42)" />
              <stop offset="100%" stop-color="rgba(255,255,255,0.06)" />
            </linearGradient>
            <linearGradient id="${uid}-visor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0b101b" />
              <stop offset="100%" stop-color="#05070c" />
            </linearGradient>
            <linearGradient id="${uid}-eye" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff" />
              <stop offset="35%" stop-color="var(--bot-accent)" />
              <stop offset="100%" stop-color="var(--bot-accent-2)" />
            </linearGradient>
            <linearGradient id="${uid}-scan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="transparent" />
              <stop offset="50%" stop-color="var(--bot-accent)" stop-opacity="0.7" />
              <stop offset="100%" stop-color="transparent" />
            </linearGradient>
            <clipPath id="${uid}-visor-clip">
              <rect x="20" y="34" width="60" height="40" rx="14" />
            </clipPath>
          </defs>

          <g class="axiom-head-group">
            <!-- Telemetry Antenna -->
            <line x1="50" y1="12" x2="50" y2="23" stroke="#535f78" stroke-width="2.6" stroke-linecap="round" />
            <circle class="axiom-antenna-tip" cx="50" cy="10.5" r="4.2" />
            <circle cx="48.8" cy="9.2" r="1.3" fill="#ffffff" opacity="0.85" />

            <!-- Side Ear Acoustic Pods -->
            <rect x="8.5" y="43" width="6.5" height="20" rx="3.2" fill="#232a38" stroke="rgba(255,255,255,0.16)" stroke-width="1" />
            <rect x="85" y="43" width="6.5" height="20" rx="3.2" fill="#232a38" stroke="rgba(255,255,255,0.16)" stroke-width="1" />
            <line x1="11.8" y1="48" x2="11.8" y2="58" stroke="var(--bot-accent)" stroke-width="1.6" stroke-linecap="round" opacity="0.75" />
            <line x1="88.2" y1="48" x2="88.2" y2="58" stroke="var(--bot-accent)" stroke-width="1.6" stroke-linecap="round" opacity="0.75" />

            <!-- Sculpted Titanium Chassis -->
            <rect x="14" y="23" width="72" height="62" rx="22" fill="url(#${uid}-shell)" stroke="url(#${uid}-rim)" stroke-width="1.6" />
            <path d="M 27 25.5 Q 50 23 73 25.5" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" stroke-linecap="round" />

            <!-- Smoked Curved OLED Face Visor -->
            <rect x="20" y="34" width="60" height="40" rx="14" fill="url(#${uid}-visor)" stroke="rgba(255,255,255,0.12)" stroke-width="1.2" />
            <path d="M 26 37.5 Q 50 35 74 37.5" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.2" stroke-linecap="round" />

            <!-- Expressive Face Rig inside Visor -->
            <g clip-path="url(#${uid}-visor-clip)">
              <rect class="axiom-scan-beam" x="42" y="34" width="16" height="40" fill="url(#${uid}-scan)" />

              <g class="axiom-face-rig">
                <!-- Soft Cheek Luminescence -->
                <ellipse class="axiom-cheek" cx="29" cy="60" rx="4.2" ry="2.2" fill="var(--bot-accent)" />
                <ellipse class="axiom-cheek" cx="71" cy="60" rx="4.2" ry="2.2" fill="var(--bot-accent)" />

                <!-- Expressive Brows -->
                <line class="axiom-brow axiom-brow-l" x1="30" y1="42" x2="42" y2="42" stroke="var(--bot-accent)" stroke-width="2.2" stroke-linecap="round" />
                <line class="axiom-brow axiom-brow-r" x1="58" y1="42" x2="70" y2="42" stroke="var(--bot-accent)" stroke-width="2.2" stroke-linecap="round" />

                <!-- Standard Living Eyes -->
                <g class="axiom-eye-group">
                  <rect x="31" y="45" width="10.5" height="12.5" rx="5.2" fill="url(#${uid}-eye)" />
                  <circle cx="34.2" cy="48.5" r="1.9" fill="#ffffff" opacity="0.95" />
                  <rect x="58.5" y="45" width="10.5" height="12.5" rx="5.2" fill="url(#${uid}-eye)" />
                  <circle cx="61.7" cy="48.5" r="1.9" fill="#ffffff" opacity="0.95" />
                </g>

                <!-- Happy Crescent Eyes -->
                <g class="axiom-happy-eyes" fill="none" stroke="url(#${uid}-eye)" stroke-width="3" stroke-linecap="round">
                  <path d="M 30.5 53 Q 36 46 41.5 53" />
                  <path d="M 58.5 53 Q 64 46 69.5 53" />
                </g>

                <!-- Singularity Starlight Irises -->
                <g class="axiom-star-eyes" fill="#fef08a">
                  <path d="M 36.2 46.5 L 37.4 50.1 L 41 51.2 L 37.4 52.3 L 36.2 55.9 L 35 52.3 L 31.4 51.2 L 35 50.1 Z" />
                  <path d="M 63.8 46.5 L 65 50.1 L 68.6 51.2 L 65 52.3 L 63.8 55.9 L 62.6 52.3 L 59 51.2 L 62.6 50.1 Z" />
                </g>

                <!-- Terminal Mode >_ Optics -->
                <g class="axiom-term-glyph" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="31 47 38 51.5 31 56" />
                  <line x1="57" y1="56" x2="68" y2="56" />
                </g>

                <!-- Dynamic Kinetic Mouths -->
                <path class="axiom-mouth-smile" d="M 43 63.5 Q 50 68.5 57 63.5" fill="none" stroke="var(--bot-accent)" stroke-width="2.3" stroke-linecap="round" />
                <line class="axiom-mouth-think" x1="43.5" y1="65" x2="56.5" y2="65" stroke="var(--bot-accent)" stroke-width="2.3" stroke-linecap="round" stroke-dasharray="3 3" />
                <path class="axiom-mouth-error" d="M 43.5 67 Q 50 62.5 56.5 67" fill="none" stroke="#f87171" stroke-width="2.3" stroke-linecap="round" />

                <!-- Voice-Waveform Mouth while Streaming -->
                <g class="axiom-mouth-eq" fill="var(--bot-accent)">
                  <rect class="axiom-eq-bar axiom-eq-1" x="40" y="61" width="2.8" height="7.5" rx="1.4" />
                  <rect class="axiom-eq-bar axiom-eq-2" x="44.5" y="59.5" width="2.8" height="9" rx="1.4" />
                  <rect class="axiom-eq-bar axiom-eq-3" x="49" y="58.5" width="2.8" height="10" rx="1.4" />
                  <rect class="axiom-eq-bar axiom-eq-4" x="53.5" y="59.5" width="2.8" height="9" rx="1.4" />
                  <rect class="axiom-eq-bar axiom-eq-5" x="58" y="61" width="2.8" height="7.5" rx="1.4" />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
    `;
  }

  function getActiveSession() {
    return state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0] || null;
  }

  function findSelectedProvider() {
    const providers = state.catalog?.providers || [];
    const slug = state.selection?.providerSlug;
    return providers.find((p) => p.slug === slug) || providers[0] || null;
  }

  function findModelInProvider(prov, selection) {
    if (!prov || !Array.isArray(prov.models)) return null;
    if (selection?.baseModelId) {
      const byBase = prov.models.find((m) => m.id === selection.baseModelId);
      if (byBase) return byBase;
    }
    if (selection?.modelId) {
      const direct = prov.models.find((m) => m.id === selection.modelId);
      if (direct) return direct;
      const byVariant = prov.models.find(
        (m) =>
          m.variantMap &&
          Object.values(m.variantMap).some((v) => (v.id || v.modelId) === selection.modelId)
      );
      if (byVariant) return byVariant;
      const stem = String(selection.modelId).replace(/-(minimal|low|medium|high|xhigh)$/i, "");
      const byStem = prov.models.find((m) => m.id === stem);
      if (byStem) return byStem;
    }
    return prov.models[0] || null;
  }

  function findSelectedModelObj() {
    if (state.selection?.kind === "combo") {
      return (state.catalog?.combos || []).find((c) => c.name === state.selection.modelId) || null;
    }
    const prov = findSelectedProvider();
    return findModelInProvider(prov, state.selection);
  }

  function buildSyncedSelection(prov, modelObj, desiredEffort) {
    const levels = modelObj?.effort?.effortLevels || [];
    const hasDesired = levels.some((l) => l.id === desiredEffort);
    const chosenEffort = hasDesired
      ? desiredEffort
      : modelObj?.effort?.defaultEffort || levels[0]?.id || "medium";
    const variant = modelObj?.variantMap?.[chosenEffort] || null;
    const resolvedModelId = variant ? variant.id || variant.modelId : modelObj.id;
    const resolvedFullId = variant ? variant.fullId : modelObj.fullId;
    return {
      kind: "provider",
      providerSlug: prov.slug,
      providerName: prov.name,
      providerPreset: prov.preset,
      providerColor: prov.color,
      baseModelId: modelObj.id,
      displayLabel: modelObj.label || modelObj.id,
      modelId: resolvedModelId,
      fullId: resolvedFullId,
      effort: chosenEffort
    };
  }

  function getActiveEffortProfile() {
    const prov =
      state.activePopover === "model" && state.pickerStep === "models" && state.inspectingProviderSlug
        ? (state.catalog?.providers || []).find((p) => p.slug === state.inspectingProviderSlug) || findSelectedProvider()
        : findSelectedProvider();
    const modelObj =
      state.selection?.kind === "combo"
        ? findSelectedModelObj()
        : findModelInProvider(prov, state.selection) || findSelectedModelObj();

    if (modelObj?.effort?.effortLevels?.length) {
      return modelObj.effort;
    }
    return {
      effortLevels: [
        { id: "low", label: "Low", shortLabel: "Low", power: 1, maxScale: 3, percent: 33, color: "#10B981", accent: "#2DD4BF", glow: "rgba(16, 185, 129, 0.48)", description: "Fast & lightweight response" },
        { id: "medium", label: "Medium", shortLabel: "Med", power: 2, maxScale: 3, percent: 67, color: "#38BDF8", accent: "#6366F1", glow: "rgba(56, 189, 248, 0.54)", description: "Balanced speed & reasoning depth" },
        { id: "high", label: "High", shortLabel: "High", power: 3, maxScale: 3, percent: 100, color: "#F97316", accent: "#F59E0B", glow: "rgba(249, 115, 22, 0.64)", description: "Deep multi-step reasoning" }
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

  function isSingularityStop(stop, profile) {
    if (!stop) return false;
    if (stop.id === "max" || stop.id === "xhigh") return true;
    const stops = profile?.effortLevels || [];
    return stops.length >= 4 && stops[stops.length - 1].id === stop.id;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))
    ];
  }

  function rgbCss(rgb, alpha) {
    if (alpha === undefined) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  function computeVisualFromRatio(ratio, stops) {
    const clamped = Math.max(0, Math.min(1, ratio));
    const maxIdx = Math.max(1, stops.length - 1);
    const exactPos = clamped * maxIdx;
    const i0 = Math.min(maxIdx, Math.floor(exactPos));
    const i1 = Math.min(maxIdx, Math.ceil(exactPos));
    const localT = exactPos - i0;

    const s0 = stops[i0] || stops[0];
    const s1 = stops[i1] || s0;
    const t0 = EFFORT_THEME[s0.id] || EFFORT_THEME.medium;
    const t1 = EFFORT_THEME[s1.id] || t0;

    const rgbA = lerpRgb(t0.rgbA, t1.rgbA, localT);
    const rgbB = lerpRgb(t0.rgbB, t1.rgbB, localT);
    const rgbC = lerpRgb(t0.rgbC || t0.rgbA, t1.rgbC || t1.rgbA, localT);
    const nearestIdx = Math.round(exactPos);
    const nearestStop = stops[nearestIdx] || stops[0];

    const topIsSingularity = isSingularityStop(stops[stops.length - 1], { effortLevels: stops });
    const isMaxZone = topIsSingularity && clamped >= 0.78;
    const singularityIntensity = isMaxZone ? Math.min(1, (clamped - 0.78) / 0.17) : 0;

    return {
      clamped,
      nearestIdx,
      nearestStop,
      rgbA,
      rgbB,
      rgbC,
      singularityIntensity,
      isSingularity: topIsSingularity && (singularityIntensity >= 0.6 || nearestStop.id === "xhigh" || nearestStop.id === "max")
    };
  }

  function applyRootEffortVars(stop, profile, customVis) {
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;
    const isSing = customVis ? customVis.isSingularity : isSingularityStop(stop, profile);
    const color = customVis ? rgbCss(customVis.rgbA) : stop.color || theme.color;
    const accent = customVis ? rgbCss(customVis.rgbB) : stop.accent || theme.accent;
    const glow = customVis ? rgbCss(customVis.rgbA, isSing ? 0.82 : 0.58) : stop.glow || theme.glow;

    document.documentElement.style.setProperty("--effort-color", color);
    document.documentElement.style.setProperty("--effort-accent", accent);
    document.documentElement.style.setProperty("--effort-glow", glow);
    document.documentElement.style.setProperty("--singularity", isSing ? "1" : "0");

    fxState.rgbA = customVis ? customVis.rgbA : theme.rgbA;
    fxState.rgbB = customVis ? customVis.rgbB : theme.rgbB;
    fxState.rgbC = customVis ? customVis.rgbC : theme.rgbC;
    fxState.targetSingularity = customVis ? customVis.singularityIntensity : isSing ? 1 : 0;
  }

  // =========================================================================
  // Ethereal 4-Realm Effort Canvas + Explosive Radial Shockwave Bursts (60fps)
  // Realm 1: Emerald Aether · Realm 2: Astral Sapphire · Realm 3: Solar Flare
  // Realm 4: Celestial Black Hole Singularity with Double Einstein Lensing
  // =========================================================================
  function initParticles() {
    if (fxState.particles.length) return;
    for (let i = 0; i < 64; i++) {
      fxState.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 14 + Math.random() * 82,
        speed: 0.011 + Math.random() * 0.025,
        inward: 0.08 + Math.random() * 0.24,
        size: 0.85 + Math.random() * 2.1,
        hueSlot: i % 3,
        driftX: Math.random(),
        driftY: Math.random(),
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function triggerEffortBurst(ratio, rgbA, rgbB, rgbC, isSing) {
    if (REDUCED_MOTION_MQ.matches || state.fxPaused) return;
    const sparks = [];
    const count = isSing ? 22 : 16;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.28;
      const spd = (isSing ? 1.8 : 1.35) + Math.random() * 2.1;
      sparks.push({
        ang,
        dist: 4,
        spd,
        size: 1.1 + Math.random() * 1.8,
        col: i % 3 === 0 ? rgbA : i % 3 === 1 ? rgbB : rgbC
      });
    }
    fxState.bursts.push({
      xNorm: 0.56 + Math.max(0, Math.min(1, ratio)) * 0.34,
      yNorm: 0.36,
      life: 0,
      maxLife: 1,
      rgbA,
      rgbB,
      isSing,
      sparks
    });
    if (fxState.bursts.length > 4) fxState.bursts.shift();
  }

  function stopCanvasLoop() {
    if (fxState.rafId !== null) {
      cancelAnimationFrame(fxState.rafId);
      fxState.rafId = null;
    }
  }

  function drawEffortCanvasFrame(canvas, staticOnly) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    fxState.singularity = staticOnly
      ? fxState.targetSingularity
      : lerp(fxState.singularity, fxState.targetSingularity, 0.085);

    const s = fxState.singularity;
    const r = fxState.ratio;
    const t = fxState.time;

    // 1) Ethereal Flowing Aurora Ribbons across ALL tiers (Emerald -> Sapphire -> Solar -> Abyss)
    const ribbonCount = 3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < ribbonCount; k++) {
      const yBase = H * (0.28 + k * 0.24);
      const amp = (8 + r * 10) * (1 - s * 0.45);
      const col = k === 0 ? fxState.rgbA : k === 1 ? fxState.rgbB : fxState.rgbC;
      const grad = ctx.createLinearGradient(0, yBase - 18, W, yBase + 18);
      grad.addColorStop(0, rgbCss(col, 0.02));
      grad.addColorStop(0.45, rgbCss(col, (0.14 + r * 0.1) * (1 - s * 0.42)));
      grad.addColorStop(0.82, rgbCss(fxState.rgbB, (0.19 + r * 0.12) * (1 - s * 0.35)));
      grad.addColorStop(1, rgbCss(col, 0.03));

      ctx.strokeStyle = grad;
      ctx.lineWidth = 10 - k * 2.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let x = 0; x <= W; x += 14) {
        const wave =
          Math.sin(x * 0.017 + t * (1.0 + k * 0.35 + r * 0.8) + k * 2.1) * amp +
          Math.cos(x * 0.031 - t * 0.7 + k) * (amp * 0.38);
        if (x === 0) ctx.moveTo(x, yBase + wave);
        else ctx.lineTo(x, yBase + wave);
      }
      ctx.stroke();
    }

    // 2) Luminous Mystical Motes & Constellation / Solar Embers (Low -> High)
    if (s < 0.9) {
      const moteFade = (1 - s * 0.85) * (0.36 + r * 0.52);
      const moteCount = Math.round(18 + r * 20);
      const pts = [];
      for (let i = 0; i < moteCount; i++) {
        const p = fxState.particles[i];
        const speedMul = 12 + r * 48;
        const px = ((p.driftX * W + t * speedMul * (0.45 + p.size * 0.25)) % (W + 24)) - 12;
        const py =
          ((p.driftY * H - (r > 0.58 ? t * 14 * p.size : 0)) % (H + 16) + H + 16) % (H + 16) - 8 +
          Math.sin(t * 1.5 + p.phase) * 3.5;
        pts.push([px, py]);

        const col = p.hueSlot === 0 ? fxState.rgbA : p.hueSlot === 1 ? fxState.rgbB : fxState.rgbC;
        const rad = p.size * (0.95 + r * 0.45);
        const halo = ctx.createRadialGradient(px, py, 0, px, py, rad * 3.8);
        halo.addColorStop(0, rgbCss(col, moteFade * 0.92));
        halo.addColorStop(0.45, rgbCss(col, moteFade * 0.32));
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, rad * 3.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Astral constellation threads in Medium/High zone
      if (r >= 0.25 && r < 0.85) {
        ctx.strokeStyle = rgbCss(fxState.rgbC, 0.14 * (1 - s));
        ctx.lineWidth = 0.7;
        for (let i = 0; i < Math.min(pts.length, 16); i++) {
          for (let j = i + 1; j < Math.min(pts.length, 16); j++) {
            const dx = pts[i][0] - pts[j][0];
            const dy = pts[i][1] - pts[j][1];
            const distSq = dx * dx + dy * dy;
            if (distSq < 2200) {
              ctx.beginPath();
              ctx.moveTo(pts[i][0], pts[i][1]);
              ctx.lineTo(pts[j][0], pts[j][1]);
              ctx.stroke();
            }
          }
        }
      }
    }
    ctx.restore();

    // 3) Celestial Black Hole Singularity with Double Einstein Gravitational Lensing (XHigh / Max)
    if (s > 0.02) {
      const cx = W - 70;
      const cy = H * 0.43;
      const horizonR = 11.5 + s * 5.2;

      // Gravitational abyss distortion well
      const wellGrad = ctx.createRadialGradient(cx, cy, horizonR * 0.55, cx, cy, 145 * s + 22);
      wellGrad.addColorStop(0, `rgba(2, 1, 8, ${0.97 * s})`);
      wellGrad.addColorStop(0.26, `rgba(26, 7, 56, ${0.72 * s})`);
      wellGrad.addColorStop(0.56, `rgba(98, 22, 148, ${0.28 * s})`);
      wellGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = wellGrad;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Relativistic polar energy jets (ethereal vertical shimmer)
      const jetGrad = ctx.createLinearGradient(cx, cy - 58 * s, cx, cy + 58 * s);
      jetGrad.addColorStop(0, "rgba(56, 189, 248, 0)");
      jetGrad.addColorStop(0.35, `rgba(168, 85, 247, ${0.26 * s})`);
      jetGrad.addColorStop(0.5, `rgba(253, 224, 71, ${0.42 * s})`);
      jetGrad.addColorStop(0.65, `rgba(236, 72, 153, ${0.26 * s})`);
      jetGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = jetGrad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 3.2 * s, 56 * s, -0.18, 0, Math.PI * 2);
      ctx.fill();

      // Double-warped Einstein lensing vertical arches (upper & lower bent light)
      for (const dir of [-1, 1]) {
        const archGrad = ctx.createLinearGradient(cx - 26, cy, cx + 26, cy);
        archGrad.addColorStop(0, `rgba(56, 189, 248, ${0.18 * s})`);
        archGrad.addColorStop(0.5, `rgba(253, 224, 71, ${0.72 * s})`);
        archGrad.addColorStop(1, `rgba(236, 72, 153, ${0.25 * s})`);
        ctx.strokeStyle = archGrad;
        ctx.lineWidth = 1.9 * s;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy + dir * horizonR * 0.24,
          horizonR * 1.48,
          horizonR * 1.32,
          -0.18,
          dir < 0 ? Math.PI : 0,
          dir < 0 ? Math.PI * 2 : Math.PI
        );
        ctx.stroke();
      }

      // Three layered tilted accretion plasma rings
      for (let ring = 0; ring < 3; ring++) {
        ctx.save();
        ctx.translate(cx, cy);
        const tilt = -0.22 + ring * 0.13 + Math.sin(t * 0.72 + ring) * 0.04;
        ctx.rotate(tilt);
        const rx = (30 + ring * 20) * (0.68 + s * 0.44);
        const ry = (8.8 + ring * 5.6) * (0.68 + s * 0.44);

        const ringGrad = ctx.createLinearGradient(-rx, 0, rx, 0);
        if (ring === 0) {
          ringGrad.addColorStop(0, `rgba(139, 92, 246, ${0.2 * s})`);
          ringGrad.addColorStop(0.32, `rgba(236, 72, 153, ${0.82 * s})`);
          ringGrad.addColorStop(0.66, `rgba(253, 224, 71, ${0.95 * s})`);
          ringGrad.addColorStop(1, `rgba(168, 85, 247, ${0.28 * s})`);
        } else if (ring === 1) {
          ringGrad.addColorStop(0, `rgba(56, 189, 248, ${0.32 * s})`);
          ringGrad.addColorStop(0.5, `rgba(217, 70, 239, ${0.65 * s})`);
          ringGrad.addColorStop(1, `rgba(236, 72, 153, ${0.44 * s})`);
        } else {
          ringGrad.addColorStop(0, `rgba(168, 85, 247, ${0.1 * s})`);
          ringGrad.addColorStop(0.5, `rgba(236, 72, 153, ${0.34 * s})`);
          ringGrad.addColorStop(1, `rgba(251, 191, 36, ${0.22 * s})`);
        }

        ctx.strokeStyle = ringGrad;
        ctx.lineWidth = (2.8 - ring * 0.6) * s;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 64 Keplerian spiraling star-trails accelerating into the photon sphere
      const palette = [
        [253, 224, 71],
        [236, 72, 153],
        [168, 85, 247]
      ];
      for (let i = 0; i < fxState.particles.length; i++) {
        const p = fxState.particles[i];
        if (!staticOnly) {
          const boost = 28 / Math.max(12, p.radius);
          p.angle += p.speed * boost * (0.72 + s * 0.95);
          p.radius -= p.inward * (0.58 + s * 0.88);
          if (p.radius < horizonR * 0.86) {
            p.radius = 56 + Math.random() * 52;
            p.angle = Math.random() * Math.PI * 2;
          }
        }

        const squashY = 0.4;
        const rot = -0.2;
        const rawX = Math.cos(p.angle) * p.radius;
        const rawY = Math.sin(p.angle) * p.radius * squashY;
        const x = cx + rawX * Math.cos(rot) - rawY * Math.sin(rot);
        const y = cy + rawX * Math.sin(rot) + rawY * Math.cos(rot);

        const prevAngle = p.angle - 0.25;
        const pRawX = Math.cos(prevAngle) * (p.radius + 2.2);
        const pRawY = Math.sin(prevAngle) * (p.radius + 2.2) * squashY;
        const px = cx + pRawX * Math.cos(rot) - pRawY * Math.sin(rot);
        const py = cy + pRawX * Math.sin(rot) + pRawY * Math.cos(rot);

        const proximity = Math.max(0, Math.min(1, 1 - (p.radius - horizonR) / 76));
        const col = palette[p.hueSlot];
        const alpha = (0.22 + proximity * 0.76) * s;

        ctx.strokeStyle = rgbCss(col, alpha);
        ctx.lineWidth = Math.max(0.75, p.size * (0.75 + proximity * 0.6));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Luminous Photon Sphere Halo
      const photonGrad = ctx.createRadialGradient(cx, cy, horizonR * 0.82, cx, cy, horizonR * 2.15);
      photonGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      photonGrad.addColorStop(0.24, `rgba(254, 240, 138, ${0.92 * s})`);
      photonGrad.addColorStop(0.48, `rgba(236, 72, 153, ${0.66 * s})`);
      photonGrad.addColorStop(0.76, `rgba(139, 92, 246, ${0.34 * s})`);
      photonGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = photonGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR * 2.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Event Horizon Core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, horizonR);
      coreGrad.addColorStop(0, `rgba(0, 0, 0, ${0.99 * s})`);
      coreGrad.addColorStop(0.78, `rgba(4, 1, 10, ${0.96 * s})`);
      coreGrad.addColorStop(1, "rgba(4, 1, 10, 0)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4) Explosive Ethereal Shockwave Rings & Luminous Spark Wisps on Tier Change
    if (fxState.bursts.length > 0 && !staticOnly) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let bIdx = fxState.bursts.length - 1; bIdx >= 0; bIdx--) {
        const b = fxState.bursts[bIdx];
        b.life += 0.032;
        if (b.life >= b.maxLife) {
          fxState.bursts.splice(bIdx, 1);
          continue;
        }
        const easeOut = 1 - Math.pow(1 - b.life, 3);
        const fade = Math.max(0, 1 - b.life);
        const bx = b.isSing ? W - 70 : b.xNorm * W;
        const by = b.isSing ? H * 0.43 : b.yNorm * H;
        const maxRad = b.isSing ? 92 : 68;
        const ringR = 8 + easeOut * maxRad;

        ctx.strokeStyle = rgbCss(b.rgbA, fade * 0.72);
        ctx.lineWidth = Math.max(0.8, 3.2 * fade);
        ctx.beginPath();
        ctx.arc(bx, by, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = rgbCss(b.rgbB, fade * 0.45);
        ctx.lineWidth = Math.max(0.6, 1.8 * fade);
        ctx.beginPath();
        ctx.arc(bx, by, ringR * 0.68, 0, Math.PI * 2);
        ctx.stroke();

        for (const sp of b.sparks) {
          sp.dist += sp.spd * (1.25 - easeOut * 0.75);
          const sx = bx + Math.cos(sp.ang) * sp.dist;
          const sy = by + Math.sin(sp.ang) * sp.dist * 0.65;
          const tailX = bx + Math.cos(sp.ang) * Math.max(0, sp.dist - 9 * fade);
          const tailY = by + Math.sin(sp.ang) * Math.max(0, sp.dist - 9 * fade) * 0.65;
          ctx.strokeStyle = rgbCss(sp.col, fade * 0.9);
          ctx.lineWidth = Math.max(0.8, sp.size * fade);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function startEffortCanvasLoop() {
    stopCanvasLoop();
    const canvas = document.getElementById("r001-bh-canvas");
    if (!canvas) return;
    initParticles();

    if (REDUCED_MOTION_MQ.matches || state.fxPaused) {
      drawEffortCanvasFrame(canvas, true);
      return;
    }

    const tick = () => {
      const liveCanvas = document.getElementById("r001-bh-canvas");
      if (!liveCanvas) {
        fxState.rafId = null;
        return;
      }
      fxState.time += 0.016;
      drawEffortCanvasFrame(liveCanvas, false);
      fxState.rafId = requestAnimationFrame(tick);
    };
    fxState.rafId = requestAnimationFrame(tick);
  }

  function commitEffortChoice(chosenEffortId) {
    if (!state.selection) return;
    if (state.selection.kind === "combo") {
      state.selection = { ...state.selection, effort: chosenEffortId };
    } else {
      const prov = findSelectedProvider();
      const mod = findModelInProvider(prov, state.selection);
      if (prov && mod) {
        state.selection = buildSyncedSelection(prov, mod, chosenEffortId);
      } else {
        state.selection = { ...state.selection, effort: chosenEffortId };
      }
    }
    vscode.postMessage({ type: "saveSelection", selection: state.selection });
  }

  function syncSliderDom(ratio, snapWithSpring, allowBurst = true) {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const vis = computeVisualFromRatio(ratio, stops);
    fxState.ratio = vis.clamped;

    if (allowBurst && fxState.lastTierId && fxState.lastTierId !== vis.nearestStop.id) {
      triggerEffortBurst(vis.clamped, vis.rgbA, vis.rgbB, vis.rgbC, vis.isSingularity);
    }
    fxState.lastTierId = vis.nearestStop.id;

    applyRootEffortVars(vis.nearestStop, profile, vis);

    const bar = document.getElementById("r001-effort-bar");
    const shell = document.getElementById("r001-effort-shell");
    const fill = document.getElementById("r001-effort-fill");
    const thumb = document.getElementById("r001-effort-thumb");
    const levelName = document.getElementById("r001-effort-level-name");
    const powerTag = document.getElementById("r001-effort-power-tag");
    const descEl = document.getElementById("r001-effort-desc");
    const routeEl = document.getElementById("r001-effort-route");
    const rangeInput = document.getElementById("r001-effort-range");
    const composerEl = document.querySelector(".r001-composer");
    const modelPill = document.querySelector(".r001-model-pill");
    const pillEffort = document.querySelector(".r001-model-pill-effort-text");

    const singAttr = vis.isSingularity ? "1" : "0";
    if (bar) {
      bar.dataset.power = String(vis.nearestStop.power);
      bar.dataset.effort = vis.nearestStop.id;
      bar.dataset.singularity = singAttr;
    }
    if (composerEl) composerEl.dataset.singularity = singAttr;
    if (modelPill) modelPill.dataset.singularity = singAttr;
    document.querySelectorAll(".axiom-bot").forEach((b) => {
      b.dataset.singularity = singAttr;
    });

    if (shell) {
      shell.classList.toggle("spring-snap", Boolean(snapWithSpring));
      const shellW = shell.clientWidth || 142;
      const pad = 14;
      const thumbX = pad + vis.clamped * Math.max(10, shellW - pad * 2);
      const fillScale = Math.max(0.16, Math.min(1, (thumbX + 10) / shellW));

      if (fill) fill.style.transform = `scaleX(${fillScale.toFixed(4)})`;
      if (thumb) thumb.style.transform = `translate3d(${thumbX.toFixed(2)}px, -50%, 0)`;
    }

    const theme = EFFORT_THEME[vis.nearestStop.id] || EFFORT_THEME.medium;
    if (levelName) levelName.textContent = vis.nearestStop.label;
    if (powerTag) {
      powerTag.textContent = vis.isSingularity
        ? theme.badge
        : `${theme.badge} · ${vis.nearestStop.percent}%`;
    }
    if (descEl) {
      descEl.textContent = theme.realm || vis.nearestStop.description;
    }
    if (pillEffort) pillEffort.textContent = vis.nearestStop.label;
    if (routeEl) {
      const prov = findSelectedProvider();
      const mod = findModelInProvider(prov, state.selection);
      const v = mod?.variantMap?.[vis.nearestStop.id];
      routeEl.textContent = v ? v.id || v.modelId : mod?.id || state.selection?.displayLabel || "Model";
    }

    if (rangeInput) {
      rangeInput.setAttribute("aria-valuetext", `${vis.nearestStop.label} (${theme.realm || vis.nearestStop.description})`);
    }

    document.querySelectorAll(".r001-effort-dot").forEach((d, idx) => {
      d.classList.toggle("passed", idx <= vis.nearestIdx);
    });
    document.querySelectorAll(".r001-tier-pill").forEach((p) => {
      p.classList.toggle("active", p.dataset.tier === vis.nearestStop.id);
    });

    if (REDUCED_MOTION_MQ.matches || state.fxPaused) {
      drawEffortCanvasFrame(document.getElementById("r001-bh-canvas"), true);
    }

    return vis;
  }

  // =========================================================================
  // Markdown Renderer (Copy / Apply / Live Terminal Run on shell blocks)
  // =========================================================================
  function formatInlineText(raw) {
    return escapeHtml(raw)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function renderTextChunk(chunk) {
    const lines = chunk.split("\n");
    const out = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        closeLists();
        continue;
      }
      const h3 = /^###\s+(.+)$/.exec(trimmed);
      if (h3) {
        closeLists();
        out.push(`<h3>${formatInlineText(h3[1])}</h3>`);
        continue;
      }
      const h2 = /^##\s+(.+)$/.exec(trimmed);
      if (h2) {
        closeLists();
        out.push(`<h2>${formatInlineText(h2[1])}</h2>`);
        continue;
      }
      const h1 = /^#\s+(.+)$/.exec(trimmed);
      if (h1) {
        closeLists();
        out.push(`<h1>${formatInlineText(h1[1])}</h1>`);
        continue;
      }
      const bq = /^>\s?(.*)$/.exec(trimmed);
      if (bq) {
        closeLists();
        out.push(`<blockquote>${formatInlineText(bq[1])}</blockquote>`);
        continue;
      }
      const ul = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (ul) {
        if (inOl) {
          out.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          out.push("<ul>");
          inUl = true;
        }
        out.push(`<li>${formatInlineText(ul[1])}</li>`);
        continue;
      }
      const ol = /^\d+\.\s+(.+)$/.exec(trimmed);
      if (ol) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          out.push("<ol>");
          inOl = true;
        }
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
      if (match.index > lastIndex) {
        parts.push(renderTextChunk(text.slice(lastIndex, match.index)));
      }
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
              (isShell
                ? `<button type="button" class="r001-mini-btn run-btn" data-action="run-code" data-block="${escapeHtml(blockKey)}" title="Chạy lệnh ngay trong Terminal">${ICONS.terminal}<span>Run</span></button>`
                : "") +
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

    if (lastIndex < text.length) {
      parts.push(renderTextChunk(text.slice(lastIndex)));
    }

    const html = parts.join("");
    if (!html && isStreamingThis) {
      return "";
    }
    return isStreamingThis ? `${html}<span class="r001-stream-caret"></span>` : html || "<p>...</p>";
  }

  /**
   * Assistant Header: Expressive Axiom Companion Bot + Clean Name + Live Status (NO Effort badge!)
   */
  function renderAssistantPhaseHeader(msg, isLastStreaming, hasRunningTerminal, isSing) {
    const hasError = Boolean(msg.error && !msg.text);
    const rawPhase = hasRunningTerminal
      ? "terminal"
      : isLastStreaming
        ? msg.phase || (msg.text ? "streaming" : msg.reasoning ? "thinking" : "analyzing")
        : hasError
          ? "error"
          : "done";

    const botMood = rawPhase === "done" ? "happy" : rawPhase;

    let titleText = "Axiom";
    let subText = "";
    const elapsedMs = isLastStreaming && msg.startedAt
      ? Date.now() - msg.startedAt
      : msg.durationMs || 0;

    if (rawPhase === "terminal") {
      titleText = "Axiom · Đang chạy Terminal";
      subText = "Thực thi lệnh dự án trực tiếp...";
    } else if (rawPhase === "analyzing") {
      titleText = "Axiom · Đang quét mã nguồn";
      subText = msg.phaseDetail || "Đang phân tích cấu trúc dự án...";
    } else if (rawPhase === "thinking") {
      titleText = "Axiom · Đang suy luận sâu";
      subText = "Tổng hợp kiến trúc & chuỗi suy luận...";
    } else if (rawPhase === "streaming") {
      titleText = "Axiom · Đang phản hồi";
      subText = "Đang trình bày giải pháp...";
    } else if (rawPhase === "error") {
      titleText = "Axiom";
      subText = "Gặp sự cố khi xử lý yêu cầu";
    } else if (elapsedMs > 0) {
      subText = `Hoàn tất trong ${formatDuration(elapsedMs)}`;
    }

    return (
      `<div class="r001-msg-header" data-msg-header="${escapeHtml(msg.id)}">` +
        renderAxiomBot("msg", botMood, isSing) +
        `<div class="r001-ai-status-col">` +
          `<div class="r001-ai-status-row">` +
            `<span class="r001-ai-persona-label">${escapeHtml(titleText)}</span>` +
          `</div>` +
          `<div class="r001-ai-substatus">` +
            (rawPhase !== "done" && rawPhase !== "error"
              ? `<progress aria-label="Đang xử lý" class="r001-spinner"></progress>`
              : "") +
            `<span class="r001-live-sub-text">${escapeHtml(subText || "Sẵn sàng")}</span>` +
            (isLastStreaming && msg.startedAt
              ? `<span class="r001-live-elapsed" data-started="${msg.startedAt}">· ${formatDuration(elapsedMs)}</span>`
              : "") +
          `</div>` +
        `</div>` +
      `</div>`
    );
  }

  function renderToolTraceCard(msg) {
    const logs = Array.isArray(msg.toolLogs) ? msg.toolLogs : [];
    if (logs.length === 0) return "";
    return `
      <details class="r001-tool-trace">
        <summary>
          <span class="r001-thinking-head-left">${ICONS.folderTree}<span>Đã tra cứu ${logs.length} bước trong thư mục dự án</span></span>
          <span style="font-size:10px;color:var(--text-muted)">Chi tiết</span>
        </summary>
        <div class="r001-tool-trace-list">
          ${logs.map((l) => `<div class="r001-tool-trace-item">${ICONS.search}<span>${escapeHtml(l.label || l.tool)}</span></div>`).join("")}
        </div>
      </details>
    `;
  }

  function renderThinkingCard(msg, isLastStreaming) {
    const isThinkingNow = isLastStreaming && !msg.text;
    if (!msg.reasoning && !isThinkingNow) return "";

    const lines = String(msg.reasoning || "").trim().split("\n").filter(Boolean);
    const lastLine = lines.length
      ? lines[lines.length - 1]
      : msg.phaseDetail || "Đang phân tích ngữ cảnh thư mục & mã nguồn...";

    return (
      `<details class="r001-thinking-card ${isThinkingNow ? "active" : ""}" data-thinking-card="${escapeHtml(msg.id)}" ${isThinkingNow && msg.reasoning ? "open" : ""}>` +
        `<summary>` +
          `<span class="r001-thinking-head-left">` +
            (isThinkingNow
              ? `<progress aria-label="Đang suy nghĩ" class="r001-spinner"></progress>`
              : ICONS.brain) +
            `<span class="r001-thinking-title">${isThinkingNow ? "Đang suy luận kiến trúc..." : `Chuỗi suy luận (${msg.reasoning.length} ký tự)`}</span>` +
          `</span>` +
          `<span style="font-size:10.5px;color:var(--text-muted)">${isThinkingNow ? "Live" : "Chi tiết"}</span>` +
        `</summary>` +
        `<div class="r001-thinking-preview">${escapeHtml(lastLine)}</div>` +
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
          `<div class="r001-terminal-cmd">` +
            `<span class="r001-terminal-prompt">$</span>` +
            `<span title="${escapeHtml(run.command)}">${escapeHtml(run.command)}</span>` +
          `</div>` +
          `<div class="r001-terminal-meta">` +
            (isRunning
              ? `<progress aria-label="Đang chạy lệnh" class="r001-spinner"></progress>` +
                `<span class="r001-term-status run" data-started="${run.startedAt}">RUNNING · ${formatDuration(elapsed)}</span>` +
                `<button type="button" class="r001-mini-btn" data-action="kill-term" data-run="${escapeHtml(run.runId)}">Dừng</button>`
              : `<span class="r001-term-status ${isFailed ? "err" : "ok"}">${isFailed ? `✕ Exit ${run.exitCode}` : "✓ Exit 0"} · ${formatDuration(elapsed)}</span>`) +
          `</div>` +
        `</div>` +
        `<div class="r001-terminal-cwd">cwd: ${escapeHtml(run.cwd || "")}</div>` +
        `<pre class="r001-terminal-out">${escapeHtml(run.output || (isRunning ? "Đang chờ kết quả đầu ra..." : "(Không có stdout/stderr)"))}</pre>` +
        `<div class="r001-terminal-foot">` +
          `<button type="button" class="r001-mini-btn" data-action="open-ide-term" data-cmd="${escapeHtml(run.command)}">${ICONS.terminal}<span>Mở IDE Terminal</span></button>` +
          (isFailed
            ? `<button type="button" class="r001-mini-btn run-btn" data-action="fix-term-error" data-run="${escapeHtml(run.runId)}">${ICONS.bolt}<span>Nhờ Axiom sửa lỗi</span></button>`
            : "") +
        `</div>` +
      `</div>`
    );
  }

  function renderEffortBar() {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const stop = getCurrentEffortStop();
    const idx = Math.max(0, stops.findIndex((s) => s.id === stop.id));
    const maxIdx = Math.max(1, stops.length - 1);
    const ratio = stops.length === 1 ? 1 : idx / maxIdx;
    const rangeVal = Math.round(ratio * 1000);
    const isSing = isSingularityStop(stop, profile);
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;

    const prov = findSelectedProvider();
    const mod = findModelInProvider(prov, state.selection);
    const activeVariant = mod?.variantMap?.[stop.id];
    const resolvedRoute = activeVariant ? activeVariant.id || activeVariant.modelId : mod?.id || state.selection?.displayLabel || "Model";

    return `
      <div class="r001-effort-bar" id="r001-effort-bar" data-power="${stop.power}" data-effort="${escapeHtml(stop.id)}" data-singularity="${isSing ? "1" : "0"}">
        <canvas class="r001-bh-canvas" id="r001-bh-canvas" aria-hidden="true"></canvas>
        <div class="r001-effort-aura" aria-hidden="true"></div>
        <div class="r001-effort-top">
          <div class="r001-effort-label-wrap">
            <label class="r001-effort-title" for="r001-effort-range">Effort (<span class="r001-effort-level-name" id="r001-effort-level-name">${escapeHtml(stop.label)}</span>)</label>
            <span class="r001-effort-power-tag" id="r001-effort-power-tag">${escapeHtml(isSing ? theme.badge : `${theme.badge} · ${stop.percent}%`)}</span>
          </div>
          <div class="r001-effort-track-shell" id="r001-effort-shell">
            <div class="r001-effort-clip">
              <div class="r001-effort-fill" id="r001-effort-fill"></div>
            </div>
            <div class="r001-effort-dots" aria-hidden="true">
              ${stops.map((_, i) => `<span class="r001-effort-dot ${i <= idx ? "passed" : ""}"></span>`).join("")}
            </div>
            <div class="r001-effort-thumb" id="r001-effort-thumb" aria-hidden="true">
              <span class="r001-effort-thumb-ring"></span>
              <span class="r001-effort-thumb-core"></span>
            </div>
            <input
              type="range"
              id="r001-effort-range"
              class="r001-effort-native"
              min="0"
              max="1000"
              step="1"
              value="${rangeVal}"
              aria-label="Mức Effort đồng bộ với model"
              aria-valuetext="${escapeHtml(stop.label)} — ${escapeHtml(theme.realm || stop.description)}"
            />
          </div>
        </div>
        <div class="r001-effort-tiers" role="group" aria-label="Chọn nhanh mức Effort">
          ${stops
            .map(
              (s) =>
                `<button type="button" class="r001-tier-pill ${s.id === stop.id ? "active" : ""}" data-action="pick-effort-tier" data-tier="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`
            )
            .join("")}
        </div>
        <div class="r001-effort-sub">
          <span class="r001-effort-sub-left" id="r001-effort-desc">${escapeHtml(theme.realm || stop.description)}</span>
          <span class="r001-effort-sub-right">
            <span>Đỉnh: <strong>${escapeHtml(profile.maxLabel)}</strong> · <span id="r001-effort-route">${escapeHtml(resolvedRoute)}</span></span>
            ${
              !REDUCED_MOTION_MQ.matches
                ? `<button type="button" class="r001-fx-pause-btn" data-action="toggle-fx" title="Tạm dừng hoặc phát hiệu ứng chuyển động">${state.fxPaused ? "Play FX" : "Pause FX"}</button>`
                : ""
            }
          </span>
        </div>
      </div>
    `;
  }

  function renderCapabilityBadge(effortObj) {
    const maxId = String(effortObj?.maxEffort || "high").toLowerCase();
    if (maxId === "max") return `<span class="r001-cap-tag tier-max">MAX</span>`;
    if (maxId === "xhigh") return `<span class="r001-cap-tag tier-xhigh">XHIGH</span>`;
    if (maxId === "high") return `<span class="r001-cap-tag tier-high">HIGH</span>`;
    return `<span class="r001-cap-tag tier-med">MED</span>`;
  }

  function renderModelPopover() {
    const providers = state.catalog?.providers || [];
    const combos = state.catalog?.combos || [];
    const activeSlug = state.inspectingProviderSlug || state.selection?.providerSlug || providers[0]?.slug;

    if (state.pickerStep === "providers") {
      const q = state.providerSearch.trim().toLowerCase();
      const filteredProviders = providers.filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
      );
      const filteredCombos = combos.filter((c) => !q || c.name.toLowerCase().includes(q));

      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.sliders}<span>Chọn nhà cung cấp (Provider)</span></span>
            <button type="button" class="r001-back-btn" data-action="refresh-catalog" title="Đồng bộ lại danh sách Provider & Model">${ICONS.refresh}<span>Sync</span></button>
          </div>
          <input type="text" class="r001-search" id="r001-provider-search" placeholder="Tìm nhà cung cấp (Antigravity, Anthropic, OpenAI, Gemini...)" value="${escapeHtml(state.providerSearch)}" />
          <div class="r001-popover-list">
            <div class="r001-section-label">Connected Providers (${filteredProviders.length})</div>
            ${
              filteredProviders.length === 0
                ? `<div style="padding:16px;text-align:center;color:var(--text-secondary)">Chưa có provider nào khả dụng trên 001Router.</div>`
                : filteredProviders
                    .map((p) => {
                      const isCurrent = state.selection?.kind !== "combo" && state.selection?.providerSlug === p.slug;
                      const connLabel = p.connectedCount > 0 ? `${p.connectedCount} Connected` : `${p.totalKeys} Keys`;
                      const pLogo = resolveProviderLogoFile(p);
                      return `
                        <button type="button" class="r001-prov-item ${isCurrent ? "selected" : ""}" data-action="open-provider" data-slug="${escapeHtml(p.slug)}">
                          <div class="r001-prov-left">
                            ${renderLogoPlate(pLogo, p.monogram || p.slug.slice(0, 2).toUpperCase(), p.color, "lg")}
                            <div style="min-width:0">
                              <div class="r001-prov-name">${escapeHtml(p.name)}</div>
                              <div class="r001-prov-sub">${escapeHtml(connLabel)} · ${p.modelCount} dòng model đồng bộ</div>
                            </div>
                          </div>
                          <div class="r001-prov-right">
                            ${isCurrent ? `<span style="color:#38bdf8">${ICONS.check}</span>` : ""}
                            ${ICONS.chevronRight}
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
                          <div class="r001-model-left">
                            ${renderLogoPlate("", "CB", "#e57452", "md")}
                            <div style="min-width:0">
                              <div class="r001-model-name">${escapeHtml(c.name)}</div>
                              <div class="r001-model-desc">${escapeHtml(c.description)}</div>
                            </div>
                          </div>
                          ${isCurrent ? ICONS.check : ""}
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

    const provider = providers.find((p) => p.slug === activeSlug) || providers[0];
    const pLogo = resolveProviderLogoFile(provider);
    const q = state.modelSearch.trim().toLowerCase();
    const models = (provider?.models || []).filter(
      (m) =>
        !q ||
        m.id.toLowerCase().includes(q) ||
        (m.label || "").toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
    const currentUnifiedObj =
      state.selection?.providerSlug === provider?.slug ? findModelInProvider(provider, state.selection) : null;

    return `
      <div class="r001-popover" id="r001-popover">
        <div class="r001-popover-head">
          <div class="r001-popover-title">
            <button type="button" class="r001-back-btn" data-action="back-providers">${ICONS.back}<span>Providers</span></button>
            ${renderLogoPlate(pLogo, provider?.monogram || "AI", provider?.color, "sm")}
            <span style="color:#f4f6fb;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(provider?.name || "Select a model")}</span>
          </div>
          <span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${models.length} models</span>
        </div>
        <input type="text" class="r001-search" id="r001-model-search" placeholder="Lọc dòng model trong ${escapeHtml(provider?.name || "")}..." value="${escapeHtml(state.modelSearch)}" />
        <div class="r001-popover-list">
          ${models
            .map((m) => {
              const isSelected = Boolean(currentUnifiedObj && currentUnifiedObj.id === m.id);
              const mLogo = resolveModelLogoFile(m.id, provider, m.logoFile);
              const levelsText = (m.effort?.effortLevels || []).map((l) => l.shortLabel || l.label).join(" · ");
              return `
                <button type="button" class="r001-model-item ${isSelected ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(m.id)}">
                  <div class="r001-model-left">
                    ${renderLogoPlate(mLogo, provider?.monogram || "AI", provider?.color, "md")}
                    <div style="min-width:0;flex:1">
                      <div class="r001-model-title-row">
                        <span class="r001-model-name">${escapeHtml(m.label || m.id)}</span>
                        ${renderCapabilityBadge(m.effort)}
                      </div>
                      <div class="r001-model-desc">${escapeHtml(levelsText)} — ${escapeHtml(m.description)}</div>
                    </div>
                  </div>
                  ${isSelected ? `<span style="flex-shrink:0;color:#38bdf8">${ICONS.check}</span>` : ""}
                </button>`;
            })
            .join("")}
        </div>
        ${renderEffortBar()}
      </div>
    `;
  }

  function renderSecondaryPopover() {
    if (state.activePopover === "workspace") {
      const ws = state.editorContext?.workspaceSummary;
      const q = state.workspaceSearch.trim().toLowerCase();
      const files = (ws?.files || []).filter((f) => !q || f.toLowerCase().includes(q));
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:420px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.folderTree}<span>Thư mục dự án (${escapeHtml(ws?.projectName || "Chưa mở")})</span></span>
            <div style="display:flex;gap:5px">
              <button type="button" class="r001-back-btn" data-action="refresh-workspace" title="Quét lại thư mục dự án">${ICONS.refresh}<span>Quét lại</span></button>
              <button type="button" class="r001-back-btn" data-action="toggle-auto-workspace">${state.autoWorkspace ? "Đang bật" : "Đang tắt"}</button>
            </div>
          </div>
          ${
            ws && ws.fileCount > 0
              ? `
                <div class="r001-ws-summary-bar">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ws.projectRoot)}">${escapeHtml(ws.projectName)} · ${ws.fileCount}${ws.truncated ? "+" : ""} tệp · ${ws.dirCount} thư mục</span>
                  <span style="flex-shrink:0">${ws.source === "workspace" ? "Workspace" : "Auto-Root"}</span>
                </div>
                <input type="text" class="r001-search" id="r001-ws-search" placeholder="Tìm nhanh tệp trong dự án để đính kèm..." value="${escapeHtml(state.workspaceSearch)}" />
                <div class="r001-popover-list">
                  ${
                    !q && ws.treePreview
                      ? `<div class="r001-section-label">Cấu trúc thư mục đã đồng bộ với Axiom</div><pre class="r001-tree-pre">${escapeHtml(ws.treePreview)}</pre>`
                      : ""
                  }
                  <div class="r001-section-label">Nhấn tệp để đính kèm trực tiếp (${files.length})</div>
                  ${files
                    .slice(0, 60)
                    .map(
                      (rel) => `
                        <button type="button" class="r001-model-item" data-action="attach-project-file" data-rel="${escapeHtml(rel)}">
                          <div class="r001-model-left">${ICONS.file}<div class="r001-model-name" style="font-family:var(--font-mono);font-size:11.5px;font-weight:500">${escapeHtml(rel)}</div></div>
                        </button>`
                    )
                    .join("")}
                </div>
              `
              : `<div style="padding:18px;text-align:center;color:var(--text-secondary)">Chưa mở thư mục hoặc tệp nào. Hãy mở Folder dự án trong IDE để Axiom đọc toàn bộ mã nguồn.</div>`
          }
        </div>
      `;
    }

    if (state.activePopover === "sync") {
      const tools = state.envSync?.cliTools || [];
      const ctx = state.editorContext || {};
      const ws = ctx.workspaceSummary;
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:380px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.blueprint}<span>Đồng bộ hệ sinh thái (${escapeHtml(state.envSync?.ideName || "IDE")})</span></span>
            <button type="button" class="r001-back-btn" data-action="sync-env">${ICONS.refresh}<span>Đồng bộ</span></button>
          </div>
          <div class="r001-popover-list" style="gap:5px;padding:8px 10px">
            <div class="r001-eco-row">
              <span>Dự án đang mở</span>
              <span class="r001-eco-badge ${ws ? "synced" : "idle"}" title="${escapeHtml(ws?.projectRoot || "")}">${escapeHtml(ws ? `${ws.projectName} (${ws.fileCount} tệp)` : "Chưa có")}</span>
            </div>
            <div class="r001-eco-row">
              <span>Tệp đang mở tự động</span>
              <span class="r001-eco-badge ${ctx.activeFile ? "detected" : "idle"}">${escapeHtml(ctx.activeFile ? ctx.activeFile.fileName : "Chưa mở tệp")}</span>
            </div>
            ${tools
              .map((t) => {
                const cls = t.synced ? "synced" : t.detected ? "detected" : "idle";
                const lbl = t.synced ? "Đã đồng bộ" : t.detected ? "Đã phát hiện" : "Chưa cài";
                return `
                  <div class="r001-eco-row">
                    <span>${escapeHtml(t.label)}</span>
                    <span class="r001-eco-badge ${cls}">${lbl}</span>
                  </div>`;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "history") {
      return `
        <div class="r001-popover" id="r001-popover">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.history}<span>Lịch sử hội thoại (${state.sessions.length})</span></span>
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
        <div class="r001-popover" id="r001-popover" style="max-height:330px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.folderTree}<span>Đính kèm ngữ cảnh mã nguồn</span></span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            <button type="button" class="r001-model-item" data-action="toggle-popover" data-popover="workspace">
              <div class="r001-model-left">${ICONS.folderTree}<div><div class="r001-model-name">Cây thư mục dự án (Workspace)</div><div class="r001-model-desc">Duyệt và chọn bất kỳ tệp nào trong thư mục đang mở</div></div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="activeFile">
              <div class="r001-model-left">${ICONS.file}<div><div class="r001-model-name">Tệp đang mở (Active Editor)</div><div class="r001-model-desc">Đưa tệp hiện tại + lỗi Diagnostics vào prompt</div></div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="selection">
              <div class="r001-model-left">${ICONS.scissors}<div><div class="r001-model-name">Đoạn code đang bôi đen (Selection)</div><div class="r001-model-desc">Chỉ đính kèm các dòng đang chọn</div></div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="workspaceFile">
              <div class="r001-model-left">${ICONS.folder}<div><div class="r001-model-name">Mở Quick Pick chọn tệp...</div><div class="r001-model-desc">Tìm nhanh bằng hộp thoại IDE</div></div></div>
            </button>
            ${
              openTabs.length > 0
                ? `<div class="r001-section-label">Các Tab đang mở (${openTabs.length})</div>` +
                  openTabs
                    .map(
                      (tab) => `
                        <button type="button" class="r001-model-item" data-action="attach-tab" data-uri="${escapeHtml(tab.uri)}">
                          <div class="r001-model-left">${ICONS.file}<div><div class="r001-model-name">${escapeHtml(tab.fileName)}</div><div class="r001-model-desc">${escapeHtml(tab.displayPath)}</div></div></div>
                        </button>`
                    )
                    .join("")
                : ""
            }
          </div>
        </div>
      `;
    }

    if (state.activePopover === "slash") {
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:270px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.terminal}<span>Slash Commands</span></span>
          </div>
          <div class="r001-popover-list">
            ${SLASH_COMMANDS.map(
              (c) => `
              <button type="button" class="r001-model-item" data-action="run-slash" data-cmd="${escapeHtml(c.cmd)}">
                <div><div class="r001-model-name" style="font-family:var(--font-mono)">${escapeHtml(c.cmd)}</div><div class="r001-model-desc">${escapeHtml(c.desc)}</div></div>
              </button>`
            ).join("")}
          </div>
        </div>
      `;
    }

    if (state.activePopover === "mode") {
      const modes = [
        { id: "auto", label: "Auto", desc: "Tự động đọc dự án, gọi công cụ tra cứu tệp & viết mã" },
        { id: "ask", label: "Ask", desc: "Hỏi đáp kiến trúc, giải thích hệ thống và debug nhanh" },
        { id: "plan", label: "Plan", desc: "Lập bản thiết kế kỹ thuật từng bước trước khi sửa" }
      ];
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:230px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">${ICONS.bolt}<span>Chế độ làm việc</span></span>
          </div>
          <div class="r001-popover-list">
            ${modes
              .map(
                (m) => `
              <button type="button" class="r001-model-item ${state.mode === m.id ? "selected" : ""}" data-action="set-mode" data-mode="${escapeHtml(m.id)}">
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

  function renderAuthOverlay() {
    if (!state.authModalOpen) return "";
    const hasConnected = state.connected;
    return `
      <div class="r001-auth-backdrop" id="r001-auth-backdrop">
        <form class="r001-auth-card" id="r001-auth-form">
          <div class="r001-auth-head">
            ${renderAxiomBot("msg", "idle", false)}
            <div>
              <div class="r001-auth-title">Kết nối & Đồng bộ 001Router</div>
              <div class="r001-auth-desc">Nhập mật khẩu quản trị 001Router một lần để đồng bộ Antigravity, CLI & IDE.</div>
            </div>
          </div>

          <div class="r001-field">
            <label for="r001-auth-url">001Router Web URL</label>
            <input id="r001-auth-url" class="r001-input" type="text" placeholder="http://127.0.0.1:20128" value="${escapeHtml(state.authServerInput)}" required />
          </div>

          <div class="r001-field">
            <label for="r001-auth-pw">Mật khẩu Web 001Router</label>
            <div class="r001-input-wrap">
              <input id="r001-auth-pw" class="r001-input" type="${state.authShowPassword ? "text" : "password"}" placeholder="Nhập mật khẩu đăng nhập web 001Router..." value="${escapeHtml(state.authPasswordInput)}" required style="padding-right:34px" />
              <button type="button" class="r001-eye-btn" data-action="toggle-pw" aria-label="Hiện hoặc ẩn mật khẩu" title="Hiện/Ẩn mật khẩu">${state.authShowPassword ? ICONS.eyeOff : ICONS.eye}</button>
            </div>
          </div>

          ${
            state.authError || state.lastError
              ? `<div class="r001-error-banner">${escapeHtml(state.authError || state.lastError)}</div>`
              : ""
          }

          <button type="submit" class="r001-primary-btn" ${state.authLoading ? "disabled" : ""}>
            ${state.authLoading ? "Đang xác thực & đồng bộ..." : "Xác nhận & Đồng bộ ngay"}
          </button>

          ${
            hasConnected
              ? `<button type="button" class="r001-secondary-btn" data-action="disconnect" style="color:#fca5a5">Ngắt kết nối thiết bị này</button>`
              : ""
          }
          <button type="button" class="r001-secondary-btn" data-action="close-auth">Đóng</button>
        </form>
      </div>
    `;
  }

  function renderContextStrip() {
    const ws = state.editorContext?.workspaceSummary;
    const af = state.editorContext?.activeFile;

    const folderPill =
      ws && ws.fileCount > 0
        ? `
          <button
            type="button"
            class="r001-folder-pill ${state.autoWorkspace ? "" : "muted"}"
            data-action="toggle-popover"
            data-popover="workspace"
            title="${state.autoWorkspace ? `Axiom đang đọc toàn bộ thư mục ${ws.projectName} (${ws.fileCount} tệp). Nhấn để xem cây thư mục.` : "Đã tắt đọc thư mục dự án. Nhấn để bật lại."}"
          >
            ${ICONS.folderTree}
            <span class="r001-active-file-name">${escapeHtml(ws.projectName)}</span>
            <span class="r001-folder-count">${ws.fileCount}${ws.truncated ? "+" : ""}</span>
          </button>
        `
        : "";

    const activeFilePill = af
      ? (() => {
          const loc = af.selectionLabel ? ` · ${af.selectionLabel}` : ` · ${af.lineCount}L`;
          return `
            <button
              type="button"
              class="r001-active-file-pill ${state.autoActiveFile ? "" : "muted"}"
              data-action="toggle-auto-file"
              title="${state.autoActiveFile ? "Đang ưu tiên kèm tệp đang mở. Nhấn để tắt tạm (vẫn đọc được cả thư mục dự án)." : "Đã tắt ưu tiên tệp lẻ. Nhấn để bật lại."}"
            >
              ${state.autoActiveFile ? ICONS.eye : ICONS.eyeOff}
              <span class="r001-active-file-name">${escapeHtml(af.fileName)}${escapeHtml(loc)}</span>
              ${af.diagnosticErrors > 0 ? `<span class="r001-diag-tag">${af.diagnosticErrors}E</span>` : ""}
              ${af.diagnosticErrors === 0 && af.diagnosticWarnings > 0 ? `<span class="r001-diag-tag warn">${af.diagnosticWarnings}W</span>` : ""}
            </button>
          `;
        })()
      : "";

    return `
      <div class="r001-context-strip">
        <div class="r001-context-pills">
          ${folderPill || activeFilePill
            ? `${folderPill}${activeFilePill}`
            : `<span style="font-size:11px;color:var(--text-muted)">Mở thư mục dự án hoặc tệp để Axiom tự động đọc ngữ cảnh</span>`}
        </div>
        <div class="r001-context-actions">
          <button type="button" class="r001-at-btn" data-action="toggle-popover" data-popover="attach" title="Đính kèm tệp hoặc tab">@ Tệp</button>
        </div>
      </div>
    `;
  }

  function ensureLiveTicker() {
    const hasActiveWork =
      Boolean(state.streamingSessionId) || state.terminalRuns.some((r) => r.status === "running");
    if (!hasActiveWork) {
      if (liveTimerInterval) {
        clearInterval(liveTimerInterval);
        liveTimerInterval = null;
      }
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

  /**
   * Incremental 60fps streaming patch so token arrival NEVER resets Axiom's live animations or <details open>.
   */
  function patchStreamingAssistantDom(msg) {
    const container = document.getElementById(`msg-${msg.id}`);
    if (!container) {
      render();
      return;
    }
    const mdEl = container.querySelector(".r001-markdown");
    if (mdEl) {
      mdEl.innerHTML = renderMarkdown(msg.text, msg.id, true);
    }

    const hasRunningTerm = state.terminalRuns.some(
      (r) => r.sessionId === state.activeSessionId && r.status === "running"
    );
    const phase = hasRunningTerm
      ? "terminal"
      : msg.phase || (msg.text ? "streaming" : msg.reasoning ? "thinking" : "analyzing");

    const botEl = container.querySelector(".axiom-bot");
    if (botEl) botEl.dataset.mood = phase;

    const personaEl = container.querySelector(".r001-ai-persona-label");
    const subEl = container.querySelector(".r001-live-sub-text");
    if (personaEl) {
      personaEl.textContent =
        phase === "terminal"
          ? "Axiom · Đang chạy Terminal"
          : phase === "thinking"
            ? "Axiom · Đang suy luận sâu"
            : phase === "streaming"
              ? "Axiom · Đang phản hồi"
              : "Axiom · Đang quét mã nguồn";
    }
    if (subEl) {
      subEl.textContent =
        phase === "thinking"
          ? "Tổng hợp kiến trúc & chuỗi suy luận..."
          : phase === "streaming"
            ? "Đang trình bày giải pháp..."
            : msg.phaseDetail || "Đang phân tích cấu trúc dự án...";
    }

    const toolSlot = container.querySelector(".r001-tool-slot");
    if (toolSlot && Array.isArray(msg.toolLogs) && msg.toolLogs.length > 0) {
      const wasOpen = Boolean(toolSlot.querySelector("details")?.open);
      toolSlot.innerHTML = renderToolTraceCard(msg);
      const nextDet = toolSlot.querySelector("details");
      if (nextDet) nextDet.open = wasOpen;
    }

    const thinkWrap = container.querySelector(".r001-thinking-slot");
    if (thinkWrap) {
      const existingDetails = thinkWrap.querySelector("details");
      const wasOpen = existingDetails ? existingDetails.open : true;
      thinkWrap.innerHTML = renderThinkingCard(msg, true);
      const nextDetails = thinkWrap.querySelector("details");
      if (nextDetails && msg.text) {
        nextDetails.open = false;
      } else if (nextDetails) {
        nextDetails.open = wasOpen;
      }
    }

    const scrollEl = document.getElementById("r001-scroll");
    if (scrollEl) {
      const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
      if (nearBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function render() {
    stopCanvasLoop();
    codeBlockCache.clear();

    const activeSession = getActiveSession();
    const messages = activeSession?.messages || [];
    const profile = getActiveEffortProfile();
    const stop = getCurrentEffortStop();
    const isSing = isSingularityStop(stop, profile);
    applyRootEffortVars(stop, profile);

    const selProvider = findSelectedProvider();
    const selModelObj = findSelectedModelObj();
    const cleanBaseModelLabel =
      state.selection?.displayLabel ||
      state.selection?.baseModelId ||
      selModelObj?.label ||
      selModelObj?.id ||
      state.selection?.modelId ||
      "Select Model";
    const selLogoFile = resolveModelLogoFile(cleanBaseModelLabel, selProvider, selModelObj?.logoFile);
    const modeLabel = state.mode === "ask" ? "Ask" : state.mode === "plan" ? "Plan" : "Auto";
    const isStreaming = Boolean(state.streamingSessionId && state.streamingSessionId === activeSession?.id);
    const totalModels = (state.catalog?.providers || []).reduce((acc, p) => acc + (p.modelCount || 0), 0);

    const syncedCliCount = (state.envSync?.cliTools || []).filter((t) => t.synced).length;
    const sessionTerminals = state.terminalRuns.filter(
      (r) => !r.sessionId || r.sessionId === activeSession?.id
    );
    const hasRunningTerminal = sessionTerminals.some((r) => r.status === "running");
    const ws = state.editorContext?.workspaceSummary;

    const textareaEl = document.getElementById("r001-input");
    const selectionStart = textareaEl ? textareaEl.selectionStart : null;
    const selectionEnd = textareaEl ? textareaEl.selectionEnd : null;
    const hadFocus = document.activeElement && document.activeElement.id === "r001-input";

    const heroMood = hasRunningTerminal ? "terminal" : state.isTypingDraft ? "listening" : "idle";

    root.innerHTML = `
      <div class="r001-shell">
        <header class="r001-topbar">
          <div class="r001-topbar-left">
            <span class="r001-brand-mark" aria-hidden="true">${ICONS.brandPrism}</span>
            <span class="r001-session-title">${escapeHtml(activeSession?.title || "Axiom Session")}</span>
            <button type="button" class="r001-conn-pill ${state.connected ? "connected" : ""}" data-action="open-auth" title="${escapeHtml(state.serverUrl)}">
              <span class="r001-conn-dot"></span>
              <span>${state.connected ? "Online" : "Connect"}</span>
            </button>
            <button type="button" class="r001-sync-pill" data-action="toggle-popover" data-popover="sync" title="Trạng thái đồng bộ Antigravity, CLI & Workspace">
              <span>${escapeHtml(state.envSync?.ideKind === "antigravity" ? "AG" : "IDE")} · ${syncedCliCount} Sync</span>
            </button>
          </div>
          <div class="r001-topbar-actions">
            ${
              surface === "sidebar"
                ? `<button type="button" class="r001-icon-btn" data-action="open-tab" aria-label="Mở rộng sang Editor Tab" title="Mở rộng sang Editor Tab">${ICONS.popout}</button>`
                : ""
            }
            <button type="button" class="r001-icon-btn ${activeSession?.bookmarked ? "active" : ""}" data-action="toggle-bookmark" aria-label="Đánh dấu hội thoại" title="Đánh dấu hội thoại">${activeSession?.bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</button>
            <button type="button" class="r001-icon-btn" data-action="toggle-popover" data-popover="history" aria-label="Lịch sử hội thoại" title="Lịch sử hội thoại">${ICONS.history}</button>
            <button type="button" class="r001-icon-btn" data-action="new-chat" aria-label="Cuộc trò chuyện mới" title="Cuộc trò chuyện mới">${ICONS.newChat}</button>
          </div>
        </header>

        <main class="r001-main" id="r001-scroll">
          ${
            messages.length === 0 && sessionTerminals.length === 0
              ? `
              <div class="r001-hero" id="r001-hero-stage">
                <div class="r001-hero-brand">
                  <span style="color:var(--accent-primary-bright)">${ICONS.brandPrism}</span>
                  <span class="r001-hero-title">001Router</span>
                  <span class="r001-hero-subtag">Architect Core</span>
                </div>
                <div class="r001-hero-center">
                  ${renderAxiomBot("hero", heroMood, isSing)}
                  <div class="r001-hero-name">Axiom</div>
                  <div class="r001-hero-subtitle">${
                    ws && ws.fileCount > 0
                      ? `Đã kết nối thư mục <strong>${escapeHtml(ws.projectName)}</strong> (${ws.fileCount}${ws.truncated ? "+" : ""} tệp) — sẵn sàng phân tích toàn dự án.`
                      : `Kỹ sư kiến trúc AI đồng bộ ${escapeHtml(state.envSync?.ideName || "IDE")}. Mở thư mục dự án để phân tích toàn hệ thống.`
                  }</div>
                  <div class="r001-hero-telemetry">
                    <span>${(state.catalog?.providers || []).length} providers</span>
                    <span>·</span>
                    <span>${totalModels} models</span>
                    <span>·</span>
                    <span>Effort: <strong style="color:var(--effort-color)">${escapeHtml(stop.label)}</strong></span>
                  </div>
                  <div class="r001-hero-quick">
                    <button type="button" class="r001-quick-pill" data-action="quick-prompt" data-prompt="Đọc toàn bộ dự án đang mở, tóm tắt kiến trúc, luồng hoạt động chính và các file quan trọng">${ICONS.folderTree}<span>Đọc toàn bộ dự án</span></button>
                    <button type="button" class="r001-quick-pill" data-action="quick-prompt" data-prompt="Phân tích file đang mở, tìm bug tiềm ẩn và đề xuất tối ưu kiến trúc">${ICONS.blueprint}<span>Review file đang mở</span></button>
                    <button type="button" class="r001-quick-pill" data-action="open-model-picker">${ICONS.sliders}<span>Model & Effort</span></button>
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
                              ? `<div class="r001-msg-attachments">${m.attachments
                                  .map((a) => `<span class="r001-chip ${a.isWorkspace ? "ws-chip" : ""}">${a.isWorkspace ? ICONS.folderTree : ICONS.file}<span>${escapeHtml(a.label || a.path)}</span></span>`)
                                  .join("")}</div>`
                              : ""
                          }
                          <div>${escapeHtml(m.text)}</div>
                        </div>`;
                    }
                    const isLastStreaming = isStreaming && idx === messages.length - 1;
                    return `
                      <div class="r001-msg r001-msg-assistant" id="msg-${escapeHtml(m.id)}">
                        ${renderAssistantPhaseHeader(m, isLastStreaming, isLastStreaming && hasRunningTerminal, isSing)}
                        <div class="r001-tool-slot">${renderToolTraceCard(m)}</div>
                        <div class="r001-thinking-slot">${renderThinkingCard(m, isLastStreaming)}</div>
                        <div class="r001-markdown">${renderMarkdown(m.text, m.id, isLastStreaming)}</div>
                        ${m.error ? `<div class="r001-error-banner">${escapeHtml(m.error)}</div>` : ""}
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
                ? `<div class="r001-composer-chips">
                    ${state.attachments
                      .map(
                        (a) => `<span class="r001-chip">${ICONS.file}<span>${escapeHtml(a.label)}</span><button type="button" data-action="remove-attach" data-id="${escapeHtml(a.id)}" aria-label="Gỡ tệp đính kèm">×</button></span>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
            <textarea id="r001-input" class="r001-textarea" rows="1" placeholder="Hỏi Axiom về toàn dự án, @ đính kèm tệp, hoặc /run <lệnh terminal>...">${escapeHtml(state.draft)}</textarea>
            <div class="r001-toolbar">
              <div class="r001-toolbar-left">
                <button type="button" class="r001-tool-btn" data-action="toggle-popover" data-popover="attach" aria-label="Đính kèm tệp hoặc tab" title="Đính kèm file / tab">${ICONS.plus}</button>
                <button type="button" class="r001-tool-btn framed" data-action="toggle-popover" data-popover="slash" aria-label="Lệnh nhanh Slash Commands" title="Slash Commands">${ICONS.slash}</button>
                <button type="button" class="r001-model-pill" data-action="open-model-picker" data-singularity="${isSing ? "1" : "0"}" title="${escapeHtml(`${state.selection?.providerName || "Provider"} · ${state.selection?.fullId || cleanBaseModelLabel} (${stop.label})`)}">
                  ${renderLogoPlate(selLogoFile, selProvider?.monogram || "01", selProvider?.color, "sm")}
                  <span class="r001-model-pill-name">${escapeHtml(cleanBaseModelLabel)}</span>
                  <span class="r001-model-pill-effort">
                    <span class="r001-pill-orb"></span>
                    <span class="r001-model-pill-effort-text">${escapeHtml(stop.label)}</span>
                  </span>
                </button>
              </div>
              <div class="r001-toolbar-right">
                <button type="button" class="r001-mode-btn" data-action="toggle-popover" data-popover="mode" title="Chế độ thực thi">
                  ${ICONS.bolt}
                  <span>${escapeHtml(modeLabel)}</span>
                </button>
                ${
                  isStreaming
                    ? `<button type="button" class="r001-send-btn streaming" data-action="abort-chat" aria-label="Dừng phản hồi" title="Dừng phản hồi">${ICONS.stop}</button>`
                    : `<button type="button" class="r001-send-btn" id="r001-send-btn" data-action="send-chat" aria-label="Gửi yêu cầu" title="Gửi (Enter)">${ICONS.arrowUp}</button>`
                }
              </div>
            </div>
          </div>
        </footer>

        ${renderAuthOverlay()}
      </div>
    `;

    bindDynamicListeners(hadFocus, selectionStart, selectionEnd);
    ensureLiveTicker();

    if (state.activePopover === "model") {
      const stops = profile.effortLevels;
      const idx = Math.max(0, stops.findIndex((s) => s.id === stop.id));
      const initialRatio = stops.length === 1 ? 1 : idx / Math.max(1, stops.length - 1);
      fxState.lastTierId = stop.id;
      syncSliderDom(initialRatio, false, false);
      startEffortCanvasLoop();
    }

    const scrollEl = document.getElementById("r001-scroll");
    if (scrollEl && (messages.length > 0 || sessionTerminals.length > 0)) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
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

  function bindDynamicListeners(hadFocus, selectionStart, selectionEnd) {
    const input = document.getElementById("r001-input");
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(150, Math.max(28, input.scrollHeight))}px`;
      if (hadFocus && !state.authModalOpen) {
        input.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          input.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      input.addEventListener("input", (e) => {
        state.draft = e.target.value;
        e.target.style.height = "auto";
        e.target.style.height = `${Math.min(150, Math.max(28, e.target.scrollHeight))}px`;

        // Live attentive expression on Axiom bot while the developer is typing!
        state.isTypingDraft = Boolean(state.draft.trim());
        const heroBot = document.querySelector(".axiom-bot.hero");
        if (heroBot && heroBot.dataset.mood !== "terminal") {
          heroBot.dataset.mood = state.isTypingDraft ? "listening" : "idle";
        }
        if (typingIdleTimer) clearTimeout(typingIdleTimer);
        if (state.isTypingDraft) {
          typingIdleTimer = setTimeout(() => {
            state.isTypingDraft = false;
            const liveBot = document.querySelector(".axiom-bot.hero");
            if (liveBot && liveBot.dataset.mood === "listening") {
              liveBot.dataset.mood = "idle";
            }
          }, 1800);
        }

        if (state.draft === "/") {
          state.activePopover = "slash";
          render();
        } else if (state.draft.endsWith("@")) {
          state.activePopover = "attach";
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

    // Living cursor gaze-tracking & 3D head tilt on Hero Axiom Bot
    const heroStage = document.getElementById("r001-hero-stage");
    if (heroStage && !REDUCED_MOTION_MQ.matches && !state.fxPaused) {
      heroStage.addEventListener("pointermove", (e) => {
        const bot = heroStage.querySelector(".axiom-bot.hero");
        if (!bot) return;
        const r = heroStage.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
        const ny = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
        bot.style.setProperty("--gaze-x", `${(nx * 3.8).toFixed(2)}px`);
        bot.style.setProperty("--gaze-y", `${(ny * 2.8).toFixed(2)}px`);
        bot.style.setProperty("--tilt-y", `${(nx * 12).toFixed(1)}deg`);
        bot.style.setProperty("--tilt-x", `${(-ny * 9).toFixed(1)}deg`);
      });
      heroStage.addEventListener("pointerleave", () => {
        const bot = heroStage.querySelector(".axiom-bot.hero");
        if (!bot) return;
        bot.style.setProperty("--gaze-x", "0px");
        bot.style.setProperty("--gaze-y", "0px");
        bot.style.setProperty("--tilt-y", "0deg");
        bot.style.setProperty("--tilt-x", "0deg");
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

    const wsSearch = document.getElementById("r001-ws-search");
    if (wsSearch) {
      wsSearch.addEventListener("input", (e) => {
        state.workspaceSearch = e.target.value;
        render();
        const next = document.getElementById("r001-ws-search");
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
    }

    const rangeInput = document.getElementById("r001-effort-range");
    if (rangeInput) {
      const commitSnap = () => {
        const profile = getActiveEffortProfile();
        const stops = profile.effortLevels;
        const rawRatio = Number(rangeInput.value) / 1000;
        const maxIdx = Math.max(1, stops.length - 1);
        const snapIdx = Math.min(maxIdx, Math.max(0, Math.round(rawRatio * maxIdx)));
        const snapRatio = stops.length === 1 ? 1 : snapIdx / maxIdx;
        const chosen = stops[snapIdx] || stops[0];

        rangeInput.value = String(Math.round(snapRatio * 1000));
        commitEffortChoice(chosen.id);
        syncSliderDom(snapRatio, true, true);
      };

      rangeInput.addEventListener("input", () => {
        const rawRatio = Number(rangeInput.value) / 1000;
        syncSliderDom(rawRatio, false, true);
      });

      rangeInput.addEventListener("change", commitSnap);
      rangeInput.addEventListener("pointerup", commitSnap);

      rangeInput.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
          return;
        }
        e.preventDefault();
        const profile = getActiveEffortProfile();
        const stops = profile.effortLevels;
        const curIdx = Math.max(0, stops.findIndex((s) => s.id === (state.selection?.effort || profile.defaultEffort)));
        const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
        const nextIdx = Math.min(stops.length - 1, Math.max(0, curIdx + delta));
        const nextRatio = stops.length === 1 ? 1 : nextIdx / Math.max(1, stops.length - 1);
        const chosen = stops[nextIdx];
        if (chosen) {
          rangeInput.value = String(Math.round(nextRatio * 1000));
          commitEffortChoice(chosen.id);
          syncSliderDom(nextRatio, true, true);
        }
      });
    }
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) {
      if (
        state.activePopover &&
        !e.target.closest("#r001-popover") &&
        !e.target.closest(".r001-toolbar") &&
        !e.target.closest(".r001-topbar") &&
        !e.target.closest(".r001-context-strip")
      ) {
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
      case "toggle-fx":
        state.fxPaused = !state.fxPaused;
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
        if (state.activePopover === "workspace") {
          state.workspaceSearch = "";
          vscode.postMessage({ type: "refreshWorkspace" });
        }
        render();
        break;
      }
      case "close-popover":
        state.activePopover = null;
        render();
        break;
      case "sync-env":
        vscode.postMessage({ type: "syncEnv" });
        break;
      case "refresh-workspace":
        vscode.postMessage({ type: "refreshWorkspace" });
        break;
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
      case "attach-project-file":
        if (btn.dataset.rel) {
          state.activePopover = null;
          render();
          vscode.postMessage({ type: "pickContext", kind: "projectFile", uri: btn.dataset.rel });
        }
        break;
      case "reveal-active-file":
        if (state.editorContext?.activeFile?.uri) {
          vscode.postMessage({ type: "revealFile", uri: state.editorContext.activeFile.uri });
        }
        break;
      case "quick-prompt":
        submitChat(btn.dataset.prompt || "");
        break;
      case "open-model-picker":
        if (state.activePopover === "model") {
          state.activePopover = null;
        } else {
          state.activePopover = "model";
          state.inspectingProviderSlug = state.selection?.providerSlug || null;
          state.pickerStep = state.selection?.providerSlug ? "models" : "providers";
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
          state.selection = buildSyncedSelection(prov, mod, state.selection?.effort);
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
          render();
        }
        break;
      }
      case "pick-effort-tier": {
        const tierId = btn.dataset.tier;
        if (!tierId) break;
        const provSlug = state.inspectingProviderSlug || state.selection?.providerSlug;
        const prov = (state.catalog?.providers || []).find((p) => p.slug === provSlug) || findSelectedProvider();
        const mod = findModelInProvider(prov, state.selection);
        if (prov && mod && state.selection?.kind !== "combo") {
          state.selection = buildSyncedSelection(prov, mod, tierId);
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
        } else {
          commitEffortChoice(tierId);
        }
        const profile = getActiveEffortProfile();
        const stops = profile.effortLevels;
        const idx = Math.max(0, stops.findIndex((s) => s.id === tierId));
        const ratio = stops.length === 1 ? 1 : idx / Math.max(1, stops.length - 1);
        const rangeInput = document.getElementById("r001-effort-range");
        if (rangeInput) rangeInput.value = String(Math.round(ratio * 1000));
        syncSliderDom(ratio, true, true);
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
            providerColor: "#e57452",
            baseModelId: combo.name,
            displayLabel: combo.name,
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
        if (cmd === "/provider") {
          state.activePopover = "model";
          state.pickerStep = "providers";
        } else if (cmd === "/effort") {
          state.activePopover = "model";
          state.pickerStep = "models";
        } else if (cmd === "/workspace") {
          state.activePopover = "workspace";
          vscode.postMessage({ type: "refreshWorkspace" });
        } else if (cmd === "/sync") {
          vscode.postMessage({ type: "syncEnv" });
        } else if (cmd === "/run ") {
          state.draft = "/run ";
        } else if (cmd === "/new") {
          vscode.postMessage({ type: "newChat" });
        } else if (cmd === "/connect") {
          state.authModalOpen = true;
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
      case "run-code": {
        const code = codeBlockCache.get(btn.dataset.block);
        if (code !== undefined) {
          const sess = getActiveSession();
          vscode.postMessage({
            type: "runCommand",
            command: code.trim(),
            sessionId: sess?.id
          });
        }
        break;
      }
      case "kill-term":
        vscode.postMessage({ type: "killCommand", runId: btn.dataset.run });
        break;
      case "open-ide-term":
        vscode.postMessage({ type: "openInTerminal", command: btn.dataset.cmd || "" });
        break;
      case "fix-term-error": {
        const run = state.terminalRuns.find((r) => r.runId === btn.dataset.run);
        if (run) {
          submitChat(
            `Lệnh \`${run.command}\` vừa thất bại với Exit Code ${run.exitCode}.\nOutput:\n\`\`\`\n${(run.output || "").slice(-3000)}\n\`\`\`\nHãy phân tích nguyên nhân và sửa lỗi.`
          );
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
        if (typeof msg.autoActiveFile === "boolean") {
          state.autoActiveFile = msg.autoActiveFile;
        }
        if (typeof msg.autoWorkspace === "boolean") {
          state.autoWorkspace = msg.autoWorkspace;
        }
        if (msg.envSync) state.envSync = msg.envSync;
        if (msg.editorContext) state.editorContext = msg.editorContext;
        state.sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
        state.activeSessionId = msg.activeSessionId || state.sessions[0]?.id || null;
        state.lastError = msg.lastError || "";
        if (!state.connected && state.lastError) {
          state.authModalOpen = true;
        }
        render();
        break;

      case "editorContext":
        if (msg.editorContext) {
          state.editorContext = msg.editorContext;
          if (!state.streamingSessionId) {
            render();
          }
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

      case "selectionUpdated": {
        const sameBase =
          state.selection?.providerSlug === msg.selection?.providerSlug &&
          (state.selection?.baseModelId || state.selection?.modelId) ===
            (msg.selection?.baseModelId || msg.selection?.modelId);
        state.selection = msg.selection;
        if (state.activePopover === "model" && sameBase) {
          const prof = getActiveEffortProfile();
          const stops = prof.effortLevels;
          const idx = Math.max(0, stops.findIndex((s) => s.id === state.selection?.effort));
          const r = stops.length === 1 ? 1 : idx / Math.max(1, stops.length - 1);
          const rangeInput = document.getElementById("r001-effort-range");
          if (rangeInput) rangeInput.value = String(Math.round(r * 1000));
          const pillName = document.querySelector(".r001-model-pill-name");
          if (pillName) pillName.textContent = state.selection?.displayLabel || state.selection?.baseModelId || state.selection?.modelId;
          syncSliderDom(r, true, true);
        } else {
          render();
        }
        break;
      }

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
          if (msg.phase) target.phase = msg.phase;
          if (msg.phaseDetail) target.phaseDetail = msg.phaseDetail;
          if (msg.toolLog) {
            if (!Array.isArray(target.toolLogs)) target.toolLogs = [];
            target.toolLogs.push(msg.toolLog);
          }
          patchStreamingAssistantDom(target);
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
            effort: state.selection?.effort || "medium",
            phase: "done",
            error: state.lastError
          });
        }
        render();
        break;
      }

      case "streamEnd": {
        const sess = state.sessions.find((s) => s.id === msg.sessionId);
        const target = sess?.messages?.find((m) => m.id === msg.messageId);
        if (target) {
          target.phase = "done";
          if (msg.durationMs) target.durationMs = msg.durationMs;
          if (msg.error) target.error = msg.error;
        }
        state.streamingSessionId = null;
        render();
        break;
      }

      case "terminalStart":
        state.terminalRuns.push({
          runId: msg.runId,
          sessionId: msg.sessionId || state.activeSessionId,
          command: msg.command,
          cwd: msg.cwd,
          startedAt: msg.startedAt || Date.now(),
          status: "running",
          output: "",
          exitCode: null,
          durationMs: 0
        });
        render();
        break;

      case "terminalOutput": {
        const run = state.terminalRuns.find((r) => r.runId === msg.runId);
        if (run) {
          run.output = (run.output || "") + (msg.chunk || "");
          const outEl = document.querySelector(`#term-${CSS.escape(run.runId)} .r001-terminal-out`);
          if (outEl) {
            outEl.textContent = run.output;
            outEl.scrollTop = outEl.scrollHeight;
          } else {
            render();
          }
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

  vscode.postMessage({ type: "ready" });
})();
