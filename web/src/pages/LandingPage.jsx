import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Cpu,
  Flame,
  Globe,
  Image,
  KeyRound,
  Layers,
  MessageSquare,
  Mic,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Scissors,
  Search,
  Server,
  Sparkles,
  Sun,
  Terminal,
  Video,
  Volume2,
  Waypoints,
  Zap,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { LucianMagneticButton } from '../components/lucian/LucianMagneticButton';
import { LucianGlowGrid, LucianGlowCard } from '../components/lucian/LucianGlowGrid';
import { LucianSlidingTabs } from '../components/lucian/LucianSlidingTabs';
import { LucianGridBeamHero } from '../components/lucian/LucianGridBeamHero';
import {
  LucianReleasePill,
  LucianWordRiseHeadline,
} from '../components/lucian/LucianWordRiseHeadline';
import { LucianOdometerStats } from '../components/lucian/LucianOdometerStats';
import { LucianLogoMarquee } from '../components/lucian/LucianLogoMarquee';
import { LucianSpotlightCta } from '../components/lucian/LucianSpotlightCta';
import './LandingPage.css';

const NAV_SECTIONS = [
  { id: 'service-kinds', label: 'Service Kinds' },
  { id: 'how-it-works', label: '3-Tier Routing' },
  { id: 'providers', label: 'Providers' },
  { id: 'integrations', label: 'CLI / IDE' },
  { id: 'token-saver', label: 'Token Saver' },
  { id: 'get-started', label: 'Quick Start' },
];

const MARQUEE_PROVIDERS = [
  { preset: 'openai', name: 'OpenAI' },
  { preset: 'anthropic', name: 'Anthropic' },
  { preset: 'antigravity', name: 'Antigravity' },
  { preset: 'gemini', name: 'Google Gemini' },
  { preset: 'deepseek', name: 'DeepSeek' },
  { preset: 'groq', name: 'Groq' },
  { preset: 'cerebras', name: 'Cerebras' },
  { preset: 'openrouter', name: 'OpenRouter' },
  { preset: 'xai', name: 'xAI' },
  { preset: 'mistral', name: 'Mistral' },
  { preset: 'fireworks', name: 'Fireworks AI' },
  { preset: 'together', name: 'Together AI' },
  { preset: 'perplexity', name: 'Perplexity' },
  { preset: 'cohere', name: 'Cohere' },
  { preset: 'ollama', name: 'Ollama' },
  { preset: 'claude', name: 'Claude Code' },
  { preset: 'cursor', name: 'Cursor' },
  { preset: 'codex', name: 'Codex CLI' },
];

const HERO_STATS = [
  { value: '47+', label: 'AI Providers' },
  { value: '9', label: 'Unified Service Kinds' },
  { value: '470+', label: 'Cataloged AI Models' },
  { value: '3-Tier', label: 'Smart Auto Failover' },
];

const PRISM_TIERS = [
  {
    id: 0,
    tier: 'Tier 1 · Flagship',
    model: 'Claude Sonnet / GPT-4.1',
    latency: '11ms',
    cost: 'Primary',
    color: '#E56A4A',
    statusNote: 'Primary stream active · Zero translation overhead',
  },
  {
    id: 1,
    tier: 'Tier 2 · Cheap Coding',
    model: 'DeepSeek V3 / GLM / MiniMax',
    latency: '14ms',
    cost: '$0.20–$0.60/1M',
    color: '#F59E0B',
    statusNote: 'HTTP 429 on Tier 1 → Seamless failover in 14ms',
  },
  {
    id: 2,
    tier: 'Tier 3 · Free & Local',
    model: 'Gemini Flash / Groq / Ollama',
    latency: '9ms',
    cost: '$0 / month',
    color: '#34D399',
    statusNote: 'Tier 1–2 cooling down → Zero-cost fallback active',
  },
];

const SERVICE_KINDS = [
  {
    id: 'chat',
    title: 'Chat / LLM',
    endpoint: 'POST /v1/chat/completions & /v1/messages',
    desc: 'OpenAI & Anthropic compatible chat completions across 47+ providers with bidirectional format translation.',
    icon: MessageSquare,
  },
  {
    id: 'embeddings',
    title: 'Embeddings',
    endpoint: 'POST /v1/embeddings',
    desc: 'Voyage AI, Jina Embeddings v3, OpenAI, Gemini, Cohere, Mistral, NVIDIA NIM, Together, Fireworks.',
    icon: Cpu,
  },
  {
    id: 'tts',
    title: 'Text-to-Speech (TTS)',
    endpoint: 'POST /v1/audio/speech',
    desc: 'ElevenLabs Multilingual v2 & Flash v2.5, Deepgram Aura, OpenAI TTS, MiniMax Speech.',
    icon: Volume2,
  },
  {
    id: 'stt',
    title: 'Speech-to-Text (STT)',
    endpoint: 'POST /v1/audio/transcriptions',
    desc: 'Deepgram Nova-3, AssemblyAI Universal-2, OpenAI Whisper & GPT-4o Transcribe, Groq Whisper.',
    icon: Mic,
  },
  {
    id: 'image',
    title: 'Image Generation',
    endpoint: 'POST /v1/images/generations',
    desc: 'Fal AI, Black Forest Labs FLUX 1.1 Pro, Stability SD3.5, Recraft V3, OpenAI GPT-Image-1, Together.',
    icon: Image,
  },
  {
    id: 'vision',
    title: 'Vision / Image-to-Text',
    endpoint: 'POST /v1/chat/completions',
    desc: 'Multimodal image & document understanding via Gemini, Claude, GPT, Grok, and Mistral Pixtral.',
    icon: Sparkles,
  },
  {
    id: 'video',
    title: 'Video Generation',
    endpoint: 'POST /v1/videos/generations',
    desc: 'Runway ML Gen-4 Turbo & Gen-3 Alpha, Fal AI Kling & Veo multimodal pipelines.',
    icon: Video,
  },
  {
    id: 'search',
    title: 'Web Search',
    endpoint: 'POST /v1/search',
    desc: 'Tavily AI Search, Brave Search, Serper.dev, Exa Neural Search, Linkup, Google PSE, SearchAPI, SearXNG.',
    icon: Search,
  },
  {
    id: 'fetch',
    title: 'Web Fetch / Reader',
    endpoint: 'POST /v1/web/fetch',
    desc: 'Clean LLM-ready Markdown extraction via Firecrawl, Jina Reader, Tavily Extract, Exa Contents.',
    icon: Globe,
  },
];

const SHOWCASE_GROUPS = [
  {
    id: 'free',
    tabLabel: 'Free Tier',
    title: 'Free-Tier AI Providers',
    badge: '$0 / month',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    items: [
      { preset: 'gemini', name: 'Google Gemini', tag: 'Free Tier · 1M ctx' },
      { preset: 'antigravity', name: 'Antigravity (Google)', tag: 'Cloud Code Assist' },
      { preset: 'groq', name: 'Groq LPU', tag: 'Free Tier · Ultra Fast' },
      { preset: 'cerebras', name: 'Cerebras', tag: 'Free Tier · 2000+ tok/s' },
      { preset: 'openrouter', name: 'OpenRouter', tag: 'Free Models (:free)' },
      { preset: 'nvidia', name: 'NVIDIA NIM', tag: 'Free Developer Credits' },
      { preset: 'sambanova', name: 'SambaNova', tag: 'Free Cloud RDU' },
      { preset: 'huggingface', name: 'Hugging Face', tag: 'Free Inference Router' },
      { preset: 'mistral', name: 'Mistral La Plateforme', tag: 'Free Experiment Tier' },
    ],
  },
  {
    id: 'cheap',
    tabLabel: 'Cheap Coding',
    title: 'Cheap & Coding Plans',
    badge: '$0.20–$0.60 / 1M',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    items: [
      { preset: 'deepseek', name: 'DeepSeek V3 / R1', tag: '$0.27 / 1M tokens' },
      { preset: 'glm', name: 'Zhipu GLM Coding', tag: '$0.60 / 1M tokens' },
      { preset: 'minimax', name: 'MiniMax M1 / Text-01', tag: '$0.20 / 1M · 1M ctx' },
      { preset: 'kimi', name: 'Moonshot Kimi K2', tag: '256K Coding Plan' },
      { preset: 'alibaba', name: 'Alibaba Qwen3 Coder', tag: '$0.40 / 1M tokens' },
      { preset: 'siliconflow', name: 'SiliconFlow', tag: 'DeepSeek & Qwen Host' },
      { preset: 'chutes', name: 'Chutes AI', tag: 'Serverless OSS LLMs' },
      { preset: 'featherless', name: 'Featherless AI', tag: 'Flat-Rate OSS Models' },
      { preset: 'novita', name: 'Novita AI', tag: 'Low-Cost Coding Inference' },
    ],
  },
  {
    id: 'flagship',
    tabLabel: 'Flagship & Local',
    title: 'Flagship, Cloud & Local Providers',
    badge: 'Cloud & Local',
    badgeClass: 'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30',
    items: [
      { preset: 'openai', name: 'OpenAI', tag: 'GPT-6.2 · GPT-4.1 · Codex' },
      { preset: 'anthropic', name: 'Anthropic', tag: 'Claude Sonnet & Opus' },
      { preset: 'xai', name: 'xAI Grok', tag: 'Grok 3 & Grok 3 Mini' },
      { preset: 'together', name: 'Together AI', tag: 'Turbo Open Models' },
      { preset: 'fireworks', name: 'Fireworks AI', tag: 'Fast Function Calling' },
      { preset: 'perplexity', name: 'Perplexity Sonar', tag: 'Grounded Search LLM' },
      { preset: 'cohere', name: 'Cohere Command A', tag: 'RAG & Multilingual Chat' },
      { preset: 'azure', name: 'Azure OpenAI', tag: 'Cloud OpenAI Deployment' },
      { preset: 'bedrock', name: 'AWS Bedrock', tag: 'Claude & Nova Gateway' },
      { preset: 'vertex', name: 'Google Vertex AI', tag: 'GCP Gemini Models' },
      { preset: 'ollama', name: 'Ollama (Local)', tag: 'Local GPU · Offline' },
      { preset: 'lmstudio', name: 'LM Studio / vLLM', tag: 'Local OpenAI Server' },
    ],
  },
];

const PROVIDER_TABS = [
  { id: 'all', label: 'All Providers' },
  { id: 'free', label: 'Free Tier' },
  { id: 'cheap', label: 'Cheap Coding' },
  { id: 'flagship', label: 'Flagship & Local' },
];

const CLI_INTEGRATIONS = [
  { id: 'claude', name: 'Claude Code', desc: 'Anthropic Claude CLI (/v1/messages)' },
  { id: 'codex', name: 'OpenAI Codex CLI', desc: '~/.codex/config.toml provider' },
  { id: 'cursor', name: 'Cursor IDE', desc: 'OpenAI Base URL override' },
  { id: 'cline', name: 'Cline', desc: 'VS Code autonomous coding agent' },
  { id: 'roo', name: 'Roo Code', desc: 'Multi-mode VS Code AI assistant' },
  { id: 'continue', name: 'Continue.dev', desc: 'Open-source IDE autopilot' },
  { id: 'opencode', name: 'OpenCode', desc: 'Terminal TUI coding agent' },
  { id: 'windsurf', name: 'Windsurf', desc: 'Cascade custom endpoint' },
  { id: 'kilocode', name: 'Kilo Code', desc: 'AI code generation extension' },
  { id: 'droid', name: 'Factory Droid', desc: 'Autonomous software engineering' },
  { id: 'hermes', name: 'Hermes Agent', desc: 'Self-improving terminal agent' },
  { id: 'openclaw', name: 'OpenClaw', desc: 'OpenClaw coding assistant' },
];

const ADVANCED_FEATURES = [
  {
    title: 'Smart 3-Tier Combos',
    desc: 'Chain Flagship → Cheap → Free providers into a single virtual model alias with sticky round-robin or ordered failover.',
    icon: Layers,
  },
  {
    title: 'Real-Time Quota & Cooldowns',
    desc: 'Live daily/monthly token budget bars and automatic 60-second per-key cooldown rotation on HTTP 429 rate limits.',
    icon: Zap,
  },
  {
    title: 'Bidirectional Format Translator',
    desc: 'Seamlessly translates Anthropic /v1/messages (thinking, tool_use, images) ⇄ OpenAI /v1/chat/completions.',
    icon: Repeat,
  },
  {
    title: 'Multi-Key Round-Robin',
    desc: 'Attach multiple API keys or OAuth accounts per provider for automatic load distribution and zero-downtime failover.',
    icon: KeyRound,
  },
  {
    title: 'Live Topology & Telemetry',
    desc: 'Watch live request beams, per-provider latency, token counts, and attempt trails stream in real time.',
    icon: Activity,
  },
  {
    title: 'Outbound Proxy Pools',
    desc: 'Route region-restricted APIs through HTTP, HTTPS, or SOCKS5 outbound proxy pools with per-provider assignment.',
    icon: Globe,
  },
  {
    title: '9 Unified Service Kinds',
    desc: 'One gateway serves Chat, Messages, Embeddings, Image Gen, Video, TTS, STT, Web Search, and Web Fetch.',
    icon: Server,
  },
  {
    title: '470+ AI Models Explorer',
    desc: 'Searchable catalog of 470+ latest models across 47+ providers with context windows, pricing, and capabilities.',
    icon: Cpu,
  },
  {
    title: '1-Click CLI & IDE Setup',
    desc: 'Apply or copy ready-to-run configs for Claude Code, Codex CLI, Cursor, Cline, Roo Code, and Windsurf in seconds.',
    icon: Terminal,
  },
];

const SNIPPET_TABS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'curl', label: 'OpenAI cURL' },
  { id: 'sdk', label: 'Anthropic SDK' },
];

export function LandingPage() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [providerTab, setProviderTab] = useState('all');
  const [snippetTab, setSnippetTab] = useState('claude');
  const [activeTier, setActiveTier] = useState(0);
  const [activeSection, setActiveSection] = useState('');
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [ambientPaused, setAmbientPaused] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      ? true
      : false
  );

  const progressRef = useRef(null);
  const pageRef = useRef(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const v1Endpoint = `${origin}/v1`;

  // Auto-cycle the live 3-tier neural prism demonstration unless paused or reduced-motion
  useEffect(() => {
    if (ambientPaused) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;
    const id = setInterval(() => {
      setActiveTier((prev) => (prev + 1) % PRISM_TIERS.length);
    }, 4600);
    return () => clearInterval(id);
  }, [ambientPaused]);

  // Fallback scroll progress bar + header elevation when native CSS scroll-timeline is unsupported
  useEffect(() => {
    const bar = progressRef.current;
    const supportsScrollTimeline = window.CSS?.supports?.('animation-timeline', 'scroll()');
    const supportsHeaderTimeline = window.CSS?.supports?.(
      '(animation-timeline: scroll()) and (animation-range: 0% 100%)'
    );
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let raf = 0;
    const update = () => {
      raf = 0;
      if (!supportsHeaderTimeline) {
        setHeaderScrolled(window.scrollY > 28);
      }
      if (bar && !reduced && !supportsScrollTimeline) {
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
        bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Scroll-spy active nav pill highlight
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const sections = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (sections.length === 0) return undefined;

    const spy = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: '-28% 0px -56% 0px', threshold: [0, 0.25, 0.5] }
    );

    sections.forEach((sec) => spy.observe(sec));
    return () => spy.disconnect();
  }, []);

  // One-shot IntersectionObserver scroll-in reveals (low threshold so tall cards never stick hidden)
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;
    const targets = Array.from(root.querySelectorAll('[data-reveal]'));
    if (targets.length === 0) return undefined;

    const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (rm || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.setAttribute('data-reveal', 'in'));
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-reveal', 'in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: '0px 0px -20px 0px' }
    );

    targets.forEach((el) => {
      if (el.getAttribute('data-reveal') !== 'in') {
        io.observe(el);
      }
    });
    return () => io.disconnect();
  }, []);

  const visibleProviderGroups = useMemo(() => {
    if (providerTab === 'all') return SHOWCASE_GROUPS;
    return SHOWCASE_GROUPS.filter((g) => g.id === providerTab);
  }, [providerTab]);

  const activeSnippet = useMemo(() => {
    if (snippetTab === 'curl') {
      return {
        filename: 'curl — chat completions',
        code: `curl -sS ${v1Endpoint}/chat/completions \\
  -H "Authorization: Bearer sk-001r-YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "3-tier-auto",
    "stream": true,
    "messages": [{"role": "user", "content": "Refactor this module"}]
  }'`,
      };
    }
    if (snippetTab === 'sdk') {
      return {
        filename: 'anthropic.ts — sdk setup',
        code: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${origin}",
  apiKey: "sk-001r-YOUR_KEY",
});

const msg = await client.messages.create({
  model: "3-tier-auto",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Explain the failover pipeline" }],
});`,
      };
    }
    return {
      filename: 'terminal — claude code',
      code: `# Connect Claude Code to 001Router
export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_AUTH_TOKEN="sk-001r-YOUR_KEY"
export ANTHROPIC_MODEL="3-tier-auto"
claude`,
    };
  }, [origin, v1Endpoint, snippetTab]);

  const activePrismTier = PRISM_TIERS[activeTier];

  const handleBrandClick = () => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        ? 'auto'
        : 'smooth',
    });
  };

  return (
    <div
      ref={pageRef}
      data-ambient-paused={ambientPaused ? 'true' : 'false'}
      className="landing-page-root landing-grid min-h-dvh text-[var(--text-primary)]"
    >
      {/* Fixed ethereal nebula depth layer behind architectural grid */}
      <div className="landing-ambient-layer" aria-hidden="true">
        <div className="landing-ambient-orb landing-ambient-orb-1" />
        <div className="landing-ambient-orb landing-ambient-orb-2" />
        <div className="landing-ambient-orb landing-ambient-orb-3" />
      </div>

      {/* Luminous scroll progress bar (native CSS scroll-timeline with rAF fallback) */}
      <div ref={progressRef} className="landing-scroll-progress" aria-hidden="true" />

      {/* Scroll-reactive glass navbar */}
      <header className="landing-header" data-scrolled={headerScrolled ? 'true' : 'false'}>
        <div className="landing-header-inner mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/landing"
            onClick={handleBrandClick}
            className="group flex items-center gap-2.5 focus-visible:rounded-lg"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] via-[#f59e0b] to-[#cc5236] text-white shadow-sm transition-transform duration-300 group-hover:scale-105">
              <Waypoints className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight">001Router</span>
              <span className="hidden rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#E56A4A] sm:inline">
                v2.0
              </span>
            </div>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden items-center gap-1 text-xs font-medium md:flex"
          >
            {NAV_SECTIONS.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                data-active={activeSection === sec.id ? 'true' : 'false'}
                className="landing-nav-link"
              >
                {sec.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* WCAG 2.2.2 Pause/Play control for ambient persistent motion */}
            <button
              type="button"
              onClick={() => setAmbientPaused((p) => !p)}
              title={ambientPaused ? 'Resume ambient effects' : 'Pause ambient effects'}
              className="r-btn-secondary inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px]"
            >
              {ambientPaused ? (
                <>
                  <Play className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                  <span className="hidden sm:inline">Play FX</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Pause FX</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="r-btn-secondary flex h-8 w-8 items-center justify-center p-0"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-slate-700" aria-hidden="true" />
              )}
            </button>
            <Link
              to="/"
              className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs shadow-sm"
            >
              Open Dashboard
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-24 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {/* 1. CELESTIAL CONSTELLATION & PHOTONIC BEAM HERO */}
        <LucianGridBeamHero
          paused={ambientPaused}
          className="landing-hero-shell px-5 py-12 text-center sm:px-10 sm:py-16 lg:py-20"
        >
          <div className="mx-auto max-w-4xl">
            <LucianReleasePill tag="v2.0">
              Smart AI Router · OpenAI &amp; Anthropic Compatible
            </LucianReleasePill>

            <LucianWordRiseHeadline
              className="landing-hero-title mt-6 font-extrabold"
              lines={[
                [{ text: 'One Router.' }, { text: '47+ AI Providers.', gradient: true }],
                [{ text: 'Zero Downtime.' }],
              ]}
            />

            <p
              className="landing-hero-stagger landing-copy mx-auto mt-6 text-base text-[var(--text-secondary)] sm:text-lg"
              style={{ '--stagger': 5 }}
            >
              Connect Claude Code, Codex, Cursor, Cline, Roo Code, and Windsurf to 47+ AI
              providers and 470+ models through a single unified endpoint. Smart 3-tier failover
              keeps responses flowing — while{' '}
              <strong className="text-[var(--text-primary)]">RTK &amp; Caveman Mode</strong> trim
              20–65% tokens automatically.
            </p>

            {/* Quick Endpoint & Magnetic CTA Bar */}
            <div
              className="landing-hero-stagger mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-3"
              style={{ '--stagger': 6 }}
            >
              <div className="landing-endpoint-bar flex min-w-[260px] flex-1 items-center justify-between gap-2 rounded-xl px-4 py-2.5 backdrop-blur-md">
                <span className="landing-live-dot" aria-hidden="true" />
                <div className="flex items-center gap-2 overflow-hidden">
                  <Terminal className="h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
                  <code className="truncate font-mono text-xs text-[var(--text-primary)] sm:text-sm">
                    {v1Endpoint}
                  </code>
                </div>
                <CopyButton
                  value={v1Endpoint}
                  size="xs"
                  toastMessage="Copied Unified Endpoint URL"
                />
              </div>

              <LucianMagneticButton to="/" label="Open Dashboard" activeLabel="Launching…" />
            </div>

            {/* Interactive Live 3-Tier Neural Router Prism */}
            <div
              className="landing-hero-stagger landing-prism-stage mx-auto mt-10 max-w-3xl p-4 sm:p-5"
              style={{ '--stagger': 7 }}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-left">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: activePrismTier.color,
                      boxShadow: `0 0 10px ${activePrismTier.color}`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                    LIVE NEURAL ROUTING PRISM
                  </span>
                  <span className="hidden rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] sm:inline">
                    {activePrismTier.latency} loopback
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTier((prev) => (prev + 1) % PRISM_TIERS.length)}
                  className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px]"
                >
                  <RefreshCw className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                  Simulate 429 Failover
                </button>
              </div>

              <div className="grid items-center gap-4 md:grid-cols-12">
                {/* Left: Client Node */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/85 p-3 text-left md:col-span-3">
                  <div className="font-mono text-[10px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                    Client Request
                  </div>
                  <div className="mt-1 text-xs font-bold text-[var(--text-primary)]">
                    Claude / Cursor / SDK
                  </div>
                  <code className="mt-1.5 block truncate rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10px] text-[#E56A4A]">
                    model: &quot;3-tier-auto&quot;
                  </code>
                </div>

                {/* Center: Animated Conduit + Prism Core */}
                <div className="relative flex items-center justify-center py-2 md:col-span-4">
                  <svg
                    viewBox="0 0 240 120"
                    className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="prism-in-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#E56A4A" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.95" />
                      </linearGradient>
                    </defs>
                    {/* Inbound stream */}
                    <path
                      d="M 8 60 L 92 60"
                      fill="none"
                      stroke="url(#prism-in-grad)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      className="landing-prism-beam-active"
                    />
                    {/* Outbound tier branches */}
                    {PRISM_TIERS.map((tier, idx) => {
                      const targetY = idx === 0 ? 20 : idx === 1 ? 60 : 100;
                      const isActive = idx === activeTier;
                      return (
                        <g key={tier.id}>
                          <path
                            d={`M 148 60 C 185 60, 195 ${targetY}, 234 ${targetY}`}
                            fill="none"
                            stroke={tier.color}
                            strokeOpacity={isActive ? 0.35 : 0.14}
                            strokeWidth={isActive ? 3.5 : 1.4}
                          />
                          {isActive ? (
                            <path
                              d={`M 148 60 C 185 60, 195 ${targetY}, 234 ${targetY}`}
                              fill="none"
                              stroke={tier.color}
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              className="landing-prism-beam-active"
                            />
                          ) : null}
                        </g>
                      );
                    })}
                  </svg>

                  <div className="landing-prism-core">
                    <span className="landing-prism-ring" aria-hidden="true" />
                    <span className="landing-prism-ring landing-prism-ring-b" aria-hidden="true" />
                    <Waypoints className="h-7 w-7" aria-hidden="true" />
                  </div>
                </div>

                {/* Right: Interactive 3-Tier Output Nodes */}
                <div className="space-y-2 md:col-span-5">
                  {PRISM_TIERS.map((tier, idx) => {
                    const isActive = idx === activeTier;
                    const isCooling = idx < activeTier;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setActiveTier(idx)}
                        data-active={isActive ? 'true' : 'false'}
                        data-cooldown={isCooling ? 'true' : 'false'}
                        style={{ '--tier-color': tier.color }}
                        className="landing-prism-tier"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: isActive ? tier.color : 'var(--text-primary)' }}
                          >
                            {tier.tier}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            {isCooling ? '429 · 60s cooldown' : isActive ? 'ACTIVE' : tier.cost}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                          {tier.model}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)]/70 pt-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                <span>→ {activePrismTier.statusNote}</span>
                <span className="text-[var(--text-muted)]">Click any tier to inspect path</span>
              </div>
            </div>

            {/* 4 Hero Stat Counters — Odometer */}
            <div className="landing-hero-stagger mt-10" style={{ '--stagger': 8 }}>
              <LucianOdometerStats items={HERO_STATS} />
            </div>
          </div>
        </LucianGridBeamHero>

        {/* DUAL-TRACK COUNTER-FLOWING LOGO MARQUEE STRIP */}
        <section aria-label="Supported providers strip">
          <LucianLogoMarquee
            items={MARQUEE_PROVIDERS}
            caption="Seamless routing across leading models & coding tools"
            externalPaused={ambientPaused}
          />
        </section>

        {/* 2. 9 SERVICE KINDS — FIXED & UPGRADED IRIDESCENT GLOW GRID */}
        <section id="service-kinds" className="scroll-mt-24 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="landing-scroll-pill rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
              Unified Multimodal Gateway
            </span>
            <div className="mt-3">
              <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
                9 Service Kinds · OpenAI &amp; Anthropic Compatible
              </h2>
            </div>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              Point your tool or SDK to one endpoint and run Chat, Anthropic Messages, Embeddings,
              TTS, STT, Image Gen, Vision, Video, Web Search, and Web Fetch seamlessly.
            </p>
          </div>

          <LucianGlowGrid
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            ariaLabel="9 Service Kinds"
          >
            {SERVICE_KINDS.map((kind, idx) => {
              const Icon = kind.icon;
              return (
                <div key={kind.id} data-reveal="" style={{ '--rv-delay': idx % 3 }}>
                  <LucianGlowCard innerClassName="flex h-full flex-col justify-between p-5">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="landing-reveal-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E56A4A]/15 text-[#E56A4A]">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <code className="truncate rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[#E56A4A]">
                          {kind.endpoint}
                        </code>
                      </div>
                      <h3 className="mt-3.5 text-base font-semibold text-[var(--text-primary)]">
                        {kind.title}
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {kind.desc}
                      </p>
                    </div>
                  </LucianGlowCard>
                </div>
              );
            })}
          </LucianGlowGrid>
        </section>

        {/* 3. HOW 001ROUTER WORKS — LUMINOUS 3-TIER PIPELINE CONDUIT */}
        <section id="how-it-works" className="scroll-mt-24 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="landing-scroll-pill rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-[var(--ux-mint)]">
              Resilient Pipeline Architecture
            </span>
            <div className="mt-3">
              <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
                How 001Router Works — Smart 3-Tier Routing
              </h2>
            </div>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              Connect your providers once, generate a 3-tier combo alias, and code non-stop with
              automatic 429 cooldown rotation.
            </p>
          </div>

          <div className="landing-pipeline-wrap space-y-4">
            <div className="landing-pipeline-rail hidden lg:block" aria-hidden="true">
              <span className="landing-pipeline-spark" />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Step 1 */}
              <div
                className="landing-ethereal-card space-y-4 p-6"
                data-reveal=""
                style={{ '--rv-delay': 0 }}
              >
                <div className="flex items-center justify-between">
                  <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-[#f59e0b] text-xs font-bold text-white shadow-sm">
                    1
                  </span>
                  <span className="font-mono text-xs text-[var(--text-muted)]">Multi-Provider</span>
                </div>
                <h3 className="text-lg font-bold">Connect Your Providers</h3>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  Add API keys, OAuth accounts, or local LLM servers in the dashboard with multi-key
                  round-robin pools and automatic cooldown recovery.
                </p>
                <div className="code-surface rounded-lg border p-3 font-mono text-xs">
                  <div className="text-emerald-400">✓ Multi-key &amp; OAuth provider pools</div>
                  <div className="mt-1 text-sky-400">✓ Unified OpenAI &amp; Anthropic endpoints</div>
                  <div className="mt-1 text-neutral-300">✓ Cloud APIs &amp; Local GPUs</div>
                </div>
              </div>

              {/* Step 2 */}
              <div
                className="landing-ethereal-card space-y-3 border-[#E56A4A]/45 p-6"
                data-reveal=""
                style={{ '--rv-delay': 1 }}
              >
                <div className="flex items-center justify-between">
                  <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-[#a78bfa] text-xs font-bold text-white shadow-sm">
                    2
                  </span>
                  <span className="rounded-full bg-[#E56A4A]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#E56A4A]">
                    Auto Failover
                  </span>
                </div>
                <h3 className="text-lg font-bold">Smart 3-Tier Routing</h3>
                <div className="space-y-2 pt-1 text-xs">
                  <div className="rounded-lg border border-[#E56A4A]/35 bg-[#E56A4A]/10 p-2.5">
                    <div className="font-bold text-[#E56A4A]">Tier 1 — Flagship Models</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      Claude Sonnet/Opus · GPT-6.2 / 4.1 · Gemini Pro · Grok 3
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5">
                    <div className="font-bold text-[var(--ux-warn)]">
                      Tier 2 — Cheap Coding ($0.20–$0.60/1M)
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      DeepSeek V3/R1 $0.27 · GLM $0.60 · MiniMax $0.20 · Kimi K2 · Qwen3
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-2.5">
                    <div className="font-bold text-[var(--ux-mint)]">
                      Tier 3 — Free Tier &amp; Local
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      Gemini Flash · Groq · Cerebras · OpenRouter Free · Ollama
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div
                className="landing-ethereal-card space-y-4 p-6"
                data-reveal=""
                style={{ '--rv-delay': 2 }}
              >
                <div className="flex items-center justify-between">
                  <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#34d399] to-[#059669] text-xs font-bold text-white shadow-sm">
                    3
                  </span>
                  <span className="font-mono text-xs text-[var(--ux-mint)]">
                    Streaming Fast Path
                  </span>
                </div>
                <h3 className="text-lg font-bold">Code Non-Stop</h3>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  Point Claude Code, Cursor, Codex CLI, or Cline to one base URL. When a key hits
                  HTTP 429 or quota limits, 001Router cools it down and transparently switches to
                  the next key or tier.
                </p>
                <div className="code-surface rounded-lg border p-3 font-mono text-xs">
                  <div>POST /v1/chat/completions</div>
                  <div>POST /v1/messages</div>
                  <div className="mt-1 text-emerald-400">
                    → Sub-15ms loopback · Live attemptTrail
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. 47+ PROVIDERS SHOWCASE WITH INSTANT SILKY TAB TRANSITIONS */}
        <section id="providers" className="scroll-mt-24 space-y-7">
          <div className="text-center" data-reveal="">
            <span className="landing-scroll-pill rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
              47+ Providers · 470+ Models
            </span>
            <div className="mt-3">
              <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
                Connect Every Leading AI Provider
              </h2>
            </div>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              Filter by tier below or explore all 47+ providers and 470+ models inside the
              dashboard.
            </p>
          </div>

          <div className="flex justify-center">
            <LucianSlidingTabs
              tabs={PROVIDER_TABS}
              value={providerTab}
              onChange={setProviderTab}
              ariaLabel="Filter provider tiers"
            />
          </div>

          <div key={providerTab} className="landing-tab-panel space-y-6">
            {visibleProviderGroups.map((grp) => (
              <div key={grp.title} className="landing-ethereal-card space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    {grp.title}
                  </h3>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${grp.badgeClass}`}
                  >
                    {grp.badge}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {grp.items.map((item, idx) => (
                    <div
                      key={item.preset}
                      className="landing-provider-tile r-card-subtle group flex items-center gap-3 p-3"
                    >
                      <div className="transition-transform duration-300 group-hover:scale-105">
                        <ProviderLogo
                          preset={item.preset}
                          name={item.name}
                          size="md"
                          priority={idx < 3}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {item.name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--text-secondary)]">
                          {item.tag}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 5. 12+ CLI / IDE INTEGRATIONS WITH DIRECTIONAL SHEEN SWEEP */}
        <section id="integrations" className="scroll-mt-24 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="landing-scroll-pill rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-400">
              Drop-In Tool Compatibility
            </span>
            <div className="mt-3">
              <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
                12+ CLI &amp; IDE Integrations Ready Out of the Box
              </h2>
            </div>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              Apply or copy dynamic configuration snippets pre-filled with your chosen model or
              3-tier routing combo.
            </p>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {CLI_INTEGRATIONS.map((tool, idx) => (
              <Link
                key={tool.id}
                to="/cli-tools"
                data-reveal=""
                style={{ '--rv-delay': idx % 4 }}
                className="landing-cli-tile r-card group flex items-center justify-between gap-3 p-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="transition-transform duration-300 group-hover:scale-105">
                    <ProviderLogo preset={tool.id} name={tool.name} size="md" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {tool.name}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-secondary)]">
                      {tool.desc}
                    </div>
                  </div>
                </div>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#E56A4A] group-hover:opacity-100"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </section>

        {/* 6. BUILT-IN BONUS: RTK INPUT TOKEN SAVER + CAVEMAN OUTPUT MODE */}
        <section id="token-saver" className="scroll-mt-24 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="landing-scroll-pill rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-[var(--ux-mint)]">
              Built-in Bonus · Token Optimization
            </span>
            <div className="mt-3">
              <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
                Save 20–65% Tokens Automatically on Every Request
              </h2>
            </div>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              RTK Input Token Saver and Caveman Output Mode compress noisy tool outputs going in
              and trim verbose filler coming out — same technical accuracy, far fewer tokens.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* RTK Input Card */}
            <div
              className="landing-ethereal-card flex flex-col justify-between space-y-5 p-6"
              data-reveal=""
              style={{ '--rv-delay': 0 }}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-[var(--ux-mint)]">
                    <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                    INPUT · RTK Token Saver
                  </span>
                  <span className="font-mono text-xl font-extrabold text-[var(--ux-mint)]">
                    −20–40%
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold">
                  Auto-Compress Tool Outputs &amp; Build Logs
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  Normalizes whitespace, collapses blank lines, deduplicates repeated log lines (
                  <code>... (N similar lines)</code>), and performs 60%/35% head/tail smart
                  truncation on oversized <code>tool_result</code> blocks.
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/80 p-4 font-mono text-xs">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase">
                      Before RTK · Raw git diff / logs
                    </span>
                    <span className="font-bold text-[var(--ux-danger)]">47,200 tokens</span>
                  </div>
                  <div className="landing-meter-track">
                    <div
                      className="landing-meter-fill bg-gradient-to-r from-rose-500/85 to-red-400"
                      style={{ '--meter': 1 }}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase">
                      After RTK · Same context · Same answer
                    </span>
                    <span className="font-bold text-[var(--ux-mint)]">28,100 tokens</span>
                  </div>
                  <div className="landing-meter-track">
                    <div
                      className="landing-meter-fill bg-gradient-to-r from-emerald-500 to-teal-300"
                      style={{ '--meter': 0.595 }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Caveman Output Card */}
            <div
              className="landing-ethereal-card flex flex-col justify-between space-y-5 p-6"
              data-reveal=""
              style={{ '--rv-delay': 1 }}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E56A4A]/15 px-2.5 py-1 text-xs font-bold text-[#E56A4A]">
                    <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                    OUTPUT · Caveman Mode
                  </span>
                  <span className="font-mono text-xl font-extrabold text-[#E56A4A]">−65%</span>
                </div>
                <h3 className="mt-3 text-lg font-bold">
                  Terse, High-Density Technical Replies (Lite / Full / Ultra)
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  Injects a configurable terse-style directive into the system prompt so replies
                  skip polite filler and deliver pure technical signal and code — without altering
                  tool schemas.
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/80 p-4 font-mono text-xs">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase">
                      Verbose Reply · 3 paragraphs of prose
                    </span>
                    <span className="font-bold text-[var(--ux-danger)]">148 tokens</span>
                  </div>
                  <div className="landing-meter-track">
                    <div
                      className="landing-meter-fill bg-gradient-to-r from-rose-500/85 to-orange-400"
                      style={{ '--meter': 1 }}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase">
                      Caveman Reply · Root cause + exact fix
                    </span>
                    <span className="font-bold text-[var(--ux-mint)]">32 tokens</span>
                  </div>
                  <div className="landing-meter-track">
                    <div
                      className="landing-meter-fill bg-gradient-to-r from-[#E56A4A] via-amber-400 to-emerald-400"
                      style={{ '--meter': 0.216 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. ADVANCED FEATURES — SYNCHRONIZED HOLOGRAPHIC GLOW GRID */}
        <section className="space-y-8">
          <div className="text-center" data-reveal="">
            <h2 className="landing-heading landing-reveal-title text-2xl font-bold tracking-tight sm:text-3xl">
              Built for Fast, Non-Stop AI Workflows
            </h2>
            <p className="landing-copy mx-auto mt-3 text-sm text-[var(--text-secondary)]">
              Everything unified in one lightweight gateway with full observability and instant
              failover.
            </p>
          </div>

          <LucianGlowGrid
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            ariaLabel="Advanced Features"
          >
            {ADVANCED_FEATURES.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div key={feat.title} data-reveal="" style={{ '--rv-delay': idx % 3 }}>
                  <LucianGlowCard innerClassName="flex h-full flex-col p-5">
                    <div className="landing-reveal-icon flex h-9 w-9 items-center justify-center rounded-lg bg-[#E56A4A]/15 text-[#E56A4A]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                      {feat.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {feat.desc}
                    </p>
                  </LucianGlowCard>
                </div>
              );
            })}
          </LucianGlowGrid>
        </section>

        {/* 8. GET STARTED IN 3 STEPS WITH HOLOGRAPHIC CODE TERMINAL */}
        <section
          id="get-started"
          className="landing-ethereal-card scroll-mt-24 p-6 sm:p-8"
          data-reveal=""
        >
          <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
            <div className="space-y-4 lg:col-span-6">
              <span className="rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/12 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
                Quick Start Walkthrough
              </span>
              <h2 className="landing-heading text-2xl font-bold tracking-tight sm:text-3xl">
                Get Started in 3 Simple Steps
              </h2>
              <ol className="space-y-3 text-xs text-[var(--text-secondary)] sm:text-sm">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-[#f59e0b] text-xs font-bold text-white">
                    1
                  </span>
                  <div>
                    <strong className="text-[var(--text-primary)]">Launch 001Router</strong>
                    <p className="mt-0.5 text-xs">
                      Run <code>npm start</code> to launch the dashboard and unified gateway on{' '}
                      <code>{origin}</code>.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-[#a78bfa] text-xs font-bold text-white">
                    2
                  </span>
                  <div>
                    <strong className="text-[var(--text-primary)]">
                      Connect Providers &amp; Generate a 3-Tier Combo
                    </strong>
                    <p className="mt-0.5 text-xs">
                      Add your Free, Cheap, or Flagship providers and click{' '}
                      <strong>Generate 3-Tier Auto Fallback</strong> on the Combos page.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#34d399] to-[#059669] text-xs font-bold text-white">
                    3
                  </span>
                  <div>
                    <strong className="text-[var(--text-primary)]">
                      Point Your CLI / IDE to {v1Endpoint}
                    </strong>
                    <p className="mt-0.5 text-xs">
                      Use your Router Key in Claude Code, Cursor, Codex CLI, Cline, or any
                      OpenAI/Anthropic SDK.
                    </p>
                  </div>
                </li>
              </ol>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <LucianMagneticButton
                  to="/"
                  label="Open Dashboard"
                  activeLabel="Launching…"
                  size="sm"
                />
                <Link
                  to="/models"
                  className="r-btn-secondary inline-flex items-center gap-2 px-4 py-2.5 text-xs"
                >
                  Browse 470+ Models
                </Link>
              </div>
            </div>

            <div className="space-y-3 lg:col-span-6">
              <div className="flex justify-start lg:justify-end">
                <LucianSlidingTabs
                  tabs={SNIPPET_TABS}
                  value={snippetTab}
                  onChange={setSnippetTab}
                  ariaLabel="Quick start code snippets"
                />
              </div>
              <div className="landing-terminal-shell code-surface overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
                    <span className="ml-2 font-mono text-[11px] text-neutral-400">
                      {activeSnippet.filename}
                    </span>
                  </div>
                  <CopyButton value={activeSnippet.code} size="xs" />
                </div>
                <pre
                  key={snippetTab}
                  className="landing-tab-panel overflow-x-auto p-4 font-mono text-xs leading-relaxed"
                >
                  <code>{activeSnippet.code}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* 9. ETHEREAL ASTRAL SPOTLIGHT CTA BANNER */}
        <div data-reveal="">
          <LucianSpotlightCta />
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/90 py-8 text-xs text-[var(--text-secondary)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white">
              <Waypoints className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="font-semibold text-[var(--text-primary)]">001Router v2.0</span>
            <span>· 47+ AI Providers · 9 Service Kinds</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[var(--text-muted)]">Unified OpenAI &amp; Anthropic Gateway</span>
            <Link to="/" className="font-semibold text-[#E56A4A] hover:underline">
              Dashboard →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
