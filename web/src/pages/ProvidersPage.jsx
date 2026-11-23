import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson2,
  Globe,
  KeyRound,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  catalogApi,
  FALLBACK_PRESETS,
  formatContextWindow,
  normalizePresetItem,
  providersApi,
  proxyPoolsApi,
  slugify,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LucianSlidingTabs } from '../components/lucian/LucianSlidingTabs';
import { Switch } from '../components/Switch';
import { CopyButton } from '../components/CopyButton';
import { ProviderLogo } from '../components/ProviderLogo';

const FORMAT_LABELS = {
  openai: 'OpenAI Chat',
  anthropic: 'Anthropic Messages',
  'gemini-openai': 'Gemini OpenAI',
};

const SECTION_PRESET_ORDER = {
  'free-tier': [
    'gemini',
    'groq',
    'cerebras',
    'openrouter',
    'kilocode',
    'kilo-gateway',
    'api-airforce',
    'bazaarlink',
    'poolside',
    'agnes',
    'runcrate',
    'nvidia',
    'sambanova',
    'huggingface',
    'mistral',
    'cloudflare',
    'byteplus',
  ],
  cheap: [
    'glm',
    'glm-cn',
    'kimi',
    'kimi-coding',
    'minimax',
    'minimax-cn',
    'deepseek',
    'alibaba',
    'alicode',
    'alicode-intl',
    'alitp-intl',
    'opencode-zen',
    'opencode-go',
    'volcengine-ark',
    'xiaomi',
    'xiaomi-tokenplan',
    'siliconflow',
    'chutes',
    'featherless',
    'novita',
    'baidu',
    'tencent',
    'nous',
    'llm7',
    'synthetic',
    'morph',
    'blackbox',
    'tokenharbor',
    'tokenrouter',
    'bluesminds',
    'dahl',
    'sensenova',
    'sensenova-intl',
  ],
  apikey: [
    'openai',
    'anthropic',
    'gitlab',
    'xai',
    'muse',
    'together',
    'fireworks',
    'perplexity',
    'cohere',
    'nebius',
    'hyperbolic',
    'venice',
    'vercel',
    'azure',
    'bedrock',
    'bedrock-xai',
    'vertex',
    'vertex-partner',
    'reka',
  ],
  local: [
    'ollama',
    'ollama-local',
    'lmstudio',
    'vllm',
    'llamacpp',
    'comfyui',
    'sdwebui',
  ],
  service: [
    'deepgram',
    'assemblyai',
    'elevenlabs',
    'cartesia',
    'fish-audio',
    'inworld',
    'playht',
    'voyage',
    'jina',
    'fal',
    'stability',
    'bfl',
    'recraft',
    'runway',
    'tavily',
    'brave',
    'serper',
    'exa',
    'firecrawl',
    'youcom',
    'searxng',
    'google-pse',
    'linkup',
    'searchapi',
  ],
};

const KIND_BADGE_STYLE = {
  chat: 'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30',
  embedding: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  image: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  tts: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  stt: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  video: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  search: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  fetch: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
};

const VERTEX_REGIONS = [
  { value: 'us-central1', label: 'us-central1 (Iowa, US)' },
  { value: 'global', label: 'global (Global Endpoint)' },
  { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore)' },
  { value: 'europe-west4', label: 'europe-west4 (Netherlands, EU)' },
];

const GCP_SERVICE_ACCOUNTS_URL = 'https://console.cloud.google.com/iam-admin/serviceaccounts';
const GCP_OAUTH_CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';

function GoogleMark({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.29V6.61H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1c.94-2.84 3.59-4.95 6.71-4.95Z"
      />
    </svg>
  );
}

function getKeyAuthKind(keyEntry) {
  if (!keyEntry || typeof keyEntry !== 'object') return 'api';
  const rawType = String(
    keyEntry.authMethod ||
      keyEntry.authType ||
      keyEntry.authMode ||
      keyEntry.type ||
      keyEntry.source ||
      ''
  ).toLowerCase();
  if (
    rawType.includes('service_account') ||
    rawType.includes('service-account') ||
    rawType === 'vertex_sa' ||
    Boolean(
      keyEntry.serviceAccountMeta?.clientEmail ||
        keyEntry.clientEmail ||
        keyEntry.serviceAccount?.clientEmail ||
        keyEntry.meta?.clientEmail
    )
  ) {
    return 'service_account';
  }
  if (
    rawType === 'device_code' ||
    keyEntry.oauthMeta?.flow === 'device_code' ||
    keyEntry.oauthMeta?.provider === 'kilocode'
  ) {
    return 'device_code';
  }
  if (
    rawType === 'google_oauth' ||
    rawType === 'google-oauth' ||
    rawType.includes('google_oauth') ||
    String(keyEntry.oauthProvider || '').toLowerCase() === 'google' ||
    keyEntry.oauthMeta?.provider === 'google' ||
    (!rawType.includes('oauth2') &&
      !rawType.includes('device') &&
      Boolean(keyEntry.oauthMeta?.tierLabel || keyEntry.oauthMeta?.tier))
  ) {
    return 'google_oauth';
  }
  if (rawType === 'oauth2') {
    return 'oauth2';
  }
  if (
    rawType.includes('oauth') ||
    rawType.includes('pkce') ||
    Boolean(keyEntry.oauthProvider) ||
    /oauth\s*pkce/i.test(String(keyEntry.label || ''))
  ) {
    return 'oauth_pkce';
  }
  return 'api';
}

function getGoogleOAuthMeta(keyEntry, overrideMeta = null) {
  const baseMeta =
    (keyEntry && typeof keyEntry === 'object' && (keyEntry.oauthMeta || keyEntry.meta)) || {};
  const extra = overrideMeta && typeof overrideMeta === 'object' ? overrideMeta : {};
  const meta = { ...baseMeta, ...extra };

  const email = String(meta.email || keyEntry?.email || '').trim();
  const name = String(meta.name || keyEntry?.accountName || '').trim();
  const projectId = String(meta.projectId || meta.project_id || keyEntry?.projectId || '').trim();
  const tier = String(meta.tier || meta.planTier || '').toLowerCase();
  const rawTierLabel = String(meta.tierLabel || meta.planLabel || '').trim();

  const billingActive =
    meta.billingActive === true ||
    meta.billingEnabled === true ||
    tier.includes('pay') ||
    tier.includes('paid') ||
    tier.includes('billing') ||
    /pay-as-you-go|billing\s*active/i.test(rawTierLabel);

  const isFreeTier =
    !billingActive &&
    (tier.includes('free') || /free\s*tier/i.test(rawTierLabel));

  const tierLabel =
    rawTierLabel ||
    (billingActive
      ? 'Pay-as-you-go (Cloud Billing Active)'
      : isFreeTier
        ? 'Gemini API Free Tier'
        : 'Gemini API · Google Account Connected');

  const shortTierLabel = billingActive
    ? 'Pay-as-you-go'
    : isFreeTier
      ? 'Free Tier'
      : 'Connected';

  const modelsCount =
    typeof meta.modelsCount === 'number' && Number.isFinite(meta.modelsCount)
      ? meta.modelsCount
      : Array.isArray(meta.models)
        ? meta.models.length
        : null;

  const topModels = Array.isArray(meta.topModels)
    ? meta.topModels.filter((m) => typeof m === 'string' && m.trim())
    : [];

  const quotaSummary =
    meta.quotaSummary && typeof meta.quotaSummary === 'object'
      ? meta.quotaSummary
      : billingActive
        ? {
            label: 'Pay-as-you-go (Tier 1+)',
            rpmEstimate: '150–1,000+ RPM',
            rpdEstimate: '10,000+ RPD',
            note: 'Cloud Billing đã bật — hạn mức theo Google Cloud Quotas.',
          }
        : isFreeTier
          ? {
              label: 'Gemini API Free Tier',
              rpmEstimate: '5–15 RPM',
              rpdEstimate: '25–1,500 RPD',
              note: 'Gói miễn phí (Flash ~15 RPM / 1,500 RPD; Pro ~2–5 RPM).',
            }
          : {
              label: 'Google Account (Standard)',
              rpmEstimate: 'Theo hạn mức GCP Project',
              rpdEstimate: 'Xem Cloud Console Quotas',
              note: 'Bật Cloud Billing API trên GCP Project để đọc trạng thái thanh toán.',
            };

  const checkedAt = meta.checkedAt || meta.refreshedAt || meta.updatedAt || null;

  return {
    email,
    name,
    projectId,
    tier,
    billingActive,
    isFreeTier,
    tierLabel,
    shortTierLabel,
    modelsCount,
    topModels,
    quotaSummary,
    checkedAt,
  };
}

function getGoogleTierPillClass(meta) {
  if (meta?.billingActive) {
    return 'border-indigo-500/35 bg-indigo-500/15 text-indigo-500';
  }
  if (meta?.isFreeTier) {
    return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-500';
  }
  return 'border-blue-500/35 bg-blue-500/15 text-blue-500';
}

function getGoogleTierDotClass(meta) {
  if (meta?.billingActive) return 'bg-emerald-500';
  if (meta?.isFreeTier) return 'bg-emerald-500';
  return 'bg-blue-500';
}

function stripJsonCommentsAndTrailingCommas(str) {
  let out = '';
  let inString = false;
  let stringQuote = '"';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        out += '"';
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        out += ch === '\n' ? '\\n' : '';
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += '"';
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  // Strip trailing commas before } or ] (outside strings)
  let cleaned = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      cleaned += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === '}' || out[j] === ']') {
        continue;
      }
    }
    cleaned += ch;
  }

  return cleaned.trim();
}

function tryParseEnvOrArrayToObject(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  if (lines.length === 0) return null;

  const envPairs = {};
  const apiKeys = [];
  let baseUrl = '';
  let projectId = '';
  let accountId = '';
  let resourceName = '';
  let location = '';
  let models = [];
  let matchedEnvCount = 0;

  for (const line of lines) {
    const cleanLine = line.replace(/^export\s+/i, '').trim();
    const eqIdx = cleanLine.indexOf('=');
    if (eqIdx > 0) {
      const rawKey = cleanLine.slice(0, eqIdx).trim();
      let rawVal = cleanLine.slice(eqIdx + 1).trim();
      if (
        (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
        (rawVal.startsWith("'") && rawVal.endsWith("'"))
      ) {
        rawVal = rawVal.slice(1, -1).trim();
      } else {
        rawVal = rawVal.replace(/\s+#.*$/, '').trim();
      }
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(rawKey) && rawVal) {
        matchedEnvCount++;
        envPairs[rawKey] = rawVal;
        const upper = rawKey.toUpperCase();
        if (
          upper === 'API_KEY' ||
          upper === 'APIKEY' ||
          upper === 'TOKEN' ||
          upper === 'ACCESS_TOKEN' ||
          upper === 'SECRET_KEY' ||
          upper.endsWith('_API_KEY') ||
          upper.endsWith('_API_TOKEN') ||
          upper.endsWith('_TOKEN') ||
          upper.endsWith('_KEY')
        ) {
          if (
            !upper.includes('PROJECT') &&
            !upper.includes('ACCOUNT') &&
            !upper.includes('RESOURCE')
          ) {
            for (const part of rawVal.split(',').map((s) => s.trim()).filter(Boolean)) {
              if (!apiKeys.includes(part)) apiKeys.push(part);
            }
          }
        } else if (
          upper.includes('BASE_URL') ||
          upper.includes('BASEURL') ||
          upper.includes('API_BASE') ||
          upper.endsWith('_ENDPOINT') ||
          upper === 'ENDPOINT' ||
          upper === 'URL'
        ) {
          baseUrl = rawVal;
        } else if (upper.includes('PROJECT_ID') || upper === 'GCP_PROJECT' || upper === 'GOOGLE_CLOUD_PROJECT') {
          projectId = rawVal;
        } else if (upper.includes('ACCOUNT_ID') || upper === 'CLOUDFLARE_ACCOUNT_ID') {
          accountId = rawVal;
        } else if (upper.includes('RESOURCE_NAME') || upper === 'AZURE_RESOURCE_NAME') {
          resourceName = rawVal;
        } else if (upper === 'LOCATION' || upper === 'REGION' || upper === 'GOOGLE_CLOUD_LOCATION') {
          location = rawVal;
        } else if (upper === 'MODEL' || upper === 'MODELS' || upper.endsWith('_MODEL') || upper.endsWith('_MODELS')) {
          models.push(...rawVal.split(',').map((s) => s.trim()).filter(Boolean));
        }
      }
    }
  }

  if (matchedEnvCount > 0 && matchedEnvCount === lines.length) {
    const out = {};
    if (apiKeys.length === 1) out.apiKey = apiKeys[0];
    else if (apiKeys.length > 1) out.apiKeys = apiKeys;
    if (baseUrl) out.baseUrl = baseUrl;
    if (projectId) out.projectId = projectId;
    if (accountId) out.accountId = accountId;
    if (resourceName) out.resourceName = resourceName;
    if (location) out.location = location;
    if (models.length > 0) out.models = Array.from(new Set(models));
    out.env = envPairs;
    return out;
  }

  return null;
}

function parseLenientJsonInput(rawText) {
  const original = String(rawText || '');
  let text = original.replace(/^\uFEFF/, '').trim();
  if (!text) {
    return { empty: true, ok: false, parsed: null, wasNormalized: false };
  }

  // 1. Try strict JSON.parse first
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) {
      const keys = [];
      for (const item of direct) {
        if (typeof item === 'string' && item.trim()) {
          keys.push(item.trim());
        } else if (item && typeof item === 'object') {
          const k = item.apiKey || item.api_key || item.key || item.token || item.secretKey;
          if (typeof k === 'string' && k.trim()) keys.push(k.trim());
        }
      }
      return {
        empty: false,
        ok: true,
        parsed: { apiKeys: keys },
        wasNormalized: true,
      };
    }
    if (direct && typeof direct === 'object') {
      return {
        empty: false,
        ok: true,
        parsed: direct,
        wasNormalized: original.includes('\uFEFF'),
      };
    }
  } catch {
    // continue to lenient normalization
  }

  let working = text;

  // 2. Strip Markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = working.match(/^```(?:jsonc?|javascript|js|env|toml|yaml)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    working = fenceMatch[1].trim();
  } else if (working.includes('```')) {
    const innerFence = working.match(/```(?:jsonc?|javascript|js|env)?\s*([\s\S]*?)\s*```/i);
    if (innerFence && innerFence[1]) {
      working = innerFence[1].trim();
    }
  }

  // 3. Replace smart/curly quotes with straight quotes
  working = working
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // 4. Try .env / KEY=VALUE lines if it doesn't start with { or [
  if (!working.startsWith('{') && !working.startsWith('[')) {
    const envObj = tryParseEnvOrArrayToObject(working);
    if (envObj) {
      return {
        empty: false,
        ok: true,
        parsed: envObj,
        wasNormalized: true,
      };
    }
  }

  // 5. Strip comments & trailing commas
  const stripped = stripJsonCommentsAndTrailingCommas(working);
  try {
    const afterStrip = JSON.parse(stripped);
    if (Array.isArray(afterStrip)) {
      const keys = [];
      for (const item of afterStrip) {
        if (typeof item === 'string' && item.trim()) {
          keys.push(item.trim());
        } else if (item && typeof item === 'object') {
          const k = item.apiKey || item.api_key || item.key || item.token || item.secretKey;
          if (typeof k === 'string' && k.trim()) keys.push(k.trim());
        }
      }
      return {
        empty: false,
        ok: true,
        parsed: { apiKeys: keys },
        wasNormalized: true,
      };
    }
    if (afterStrip && typeof afterStrip === 'object') {
      return {
        empty: false,
        ok: true,
        parsed: afterStrip,
        wasNormalized: true,
      };
    }
  } catch {
    // 6. Final fallback: check if it's .env even if comments were stripped
    const envObj = tryParseEnvOrArrayToObject(stripped);
    if (envObj) {
      return {
        empty: false,
        ok: true,
        parsed: envObj,
        wasNormalized: true,
      };
    }
  }

  return { empty: false, ok: false, parsed: null, wasNormalized: false };
}

function parseGoogleClientSecretJson(rawText) {
  const lenient = parseLenientJsonInput(rawText);
  if (!lenient.ok || !lenient.parsed) {
    return { ok: false };
  }
  const parsed = lenient.parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false };
  }
  const clientType = parsed.web
    ? 'Web application'
    : parsed.installed
      ? 'Desktop app'
      : 'OAuth Client';
  const root = parsed.web || parsed.installed || parsed;
  const clientId = String(root.client_id || root.clientId || '').trim();
  const clientSecret = String(root.client_secret || root.clientSecret || '').trim();
  const projectId = String(root.project_id || root.projectId || '').trim();
  if (!clientId) {
    return { ok: false };
  }
  return {
    ok: true,
    clientId,
    clientSecret,
    projectId,
    clientType,
    parsed,
  };
}

function getKeySaInfo(keyEntry) {
  if (!keyEntry || typeof keyEntry !== 'object') {
    return { clientEmail: '', projectId: '', location: '' };
  }
  return {
    clientEmail:
      keyEntry.serviceAccountMeta?.clientEmail ||
      keyEntry.clientEmail ||
      keyEntry.serviceAccount?.clientEmail ||
      keyEntry.meta?.clientEmail ||
      '',
    projectId:
      keyEntry.serviceAccountMeta?.projectId ||
      keyEntry.projectId ||
      keyEntry.serviceAccount?.projectId ||
      keyEntry.meta?.projectId ||
      '',
    location:
      keyEntry.serviceAccountMeta?.location ||
      keyEntry.location ||
      keyEntry.region ||
      keyEntry.serviceAccount?.location ||
      keyEntry.serviceAccount?.region ||
      keyEntry.meta?.location ||
      keyEntry.meta?.region ||
      '',
  };
}

function getPortalUrl(presetMeta, baseUrl) {
  const docs = typeof presetMeta?.docsUrl === 'string' ? presetMeta.docsUrl.trim() : '';
  if (docs) {
    try {
      const parsed = new URL(docs);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return docs;
    } catch {
      // ignore invalid docsUrl
    }
  }
  const rawBase = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (rawBase) {
    try {
      const parsed = new URL(rawBase);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // ignore invalid baseUrl
    }
  }
  return '';
}

function getHostLabel(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function buildSampleJson(preset, form, activePresetMeta, vertexRegion, templateKind = 'apikey') {
  const sampleModels =
    form?.models?.length > 0
      ? form.models.slice(0, 3)
      : activePresetMeta?.models?.length > 0
        ? activePresetMeta.models.slice(0, 3)
        : ['gpt-4.1-mini'];
  const effectiveBaseUrl =
    form?.baseUrl || activePresetMeta?.baseUrl || 'https://api.openai.com/v1';

  if (templateKind === 'gcp_sa') {
    if (preset === 'gemini') {
      return JSON.stringify(
        {
          web: {
            client_id: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
            project_id: 'your-gcp-project-id',
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            client_secret: 'YOUR_GOOGLE_OAUTH_CLIENT_SECRET',
            redirect_uris: [
              typeof window !== 'undefined'
                ? `${window.location.origin}/providers`
                : 'http://localhost:20128/providers',
            ],
          },
        },
        null,
        2
      );
    }
    return JSON.stringify(
      {
        type: 'service_account',
        project_id: 'your-gcp-project-id',
        private_key_id: 'replace-with-private-key-id',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nREPLACE_WITH_YOUR_PEM_PRIVATE_KEY\n-----END PRIVATE KEY-----\n',
        client_email: 'vertex-runner@your-gcp-project-id.iam.gserviceaccount.com',
        token_uri: 'https://oauth2.googleapis.com/token',
        location: vertexRegion || 'us-central1',
      },
      null,
      2
    );
  }

  if (templateKind === 'multikey') {
    const envVarName = `${String(preset || 'OPENAI')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    return JSON.stringify(
      {
        apiKeys: ['sk-primary-official-key-1', 'sk-backup-official-key-2'],
        env: {
          [envVarName]: 'sk-env-official-key-3',
          ...(preset === 'cloudflare' ? { CLOUDFLARE_ACCOUNT_ID: 'your-cloudflare-account-id' } : {}),
          ...(preset === 'vertex' ? { GOOGLE_CLOUD_PROJECT: 'your-gcp-project-id' } : {}),
        },
        baseUrl: effectiveBaseUrl,
        models: sampleModels,
      },
      null,
      2
    );
  }

  // Default: 'apikey' — clean & runnable for every provider including Vertex/Cloudflare/Azure/Gemini/OpenAI/Anthropic/Muse
  const extraFields = {};
  if (preset === 'vertex') {
    extraFields.projectId = 'your-gcp-project-id';
    extraFields.location = vertexRegion || 'us-central1';
  } else if (preset === 'cloudflare') {
    extraFields.accountId = 'your-cloudflare-account-id';
  } else if (preset === 'azure') {
    extraFields.resourceName = 'your-azure-openai-resource';
  }

  return JSON.stringify(
    {
      apiKey: 'sk-replace-with-your-official-api-key',
      baseUrl: effectiveBaseUrl,
      ...extraFields,
      models: sampleModels,
    },
    null,
    2
  );
}

function inspectJsonDraft(rawText, preset = '') {
  const lenient = parseLenientJsonInput(rawText);
  if (lenient.empty) {
    return {
      empty: true,
      valid: false,
      mode: null,
      parsed: null,
      wasNormalized: false,
      error: null,
    };
  }
  if (!lenient.ok || !lenient.parsed || typeof lenient.parsed !== 'object') {
    return {
      empty: false,
      valid: false,
      mode: null,
      parsed: null,
      wasNormalized: false,
      error: 'syntax',
    };
  }

  const parsed = lenient.parsed;
  const wasNormalized = Boolean(lenient.wasNormalized);

  // 1. GCP Service Account JSON
  if (parsed.type === 'service_account') {
    const rawPk = typeof parsed.private_key === 'string' ? parsed.private_key : '';
    const isPlaceholderKey =
      /REPLACE_WITH_YOUR/i.test(rawPk) ||
      /YOUR_PEM_PRIVATE_KEY/i.test(rawPk) ||
      /replace-with-private-key-id/i.test(String(parsed.private_key_id || ''));
    return {
      empty: false,
      valid: true,
      mode: 'service_account',
      parsed,
      wasNormalized,
      isPlaceholderKey,
      clientEmail: typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '',
      projectId: typeof parsed.project_id === 'string' ? parsed.project_id.trim() : '',
      hasPrivateKey: rawPk.includes('PRIVATE KEY'),
      location:
        typeof parsed.location === 'string'
          ? parsed.location.trim()
          : typeof parsed.region === 'string'
            ? parsed.region.trim()
            : '',
    };
  }

  // 2. Google Authorized User (Application Default Credentials / ADC JSON)
  if (
    parsed.type === 'authorized_user' &&
    (parsed.client_id || parsed.clientId) &&
    (parsed.client_secret || parsed.clientSecret) &&
    (parsed.refresh_token || parsed.refreshToken)
  ) {
    return {
      empty: false,
      valid: true,
      mode: 'google_authorized_user',
      parsed,
      wasNormalized,
      clientId: String(parsed.client_id || parsed.clientId || '').trim(),
      projectId: String(
        parsed.quota_project_id || parsed.project_id || parsed.projectId || ''
      ).trim(),
    };
  }

  // 3. Google Cloud Console OAuth Client JSON (client_secret_*.json)
  const oauthRoot =
    parsed.web && typeof parsed.web === 'object'
      ? parsed.web
      : parsed.installed && typeof parsed.installed === 'object'
        ? parsed.installed
        : null;
  if (
    oauthRoot &&
    (oauthRoot.client_id || oauthRoot.clientId) &&
    (oauthRoot.client_secret || oauthRoot.clientSecret)
  ) {
    return {
      empty: false,
      valid: true,
      mode: 'google_oauth_client',
      parsed,
      wasNormalized,
      clientType: parsed.web ? 'Web application' : 'Desktop app',
      clientId: String(oauthRoot.client_id || oauthRoot.clientId || '').trim(),
      clientSecret: String(oauthRoot.client_secret || oauthRoot.clientSecret || '').trim(),
      projectId: String(oauthRoot.project_id || oauthRoot.projectId || '').trim(),
    };
  }

  // 4. Generic Provider Config JSON (recursively extract keys, baseUrl, projectId, accountId, resourceName, models)
  const foundKeys = new Set();
  const foundModels = new Set();
  let baseUrl = '';
  let projectId = '';
  let accountId = '';
  let resourceName = '';
  let location = '';

  const addSecretCandidate = (val) => {
    if (typeof val === 'string') {
      const clean = val.replace(/^Bearer\s+/i, '').trim();
      if (clean) foundKeys.add(clean);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) {
          foundKeys.add(item.trim());
        } else if (item && typeof item === 'object') {
          const k =
            item.apiKey ||
            item.api_key ||
            item.key ||
            item.token ||
            item.accessToken ||
            item.access_token ||
            item.secretKey;
          if (typeof k === 'string' && k.trim()) foundKeys.add(k.trim());
        }
      }
    }
  };

  const inspectObject = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 5) return;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object') inspectObject(item, depth + 1);
      }
      return;
    }

    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      const upper = k.toUpperCase();

      if (
        k === 'apiKey' ||
        k === 'api_key' ||
        k === 'apikey' ||
        k === 'key' ||
        k === 'token' ||
        k === 'accessToken' ||
        k === 'access_token' ||
        k === 'secretKey' ||
        k === 'secret_key' ||
        k === 'bearerToken' ||
        k === 'authToken' ||
        k === 'apiKeys' ||
        k === 'api_keys' ||
        k === 'keys' ||
        k === 'tokens'
      ) {
        addSecretCandidate(v);
      } else if (
        (upper.endsWith('_API_KEY') ||
          upper.endsWith('_API_TOKEN') ||
          upper.endsWith('_TOKEN') ||
          upper.endsWith('_SECRET') ||
          upper.endsWith('_KEY')) &&
        !upper.includes('PROJECT') &&
        !upper.includes('ACCOUNT') &&
        !upper.includes('RESOURCE') &&
        typeof v === 'string'
      ) {
        addSecretCandidate(v);
      } else if (lower === 'headers' && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [hk, hv] of Object.entries(v)) {
          const hLower = hk.toLowerCase();
          if (
            (hLower === 'authorization' ||
              hLower === 'x-api-key' ||
              hLower === 'api-key' ||
              hLower === 'x-goog-api-key') &&
            typeof hv === 'string'
          ) {
            addSecretCandidate(hv);
          }
        }
      }

      if (
        !baseUrl &&
        (k === 'baseUrl' ||
          k === 'base_url' ||
          k === 'baseURL' ||
          k === 'apiBase' ||
          k === 'api_base' ||
          k === 'endpoint' ||
          k === 'url') &&
        typeof v === 'string' &&
        v.trim()
      ) {
        baseUrl = v.trim();
      }

      if (
        !projectId &&
        (k === 'projectId' ||
          k === 'project_id' ||
          k === 'gcpProjectId' ||
          upper === 'GOOGLE_CLOUD_PROJECT' ||
          upper === 'GCP_PROJECT') &&
        typeof v === 'string' &&
        v.trim()
      ) {
        projectId = v.trim();
      }

      if (
        !accountId &&
        (k === 'accountId' ||
          k === 'account_id' ||
          k === 'cloudflareAccountId' ||
          upper === 'CLOUDFLARE_ACCOUNT_ID') &&
        typeof v === 'string' &&
        v.trim()
      ) {
        accountId = v.trim();
      }

      if (
        !resourceName &&
        (k === 'resourceName' ||
          k === 'resource_name' ||
          k === 'azureResourceName' ||
          upper === 'AZURE_RESOURCE_NAME') &&
        typeof v === 'string' &&
        v.trim()
      ) {
        resourceName = v.trim();
      }

      if (
        !location &&
        (k === 'location' || k === 'region' || upper === 'GOOGLE_CLOUD_LOCATION') &&
        typeof v === 'string' &&
        v.trim()
      ) {
        location = v.trim();
      }

      if (k === 'models' || k === 'model') {
        if (typeof v === 'string' && v.trim()) {
          for (const m of v.split(',').map((s) => s.trim()).filter(Boolean)) {
            foundModels.add(m);
          }
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string' && item.trim()) {
              foundModels.add(item.trim());
            } else if (item && typeof item === 'object') {
              const mid = item.id || item.model || item.name;
              if (typeof mid === 'string' && mid.trim()) foundModels.add(mid.trim());
              inspectObject(item, depth + 1);
            }
          }
        } else if (v && typeof v === 'object') {
          // OpenCode / map style: { "gpt-4.1": { ... }, "claude-sonnet-4": { ... } }
          for (const [mKey, mVal] of Object.entries(v)) {
            if (mKey && typeof mKey === 'string') {
              foundModels.add(mKey.trim());
            }
            if (mVal && typeof mVal === 'object') {
              inspectObject(mVal, depth + 1);
            }
          }
        }
      } else if (
        v &&
        typeof v === 'object' &&
        (lower === 'env' ||
          lower === 'options' ||
          lower === 'credentials' ||
          lower === 'auth' ||
          lower === 'provider' ||
          lower === 'providers' ||
          lower === 'config' ||
          lower === 'settings' ||
          (preset && lower === String(preset).toLowerCase()))
      ) {
        inspectObject(v, depth + 1);
      } else if (depth < 2 && v && typeof v === 'object' && !Array.isArray(v)) {
        inspectObject(v, depth + 1);
      }
    }
  };

  inspectObject(parsed, 0);

  return {
    empty: false,
    valid: true,
    mode: 'config_json',
    parsed,
    wasNormalized,
    keyCount: foundKeys.size,
    baseUrl,
    projectId,
    accountId,
    resourceName,
    location,
    modelsCount: foundModels.size,
  };
}

function makeEmptyKeyRow() {
  return {
    localId: `new-${Math.random().toString(36).slice(2, 9)}`,
    isNew: true,
    id: null,
    label: '',
    key: '',
    maskedKey: '',
    authMethod: 'api_key',
    oauthMeta: null,
    serviceAccountMeta: null,
    replacing: false,
    showNewSecret: false,
    enabled: true,
    cooldownUntil: null,
    lastError: '',
  };
}

function providerToForm(provider) {
  return {
    id: provider.id,
    preset: provider.preset || 'custom',
    name: provider.name || '',
    slug: provider.slug || '',
    baseUrl: provider.baseUrl || '',
    formatType: provider.formatType || 'openai',
    proxyPoolId: provider.proxyPoolId || '',
    enabled: provider.enabled !== false,
    models: Array.isArray(provider.models) ? [...provider.models] : [],
    apiKeys:
      Array.isArray(provider.apiKeys) && provider.apiKeys.length > 0
        ? provider.apiKeys.map((k) => ({
            localId: k.id,
            isNew: false,
            id: k.id,
            label: k.label || '',
            key: '',
            maskedKey: k.maskedKey || '••••',
            authMethod: k.authMethod || k.authType || k.authMode || 'api_key',
            source: k.source || '',
            oauthProvider: k.oauthProvider || '',
            oauthMeta: k.oauthMeta || null,
            serviceAccountMeta: k.serviceAccountMeta || null,
            clientEmail: k.clientEmail || '',
            projectId: k.projectId || '',
            location: k.location || k.region || '',
            replacing: false,
            showNewSecret: false,
            enabled: k.enabled !== false,
            cooldownUntil: k.cooldownUntil || null,
            lastError: k.lastError || '',
          }))
        : [],
  };
}

export function ProvidersPage() {
  const toast = useToast();
  const { t } = useLocale();
  const outletCtx = useOutletContext() || {};
  const headerSearch = outletCtx.headerSearch || '';
  const setHeaderSearch = outletCtx.setHeaderSearch;

  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState(FALLBACK_PRESETS);
  const [catalogByPreset, setCatalogByPreset] = useState({});
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | connected | disconnected | free-tier
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [testingSection, setTestingSection] = useState(null);
  const [cardTestResults, setCardTestResults] = useState({});
  const [syncingCatalog, setSyncingCatalog] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState('connection'); // connection | models
  const [connectionMode, setConnectionMode] = useState('api'); // api | json | web
  const [form, setForm] = useState(null);
  const [activePresetMeta, setActivePresetMeta] = useState(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalTesting, setModalTesting] = useState(false);
  const [modalFetching, setModalFetching] = useState(false);
  const [modalFeedback, setModalFeedback] = useState(null);
  const [inspectingAccount, setInspectingAccount] = useState(false);
  const [accountReport, setAccountReport] = useState(null);

  // Mode 2: JSON Connection state (Vertex AI Service Account JSON & Generic Config JSON)
  const [jsonText, setJsonText] = useState('');
  const [jsonFileName, setJsonFileName] = useState('');
  const [jsonLabel, setJsonLabel] = useState('');
  const [vertexRegion, setVertexRegion] = useState('us-central1');
  const [jsonTouched, setJsonTouched] = useState(false);
  const [jsonDragActive, setJsonDragActive] = useState(false);
  const [jsonConnecting, setJsonConnecting] = useState(false);
  const [jsonTestingAction, setJsonTestingAction] = useState(false);

  // Mode 3: Official Web (OpenRouter OAuth PKCE, Google OAuth 2.0 + PKCE & Guided Portal Token)
  const [oauthExchanging, setOauthExchanging] = useState(null); // null | 'openrouter' | 'google'
  const [googleOAuthBanner, setGoogleOAuthBanner] = useState(null);
  const [startingOAuth, setStartingOAuth] = useState(false);
  const [startingGoogleOAuth, setStartingGoogleOAuth] = useState(false);
  const [googleClientStatus, setGoogleClientStatus] = useState({
    configured: false,
    source: 'none',
    clientIdPreview: '',
    projectId: '',
  });
  const [refreshingGooglePlan, setRefreshingGooglePlan] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleSecretVisible, setGoogleSecretVisible] = useState(false);
  const [googleProjectId, setGoogleProjectId] = useState('');
  const [googleClientSecretJson, setGoogleClientSecretJson] = useState(null);
  const [googleJsonFileName, setGoogleJsonFileName] = useState('');
  const [googleJsonClientType, setGoogleJsonClientType] = useState('');
  const [googleJsonDragActive, setGoogleJsonDragActive] = useState(false);
  const [googleJsonError, setGoogleJsonError] = useState('');
  const [googleClientIdError, setGoogleClientIdError] = useState('');
  const [googleClientSecretError, setGoogleClientSecretError] = useState('');
  const [webToken, setWebToken] = useState('');
  const [webTokenVisible, setWebTokenVisible] = useState(false);
  const [webTokenLabel, setWebTokenLabel] = useState('');
  const [webTokenError, setWebTokenError] = useState('');
  const [webConnecting, setWebConnecting] = useState(false);

  // Per-connection Test / Refresh + Generic OAuth2 (GitLab / Custom) + Device Code (Kilo / Nous / Custom)
  const [keyTestingId, setKeyTestingId] = useState('');
  const [keyRefreshingId, setKeyRefreshingId] = useState('');
  const [perKeyResults, setPerKeyResults] = useState({});
  const [oauth2FlowTab, setOauth2FlowTab] = useState('pkce'); // 'pkce' | 'device'
  const [oauth2BaseUrl, setOauth2BaseUrl] = useState('https://gitlab.com');
  const [oauth2AuthUrl, setOauth2AuthUrl] = useState('');
  const [oauth2TokenUrl, setOauth2TokenUrl] = useState('');
  const [oauth2UserinfoUrl, setOauth2UserinfoUrl] = useState('');
  const [oauth2DeviceUrl, setOauth2DeviceUrl] = useState('');
  const [oauth2ClientId, setOauth2ClientId] = useState('');
  const [oauth2ClientSecret, setOauth2ClientSecret] = useState('');
  const [oauth2Scope, setOauth2Scope] = useState('');
  const [oauth2Label, setOauth2Label] = useState('');
  const [oauth2StartedAuthUrl, setOauth2StartedAuthUrl] = useState('');
  const [oauth2PastedCallback, setOauth2PastedCallback] = useState('');
  const [oauth2Busy, setOauth2Busy] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState(null);
  const [deviceStarting, setDeviceStarting] = useState(false);
  const [devicePolling, setDevicePolling] = useState(false);

  const isMountedRef = useRef(true);
  const oauthHandledRef = useRef(false);
  const jsonFileInputRef = useRef(null);
  const jsonTextareaRef = useRef(null);
  const googleFileInputRef = useRef(null);
  const googleClientIdRef = useRef(null);
  const googleClientSecretRef = useRef(null);
  const webTokenInputRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveSearch = (headerSearch || localSearch).trim().toLowerCase();

  const jsonDraftInfo = useMemo(
    () => inspectJsonDraft(jsonText, form?.preset),
    [jsonText, form?.preset]
  );
  const showVertexRegion =
    form?.preset === 'vertex' || jsonDraftInfo.mode === 'service_account';
  const portalUrl = useMemo(
    () => getPortalUrl(activePresetMeta, form?.baseUrl),
    [activePresetMeta, form?.baseUrl]
  );
  const portalHost = useMemo(() => getHostLabel(portalUrl), [portalUrl]);
  const googleRedirectUri = useMemo(
    () => (typeof window !== 'undefined' ? `${window.location.origin}/providers` : 'http://localhost:20128/providers'),
    []
  );
  const connectedGoogleKeys = useMemo(() => {
    if (!form?.apiKeys) return [];
    return form.apiKeys
      .filter((k) => !k.isNew && getKeyAuthKind(k) === 'google_oauth')
      .map((k) => ({ key: k, meta: getGoogleOAuthMeta(k) }));
  }, [form]);

  const resetConnectionModeDrafts = useCallback(() => {
    setConnectionMode('api');
    setJsonText('');
    setJsonFileName('');
    setJsonLabel('');
    setVertexRegion('us-central1');
    setJsonTouched(false);
    setJsonDragActive(false);
    setGoogleClientId('');
    setGoogleClientSecret('');
    setGoogleSecretVisible(false);
    setGoogleProjectId('');
    setGoogleClientSecretJson(null);
    setGoogleJsonFileName('');
    setGoogleJsonClientType('');
    setGoogleJsonDragActive(false);
    setGoogleJsonError('');
    setGoogleClientIdError('');
    setGoogleClientSecretError('');
    setWebToken('');
    setWebTokenVisible(false);
    setWebTokenLabel('');
    setWebTokenError('');
    setKeyTestingId('');
    setKeyRefreshingId('');
    setPerKeyResults({});
    setOauth2FlowTab('pkce');
    setOauth2BaseUrl('https://gitlab.com');
    setOauth2AuthUrl('');
    setOauth2TokenUrl('');
    setOauth2UserinfoUrl('');
    setOauth2DeviceUrl('');
    setOauth2ClientId('');
    setOauth2ClientSecret('');
    setOauth2Scope('');
    setOauth2Label('');
    setOauth2StartedAuthUrl('');
    setOauth2PastedCallback('');
    setOauth2Busy(false);
    setDeviceFlow(null);
    setDeviceStarting(false);
    setDevicePolling(false);
    if (jsonFileInputRef.current) {
      jsonFileInputRef.current.value = '';
    }
    if (googleFileInputRef.current) {
      googleFileInputRef.current.value = '';
    }
  }, []);

  const closeModalCleanly = useCallback(() => {
    setModalOpen(false);
    resetConnectionModeDrafts();
  }, [resetConnectionModeDrafts]);

  // Live 1s countdown when any key is in cooldown
  useEffect(() => {
    const hasCooldown = providers.some((p) =>
      (p.apiKeys || []).some((k) => k.cooldownUntil && k.cooldownUntil > Date.now())
    );
    if (!hasCooldown) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [providers]);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const [res, catRes, poolsRes] = await Promise.all([
        providersApi.list(),
        catalogApi.get().catch(() => null),
        proxyPoolsApi.list().catch(() => null),
      ]);

      const loadedProviders = res?.providers || [];
      setProviders(loadedProviders);

      if (Array.isArray(poolsRes?.pools)) {
        setProxyPools(poolsRes.pools);
      }

      const catMap = {};
      if (Array.isArray(catRes?.providers)) {
        for (const cp of catRes.providers) {
          if (cp?.preset && Array.isArray(cp.models)) {
            catMap[cp.preset] = cp.models;
          }
        }
      }
      setCatalogByPreset(catMap);

      const rawPresets =
        Array.isArray(res?.presets) && res.presets.length > 0 ? res.presets : [];
      const normalized = rawPresets.map(normalizePresetItem);
      const byId = new Map(normalized.map((p) => [p.preset, p]));
      const merged = [
        ...normalized,
        ...FALLBACK_PRESETS.filter((fb) => !byId.has(fb.preset)).map(normalizePresetItem),
      ].map((p) => ({
        ...p,
        modelCatalog:
          Array.isArray(catMap[p.preset]) && catMap[p.preset].length > 0
            ? catMap[p.preset]
            : p.modelCatalog,
      }));
      setPresets(merged);
      setNowMs(Date.now());
      return { providers: loadedProviders, presets: merged };
    } catch (err) {
      toast.error(err?.message || 'Failed to load providers');
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Handle Official OAuth 2.0 + PKCE redirect callbacks (Google Gemini, OpenRouter, GitLab, Custom OAuth)
  useEffect(() => {
    if (oauthHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const oauthProvider = params.get('oauth');
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error') || params.get('error_description');

    const isGoogleReturn =
      oauthProvider === 'google' || (Boolean(state) && state.startsWith('google_'));
    const isGitLabReturn =
      oauthProvider === 'gitlab' || (Boolean(state) && state.startsWith('gitlab_'));
    const isCustomOAuthReturn =
      oauthProvider === 'custom_oauth' || (Boolean(state) && state.startsWith('custom_oauth_'));
    const isOpenRouterReturn =
      !isGoogleReturn &&
      !isGitLabReturn &&
      !isCustomOAuthReturn &&
      (oauthProvider === 'openrouter' || (!oauthProvider && Boolean(code) && Boolean(state)));

    if (!isGoogleReturn && !isOpenRouterReturn && !isGitLabReturn && !isCustomOAuthReturn) return;

    oauthHandledRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);

    if (isGitLabReturn || isCustomOAuthReturn) {
      const targetProvider = isGitLabReturn ? 'gitlab' : 'custom_oauth';
      if (oauthError) {
        toast.error(`OAuth 2.0 error (${targetProvider}): ${oauthError}`);
        return;
      }
      if (!code || !state) {
        toast.error(`OAuth 2.0 callback (${targetProvider}) missing authorization code or state`);
        return;
      }
      setOauthExchanging(targetProvider);
      providersApi
        .exchangeOAuth(targetProvider, { code, state })
        .then(async () => {
          if (!isMountedRef.current) return;
          await loadProviders();
          toast.success(`${isGitLabReturn ? 'GitLab Duo' : 'Custom OAuth'} connected via OAuth 2.0!`);
        })
        .catch((err) => {
          if (!isMountedRef.current) return;
          toast.error(err?.message || `Failed to complete ${targetProvider} OAuth 2.0 exchange`);
        })
        .finally(() => {
          if (isMountedRef.current) setOauthExchanging(null);
        });
      return;
    }

    if (isGoogleReturn) {
      if (oauthError) {
        toast.error(`${t('providers.web.googleCallbackError')}: ${oauthError}`);
        return;
      }
      if (!code || !state) {
        toast.error(
          `${t('providers.web.googleCallbackError')}: missing authorization code or state`
        );
        return;
      }

      setOauthExchanging('google');
      providersApi
        .exchangeGoogleOAuth(code, state)
        .then(async (res) => {
          if (!isMountedRef.current) return;
          const loaded = await loadProviders();
          if (!isMountedRef.current) return;

          const geminiProv =
            res?.provider ||
            loaded?.providers?.find((p) => p.preset === 'gemini' || p.slug === 'gemini') ||
            null;
          const geminiPreset =
            loaded?.presets?.find((p) => p.preset === 'gemini') ||
            FALLBACK_PRESETS.find((p) => p.preset === 'gemini') ||
            null;

          const googleKeys = (geminiProv?.apiKeys || []).filter(
            (k) => getKeyAuthKind(k) === 'google_oauth'
          );
          const latestGoogleKey = googleKeys[googleKeys.length - 1] || null;
          const resMeta = res?.oauthMeta || res?.account || res?.plan || null;
          const meta = getGoogleOAuthMeta(latestGoogleKey, {
            ...(resMeta || {}),
            ...(res?.email ? { email: res.email } : {}),
            ...(res?.name ? { name: res.name } : {}),
            ...(res?.projectId ? { projectId: res.projectId } : {}),
            ...(res?.tier ? { tier: res.tier } : {}),
            ...(res?.tierLabel ? { tierLabel: res.tierLabel } : {}),
            ...(typeof res?.modelsCount === 'number' ? { modelsCount: res.modelsCount } : {}),
          });

          const effectiveModelsCount =
            meta.modelsCount !== null
              ? meta.modelsCount
              : geminiProv?.models?.length ?? null;

          setGoogleOAuthBanner({
            ...meta,
            modelsCount: effectiveModelsCount,
            providerId: geminiProv?.id || null,
          });

          if (geminiProv) {
            resetConnectionModeDrafts();
            setActivePresetMeta(geminiPreset);
            setModalTab('connection');
            setConnectionMode('web');
            setModelSearch('');
            setModelTestResults({});
            setForm(providerToForm(geminiProv));
            setSlugManuallyEdited(true);
            setNewModelInput('');
            const summaryParts = [
              meta.email || t('providers.web.googleCallbackSuccess'),
              meta.tierLabel,
              effectiveModelsCount !== null ? `${effectiveModelsCount} models` : '',
            ].filter(Boolean);
            setModalFeedback({
              type: 'success',
              message: `${t('providers.web.googleCallbackSuccess')} · ${summaryParts.join(' · ')}`,
            });
            setModalOpen(true);
          }

          const toastSummary = [
            meta.email,
            meta.tierLabel,
            effectiveModelsCount !== null ? `${effectiveModelsCount} models` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          toast.success(
            res?.message ||
              (toastSummary
                ? `${t('providers.web.googleCallbackSuccess')} (${toastSummary})`
                : t('providers.web.googleCallbackSuccess'))
          );
        })
        .catch((err) => {
          if (!isMountedRef.current) return;
          toast.error(
            `${t('providers.web.googleCallbackError')}: ${err?.message || 'Exchange failed'}`
          );
        })
        .finally(() => {
          if (isMountedRef.current) setOauthExchanging(null);
        });
      return;
    }

    if (oauthError) {
      toast.error(`${t('providers.web.openrouterCallbackError')}: ${oauthError}`);
      return;
    }

    if (!code || !state) {
      toast.error(
        `${t('providers.web.openrouterCallbackError')}: missing authorization code or state`
      );
      return;
    }

    setOauthExchanging('openrouter');
    providersApi
      .exchangeOpenRouterOAuth(code, state)
      .then(async (res) => {
        if (!isMountedRef.current) return;
        await loadProviders();
        toast.success(res?.message || t('providers.web.openrouterCallbackSuccess'));
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        toast.error(
          `${t('providers.web.openrouterCallbackError')}: ${err?.message || 'Exchange failed'}`
        );
      })
      .finally(() => {
        if (isMountedRef.current) setOauthExchanging(null);
      });
  }, [loadProviders, resetConnectionModeDrafts, toast, t]);

  const handleSyncCatalog = async () => {
    setSyncingCatalog(true);
    try {
      const res = await catalogApi.sync();
      await loadProviders();
      const total = res?.totalModels ?? res?.total ?? 0;
      const added = res?.addedCount ?? res?.added ?? 0;
      toast.success(
        `Đã đồng bộ ${total} models mới nhất${added > 0 ? ` (+${added} mới)` : ' (đã cập nhật)'}`
      );
    } catch (err) {
      toast.error(err?.message || 'Failed to sync latest models');
    } finally {
      setSyncingCatalog(false);
    }
  };

  const presetMap = useMemo(() => new Map(presets.map((p) => [p.preset, p])), [presets]);

  // Match configured providers to presets (1st matching instance per preset; extras or custom go to Compatible section)
  const { providerByPreset, compatibleProviders } = useMemo(() => {
    const map = new Map();
    const compat = [];
    for (const prov of providers) {
      const presetKey = prov.preset || 'custom';
      const isCatalogPreset =
        presetKey !== 'custom' &&
        presetMap.has(presetKey) &&
        presetMap.get(presetKey)?.category !== 'custom';
      if (isCatalogPreset && !map.has(presetKey)) {
        map.set(presetKey, prov);
      } else {
        compat.push(prov);
      }
    }
    return { providerByPreset: map, compatibleProviders: compat };
  }, [providers, presetMap]);

  const openPresetModal = (presetObj, existingProvider = null, initialTab = 'connection') => {
    resetConnectionModeDrafts();
    setActivePresetMeta(presetObj || null);
    setModalTab(initialTab);
    setModelSearch('');
    setModelTestResults({});
    if (existingProvider) {
      setForm(providerToForm(existingProvider));
      setSlugManuallyEdited(true);
    } else {
      const p = presetObj || FALLBACK_PRESETS[0];
      setForm({
        id: null,
        preset: p.preset,
        name: p.preset === 'custom' ? '' : p.name,
        slug: p.preset === 'custom' ? '' : p.preset,
        baseUrl: p.baseUrl || '',
        formatType: p.formatType || 'openai',
        proxyPoolId: '',
        enabled: true,
        models: [...(p.models || [])],
        apiKeys: p.keyOptional ? [] : [makeEmptyKeyRow()],
      });
      setSlugManuallyEdited(false);
    }
    setNewModelInput('');
    setModalFeedback(null);
    setAccountReport(null);
    setModalOpen(true);
  };

  const openAddCompatibleModal = (formatType) => {
    resetConnectionModeDrafts();
    const isAnthropic = formatType === 'anthropic';
    setActivePresetMeta({
      preset: 'custom',
      name: isAnthropic ? 'Anthropic Compatible' : 'OpenAI Compatible',
      category: 'custom',
      color: isAnthropic ? '#E56A4A' : '#10A37F',
      monogram: isAnthropic ? 'AN' : 'OA',
      baseUrl: isAnthropic ? 'https://api.anthropic.com' : 'https://api.example.com/v1',
      formatType,
      keyOptional: false,
      models: [],
      modelCatalog: [],
    });
    setModalTab('connection');
    setModelSearch('');
    setModelTestResults({});
    setForm({
      id: null,
      preset: 'custom',
      name: '',
      slug: '',
      baseUrl: '',
      formatType,
      proxyPoolId: '',
      enabled: true,
      models: [],
      apiKeys: [makeEmptyKeyRow()],
    });
    setSlugManuallyEdited(false);
    setNewModelInput('');
    setModalFeedback(null);
    setAccountReport(null);
    setModalOpen(true);
  };

  const handleJsonFileRead = async (file) => {
    if (!file) return;
    setModalFeedback(null);
    if (file.size > 2 * 1024 * 1024) {
      setModalFeedback({ type: 'error', message: 'JSON file exceeds 2 MB limit.' });
      return;
    }
    try {
      const content = await file.text();
      setJsonText(content);
      setJsonFileName(`${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`);
      setJsonTouched(true);
      const preview = inspectJsonDraft(content, form?.preset);
      if (
        (preview.mode === 'service_account' || preview.mode === 'config_json') &&
        preview.location &&
        VERTEX_REGIONS.some((r) => r.value === preview.location.toLowerCase())
      ) {
        setVertexRegion(preview.location.toLowerCase());
      }
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Failed to read JSON file.' });
    }
  };

  const handleLoadSampleJson = (templateKind = 'apikey') => {
    setModalFeedback(null);
    setJsonFileName('');
    setJsonText(
      buildSampleJson(form?.preset, form, activePresetMeta, vertexRegion, templateKind)
    );
    setJsonTouched(false);
  };

  const handleFormatJsonDraft = () => {
    const info = inspectJsonDraft(jsonText, form?.preset);
    if (info.valid && info.parsed) {
      setJsonText(JSON.stringify(info.parsed, null, 2));
      setModalFeedback(null);
    } else {
      setJsonTouched(true);
    }
  };

  const handleJsonConnect = async (e, { autoTest = false } = {}) => {
    e?.preventDefault?.();
    if (!form) return;
    setModalFeedback(null);
    setJsonTouched(true);

    if (jsonDraftInfo.empty || !jsonDraftInfo.valid || !jsonDraftInfo.parsed) {
      jsonTextareaRef.current?.focus();
      setModalFeedback({
        type: 'error',
        message: jsonDraftInfo.empty
          ? t('providers.json.emptyError')
          : t('providers.json.invalidSyntax'),
      });
      return;
    }

    if (jsonDraftInfo.mode === 'service_account' && jsonDraftInfo.isPlaceholderKey) {
      jsonTextareaRef.current?.focus();
      setModalFeedback({
        type: 'error',
        message: t('providers.json.placeholderSaWarning'),
      });
      return;
    }

    setJsonConnecting(true);
    setJsonTestingAction(Boolean(autoTest));
    try {
      const isSa = jsonDraftInfo.mode === 'service_account';
      const callbackUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/providers`
          : 'http://localhost:20128/providers';
      const payload = {
        preset: form.preset,
        ...(form.id ? { providerId: form.id } : {}),
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
        ...(form.slug.trim() ? { slug: form.slug.trim().toLowerCase() } : {}),
        formatType: form.formatType,
        proxyPoolId: form.proxyPoolId || null,
        ...(jsonLabel.trim() ? { label: jsonLabel.trim() } : {}),
        ...(isSa || form.preset === 'vertex'
          ? { region: vertexRegion, location: vertexRegion }
          : {}),
        callbackUrl,
        jsonText,
        json: jsonDraftInfo.parsed,
      };

      const res = await providersApi.connectJson(payload);

      // If user uploaded/pasted Google Cloud client_secret_*.json in the JSON tab, seamlessly redirect to OAuth!
      const redirectAuthUrl =
        res?.authUrl || res?.url || res?.authorizeUrl || '';
      if ((res?.requiresOAuthRedirect || redirectAuthUrl) && redirectAuthUrl) {
        if (jsonDraftInfo.mode === 'google_oauth_client') {
          setGoogleClientId(jsonDraftInfo.clientId || '');
          setGoogleClientSecret(jsonDraftInfo.clientSecret || '');
          if (jsonDraftInfo.projectId) setGoogleProjectId(jsonDraftInfo.projectId);
          setGoogleClientSecretJson(jsonDraftInfo.parsed);
        }
        const parsedUrl = new URL(redirectAuthUrl);
        if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
          window.location.assign(redirectAuthUrl);
          return;
        }
      }

      const savedProv = res?.provider || null;
      if (savedProv) {
        setProviders((prev) => {
          const exists = prev.some((p) => p.id === savedProv.id);
          return exists
            ? prev.map((p) => (p.id === savedProv.id ? savedProv : p))
            : [...prev, savedProv];
        });
        setForm(providerToForm(savedProv));
        setSlugManuallyEdited(true);
      }
      await loadProviders();

      // Immediately clear raw credentials from textarea state after encrypted save
      setJsonText('');
      setJsonFileName('');
      setJsonLabel('');
      setJsonTouched(false);
      if (jsonFileInputRef.current) jsonFileInputRef.current.value = '';

      const saEmail =
        res?.serviceAccountMeta?.clientEmail || jsonDraftInfo.clientEmail || '';
      const saProject =
        res?.serviceAccountMeta?.projectId || jsonDraftInfo.projectId || '';
      const activeKeyCount = Array.isArray(savedProv?.apiKeys)
        ? savedProv.apiKeys.filter((k) => k.enabled !== false).length
        : jsonDraftInfo.keyCount || 1;
      const resolvedBaseUrl = savedProv?.baseUrl || jsonDraftInfo.baseUrl || form.baseUrl || '';
      const modelsCount = Array.isArray(savedProv?.models)
        ? savedProv.models.length
        : jsonDraftInfo.modelsCount || 0;

      if (autoTest && savedProv?.id) {
        const testRes = await providersApi
          .test(savedProv.id, savedProv.models?.[0] || undefined)
          .catch((err) => ({
            ok: false,
            status: err?.status || 'ERR',
            message: err?.message || 'Test failed',
          }));
        setCardTestResults((prev) => ({ ...prev, [savedProv.id]: testRes }));
        setModalFeedback({
          type: testRes?.ok ? 'success' : 'error',
          message: testRes?.ok
            ? `${t('providers.json.success')} & Verified "${savedProv.name}" (HTTP ${
                testRes.status ?? 200
              }, ${testRes.latencyMs ?? 0}ms) · ${activeKeyCount} ${t(
                'common.keys'
              )} · ${modelsCount} ${t('common.models')}${
                resolvedBaseUrl ? ` · ${resolvedBaseUrl}` : ''
              }`
            : `${t('providers.json.success')} (${activeKeyCount} ${t(
                'common.keys'
              )}, ${modelsCount} ${t('common.models')}), nhưng kiểm tra trực tiếp trả về HTTP ${
                testRes?.status ?? 'ERR'
              }: ${testRes?.message || 'Verification failed'}`,
        });
      } else {
        const detailSummary = [
          isSa && (saEmail || saProject) ? `Service Account (${saEmail || saProject})` : '',
          `${activeKeyCount} ${t('common.keys')}`,
          modelsCount ? `${modelsCount} ${t('common.models')}` : '',
          resolvedBaseUrl,
        ]
          .filter(Boolean)
          .join(' · ');

        setModalFeedback({
          type: 'success',
          message:
            res?.message ||
            `${t('providers.json.success')} · "${
              savedProv?.name || form.name || form.preset
            }" (${detailSummary})`,
        });
      }
    } catch (err) {
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Failed to connect via JSON',
      });
    } finally {
      setJsonConnecting(false);
      setJsonTestingAction(false);
    }
  };

  const handleStartOpenRouterOAuth = async () => {
    setModalFeedback(null);
    setStartingOAuth(true);
    try {
      const callbackUrl = `${window.location.origin}/providers?oauth=openrouter`;
      const res = await providersApi.startOpenRouterOAuth(callbackUrl);
      const authUrl = res?.authUrl || res?.url || res?.authorizeUrl || '';
      if (!authUrl) {
        throw new Error('Server did not return an OpenRouter OAuth authorization URL.');
      }
      const parsed = new URL(authUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Invalid OAuth redirect URL protocol.');
      }
      window.location.assign(authUrl);
    } catch (err) {
      setStartingOAuth(false);
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Failed to start OpenRouter OAuth PKCE flow.',
      });
    }
  };

  const handleGoogleClientJsonFile = async (file) => {
    if (!file) return;
    setGoogleJsonError('');
    setModalFeedback(null);
    if (file.size > 1024 * 1024) {
      setGoogleJsonError('JSON file exceeds 1 MB limit.');
      return;
    }
    try {
      const rawText = await file.text();
      const parsed = parseGoogleClientSecretJson(rawText);
      if (!parsed.ok) {
        setGoogleJsonError(t('providers.web.googleUploadInvalid'));
        return;
      }
      setGoogleClientId(parsed.clientId);
      setGoogleClientSecret(parsed.clientSecret);
      if (parsed.projectId) {
        setGoogleProjectId(parsed.projectId);
      }
      setGoogleClientSecretJson(parsed.parsed);
      setGoogleJsonFileName(file.name);
      setGoogleJsonClientType(parsed.clientType);
      setGoogleClientIdError('');
      setGoogleClientSecretError('');
    } catch (err) {
      setGoogleJsonError(err?.message || t('providers.web.googleUploadInvalid'));
    }
  };

  const loadGoogleClientStatus = useCallback(async () => {
    try {
      const res = await providersApi.googleClientStatus();
      if (isMountedRef.current && res) {
        setGoogleClientStatus({
          configured: Boolean(res.configured),
          source: res.source || 'none',
          clientIdPreview: res.clientIdPreview || '',
          projectId: res.projectId || '',
        });
      }
    } catch {
      // Ignore if offline/unauthenticated
    }
  }, []);

  useEffect(() => {
    if (modalOpen && form?.preset === 'gemini') {
      loadGoogleClientStatus();
    }
  }, [modalOpen, form?.preset, loadGoogleClientStatus]);

  const handleOneClickGoogleSignIn = async () => {
    setModalFeedback(null);
    setStartingGoogleOAuth(true);
    try {
      const res = await providersApi.startGoogleOAuth({
        useSavedClient: true,
        selectAccount: true,
        callbackUrl: googleRedirectUri,
      });
      const authUrl = res?.authUrl || res?.url || res?.authorizeUrl || '';
      if (!authUrl) {
        throw new Error('Server did not return a Google OAuth 2.0 authorization URL.');
      }
      const parsed = new URL(authUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Invalid OAuth redirect URL protocol.');
      }
      window.location.assign(authUrl);
    } catch (err) {
      setStartingGoogleOAuth(false);
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Không thể mở trang chọn tài khoản Google OAuth.',
      });
    }
  };

  const handleStartGoogleOAuth = async (e) => {
    e.preventDefault();
    setModalFeedback(null);
    setGoogleClientIdError('');
    setGoogleClientSecretError('');

    const trimmedClientId = googleClientId.trim();
    const trimmedClientSecret = googleClientSecret.trim();
    const trimmedProjectId = googleProjectId.trim();

    if (!trimmedClientId) {
      setGoogleClientIdError(t('providers.web.googleClientIdRequired'));
      googleClientIdRef.current?.focus();
      return;
    }
    if (!trimmedClientSecret) {
      setGoogleClientSecretError(t('providers.web.googleClientSecretRequired'));
      googleClientSecretRef.current?.focus();
      return;
    }

    setStartingGoogleOAuth(true);
    try {
      const payload = {
        clientId: trimmedClientId,
        clientSecret: trimmedClientSecret,
        ...(trimmedProjectId ? { projectId: trimmedProjectId } : {}),
        ...(googleClientSecretJson ? { clientSecretJson: googleClientSecretJson } : {}),
        selectAccount: true,
        saveClient: true,
        callbackUrl: googleRedirectUri,
      };
      const res = await providersApi.startGoogleOAuth(payload);
      const authUrl = res?.authUrl || res?.url || res?.authorizeUrl || '';
      if (!authUrl) {
        throw new Error('Server did not return a Google OAuth 2.0 authorization URL.');
      }
      const parsed = new URL(authUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Invalid OAuth redirect URL protocol.');
      }
      window.location.assign(authUrl);
    } catch (err) {
      setStartingGoogleOAuth(false);
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Failed to start Google OAuth 2.0 flow.',
      });
    }
  };

  const handleRefreshGooglePlan = async () => {
    if (!form?.id) return;
    setModalFeedback(null);
    setRefreshingGooglePlan(true);
    try {
      const res = await providersApi.refreshGooglePlan(form.id);
      let updatedProv = res?.provider || null;
      const loaded = await loadProviders();
      if (!updatedProv && loaded?.providers) {
        updatedProv = loaded.providers.find((p) => p.id === form.id) || null;
      }
      if (updatedProv) {
        setForm(providerToForm(updatedProv));
      }

      const googleKeys = (updatedProv?.apiKeys || []).filter(
        (k) => getKeyAuthKind(k) === 'google_oauth'
      );
      const latestGoogleKey = googleKeys[googleKeys.length - 1] || null;
      const resMeta = res?.oauthMeta || res?.plan || res?.account || null;
      const meta = getGoogleOAuthMeta(latestGoogleKey, {
        ...(resMeta || {}),
        ...(res?.email ? { email: res.email } : {}),
        ...(res?.projectId ? { projectId: res.projectId } : {}),
        ...(res?.tier ? { tier: res.tier } : {}),
        ...(res?.tierLabel ? { tierLabel: res.tierLabel } : {}),
        ...(typeof res?.modelsCount === 'number' ? { modelsCount: res.modelsCount } : {}),
      });
      const effectiveModelsCount =
        meta.modelsCount !== null ? meta.modelsCount : updatedProv?.models?.length ?? null;

      if (googleOAuthBanner && googleOAuthBanner.providerId === form.id) {
        setGoogleOAuthBanner({
          ...meta,
          modelsCount: effectiveModelsCount,
          providerId: form.id,
        });
      }

      const detailParts = [
        meta.email,
        meta.tierLabel,
        effectiveModelsCount !== null ? `${effectiveModelsCount} models` : '',
      ].filter(Boolean);
      const successMsg =
        res?.message ||
        `${t('providers.web.googleRefreshSuccess')}${
          detailParts.length ? ` · ${detailParts.join(' · ')}` : ''
        }`;

      setModalFeedback({ type: 'success', message: successMsg });
      toast.success(successMsg);
    } catch (err) {
      const errMsg = `${t('providers.web.googleRefreshError')}: ${err?.message || 'Refresh failed'}`;
      setModalFeedback({ type: 'error', message: errMsg });
      toast.error(errMsg);
    } finally {
      setRefreshingGooglePlan(false);
    }
  };

  const handleInspectAccount = async (keyId = '') => {
    if (!form) return;
    setInspectingAccount(true);
    setModalFeedback(null);
    try {
      const saved = await saveFormProvider();
      if (!saved?.id) return;
      const res = await providersApi.inspectAccount(
        saved.id,
        keyId ? { keyId, checkBilling: true } : { checkBilling: true }
      );
      setAccountReport(res);
      if (res?.billingStatus === 'inactive') {
        toast.error(res.billingMessage || 'Cảnh báo: Tài khoản chưa bật Billing hoặc hết credit');
      } else if (res?.ok) {
        toast.success(res.tierLabel || 'Đã xác minh tài khoản & gói');
      } else {
        toast.error(res?.message || res?.billingMessage || 'Kiểm tra tài khoản thất bại');
      }
    } catch (err) {
      toast.error(err?.message || 'Không thể kiểm tra gói & Billing');
    } finally {
      setInspectingAccount(false);
    }
  };

  const handleTestSingleKey = async (row) => {
    if (!form || !row) return;
    setKeyTestingId(row.id || row.localId);
    setModalFeedback(null);
    try {
      const saved = await saveFormProvider();
      if (!saved?.id) return;
      const matchedKey =
        (saved.apiKeys || []).find((k) => row.id && k.id === row.id) ||
        (saved.apiKeys || []).find((k) => row.label && k.label === row.label) ||
        (saved.apiKeys || [])[0];
      const targetKeyId = matchedKey?.id || row.id;
      if (!targetKeyId) {
        toast.error('Vui lòng nhập API key trước khi kiểm tra.');
        return;
      }
      const res = await providersApi.testKey(saved.id, targetKeyId, '');
      setPerKeyResults((prev) => ({ ...prev, [targetKeyId]: res }));
      if (res.ok) {
        toast.success(`${row.label || matchedKey?.maskedKey || row.maskedKey}: ${res.message || 'Connected'}`);
        setForm((prev) => ({
          ...prev,
          apiKeys: prev.apiKeys.map((item) =>
            item.id === targetKeyId ? { ...item, cooldownUntil: null, lastError: '' } : item
          ),
        }));
        await loadProviders();
      } else {
        toast.error(`${row.label || matchedKey?.maskedKey || row.maskedKey}: ${res.message || 'Test failed'}`);
      }
    } catch (err) {
      toast.error(err?.message || 'Key connection test failed');
    } finally {
      setKeyTestingId('');
    }
  };

  const handleRefreshSingleKey = async (row) => {
    if (!form?.id || !row?.id) return;
    setKeyRefreshingId(row.id);
    try {
      const res = await providersApi.refreshKey(form.id, row.id);
      const updatedProv = res?.provider || null;
      await loadProviders();
      if (updatedProv) {
        setForm(providerToForm(updatedProv));
      }
      toast.success(`${row.label || row.maskedKey}: Token refreshed`);
    } catch (err) {
      toast.error(err?.message || 'Failed to refresh OAuth token');
    } finally {
      setKeyRefreshingId('');
    }
  };

  const handleStartGenericOAuth = async (oauthProvider) => {
    setModalFeedback(null);
    setOauth2Busy(true);
    try {
      const callbackUrl = `${window.location.origin}/providers?oauth=${encodeURIComponent(oauthProvider)}`;
      const payload =
        oauthProvider === 'gitlab'
          ? {
              baseUrl: oauth2BaseUrl.trim() || 'https://gitlab.com',
              clientId: oauth2ClientId.trim(),
              ...(oauth2ClientSecret.trim() ? { clientSecret: oauth2ClientSecret.trim() } : {}),
              ...(oauth2Scope.trim() ? { scope: oauth2Scope.trim() } : {}),
              callbackUrl,
              ...(form?.id ? { providerId: form.id } : {}),
            }
          : {
              authorizeUrl: oauth2AuthUrl.trim(),
              tokenUrl: oauth2TokenUrl.trim(),
              ...(oauth2UserinfoUrl.trim() ? { userinfoUrl: oauth2UserinfoUrl.trim() } : {}),
              clientId: oauth2ClientId.trim(),
              ...(oauth2ClientSecret.trim() ? { clientSecret: oauth2ClientSecret.trim() } : {}),
              ...(oauth2Scope.trim() ? { scope: oauth2Scope.trim() } : {}),
              callbackUrl,
              ...(form?.id ? { providerId: form.id } : {}),
              ...(form?.baseUrl ? { baseUrl: form.baseUrl } : {}),
              ...(form?.name ? { name: form.name } : {}),
              ...(form?.formatType ? { formatType: form.formatType } : {}),
              ...(form?.preset ? { preset: form.preset } : {}),
            };
      const res = await providersApi.startOAuth(oauthProvider, payload);
      if (!res?.authUrl) {
        throw new Error('Server did not return an OAuth authorization URL');
      }
      setOauth2StartedAuthUrl(res.authUrl);
      window.open(res.authUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Failed to start OAuth 2.0 PKCE' });
    } finally {
      setOauth2Busy(false);
    }
  };

  const handleCompletePastedOAuth = async (oauthProvider) => {
    const pastedUrl = oauth2PastedCallback.trim();
    if (!pastedUrl) {
      setModalFeedback({ type: 'error', message: 'Paste the full callback URL containing code & state.' });
      return;
    }
    setModalFeedback(null);
    setOauth2Busy(true);
    try {
      const res = await providersApi.exchangeOAuth(oauthProvider, {
        pastedUrl,
        ...(form?.id ? { providerId: form.id } : {}),
        ...(oauth2Label.trim() ? { label: oauth2Label.trim() } : {}),
        ...(form?.baseUrl ? { providerBaseUrl: form.baseUrl } : {}),
      });
      await loadProviders();
      if (res?.provider) {
        setForm(providerToForm(res.provider));
      }
      setOauth2StartedAuthUrl('');
      setOauth2PastedCallback('');
      setModalFeedback({ type: 'success', message: 'OAuth 2.0 connection authenticated & saved!' });
      toast.success('OAuth 2.0 connection saved!');
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'OAuth exchange failed' });
    } finally {
      setOauth2Busy(false);
    }
  };

  const handleStartDeviceFlow = async (oauthProvider) => {
    setModalFeedback(null);
    setDeviceStarting(true);
    try {
      const payload =
        oauthProvider === 'custom_oauth'
          ? {
              deviceCodeUrl: oauth2DeviceUrl.trim(),
              tokenUrl: oauth2TokenUrl.trim(),
              clientId: oauth2ClientId.trim(),
              ...(oauth2ClientSecret.trim() ? { clientSecret: oauth2ClientSecret.trim() } : {}),
              ...(oauth2Scope.trim() ? { scope: oauth2Scope.trim() } : {}),
              ...(form?.id ? { providerId: form.id } : {}),
              ...(form?.baseUrl ? { baseUrl: form.baseUrl } : {}),
              ...(form?.name ? { name: form.name } : {}),
              ...(form?.formatType ? { formatType: form.formatType } : {}),
              ...(form?.preset ? { preset: form.preset } : {}),
            }
          : {
              ...(form?.id ? { providerId: form.id } : {}),
            };
      const res = await providersApi.startDeviceCode(oauthProvider, payload);
      setDeviceFlow({
        provider: oauthProvider,
        flowId: res.flowId,
        userCode: res.userCode || res.deviceCode,
        verificationUri: res.verificationUriComplete || res.verificationUri,
        interval: Number(res.interval) || 3,
      });
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Failed to start Device Flow' });
    } finally {
      setDeviceStarting(false);
    }
  };

  const pollDeviceFlowNow = useCallback(async (flowObj) => {
    if (!flowObj?.flowId || !flowObj?.provider) return;
    setDevicePolling(true);
    try {
      const res = await providersApi.pollDeviceCode(flowObj.provider, {
        flowId: flowObj.flowId,
        ...(form?.id ? { providerId: form.id } : {}),
        ...(oauth2Label.trim() ? { label: oauth2Label.trim() } : {}),
        ...(form?.baseUrl ? { providerBaseUrl: form.baseUrl } : {}),
      });
      if (!isMountedRef.current) return;

      if (res?.status === 'approved') {
        setDeviceFlow(null);
        await loadProviders();
        if (res.provider) {
          setForm(providerToForm(res.provider));
        }
        setModalFeedback({ type: 'success', message: t('providers.web.deviceApproved') });
        toast.success(t('providers.web.deviceApproved'));
      } else if (res?.status === 'denied' || res?.status === 'expired' || res?.status === 'error') {
        setDeviceFlow(null);
        setModalFeedback({ type: 'error', message: res?.message || `Device flow ${res.status}` });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setDeviceFlow(null);
        setModalFeedback({ type: 'error', message: err?.message || 'Device poll failed' });
      }
    } finally {
      if (isMountedRef.current) setDevicePolling(false);
    }
  }, [form, oauth2Label, loadProviders, t, toast]);

  useEffect(() => {
    if (!modalOpen || !deviceFlow?.flowId) return;
    const ms = Math.max(deviceFlow.interval || 3, 2) * 1000;
    const timer = setInterval(() => {
      pollDeviceFlowNow(deviceFlow);
    }, ms);
    return () => clearInterval(timer);
  }, [modalOpen, deviceFlow, pollDeviceFlowNow]);

  const handleWebQuickConnect = async (e) => {
    e.preventDefault();
    if (!form) return;
    setModalFeedback(null);
    setWebTokenError('');

    const trimmedToken = webToken.trim();
    if (!trimmedToken && !activePresetMeta?.keyOptional) {
      setWebTokenError(t('providers.web.tokenRequired'));
      webTokenInputRef.current?.focus();
      return;
    }

    const effectiveName = form.name.trim() || activePresetMeta?.name || '';
    const effectiveSlug = (form.slug.trim() || slugify(effectiveName)).toLowerCase();
    const effectiveBaseUrl = (form.baseUrl.trim() || activePresetMeta?.baseUrl || '').replace(
      /\/+$/,
      ''
    );

    if (!effectiveName || !effectiveSlug || !effectiveBaseUrl) {
      setModalFeedback({
        type: 'error',
        message: 'Name, slug, and official base URL are required before connecting.',
      });
      return;
    }

    setWebConnecting(true);
    try {
      const basePayload = buildPayloadFromForm({
        ...form,
        name: effectiveName,
        slug: effectiveSlug,
        baseUrl: effectiveBaseUrl,
      });

      const nextApiKeys = [...basePayload.apiKeys];
      if (trimmedToken) {
        nextApiKeys.push({
          key: trimmedToken,
          label: webTokenLabel.trim() || 'Official Web Portal',
          enabled: true,
        });
      }
      const finalPayload = { ...basePayload, apiKeys: nextApiKeys };

      let saved = null;
      if (form.id) {
        const res = await providersApi.update(form.id, finalPayload);
        saved = res?.provider || null;
        if (saved) {
          setProviders((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        }
      } else {
        const res = await providersApi.create(finalPayload);
        saved = res?.provider || null;
        if (saved) {
          setProviders((prev) => [...prev, saved]);
          setSlugManuallyEdited(true);
        }
      }

      if (!saved) {
        throw new Error('Failed to save provider credentials.');
      }

      setForm(providerToForm(saved));
      // Immediately clear plaintext token from UI memory
      setWebToken('');
      setWebTokenVisible(false);
      setWebTokenLabel('');

      const testRes = await providersApi.test(saved.id, saved.models?.[0] || undefined);
      setCardTestResults((prev) => ({ ...prev, [saved.id]: testRes }));
      setModalFeedback({
        type: testRes?.ok ? 'success' : 'error',
        message: testRes?.ok
          ? `Connected "${saved.name}" (HTTP ${testRes.status ?? 200}, ${
              testRes.latencyMs ?? 0
            }ms): ${testRes.message || 'Verified'}${
              testRes.modelsCount !== undefined ? ` · ${testRes.modelsCount} models` : ''
            }`
          : `Saved & encrypted key, but live test returned HTTP ${testRes?.status ?? 'ERR'} (${
              testRes?.latencyMs ?? 0
            }ms): ${testRes?.message || 'Verification failed'}`,
      });
    } catch (err) {
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Failed to save & test provider token.',
      });
    } finally {
      setWebConnecting(false);
    }
  };

  const handleAddModelChip = () => {
    const raw = newModelInput.trim();
    if (!raw) return;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    setForm((prev) => {
      if (!prev) return prev;
      const existing = new Set(prev.models);
      const next = [...prev.models];
      for (const m of parts) {
        if (!existing.has(m)) {
          existing.add(m);
          next.push(m);
        }
      }
      return { ...prev, models: next };
    });
    setNewModelInput('');
  };

  const handleRemoveModelChip = (modelId) => {
    setForm((prev) =>
      prev ? { ...prev, models: prev.models.filter((m) => m !== modelId) } : prev
    );
  };

  const buildPayloadFromForm = (f) => {
    const apiKeys = [];
    for (const k of f.apiKeys) {
      if (k.isNew) {
        const trimmedKey = k.key.trim();
        if (!trimmedKey) continue;
        apiKeys.push({
          key: trimmedKey,
          label: k.label.trim() || undefined,
          enabled: k.enabled,
        });
      } else {
        const item = {
          id: k.id,
          label: k.label.trim(),
          enabled: k.enabled,
        };
        if (k.replacing && k.key.trim()) {
          item.key = k.key.trim();
        }
        apiKeys.push(item);
      }
    }

    return {
      preset: f.preset,
      name: f.name.trim(),
      slug: f.slug.trim().toLowerCase(),
      baseUrl: f.baseUrl.trim().replace(/\/+$/, ''),
      formatType: f.formatType,
      proxyPoolId: f.proxyPoolId || null,
      enabled: f.enabled,
      models: f.models,
      apiKeys,
    };
  };

  const saveFormProvider = async () => {
    if (!form) return null;
    const payload = buildPayloadFromForm(form);
    if (!payload.name || !payload.slug || !payload.baseUrl) {
      setModalFeedback({ type: 'error', message: 'Name, slug, and base URL are required.' });
      return null;
    }

    if (form.id) {
      const res = await providersApi.update(form.id, payload);
      const updated = res?.provider;
      if (updated) {
        setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setForm(providerToForm(updated));
      }
      return updated;
    } else {
      const res = await providersApi.create(payload);
      const created = res?.provider;
      if (created) {
        setProviders((prev) => [...prev, created]);
        setForm(providerToForm(created));
        setSlugManuallyEdited(true);
      }
      return created;
    }
  };

  const handleSaveSubmit = async (e) => {
    e?.preventDefault?.();
    setModalFeedback(null);
    setSaving(true);
    try {
      const wasEdit = Boolean(form?.id);
      const saved = await saveFormProvider();
      if (saved) {
        closeModalCleanly();
        setTimeout(() => {
          toast.success(`${wasEdit ? 'Updated' : 'Connected'} "${saved.name}"`);
        }, 0);
      }
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Failed to save provider' });
    } finally {
      setSaving(false);
    }
  };

  const handleModalTestConnection = async (specificModel) => {
    if (!form) return;
    setModalFeedback(null);
    if (specificModel) {
      setTestingModelId(specificModel);
    } else {
      setModalTesting(true);
    }
    try {
      const saved = await saveFormProvider();
      if (!saved) {
        setModalTesting(false);
        setTestingModelId(null);
        return;
      }
      const targetModel = specificModel || undefined;
      const res = await providersApi.test(saved.id, targetModel);
      setCardTestResults((prev) => ({ ...prev, [saved.id]: res }));
      if (specificModel) {
        setModelTestResults((prev) => ({ ...prev, [specificModel]: res }));
      }
      setModalFeedback({
        type: res?.ok ? 'success' : 'error',
        message: `${res?.ok ? 'Connected' : 'Failed'} (HTTP ${res?.status ?? 'ERR'}, ${
          res?.latencyMs ?? 0
        }ms): ${res?.message || ''}${
          res?.modelsCount !== undefined ? ` · ${res.modelsCount} models` : ''
        }`,
      });
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Connection test failed' });
    } finally {
      setModalTesting(false);
      setTestingModelId(null);
    }
  };

  const handleModalFetchModels = async () => {
    if (!form) return;
    setModalFeedback(null);
    setModalFetching(true);
    try {
      const saved = await saveFormProvider();
      if (!saved) {
        setModalFetching(false);
        return;
      }
      const res = await providersApi.fetchModels(saved.id);
      const nextModels = Array.isArray(res?.models) ? res.models : [];
      setForm((prev) => (prev ? { ...prev, models: nextModels } : prev));
      setProviders((prev) =>
        prev.map((p) => (p.id === saved.id ? { ...p, models: nextModels } : p))
      );
      setModalFeedback({
        type: res?.ok ? 'success' : 'error',
        message: res?.ok
          ? `Fetched ${nextModels.length} models.${res?.message ? ` (${res.message})` : ''}`
          : res?.message || 'Failed to fetch models from upstream.',
      });
    } catch (err) {
      setModalFeedback({ type: 'error', message: err?.message || 'Failed to fetch models' });
    } finally {
      setModalFetching(false);
    }
  };

  const handleCardToggleEnabled = async (provider, nextEnabled) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === provider.id ? { ...p, enabled: nextEnabled } : p))
    );
    try {
      const res = await providersApi.update(provider.id, { enabled: nextEnabled });
      if (res?.provider) {
        setProviders((prev) => prev.map((p) => (p.id === provider.id ? res.provider : p)));
      }
      toast.success(
        `${provider.name} ${nextEnabled ? t('common.enabled') : t('common.disabled')}`
      );
    } catch (err) {
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, enabled: provider.enabled } : p))
      );
      toast.error(err?.message || 'Failed to update provider');
    }
  };

  const handleTestSection = async (sectionId, providerIds) => {
    if (!providerIds || providerIds.length === 0) {
      toast.info('No connected providers in this section to test.');
      return;
    }
    setTestingSection(sectionId);
    try {
      const res = await providersApi.testAll({ category: sectionId, providerIds });
      const results = Array.isArray(res?.results) ? res.results : [];
      const nextMap = {};
      let okCount = 0;
      for (const r of results) {
        nextMap[r.providerId] = r;
        if (r.ok) okCount++;
      }
      setCardTestResults((prev) => ({ ...prev, ...nextMap }));
      toast.success(`Tested ${results.length}: ${okCount} OK, ${results.length - okCount} failed`);
    } catch (err) {
      toast.error(err?.message || 'Batch connection test failed');
    } finally {
      setTestingSection(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await providersApi.remove(deleteTarget.id);
      setProviders((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      closeModalCleanly();
      setTimeout(() => {
        toast.success(`Deleted "${deleteTarget.name}"`);
      }, 0);
    } catch (err) {
      toast.error(err?.message || 'Failed to delete provider');
    } finally {
      setDeleting(false);
    }
  };

  const matchesFilter = useCallback(
    (presetObj, configuredProv) => {
      const isConnected = Boolean(configuredProv);
      if (statusFilter === 'connected' && !isConnected) return false;
      if (statusFilter === 'disconnected' && isConnected) return false;
      if (
        statusFilter === 'free-tier' &&
        presetObj.category !== 'free-tier' &&
        presetObj.tier !== 'free'
      )
        return false;

      if (!effectiveSearch) return true;
      const hay = [
        presetObj.name,
        presetObj.preset,
        presetObj.badge,
        ...(presetObj.serviceKinds || []),
        configuredProv?.name,
        configuredProv?.slug,
        ...(configuredProv?.models || presetObj.models || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(effectiveSearch);
    },
    [statusFilter, effectiveSearch]
  );

  const sections = useMemo(() => {
    const pickPresets = (keys, fallbackFilter) => {
      const orderSet = new Set(keys);
      const ordered = keys
        .map((k) => presetMap.get(k))
        .filter(Boolean);
      const extras = presets.filter(
        (p) => p.preset !== 'custom' && !orderSet.has(p.preset) && fallbackFilter(p)
      );
      return [...ordered, ...extras];
    };

    const allKnownOrdered = new Set([
      ...SECTION_PRESET_ORDER['free-tier'],
      ...SECTION_PRESET_ORDER.cheap,
      ...SECTION_PRESET_ORDER.apikey,
      ...SECTION_PRESET_ORDER.local,
      ...SECTION_PRESET_ORDER.service,
    ]);

    const freeTier = pickPresets(
      SECTION_PRESET_ORDER['free-tier'],
      (p) => !allKnownOrdered.has(p.preset) && p.category === 'free-tier'
    );
    const cheapCoding = pickPresets(
      SECTION_PRESET_ORDER.cheap,
      (p) => !allKnownOrdered.has(p.preset) && p.category === 'apikey' && p.tier === 'cheap'
    );
    const flagshipApi = pickPresets(
      SECTION_PRESET_ORDER.apikey,
      (p) => !allKnownOrdered.has(p.preset) && p.category === 'apikey' && p.tier !== 'cheap'
    );
    const localLlm = pickPresets(
      SECTION_PRESET_ORDER.local,
      (p) => !allKnownOrdered.has(p.preset) && p.category === 'local'
    );
    const serviceProviders = pickPresets(
      SECTION_PRESET_ORDER.service,
      (p) => !allKnownOrdered.has(p.preset) && p.category === 'service'
    );

    const buildSec = (id, title, desc, list, badge, badgeClass) => ({
      id,
      title,
      desc,
      badge,
      badgeClass,
      totalCount: list.length,
      presets: list.filter((p) => matchesFilter(p, providerByPreset.get(p.preset))),
      connectedIds: list.map((p) => providerByPreset.get(p.preset)?.id).filter(Boolean),
    });

    return [
      buildSec(
        'free-tier',
        t('providers.section.freeTier'),
        t('providers.section.freeTierDesc'),
        freeTier,
        'Free Forever',
        'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      ),
      buildSec(
        'cheap',
        t('providers.section.cheap'),
        t('providers.section.cheapDesc'),
        cheapCoding,
        '$0.20–$0.60 / 1M',
        'bg-amber-500/15 text-amber-400 border-amber-500/30'
      ),
      buildSec(
        'apikey',
        t('providers.section.apikey'),
        t('providers.section.apikeyDesc'),
        flagshipApi,
        'Official BYOK',
        'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30'
      ),
      buildSec(
        'local',
        t('providers.section.local'),
        t('providers.section.localDesc'),
        localLlm,
        'No Account / Local',
        'bg-sky-500/15 text-sky-400 border-sky-500/30'
      ),
      buildSec(
        'service',
        t('providers.section.service'),
        t('providers.section.serviceDesc'),
        serviceProviders,
        '9 Service Kinds',
        'bg-purple-500/15 text-purple-400 border-purple-500/30'
      ),
    ];
  }, [presets, presetMap, matchesFilter, providerByPreset, t]);

  const filteredCompatible = useMemo(() => {
    if (statusFilter === 'disconnected' || statusFilter === 'free-tier') return [];
    if (!effectiveSearch) return compatibleProviders;
    return compatibleProviders.filter((p) =>
      [p.name, p.slug, p.baseUrl, p.formatType, ...(p.models || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(effectiveSearch)
    );
  }, [compatibleProviders, statusFilter, effectiveSearch]);

  // Combined model catalog for the currently opened provider modal
  const modalModelCatalog = useMemo(() => {
    if (!form) return [];
    const presetKey = form.preset || activePresetMeta?.preset;
    const rawCatalog =
      catalogByPreset[presetKey] ||
      activePresetMeta?.modelCatalog ||
      presetMap.get(presetKey)?.modelCatalog ||
      [];

    const byId = new Map();
    for (const entry of rawCatalog) {
      if (entry?.id) {
        byId.set(entry.id, entry);
      }
    }
    for (const modelId of form.models || []) {
      if (!byId.has(modelId)) {
        byId.set(modelId, {
          id: modelId,
          name: modelId,
          kind: 'chat',
          custom: true,
        });
      }
    }

    const q = modelSearch.trim().toLowerCase();
    const list = Array.from(byId.values());
    if (!q) return list;
    return list.filter((m) =>
      [m.id, m.name, m.kind, m.released].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [form, activePresetMeta, catalogByPreset, presetMap, modelSearch]);

  const totalConnected = providers.length;

  const renderProviderCard = (presetObj, configuredProv, keyId) => {
    const isConnected = Boolean(configuredProv);
    const isEnabled = configuredProv ? configuredProv.enabled !== false : true;
    const keys = configuredProv?.apiKeys || [];
    const activeKeyCount = keys.filter((k) => k.enabled !== false).length;
    const hasServiceAccount = keys.some((k) => getKeyAuthKind(k) === 'service_account');
    const hasOAuthPkce = keys.some((k) => getKeyAuthKind(k) === 'oauth_pkce');
    const hasOAuth2 = keys.some((k) => getKeyAuthKind(k) === 'oauth2');
    const hasDeviceCode = keys.some((k) => getKeyAuthKind(k) === 'device_code');
    const googleOAuthKey = keys.find((k) => getKeyAuthKind(k) === 'google_oauth') || null;
    const googleOAuthMeta = googleOAuthKey ? getGoogleOAuthMeta(googleOAuthKey) : null;
    const coolingKeys = keys.filter((k) => k.cooldownUntil && k.cooldownUntil > nowMs);
    const maxCooldownSec = coolingKeys.length
      ? Math.max(...coolingKeys.map((k) => Math.ceil((k.cooldownUntil - nowMs) / 1000)))
      : 0;
    const testResult = configuredProv ? cardTestResults[configuredProv.id] : null;
    const catalogCount =
      catalogByPreset[presetObj.preset]?.length ||
      presetObj.modelCatalog?.length ||
      configuredProv?.models?.length ||
      presetObj.models?.length ||
      0;

    return (
      <div
        key={keyId}
        role="button"
        tabIndex={0}
        onClick={() => openPresetModal(presetObj, configuredProv)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPresetModal(presetObj, configuredProv);
          }
        }}
        className={`group relative flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-[border-color,background-color,opacity] focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
          isConnected
            ? 'border-[var(--border-strong)] bg-[var(--bg-card)] hover:border-[#E56A4A]/70'
            : 'border-[var(--border-subtle)] bg-[var(--bg-card)]/90 hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]'
        } ${isConnected && !isEnabled ? 'opacity-60' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* Real Provider Logo with automatic monogram fallback (exact 9router.png match) */}
          <ProviderLogo
            preset={presetObj.preset}
            logo={presetObj.logo}
            logoExt={presetObj.logoExt}
            name={configuredProv?.name || presetObj.name}
            color={presetObj.color}
            monogram={presetObj.monogram}
            size="lg"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                {configuredProv?.name || presetObj.name}
              </span>
              {presetObj.badge && !isConnected ? (
                <span className="hidden shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--text-secondary)] xl:inline">
                  {presetObj.badge}
                </span>
              ) : null}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              {isConnected ? (
                !isEnabled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-muted)]">
                    Disabled
                  </span>
                ) : coolingKeys.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    429 ({maxCooldownSec}s)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {presetObj.keyOptional && activeKeyCount === 0
                      ? `1 ${t('common.connected')}`
                      : `${Math.max(1, activeKeyCount)} ${t('common.connected')}`}
                  </span>
                )
              ) : (
                <span className="text-[var(--text-muted)]">{t('common.noConnections')}</span>
              )}

              {catalogCount > 0 ? (
                <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.2 font-mono text-[10px] text-[var(--text-secondary)]">
                  {catalogCount}m
                </span>
              ) : null}

              {isConnected && hasServiceAccount ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-sky-500">
                  <FileJson2 className="h-2.5 w-2.5" aria-hidden="true" />
                  {t('providers.badge.serviceAccount')}
                </span>
              ) : null}

              {isConnected && hasOAuthPkce ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/35 bg-indigo-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-indigo-500">
                  <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                  {t('providers.badge.oauthPkce')}
                </span>
              ) : null}

              {isConnected && hasOAuth2 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-violet-400">
                  <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                  {t('providers.badge.oauth2')}
                </span>
              ) : null}

              {isConnected && hasDeviceCode ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/35 bg-orange-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-orange-400">
                  <KeyRound className="h-2.5 w-2.5" aria-hidden="true" />
                  {t('providers.badge.deviceCode')}
                </span>
              ) : null}

              {isConnected && googleOAuthMeta ? (
                <>
                  <span
                    title={
                      googleOAuthMeta.email
                        ? `${googleOAuthMeta.email} · ${googleOAuthMeta.tierLabel}`
                        : googleOAuthMeta.tierLabel
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-blue-500/35 bg-blue-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-blue-500"
                  >
                    <GoogleMark className="h-2.5 w-2.5 shrink-0" />
                    {t('providers.badge.googleOAuth')}
                  </span>
                  <span
                    title={
                      googleOAuthMeta.email
                        ? `${googleOAuthMeta.email} — ${googleOAuthMeta.tierLabel}`
                        : googleOAuthMeta.tierLabel
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[9.5px] font-semibold ${getGoogleTierPillClass(
                      googleOAuthMeta
                    )}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${getGoogleTierDotClass(googleOAuthMeta)}`}
                      aria-hidden="true"
                    />
                    {googleOAuthMeta.billingActive
                      ? t('providers.badge.payAsYouGo')
                      : googleOAuthMeta.isFreeTier
                        ? t('providers.badge.freeTier')
                        : t('providers.badge.googleConnected')}
                  </span>
                </>
              ) : null}

              {testResult ? (
                <span
                  className={`rounded px-1.5 py-0.2 font-mono text-[10px] ${
                    testResult.ok
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {testResult.ok ? `${testResult.latencyMs}ms` : `ERR ${testResult.status || ''}`}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right Quick Toggle Switch + Detail Page Link on Connected Cards (exact 9router.png match) */}
        {isConnected ? (
          <div
            className="flex shrink-0 items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Link
              to={`/providers/${encodeURIComponent(configuredProv.id)}`}
              title="Manage keys, cooldowns, aliases & models"
              aria-label={`Manage ${configuredProv.name} details`}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 text-[10.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[#E56A4A] hover:text-[#E56A4A]"
            >
              Details →
            </Link>
            <Switch
              size="sm"
              checked={isEnabled}
              onChange={(val) => handleCardToggleEnabled(configuredProv, val)}
              aria-label={`Toggle ${configuredProv.name}`}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-7">
      {oauthExchanging ? (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-medium ${
            oauthExchanging === 'google'
              ? 'border-blue-500/35 bg-blue-500/10 text-blue-500'
              : 'border-indigo-500/35 bg-indigo-500/10 text-indigo-500'
          }`}
        >
          <RefreshCw
            className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>
            {oauthExchanging === 'google'
              ? t('providers.web.googleCallbackProcessing')
              : oauthExchanging === 'gitlab' || oauthExchanging === 'custom_oauth'
                ? 'Completing official OAuth 2.0 PKCE token exchange…'
                : t('providers.web.openrouterCallbackProcessing')}
          </span>
        </div>
      ) : null}

      {googleOAuthBanner ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-500/30 bg-[var(--bg-card)]">
              <GoogleMark className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">
                  {t('providers.web.googleBannerTitle')}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${getGoogleTierPillClass(
                    googleOAuthBanner
                  )}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${getGoogleTierDotClass(
                      googleOAuthBanner
                    )}`}
                    aria-hidden="true"
                  />
                  {googleOAuthBanner.tierLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-secondary)]">
                {googleOAuthBanner.email ? (
                  <span className="font-mono text-[var(--text-primary)]">
                    {googleOAuthBanner.name
                      ? `${googleOAuthBanner.name} (${googleOAuthBanner.email})`
                      : googleOAuthBanner.email}
                  </span>
                ) : null}
                {googleOAuthBanner.projectId ? (
                  <span>
                    Project:{' '}
                    <code className="font-mono text-[var(--text-primary)]">
                      {googleOAuthBanner.projectId}
                    </code>
                  </span>
                ) : null}
                {googleOAuthBanner.modelsCount !== null ? (
                  <span>
                    <strong className="text-[var(--text-primary)]">
                      {googleOAuthBanner.modelsCount}
                    </strong>{' '}
                    Gemini {t('common.models')}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const geminiPreset =
                  presetMap.get('gemini') ||
                  FALLBACK_PRESETS.find((p) => p.preset === 'gemini');
                const geminiProv =
                  providerByPreset.get('gemini') ||
                  providers.find((p) => p.id === googleOAuthBanner.providerId) ||
                  null;
                if (geminiPreset) {
                  openPresetModal(geminiPreset, geminiProv, 'connection');
                  setConnectionMode('web');
                }
              }}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <BadgeCheck className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
              {t('providers.web.googleBannerOpen')}
            </button>
            <button
              type="button"
              onClick={() => setGoogleOAuthBanner(null)}
              aria-label={t('common.close')}
              className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Top Filter Pills + Mobile Search + Explore All Models button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LucianSlidingTabs
          tabs={[
            { id: 'all', label: `${t('providers.filter.all')} (${presets.length - 1})` },
            { id: 'connected', label: `${t('providers.filter.connected')} (${totalConnected})` },
            { id: 'disconnected', label: t('providers.filter.notConnected') },
            { id: 'free-tier', label: t('providers.filter.freeTier') },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Provider status filter"
        />

        <div className="flex items-center gap-2">
          <div className="relative md:hidden">
            <Search
              className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={headerSearch || localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setHeaderSearch?.(e.target.value);
              }}
              placeholder={t('providers.searchPlaceholder')}
              className="field-input w-44 py-1.5 pr-3 pl-8 text-xs"
            />
          </div>

          <Link
            to="/models"
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Cpu className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
            AI Models Explorer (470+)
          </Link>

          <button
            type="button"
            onClick={handleSyncCatalog}
            disabled={syncingCatalog}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs hover:border-[#E56A4A] hover:text-[#E56A4A]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[#E56A4A] ${
                syncingCatalog ? 'animate-spin motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {syncingCatalog ? 'Đang đồng bộ…' : 'Đồng bộ Model mới nhất (Sync Latest)'}
          </button>

          <button
            type="button"
            onClick={loadProviders}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* 5 Official Provider Sections */}
      {sections.map((section) => {
        if (section.presets.length === 0) return null;
        const isTesting = testingSection === section.id;

        return (
          <section key={section.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
                    {section.title}
                  </h2>
                  {section.badge ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${section.badgeClass}`}
                    >
                      {section.badge}
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--text-muted)]">
                    ({section.connectedIds.length}/{section.totalCount})
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{section.desc}</p>
              </div>

              <button
                type="button"
                onClick={() => handleTestSection(section.id, section.connectedIds)}
                disabled={isTesting || section.connectedIds.length === 0}
                className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Play
                  className={`h-3 w-3 ${isTesting ? 'animate-pulse motion-reduce:animate-none text-[#E56A4A]' : ''}`}
                  aria-hidden="true"
                />
                {isTesting ? t('common.testing') : t('common.testAll')}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {section.presets.map((presetObj) =>
                renderProviderCard(
                  presetObj,
                  providerByPreset.get(presetObj.preset) || null,
                  presetObj.preset
                )
              )}
            </div>
          </section>
        );
      })}

      {/* Section 6: API Key Compatible Providers (Custom Nodes — exact 9Router bottom bar!) */}
      <section className="space-y-3 border-t border-[var(--border-subtle)] pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
              {t('providers.section.compatible')}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {t('providers.section.compatibleDesc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openAddCompatibleModal('anthropic')}
              className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('providers.addAnthropicCompat')}
            </button>
            <button
              type="button"
              onClick={() => openAddCompatibleModal('openai')}
              className="r-btn-contrast inline-flex items-center gap-1.5 px-3.5 py-2 text-xs shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('providers.addOpenAICompat')}
            </button>
          </div>
        </div>

        {filteredCompatible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)]/50 px-5 py-6 text-center text-xs text-[var(--text-muted)]">
            {t('providers.noCustomYet')}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredCompatible.map((prov) => {
              const isAnthropic = prov.formatType === 'anthropic';
              const customMeta = {
                preset: prov.preset || 'custom',
                name: prov.name,
                category: 'custom',
                logo: isAnthropic ? 'anthropic' : 'openai',
                color: isAnthropic ? '#E56A4A' : '#10A37F',
                monogram: String(prov.name || prov.slug || 'CU').slice(0, 2).toUpperCase(),
                baseUrl: prov.baseUrl,
                formatType: prov.formatType,
                models: prov.models || [],
              };
              return renderProviderCard(customMeta, prov, prov.id);
            })}
          </div>
        )}
      </section>

      {/* Rich Provider Detail & Model Catalog Modal */}
      <ModalDialog
        open={modalOpen}
        onClose={closeModalCleanly}
        title={
          form?.id
            ? `${form.name} (${form.slug})`
            : activePresetMeta?.name
              ? `${t('providers.connectProvider')} · ${activePresetMeta.name}`
              : t('providers.connectProvider')
        }
        subtitle={
          activePresetMeta?.keyOptional
            ? t('providers.keyOptionalTip')
            : t('providers.keySecretNote')
        }
        size="lg"
        lightDismiss={false}
      >
        {form ? (
          <div className="space-y-5">
            {/* Top Provider Header Banner with Logo, AES-256-GCM Badge & Tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 text-xs">
              <div className="flex items-center gap-3">
                <ProviderLogo
                  preset={form.preset}
                  logo={activePresetMeta?.logo}
                  logoExt={activePresetMeta?.logoExt}
                  name={form.name || activePresetMeta?.name}
                  color={activePresetMeta?.color}
                  monogram={activePresetMeta?.monogram}
                  size="md"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {form.name || activePresetMeta?.name || 'Provider'}
                    </span>
                    <span className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                      {FORMAT_LABELS[form.formatType] || form.formatType}
                    </span>
                  </div>
                  {portalUrl ? (
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-medium text-[#E56A4A] hover:underline"
                    >
                      {t('providers.getApiKey')} ({portalHost || portalUrl})
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Modal Section Tabs */}
              <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5">
                <button
                  type="button"
                  onClick={() => setModalTab('connection')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    modalTab === 'connection'
                      ? 'bg-[#E56A4A] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  API Keys &amp; Config ({form.apiKeys.length})
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('models')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    modalTab === 'models'
                      ? 'bg-[#E56A4A] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Model Catalog ({modalModelCatalog.length})
                </button>
              </div>
            </div>

            {modalFeedback ? (
              <div
                role="alert"
                className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
                  modalFeedback.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                    : 'border-red-500/40 bg-red-500/10 text-red-500'
                }`}
              >
                {modalFeedback.type === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{modalFeedback.message}</span>
              </div>
            ) : null}

            {modalTab === 'connection' ? (
              <div className="space-y-4">
                {/* 3-Tab Official Connection Mode Selector */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <LucianSlidingTabs
                    idPrefix="provider-connect-mode"
                    tabs={[
                      { id: 'api', label: t('providers.mode.api') },
                      { id: 'json', label: t('providers.mode.json') },
                      { id: 'web', label: t('providers.mode.web') },
                    ]}
                    value={connectionMode}
                    onChange={(nextMode) => {
                      setConnectionMode(nextMode);
                      setModalFeedback(null);
                      setWebTokenError('');
                    }}
                    ariaLabel={t('providers.mode.ariaLabel')}
                  />

                  {form.preset === 'gemini' && connectionMode !== 'web' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConnectionMode('web');
                        setModalFeedback(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/35 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-500 transition-colors hover:bg-blue-500/15"
                    >
                      <GoogleMark className="h-3.5 w-3.5 shrink-0" />
                      Google OAuth 2.0 →
                    </button>
                  ) : null}

                  {form.preset === 'openrouter' && connectionMode !== 'web' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConnectionMode('web');
                        setModalFeedback(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-500 transition-colors hover:bg-indigo-500/15"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      OpenRouter OAuth PKCE →
                    </button>
                  ) : null}

                  {form.preset === 'vertex' && connectionMode !== 'json' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConnectionMode('json');
                        setModalFeedback(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-500 transition-colors hover:bg-sky-500/15"
                    >
                      <FileJson2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Vertex Service Account JSON →
                    </button>
                  ) : null}
                </div>

                {/* MODE 1: API Key (existing multi-key round-robin pool) */}
                {connectionMode === 'api' ? (
                  <div
                    role="tabpanel"
                    aria-labelledby="provider-connect-mode-tab-api"
                    className="space-y-5"
                  >
                    <form id="provider-form" onSubmit={handleSaveSubmit} className="space-y-5">
                      {/* Name, Slug, Format, Base URL, Proxy Pool */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="prov-name"
                            className="block text-xs font-medium text-[var(--text-secondary)]"
                          >
                            Display Name
                          </label>
                          <input
                            id="prov-name"
                            type="text"
                            required
                            value={form.name}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              setForm((prev) => ({
                                ...prev,
                                name: nextName,
                                slug:
                                  !prev.id && !slugManuallyEdited ? slugify(nextName) : prev.slug,
                              }));
                            }}
                            placeholder="e.g. Google Gemini"
                            className="field-input mt-1.5 w-full px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="prov-slug"
                            className="block text-xs font-medium text-[var(--text-secondary)]"
                          >
                            Slug (Model Prefix: <code>{form.slug || 'slug'}/model</code>)
                          </label>
                          <input
                            id="prov-slug"
                            type="text"
                            required
                            pattern="[a-z0-9][a-z0-9_-]*"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={form.slug}
                            onChange={(e) => {
                              setSlugManuallyEdited(true);
                              setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase() }));
                            }}
                            placeholder="e.g. gemini"
                            className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="prov-baseurl"
                            className="block text-xs font-medium text-[var(--text-secondary)]"
                          >
                            Official Base URL
                          </label>
                          <input
                            id="prov-baseurl"
                            type="url"
                            required
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={form.baseUrl}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                            }
                            placeholder="https://api.openai.com/v1"
                            className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="prov-format"
                            className="block text-xs font-medium text-[var(--text-secondary)]"
                          >
                            Wire Format
                          </label>
                          <div className="mt-1.5 flex items-center gap-3">
                            <select
                              id="prov-format"
                              value={form.formatType}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, formatType: e.target.value }))
                              }
                              className="field-input flex-1 px-3 py-2 text-sm"
                            >
                              <option value="openai">OpenAI Chat (/chat/completions)</option>
                              <option value="anthropic">Anthropic Messages (/v1/messages)</option>
                              <option value="gemini-openai">Gemini OpenAI-Compatible</option>
                            </select>
                            <Switch
                              size="sm"
                              checked={form.enabled}
                              onChange={(val) => setForm((prev) => ({ ...prev, enabled: val }))}
                              aria-label="Provider Enabled"
                            />
                          </div>
                        </div>

                        <div className="sm:col-span-2">
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="prov-proxy"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"
                            >
                              <Globe className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                              Outbound Proxy Pool ({t('common.optional')})
                            </label>
                            <Link
                              to="/proxy-pools"
                              onClick={closeModalCleanly}
                              className="text-[11px] font-medium text-[#E56A4A] hover:underline"
                            >
                              Manage Proxy Pools →
                            </Link>
                          </div>
                          <select
                            id="prov-proxy"
                            value={form.proxyPoolId || ''}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, proxyPoolId: e.target.value }))
                            }
                            className="field-input mt-1.5 w-full px-3 py-2 text-xs"
                          >
                            <option value="">Direct Connection (No outbound proxy)</option>
                            {proxyPools.map((pool) => (
                              <option key={pool.id} value={pool.id}>
                                {pool.name} ({pool.type?.toUpperCase()} · {pool.urlMasked})
                                {pool.enabled === false ? ' [disabled]' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Multi-Key Pool Manager */}
                      <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                              API Keys Pool ({form.apiKeys.length}) · Round-Robin &amp; 60s 429
                              Cooldown
                            </h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(form.id || form.apiKeys.some((k) => k.key?.trim())) && form.apiKeys.length > 0 ? (
                              <button
                                type="button"
                                disabled={inspectingAccount}
                                onClick={() => handleInspectAccount('')}
                                className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
                              >
                                <BadgeCheck
                                  className={`h-3.5 w-3.5 text-emerald-500 ${
                                    inspectingAccount ? 'animate-spin motion-reduce:animate-none' : ''
                                  }`}
                                  aria-hidden="true"
                                />
                                {inspectingAccount ? 'Đang kiểm tra…' : 'Kiểm tra Gói & Billing'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  apiKeys: [...prev.apiKeys, makeEmptyKeyRow()],
                                }))
                              }
                              className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                              {t('providers.addKey')}
                            </button>
                          </div>
                        </div>

                        {accountReport && form.id ? (
                          <div
                            className={`space-y-1.5 rounded-lg border p-3 text-xs ${
                              accountReport.billingStatus === 'inactive' || !accountReport.ok
                                ? 'border-amber-500/50 bg-amber-500/10'
                                : 'border-emerald-500/40 bg-emerald-500/10'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-[var(--text-primary)]">
                                  {accountReport.tierLabel || 'Trạng thái Tài khoản'}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                                    accountReport.billingStatus === 'active'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : accountReport.billingStatus === 'free_tier'
                                        ? 'bg-sky-500/20 text-sky-400'
                                        : 'bg-amber-500/20 text-amber-400'
                                  }`}
                                >
                                  {accountReport.billingStatus === 'active'
                                    ? 'Billing Active'
                                    : accountReport.billingStatus === 'inactive'
                                      ? 'Chưa bật Billing / $0'
                                      : accountReport.billingStatus === 'free_tier'
                                        ? 'Free Tier'
                                        : accountReport.billingStatus || 'Checked'}
                                </span>
                                {accountReport.organization ? (
                                  <code className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10.5px]">
                                    org: {accountReport.organization}
                                  </code>
                                ) : null}
                                {accountReport.email ? (
                                  <code className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10.5px]">
                                    {accountReport.email}
                                  </code>
                                ) : null}
                              </div>
                              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                                {accountReport.modelsCount ?? 0} models
                                {accountReport.chatModelsCount !== undefined
                                  ? ` (${accountReport.chatModelsCount} chat)`
                                  : ''}{' '}
                                · {accountReport.latencyMs ?? 0}ms
                              </span>
                            </div>

                            {accountReport.billingMessage || accountReport.message ? (
                              <p className="text-[11px] text-[var(--text-secondary)]">
                                {accountReport.billingMessage || accountReport.message}
                                {accountReport.billingUrl &&
                                accountReport.billingStatus === 'inactive' ? (
                                  <>
                                    {' '}
                                    <a
                                      href={accountReport.billingUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-semibold text-[#E56A4A] hover:underline"
                                    >
                                      Mở trang Billing →
                                    </a>
                                  </>
                                ) : null}
                              </p>
                            ) : null}

                            {Array.isArray(accountReport.recommendedModels) &&
                            accountReport.recommendedModels.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                                <span>Model ổn định:</span>
                                {accountReport.recommendedModels.map((m) => (
                                  <code
                                    key={m}
                                    className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[#E56A4A]"
                                  >
                                    {form.slug}/{m}
                                  </code>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {form.apiKeys.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-center text-xs text-[var(--text-muted)]">
                            {activePresetMeta?.keyOptional
                              ? t('providers.keyOptionalTip')
                              : t('providers.noKeysAdded')}
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {form.apiKeys.map((row) => {
                              const isCooling = row.cooldownUntil && row.cooldownUntil > nowMs;
                              const coolSec = isCooling
                                ? Math.ceil((row.cooldownUntil - nowMs) / 1000)
                                : 0;
                              const authKind = getKeyAuthKind(row);
                              const saInfo =
                                authKind === 'service_account' ? getKeySaInfo(row) : null;
                              const googleMeta =
                                authKind === 'google_oauth' ? getGoogleOAuthMeta(row) : null;

                              return (
                                <div
                                  key={row.localId}
                                  className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      value={row.label}
                                      onChange={(e) =>
                                        setForm((prev) => ({
                                          ...prev,
                                          apiKeys: prev.apiKeys.map((item) =>
                                            item.localId === row.localId
                                              ? { ...item, label: e.target.value }
                                              : item
                                          ),
                                        }))
                                      }
                                      placeholder="Label (e.g. Primary)"
                                      aria-label="Key label"
                                      className="field-input w-36 px-2.5 py-1.5 text-xs"
                                    />

                                    {row.isNew || row.replacing ? (
                                      <div className="relative min-w-[190px] flex-1">
                                        <input
                                          type={row.showNewSecret ? 'text' : 'password'}
                                          value={row.key}
                                          onChange={(e) =>
                                            setForm((prev) => ({
                                              ...prev,
                                              apiKeys: prev.apiKeys.map((item) =>
                                                item.localId === row.localId
                                                  ? { ...item, key: e.target.value }
                                                  : item
                                              ),
                                            }))
                                          }
                                          placeholder={
                                            row.replacing
                                              ? 'Paste replacement API key…'
                                              : 'Paste official API key…'
                                          }
                                          aria-label="API Key Secret"
                                          autoComplete="off"
                                          autoCorrect="off"
                                          autoCapitalize="none"
                                          spellCheck={false}
                                          className="field-input w-full py-1.5 pr-9 pl-2.5 font-mono text-xs"
                                        />
                                        <button
                                          type="button"
                                          aria-pressed={row.showNewSecret}
                                          onClick={() =>
                                            setForm((prev) => ({
                                              ...prev,
                                              apiKeys: prev.apiKeys.map((item) =>
                                                item.localId === row.localId
                                                  ? { ...item, showNewSecret: !item.showNewSecret }
                                                  : item
                                              ),
                                            }))
                                          }
                                          aria-label={
                                            row.showNewSecret ? 'Hide secret' : 'Show secret'
                                          }
                                          className="absolute inset-y-0 right-1.5 my-auto flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        >
                                          {row.showNewSecret ? (
                                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                          ) : (
                                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                          )}
                                        </button>
                                      </div>
                                    ) : authKind === 'service_account' ? (
                                      <div className="flex min-w-[200px] flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/30 bg-sky-500/8 px-2.5 py-1.5">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-500">
                                            <FileJson2 className="h-2.5 w-2.5" aria-hidden="true" />
                                            {t('providers.badge.serviceAccount')}
                                          </span>
                                          {saInfo?.clientEmail ? (
                                            <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                                              {saInfo.clientEmail}
                                            </code>
                                          ) : (
                                            <code className="font-mono text-xs text-[var(--text-primary)]">
                                              {row.maskedKey}
                                            </code>
                                          )}
                                          {saInfo?.projectId ? (
                                            <span className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                                              {saInfo.projectId}
                                              {saInfo.location ? ` · ${saInfo.location}` : ''}
                                            </span>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConnectionMode('json');
                                            setModalFeedback(null);
                                          }}
                                          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#E56A4A] hover:underline"
                                        >
                                          <Upload className="h-3 w-3" aria-hidden="true" />
                                          JSON
                                        </button>
                                      </div>
                                    ) : authKind === 'google_oauth' ? (
                                      <div className="flex min-w-[200px] flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-blue-500/30 bg-blue-500/8 px-2.5 py-1.5">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
                                            <GoogleMark className="h-2.5 w-2.5 shrink-0" />
                                            {t('providers.badge.googleOAuth')}
                                          </span>
                                          {googleMeta?.email ? (
                                            <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                                              {googleMeta.email}
                                            </code>
                                          ) : (
                                            <code className="font-mono text-xs text-[var(--text-primary)]">
                                              {row.maskedKey}
                                            </code>
                                          )}
                                          {googleMeta?.tierLabel ? (
                                            <span
                                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getGoogleTierPillClass(
                                                googleMeta
                                              )}`}
                                            >
                                              <span
                                                className={`h-1.5 w-1.5 rounded-full ${getGoogleTierDotClass(
                                                  googleMeta
                                                )}`}
                                                aria-hidden="true"
                                              />
                                              {googleMeta.tierLabel}
                                            </span>
                                          ) : null}
                                          {googleMeta?.projectId ? (
                                            <span className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                                              {googleMeta.projectId}
                                            </span>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConnectionMode('web');
                                            setModalFeedback(null);
                                          }}
                                          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-blue-500 hover:underline"
                                        >
                                          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                                          OAuth
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex min-w-[200px] flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1.5">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                          <code className="truncate font-mono text-xs text-[var(--text-primary)]">
                                            {authKind === 'oauth2' || authKind === 'device_code'
                                              ? row.oauthMeta?.email ||
                                                row.oauthMeta?.username ||
                                                row.maskedKey
                                              : row.maskedKey}
                                          </code>
                                          {authKind === 'oauth_pkce' ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/35 bg-indigo-500/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-indigo-500">
                                              <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                                              {t('providers.badge.oauthPkce')}
                                            </span>
                                          ) : authKind === 'oauth2' ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-violet-400">
                                              <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                                              {t('providers.badge.oauth2')}
                                            </span>
                                          ) : authKind === 'device_code' ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/35 bg-orange-500/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-orange-400">
                                              <KeyRound className="h-2.5 w-2.5" aria-hidden="true" />
                                              {t('providers.badge.deviceCode')}
                                            </span>
                                          ) : null}
                                          {row.oauthMeta?.orgId ? (
                                            <span className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                                              org:{row.oauthMeta.orgId}
                                            </span>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setForm((prev) => ({
                                              ...prev,
                                              apiKeys: prev.apiKeys.map((item) =>
                                                item.localId === row.localId
                                                  ? { ...item, replacing: true, key: '' }
                                                  : item
                                              ),
                                            }))
                                          }
                                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E56A4A] hover:underline"
                                        >
                                          <RotateCw className="h-3 w-3" aria-hidden="true" />
                                          Replace
                                        </button>
                                      </div>
                                    )}

                                    {!row.isNew && form?.id && row.id ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleTestSingleKey(row)}
                                          disabled={keyTestingId === row.id}
                                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[#E56A4A]/60 hover:text-[var(--text-primary)]"
                                          title={t('providers.testKeyBtn')}
                                        >
                                          <Play className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                                          {keyTestingId === row.id ? '…' : t('providers.testKeyBtn')}
                                        </button>
                                        {(authKind === 'oauth2' ||
                                          authKind === 'google_oauth' ||
                                          authKind === 'service_account') ? (
                                          <button
                                            type="button"
                                            onClick={() => handleRefreshSingleKey(row)}
                                            disabled={keyRefreshingId === row.id}
                                            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-blue-500/60 hover:text-[var(--text-primary)]"
                                            title={t('providers.refreshKeyBtn')}
                                          >
                                            <RefreshCw
                                              className={`h-3 w-3 text-blue-400 ${
                                                keyRefreshingId === row.id ? 'animate-spin' : ''
                                              }`}
                                              aria-hidden="true"
                                            />
                                            {t('providers.refreshKeyBtn')}
                                          </button>
                                        ) : null}
                                      </>
                                    ) : null}

                                    <Switch
                                      size="sm"
                                      checked={row.enabled}
                                      onChange={(val) =>
                                        setForm((prev) => ({
                                          ...prev,
                                          apiKeys: prev.apiKeys.map((item) =>
                                            item.localId === row.localId
                                              ? { ...item, enabled: val }
                                              : item
                                          ),
                                        }))
                                      }
                                      aria-label="Enable API key"
                                    />

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setForm((prev) => ({
                                          ...prev,
                                          apiKeys: prev.apiKeys.filter(
                                            (item) => item.localId !== row.localId
                                          ),
                                        }))
                                      }
                                      aria-label="Remove API key"
                                      className="rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-500 hover:bg-red-500/20"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  </div>

                                  {(isCooling || row.lastError || perKeyResults[row.id]) && (
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      {isCooling ? (
                                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-amber-500">
                                          <Clock className="h-3 w-3" aria-hidden="true" />
                                          Cooldown {coolSec}s
                                        </span>
                                      ) : null}
                                      {perKeyResults[row.id] ? (
                                        <span
                                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono ${
                                            perKeyResults[row.id].ok
                                              ? 'bg-emerald-500/15 text-emerald-400'
                                              : 'bg-red-500/15 text-red-400'
                                          }`}
                                        >
                                          {perKeyResults[row.id].ok
                                            ? `OK (${perKeyResults[row.id].latencyMs}ms)`
                                            : `ERR: ${perKeyResults[row.id].message}`}
                                        </span>
                                      ) : null}
                                      {row.lastError ? (
                                        <span className="truncate text-red-500">
                                          {row.lastError}
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </form>
                  </div>
                ) : null}

                {/* MODE 2: JSON Connection (Vertex AI Service Account JSON & Generic Provider Config JSON) */}
                {connectionMode === 'json' ? (
                  <div
                    role="tabpanel"
                    aria-labelledby="provider-connect-mode-tab-json"
                    className="space-y-4"
                  >
                    <form
                      id="provider-json-form"
                      onSubmit={handleJsonConnect}
                      noValidate
                      className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileJson2 className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                              {t('providers.json.title')}
                            </h3>
                            <span className="rounded-full border border-sky-500/35 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-500">
                              {t('providers.json.badge')}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {t('providers.json.desc')}
                          </p>
                        </div>
                      </div>

                      {/* Accessible .json File Picker & Drag-and-Drop Bar */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (!jsonDragActive) setJsonDragActive(true);
                        }}
                        onDragLeave={() => setJsonDragActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setJsonDragActive(false);
                          const dropped = e.dataTransfer?.files?.[0];
                          if (dropped) handleJsonFileRead(dropped);
                        }}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3 transition-colors ${
                          jsonDragActive
                            ? 'border-[#E56A4A] bg-[#E56A4A]/10'
                            : 'border-[var(--border-strong)] bg-[var(--bg-card)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <input
                            ref={jsonFileInputRef}
                            id="prov-json-file"
                            type="file"
                            accept=".json,application/json"
                            className="visually-hidden peer"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleJsonFileRead(file);
                            }}
                          />
                          <label
                            htmlFor="prov-json-file"
                            className="r-btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#E56A4A]"
                          >
                            <Upload className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                            {t('providers.json.uploadBtn')}
                          </label>
                          {jsonFileName ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-500">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              {jsonFileName}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">
                              {t('providers.json.uploadHint')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleLoadSampleJson('apikey')}
                            className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
                          >
                            <Code2 className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                            {t('providers.json.sampleApiKey')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadSampleJson('multikey')}
                            className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
                          >
                            <KeyRound className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                            {t('providers.json.sampleMultiKey')}
                          </button>
                          {form.preset === 'vertex' || form.preset === 'gemini' ? (
                            <button
                              type="button"
                              onClick={() => handleLoadSampleJson('gcp_sa')}
                              className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
                            >
                              <FileJson2 className="h-3 w-3 text-sky-500" aria-hidden="true" />
                              {t('providers.json.sampleGcpSa')}
                            </button>
                          ) : null}
                          {jsonText.trim() ? (
                            <>
                              <button
                                type="button"
                                onClick={handleFormatJsonDraft}
                                className="r-btn-secondary px-2.5 py-1 text-[11px]"
                              >
                                {t('providers.json.formatJson')}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setJsonText('');
                                  setJsonFileName('');
                                  setJsonTouched(false);
                                  if (jsonFileInputRef.current) jsonFileInputRef.current.value = '';
                                }}
                                className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-red-500"
                              >
                                {t('providers.json.clear')}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {/* Vertex AI Region Selector (shown for Vertex preset or detected Service Account JSON) + Optional Label */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {showVertexRegion ? (
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <label
                                htmlFor="prov-vertex-region"
                                className="block text-xs font-medium text-[var(--text-secondary)]"
                              >
                                {t('providers.json.regionLabel')}
                              </label>
                              <a
                                href={GCP_SERVICE_ACCOUNTS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E56A4A] hover:underline"
                              >
                                GCP IAM
                                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                              </a>
                            </div>
                            <select
                              id="prov-vertex-region"
                              value={vertexRegion}
                              onChange={(e) => setVertexRegion(e.target.value)}
                              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
                            >
                              {VERTEX_REGIONS.map((reg) => (
                                <option key={reg.value} value={reg.value}>
                                  {reg.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              {t('providers.json.regionHint')}
                            </p>
                          </div>
                        ) : null}

                        <div className={showVertexRegion ? '' : 'sm:col-span-2'}>
                          <label
                            htmlFor="prov-json-label"
                            className="block text-xs font-medium text-[var(--text-secondary)]"
                          >
                            {t('providers.json.labelInput')}
                          </label>
                          <input
                            id="prov-json-label"
                            type="text"
                            value={jsonLabel}
                            onChange={(e) => setJsonLabel(e.target.value)}
                            placeholder={t('providers.json.labelPlaceholder')}
                            className="field-input mt-1.5 w-full px-3 py-2 text-xs"
                          />
                        </div>
                      </div>

                      {/* Google ADC (authorized_user) 3-Step Quick Guide */}
                      <div className="rounded-lg border border-blue-500/25 bg-blue-500/6 p-3 text-[11px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-blue-400">
                            Mẹo kết nối Google ADC OAuth JSON (<code>authorized_user</code>) trong 30 giây:
                          </span>
                          <CopyButton
                            value="gcloud auth application-default login"
                            size="xs"
                            label="Copy lệnh gcloud"
                            toastMessage="Copied gcloud ADC login command"
                          />
                        </div>
                        <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">
                          1. Chạy <code>gcloud auth application-default login</code> để đăng nhập Google chính chủ.{' '}
                          2. Mở tệp <code>%APPDATA%\gcloud\application_default_credentials.json</code> (Windows) hoặc{' '}
                          <code>~/.config/gcloud/application_default_credentials.json</code> (macOS/Linux).{' '}
                          3. Dán hoặc kéo thả tệp JSON đó vào ô bên dưới.
                        </p>
                      </div>

                      {/* JSON Textarea with post-interaction accessible error sync */}
                      <div>
                        <label
                          htmlFor="prov-json-input"
                          className="block text-xs font-medium text-[var(--text-secondary)]"
                        >
                          {t('providers.json.textareaLabel')}
                        </label>
                        {(() => {
                          const showJsonErr =
                            jsonTouched && (jsonDraftInfo.empty || !jsonDraftInfo.valid);
                          return (
                            <>
                              <textarea
                                ref={jsonTextareaRef}
                                id="prov-json-input"
                                name="provider_json"
                                rows={8}
                                value={jsonText}
                                onChange={(e) => {
                                  setJsonText(e.target.value);
                                  if (modalFeedback?.type === 'error') setModalFeedback(null);
                                }}
                                onBlur={() => {
                                  if (jsonText.trim()) setJsonTouched(true);
                                }}
                                placeholder={t('providers.json.textareaPlaceholder')}
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                aria-invalid={showJsonErr ? 'true' : 'false'}
                                aria-describedby={
                                  showJsonErr ? 'prov-json-error' : 'prov-json-safe-hint'
                                }
                                className={`field-input mt-1.5 w-full resize-y px-3 py-2.5 font-mono text-xs leading-relaxed ${
                                  showJsonErr ? 'border-red-500/70' : ''
                                }`}
                              />
                              {showJsonErr ? (
                                <p
                                  id="prov-json-error"
                                  className="mt-1.5 flex items-center gap-1.5 text-xs text-red-500"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>
                                    {jsonDraftInfo.empty
                                      ? t('providers.json.emptyError')
                                      : t('providers.json.invalidSyntax')}
                                  </span>
                                </p>
                              ) : null}
                            </>
                          );
                        })()}
                      </div>

                      {/* Live Parsed JSON Detection Summary (never exposes private_key or apiKey!) */}
                      {jsonDraftInfo.valid ? (
                        <div
                          className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                            jsonDraftInfo.isPlaceholderKey
                              ? 'border-amber-500/40 bg-amber-500/10'
                              : 'border-emerald-500/35 bg-emerald-500/8'
                          }`}
                        >
                          {jsonDraftInfo.wasNormalized ? (
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                                {t('providers.json.normalizedBadge')}
                              </span>
                              <button
                                type="button"
                                onClick={handleFormatJsonDraft}
                                className="text-[11px] font-semibold text-[#E56A4A] hover:underline"
                              >
                                {t('providers.json.formatJson')} →
                              </button>
                            </div>
                          ) : null}

                          {jsonDraftInfo.mode === 'service_account' ? (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-500">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{t('providers.json.detectedSa')}</span>
                                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-500">
                                  RS256 JWT Auto-Refresh
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                                {jsonDraftInfo.projectId ? (
                                  <span>
                                    Project:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.projectId}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.clientEmail ? (
                                  <span>
                                    Client:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.clientEmail}
                                    </code>
                                  </span>
                                ) : null}
                                <span>
                                  Region:{' '}
                                  <code className="font-mono text-[var(--text-primary)]">
                                    {vertexRegion}
                                  </code>
                                </span>
                              </div>
                              {jsonDraftInfo.isPlaceholderKey ? (
                                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] text-amber-500">
                                  <span className="flex items-center gap-1.5 font-medium">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    {t('providers.json.placeholderSaWarning')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleLoadSampleJson('apikey')}
                                    className="r-btn-secondary shrink-0 px-2 py-0.5 text-[10.5px]"
                                  >
                                    {t('providers.json.sampleApiKey')}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : jsonDraftInfo.mode === 'google_authorized_user' ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-500">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{t('providers.json.detectedAdc')}</span>
                                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[10px] text-blue-500">
                                  OAuth Refresh Token
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                                {jsonDraftInfo.clientId ? (
                                  <span className="truncate">
                                    Client ID:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.clientId}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.projectId ? (
                                  <span>
                                    Project:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.projectId}
                                    </code>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : jsonDraftInfo.mode === 'google_oauth_client' ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-500">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{t('providers.json.detectedOAuthClient')}</span>
                                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[10px] text-blue-500">
                                  {jsonDraftInfo.clientType || 'OAuth 2.0 + PKCE'}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                                {jsonDraftInfo.clientId ? (
                                  <span className="truncate">
                                    Client ID:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.clientId}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.projectId ? (
                                  <span>
                                    Project:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.projectId}
                                    </code>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-500">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{t('providers.json.detectedGeneric')}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                                <span>
                                  Keys detected:{' '}
                                  <strong className="text-[var(--text-primary)]">
                                    {jsonDraftInfo.keyCount}
                                  </strong>
                                </span>
                                {jsonDraftInfo.baseUrl ? (
                                  <span className="truncate">
                                    Base URL:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.baseUrl}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.projectId ? (
                                  <span>
                                    Project:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.projectId}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.accountId ? (
                                  <span>
                                    Account:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.accountId}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.resourceName ? (
                                  <span>
                                    Resource:{' '}
                                    <code className="font-mono text-[var(--text-primary)]">
                                      {jsonDraftInfo.resourceName}
                                    </code>
                                  </span>
                                ) : null}
                                {jsonDraftInfo.modelsCount > 0 ? (
                                  <span>
                                    Models:{' '}
                                    <strong className="text-[var(--text-primary)]">
                                      {jsonDraftInfo.modelsCount}
                                    </strong>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* Security Hint + Submit & Connect+Test Buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <p
                          id="prov-json-safe-hint"
                          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
                        >
                          <Lock className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
                          <span>{t('providers.json.privateKeySafe')}</span>
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(ev) => handleJsonConnect(ev, { autoTest: true })}
                            disabled={jsonConnecting}
                            className="r-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
                          >
                            {jsonConnecting && jsonTestingAction ? (
                              <RefreshCw
                                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none text-[#E56A4A]"
                                aria-hidden="true"
                              />
                            ) : (
                              <Zap className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                            )}
                            {jsonConnecting && jsonTestingAction
                              ? t('providers.json.submittingAndTesting')
                              : t('providers.json.submitAndTest')}
                          </button>

                          <button
                            type="submit"
                            disabled={jsonConnecting}
                            className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
                          >
                            {jsonConnecting && !jsonTestingAction ? (
                              <RefreshCw
                                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                            ) : (
                              <FileJson2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {jsonConnecting && !jsonTestingAction
                              ? t('providers.json.submitting')
                              : t('providers.json.submit')}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                ) : null}

                {/* MODE 3: Web chính chủ (Google OAuth 2.0 + PKCE for Gemini, OpenRouter OAuth PKCE & Guided Official Portal Login) */}
                {connectionMode === 'web' ? (
                  <div
                    role="tabpanel"
                    aria-labelledby="provider-connect-mode-tab-web"
                    className="space-y-4"
                  >
                    {/* Google Gemini Official Google OAuth 2.0 + PKCE Section */}
                    {form.preset === 'gemini' ? (
                      <>
                        {/* Connected Google Account, Quota & Accessible Models Card */}
                        {connectedGoogleKeys.length > 0 ? (
                          <div className="space-y-3 rounded-xl border border-emerald-500/35 bg-emerald-500/8 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/30 bg-[var(--bg-card)]">
                                  <GoogleMark className="h-4 w-4" />
                                </div>
                                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                                  {t('providers.web.googleConnectedHeading')} ({connectedGoogleKeys.length})
                                </h3>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {googleClientStatus.configured ? (
                                  <button
                                    type="button"
                                    onClick={handleOneClickGoogleSignIn}
                                    disabled={startingGoogleOAuth}
                                    className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                                  >
                                    {startingGoogleOAuth ? (
                                      <RefreshCw
                                        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white p-0.5">
                                        <GoogleMark className="h-2.5 w-2.5" />
                                      </span>
                                    )}
                                    + Chọn tài khoản Gmail khác
                                  </button>
                                ) : null}

                                {form.id ? (
                                  <button
                                    type="button"
                                    onClick={handleRefreshGooglePlan}
                                    disabled={refreshingGooglePlan}
                                    className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                                  >
                                    <RefreshCw
                                      className={`h-3.5 w-3.5 text-blue-500 ${
                                        refreshingGooglePlan
                                          ? 'animate-spin motion-reduce:animate-none'
                                          : ''
                                      }`}
                                      aria-hidden="true"
                                    />
                                    {refreshingGooglePlan
                                      ? t('providers.web.googleRefreshingPlan')
                                      : t('providers.web.googleRefreshPlan')}
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            <div className="space-y-2.5">
                              {connectedGoogleKeys.map(({ key: gKey, meta }) => {
                                const modelsCount =
                                  meta.modelsCount !== null
                                    ? meta.modelsCount
                                    : form.models.length;
                                const previewModels =
                                  meta.topModels && meta.topModels.length > 0
                                    ? meta.topModels.slice(0, 8)
                                    : (form.models || []).slice(0, 8);
                                const isCooling =
                                  Boolean(gKey.cooldownUntil) && gKey.cooldownUntil > nowMs;
                                const coolSec = isCooling
                                  ? Math.max(1, Math.ceil((gKey.cooldownUntil - nowMs) / 1000))
                                  : 0;
                                const qSum = meta.quotaSummary || {};
                                return (
                                  <div
                                    key={gKey.localId}
                                    className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2.5">
                                      <div className="min-w-0 space-y-0.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <BadgeCheck
                                            className="h-4 w-4 shrink-0 text-blue-500"
                                            aria-hidden="true"
                                          />
                                          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                            {meta.name || meta.email || gKey.label || 'Google Account'}
                                          </span>
                                          {gKey.enabled === false ? (
                                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                                              {t('common.disabled')}
                                            </span>
                                          ) : isCooling ? (
                                            <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-400">
                                              429 Cooldown {coolSec}s
                                            </span>
                                          ) : (
                                            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                                              Sẵn sàng
                                            </span>
                                          )}
                                        </div>
                                        {meta.email ? (
                                          <div className="pl-6 font-mono text-[11.5px] text-[var(--text-secondary)]">
                                            {meta.email}
                                          </div>
                                        ) : null}
                                      </div>

                                      <span
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getGoogleTierPillClass(
                                          meta
                                        )}`}
                                      >
                                        <span
                                          className={`h-2 w-2 rounded-full ${getGoogleTierDotClass(
                                            meta
                                          )}`}
                                          aria-hidden="true"
                                        />
                                        {meta.tierLabel}
                                      </span>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-3">
                                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-2">
                                        <div className="text-[10px] font-medium text-[var(--text-muted)]">
                                          {t('providers.web.googleProjectLabel')}
                                        </div>
                                        <div className="mt-0.5 truncate font-mono text-[11.5px] font-semibold text-[var(--text-primary)]">
                                          {meta.projectId || '—'}
                                        </div>
                                      </div>
                                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-2">
                                        <div className="text-[10px] font-medium text-[var(--text-muted)]">
                                          {t('providers.web.googleModelsLabel')}
                                        </div>
                                        <div className="mt-0.5 font-mono text-[11.5px] font-semibold text-[var(--text-primary)]">
                                          {modelsCount} {t('common.models')}
                                        </div>
                                      </div>
                                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-2">
                                        <div className="flex items-center justify-between gap-1 text-[10px] font-medium text-[var(--text-muted)]">
                                          <span>Quota gói Gemini API</span>
                                          <Link
                                            to="/quota"
                                            className="font-semibold text-[#E56A4A] hover:underline"
                                          >
                                            Chi tiết →
                                          </Link>
                                        </div>
                                        <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-emerald-500">
                                          {qSum.rpmEstimate || '5–15 RPM'} · {qSum.rpdEstimate || '1,500 RPD'}
                                        </div>
                                      </div>
                                    </div>

                                    {qSum.note ? (
                                      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                                        {qSum.note}
                                      </p>
                                    ) : null}

                                    {previewModels.length > 0 ? (
                                      <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2.5">
                                        <div className="text-[10.5px] font-medium text-[var(--text-secondary)]">
                                          Model Gemini khả dụng (bấm để sao chép ID dùng cho Cline / Cursor):
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                          {previewModels.map((modelId) => {
                                            const fullId = `${form.slug || 'gemini'}/${modelId}`;
                                            return (
                                              <button
                                                key={modelId}
                                                type="button"
                                                onClick={() => {
                                                  navigator.clipboard?.writeText(fullId);
                                                  toast.success(`Đã sao chép ${fullId}`);
                                                }}
                                                title={`Sao chép ${fullId}`}
                                                className="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-primary)] transition-colors hover:border-[#E56A4A] hover:text-[#E56A4A]"
                                              >
                                                <span>{fullId}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* Primary Official Google OAuth 2.0 + PKCE Card */}
                        <div className="space-y-4 rounded-xl border border-blue-500/35 bg-blue-500/8 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <GoogleMark className="h-4 w-4 shrink-0" />
                              <h3
                                id="google-oauth-form-heading"
                                className="text-xs font-semibold text-[var(--text-primary)]"
                              >
                                {connectedGoogleKeys.length > 0
                                  ? t('providers.web.googleAddAnother')
                                  : t('providers.web.googleTitle')}
                              </h3>
                            </div>
                            <span className="rounded-full border border-blue-500/35 bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
                              {t('providers.web.googleBadge')}
                            </span>
                          </div>

                          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.googleDesc')}
                          </p>

                          {/* 1-Click Account Chooser Banner (shown immediately once OAuth Client is saved or configured via .env) */}
                          {googleClientStatus.configured ? (
                            <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-[var(--bg-card)] p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                                    <CheckCircle2
                                      className="h-4 w-4 shrink-0 text-emerald-500"
                                      aria-hidden="true"
                                    />
                                    <span>Google OAuth Client đã sẵn sàng — Đăng nhập 1-Click</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[11px] text-[var(--text-secondary)]">
                                    <span>
                                      Nguồn:{' '}
                                      <code className="font-mono text-emerald-500">
                                        {googleClientStatus.source === 'env'
                                          ? 'Environment (.env)'
                                          : 'Đã lưu trên hệ thống'}
                                      </code>
                                    </span>
                                    {googleClientStatus.clientIdPreview ? (
                                      <span>
                                        Client ID:{' '}
                                        <code className="font-mono text-[var(--text-primary)]">
                                          {googleClientStatus.clientIdPreview}
                                        </code>
                                      </span>
                                    ) : null}
                                    {googleClientStatus.projectId ? (
                                      <span>
                                        Project:{' '}
                                        <code className="font-mono text-[var(--text-primary)]">
                                          {googleClientStatus.projectId}
                                        </code>
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={handleOneClickGoogleSignIn}
                                  disabled={startingGoogleOAuth}
                                  className="r-btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs shadow-xs"
                                >
                                  {startingGoogleOAuth ? (
                                    <RefreshCw
                                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white p-0.5">
                                      <GoogleMark className="h-3 w-3" />
                                    </span>
                                  )}
                                  {startingGoogleOAuth
                                    ? t('providers.web.googleStarting')
                                    : 'Đăng nhập Google (Chọn tài khoản Gmail)'}
                                </button>
                              </div>
                              <p className="pl-6 text-[11px] leading-relaxed text-[var(--text-muted)]">
                                Nhấn nút trên để chuyển thẳng sang <code>accounts.google.com</code> chọn tài khoản Gmail, cấp quyền và tự động hiển thị Email, gói <strong>Free Tier / Pay-as-you-go</strong>, hạn mức Quota &amp; danh sách Model Gemini khả dụng.
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                              <strong className="text-amber-400">Chỉ cần cấu hình 1 lần duy nhất:</strong>{' '}
                              Tải tệp <code>client_secret_*.json</code> từ Google Cloud của bạn (hoặc đặt biến môi trường <code>GOOGLE_OAUTH_CLIENT_ID</code> &amp; <code>GOOGLE_OAUTH_CLIENT_SECRET</code>). Sau lần đầu tiên, 001Router sẽ tự lưu cấu hình để mọi lần sau bạn bấm <strong>1-Click → chọn tài khoản Gmail</strong> ngay lập tức.
                            </div>
                          )}

                          {/* Collapsible / Always-open Google Cloud OAuth Client Setup */}
                          <details
                            open={!googleClientStatus.configured}
                            className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 p-3"
                          >
                            <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--text-primary)]">
                              {googleClientStatus.configured
                                ? 'Cấu hình / Đổi Google Cloud OAuth Client (client_secret_*.json)'
                                : 'Thiết lập Google Cloud OAuth Client (1 lần duy nhất)'}
                            </summary>

                            <div className="mt-3 space-y-4">
                              {/* 3-Step Visual Setup Guide for Google OAuth 2.0 + Plan Detection */}
                              <ol className="grid gap-2 sm:grid-cols-3">
                                <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                                  <div className="text-[11px] font-semibold text-blue-500">
                                    1. Tạo OAuth Client (Web)
                                  </div>
                                  <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
                                    Mở Google Cloud Credentials, tạo <strong>OAuth Client ID</strong> loại{' '}
                                    <code>Web application</code> và dán Redirect URI bên dưới.
                                  </p>
                                </li>
                                <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                                  <div className="text-[11px] font-semibold text-blue-500">
                                    2. Tải client_secret_*.json
                                  </div>
                                  <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
                                    Tải tệp JSON về và kéo thả vào ô dưới — hệ thống tự lưu lại cho lần sau.
                                  </p>
                                </li>
                                <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                                  <div className="text-[11px] font-semibold text-blue-500">
                                    3. Chọn Gmail &amp; Hiện Quota
                                  </div>
                                  <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
                                    Mở <code>accounts.google.com</code> chọn tài khoản Gmail → tự hiển thị gói{' '}
                                    <strong>Free Tier / Pay-as-you-go</strong>, Quota và Model Gemini.
                                  </p>
                                </li>
                              </ol>

                              {/* Authorized Redirect URI Helper + Direct GCP Console Credentials Link */}
                              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                                    {t('providers.web.googleRedirectLabel')}
                                  </span>
                                  <a
                                    href={GCP_OAUTH_CREDENTIALS_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-500 hover:underline"
                                  >
                                    <span>{t('providers.web.googleConsoleLink')}</span>
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                  </a>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-2.5 py-1.5">
                                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-primary)]">
                                    {googleRedirectUri}
                                  </code>
                                  <CopyButton
                                    value={googleRedirectUri}
                                    size="xs"
                                    toastMessage={`Copied ${googleRedirectUri}`}
                                  />
                                </div>

                                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                                  {t('providers.web.googleRedirectHint')}
                                </p>
                              </div>

                              {/* Upload client_secret_*.json Dropzone + Accessible File Input */}
                              <div
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  if (!googleJsonDragActive) setGoogleJsonDragActive(true);
                                }}
                                onDragLeave={() => setGoogleJsonDragActive(false)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setGoogleJsonDragActive(false);
                                  const dropped = e.dataTransfer?.files?.[0];
                                  if (dropped) handleGoogleClientJsonFile(dropped);
                                }}
                                className={`flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-dashed px-3.5 py-2.5 transition-colors ${
                                  googleJsonDragActive
                                    ? 'border-blue-500 bg-blue-500/12'
                                    : 'border-[var(--border-strong)] bg-[var(--bg-card)]'
                                }`}
                              >
                                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                                  <input
                                    ref={googleFileInputRef}
                                    id="prov-google-client-json"
                                    name="google_client_secret_file"
                                    type="file"
                                    accept=".json,application/json"
                                    className="visually-hidden peer"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleGoogleClientJsonFile(file);
                                    }}
                                  />
                                  <label
                                    htmlFor="prov-google-client-json"
                                    className="r-btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#E56A4A]"
                                  >
                                    <Upload className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                                    {t('providers.web.googleUploadBtn')}
                                  </label>
                                  {googleJsonFileName ? (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-500">
                                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      <span>
                                        {t('providers.web.googleUploadLoaded')} {googleJsonFileName}
                                        {googleJsonClientType ? ` (${googleJsonClientType})` : ''}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-[var(--text-muted)]">
                                      {t('providers.web.googleUploadHint')}
                                    </span>
                                  )}
                                </div>

                                {googleJsonFileName ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setGoogleClientSecretJson(null);
                                      setGoogleJsonFileName('');
                                      setGoogleJsonClientType('');
                                      setGoogleJsonError('');
                                      if (googleFileInputRef.current) {
                                        googleFileInputRef.current.value = '';
                                      }
                                    }}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-red-500"
                                  >
                                    {t('providers.json.clear')}
                                  </button>
                                ) : null}
                              </div>

                              {googleJsonError ? (
                                <p
                                  role="alert"
                                  className="flex items-center gap-1.5 text-xs text-red-500"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{googleJsonError}</span>
                                </p>
                              ) : null}

                              {/* Direct Client ID, Client Secret, Optional GCP Project ID Form */}
                              <form
                                id="provider-google-oauth-form"
                                aria-labelledby="google-oauth-form-heading"
                                onSubmit={handleStartGoogleOAuth}
                                noValidate
                                className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5"
                              >
                                <p className="text-[11px] text-[var(--text-muted)]">
                                  {t('providers.web.googleRequiredNote')}
                                </p>

                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <label
                                      htmlFor="prov-google-client-id"
                                      className="block text-xs font-medium text-[var(--text-secondary)]"
                                    >
                                      {t('providers.web.googleClientIdLabel')}{' '}
                                      <span aria-hidden="true" className="text-[#E56A4A]">
                                        *
                                      </span>
                                    </label>
                                    <input
                                      ref={googleClientIdRef}
                                      id="prov-google-client-id"
                                      name="google_client_id"
                                      type="text"
                                      required
                                      value={googleClientId}
                                      onChange={(e) => {
                                        setGoogleClientId(e.target.value);
                                        if (googleClientIdError) setGoogleClientIdError('');
                                        if (googleClientSecretJson) setGoogleClientSecretJson(null);
                                      }}
                                      onBlur={() => {
                                        if (googleClientId && !googleClientId.trim()) {
                                          setGoogleClientIdError(
                                            t('providers.web.googleClientIdRequired')
                                          );
                                        }
                                      }}
                                      placeholder={t('providers.web.googleClientIdPlaceholder')}
                                      autoComplete="off"
                                      autoCorrect="off"
                                      autoCapitalize="none"
                                      spellCheck={false}
                                      aria-invalid={googleClientIdError ? 'true' : 'false'}
                                      aria-describedby={
                                        googleClientIdError ? 'prov-google-client-id-error' : undefined
                                      }
                                      className={`field-input mt-1 w-full px-3 py-2 font-mono text-xs ${
                                        googleClientIdError ? 'border-red-500/70' : ''
                                      }`}
                                    />
                                    {googleClientIdError ? (
                                      <p
                                        id="prov-google-client-id-error"
                                        className="mt-1 flex items-center gap-1 text-[11px] text-red-500"
                                      >
                                        <AlertTriangle
                                          className="h-3 w-3 shrink-0"
                                          aria-hidden="true"
                                        />
                                        <span>{googleClientIdError}</span>
                                      </p>
                                    ) : null}
                                  </div>

                                  <div>
                                    <label
                                      htmlFor="prov-google-client-secret"
                                      className="block text-xs font-medium text-[var(--text-secondary)]"
                                    >
                                      {t('providers.web.googleClientSecretLabel')}{' '}
                                      <span aria-hidden="true" className="text-[#E56A4A]">
                                        *
                                      </span>
                                    </label>
                                    <div className="relative mt-1">
                                      <input
                                        ref={googleClientSecretRef}
                                        id="prov-google-client-secret"
                                        name="google_client_secret"
                                        type={googleSecretVisible ? 'text' : 'password'}
                                        required
                                        value={googleClientSecret}
                                        onChange={(e) => {
                                          setGoogleClientSecret(e.target.value);
                                          if (googleClientSecretError) setGoogleClientSecretError('');
                                          if (googleClientSecretJson) setGoogleClientSecretJson(null);
                                        }}
                                        onBlur={() => {
                                          if (googleClientSecret && !googleClientSecret.trim()) {
                                            setGoogleClientSecretError(
                                              t('providers.web.googleClientSecretRequired')
                                            );
                                          }
                                        }}
                                        placeholder={t('providers.web.googleClientSecretPlaceholder')}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        aria-invalid={googleClientSecretError ? 'true' : 'false'}
                                        aria-describedby={
                                          googleClientSecretError
                                            ? 'prov-google-client-secret-error'
                                            : undefined
                                        }
                                        className={`field-input w-full py-2 pr-9 pl-3 font-mono text-xs ${
                                          googleClientSecretError ? 'border-red-500/70' : ''
                                        }`}
                                      />
                                      <button
                                        type="button"
                                        aria-pressed={googleSecretVisible}
                                        onClick={() => setGoogleSecretVisible((v) => !v)}
                                        aria-label={
                                          googleSecretVisible
                                            ? 'Hide client secret'
                                            : 'Show client secret'
                                        }
                                        className="absolute inset-y-0 right-1.5 my-auto flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                      >
                                        {googleSecretVisible ? (
                                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                        ) : (
                                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                        )}
                                      </button>
                                    </div>
                                    {googleClientSecretError ? (
                                      <p
                                        id="prov-google-client-secret-error"
                                        className="mt-1 flex items-center gap-1 text-[11px] text-red-500"
                                      >
                                        <AlertTriangle
                                          className="h-3 w-3 shrink-0"
                                          aria-hidden="true"
                                        />
                                        <span>{googleClientSecretError}</span>
                                      </p>
                                    ) : null}
                                  </div>

                                  <div className="sm:col-span-2">
                                    <label
                                      htmlFor="prov-google-project-id"
                                      className="block text-xs font-medium text-[var(--text-secondary)]"
                                    >
                                      {t('providers.web.googleProjectIdLabel')}
                                    </label>
                                    <input
                                      id="prov-google-project-id"
                                      name="google_project_id"
                                      type="text"
                                      value={googleProjectId}
                                      onChange={(e) => setGoogleProjectId(e.target.value)}
                                      placeholder={t('providers.web.googleProjectIdPlaceholder')}
                                      autoComplete="off"
                                      autoCorrect="off"
                                      autoCapitalize="none"
                                      spellCheck={false}
                                      className="field-input mt-1 w-full px-3 py-2 font-mono text-xs"
                                    />
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                                    accounts.google.com · OAuth 2.0 + PKCE (S256)
                                  </span>
                                  <button
                                    type="submit"
                                    disabled={startingGoogleOAuth}
                                    className="r-btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs shadow-xs"
                                  >
                                    {startingGoogleOAuth ? (
                                      <RefreshCw
                                        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white p-0.5">
                                        <GoogleMark className="h-3 w-3" />
                                      </span>
                                    )}
                                    {startingGoogleOAuth
                                      ? t('providers.web.googleStarting')
                                      : 'Lưu Client & Chọn tài khoản Gmail'}
                                  </button>
                                </div>
                              </form>
                            </div>
                          </details>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                          <span>{t('providers.web.googleAiStudioDivider')}</span>
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        </div>
                      </>
                    ) : null}

                    {/* OpenRouter 1-Click Official OAuth PKCE Card */}
                    {form.preset === 'openrouter' ? (
                      <>
                        <div className="space-y-3 rounded-xl border border-indigo-500/35 bg-indigo-500/8 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <ShieldCheck
                                className="h-4 w-4 text-indigo-500"
                                aria-hidden="true"
                              />
                              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                                {t('providers.web.openrouterTitle')}
                              </h3>
                            </div>
                            <span className="rounded-full border border-indigo-500/35 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-500">
                              {t('providers.web.openrouterBadge')}
                            </span>
                          </div>

                          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.openrouterDesc')}
                          </p>

                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            <button
                              type="button"
                              onClick={handleStartOpenRouterOAuth}
                              disabled={startingOAuth}
                              className="r-btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs shadow-xs"
                            >
                              {startingOAuth ? (
                                <RefreshCw
                                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {startingOAuth
                                ? t('providers.web.openrouterStarting')
                                : t('providers.web.openrouterBtn')}
                            </button>
                            <span className="font-mono text-[11px] text-[var(--text-muted)]">
                              openrouter.ai/auth
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                          <span>{t('providers.web.orManualDivider')}</span>
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        </div>
                      </>
                    ) : null}

                    {/* Official Device Authorization Flow (Kilo Code & Nous Research) */}
                    {(form.preset === 'kilocode' || form.preset === 'nous') ? (
                      <>
                        <div className="space-y-3 rounded-xl border border-orange-500/35 bg-orange-500/8 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <KeyRound className="h-4 w-4 text-orange-400" aria-hidden="true" />
                              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                                {t('providers.web.deviceTitle')} · {form.preset === 'kilocode' ? 'Kilo Code' : 'Nous Research'}
                              </h3>
                            </div>
                            <span className="rounded-full border border-orange-500/35 bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
                              {t('providers.badge.deviceCode')}
                            </span>
                          </div>

                          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.deviceDesc')}
                          </p>

                          {!deviceFlow ? (
                            <button
                              type="button"
                              onClick={() => handleStartDeviceFlow(form.preset)}
                              disabled={deviceStarting}
                              className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
                            >
                              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                              {deviceStarting ? t('providers.web.deviceStarting') : t('providers.web.deviceStartBtn')}
                            </button>
                          ) : (
                            <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-[11px] text-[var(--text-muted)]">
                                    {t('providers.web.deviceCodeLabel')}
                                  </div>
                                  <div className="mt-0.5 font-mono text-lg font-bold tracking-wider text-[#E56A4A]">
                                    {deviceFlow.userCode}
                                  </div>
                                </div>
                                <CopyButton value={deviceFlow.userCode} toastMessage="Copied code" />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={deviceFlow.verificationUri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                  {t('providers.web.deviceOpenVerify')}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => pollDeviceFlowNow(deviceFlow)}
                                  disabled={devicePolling}
                                  className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                                >
                                  <RefreshCw className={`h-3 w-3 ${devicePolling ? 'animate-spin' : ''}`} aria-hidden="true" />
                                  {t('providers.web.devicePollNow')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeviceFlow(null)}
                                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2"
                                >
                                  {t('providers.web.deviceCancel')}
                                </button>
                              </div>
                              <div className="text-[11px] text-amber-400">
                                {t('providers.web.devicePolling')}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                          <span>{t('providers.web.orManualDivider')}</span>
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        </div>
                      </>
                    ) : null}

                    {/* GitLab Duo Official OAuth 2.0 + PKCE Card */}
                    {form.preset === 'gitlab' ? (
                      <>
                        <div className="space-y-3 rounded-xl border border-orange-500/30 bg-orange-500/6 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-[#FC6D26]" aria-hidden="true" />
                              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                                {t('providers.web.gitlabTitle')}
                              </h3>
                            </div>
                            <span className="rounded-full border border-violet-500/35 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                              {t('providers.badge.oauth2')}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.gitlabDesc')}
                          </p>
                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">
                                {t('providers.web.gitlabInstanceUrl')}
                              </label>
                              <input
                                type="url"
                                value={oauth2BaseUrl}
                                onChange={(e) => setOauth2BaseUrl(e.target.value)}
                                placeholder="https://gitlab.com"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">
                                OAuth Application Client ID *
                              </label>
                              <input
                                type="text"
                                value={oauth2ClientId}
                                onChange={(e) => setOauth2ClientId(e.target.value)}
                                placeholder="GitLab OAuth Application ID"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">
                                Client Secret (optional for confidential apps)
                              </label>
                              <input
                                type="password"
                                value={oauth2ClientSecret}
                                onChange={(e) => setOauth2ClientSecret(e.target.value)}
                                placeholder="gloas-..."
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">
                                Connection Label (optional)
                              </label>
                              <input
                                type="text"
                                value={oauth2Label}
                                onChange={(e) => setOauth2Label(e.target.value)}
                                placeholder="GitLab Duo Work"
                                className="field-input mt-1 w-full px-2.5 py-1.5 text-xs"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                            <span>Redirect URI:</span>
                            <code className="rounded bg-[var(--bg-card)] px-2 py-0.5 font-mono">
                              {`${window.location.origin}/providers?oauth=gitlab`}
                            </code>
                            <CopyButton value={`${window.location.origin}/providers?oauth=gitlab`} toastMessage="Copied Redirect URI" />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleStartGenericOAuth('gitlab')}
                              disabled={oauth2Busy}
                              className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              {t('providers.web.oauthStartBtn')}
                            </button>
                          </div>

                          {oauth2StartedAuthUrl ? (
                            <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
                              <div className="font-medium text-[var(--text-primary)]">
                                {t('providers.web.oauthPasteTitle')}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <input
                                  type="text"
                                  value={oauth2PastedCallback}
                                  onChange={(e) => setOauth2PastedCallback(e.target.value)}
                                  placeholder={t('providers.web.oauthPastePlaceholder')}
                                  className="field-input min-w-[220px] flex-1 px-2.5 py-1.5 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCompletePastedOAuth('gitlab')}
                                  disabled={oauth2Busy}
                                  className="r-btn-primary px-3 py-1.5 text-xs"
                                >
                                  {t('providers.web.oauthCompleteBtn')}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                          <span>{t('providers.web.orManualDivider')}</span>
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        </div>
                      </>
                    ) : null}

                    {/* Custom Provider BYO OAuth 2.0 (PKCE S256 or RFC 8628 Device Code) */}
                    {(form.preset === 'custom' || form.preset === 'custom-openai' || form.preset === 'custom-anthropic') ? (
                      <>
                        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-500/6 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4 text-violet-400" aria-hidden="true" />
                              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                                {t('providers.web.customOAuthTitle')}
                              </h3>
                            </div>
                            <div className="flex gap-1 rounded-lg bg-[var(--bg-card)] p-0.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() => setOauth2FlowTab('pkce')}
                                className={`rounded-md px-2 py-1 font-medium ${oauth2FlowTab === 'pkce' ? 'bg-[#E56A4A] text-white' : 'text-[var(--text-secondary)]'}`}
                              >
                                {t('providers.web.oauthModePkce')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setOauth2FlowTab('device')}
                                className={`rounded-md px-2 py-1 font-medium ${oauth2FlowTab === 'device' ? 'bg-[#E56A4A] text-white' : 'text-[var(--text-secondary)]'}`}
                              >
                                {t('providers.web.oauthModeDevice')}
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-[var(--text-secondary)]">
                            {t('providers.web.customOAuthDesc')}
                          </p>

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            {oauth2FlowTab === 'pkce' ? (
                              <div>
                                <label className="block text-[11px] text-[var(--text-secondary)]">Authorize URL *</label>
                                <input
                                  type="url"
                                  value={oauth2AuthUrl}
                                  onChange={(e) => setOauth2AuthUrl(e.target.value)}
                                  placeholder="https://auth.example.com/oauth/authorize"
                                  className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                                />
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[11px] text-[var(--text-secondary)]">Device Code URL *</label>
                                <input
                                  type="url"
                                  value={oauth2DeviceUrl}
                                  onChange={(e) => setOauth2DeviceUrl(e.target.value)}
                                  placeholder="https://auth.example.com/oauth/device/code"
                                  className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                                />
                              </div>
                            )}
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">Token URL *</label>
                              <input
                                type="url"
                                value={oauth2TokenUrl}
                                onChange={(e) => setOauth2TokenUrl(e.target.value)}
                                placeholder="https://auth.example.com/oauth/token"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">Client ID *</label>
                              <input
                                type="text"
                                value={oauth2ClientId}
                                onChange={(e) => setOauth2ClientId(e.target.value)}
                                placeholder="my-oauth-client-id"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">Client Secret (optional)</label>
                              <input
                                type="password"
                                value={oauth2ClientSecret}
                                onChange={(e) => setOauth2ClientSecret(e.target.value)}
                                placeholder="Optional secret"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">Scopes (optional)</label>
                              <input
                                type="text"
                                value={oauth2Scope}
                                onChange={(e) => setOauth2Scope(e.target.value)}
                                placeholder="openid profile api"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-[var(--text-secondary)]">Userinfo URL (optional)</label>
                              <input
                                type="url"
                                value={oauth2UserinfoUrl}
                                onChange={(e) => setOauth2UserinfoUrl(e.target.value)}
                                placeholder="https://auth.example.com/userinfo"
                                className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                              />
                            </div>
                          </div>

                          {oauth2FlowTab === 'pkce' ? (
                            <div className="space-y-2.5">
                              <button
                                type="button"
                                onClick={() => handleStartGenericOAuth('custom_oauth')}
                                disabled={oauth2Busy}
                                className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                {t('providers.web.oauthStartBtn')}
                              </button>
                              {oauth2StartedAuthUrl ? (
                                <div className="flex flex-wrap gap-2">
                                  <input
                                    type="text"
                                    value={oauth2PastedCallback}
                                    onChange={(e) => setOauth2PastedCallback(e.target.value)}
                                    placeholder={t('providers.web.oauthPastePlaceholder')}
                                    className="field-input min-w-[220px] flex-1 px-2.5 py-1.5 font-mono text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleCompletePastedOAuth('custom_oauth')}
                                    disabled={oauth2Busy}
                                    className="r-btn-primary px-3 py-1.5 text-xs"
                                  >
                                    {t('providers.web.oauthCompleteBtn')}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div>
                              {!deviceFlow ? (
                                <button
                                  type="button"
                                  onClick={() => handleStartDeviceFlow('custom_oauth')}
                                  disabled={deviceStarting}
                                  className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
                                >
                                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                                  {deviceStarting ? t('providers.web.deviceStarting') : t('providers.web.deviceStartBtn')}
                                </button>
                              ) : (
                                <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                                  <div className="font-mono text-base font-bold text-[#E56A4A]">
                                    {deviceFlow.userCode}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <a
                                      href={deviceFlow.verificationUri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                      {t('providers.web.deviceOpenVerify')}
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => pollDeviceFlowNow(deviceFlow)}
                                      disabled={devicePolling}
                                      className="r-btn-secondary px-3 py-1.5 text-xs"
                                    >
                                      {t('providers.web.devicePollNow')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeviceFlow(null)}
                                      className="text-xs text-[var(--text-muted)] px-2"
                                    >
                                      {t('providers.web.deviceCancel')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                          <span>{t('providers.web.orManualDivider')}</span>
                          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                        </div>
                      </>
                    ) : null}

                    {/* Official Developer Portal Guided 3-Step Login & Quick Connect */}
                    <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                            {t('providers.web.portalTitle')} ·{' '}
                            {form.name || activePresetMeta?.name || 'Provider'}
                          </h3>
                        </div>

                        {portalUrl ? (
                          <a
                            href={portalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs shadow-xs"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{t('providers.web.openPortalBtn')}</span>
                            {portalHost ? (
                              <span className="hidden rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
                                {portalHost}
                              </span>
                            ) : null}
                          </a>
                        ) : null}
                      </div>

                      {!portalUrl ? (
                        <p className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {t('providers.web.noPortalUrl')}
                        </p>
                      ) : null}

                      {/* 3-Step Visual Guide */}
                      <ol className="grid gap-2.5 sm:grid-cols-3">
                        <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] font-semibold text-[#E56A4A]">
                            {t('providers.web.step1Title')}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.step1Desc')}
                          </p>
                        </li>
                        <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] font-semibold text-[#E56A4A]">
                            {t('providers.web.step2Title')}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.step2Desc')}
                          </p>
                        </li>
                        <li className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] font-semibold text-[#E56A4A]">
                            {t('providers.web.step3Title')}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                            {t('providers.web.step3Desc')}
                          </p>
                        </li>
                      </ol>

                      {/* Focused Token Paste & One-Click Test + Save Form */}
                      <form
                        id="provider-web-form"
                        onSubmit={handleWebQuickConnect}
                        noValidate
                        className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5"
                      >
                        {form.preset === 'custom' &&
                        (!form.name.trim() || !form.baseUrl.trim()) ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor="prov-web-custom-name"
                                className="block text-xs font-medium text-[var(--text-secondary)]"
                              >
                                Display Name
                              </label>
                              <input
                                id="prov-web-custom-name"
                                type="text"
                                value={form.name}
                                onChange={(e) => {
                                  const nextName = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    name: nextName,
                                    slug:
                                      !prev.id && !slugManuallyEdited
                                        ? slugify(nextName)
                                        : prev.slug,
                                  }));
                                }}
                                placeholder="e.g. My Custom Gateway"
                                className="field-input mt-1 w-full px-3 py-1.5 text-xs"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="prov-web-custom-url"
                                className="block text-xs font-medium text-[var(--text-secondary)]"
                              >
                                Official Base URL
                              </label>
                              <input
                                id="prov-web-custom-url"
                                type="url"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={form.baseUrl}
                                onChange={(e) =>
                                  setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                                }
                                placeholder="https://api.example.com/v1"
                                className="field-input mt-1 w-full px-3 py-1.5 font-mono text-xs"
                              />
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <label
                            htmlFor="prov-web-token"
                            className="block text-xs font-semibold text-[var(--text-primary)]"
                          >
                            {t('providers.web.pasteLabel')}
                          </label>
                          <div className="relative mt-1.5">
                            <input
                              ref={webTokenInputRef}
                              id="prov-web-token"
                              name="portal_token"
                              type={webTokenVisible ? 'text' : 'password'}
                              value={webToken}
                              onChange={(e) => {
                                setWebToken(e.target.value);
                                if (webTokenError) setWebTokenError('');
                              }}
                              placeholder={t('providers.web.pastePlaceholder')}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              aria-invalid={webTokenError ? 'true' : 'false'}
                              aria-describedby={webTokenError ? 'prov-web-token-error' : undefined}
                              className={`field-input w-full py-2 pr-10 pl-3 font-mono text-xs ${
                                webTokenError ? 'border-red-500/70' : ''
                              }`}
                            />
                            <button
                              type="button"
                              aria-pressed={webTokenVisible}
                              onClick={() => setWebTokenVisible((v) => !v)}
                              aria-label={webTokenVisible ? 'Hide token' : 'Show token'}
                              className="absolute inset-y-0 right-1.5 my-auto flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              {webTokenVisible ? (
                                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                          {webTokenError ? (
                            <p
                              id="prov-web-token-error"
                              className="mt-1.5 flex items-center gap-1.5 text-xs text-red-500"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>{webTokenError}</span>
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <div className="min-w-[180px] flex-1">
                            <label
                              htmlFor="prov-web-label"
                              className="block text-[11px] font-medium text-[var(--text-secondary)]"
                            >
                              {t('providers.web.keyLabel')}
                            </label>
                            <input
                              id="prov-web-label"
                              type="text"
                              value={webTokenLabel}
                              onChange={(e) => setWebTokenLabel(e.target.value)}
                              placeholder={t('providers.web.keyLabelPlaceholder')}
                              className="field-input mt-1 w-full px-2.5 py-1.5 text-xs"
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={webConnecting}
                            className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs shadow-xs"
                          >
                            {webConnecting ? (
                              <RefreshCw
                                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                            ) : (
                              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {webConnecting
                              ? t('providers.web.testingAndConnecting')
                              : t('providers.web.testAndConnect')}
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Concise ToS-Safe Security Callout */}
                    <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-3 text-xs">
                      <ShieldCheck
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                      <div className="space-y-0.5">
                        <div className="font-semibold text-emerald-500">
                          {form.preset === 'gemini'
                            ? t('providers.web.googleTosTitle')
                            : t('providers.web.tosTitle')}
                        </div>
                        <p className="leading-relaxed text-[var(--text-secondary)]">
                          {form.preset === 'gemini'
                            ? t('providers.web.googleTosBody')
                            : t('providers.web.tosBody')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Rich Model Catalog & Custom Model Section (shown on API Key tab & dedicated Models tab) */}
            {modalTab === 'models' || (modalTab === 'connection' && connectionMode === 'api') ? (
              <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Cpu className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                    <span>
                      Models Catalog ({modalModelCatalog.length} models · {form.models.length}{' '}
                      active routing IDs)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {modalTab !== 'models' ? (
                      <button
                        type="button"
                        onClick={() => setModalTab('models')}
                        className="text-xs font-medium text-[#E56A4A] hover:underline"
                      >
                        View Full Table →
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleModalFetchModels}
                      disabled={modalFetching || saving}
                      className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
                    >
                      <Download className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                      {modalFetching ? t('providers.fetching') : t('providers.fetchModels')}
                    </button>
                  </div>
                </div>

                {/* Add Custom Model Input + Search */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddModelChip();
                        }
                      }}
                      placeholder="+ Add custom model ID (comma separated)…"
                      className="field-input flex-1 px-3 py-1.5 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddModelChip}
                      className="r-btn-secondary px-3 py-1.5 text-xs"
                    >
                      + Add
                    </button>
                  </div>

                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Filter provider models by name, ID, kind…"
                      className="field-input w-full py-1.5 pr-3 pl-8 text-xs"
                    />
                  </div>
                </div>

                {/* Full Model Catalog Table */}
                {modalModelCatalog.length > 0 ? (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Provider Models Catalog"
                    className="responsive-table-wrapper max-h-72"
                  >
                    <table className="responsive-table">
                      <thead>
                        <tr>
                          <th>Model Name &amp; Routing ID</th>
                          <th>Kind</th>
                          <th>Context</th>
                          <th>Pricing / 1M</th>
                          <th>Capabilities</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalModelCatalog.map((m) => {
                          const slugPrefix = form.slug || activePresetMeta?.preset || 'provider';
                          const fullId = `${slugPrefix}/${m.id}`;
                          const kind = m.kind || 'chat';
                          const isFree =
                            m.free ||
                            (m.inputPrice === 0 && m.outputPrice === 0) ||
                            activePresetMeta?.tier === 'free' ||
                            activePresetMeta?.tier === 'local';
                          const mTest = modelTestResults[m.id];

                          return (
                            <tr key={m.id} className="text-xs">
                              <td>
                                <div className="font-semibold text-[var(--text-primary)]">
                                  {m.name || m.id}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                  <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[#E56A4A]">
                                    {fullId}
                                  </code>
                                  <CopyButton
                                    value={fullId}
                                    size="xs"
                                    iconOnly
                                    label={`Copy ${fullId}`}
                                    toastMessage={`Copied ${fullId}`}
                                  />
                                </div>
                              </td>

                              <td>
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                    KIND_BADGE_STYLE[kind] || KIND_BADGE_STYLE.chat
                                  }`}
                                >
                                  {kind}
                                </span>
                              </td>

                              <td className="font-mono text-[11px] text-[var(--text-secondary)]">
                                {formatContextWindow(m.contextWindow)}
                              </td>

                              <td className="font-mono text-[11px]">
                                {isFree ? (
                                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">
                                    FREE
                                  </span>
                                ) : m.inputPrice !== undefined || m.outputPrice !== undefined ? (
                                  <span className="text-[var(--text-secondary)]">
                                    ${m.inputPrice ?? 0} / ${m.outputPrice ?? 0}
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-muted)]">Official</span>
                                )}
                              </td>

                              <td>
                                <div className="flex flex-wrap items-center gap-1">
                                  {m.vision ? (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                                      <Eye className="h-2.5 w-2.5" aria-hidden="true" />
                                      Vision
                                    </span>
                                  ) : null}
                                  {m.reasoning ? (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                                      <Brain className="h-2.5 w-2.5" aria-hidden="true" />
                                      Reasoning
                                    </span>
                                  ) : null}
                                  {m.tools ? (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                      <Wrench className="h-2.5 w-2.5" aria-hidden="true" />
                                      Tools
                                    </span>
                                  ) : null}
                                  {mTest ? (
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                        mTest.ok
                                          ? 'bg-emerald-500/15 text-emerald-500'
                                          : 'bg-red-500/15 text-red-500'
                                      }`}
                                    >
                                      {mTest.ok ? `${mTest.latencyMs}ms` : 'ERR'}
                                    </span>
                                  ) : null}
                                </div>
                              </td>

                              <td className="text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleModalTestConnection(m.id)}
                                    disabled={testingModelId === m.id || modalTesting}
                                    className="r-btn-secondary px-2 py-1 text-[11px]"
                                    title={`Test ${fullId}`}
                                  >
                                    {testingModelId === m.id ? '…' : 'Test'}
                                  </button>
                                  {form.models.includes(m.id) ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveModelChip(m.id)}
                                      aria-label={`Remove ${m.id}`}
                                      className="rounded p-1 text-[var(--text-muted)] hover:text-red-500"
                                      title="Remove from active list"
                                    >
                                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setForm((prev) =>
                                          prev
                                            ? { ...prev, models: [...prev.models, m.id] }
                                            : prev
                                        )
                                      }
                                      className="rounded bg-[#E56A4A]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#E56A4A] hover:bg-[#E56A4A]/25"
                                    >
                                      + Enable
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-[var(--text-muted)]">
                    No models match filter. Add custom model IDs above or click Fetch Models.
                  </p>
                )}
              </div>
            ) : null}

            {/* Modal Action Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[var(--border-subtle)] pt-4">
              <div className="flex items-center gap-2">
                {modalTab === 'models' || connectionMode === 'api' || form.id ? (
                  <button
                    type="button"
                    onClick={() => handleModalTestConnection()}
                    disabled={
                      modalTesting ||
                      saving ||
                      jsonConnecting ||
                      webConnecting ||
                      startingGoogleOAuth ||
                      refreshingGooglePlan
                    }
                    className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                  >
                    <Activity
                      className={`h-3.5 w-3.5 text-[#E56A4A] ${
                        modalTesting ? 'animate-pulse motion-reduce:animate-none' : ''
                      }`}
                      aria-hidden="true"
                    />
                    {modalTesting ? t('common.testing') : t('providers.testConnection')}
                  </button>
                ) : null}

                {form.id ? (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(form)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('common.delete')}
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModalCleanly}
                  className="r-btn-secondary px-3.5 py-2 text-xs"
                >
                  {t('common.cancel')}
                </button>
                {modalTab === 'models' ? (
                  <button
                    type="button"
                    onClick={handleSaveSubmit}
                    disabled={saving}
                    className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {saving
                      ? t('common.saving')
                      : form.id
                        ? t('providers.saveProvider')
                        : t('providers.connectProvider')}
                  </button>
                ) : connectionMode === 'api' ? (
                  <button
                    type="submit"
                    form="provider-form"
                    disabled={saving}
                    className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {saving
                      ? t('common.saving')
                      : form.id
                        ? t('providers.saveProvider')
                        : t('providers.connectProvider')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete "${deleteTarget?.name || ''}"?`}
        destructive
        busy={deleting}
        confirmLabel={t('common.delete')}
        message={
          <p>
            Removing <strong>{deleteTarget?.name}</strong> (<code>{deleteTarget?.slug}</code>) will
            disconnect its API keys and stop routing requests targeting it.
          </p>
        }
      />
    </div>
  );
}
