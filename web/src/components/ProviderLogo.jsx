import { memo, useState } from 'react';

// Complete mapping of preset / slug / tool ID -> filename in /providers/
export const PRESET_LOGO_MAP = {
  // Free-Tier Official APIs
  gemini: 'gemini.png',
  groq: 'groq.png',
  cerebras: 'cerebras.png',
  openrouter: 'openrouter.png',
  nvidia: 'nvidia.png',
  sambanova: 'sambanova.png',
  huggingface: 'huggingface.png',
  mistral: 'mistral.png',
  cloudflare: 'cloudflare-ai.png',
  'cloudflare-ai': 'cloudflare-ai.png',
  byteplus: 'byteplus.png',

  // Cheap & Coding Official API Key Providers
  glm: 'glm.png',
  'glm-cn': 'glm-cn.png',
  kimi: 'kimi.png',
  'kimi-coding': 'kimi-coding.png',
  minimax: 'minimax.png',
  'minimax-cn': 'minimax-cn.png',
  deepseek: 'deepseek.png',
  alibaba: 'qwen.png',
  qwen: 'qwen.png',
  siliconflow: 'siliconflow.png',
  chutes: 'chutes.png',
  featherless: 'featherless.png',
  novita: 'novita.png',
  xiaomi: 'xiaomi-mimo.png',
  'xiaomi-mimo': 'xiaomi-mimo.png',
  baidu: 'baidu.png',
  tencent: 'tencent.png',
  nous: 'nous.png',

  // Flagship & Cloud API Key Providers
  openai: 'openai.png',
  anthropic: 'anthropic.png',
  xai: 'xai.png',
  muse: 'muse.png',
  'meta-muse': 'muse.png',
  together: 'together.png',
  fireworks: 'fireworks.png',
  perplexity: 'perplexity.png',
  cohere: 'cohere.png',
  nebius: 'nebius.png',
  hyperbolic: 'hyperbolic.png',
  venice: 'venice.png',
  vercel: 'vercel-ai-gateway.png',
  'vercel-ai-gateway': 'vercel-ai-gateway.png',
  azure: 'azure.png',
  bedrock: 'bedrock.png',
  vertex: 'vertex.png',
  reka: 'reka.png',

  // Local & Self-Hosted LLMs
  ollama: 'ollama.png',
  'ollama-local': 'ollama-local.png',
  lmstudio: 'local-device.png',
  vllm: 'local-device.png',
  llamacpp: 'local-device.png',
  'local-device': 'local-device.png',
  'self-hosted-stt': 'selfhosted-stt.png',
  'self-hosted-tts': 'selfhosted-tts.png',
  'self-hosted-embedding': 'selfhosted-embedding.png',

  // Multimodal & Search Service Providers (9 Service Kinds)
  deepgram: 'deepgram.png',
  assemblyai: 'assemblyai.png',
  elevenlabs: 'elevenlabs.png',
  tavily: 'tavily.png',
  brave: 'brave-search.png',
  'brave-search': 'brave-search.png',
  serper: 'serper.png',
  exa: 'exa.png',
  firecrawl: 'firecrawl.png',
  jina: 'jina-ai.png',
  'jina-ai': 'jina-ai.png',
  'jina-reader': 'jina-reader.png',
  fal: 'fal-ai.png',
  'fal-ai': 'fal-ai.png',
  stability: 'stability-ai.png',
  'stability-ai': 'stability-ai.png',
  bfl: 'black-forest-labs.png',
  'black-forest-labs': 'black-forest-labs.png',
  recraft: 'recraft.png',
  runway: 'runwayml.png',
  runwayml: 'runwayml.png',
  voyage: 'voyage-ai.png',
  'voyage-ai': 'voyage-ai.png',
  searxng: 'searxng.png',
  'google-pse': 'google-pse.png',
  linkup: 'linkup.png',
  searchapi: 'searchapi.png',

  // Additional catalog / ecosystem logos
  longcat: 'longcat.png',
  poolside: 'poolside.png',
  morph: 'morph.png',
  cartesia: 'cartesia.png',
  inworld: 'inworld.png',
  playht: 'playht.png',
  topaz: 'topaz.png',
  comfyui: 'comfyui.png',
  sdwebui: 'sdwebui.png',
  'opencode-zen': 'opencode.png',
  'opencode-go': 'opencode-go.png',
  'kilo-gateway': 'kilo-gateway.png',
  'api-airforce': 'api-airforce.png',
  bazaarlink: 'bazaarlink.png',
  agnes: 'agnes.png',
  alicode: 'alicode.png',
  'alicode-intl': 'alicode-intl.png',
  'alitp-intl': 'alitp-intl.png',
  'volcengine-ark': 'volcengine-ark.png',
  'xiaomi-tokenplan': 'xiaomi-tokenplan.png',
  llm7: 'llm7.png',
  blackbox: 'blackbox.png',
  tokenharbor: 'tokenharbor.png',
  tokenrouter: 'tokenrouter.png',
  bluesminds: 'bluesminds.png',
  dahl: 'dahl.png',
  sensenova: 'sensenova.png',
  'sensenova-intl': 'sensenova-intl.png',
  gitlab: 'gitlab.png',
  'vertex-partner': 'vertex-partner.png',
  'bedrock-xai': 'bedrock-xai.png',
  'fish-audio': 'fish-audio.png',
  youcom: 'youcom.png',
  'custom-openai': 'oai-cc.png',
  'custom-anthropic': 'anthropic-m.png',

  // CLI & IDE Coding Tools
  claude: 'claude.png',
  'claude-code': 'claude.png',
  codex: 'codex.png',
  cursor: 'cursor.png',
  cline: 'cline.png',
  roo: 'roo.png',
  'roo-code': 'roo.png',
  continue: 'continue.png',
  opencode: 'opencode.png',
  windsurf: 'windsurf.png',
  copilot: 'copilot.png',
  kilo: 'kilocode.png',
  kilocode: 'kilocode.png',
  droid: 'droid.png',
  aider: 'local-device.png',
  hermes: 'hermes.png',
  openclaw: 'openclaw.png',
  zed: 'zed.png',
  trae: 'trae.png',
  antigravity: 'antigravity.png',
  kiro: 'kiro.png',
  iflow: 'iflow.png',
};

const failedLogoCache = new Set();

export function resolveProviderLogoUrl({ preset, slug, logo, logoExt = 'png', src }) {
  if (src) return src;
  if (logo) {
    if (logo.includes('/')) return logo;
    if (/\.(png|svg|webp|jpg)$/i.test(logo)) return `/providers/${logo}`;
    return `/providers/${logo}.${logoExt || 'png'}`;
  }
  const key = String(preset || slug || '')
    .toLowerCase()
    .trim();
  if (!key || key === 'custom') return null;
  const mapped = PRESET_LOGO_MAP[key];
  if (mapped) return `/providers/${mapped}`;
  return `/providers/${key}.${logoExt || 'png'}`;
}

const SIZE_MAP = {
  xs: { box: 22, font: 9, radius: 'rounded-md' },
  sm: { box: 28, font: 10, radius: 'rounded-lg' },
  md: { box: 36, font: 11, radius: 'rounded-lg' },
  lg: { box: 40, font: 12, radius: 'rounded-xl' },
  xl: { box: 48, font: 14, radius: 'rounded-xl' },
};

// Transparent monochrome / dark-ink PNGs that look washed-out or invisible on dark cards:
// render them on a crisp full-bleed white app-icon plate so every glyph has razor-sharp contrast.
const LIGHT_PLATE_FILES = new Set([
  'xai.png',
  'grok-cli.png',
  'grok-web.png',
  'vercel.png',
  'vercel-ai-gateway.png',
  'venice.png',
  'ollama.png',
  'ollama-local.png',
  'elevenlabs.png',
  'chutes.png',
  'featherless.png',
  'novita.png',
  'windsurf.png',
  'glm.png',
  'glm-cn.png',
  'nous.png',
  'tavily.png',
  'cohere.png',
  'jina-ai.png',
  'jina-reader.png',
  'vertex.png',
  'vertex-partner.png',
  'tencent.png',
  'byteplus.png',
  'openrouter.png',
  'google-tts.png',
  'cloudflare-ai.png',
  'alicode.png',
  'alicode-intl.png',
  'alitp-intl.png',
  'alims-intl.png',
  'deepseek.png',
  'azure.png',
  'gitlab.png',
  'huggingface.png',
  'gemini.png',
  'antigravity.png',
  'searxng.png',
  'github.png',
  'copilot.png',
  'continue.png',
  'longcat.png',
  'trae.png',
  'volcengine-ark.png',
  'tokenrouter.png',
  'bluesminds.png',
  'agentrouter.png',
  'aws-polly.png',
  'edge-tts.png',
]);

// Mid-gray transparent marks that look faint even on light plates — deepen them into crisp black.
const DEEPEN_GRAY_FILES = new Set([
  'xai.png',
  'grok-cli.png',
  'grok-web.png',
  'glm.png',
  'glm-cn.png',
  'nous.png',
  'openrouter.png',
  'tavily.png',
]);

// Full-bleed dark-background square tiles that need subtle brightness/contrast lift on dark cards.
const DARK_TILE_BOOST_FILES = new Set([
  'perplexity.png',
  'perplexity-agent.png',
  'perplexity-web.png',
  'kimi.png',
  'kimi-coding.png',
  'cursor.png',
  'codex.png',
  'roo.png',
  'opencode.png',
  'opencode-go.png',
  'reka.png',
  'zed.png',
  'kilo-gateway.png',
  'kilocode.png',
  'linkup.png',
  'sambanova.png',
  'blackbox.png',
  'recraft.png',
  'inworld.png',
  'agnes.png',
  'morph.png',
  'topaz.png',
  'cline.png',
  'gemini-cli.png',
]);

// Transparent artwork with extra built-in outer transparent margin — scale cleanly to fill the square.
const LOGO_SCALE_MAP = {
  'cohere.png': 1.38,
  'byteplus.png': 1.34,
  'tokenrouter.png': 1.34,
  'bluesminds.png': 1.3,
  'agentrouter.png': 1.3,
  'jina-ai.png': 1.28,
  'windsurf.png': 1.26,
  'vertex.png': 1.24,
  'vertex-partner.png': 1.24,
  'tencent.png': 1.22,
  'google-tts.png': 1.2,
  'trae.png': 1.18,
  'muse.png': 1.18,
  'novita.png': 1.18,
  'longcat.png': 1.16,
  'huggingface.png': 1.14,
  'hyperbolic.png': 1.14,
  'deepseek.png': 1.12,
  'cloudflare-ai.png': 1.12,
  'alicode.png': 1.14,
  'alicode-intl.png': 1.14,
  'alitp-intl.png': 1.14,
  'tavily.png': 1.12,
  'antigravity.png': 1.1,
  'gemini.png': 1.08,
  'azure.png': 1.08,
  'gitlab.png': 1.06,
  'elevenlabs.png': 1.06,
};

function extractLogoFilename(url) {
  if (typeof url !== 'string') return '';
  const clean = url.split('?')[0];
  const idx = clean.lastIndexOf('/');
  return (idx >= 0 ? clean.slice(idx + 1) : clean).toLowerCase();
}

function ProviderLogoBase({
  preset,
  slug,
  logo,
  logoExt = 'png',
  src,
  name = '',
  monogram,
  color = '#E56A4A',
  size = 'lg',
  priority = false,
  className = '',
}) {
  const effectiveUrl = resolveProviderLogoUrl({ preset, slug, logo, logoExt, src });
  const [failedUrl, setFailedUrl] = useState(null);

  const dims =
    typeof size === 'number'
      ? {
          box: size,
          font: Math.max(9, Math.floor(size * 0.33)),
          radius: size <= 24 ? 'rounded-md' : size >= 40 ? 'rounded-xl' : 'rounded-lg',
        }
      : SIZE_MAP[size] || SIZE_MAP.lg;

  const fallbackChars = (
    monogram ||
    String(name || preset || slug || '?')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 2) ||
    '?'
  ).toUpperCase();

  const errored = !effectiveUrl || failedUrl === effectiveUrl || failedLogoCache.has(effectiveUrl);

  const isHex = Boolean(color && color.startsWith('#') && color.length === 7);

  if (errored) {
    const base = color || '#E56A4A';
    return (
      <span
        style={{
          width: `${dims.box}px`,
          height: `${dims.box}px`,
          fontSize: `${dims.font}px`,
          backgroundColor: base,
          backgroundImage:
            'linear-gradient(145deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 55%, rgba(0,0,0,0.18) 100%)',
        }}
        className={`inline-flex shrink-0 items-center justify-center border border-white/15 font-bold tracking-tight text-white shadow-xs select-none ${dims.radius} ${className}`.trim()}
        aria-hidden="true"
      >
        {fallbackChars}
      </span>
    );
  }

  const fileName = extractLogoFilename(effectiveUrl);
  const isLightPlate = LIGHT_PLATE_FILES.has(fileName);
  const isDeepenGray = DEEPEN_GRAY_FILES.has(fileName);
  const isDarkBoost = DARK_TILE_BOOST_FILES.has(fileName);
  const customScale = LOGO_SCALE_MAP[fileName] || 0;

  // Transparent marks with a white plate use minimal micro-padding so asymmetric icons never clip,
  // while full-bleed square tiles (OpenAI, Anthropic, Fireworks, Bedrock, Nebius, Together, etc.)
  // render 100% edge-to-edge with zero outer padding and slight overscan to eliminate corner seams.
  const isFullBleedTile = !isLightPlate && fileName !== 'muse.png' && fileName !== 'hyperbolic.png';
  const innerPad = isFullBleedTile
    ? 0
    : dims.box <= 24
      ? 2
      : dims.box <= 36
        ? 3
        : 4;

  const tileStyle = {
    width: `${dims.box}px`,
    height: `${dims.box}px`,
    padding: innerPad ? `${innerPad}px` : undefined,
    ...(isLightPlate
      ? {
          backgroundColor: '#FFFFFF',
          backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #F4F5F7 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(0, 0, 0, 0.14)',
        }
      : fileName === 'muse.png' || fileName === 'hyperbolic.png'
        ? {
            backgroundColor: isHex ? color : '#172554',
            backgroundImage: isHex
              ? `linear-gradient(145deg, color-mix(in srgb, ${color} 45%, #0f172a) 0%, color-mix(in srgb, ${color} 22%, #0b1120) 100%)`
              : 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
          }
        : {
            backgroundColor: '#16181D',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
          }),
  };

  const imgFilter = isDeepenGray
    ? 'brightness(0.52) contrast(1.65)'
    : isDarkBoost
      ? 'brightness(1.22) contrast(1.14) saturate(1.1)'
      : isLightPlate
        ? 'contrast(1.06) saturate(1.12)'
        : 'contrast(1.05) saturate(1.08)';

  const scaleVal = customScale || (isFullBleedTile ? 1.04 : 1);

  return (
    <span
      style={tileStyle}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden select-none ${dims.radius} ${className}`.trim()}
    >
      <img
        src={effectiveUrl}
        alt={name || preset || slug || 'Provider logo'}
        width={dims.box}
        height={dims.box}
        {...(priority ? { fetchPriority: 'high' } : { loading: 'lazy' })}
        decoding="async"
        onError={() => {
          failedLogoCache.add(effectiveUrl);
          setFailedUrl(effectiveUrl);
        }}
        style={{
          filter: imgFilter,
          transform: scaleVal !== 1 ? `scale(${scaleVal})` : undefined,
        }}
        className={`block h-full w-full ${isFullBleedTile ? 'object-cover' : 'object-contain'}`}
      />
    </span>
  );
}

// Memoised: the providers grid re-renders every second while a key is cooling down.
export const ProviderLogo = memo(ProviderLogoBase);

export default ProviderLogo;
