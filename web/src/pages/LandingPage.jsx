import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Cpu,
  Flame,
  Globe,
  Image,
  KeyRound,
  Layers,
  MessageSquare,
  Mic,
  Moon,
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
  const progressRef = useRef(null);
  const pageRef = useRef(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const v1Endpoint = `${origin}/v1`;

  // Fallback scroll progress bar when native CSS animation-timeline: scroll() is unsupported
  useEffect(() => {
    const bar = progressRef.current;
    if (!bar) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;
    if (window.CSS?.supports?.('animation-timeline', 'scroll()')) return undefined;

    let raf = 0;
    const update = () => {
      raf = 0;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
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

  // Lucian #251: IntersectionObserver staggered scroll-in reveals
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
      { threshold: 0.12, rootMargin: '0px 0px -36px 0px' }
    );

    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [providerTab]);

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

  return (
    <div ref={pageRef} className="landing-grid min-h-dvh text-[var(--text-primary)]">
      {/* Scroll progress bar (native CSS scroll-timeline with fallback) */}
      <div ref={progressRef} className="landing-scroll-progress" aria-hidden="true" />

      {/* Sticky Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/88 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <Link to="/landing" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
              <Waypoints className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight">001Router</span>
              <span className="hidden rounded-full bg-[#E56A4A]/14 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#E56A4A] sm:inline">
                v2.0
              </span>
            </div>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden items-center gap-6 text-xs font-medium text-[var(--text-secondary)] md:flex"
          >
            <a href="#service-kinds" className="transition-colors hover:text-[var(--text-primary)]">
              Service Kinds
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-[var(--text-primary)]">
              3-Tier Routing
            </a>
            <a href="#providers" className="transition-colors hover:text-[var(--text-primary)]">
              Providers
            </a>
            <a href="#integrations" className="transition-colors hover:text-[var(--text-primary)]">
              CLI / IDE
            </a>
            <a href="#token-saver" className="transition-colors hover:text-[var(--text-primary)]">
              Token Saver
            </a>
            <a href="#get-started" className="transition-colors hover:text-[var(--text-primary)]">
              Quick Start
            </a>
          </nav>

          <div className="flex items-center gap-2">
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

      <main className="mx-auto max-w-7xl space-y-20 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {/* 1. HERO SECTION WITH LUCIAN #226 GRID-BEAM STAGE & #216 STAGGERED ENTRANCE */}
        <LucianGridBeamHero aurora className="landing-hero-shell px-5 py-14 text-center sm:px-10 sm:py-20">
          <div className="mx-auto max-w-4xl">
            {/* Lucian #419: release pill + word-by-word rising headline */}
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
              style={{ '--stagger': 7 }}
            >
              Connect Claude Code, Codex, Cursor, Cline, Roo Code, and Windsurf to 47+ AI
              providers and 470+ models through a single unified endpoint. Smart 3-tier failover
              keeps responses flowing — while{' '}
              <strong className="text-[var(--text-primary)]">RTK &amp; Caveman Mode</strong> trim
              20–65% tokens automatically.
            </p>

            {/* Quick Endpoint & Action Bar */}
            <div
              className="landing-hero-stagger mx-auto mt-9 flex max-w-xl flex-wrap items-center justify-center gap-3"
              style={{ '--stagger': 8 }}
            >
              <div className="landing-endpoint-bar flex min-w-[260px] flex-1 items-center justify-between gap-2 rounded-xl px-4 py-2.5 backdrop-blur-md">
                <span className="landing-live-dot" aria-hidden="true" />
                <div className="flex items-center gap-2 overflow-hidden">
                  <Terminal className="h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
                  <code className="truncate font-mono text-xs text-[var(--text-primary)] sm:text-sm">
                    {v1Endpoint}
                  </code>
                </div>
                <CopyButton value={v1Endpoint} size="xs" toastMessage="Copied Unified Endpoint URL" />
              </div>

              <LucianMagneticButton to="/" label="Open Dashboard" activeLabel="Launching…" />
            </div>

            {/* 4 Hero Stat Counters — Lucian #426 odometer */}
            <div className="landing-hero-stagger mt-12" style={{ '--stagger': 9 }}>
              <LucianOdometerStats items={HERO_STATS} />
            </div>
          </div>
        </LucianGridBeamHero>

        {/* LUCIAN #421 INTERACTIVE LOGO MARQUEE STRIP */}
        <section aria-label="Supported providers strip">
          <LucianLogoMarquee
            items={MARQUEE_PROVIDERS}
            caption="Seamless routing across leading models & coding tools"
          />
        </section>

        {/* 2. 9 SERVICE KINDS SECTION */}
        <section id="service-kinds" className="scroll-mt-20 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
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
                        <code className="truncate rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[#E56A4A]">
                          {kind.endpoint}
                        </code>
                      </div>
                      <h3 className="mt-3.5 text-base font-semibold text-[var(--text-primary)]">
                        {kind.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {kind.desc}
                      </p>
                    </div>
                  </LucianGlowCard>
                </div>
              );
            })}
          </LucianGlowGrid>
        </section>

        {/* 3. HOW 001ROUTER WORKS — SMART 3-TIER ROUTING */}
        <section id="how-it-works" className="scroll-mt-20 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-[var(--ux-mint)]">
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

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Step 1 */}
            <div className="r-card space-y-4 p-6" data-reveal="" style={{ '--rv-delay': 0 }}>
              <div className="flex items-center justify-between">
                <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
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
              className="r-card space-y-3 border-[#E56A4A]/50 p-6"
              data-reveal=""
              style={{ '--rv-delay': 1 }}
            >
              <div className="flex items-center justify-between">
                <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
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
            <div className="r-card space-y-4 p-6" data-reveal="" style={{ '--rv-delay': 2 }}>
              <div className="flex items-center justify-between">
                <span className="landing-reveal-icon flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
                  3
                </span>
                <span className="font-mono text-xs text-[var(--ux-mint)]">Streaming Fast Path</span>
              </div>
              <h3 className="text-lg font-bold">Code Non-Stop</h3>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Point Claude Code, Cursor, Codex CLI, or Cline to one base URL. When a key hits
                HTTP 429 or quota limits, 001Router cools it down and transparently switches to the
                next key or tier.
              </p>
              <div className="code-surface rounded-lg border p-3 font-mono text-xs">
                <div>POST /v1/chat/completions</div>
                <div>POST /v1/messages</div>
                <div className="mt-1 text-emerald-400">→ Sub-15ms loopback · Live attemptTrail</div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. 47+ PROVIDERS SHOWCASE WITH INTERACTIVE SLIDING TABS & FULL-BLEED LOGOS */}
        <section id="providers" className="scroll-mt-20 space-y-7">
          <div className="text-center" data-reveal="">
            <span className="rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
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

          <div className="space-y-6">
            {visibleProviderGroups.map((grp) => (
              <div key={grp.title} className="r-card space-y-4 p-5" data-reveal="">
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
                      className="r-card-subtle flex items-center gap-3 p-3 transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      <ProviderLogo
                        preset={item.preset}
                        name={item.name}
                        size="md"
                        priority={idx < 3}
                      />
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

        {/* 5. 12+ CLI / IDE INTEGRATIONS WITH REAL TOOL LOGOS */}
        <section id="integrations" className="scroll-mt-20 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-400">
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
                className="r-card flex items-center gap-3 p-3.5 transition-colors hover:border-[#E56A4A]/60"
              >
                <ProviderLogo preset={tool.id} name={tool.name} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {tool.name}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                    {tool.desc}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 6. BUILT-IN BONUS: RTK INPUT TOKEN SAVER + CAVEMAN OUTPUT MODE */}
        <section id="token-saver" className="scroll-mt-20 space-y-8">
          <div className="text-center" data-reveal="">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-[var(--ux-mint)]">
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
              className="r-card flex flex-col justify-between space-y-4 p-6"
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

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 font-mono text-xs">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">Before RTK</div>
                  <div className="mt-1 text-base font-bold text-[var(--ux-danger)]">
                    47,200 tokens
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Raw git diff / logs
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">After RTK</div>
                  <div className="mt-1 text-base font-bold text-[var(--ux-mint)]">
                    28,100 tokens
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Same context · Same answer
                  </div>
                </div>
              </div>
            </div>

            {/* Caveman Output Card */}
            <div
              className="r-card flex flex-col justify-between space-y-4 p-6"
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

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 font-mono text-xs">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Verbose Reply
                  </div>
                  <div className="mt-1 text-base font-bold text-[var(--ux-danger)]">148 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    3 paragraphs of prose
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">
                    Caveman Reply
                  </div>
                  <div className="mt-1 text-base font-bold text-[var(--ux-mint)]">32 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Root cause + exact fix
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. ADVANCED FEATURES GRID */}
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADVANCED_FEATURES.map((feat, idx) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="r-card p-5"
                  data-reveal=""
                  style={{ '--rv-delay': idx % 3 }}
                >
                  <div className="landing-reveal-icon flex h-9 w-9 items-center justify-center rounded-lg bg-[#E56A4A]/15 text-[#E56A4A]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                    {feat.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {feat.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 8. GET STARTED IN 3 STEPS (#get-started) WITH INTERACTIVE CODE TABS */}
        <section id="get-started" className="r-card scroll-mt-20 p-6 sm:p-8" data-reveal="">
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
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
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
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
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
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
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
              <div className="code-surface overflow-hidden rounded-xl border shadow-xl">
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
                <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
                  <code>{activeSnippet.code}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* 9. LUCIAN #425 SPOTLIGHT CTA BANNER */}
        <div data-reveal="">
          <LucianSpotlightCta />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] py-8 text-xs text-[var(--text-secondary)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E56A4A] text-white">
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
