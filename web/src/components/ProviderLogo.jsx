import { useState } from 'react';

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
  xs: { box: 22, pad: 3, font: 9, radius: 'rounded-md', imgRadius: 'rounded-[3px]' },
  sm: { box: 28, pad: 4, font: 10, radius: 'rounded-lg', imgRadius: 'rounded-[5px]' },
  md: { box: 36, pad: 5, font: 11, radius: 'rounded-lg', imgRadius: 'rounded-[6px]' },
  lg: { box: 40, pad: 6, font: 12, radius: 'rounded-xl', imgRadius: 'rounded-[7px]' },
  xl: { box: 48, pad: 7, font: 14, radius: 'rounded-xl', imgRadius: 'rounded-[8px]' },
};

export function ProviderLogo({
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
          pad: Math.max(3, Math.round(size * 0.15)),
          font: Math.max(9, Math.floor(size * 0.33)),
          radius: size <= 24 ? 'rounded-md' : size >= 40 ? 'rounded-xl' : 'rounded-lg',
          imgRadius: size <= 24 ? 'rounded-[3px]' : 'rounded-[6px]',
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

  if (errored) {
    return (
      <span
        style={{
          width: `${dims.box}px`,
          height: `${dims.box}px`,
          backgroundColor: color || '#E56A4A',
          fontSize: `${dims.font}px`,
        }}
        className={`inline-flex shrink-0 items-center justify-center font-bold tracking-tight text-white shadow-xs select-none ${dims.radius} ${className}`.trim()}
        aria-hidden="true"
      >
        {fallbackChars}
      </span>
    );
  }

  const tintBg =
    color && color.startsWith('#') && color.length === 7 ? `${color}1f` : 'rgba(255,255,255,0.06)';
  const imgSize = Math.max(12, dims.box - dims.pad * 2);

  return (
    <span
      style={{
        width: `${dims.box}px`,
        height: `${dims.box}px`,
        padding: `${dims.pad}px`,
        backgroundColor: tintBg,
      }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/10 ${dims.radius} ${className}`.trim()}
    >
      <img
        src={effectiveUrl}
        alt={name || preset || slug || 'Provider logo'}
        width={imgSize}
        height={imgSize}
        {...(priority ? { fetchPriority: 'high' } : { loading: 'lazy' })}
        decoding="async"
        onError={() => {
          failedLogoCache.add(effectiveUrl);
          setFailedUrl(effectiveUrl);
        }}
        className={`block h-full w-full object-contain ${dims.imgRadius}`}
      />
    </span>
  );
}

export default ProviderLogo;
