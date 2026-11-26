(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const root = document.getElementById("app");
  const surface = document.body.dataset.surface || "sidebar";
  const logoUri = document.body.dataset.logoUri || "";
  const providersBaseUri = (document.body.dataset.providersUri || "").replace(/\/+$/, "");

  const REDUCED_MOTION_MQ = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  // Crisp Lucide-style 1.5px stroke SVG icons (matching Claude Code 99%)
  const ICONS = {
    popout:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    bookmark:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    bookmarkFilled:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    history:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    newChat:
      '<svg class="r001-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.6-.3-3.7-.8L3 21l1.8-5.3A8.5 8.5 0 1 1 21 11.5z"/><line x1="12" y1="8" x2="12" y2="15"/><line x1="8.5" y1="11.5" x2="15.5" y2="11.5"/></svg>',
    plus:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    slash:
      '<svg class="r001-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    bolt:
      '<svg class="r001-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    arrowUp:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>',
    stop:
      '<svg class="r001-svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
    back:
      '<svg class="r001-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    refresh:
      '<svg class="r001-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    check:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    chevronRight:
      '<svg class="r001-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    file:
      '<svg class="r001-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    scissors:
      '<svg class="r001-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    folder:
      '<svg class="r001-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    eye:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff:
      '<svg class="r001-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    copy:
      '<svg class="r001-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    apply:
      '<svg class="r001-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>'
  };

  // Transparent monochrome/dark logos that need crisp white plate for maximum contrast
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

  const DEEPEN_GRAY_FILES = new Set([
    "xai.png",
    "glm.png",
    "nous.png",
    "openrouter.png"
  ]);

  const EFFORT_THEME = {
    low: {
      color: "#10B981",
      accent: "#06B6D4",
      glow: "rgba(16, 185, 129, 0.44)",
      badge: "ECO · 25%",
      rgbA: [16, 185, 129],
      rgbB: [6, 182, 212]
    },
    medium: {
      color: "#3B82F6",
      accent: "#6366F1",
      glow: "rgba(59, 130, 246, 0.5)",
      badge: "BALANCED · 50%",
      rgbA: [59, 130, 246],
      rgbB: [99, 102, 241]
    },
    high: {
      color: "#E56A4A",
      accent: "#F59E0B",
      glow: "rgba(229, 106, 74, 0.6)",
      badge: "HIGH POWER · 75%",
      rgbA: [245, 158, 11],
      rgbB: [229, 106, 74]
    },
    xhigh: {
      color: "#EC4899",
      accent: "#A855F7",
      glow: "rgba(192, 132, 252, 0.78)",
      badge: "SINGULARITY · XHIGH",
      rgbA: [236, 72, 153],
      rgbB: [168, 85, 247]
    },
    max: {
      color: "#C084FC",
      accent: "#EC4899",
      glow: "rgba(168, 85, 247, 0.82)",
      badge: "SINGULARITY · MAX",
      rgbA: [168, 85, 247],
      rgbB: [236, 72, 153]
    }
  };

  const SLASH_COMMANDS = [
    { cmd: "/provider", desc: "Mở bộ chọn Provider -> Model" },
    { cmd: "/effort", desc: "Chỉnh mức sức mạnh Effort & Hố Đen" },
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
    activePopover: null,
    pickerStep: "providers",
    inspectingProviderSlug: null,
    providerSearch: "",
    modelSearch: "",
    copiedBlockId: null,
    fxPaused: false
  };

  // Live continuous slider visual state (never triggers innerHTML while dragging)
  const fxState = {
    ratio: 0.33,
    singularity: 0,
    targetSingularity: 0,
    rgbA: [59, 130, 246],
    rgbB: [99, 102, 241],
    rafId: null,
    particles: [],
    time: 0
  };

  const codeBlockCache = new Map();

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
      return `<span class="r001-logo-plate ${sizeClass} ${isLight ? "light-plate" : ""} ${isDeep ? "deepen-gray" : ""}">` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(monogram || "AI")}" loading="eager" />` +
      `</span>`;
    }
    return `<span class="r001-logo-plate ${sizeClass}">` +
      `<span class="r001-logo-monogram" style="background:${escapeHtml(color || "#d97757")}">${escapeHtml(monogram || "01")}</span>` +
    `</span>`;
  }

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
        { id: "low", label: "Low", shortLabel: "Low", power: 1, maxScale: 4, percent: 25, color: "#10B981", accent: "#06B6D4", glow: "rgba(16, 185, 129, 0.44)", description: "Fast & lightweight response" },
        { id: "medium", label: "Medium", shortLabel: "Med", power: 2, maxScale: 4, percent: 50, color: "#3B82F6", accent: "#6366F1", glow: "rgba(59, 130, 246, 0.5)", description: "Balanced speed & reasoning depth" },
        { id: "high", label: "High", shortLabel: "High", power: 3, maxScale: 4, percent: 75, color: "#E56A4A", accent: "#F59E0B", glow: "rgba(229, 106, 74, 0.6)", description: "Deep multi-step reasoning" }
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
    // Also unlock Black Hole Singularity whenever pulled to the absolute ceiling stop on any model
    const stops = profile?.effortLevels || [];
    return stops.length >= 2 && stops[stops.length - 1].id === stop.id && stop.power === stops.length;
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
    const nearestIdx = Math.round(exactPos);
    const nearestStop = stops[nearestIdx] || stops[0];

    // Smooth singularity ramp when dragging into the upper 18% toward Max ceiling
    const isMaxZone = clamped >= 0.82;
    const singularityIntensity = isMaxZone
      ? Math.min(1, (clamped - 0.82) / 0.14)
      : 0;

    return {
      clamped,
      nearestIdx,
      nearestStop,
      rgbA,
      rgbB,
      singularityIntensity,
      isSingularity: singularityIntensity >= 0.65 || isSingularityStop(nearestStop, { effortLevels: stops }) && clamped >= 0.92
    };
  }

  function applyRootEffortVars(stop, profile, customVis) {
    const theme = EFFORT_THEME[stop.id] || EFFORT_THEME.medium;
    const isSing = customVis ? customVis.isSingularity : isSingularityStop(stop, profile);
    const color = customVis ? rgbCss(customVis.rgbA) : stop.color || theme.color;
    const accent = customVis ? rgbCss(customVis.rgbB) : stop.accent || theme.accent;
    const glow = customVis
      ? rgbCss(customVis.rgbA, isSing ? 0.78 : 0.55)
      : stop.glow || theme.glow;

    document.documentElement.style.setProperty("--effort-color", color);
    document.documentElement.style.setProperty("--effort-accent", accent);
    document.documentElement.style.setProperty("--effort-glow", glow);
    document.documentElement.style.setProperty("--singularity", isSing ? "1" : "0");

    fxState.rgbA = customVis ? customVis.rgbA : theme.rgbA;
    fxState.rgbB = customVis ? customVis.rgbB : theme.rgbB;
    fxState.targetSingularity = customVis
      ? customVis.singularityIntensity
      : isSing
        ? 1
        : 0;
  }

  // =========================================================================
  // 60fps Fluid Black Hole Singularity & Chromatic Plasma Canvas Renderer
  // =========================================================================
  function initParticles() {
    if (fxState.particles.length) return;
    for (let i = 0; i < 46; i++) {
      fxState.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 14 + Math.random() * 68,
        speed: 0.012 + Math.random() * 0.024,
        inward: 0.08 + Math.random() * 0.22,
        size: 0.9 + Math.random() * 1.9,
        hueSlot: i % 3,
        driftX: Math.random(),
        driftY: Math.random()
      });
    }
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

    // Smoothly approach target singularity intensity so entering/exiting Black Hole feels organic
    fxState.singularity = staticOnly
      ? fxState.targetSingularity
      : lerp(fxState.singularity, fxState.targetSingularity, 0.09);

    const s = fxState.singularity;
    const t = fxState.time;

    // 1) Fluid chromatic plasma wave across the effort bar (all levels)
    const waveAlpha = lerp(0.11, 0.04, s);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    const shift = (Math.sin(t * 0.9) + 1) * 0.5;
    grad.addColorStop(0, rgbCss(fxState.rgbA, waveAlpha * (0.4 + shift * 0.6)));
    grad.addColorStop(0.55, rgbCss(fxState.rgbB, waveAlpha * 1.15));
    grad.addColorStop(1, rgbCss(fxState.rgbA, waveAlpha * (1.2 - shift * 0.5)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle rising flow motes when not yet in full singularity
    if (s < 0.85) {
      ctx.globalCompositeOperation = "lighter";
      const moteFade = (1 - s) * 0.45;
      for (let i = 0; i < 16; i++) {
        const p = fxState.particles[i];
        const px = ((p.driftX * W + t * (16 + fxState.ratio * 34) * (0.6 + p.size * 0.3)) % (W + 20)) - 10;
        const py = p.driftY * H + Math.sin(t * 1.4 + i) * 3.5;
        ctx.fillStyle = rgbCss(i % 2 === 0 ? fxState.rgbA : fxState.rgbB, moteFade * 0.6);
        ctx.beginPath();
        ctx.arc(px, py, p.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // 2) Fluid Black Hole Singularity (Event Horizon + Warped Accretion Disk + Spiraling Trails)
    if (s > 0.02) {
      const cx = W - 62;
      const cy = H * 0.48;
      const horizonR = 11.5 + s * 4.5;

      // Deep spacetime gravity well vignette
      const wellGrad = ctx.createRadialGradient(cx, cy, horizonR * 0.6, cx, cy, 130 * s + 20);
      wellGrad.addColorStop(0, `rgba(2, 1, 7, ${0.95 * s})`);
      wellGrad.addColorStop(0.28, `rgba(24, 8, 48, ${0.62 * s})`);
      wellGrad.addColorStop(0.58, `rgba(88, 28, 135, ${0.24 * s})`);
      wellGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = wellGrad;
      ctx.fillRect(0, 0, W, H);

      // Additive relativistic accretion rings & swirling filaments
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Tilted elliptical accretion bands (Interstellar gravitational lensing)
      for (let ring = 0; ring < 3; ring++) {
        ctx.save();
        ctx.translate(cx, cy);
        const tilt = -0.22 + ring * 0.14 + Math.sin(t * 0.7 + ring) * 0.04;
        ctx.rotate(tilt);
        const rx = (28 + ring * 18) * (0.65 + s * 0.45);
        const ry = (8.5 + ring * 5.2) * (0.65 + s * 0.45);

        const ringGrad = ctx.createLinearGradient(-rx, 0, rx, 0);
        if (ring === 0) {
          ringGrad.addColorStop(0, `rgba(139, 92, 246, ${0.15 * s})`);
          ringGrad.addColorStop(0.35, `rgba(236, 72, 153, ${0.72 * s})`);
          ringGrad.addColorStop(0.68, `rgba(251, 191, 36, ${0.88 * s})`);
          ringGrad.addColorStop(1, `rgba(168, 85, 247, ${0.22 * s})`);
        } else if (ring === 1) {
          ringGrad.addColorStop(0, `rgba(56, 189, 248, ${0.22 * s})`);
          ringGrad.addColorStop(0.5, `rgba(168, 85, 247, ${0.55 * s})`);
          ringGrad.addColorStop(1, `rgba(236, 72, 153, ${0.38 * s})`);
        } else {
          ringGrad.addColorStop(0, `rgba(168, 85, 247, ${0.08 * s})`);
          ringGrad.addColorStop(0.5, `rgba(236, 72, 153, ${0.28 * s})`);
          ringGrad.addColorStop(1, `rgba(245, 158, 11, ${0.16 * s})`);
        }

        ctx.strokeStyle = ringGrad;
        ctx.lineWidth = (2.6 - ring * 0.6) * s;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Spiraling fluid accretion particles pulled inward along curved Keplerian orbits
      const palette = [
        [251, 191, 36], // relativistic photon gold
        [236, 72, 153], // accretion magenta
        [168, 85, 247]  // deep cosmic violet
      ];
      for (let i = 0; i < fxState.particles.length; i++) {
        const p = fxState.particles[i];
        if (!staticOnly) {
          // Faster orbital speed closer to the event horizon (Keplerian)
          const boost = 24 / Math.max(12, p.radius);
          p.angle += p.speed * boost * (0.7 + s * 0.9);
          p.radius -= p.inward * (0.55 + s * 0.85);
          if (p.radius < horizonR * 0.88) {
            p.radius = 52 + Math.random() * 44;
            p.angle = Math.random() * Math.PI * 2;
          }
        }

        const squashY = 0.42;
        const rot = -0.2;
        const rawX = Math.cos(p.angle) * p.radius;
        const rawY = Math.sin(p.angle) * p.radius * squashY;
        const x = cx + rawX * Math.cos(rot) - rawY * Math.sin(rot);
        const y = cy + rawX * Math.sin(rot) + rawY * Math.cos(rot);

        const prevAngle = p.angle - 0.22;
        const pRawX = Math.cos(prevAngle) * (p.radius + 1.8);
        const pRawY = Math.sin(prevAngle) * (p.radius + 1.8) * squashY;
        const px = cx + pRawX * Math.cos(rot) - pRawY * Math.sin(rot);
        const py = cy + pRawX * Math.sin(rot) + pRawY * Math.cos(rot);

        const proximity = Math.max(0, Math.min(1, 1 - (p.radius - horizonR) / 70));
        const col = palette[p.hueSlot];
        const alpha = (0.2 + proximity * 0.72) * s;

        ctx.strokeStyle = rgbCss(col, alpha);
        ctx.lineWidth = Math.max(0.7, p.size * (0.75 + proximity * 0.55));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Gravitational lensing Einstein Halo right around the Schwarzschild horizon
      const photonGrad = ctx.createRadialGradient(
        cx,
        cy,
        horizonR * 0.82,
        cx,
        cy,
        horizonR * 1.95
      );
      photonGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      photonGrad.addColorStop(0.28, `rgba(254, 240, 138, ${0.85 * s})`);
      photonGrad.addColorStop(0.5, `rgba(236, 72, 153, ${0.62 * s})`);
      photonGrad.addColorStop(0.76, `rgba(139, 92, 246, ${0.32 * s})`);
      photonGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = photonGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR * 1.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Event Horizon Obsidian Core (pure darkness at the singularity center)
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, horizonR);
      coreGrad.addColorStop(0, `rgba(0, 0, 0, ${0.98 * s})`);
      coreGrad.addColorStop(0.78, `rgba(4, 2, 10, ${0.95 * s})`);
      coreGrad.addColorStop(1, "rgba(4, 2, 10, 0)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function startEffortCanvasLoop() {
    stopCanvasLoop();
    const canvas = document.getElementById("r001-bh-canvas");
    if (!canvas) return;
    initParticles();

    const staticMode = REDUCED_MOTION_MQ.matches || state.fxPaused;
    if (staticMode) {
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

  // Update slider DOM in-place at 60fps without rebuilding HTML (ZERO stutter!)
  function syncSliderDom(ratio, snapWithSpring) {
    const profile = getActiveEffortProfile();
    const stops = profile.effortLevels;
    const vis = computeVisualFromRatio(ratio, stops);
    fxState.ratio = vis.clamped;

    applyRootEffortVars(vis.nearestStop, profile, vis);

    const bar = document.getElementById("r001-effort-bar");
    const shell = document.getElementById("r001-effort-shell");
    const fill = document.getElementById("r001-effort-fill");
    const thumb = document.getElementById("r001-effort-thumb");
    const levelName = document.getElementById("r001-effort-level-name");
    const powerTag = document.getElementById("r001-effort-power-tag");
    const descEl = document.getElementById("r001-effort-desc");
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

    if (shell) {
      shell.classList.toggle("spring-snap", Boolean(snapWithSpring));
      const shellW = shell.clientWidth || 132;
      const pad = 14;
      const thumbX = pad + vis.clamped * Math.max(10, shellW - pad * 2);
      const fillScale = Math.max(0.16, Math.min(1, (thumbX + 10) / shellW));

      if (fill) {
        fill.style.transform = `scaleX(${fillScale.toFixed(4)})`;
      }
      if (thumb) {
        thumb.style.transform = `translate3d(${thumbX.toFixed(2)}px, -50%, 0)`;
      }
    }

    const theme = EFFORT_THEME[vis.nearestStop.id] || EFFORT_THEME.medium;
    if (levelName) levelName.textContent = vis.nearestStop.label;
    if (powerTag) {
      powerTag.textContent = vis.isSingularity
        ? `SINGULARITY · ${vis.nearestStop.label.toUpperCase()}`
        : theme.badge;
    }
    if (descEl) {
      descEl.textContent = vis.isSingularity
        ? "Event Horizon unlocked — maximum depth & compute"
        : vis.nearestStop.description;
    }
    if (pillEffort) pillEffort.textContent = vis.nearestStop.label;
    if (rangeInput) {
      rangeInput.setAttribute(
        "aria-valuetext",
        `${vis.nearestStop.label} (${vis.nearestStop.description})`
      );
    }

    const dots = document.querySelectorAll(".r001-effort-dot");
    dots.forEach((d, idx) => {
      d.classList.toggle("passed", idx <= vis.nearestIdx);
    });

    if (REDUCED_MOTION_MQ.matches || state.fxPaused) {
      drawEffortCanvasFrame(document.getElementById("r001-bh-canvas"), true);
    }

    return vis;
  }

  // =========================================================================
  // Markdown Renderer (Headings, Lists, Blockquotes, Fenced Code + Copy/Apply)
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
      const lang = match[1] || "code";
      const code = match[2];
      const blockKey = `${messageId}:${blockIdx++}`;
      const copied = state.copiedBlockId === blockKey;
      parts.push(
        `<div class="r001-codeblock">` +
          `<div class="r001-codeblock-head">` +
            `<span>${escapeHtml(lang)}</span>` +
            `<div class="r001-codeblock-actions">` +
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

    const html = parts.join("") || (isStreamingThis ? "" : "<p>...</p>");
    return isStreamingThis ? `${html}<span class="r001-stream-caret"></span>` : html;
  }

  function renderMascotSvg() {
    return `<svg class="r001-mascot" viewBox="0 0 64 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="44" height="24" rx="2" fill="#D97757"/>
      <rect x="4" y="18" width="6" height="10" fill="#D97757"/>
      <rect x="54" y="18" width="6" height="10" fill="#D97757"/>
      <rect x="18" y="17" width="6" height="7" fill="#1E1E1E"/>
      <rect x="40" y="17" width="6" height="7" fill="#1E1E1E"/>
      <rect x="12" y="34" width="6" height="10" fill="#D97757"/>
      <rect x="22" y="34" width="6" height="10" fill="#D97757"/>
      <rect x="36" y="34" width="6" height="10" fill="#D97757"/>
      <rect x="46" y="34" width="6" height="10" fill="#D97757"/>
      <circle cx="32" cy="5.5" r="3" fill="#F59E0B"/>
      <rect x="30.5" y="7" width="3" height="3.5" fill="#F59E0B"/>
    </svg>`;
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
    const modelShort = state.selection?.modelId || "Model";

    return `
      <div class="r001-effort-bar" id="r001-effort-bar" data-power="${stop.power}" data-effort="${escapeHtml(stop.id)}" data-singularity="${isSing ? "1" : "0"}">
        <canvas class="r001-bh-canvas" id="r001-bh-canvas" aria-hidden="true"></canvas>
        <div class="r001-effort-aura" aria-hidden="true"></div>
        <div class="r001-effort-top">
          <div class="r001-effort-label-wrap">
            <label class="r001-effort-title" for="r001-effort-range">Effort (<span class="r001-effort-level-name" id="r001-effort-level-name">${escapeHtml(stop.label)}</span>)</label>
            <span class="r001-effort-power-tag" id="r001-effort-power-tag">${escapeHtml(isSing ? `SINGULARITY · ${stop.label.toUpperCase()}` : theme.badge)}</span>
          </div>
          <div class="r001-effort-track-shell" id="r001-effort-shell">
            <div class="r001-effort-clip">
              <div class="r001-effort-fill" id="r001-effort-fill"></div>
            </div>
            <div class="r001-effort-dots" aria-hidden="true">
              ${stops
                .map((_, i) => `<span class="r001-effort-dot ${i <= idx ? "passed" : ""}"></span>`)
                .join("")}
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
              aria-label="Mức Effort cho model"
              aria-valuetext="${escapeHtml(stop.label)} — ${escapeHtml(stop.description)}"
            />
          </div>
        </div>
        <div class="r001-effort-sub">
          <span class="r001-effort-sub-left" id="r001-effort-desc">${escapeHtml(isSing ? "Event Horizon unlocked — maximum depth & compute" : stop.description)}</span>
          <span class="r001-effort-sub-right">
            <span>Max: <strong>${escapeHtml(profile.maxLabel)}</strong> · ${escapeHtml(modelShort)}</span>
            ${
              !REDUCED_MOTION_MQ.matches
                ? `<button type="button" class="r001-fx-pause-btn" data-action="toggle-fx" title="Tạm dừng / phát hiệu ứng Hố Đen">${state.fxPaused ? "Play FX" : "Pause FX"}</button>`
                : ""
            }
          </span>
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
            <span class="r001-popover-title">Select a provider</span>
            <button type="button" class="r001-back-btn" data-action="refresh-catalog" title="Đồng bộ lại danh sách provider">${ICONS.refresh}<span>Sync</span></button>
          </div>
          <input type="text" class="r001-search" id="r001-provider-search" placeholder="Tìm nhà cung cấp (OpenAI, Anthropic, Antigravity, xAI...)" value="${escapeHtml(state.providerSearch)}" />
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
                              <div class="r001-prov-sub">${escapeHtml(connLabel)} · ${p.modelCount} models</div>
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
                            ${renderLogoPlate("", "CB", "#d97757", "md")}
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

    // Step 2: Models for the chosen provider (with real Model Family Images!)
    const provider = providers.find((p) => p.slug === activeSlug) || providers[0];
    const pLogo = resolveProviderLogoFile(provider);
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
            <button type="button" class="r001-back-btn" data-action="back-providers">${ICONS.back}<span>Providers</span></button>
            ${renderLogoPlate(pLogo, provider?.monogram || "AI", provider?.color, "sm")}
            <span style="color:#f4f4f5;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(provider?.name || "Select a model")}</span>
          </div>
          <span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${models.length} models</span>
        </div>
        <input type="text" class="r001-search" id="r001-model-search" placeholder="Lọc model trong ${escapeHtml(provider?.name || "")}..." value="${escapeHtml(state.modelSearch)}" />
        <div class="r001-popover-list">
          ${
            defaultModel && !q
              ? (() => {
                  const defLogo = resolveModelLogoFile(defaultModel.id, provider, defaultModel.logoFile);
                  const isDefSel =
                    state.selection?.providerSlug === provider.slug &&
                    state.selection?.modelId === defaultModel.id;
                  return `
                    <button type="button" class="r001-model-item ${isDefSel ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(defaultModel.id)}">
                      <div class="r001-model-left">
                        ${renderLogoPlate(defLogo, provider?.monogram || "AI", provider?.color, "md")}
                        <div style="min-width:0;flex:1">
                          <div class="r001-model-name">Default (recommended)</div>
                          <div class="r001-model-desc">${escapeHtml(defaultModel.id)} · Best everyday choice</div>
                        </div>
                      </div>
                      ${isDefSel ? ICONS.check : ""}
                    </button>`;
                })()
              : ""
          }
          ${models
            .map((m) => {
              const isSelected =
                state.selection?.kind !== "combo" &&
                state.selection?.providerSlug === provider.slug &&
                state.selection?.modelId === m.id;
              const mLogo = resolveModelLogoFile(m.id, provider, m.logoFile);
              const isTopTier = m.effort?.maxEffort === "max" || m.effort?.maxEffort === "xhigh";
              return `
                <button type="button" class="r001-model-item ${isSelected ? "selected" : ""}" data-action="select-model" data-slug="${escapeHtml(provider.slug)}" data-model="${escapeHtml(m.id)}">
                  <div class="r001-model-left">
                    ${renderLogoPlate(mLogo, provider?.monogram || "AI", provider?.color, "md")}
                    <div style="min-width:0;flex:1">
                      <div class="r001-model-title-row">
                        <span class="r001-model-name">${escapeHtml(m.label)}</span>
                        <span class="r001-cap-tag ${isTopTier ? "max-tag" : ""}">Max ${escapeHtml(m.effort?.maxLabel || "High")}</span>
                      </div>
                      <div class="r001-model-desc">${escapeHtml(m.description)}</div>
                    </div>
                  </div>
                  ${isSelected ? `<span style="flex-shrink:0">${ICONS.check}</span>` : ""}
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
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:220px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Đính kèm ngữ cảnh mã nguồn</span>
            <button type="button" class="r001-back-btn" data-action="close-popover">Đóng</button>
          </div>
          <div class="r001-popover-list">
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="activeFile">
              <div class="r001-model-left">${ICONS.file}<div><div class="r001-model-name">Tệp đang mở (Active Editor)</div><div class="r001-model-desc">Đưa toàn bộ file đang mở vào prompt</div></div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="selection">
              <div class="r001-model-left">${ICONS.scissors}<div><div class="r001-model-name">Đoạn code đang chọn (Selection)</div><div class="r001-model-desc">Chỉ đính kèm vùng dòng đang bôi đen</div></div></div>
            </button>
            <button type="button" class="r001-model-item" data-action="attach-ctx" data-kind="workspaceFile">
              <div class="r001-model-left">${ICONS.folder}<div><div class="r001-model-name">Chọn tệp từ Workspace...</div><div class="r001-model-desc">Tìm kiếm bất kỳ file nào trong dự án</div></div></div>
            </button>
          </div>
        </div>
      `;
    }

    if (state.activePopover === "slash") {
      return `
        <div class="r001-popover" id="r001-popover" style="max-height:240px">
          <div class="r001-popover-head">
            <span class="r001-popover-title">Slash Commands</span>
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
        { id: "auto", label: "Auto", desc: "Tự động phân tích & đề xuất chỉnh sửa code trực tiếp" },
        { id: "ask", label: "Ask", desc: "Hỏi đáp nhanh, giải thích code và debug" },
        { id: "plan", label: "Plan", desc: "Lập kế hoạch kiến trúc từng bước trước khi viết code" }
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
                <div class="r001-model-left">${ICONS.bolt}<div><div class="r001-model-name">${escapeHtml(m.label)}</div><div class="r001-model-desc">${escapeHtml(m.desc)}</div></div></div>
                ${state.mode === m.id ? ICONS.check : ""}
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
              <div class="r001-auth-desc">Nhập URL & mật khẩu trang quản trị 001Router để xác nhận kết nối.</div>
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
              <button type="button" class="r001-eye-btn" data-action="toggle-pw" title="Hiện/Ẩn mật khẩu">${state.authShowPassword ? ICONS.eyeOff : ICONS.eye}</button>
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
    const selLogoFile = resolveModelLogoFile(
      state.selection?.modelId,
      selProvider,
      selModelObj?.logoFile
    );
    const pillModelLabel = state.selection?.modelId || "Select Model";
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
            <button type="button" class="r001-conn-pill ${state.connected ? "connected" : ""}" data-action="open-auth" title="${escapeHtml(state.serverUrl)}">
              <span class="r001-conn-dot"></span>
              <span>${state.connected ? "Connected" : "Locked"}</span>
            </button>
          </div>
          <div class="r001-topbar-actions">
            ${
              surface === "sidebar"
                ? `<button type="button" class="r001-icon-btn" data-action="open-tab" title="Mở thành Editor Tab (giống Claude Code)">${ICONS.popout}</button>`
                : ""
            }
            <button type="button" class="r001-icon-btn ${activeSession?.bookmarked ? "active" : ""}" data-action="toggle-bookmark" title="Đánh dấu hội thoại">${activeSession?.bookmarked ? ICONS.bookmarkFilled : ICONS.bookmark}</button>
            <button type="button" class="r001-icon-btn" data-action="toggle-popover" data-popover="history" title="Lịch sử hội thoại">${ICONS.history}</button>
            <button type="button" class="r001-icon-btn" data-action="new-chat" title="Cuộc trò chuyện mới">${ICONS.newChat}</button>
          </div>
        </header>

        <main class="r001-main" id="r001-scroll">
          ${
            messages.length === 0
              ? `
              <div class="r001-hero">
                <div class="r001-hero-brand">
                  <img class="r001-hero-logo" src="${escapeHtml(logoUri)}" alt="001Router" />
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
                  .map((m, idx) => {
                    if (m.role === "user") {
                      return `
                        <div class="r001-msg r001-msg-user">
                          ${
                            Array.isArray(m.attachments) && m.attachments.length
                              ? `<div class="r001-msg-attachments">${m.attachments
                                  .map((a) => `<span class="r001-chip">${ICONS.file}<span>${escapeHtml(a.label || a.path)}</span></span>`)
                                  .join("")}</div>`
                              : ""
                          }
                          <div>${escapeHtml(m.text)}</div>
                        </div>`;
                    }
                    const isLastStreaming = isStreaming && idx === messages.length - 1;
                    const msgModelLogo = resolveModelLogoFile(m.model || "", null);
                    const effId = String(m.effort || "medium").toLowerCase();
                    return `
                      <div class="r001-msg r001-msg-assistant">
                        <div class="r001-msg-header">
                          ${renderLogoPlate(msgModelLogo, "01", "#d97757", "sm")}
                          <span class="r001-msg-model-name">${escapeHtml(m.model || "001Router")}</span>
                          <span class="r001-effort-badge" data-effort="${escapeHtml(effId)}">${escapeHtml(effId.toUpperCase())}</span>
                        </div>
                        ${
                          m.reasoning
                            ? `<details class="r001-reasoning"><summary>Thinking process (${m.reasoning.length} chars)</summary><div class="r001-reasoning-body">${escapeHtml(m.reasoning)}</div></details>`
                            : ""
                        }
                        <div class="r001-markdown">${renderMarkdown(m.text, m.id, isLastStreaming)}</div>
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
          <div class="r001-composer" data-singularity="${isSing ? "1" : "0"}">
            ${
              state.attachments.length
                ? `<div class="r001-composer-chips">
                    ${state.attachments
                      .map(
                        (a) => `<span class="r001-chip">${ICONS.file}<span>${escapeHtml(a.label)}</span><button type="button" data-action="remove-attach" data-id="${escapeHtml(a.id)}">×</button></span>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
            <textarea id="r001-input" class="r001-textarea" rows="1" placeholder="ctrl esc to focus or unfocus 001Router">${escapeHtml(state.draft)}</textarea>
            <div class="r001-toolbar">
              <div class="r001-toolbar-left">
                <button type="button" class="r001-tool-btn" data-action="toggle-popover" data-popover="attach" title="Đính kèm file / code">${ICONS.plus}</button>
                <button type="button" class="r001-tool-btn framed" data-action="toggle-popover" data-popover="slash" title="Slash Commands">${ICONS.slash}</button>
                <button type="button" class="r001-model-pill" data-action="open-model-picker" data-singularity="${isSing ? "1" : "0"}" title="${escapeHtml(`${state.selection?.providerName || "Provider"} / ${pillModelLabel} (${stop.label})`)}">
                  ${renderLogoPlate(selLogoFile, selProvider?.monogram || "01", selProvider?.color, "sm")}
                  <span class="r001-model-pill-name">${escapeHtml(pillModelLabel)}</span>
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
                    ? `<button type="button" class="r001-send-btn streaming" data-action="abort-chat" title="Dừng phản hồi">${ICONS.stop}</button>`
                    : `<button type="button" class="r001-send-btn" id="r001-send-btn" data-action="send-chat" title="Gửi (Enter)">${ICONS.arrowUp}</button>`
                }
              </div>
            </div>
          </div>
        </footer>

        ${renderAuthOverlay()}
      </div>
    `;

    bindDynamicListeners(hadFocus, selectionStart, selectionEnd);

    if (state.activePopover === "model") {
      const stops = profile.effortLevels;
      const idx = Math.max(0, stops.findIndex((s) => s.id === stop.id));
      const initialRatio = stops.length === 1 ? 1 : idx / Math.max(1, stops.length - 1);
      syncSliderDom(initialRatio, false);
      startEffortCanvasLoop();
    }

    const scrollEl = document.getElementById("r001-scroll");
    if (scrollEl && messages.length > 0) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
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

    // Native Range Slider — ZERO innerHTML rebuild while dragging (butter-smooth 60-144Hz!)
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
        syncSliderDom(snapRatio, true);

        if (state.selection && chosen.id !== state.selection.effort) {
          state.selection = { ...state.selection, effort: chosen.id };
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
        }
      };

      rangeInput.addEventListener("input", () => {
        const rawRatio = Number(rangeInput.value) / 1000;
        syncSliderDom(rawRatio, false);
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
        rangeInput.value = String(Math.round(nextRatio * 1000));
        syncSliderDom(nextRatio, true);
        const chosen = stops[nextIdx];
        if (state.selection && chosen) {
          state.selection = { ...state.selection, effort: chosen.id };
          vscode.postMessage({ type: "saveSelection", selection: state.selection });
        }
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
            providerColor: "#d97757",
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

      case "selectionUpdated": {
        // Avoid nuking the slider mid-drag if this echo matches our own live effort change
        const sameProviderModel =
          state.selection?.providerSlug === msg.selection?.providerSlug &&
          state.selection?.modelId === msg.selection?.modelId;
        state.selection = msg.selection;
        if (state.activePopover === "model" && sameProviderModel) {
          const prof = getActiveEffortProfile();
          const stops = prof.effortLevels;
          const idx = Math.max(0, stops.findIndex((s) => s.id === state.selection?.effort));
          const r = stops.length === 1 ? 1 : idx / Math.max(1, stops.length - 1);
          const rangeInput = document.getElementById("r001-effort-range");
          if (rangeInput) rangeInput.value = String(Math.round(r * 1000));
          syncSliderDom(r, true);
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
