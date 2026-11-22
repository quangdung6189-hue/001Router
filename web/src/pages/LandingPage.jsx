import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Flame,
  Globe,
  Image,
  KeyRound,
  Layers,
  Lock,
  MessageSquare,
  Mic,
  Moon,
  Repeat,
  Scissors,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Video,
  Volume2,
  Waypoints,
  Zap,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { LucianMagneticButton } from '../components/lucian/LucianMagneticButton';
import { LucianGlowGrid, LucianGlowCard } from '../components/lucian/LucianGlowGrid';
import { LucianGradientText } from '../components/lucian/LucianGradientText';

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
    desc: 'Multimodal image & document understanding via Gemini 2.5, Claude 4, GPT-4.1, Grok 3, Mistral Pixtral.',
    icon: Sparkles,
  },
  {
    id: 'video',
    title: 'Video Generation',
    endpoint: 'Catalog & Passthrough',
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
    title: 'Free Forever / Free-Tier Official APIs',
    badge: '$0 / month',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    items: [
      { preset: 'gemini', name: 'Google Gemini', tag: 'Free Tier · 1M ctx' },
      { preset: 'groq', name: 'Groq LPU', tag: 'Free Tier · Ultra Fast' },
      { preset: 'cerebras', name: 'Cerebras', tag: 'Free Tier · 2000+ tok/s' },
      { preset: 'openrouter', name: 'OpenRouter', tag: 'Free Models (:free)' },
      { preset: 'nvidia', name: 'NVIDIA NIM', tag: 'Free Developer Credits' },
      { preset: 'sambanova', name: 'SambaNova', tag: 'Free Cloud RDU' },
      { preset: 'huggingface', name: 'Hugging Face', tag: 'Free Inference Router' },
      { preset: 'mistral', name: 'Mistral La Plateforme', tag: 'Free Experiment Tier' },
      { preset: 'cloudflare', name: 'Cloudflare Workers AI', tag: '10K Free Neurons/day' },
    ],
  },
  {
    title: 'Cheap & Coding Plans (Official API Key)',
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
    title: 'Flagship, Cloud & Local Providers',
    badge: 'Official BYOK & Local',
    badgeClass: 'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30',
    items: [
      { preset: 'openai', name: 'OpenAI', tag: 'GPT-6.2 · GPT-4.1 · o4-mini' },
      { preset: 'anthropic', name: 'Anthropic', tag: 'Claude Opus/Sonnet 4' },
      { preset: 'xai', name: 'xAI Grok', tag: 'Grok 3 & Grok 3 Mini' },
      { preset: 'together', name: 'Together AI', tag: 'Turbo Open Models' },
      { preset: 'fireworks', name: 'Fireworks AI', tag: 'Fast Function Calling' },
      { preset: 'perplexity', name: 'Perplexity Sonar', tag: 'Grounded Search LLM' },
      { preset: 'cohere', name: 'Cohere Command A', tag: 'Enterprise RAG & Chat' },
      { preset: 'azure', name: 'Azure OpenAI', tag: 'Enterprise Cloud BYOK' },
      { preset: 'bedrock', name: 'AWS Bedrock', tag: 'Claude & Nova Gateway' },
      { preset: 'vertex', name: 'Google Vertex AI', tag: 'GCP Enterprise Gemini' },
      { preset: 'ollama', name: 'Ollama (Local)', tag: '100% Private · Offline' },
      { preset: 'lmstudio', name: 'LM Studio / vLLM', tag: 'Local GPU Inference' },
    ],
  },
];

const CLI_INTEGRATIONS = [
  { id: 'claude', name: 'Claude Code', desc: 'Anthropic Claude CLI (/v1/messages)' },
  { id: 'codex', name: 'OpenAI Codex CLI', desc: '~/.codex/config.toml provider' },
  { id: 'cursor', name: 'Cursor IDE', desc: 'OpenAI Base URL override' },
  { id: 'cline', name: 'Cline', desc: 'VS Code autonomous coding agent' },
  { id: 'roo', name: 'Roo Code', desc: 'Multi-mode VS Code AI assistant' },
  { id: 'continue', name: 'Continue.dev', desc: 'Open-source IDE autopilot' },
  { id: 'opencode', name: 'OpenCode', desc: 'Terminal TUI coding agent' },
  { id: 'windsurf', name: 'Windsurf', desc: 'Cascade custom BYOK endpoint' },
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
    desc: 'Attach multiple official API keys per provider for automatic load distribution and zero-downtime key failover.',
    icon: KeyRound,
  },
  {
    title: 'AES-256-GCM Encryption at Rest',
    desc: 'All upstream API keys & proxy credentials are encrypted on disk (enc:v1:...) androuter keys are SHA-256 hashed.',
    icon: Lock,
  },
  {
    title: 'Outbound Proxy Pools',
    desc: 'Route region-restricted official APIs through HTTP, HTTPS, or SOCKS5 outbound proxy pools with masked credentials.',
    icon: Globe,
  },
  {
    title: '9 OpenAI-Compatible Service Kinds',
    desc: 'One local port (20128) serves Chat, Messages, Embeddings, Image Gen, TTS, STT, Web Search, Web Fetch & Models.',
    icon: Server,
  },
  {
    title: '470+ AI Models Explorer',
    desc: 'Built-in searchable catalog of 470+ latest models across 47 providers with context windows, pricing & capabilities.',
    icon: Cpu,
  },
  {
    title: '100% ToS-Safe Official BYOK',
    desc: 'Strictly uses official developer API keys and local LLMs — no session hijacking, no OAuth spoofing, zero ban risk.',
    icon: ShieldCheck,
  },
];

export function LandingPage() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { locale, toggleLocale } = useLocale();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:20128';
  const v1Endpoint = `${origin}/v1`;

  return (
    <div className="landing-grid min-h-dvh text-[var(--text-primary)]">
      {/* Sticky Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <Link to="/landing" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
              <Waypoints className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight">001Router</span>
              <span className="ml-2 hidden rounded bg-[#E56A4A]/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E56A4A] sm:inline">
                v1.2 ToS-Safe Edition
              </span>
            </div>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden items-center gap-6 text-xs font-medium text-[var(--text-secondary)] md:flex"
          >
            <a href="#service-kinds" className="hover:text-[var(--text-primary)]">
              9 Service Kinds
            </a>
            <a href="#how-it-works" className="hover:text-[var(--text-primary)]">
              3-Tier Routing
            </a>
            <a href="#providers" className="hover:text-[var(--text-primary)]">
              Providers (47+)
            </a>
            <a href="#integrations" className="hover:text-[var(--text-primary)]">
              CLI / IDE Tools
            </a>
            <a href="#token-saver" className="hover:text-[var(--text-primary)]">
              RTK &amp; Caveman
            </a>
            <a href="#get-started" className="hover:text-[var(--text-primary)]">
              Get Started
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              className="r-btn-secondary hidden items-center gap-1.5 px-2.5 py-1.5 text-xs sm:inline-flex"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === 'vi' ? 'VI' : 'EN'}
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

      <main className="mx-auto max-w-7xl space-y-20 px-4 py-12 sm:px-6 lg:px-8">
        {/* 1. HERO SECTION */}
        <section className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/10 px-3.5 py-1 text-xs font-semibold text-[#E56A4A]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Smart AI Router · OpenAI &amp; Anthropic Compatible · 100% ToS-Safe Official BYOK
          </div>

          <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            One Router.{' '}
            <LucianGradientText>47+ AI Providers.</LucianGradientText>{' '}
            Zero Downtime.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            Connect every CLI &amp; IDE (Claude Code, Codex, Cursor, Cline, Roo Code, Windsurf…) to
            47+ official AI providers and 470+ models through one local endpoint. Smart 3-tier
            fallback keeps you coding when rate limits hit — plus built-in{' '}
            <strong className="text-[var(--text-primary)]">RTK &amp; Caveman Mode</strong> save
            20–65% tokens automatically.
          </p>

          {/* Quick Endpoint & Action Bar */}
          <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-3">
            <div className="flex flex-1 min-w-[260px] items-center justify-between gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 overflow-hidden">
                <Terminal className="h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
                <code className="truncate font-mono text-xs text-[var(--text-primary)] sm:text-sm">
                  {v1Endpoint}
                </code>
              </div>
              <CopyButton value={v1Endpoint} size="xs" toastMessage="Copied Unified Endpoint URL" />
            </div>

            <LucianMagneticButton
              to="/"
              label="Open Dashboard"
              activeLabel="Launching…"
            />
          </div>

          {/* 4 Hero Stat Counters */}
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { value: '47+', label: 'Official AI Providers' },
              { value: '9', label: 'Unified Service Kinds' },
              { value: '470+', label: 'Cataloged AI Models' },
              { value: '3-Tier', label: 'Smart Auto Fallback' },
            ].map((st) => (
              <div key={st.label} className="r-card p-4">
                <div className="text-2xl font-extrabold text-[#E56A4A] sm:text-3xl">{st.value}</div>
                <div className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
                  {st.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. 9 SERVICE KINDS SECTION */}
        <section id="service-kinds" className="scroll-mt-20 space-y-6">
          <div className="text-center">
            <span className="rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
              Unified Multimodal Gateway
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              9 Service Kinds · OpenAI &amp; Anthropic Compatible
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Point your tool or SDK to one local URL (`http://localhost:20128/v1`) — run Chat,
              Anthropic Messages, Embeddings, TTS, STT, Image Gen, Vision, Web Search, and Web
              Fetch.
            </p>
          </div>

          <LucianGlowGrid
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            ariaLabel="9 Service Kinds"
          >
            {SERVICE_KINDS.map((kind) => {
              const Icon = kind.icon;
              return (
                <LucianGlowCard
                  key={kind.id}
                  innerClassName="flex flex-col justify-between p-5"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E56A4A]/15 text-[#E56A4A]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <code className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[#E56A4A]">
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
              );
            })}
          </LucianGlowGrid>
        </section>

        {/* 3. HOW 001ROUTER WORKS — SMART 3-TIER ROUTING */}
        <section id="how-it-works" className="scroll-mt-20 space-y-6">
          <div className="text-center">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              Resilient Pipeline Architecture
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              How 001Router Works — Smart 3-Tier Routing
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Connect your official API keys once, generate a 3-tier combo alias, and code non-stop
              with automatic 429 cooldown rotation.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Step 1 */}
            <div className="r-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
                  1
                </span>
                <span className="font-mono text-xs text-[var(--text-muted)]">AES-256-GCM</span>
              </div>
              <h3 className="text-lg font-bold">Connect Official API Keys</h3>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Add official developer API keys or local LLMs in the dashboard. Every secret is
                encrypted at rest with AES-256-GCM and supports multi-key round-robin pools.
              </p>
              <div className="code-surface rounded-lg border p-3 font-mono text-xs">
                <div className="text-emerald-400">✓ AES-256-GCM encrypted db.json</div>
                <div className="mt-1 text-sky-400">✓ SHA-256 hashed sk-001r-* keys</div>
                <div className="mt-1 text-[var(--text-secondary)]">✓ 100% ToS-Safe Official BYOK</div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="r-card border-[#E56A4A]/50 p-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
                  2
                </span>
                <span className="rounded-full bg-[#E56A4A]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#E56A4A]">
                  Auto Failover
                </span>
              </div>
              <h3 className="text-lg font-bold">Smart 3-Tier Routing</h3>
              <div className="space-y-2 pt-1 text-xs">
                <div className="rounded-lg border border-[#E56A4A]/35 bg-[#E56A4A]/10 p-2.5">
                  <div className="font-bold text-[#E56A4A]">Tier 1 — Flagship Official APIs</div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    Claude Sonnet/Opus 4 · GPT-6.2 / 4.1 · Gemini 2.5 Pro · Grok 3
                  </div>
                </div>
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5">
                  <div className="font-bold text-amber-400">
                    Tier 2 — Cheap Coding ($0.20–$0.60/1M)
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    DeepSeek V3/R1 $0.27 · GLM $0.60 · MiniMax $0.20 · Kimi K2 · Qwen3
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 p-2.5">
                  <div className="font-bold text-emerald-400">
                    Tier 3 — FREE Official APIs &amp; Local
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    Gemini Flash Free · Groq · Cerebras · OpenRouter Free · Ollama
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="r-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
                  3
                </span>
                <span className="font-mono text-xs text-emerald-400">localhost:20128</span>
              </div>
              <h3 className="text-lg font-bold">Code Non-Stop</h3>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Point Claude Code, Cursor, Codex CLI, or Cline to <code>localhost:20128</code>. When
                a key hits HTTP 429 or quota exhaustion, 001Router places it on a 60s cooldown and
                transparently routes to the next key or tier.
              </p>
              <div className="code-surface rounded-lg border p-3 font-mono text-xs">
                <div>POST /v1/chat/completions</div>
                <div>POST /v1/messages</div>
                <div className="mt-1 text-emerald-400">→ 0ms overhead · Live attemptTrail</div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. 47+ PROVIDERS SHOWCASE WITH REAL LOGOS */}
        <section id="providers" className="scroll-mt-20 space-y-8">
          <div className="text-center">
            <span className="rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/10 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
              47+ Official Providers · 470+ Models
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Connect Any AI Provider with Official API Keys
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Featured providers below — explore all 47 providers and 470+ models inside the
              dashboard.
            </p>
          </div>

          <div className="space-y-6">
            {SHOWCASE_GROUPS.map((grp) => (
              <div key={grp.title} className="r-card p-5 space-y-4">
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

                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
                  {grp.items.map((item, idx) => (
                    <div
                      key={item.preset}
                      className="r-card-subtle flex items-center gap-3 p-3"
                    >
                      <ProviderLogo
                        preset={item.preset}
                        name={item.name}
                        size="md"
                        priority={idx < 2}
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

        {/* 5. 10+ CLI / IDE INTEGRATIONS WITH REAL TOOL LOGOS */}
        <section id="integrations" className="scroll-mt-20 space-y-6">
          <div className="text-center">
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-400">
              Drop-In Tool Compatibility
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              12+ CLI &amp; IDE Integrations Ready Out of the Box
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Copy-paste dynamic configuration snippets pre-populated with your Router API Key and
              chosen model or 3-tier combo.
            </p>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {CLI_INTEGRATIONS.map((tool) => (
              <Link
                key={tool.id}
                to="/cli-tools"
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
        <section id="token-saver" className="scroll-mt-20 space-y-6">
          <div className="text-center">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              Built-in Bonus · Free Token Optimization
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Save 20–65% Tokens Automatically on Every Request
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              RTK Input Token Saver and Caveman Output Mode ship built-in. They compress noisy tool
              inputs going in and trim verbose filler coming out — same technical accuracy, far
              fewer tokens.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* RTK Input Card */}
            <div className="r-card flex flex-col justify-between p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400">
                    <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                    INPUT · RTK Token Saver
                  </span>
                  <span className="text-xl font-extrabold text-emerald-400">−20–40%</span>
                </div>
                <h3 className="mt-3 text-lg font-bold">
                  Auto-Compress Tool Outputs &amp; Build Logs
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  Normalizes CRLF &amp; trailing spaces, collapses blank lines, deduplicates
                  repeated log lines (<code>... (N similar lines)</code>), and performs 60%/35%
                  head/tail smart truncation on oversized <code>tool_result</code> blocks.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 font-mono text-xs">
                <div>
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">Before RTK</div>
                  <div className="mt-1 text-base font-bold text-red-400">− 47,200 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">Raw git diff / logs</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">After RTK</div>
                  <div className="mt-1 text-base font-bold text-emerald-400">+ 28,100 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Same context · Same answer
                  </div>
                </div>
              </div>
            </div>

            {/* Caveman Output Card */}
            <div className="r-card flex flex-col justify-between p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E56A4A]/15 px-2.5 py-1 text-xs font-bold text-[#E56A4A]">
                    <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                    OUTPUT · Caveman Mode
                  </span>
                  <span className="text-xl font-extrabold text-[#E56A4A]">−65%</span>
                </div>
                <h3 className="mt-3 text-lg font-bold">
                  Terse, High-Density Technical Replies (Lite / Full / Ultra)
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                  Injects a configurable terse-style directive into the system prompt so LLM replies
                  skip polite filler and deliver pure technical signal and code — without altering
                  tool schemas.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 font-mono text-xs">
                <div>
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">Verbose Reply</div>
                  <div className="mt-1 text-base font-bold text-red-400">148 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    3 paragraphs of prose
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">
                    Caveman Reply
                  </div>
                  <div className="mt-1 text-base font-bold text-emerald-400">32 tokens</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Root cause + exact fix
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. ADVANCED FEATURES GRID */}
        <section className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Enterprise-Grade Local Gateway Features
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Everything runs locally on your machine with zero cloud lock-in.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADVANCED_FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div key={feat.title} className="r-card p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E56A4A]/15 text-[#E56A4A]">
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

        {/* 8. GET STARTED IN 3 STEPS (#get-started) */}
        <section id="get-started" className="scroll-mt-20 r-card p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
            <div className="space-y-4 lg:col-span-6">
              <span className="rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/12 px-3 py-1 text-xs font-semibold text-[#E56A4A]">
                Quick Start Walkthrough
              </span>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Get Started in 3 Simple Steps
              </h2>
              <ol className="space-y-3 text-xs text-[var(--text-secondary)] sm:text-sm">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E56A4A] text-xs font-bold text-white">
                    1
                  </span>
                  <div>
                    <strong className="text-[var(--text-primary)]">
                      Start 001Router on Port 20128
                    </strong>
                    <p className="mt-0.5 text-xs">
                      Run <code>npm start</code> in <code>app/server</code>. The local dashboard and
                      unified gateway start on <code>http://127.0.0.1:20128</code>.
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
                      Add your Free, Cheap, or Flagship official API keys and click{' '}
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
                      Use your <code>sk-001r-...</code> Router API Key in Claude Code, Cursor, Codex
                      CLI, Cline, or any OpenAI/Anthropic SDK.
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

            <div className="lg:col-span-6">
              <div className="code-surface overflow-hidden rounded-xl border shadow-xl">
                <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
                    <span className="ml-2 font-mono text-[11px] text-neutral-400">
                      terminal — 001router setup
                    </span>
                  </div>
                  <CopyButton
                    value={`export ANTHROPIC_BASE_URL="${origin}"\nexport ANTHROPIC_AUTH_TOKEN="sk-001r-YOUR_KEY"\nexport ANTHROPIC_MODEL="3-tier-auto"\nclaude`}
                    size="xs"
                  />
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
                  <code>{`$ npm start
✓ 001Router v1.2 listening on http://127.0.0.1:20128
✓ AES-256-GCM master key verified (app/data/.master.key)
✓ Model Catalog loaded: 47 providers · 471 models

# Connect Claude Code to 001Router:
$ export ANTHROPIC_BASE_URL="${origin}"
$ export ANTHROPIC_AUTH_TOKEN="sk-001r-YOUR_KEY"
$ export ANTHROPIC_MODEL="3-tier-auto"
$ claude

# Or test via OpenAI Chat Completions:
$ curl -sS ${v1Endpoint}/chat/completions \\
  -H "Authorization: Bearer sk-001r-YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"3-tier-auto","messages":[{"role":"user","content":"Hello!"}]}'`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] py-8 text-xs text-[var(--text-secondary)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E56A4A] text-white">
              <Waypoints className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="font-semibold text-[var(--text-primary)]">001Router v1.2</span>
            <span>· 47+ Official AI Providers · 9 Service Kinds · AES-256-GCM Encrypted</span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Official API Keys Only (ToS-Safe BYOK)
            </span>
            <Link to="/" className="font-semibold text-[#E56A4A] hover:underline">
              Dashboard →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
