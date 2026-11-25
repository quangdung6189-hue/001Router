// 001Router API Client & Utilities (strictly follows d:\001router\app\API.md v1.2)

let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch(path, options = {}) {
  const { skipAuthRedirect = false, headers: customHeaders, body, ...rest } = options;

  // Section 9.8 CSRF hardening: send custom header X-Requested-With: 001router on every call
  const headers = {
    'X-Requested-With': '001router',
    ...(customHeaders || {}),
  };
  let payload = body;

  if (
    body !== undefined &&
    body !== null &&
    typeof body === 'object' &&
    !(body instanceof FormData)
  ) {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    payload = JSON.stringify(body);
  }

  const res = await fetch(path, {
    credentials: 'include',
    headers,
    body: payload,
    ...rest,
  });

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const text = await res.text().catch(() => '');
    data = text ? { message: text } : null;
  }

  if (res.status === 401 && !skipAuthRedirect && typeof unauthorizedHandler === 'function') {
    unauthorizedHandler();
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : null) ||
      data?.message ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }

  return data;
}

export const authApi = {
  me: () => apiFetch('/api/me', { skipAuthRedirect: true }),
  login: (password) =>
    apiFetch('/api/login', {
      method: 'POST',
      body: { password },
      skipAuthRedirect: true,
    }),
  logout: () =>
    apiFetch('/api/logout', {
      method: 'POST',
      skipAuthRedirect: true,
    }),
};

export const providersApi = {
  list: () => apiFetch('/api/providers'),
  get: (id) => apiFetch(`/api/providers/${encodeURIComponent(id)}`),
  create: (data) => apiFetch('/api/providers', { method: 'POST', body: data }),
  update: (id, data) =>
    apiFetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  remove: (id) => apiFetch(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resetCooldown: (id, keyId = '') =>
    apiFetch(`/api/providers/${encodeURIComponent(id)}/reset-cooldown`, {
      method: 'POST',
      body: keyId ? { keyId } : {},
    }),
  addCustomModel: (id, modelId) =>
    apiFetch(`/api/providers/${encodeURIComponent(id)}/custom-models`, {
      method: 'POST',
      body: { modelId },
    }),
  removeCustomModel: (id, modelId) =>
    apiFetch(
      `/api/providers/${encodeURIComponent(id)}/custom-models/${encodeURIComponent(modelId)}`,
      { method: 'DELETE' }
    ),
  test: (id, model) =>
    apiFetch(`/api/providers/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: model ? { model } : {},
    }),
  testAll: (params = {}) =>
    apiFetch('/api/providers/test-all', {
      method: 'POST',
      body: params,
    }),
  fetchModels: (id) =>
    apiFetch(`/api/providers/${encodeURIComponent(id)}/models`, {
      method: 'POST',
    }),
  connectJson: (payload) =>
    apiFetch('/api/providers/connect-json', {
      method: 'POST',
      body: payload,
    }),
  startOpenRouterOAuth: (callbackUrl) =>
    apiFetch('/api/providers/oauth/openrouter/start', {
      method: 'POST',
      body: { callbackUrl },
    }),
  exchangeOpenRouterOAuth: (codeOrPayload, state) =>
    apiFetch('/api/providers/oauth/openrouter/exchange', {
      method: 'POST',
      body:
        codeOrPayload && typeof codeOrPayload === 'object'
          ? codeOrPayload
          : { code: codeOrPayload, state },
    }),
  startAntigravityOAuth: (payload = {}) =>
    apiFetch('/api/providers/oauth/antigravity/start', {
      method: 'POST',
      body: payload,
    }),
  exchangeAntigravityOAuth: (payload = {}) =>
    apiFetch('/api/providers/oauth/antigravity/exchange', {
      method: 'POST',
      body: payload,
    }),
  diagnoseAntigravity: (payload = {}) =>
    apiFetch('/api/providers/oauth/antigravity/diagnose', {
      method: 'POST',
      body: payload,
    }),
  refreshAntigravity: (payload = {}) =>
    apiFetch('/api/providers/oauth/antigravity/refresh', {
      method: 'POST',
      body: payload,
    }),
  startOAuth: (provider, payload) =>
    apiFetch(`/api/providers/oauth/${encodeURIComponent(provider)}/start`, {
      method: 'POST',
      body: payload,
    }),
  exchangeOAuth: (provider, payload) =>
    apiFetch(`/api/providers/oauth/${encodeURIComponent(provider)}/exchange`, {
      method: 'POST',
      body: payload,
    }),
  startDeviceCode: (provider, payload = {}) =>
    apiFetch(`/api/providers/oauth/${encodeURIComponent(provider)}/device-code`, {
      method: 'POST',
      body: payload,
    }),
  pollDeviceCode: (provider, payload) =>
    apiFetch(`/api/providers/oauth/${encodeURIComponent(provider)}/poll`, {
      method: 'POST',
      body: payload,
    }),
  testKey: (providerId, keyId, model) =>
    apiFetch(`/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/test`, {
      method: 'POST',
      body: model ? { model } : {},
    }),
  inspectAccount: (providerId, payload = {}) =>
    apiFetch(`/api/providers/${encodeURIComponent(providerId)}/inspect-account`, {
      method: 'POST',
      body: payload,
    }),
  refreshKey: (providerId, keyId) =>
    apiFetch(`/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/refresh`, {
      method: 'POST',
    }),
};

export const cliToolsApi = {
  statuses: () => apiFetch('/api/cli-tools/statuses'),
  get: (tool) => apiFetch(`/api/cli-tools/${encodeURIComponent(tool)}`),
  apply: (tool, payload) =>
    apiFetch(`/api/cli-tools/${encodeURIComponent(tool)}/apply`, {
      method: 'POST',
      body: payload,
    }),
  reset: (tool) =>
    apiFetch(`/api/cli-tools/${encodeURIComponent(tool)}/reset`, {
      method: 'DELETE',
    }),
};

export const catalogApi = {
  get: () => apiFetch('/api/catalog'),
  models: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', String(params.kind));
    if (params.q) qs.set('q', String(params.q));
    if (params.preset) qs.set('preset', String(params.preset));
    if (params.tier) qs.set('tier', String(params.tier));
    const str = qs.toString();
    return apiFetch(`/api/catalog/models${str ? `?${str}` : ''}`);
  },
  sync: () => apiFetch('/api/catalog/sync', { method: 'POST' }),
  syncStatus: () => apiFetch('/api/catalog/sync-status'),
};

export const combosApi = {
  list: () => apiFetch('/api/combos'),
  create: (data) => apiFetch('/api/combos', { method: 'POST', body: data }),
  update: (id, data) =>
    apiFetch(`/api/combos/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  remove: (id) => apiFetch(`/api/combos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorder: (ids) => apiFetch('/api/combos/reorder', { method: 'POST', body: { ids } }),
  bulkDelete: (ids) => apiFetch('/api/combos/bulk-delete', { method: 'POST', body: { ids } }),
  templates: () => apiFetch('/api/combos/templates'),
  generateTemplate: (id, body = {}) =>
    apiFetch(`/api/combos/templates/${encodeURIComponent(id)}/generate`, {
      method: 'POST',
      body,
    }),
};

export const aliasesApi = {
  list: () => apiFetch('/api/models/alias'),
  set: (alias, model) => apiFetch('/api/models/alias', { method: 'PUT', body: { alias, model } }),
  remove: (alias) =>
    apiFetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: 'DELETE' }),
};

export const disabledModelsApi = {
  list: (provider = '') =>
    apiFetch(
      provider ? `/api/models/disabled?provider=${encodeURIComponent(provider)}` : '/api/models/disabled'
    ),
  disable: (provider, ids) =>
    apiFetch('/api/models/disabled', {
      method: 'POST',
      body: { provider, ids: Array.isArray(ids) ? ids : [ids] },
    }),
  enable: (provider, id) =>
    apiFetch(
      `/api/models/disabled?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
};

export const pricingApi = {
  get: () => apiFetch('/api/pricing'),
  update: (provider, model, rate) =>
    apiFetch('/api/pricing', { method: 'PUT', body: { provider, model, rate } }),
  reset: (provider = '', model = '') => {
    const qs = new URLSearchParams();
    if (provider) qs.set('provider', provider);
    if (model) qs.set('model', model);
    const str = qs.toString();
    return apiFetch(`/api/pricing${str ? `?${str}` : ''}`, { method: 'DELETE' });
  },
};

export const headroomApi = {
  status: (url = '') =>
    apiFetch(
      url ? `/api/headroom/status?url=${encodeURIComponent(url)}` : '/api/headroom/status'
    ),
};

export const skillsApi = {
  list: () => apiFetch('/api/skills'),
  getMarkdown: async (id) => {
    const res = await fetch(`/api/skills/${encodeURIComponent(id)}/SKILL.md`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to fetch skill (${res.status})`);
    return res.text();
  },
};

export const consoleLogsApi = {
  list: (limit = 200) => apiFetch(`/api/console-logs?limit=${encodeURIComponent(limit)}`),
  clear: () => apiFetch('/api/console-logs', { method: 'DELETE' }),
};

export const mediaApi = {
  voices: (apiKey = '') =>
    apiFetch('/v1/audio/voices', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
  embeddings: (payload, apiKey = '') =>
    apiFetch('/v1/embeddings', {
      method: 'POST',
      body: payload,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
  generateImage: (payload, apiKey = '') =>
    apiFetch('/v1/images/generations', {
      method: 'POST',
      body: payload,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
  generateVideo: (payload, apiKey = '') =>
    apiFetch('/v1/videos/generations', {
      method: 'POST',
      body: payload,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
  generateSpeech: async (payload, apiKey = '') => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': '001router',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    const res = await fetch('/v1/audio/speech', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ApiError(txt || `TTS request failed (${res.status})`, res.status);
    }
    return res.blob();
  },
  search: (payload, apiKey = '') =>
    apiFetch('/v1/search', {
      method: 'POST',
      body: payload,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
  webFetch: (payload, apiKey = '') =>
    apiFetch('/v1/web/fetch', {
      method: 'POST',
      body: payload,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      skipAuthRedirect: true,
    }),
};

export const MEDIA_PROVIDER_KINDS = [
  {
    id: 'embedding',
    label: 'Embedding',
    endpoint: 'POST /v1/embeddings',
    desc: 'Vector embeddings via OpenAI, Voyage, Jina, Cohere, Mistral, NVIDIA, Gemini, Self-Hosted.',
    kinds: ['embedding'],
  },
  {
    id: 'image',
    label: 'Text to Image',
    endpoint: 'POST /v1/images/generations',
    desc: 'Image generation via OpenAI, Fal, BFL Flux, Stability, Recraft, Fireworks, Together.',
    kinds: ['image'],
  },
  {
    id: 'video',
    label: 'Video',
    endpoint: 'POST /v1/videos/generations',
    desc: 'Text-to-video generation via Fal, Runway, Luma, Kling, and compatible media endpoints.',
    kinds: ['video'],
  },
  {
    id: 'tts',
    label: 'Text To Speech',
    endpoint: 'POST /v1/audio/speech',
    desc: 'Low-latency speech synthesis via ElevenLabs, Deepgram Aura, OpenAI TTS, Self-Hosted Kokoro/Piper.',
    kinds: ['tts'],
  },
  {
    id: 'stt',
    label: 'Speech To Text',
    endpoint: 'POST /v1/audio/transcriptions',
    desc: 'Audio transcription via Deepgram Nova-3, AssemblyAI, OpenAI Whisper, Groq, Self-Hosted Whisper.',
    kinds: ['stt'],
  },
  {
    id: 'web',
    label: 'Web Fetch & Search',
    endpoint: 'POST /v1/search · POST /v1/web/fetch',
    desc: 'AI web search & URL-to-Markdown extraction via Tavily, Brave, Serper, Exa, Firecrawl, Jina, SearXNG.',
    kinds: ['search', 'fetch'],
  },
];

export const keysApi = {
  list: () => apiFetch('/api/keys'),
  create: (name) => apiFetch('/api/keys', { method: 'POST', body: { name } }),
  patch: (id, data) =>
    apiFetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  remove: (id) => apiFetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revealInitial: () => apiFetch('/api/keys/reveal-initial', { skipAuthRedirect: true }),
};

const KEY_CACHE_STORAGE = 'r001-known-keys-v1';

export function rememberRouterKey(keyObj) {
  if (!keyObj || !keyObj.key) return;
  try {
    const raw = sessionStorage.getItem(KEY_CACHE_STORAGE);
    const map = raw ? JSON.parse(raw) : {};
    if (keyObj.id) map[keyObj.id] = keyObj.key;
    if (keyObj.keyPreview) map[keyObj.keyPreview] = keyObj.key;
    map.__latest = keyObj.key;
    sessionStorage.setItem(KEY_CACHE_STORAGE, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function getRememberedRouterKey(keyObj) {
  if (!keyObj) return '';
  if (keyObj.key && !String(keyObj.key).includes('…') && !String(keyObj.key).includes('***')) {
    return keyObj.key;
  }
  try {
    const raw = sessionStorage.getItem(KEY_CACHE_STORAGE);
    if (!raw) return '';
    const map = JSON.parse(raw);
    return (keyObj.id && map[keyObj.id]) || (keyObj.keyPreview && map[keyObj.keyPreview]) || '';
  } catch {
    return '';
  }
}

export const proxyPoolsApi = {
  list: () => apiFetch('/api/proxy-pools'),
  create: (data) => apiFetch('/api/proxy-pools', { method: 'POST', body: data }),
  update: (id, data) =>
    apiFetch(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  remove: (id) => apiFetch(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  test: (id) =>
    apiFetch(`/api/proxy-pools/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    }),
};

export const securityApi = {
  status: () => apiFetch('/api/security/status'),
  scan: () => apiFetch('/api/security/scan', { method: 'POST' }),
};

export const usageApi = {
  get: (range = '7d') => apiFetch(`/api/usage?range=${encodeURIComponent(range)}`),
  live: (limit = 100) => apiFetch(`/api/usage/live?limit=${encodeURIComponent(limit)}`),
  logs: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.status) qs.set('status', String(params.status));
    if (params.provider) qs.set('provider', String(params.provider));
    if (params.model) qs.set('model', String(params.model));
    return apiFetch(`/api/logs?${qs.toString()}`);
  },
  clearLogs: () => apiFetch('/api/logs', { method: 'DELETE' }),
};

export const quotaApi = {
  list: () => apiFetch('/api/quota'),
  updateBudget: (providerId, budget) =>
    apiFetch(`/api/quota/${encodeURIComponent(providerId)}`, {
      method: 'PUT',
      body: budget,
    }),
};

export const tokenSaverApi = {
  test: (payload) =>
    apiFetch('/api/token-saver/test', {
      method: 'POST',
      body: payload,
    }),
};

export const debugApi = {
  translate: (direction, payload) =>
    apiFetch('/api/debug/translate', {
      method: 'POST',
      body: { direction, payload },
    }),
};

export const settingsApi = {
  get: () => apiFetch('/api/settings'),
  update: (data) => apiFetch('/api/settings', { method: 'PUT', body: data }),
  changePassword: (currentPassword, newPassword) =>
    apiFetch('/api/settings/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  exportConfig: ({ secrets = 'redacted', passphrase = '', confirmPassword = '' } = {}) => {
    const qs = new URLSearchParams();
    qs.set('secrets', secrets);
    if (secrets === 'encrypted' && passphrase) {
      qs.set('passphrase', passphrase);
    }
    const headers = {};
    if (secrets === 'plain' && confirmPassword) {
      headers['X-Confirm-Password'] = confirmPassword;
    }
    return apiFetch(`/api/export?${qs.toString()}`, { headers });
  },
  importConfig: (payload) => apiFetch('/api/import', { method: 'POST', body: payload }),
};

export const healthApi = {
  check: async () => {
    const res = await fetch('/health', { credentials: 'include' });
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  },
};

export const SERVICE_KINDS_META = [
  {
    id: 'chat',
    label: 'Chat / LLM',
    method: 'POST',
    path: '/v1/chat/completions',
    desc: 'OpenAI-compatible chat completions across 47+ providers & fallback combos.',
  },
  {
    id: 'messages',
    label: 'Anthropic Messages',
    method: 'POST',
    path: '/v1/messages',
    desc: 'Native Claude Code & Anthropic Messages endpoint with bidirectional translation.',
  },
  {
    id: 'embedding',
    label: 'Embeddings',
    method: 'POST',
    path: '/v1/embeddings',
    desc: 'Vector embeddings via Voyage, Jina, OpenAI, Gemini, Cohere, Mistral, NVIDIA, Together.',
  },
  {
    id: 'image',
    label: 'Image Generation',
    method: 'POST',
    path: '/v1/images/generations',
    desc: 'Generate images via Fal, BFL Flux, Stability, Recraft, OpenAI, Together, Fireworks.',
  },
  {
    id: 'tts',
    label: 'Text-to-Speech (TTS)',
    method: 'POST',
    path: '/v1/audio/speech',
    desc: 'Low-latency speech synthesis via ElevenLabs, Deepgram Aura, OpenAI TTS.',
  },
  {
    id: 'stt',
    label: 'Speech-to-Text (STT)',
    method: 'POST',
    path: '/v1/audio/transcriptions',
    desc: 'Audio transcription via Deepgram Nova-3, AssemblyAI Universal-2, OpenAI Whisper, Groq.',
  },
  {
    id: 'search',
    label: 'Web Search',
    method: 'POST',
    path: '/v1/search',
    desc: 'Unified AI web search across Tavily, Brave, Serper, Exa, Linkup, Google PSE, SearchAPI, SearXNG.',
  },
  {
    id: 'fetch',
    label: 'Web Fetch / Reader',
    method: 'POST',
    path: '/v1/web/fetch',
    desc: 'Extract clean Markdown from any URL via Firecrawl, Jina Reader, Tavily, Exa.',
  },
  {
    id: 'models',
    label: 'Unified Models List',
    method: 'GET',
    path: '/v1/models',
    desc: 'Lists all enabled fallback combos and provider/model routing targets (?kind= filter).',
  },
];

// Helper to build compact fallback modelCatalog items from model string array
function toCatalogEntries(models, extra = {}) {
  return (models || []).map((id) => ({
    id,
    name: id,
    kind: extra.kind || 'chat',
    contextWindow: extra.contextWindow || 128000,
    free: Boolean(extra.free),
    vision: Boolean(extra.vision),
    reasoning: Boolean(extra.reasoning || /r1|qwq|reason|o3|o4|thinking/i.test(id)),
    tools: extra.tools !== undefined ? extra.tools : true,
    inputPrice: extra.inputPrice ?? (extra.free ? 0 : undefined),
    outputPrice: extra.outputPrice ?? (extra.free ? 0 : undefined),
  }));
}

// Comprehensive 55+ Official API Key, Free-Tier Developer API, Cheap Coding, Local LLM & Multimodal Service presets
// Strictly NO OAuth, NO cookies, NO spoofing.
export const FALLBACK_PRESETS = [
  // ============================================================================
  // 1. Free Forever / Free-Tier Official APIs
  // ============================================================================
  {
    preset: 'gemini',
    name: 'Google Gemini',
    category: 'free-tier',
    tier: 'free',
    logo: 'gemini',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#4285F4',
    monogram: 'GM',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    formatType: 'gemini-openai',
    docsUrl: 'https://aistudio.google.com/apikey',
    serviceKinds: ['chat', 'vision', 'embedding', 'image'],
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    modelCatalog: toCatalogEntries(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'], {
      free: true,
      vision: true,
      contextWindow: 1048576,
    }),
  },
  {
    preset: 'groq',
    name: 'Groq',
    category: 'free-tier',
    tier: 'free',
    logo: 'groq',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#F55036',
    monogram: 'GQ',
    baseUrl: 'https://api.groq.com/openai/v1',
    formatType: 'openai',
    docsUrl: 'https://console.groq.com/keys',
    serviceKinds: ['chat', 'vision', 'stt'],
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'],
    modelCatalog: toCatalogEntries(
      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'],
      { free: true, contextWindow: 131072 }
    ),
  },
  {
    preset: 'cerebras',
    name: 'Cerebras',
    category: 'free-tier',
    tier: 'free',
    logo: 'cerebras',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#EA580C',
    monogram: 'CB',
    baseUrl: 'https://api.cerebras.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://cloud.cerebras.ai/',
    serviceKinds: ['chat'],
    models: ['llama-3.3-70b', 'qwen-3-32b', 'llama3.1-8b'],
    modelCatalog: toCatalogEntries(['llama-3.3-70b', 'qwen-3-32b', 'llama3.1-8b'], {
      free: true,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'openrouter',
    name: 'OpenRouter',
    category: 'free-tier',
    tier: 'free',
    logo: 'openrouter',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#6366F1',
    monogram: 'OR',
    baseUrl: 'https://openrouter.ai/api/v1',
    formatType: 'openai',
    docsUrl: 'https://openrouter.ai/keys',
    serviceKinds: ['chat', 'vision'],
    models: [
      'deepseek/deepseek-chat-v3-0324:free',
      'google/gemini-2.5-flash',
      'anthropic/claude-3.7-sonnet',
    ],
    modelCatalog: toCatalogEntries(
      [
        'deepseek/deepseek-chat-v3-0324:free',
        'google/gemini-2.5-flash',
        'anthropic/claude-3.7-sonnet',
      ],
      { free: true, vision: true, contextWindow: 163840 }
    ),
  },
  {
    preset: 'nvidia',
    name: 'NVIDIA NIM',
    category: 'free-tier',
    tier: 'free',
    logo: 'nvidia',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#76B900',
    monogram: 'NV',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    formatType: 'openai',
    docsUrl: 'https://build.nvidia.com/',
    serviceKinds: ['chat', 'embedding', 'vision'],
    models: [
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen2.5-coder-32b-instruct',
    ],
    modelCatalog: toCatalogEntries(
      ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-coder-32b-instruct'],
      { free: true, contextWindow: 128000 }
    ),
  },
  {
    preset: 'sambanova',
    name: 'SambaNova',
    category: 'free-tier',
    tier: 'free',
    logo: 'sambanova',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#D97706',
    monogram: 'SN',
    baseUrl: 'https://api.sambanova.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://cloud.sambanova.ai/apis',
    serviceKinds: ['chat', 'vision'],
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1', 'Qwen2.5-Coder-32B-Instruct'],
    modelCatalog: toCatalogEntries(
      ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1', 'Qwen2.5-Coder-32B-Instruct'],
      { free: true, contextWindow: 128000 }
    ),
  },
  {
    preset: 'huggingface',
    name: 'Hugging Face',
    category: 'free-tier',
    tier: 'free',
    logo: 'huggingface',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#EAB308',
    monogram: 'HF',
    baseUrl: 'https://router.huggingface.co/v1',
    formatType: 'openai',
    docsUrl: 'https://huggingface.co/settings/tokens',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
    modelCatalog: toCatalogEntries(
      ['Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
      { free: true, contextWindow: 128000 }
    ),
  },
  {
    preset: 'mistral',
    name: 'Mistral',
    category: 'free-tier',
    tier: 'free',
    logo: 'mistral',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#F97316',
    monogram: 'MI',
    baseUrl: 'https://api.mistral.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://console.mistral.ai/api-keys/',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['codestral-latest', 'mistral-large-latest', 'mistral-small-latest'],
    modelCatalog: toCatalogEntries(
      ['codestral-latest', 'mistral-large-latest', 'mistral-small-latest'],
      { free: true, vision: true, contextWindow: 256000 }
    ),
  },
  {
    preset: 'cloudflare',
    name: 'Cloudflare Workers AI',
    category: 'free-tier',
    tier: 'free',
    logo: 'cloudflare-ai',
    logoExt: 'png',
    badge: 'Free Tier',
    color: '#F38020',
    monogram: 'CF',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1',
    formatType: 'openai',
    docsUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
    serviceKinds: ['chat', 'embedding'],
    models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct'],
    modelCatalog: toCatalogEntries(
      ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen2.5-coder-32b-instruct'],
      { free: true, contextWindow: 128000 }
    ),
  },
  {
    preset: 'byteplus',
    name: 'BytePlus ModelArk',
    category: 'free-tier',
    tier: 'free',
    logo: 'byteplus',
    logoExt: 'png',
    badge: 'Free Credits',
    color: '#2563EB',
    monogram: 'BP',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    formatType: 'openai',
    docsUrl: 'https://console.byteplus.com/ark',
    serviceKinds: ['chat', 'vision', 'embedding', 'image', 'video'],
    models: ['seed-1-6-250615', 'deepseek-r1-250528', 'deepseek-v3-250324'],
    modelCatalog: toCatalogEntries(
      ['seed-1-6-250615', 'deepseek-r1-250528', 'deepseek-v3-250324'],
      { free: true, vision: true, contextWindow: 256000 }
    ),
  },

  // ============================================================================
  // 2. Cheap & Coding Plans (Official API Key)
  // ============================================================================
  {
    preset: 'glm',
    name: 'Zhipu GLM / Z.ai',
    category: 'apikey',
    tier: 'cheap',
    logo: 'glm',
    logoExt: 'png',
    badge: '$0.60/1M',
    color: '#1E293B',
    monogram: 'GL',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    formatType: 'openai',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    serviceKinds: ['chat', 'vision'],
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    modelCatalog: toCatalogEntries(['glm-4-plus', 'glm-4-air', 'glm-4-flash'], {
      inputPrice: 0.6,
      outputPrice: 2.2,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'kimi',
    name: 'Moonshot Kimi',
    category: 'apikey',
    tier: 'cheap',
    logo: 'kimi',
    logoExt: 'png',
    badge: 'Coding Plan',
    color: '#18181B',
    monogram: 'KM',
    baseUrl: 'https://api.moonshot.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.moonshot.ai/',
    serviceKinds: ['chat', 'vision'],
    models: ['kimi-k2', 'moonshot-v1-128k', 'kimi-latest'],
    modelCatalog: toCatalogEntries(['kimi-k2', 'moonshot-v1-128k', 'kimi-latest'], {
      inputPrice: 0.6,
      outputPrice: 2.5,
      contextWindow: 256000,
    }),
  },
  {
    preset: 'minimax',
    name: 'MiniMax',
    category: 'apikey',
    tier: 'cheap',
    logo: 'minimax',
    logoExt: 'png',
    badge: '$0.20/1M',
    color: '#EC4899',
    monogram: 'MM',
    baseUrl: 'https://api.minimax.chat/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.minimaxi.com/',
    serviceKinds: ['chat', 'image', 'tts'],
    models: ['MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat'],
    modelCatalog: toCatalogEntries(['MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat'], {
      inputPrice: 0.2,
      outputPrice: 1.1,
      contextWindow: 1000000,
    }),
  },
  {
    preset: 'deepseek',
    name: 'DeepSeek',
    category: 'apikey',
    tier: 'cheap',
    logo: 'deepseek',
    logoExt: 'png',
    badge: '$0.27/1M',
    color: '#4D6BFE',
    monogram: 'DS',
    baseUrl: 'https://api.deepseek.com/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    serviceKinds: ['chat'],
    models: ['deepseek-chat', 'deepseek-reasoner'],
    modelCatalog: toCatalogEntries(['deepseek-chat', 'deepseek-reasoner'], {
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'alibaba',
    name: 'Alibaba Qwen',
    category: 'apikey',
    tier: 'cheap',
    logo: 'qwen',
    logoExt: 'png',
    badge: 'Qwen3 Coder',
    color: '#FF6A00',
    monogram: 'QW',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    formatType: 'openai',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['qwen-max', 'qwen-plus', 'qwen-coder-plus'],
    modelCatalog: toCatalogEntries(['qwen-max', 'qwen-plus', 'qwen-coder-plus'], {
      inputPrice: 0.4,
      outputPrice: 1.2,
      contextWindow: 256000,
    }),
  },
  {
    preset: 'siliconflow',
    name: 'SiliconFlow',
    category: 'apikey',
    tier: 'cheap',
    logo: 'siliconflow',
    logoExt: 'png',
    color: '#4F46E5',
    monogram: 'SF',
    baseUrl: 'https://api.siliconflow.cn/v1',
    formatType: 'openai',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    serviceKinds: ['chat', 'embedding', 'image'],
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    modelCatalog: toCatalogEntries(['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct'], {
      inputPrice: 0.25,
      outputPrice: 1.0,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'chutes',
    name: 'Chutes AI',
    category: 'apikey',
    tier: 'cheap',
    logo: 'chutes',
    logoExt: 'png',
    color: '#0F172A',
    monogram: 'CH',
    baseUrl: 'https://llm.chutes.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://chutes.ai/app/api',
    serviceKinds: ['chat'],
    models: ['deepseek-ai/DeepSeek-V3-0324', 'deepseek-ai/DeepSeek-R1'],
    modelCatalog: toCatalogEntries(['deepseek-ai/DeepSeek-V3-0324', 'deepseek-ai/DeepSeek-R1'], {
      inputPrice: 0.2,
      outputPrice: 0.8,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'featherless',
    name: 'Featherless AI',
    category: 'apikey',
    tier: 'cheap',
    logo: 'featherless',
    logoExt: 'png',
    color: '#14B8A6',
    monogram: 'FL',
    baseUrl: 'https://api.featherless.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://featherless.ai/account/api-keys',
    serviceKinds: ['chat'],
    models: ['meta-llama/Llama-3.3-70B-Instruct'],
    modelCatalog: toCatalogEntries(['meta-llama/Llama-3.3-70B-Instruct'], {
      inputPrice: 0.3,
      outputPrice: 0.6,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'novita',
    name: 'Novita AI',
    category: 'apikey',
    tier: 'cheap',
    logo: 'novita',
    logoExt: 'png',
    color: '#10B981',
    monogram: 'NV',
    baseUrl: 'https://api.novita.ai/v3/openai',
    formatType: 'openai',
    docsUrl: 'https://novita.ai/settings/key-management',
    serviceKinds: ['chat', 'image'],
    models: ['deepseek/deepseek-v3-0324', 'deepseek/deepseek-r1', 'qwen/qwen-2.5-coder-32b-instruct'],
    modelCatalog: toCatalogEntries(
      ['deepseek/deepseek-v3-0324', 'deepseek/deepseek-r1', 'qwen/qwen-2.5-coder-32b-instruct'],
      { inputPrice: 0.28, outputPrice: 1.1, contextWindow: 128000 }
    ),
  },
  {
    preset: 'xiaomi',
    name: 'Xiaomi MiMo',
    category: 'apikey',
    tier: 'cheap',
    logo: 'xiaomi-mimo',
    logoExt: 'png',
    badge: 'MiMo API',
    color: '#FF6900',
    monogram: 'XM',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.xiaomimimo.com/console/api-keys',
    serviceKinds: ['chat', 'vision'],
    models: ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-vl-7b'],
    modelCatalog: toCatalogEntries(['mimo-v2-flash', 'mimo-v2-pro', 'mimo-vl-7b'], {
      inputPrice: 0.15,
      outputPrice: 0.6,
      vision: true,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'baidu',
    name: 'Baidu Qianfan',
    category: 'apikey',
    tier: 'cheap',
    logo: 'baidu',
    logoExt: 'png',
    badge: 'ERNIE API',
    color: '#2932E1',
    monogram: 'BD',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    formatType: 'openai',
    docsUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['ernie-4.5-turbo-128k', 'ernie-x1-turbo-32k', 'ernie-4.5-vl-28b-a3b'],
    modelCatalog: toCatalogEntries(
      ['ernie-4.5-turbo-128k', 'ernie-x1-turbo-32k', 'ernie-4.5-vl-28b-a3b'],
      { inputPrice: 0.14, outputPrice: 0.56, vision: true, contextWindow: 128000 }
    ),
  },
  {
    preset: 'tencent',
    name: 'Tencent Hunyuan',
    category: 'apikey',
    tier: 'cheap',
    logo: 'tencent',
    logoExt: 'png',
    badge: 'Hunyuan',
    color: '#0052D9',
    monogram: 'TC',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    formatType: 'openai',
    docsUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-vision'],
    modelCatalog: toCatalogEntries(
      ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-vision'],
      { inputPrice: 0.15, outputPrice: 0.6, vision: true, contextWindow: 256000 }
    ),
  },
  {
    preset: 'nous',
    name: 'Nous Research',
    category: 'apikey',
    tier: 'cheap',
    logo: 'nous',
    logoExt: 'png',
    badge: 'Hermes',
    color: '#10B981',
    monogram: 'NR',
    baseUrl: 'https://inference-api.nousresearch.com/v1',
    formatType: 'openai',
    docsUrl: 'https://portal.nousresearch.com/',
    serviceKinds: ['chat'],
    models: ['Hermes-4-70B', 'Hermes-3-Llama-3.1-70B', 'DeepHermes-3-Mistral-24B-Preview'],
    modelCatalog: toCatalogEntries(
      ['Hermes-4-70B', 'Hermes-3-Llama-3.1-70B', 'DeepHermes-3-Mistral-24B-Preview'],
      { inputPrice: 0.2, outputPrice: 0.8, reasoning: true, contextWindow: 131072 }
    ),
  },

  // ============================================================================
  // 3. Flagship & Cloud API Key Providers
  // ============================================================================
  {
    preset: 'openai',
    name: 'OpenAI',
    category: 'apikey',
    tier: 'premium',
    logo: 'openai',
    logoExt: 'png',
    color: '#10A37F',
    monogram: 'OA',
    baseUrl: 'https://api.openai.com/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.openai.com/api-keys',
    serviceKinds: ['chat', 'vision', 'embedding', 'image', 'tts', 'stt'],
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini'],
    modelCatalog: toCatalogEntries(['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini'], {
      vision: true,
      inputPrice: 2.0,
      outputPrice: 8.0,
      contextWindow: 1047576,
    }),
  },
  {
    preset: 'anthropic',
    name: 'Anthropic',
    category: 'apikey',
    tier: 'premium',
    logo: 'anthropic',
    logoExt: 'png',
    color: '#D97757',
    monogram: 'AN',
    baseUrl: 'https://api.anthropic.com',
    formatType: 'anthropic',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    serviceKinds: ['chat', 'vision'],
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
    modelCatalog: toCatalogEntries(
      ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
      { vision: true, reasoning: true, inputPrice: 3.0, outputPrice: 15.0, contextWindow: 200000 }
    ),
  },
  {
    preset: 'xai',
    name: 'xAI (Grok)',
    category: 'apikey',
    tier: 'premium',
    logo: 'xai',
    logoExt: 'png',
    color: '#3B82F6',
    monogram: 'XA',
    baseUrl: 'https://api.x.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://console.x.ai/',
    serviceKinds: ['chat', 'vision', 'image'],
    models: ['grok-3', 'grok-3-mini', 'grok-2-latest'],
    modelCatalog: toCatalogEntries(['grok-3', 'grok-3-mini', 'grok-2-latest'], {
      vision: true,
      inputPrice: 3.0,
      outputPrice: 15.0,
      contextWindow: 131072,
    }),
  },
  {
    preset: 'muse',
    name: 'Muse (Meta Model API)',
    category: 'apikey',
    tier: 'premium',
    logo: 'muse',
    logoExt: 'png',
    badge: 'Meta API',
    color: '#0866FF',
    monogram: 'MU',
    baseUrl: 'https://api.meta.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://dev.meta.ai',
    serviceKinds: ['chat', 'vision'],
    models: ['Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama-4-Scout-17B-16E-Instruct-FP8'],
    modelCatalog: toCatalogEntries(
      ['Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama-4-Scout-17B-16E-Instruct-FP8'],
      { vision: true, inputPrice: 0.35, outputPrice: 1.15, contextWindow: 1000000 }
    ),
  },
  {
    preset: 'together',
    name: 'Together AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'together',
    logoExt: 'png',
    color: '#2563EB',
    monogram: 'TG',
    baseUrl: 'https://api.together.xyz/v1',
    formatType: 'openai',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    serviceKinds: ['chat', 'embedding', 'image'],
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    modelCatalog: toCatalogEntries(
      ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
      { inputPrice: 0.88, outputPrice: 0.88, contextWindow: 131072 }
    ),
  },
  {
    preset: 'fireworks',
    name: 'Fireworks AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'fireworks',
    logoExt: 'png',
    color: '#7C3AED',
    monogram: 'FW',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    formatType: 'openai',
    docsUrl: 'https://fireworks.ai/account/api-keys',
    serviceKinds: ['chat', 'embedding', 'image'],
    models: [
      'accounts/fireworks/models/deepseek-v3',
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
    ],
    modelCatalog: toCatalogEntries(
      ['accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/llama-v3p3-70b-instruct'],
      { inputPrice: 0.9, outputPrice: 0.9, contextWindow: 131072 }
    ),
  },
  {
    preset: 'perplexity',
    name: 'Perplexity',
    category: 'apikey',
    tier: 'premium',
    logo: 'perplexity',
    logoExt: 'png',
    color: '#0EA5E9',
    monogram: 'PP',
    baseUrl: 'https://api.perplexity.ai',
    formatType: 'openai',
    docsUrl: 'https://www.perplexity.ai/settings/api',
    serviceKinds: ['chat', 'search'],
    models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro'],
    modelCatalog: toCatalogEntries(['sonar-pro', 'sonar', 'sonar-reasoning-pro'], {
      inputPrice: 1.0,
      outputPrice: 5.0,
      contextWindow: 200000,
    }),
  },
  {
    preset: 'cohere',
    name: 'Cohere',
    category: 'apikey',
    tier: 'premium',
    logo: 'cohere',
    logoExt: 'png',
    color: '#39594D',
    monogram: 'CO',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    formatType: 'openai',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    serviceKinds: ['chat', 'embedding'],
    models: ['command-a-03-2025', 'command-r-plus-08-2024'],
    modelCatalog: toCatalogEntries(['command-a-03-2025', 'command-r-plus-08-2024'], {
      inputPrice: 2.5,
      outputPrice: 10.0,
      contextWindow: 256000,
    }),
  },
  {
    preset: 'nebius',
    name: 'Nebius AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'nebius',
    logoExt: 'png',
    color: '#8B5CF6',
    monogram: 'NB',
    baseUrl: 'https://api.studio.nebius.com/v1',
    formatType: 'openai',
    docsUrl: 'https://studio.nebius.com/settings/api-keys',
    serviceKinds: ['chat', 'embedding'],
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    modelCatalog: toCatalogEntries(
      ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
      { inputPrice: 0.4, outputPrice: 1.2, contextWindow: 128000 }
    ),
  },
  {
    preset: 'hyperbolic',
    name: 'Hyperbolic',
    category: 'apikey',
    tier: 'premium',
    logo: 'hyperbolic',
    logoExt: 'png',
    color: '#06B6D4',
    monogram: 'HB',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    formatType: 'openai',
    docsUrl: 'https://app.hyperbolic.xyz/settings',
    serviceKinds: ['chat', 'image'],
    models: ['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct'],
    modelCatalog: toCatalogEntries(['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct'], {
      inputPrice: 0.4,
      outputPrice: 1.2,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'venice',
    name: 'Venice AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'venice',
    logoExt: 'png',
    color: '#DC2626',
    monogram: 'VN',
    baseUrl: 'https://api.venice.ai/api/v1',
    formatType: 'openai',
    docsUrl: 'https://venice.ai/settings/api',
    serviceKinds: ['chat', 'image'],
    models: ['llama-3.3-70b', 'qwen-2.5-coder-32b'],
    modelCatalog: toCatalogEntries(['llama-3.3-70b', 'qwen-2.5-coder-32b'], {
      inputPrice: 0.5,
      outputPrice: 1.5,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'vercel',
    name: 'Vercel AI Gateway',
    category: 'apikey',
    tier: 'premium',
    logo: 'vercel-ai-gateway',
    logoExt: 'png',
    color: '#171717',
    monogram: 'VC',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    formatType: 'openai',
    docsUrl: 'https://vercel.com/dashboard',
    serviceKinds: ['chat', 'vision'],
    models: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4'],
    modelCatalog: toCatalogEntries(['openai/gpt-4.1', 'anthropic/claude-sonnet-4'], {
      vision: true,
      contextWindow: 200000,
    }),
  },
  {
    preset: 'azure',
    name: 'Azure OpenAI',
    category: 'apikey',
    tier: 'premium',
    logo: 'azure',
    logoExt: 'png',
    color: '#0078D4',
    monogram: 'AZ',
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1',
    formatType: 'openai',
    docsUrl: 'https://portal.azure.com/',
    serviceKinds: ['chat', 'vision', 'embedding', 'image'],
    models: ['gpt-4.1', 'gpt-4o', 'o4-mini', 'text-embedding-3-large'],
    modelCatalog: toCatalogEntries(['gpt-4.1', 'gpt-4o', 'o4-mini', 'text-embedding-3-large'], {
      vision: true,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'bedrock',
    name: 'AWS Bedrock',
    category: 'apikey',
    tier: 'premium',
    logo: 'bedrock',
    logoExt: 'png',
    color: '#FF9900',
    monogram: 'BR',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1',
    formatType: 'openai',
    docsUrl: 'https://console.aws.amazon.com/bedrock/',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: [
      'anthropic.claude-sonnet-4-20250514-v1:0',
      'us.amazon.nova-pro-v1:0',
      'us.meta.llama3-3-70b-instruct-v1:0',
    ],
    modelCatalog: toCatalogEntries(
      [
        'anthropic.claude-sonnet-4-20250514-v1:0',
        'us.amazon.nova-pro-v1:0',
        'us.meta.llama3-3-70b-instruct-v1:0',
      ],
      { vision: true, contextWindow: 200000 }
    ),
  },
  {
    preset: 'vertex',
    name: 'Google Vertex AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'vertex',
    logoExt: 'png',
    color: '#4285F4',
    monogram: 'VX',
    baseUrl:
      'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/PROJECT/locations/us-central1/endpoints/openapi',
    formatType: 'openai',
    docsUrl: 'https://console.cloud.google.com/vertex-ai',
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash'],
    modelCatalog: toCatalogEntries(['google/gemini-2.5-pro', 'google/gemini-2.5-flash'], {
      vision: true,
      contextWindow: 1048576,
    }),
  },
  {
    preset: 'reka',
    name: 'Reka AI',
    category: 'apikey',
    tier: 'premium',
    logo: 'reka',
    logoExt: 'png',
    color: '#6366F1',
    monogram: 'RK',
    baseUrl: 'https://api.reka.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://platform.reka.ai/',
    serviceKinds: ['chat', 'vision'],
    models: ['reka-core', 'reka-flash', 'reka-edge'],
    modelCatalog: toCatalogEntries(['reka-core', 'reka-flash', 'reka-edge'], {
      vision: true,
      contextWindow: 128000,
    }),
  },

  // ============================================================================
  // 4. Local & Self-Hosted LLMs
  // ============================================================================
  {
    preset: 'ollama',
    name: 'Ollama',
    category: 'local',
    tier: 'local',
    logo: 'ollama',
    logoExt: 'png',
    badge: 'Local',
    color: '#27272A',
    monogram: 'OL',
    baseUrl: 'http://localhost:11434/v1',
    formatType: 'openai',
    docsUrl: 'https://ollama.com/',
    keyOptional: true,
    serviceKinds: ['chat', 'vision', 'embedding'],
    models: ['qwen2.5-coder:14b', 'llama3.3', 'deepseek-r1:14b'],
    modelCatalog: toCatalogEntries(['qwen2.5-coder:14b', 'llama3.3', 'deepseek-r1:14b'], {
      free: true,
      contextWindow: 128000,
    }),
  },
  {
    preset: 'lmstudio',
    name: 'LM Studio',
    category: 'local',
    tier: 'local',
    logo: 'local-device',
    logoExt: 'png',
    badge: 'Local',
    color: '#4338CA',
    monogram: 'LM',
    baseUrl: 'http://localhost:1234/v1',
    formatType: 'openai',
    docsUrl: 'https://lmstudio.ai/',
    keyOptional: true,
    serviceKinds: ['chat', 'embedding'],
    models: ['local-model'],
    modelCatalog: toCatalogEntries(['local-model'], { free: true, contextWindow: 128000 }),
  },
  {
    preset: 'vllm',
    name: 'vLLM',
    category: 'local',
    tier: 'local',
    logo: 'local-device',
    logoExt: 'png',
    badge: 'Local',
    color: '#0284C7',
    monogram: 'VL',
    baseUrl: 'http://localhost:8000/v1',
    formatType: 'openai',
    docsUrl: 'https://docs.vllm.ai/',
    keyOptional: true,
    serviceKinds: ['chat', 'embedding'],
    models: ['default'],
    modelCatalog: toCatalogEntries(['default'], { free: true, contextWindow: 128000 }),
  },
  {
    preset: 'llamacpp',
    name: 'llama.cpp',
    category: 'local',
    tier: 'local',
    logo: 'local-device',
    logoExt: 'png',
    badge: 'Local',
    color: '#65A30D',
    monogram: 'LC',
    baseUrl: 'http://localhost:8080/v1',
    formatType: 'openai',
    docsUrl: 'https://github.com/ggml-org/llama.cpp',
    keyOptional: true,
    serviceKinds: ['chat', 'embedding'],
    models: ['default'],
    modelCatalog: toCatalogEntries(['default'], { free: true, contextWindow: 128000 }),
  },

  // ============================================================================
  // 5. Multimodal & Search Service Providers (9 Service Kinds)
  // ============================================================================
  {
    preset: 'deepgram',
    name: 'Deepgram',
    category: 'service',
    tier: 'premium',
    logo: 'deepgram',
    logoExt: 'png',
    badge: 'STT / TTS',
    color: '#13EF93',
    monogram: 'DG',
    baseUrl: 'https://api.deepgram.com/v1',
    formatType: 'openai',
    docsUrl: 'https://console.deepgram.com/',
    serviceKinds: ['stt', 'tts'],
    models: ['nova-3', 'nova-2', 'aura-asteria-en'],
    modelCatalog: [
      { id: 'nova-3', name: 'Deepgram Nova-3', kind: 'stt' },
      { id: 'nova-2', name: 'Deepgram Nova-2', kind: 'stt' },
      { id: 'aura-asteria-en', name: 'Deepgram Aura Asteria', kind: 'tts' },
    ],
  },
  {
    preset: 'assemblyai',
    name: 'AssemblyAI',
    category: 'service',
    tier: 'premium',
    logo: 'assemblyai',
    logoExt: 'png',
    badge: 'STT',
    color: '#2563EB',
    monogram: 'AA',
    baseUrl: 'https://api.assemblyai.com/v2',
    formatType: 'openai',
    docsUrl: 'https://www.assemblyai.com/app',
    serviceKinds: ['stt'],
    models: ['universal-2', 'nano'],
    modelCatalog: [
      { id: 'universal-2', name: 'Universal-2 STT', kind: 'stt' },
      { id: 'nano', name: 'Nano STT', kind: 'stt' },
    ],
  },
  {
    preset: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'service',
    tier: 'premium',
    logo: 'elevenlabs',
    logoExt: 'png',
    badge: 'TTS',
    color: '#18181B',
    monogram: 'EL',
    baseUrl: 'https://api.elevenlabs.io/v1',
    formatType: 'openai',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    serviceKinds: ['tts'],
    models: ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'],
    modelCatalog: [
      { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', kind: 'tts' },
      { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', kind: 'tts' },
    ],
  },
  {
    preset: 'voyage',
    name: 'Voyage AI',
    category: 'service',
    tier: 'premium',
    logo: 'voyage-ai',
    logoExt: 'png',
    badge: 'Embeddings',
    color: '#0284C7',
    monogram: 'VY',
    baseUrl: 'https://api.voyageai.com/v1',
    formatType: 'openai',
    docsUrl: 'https://dash.voyageai.com/api-keys',
    serviceKinds: ['embedding'],
    models: ['voyage-3-large', 'voyage-code-3', 'voyage-3-lite'],
    modelCatalog: [
      { id: 'voyage-3-large', name: 'Voyage 3 Large', kind: 'embedding', contextWindow: 32000 },
      { id: 'voyage-code-3', name: 'Voyage Code 3', kind: 'embedding', contextWindow: 32000 },
    ],
  },
  {
    preset: 'jina',
    name: 'Jina AI',
    category: 'service',
    tier: 'free',
    logo: 'jina-ai',
    logoExt: 'png',
    badge: 'Embed & Fetch',
    color: '#0D9488',
    monogram: 'JN',
    baseUrl: 'https://api.jina.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://jina.ai/api-dashboard',
    serviceKinds: ['embedding', 'fetch'],
    models: ['jina-embeddings-v3', 'jina-clip-v2', 'jina-reader-v1'],
    modelCatalog: [
      { id: 'jina-embeddings-v3', name: 'Jina Embeddings v3', kind: 'embedding', contextWindow: 8192 },
      { id: 'jina-clip-v2', name: 'Jina CLIP v2', kind: 'embedding', contextWindow: 8192 },
    ],
  },
  {
    preset: 'fal',
    name: 'Fal AI',
    category: 'service',
    tier: 'premium',
    logo: 'fal-ai',
    logoExt: 'png',
    badge: 'Image / Video',
    color: '#7C3AED',
    monogram: 'FA',
    baseUrl: 'https://fal.run',
    formatType: 'openai',
    docsUrl: 'https://fal.ai/dashboard/keys',
    serviceKinds: ['image', 'video'],
    models: ['fal-ai/flux-pro/v1.1', 'fal-ai/flux/schnell', 'fal-ai/recraft-v3'],
    modelCatalog: [
      { id: 'fal-ai/flux-pro/v1.1', name: 'FLUX.1.1 Pro', kind: 'image' },
      { id: 'fal-ai/flux/schnell', name: 'FLUX.1 Schnell', kind: 'image' },
    ],
  },
  {
    preset: 'stability',
    name: 'Stability AI',
    category: 'service',
    tier: 'premium',
    logo: 'stability-ai',
    logoExt: 'png',
    badge: 'Image Gen',
    color: '#9333EA',
    monogram: 'ST',
    baseUrl: 'https://api.stability.ai/v2beta',
    formatType: 'openai',
    docsUrl: 'https://platform.stability.ai/account/keys',
    serviceKinds: ['image'],
    models: ['sd3.5-large', 'sd3.5-large-turbo', 'ultra'],
    modelCatalog: [
      { id: 'sd3.5-large', name: 'Stable Diffusion 3.5 Large', kind: 'image' },
      { id: 'ultra', name: 'Stable Image Ultra', kind: 'image' },
    ],
  },
  {
    preset: 'bfl',
    name: 'Black Forest Labs',
    category: 'service',
    tier: 'premium',
    logo: 'black-forest-labs',
    logoExt: 'png',
    badge: 'FLUX Image',
    color: '#171717',
    monogram: 'BF',
    baseUrl: 'https://api.bfl.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://dashboard.bfl.ai/',
    serviceKinds: ['image'],
    models: ['flux-pro-1.1-ultra', 'flux-pro-1.1', 'flux-dev'],
    modelCatalog: [
      { id: 'flux-pro-1.1-ultra', name: 'FLUX 1.1 Pro Ultra', kind: 'image' },
      { id: 'flux-pro-1.1', name: 'FLUX 1.1 Pro', kind: 'image' },
    ],
  },
  {
    preset: 'recraft',
    name: 'Recraft AI',
    category: 'service',
    tier: 'premium',
    logo: 'recraft',
    logoExt: 'png',
    badge: 'Image / SVG',
    color: '#EA580C',
    monogram: 'RC',
    baseUrl: 'https://external.api.recraft.ai/v1',
    formatType: 'openai',
    docsUrl: 'https://www.recraft.ai/profile/api',
    serviceKinds: ['image'],
    models: ['recraftv3', 'recraft20b'],
    modelCatalog: [
      { id: 'recraftv3', name: 'Recraft V3', kind: 'image' },
      { id: 'recraft20b', name: 'Recraft 20B', kind: 'image' },
    ],
  },
  {
    preset: 'runway',
    name: 'Runway ML',
    category: 'service',
    tier: 'premium',
    logo: 'runwayml',
    logoExt: 'png',
    badge: 'Video Gen',
    color: '#111827',
    monogram: 'RW',
    baseUrl: 'https://api.dev.runwayml.com/v1',
    formatType: 'openai',
    docsUrl: 'https://dev.runwayml.com/',
    serviceKinds: ['video'],
    models: ['gen4_turbo', 'gen3a_turbo'],
    modelCatalog: [
      { id: 'gen4_turbo', name: 'Runway Gen-4 Turbo', kind: 'video' },
      { id: 'gen3a_turbo', name: 'Runway Gen-3 Alpha Turbo', kind: 'video' },
    ],
  },
  {
    preset: 'tavily',
    name: 'Tavily Search',
    category: 'service',
    tier: 'free',
    logo: 'tavily',
    logoExt: 'png',
    badge: 'Web Search',
    color: '#2563EB',
    monogram: 'TV',
    baseUrl: 'https://api.tavily.com',
    formatType: 'openai',
    docsUrl: 'https://app.tavily.com/',
    serviceKinds: ['search', 'fetch'],
    models: ['tavily-search', 'tavily-extract'],
    modelCatalog: [
      { id: 'tavily-search', name: 'Tavily AI Search', kind: 'search', free: true },
      { id: 'tavily-extract', name: 'Tavily Web Extract', kind: 'fetch', free: true },
    ],
  },
  {
    preset: 'brave',
    name: 'Brave Search',
    category: 'service',
    tier: 'free',
    logo: 'brave-search',
    logoExt: 'png',
    badge: 'Web Search',
    color: '#FB542B',
    monogram: 'BR',
    baseUrl: 'https://api.search.brave.com/res/v1',
    formatType: 'openai',
    docsUrl: 'https://api.search.brave.com/app/keys',
    serviceKinds: ['search'],
    models: ['brave-web-search'],
    modelCatalog: [{ id: 'brave-web-search', name: 'Brave Web Search', kind: 'search', free: true }],
  },
  {
    preset: 'serper',
    name: 'Serper.dev',
    category: 'service',
    tier: 'free',
    logo: 'serper',
    logoExt: 'png',
    badge: 'Google SERP',
    color: '#3B82F6',
    monogram: 'SP',
    baseUrl: 'https://google.serper.dev',
    formatType: 'openai',
    docsUrl: 'https://serper.dev/api-key',
    serviceKinds: ['search'],
    models: ['serper-search'],
    modelCatalog: [{ id: 'serper-search', name: 'Serper Google Search', kind: 'search', free: true }],
  },
  {
    preset: 'exa',
    name: 'Exa AI',
    category: 'service',
    tier: 'free',
    logo: 'exa',
    logoExt: 'png',
    badge: 'Neural Search',
    color: '#4F46E5',
    monogram: 'EX',
    baseUrl: 'https://api.exa.ai',
    formatType: 'openai',
    docsUrl: 'https://dashboard.exa.ai/api-keys',
    serviceKinds: ['search', 'fetch'],
    models: ['exa-search', 'exa-contents'],
    modelCatalog: [
      { id: 'exa-search', name: 'Exa Neural Search', kind: 'search', free: true },
      { id: 'exa-contents', name: 'Exa Contents Fetch', kind: 'fetch', free: true },
    ],
  },
  {
    preset: 'firecrawl',
    name: 'Firecrawl',
    category: 'service',
    tier: 'free',
    logo: 'firecrawl',
    logoExt: 'png',
    badge: 'Web Fetch',
    color: '#F97316',
    monogram: 'FC',
    baseUrl: 'https://api.firecrawl.dev/v1',
    formatType: 'openai',
    docsUrl: 'https://www.firecrawl.dev/app/api-keys',
    serviceKinds: ['fetch'],
    models: ['firecrawl-scrape'],
    modelCatalog: [{ id: 'firecrawl-scrape', name: 'Firecrawl Markdown Scrape', kind: 'fetch', free: true }],
  },
  {
    preset: 'searxng',
    name: 'SearXNG',
    category: 'service',
    tier: 'local',
    logo: 'searxng',
    logoExt: 'png',
    badge: 'Self-Hosted',
    color: '#10B981',
    monogram: 'SX',
    baseUrl: 'http://localhost:8088',
    formatType: 'openai',
    docsUrl: 'https://docs.searxng.org/',
    keyOptional: true,
    serviceKinds: ['search'],
    models: ['searxng-search'],
    modelCatalog: [{ id: 'searxng-search', name: 'SearXNG Meta-Search', kind: 'search', free: true }],
  },
  {
    preset: 'google-pse',
    name: 'Google PSE',
    category: 'service',
    tier: 'free',
    logo: 'google-pse',
    logoExt: 'png',
    badge: 'Web Search',
    color: '#4285F4',
    monogram: 'GP',
    baseUrl: 'https://customsearch.googleapis.com/customsearch/v1',
    formatType: 'openai',
    docsUrl: 'https://programmablesearchengine.google.com/',
    serviceKinds: ['search'],
    models: ['google-custom-search'],
    modelCatalog: [{ id: 'google-custom-search', name: 'Google Custom Search JSON', kind: 'search', free: true }],
  },
  {
    preset: 'linkup',
    name: 'Linkup Search',
    category: 'service',
    tier: 'free',
    logo: 'linkup',
    logoExt: 'png',
    badge: 'Web Search',
    color: '#0EA5E9',
    monogram: 'LU',
    baseUrl: 'https://api.linkup.so/v1',
    formatType: 'openai',
    docsUrl: 'https://app.linkup.so/',
    serviceKinds: ['search'],
    models: ['linkup-standard', 'linkup-deep'],
    modelCatalog: [
      { id: 'linkup-standard', name: 'Linkup Standard Search', kind: 'search', free: true },
      { id: 'linkup-deep', name: 'Linkup Deep Search', kind: 'search' },
    ],
  },
  {
    preset: 'searchapi',
    name: 'SearchAPI.io',
    category: 'service',
    tier: 'free',
    logo: 'searchapi',
    logoExt: 'png',
    badge: 'Web Search',
    color: '#6366F1',
    monogram: 'SA',
    baseUrl: 'https://www.searchapi.io/api/v1',
    formatType: 'openai',
    docsUrl: 'https://www.searchapi.io/dashboard',
    serviceKinds: ['search'],
    models: ['google-search'],
    modelCatalog: [{ id: 'google-search', name: 'SearchAPI Google SERP', kind: 'search' }],
  },

  // ============================================================================
  // 6. Expanded Presets & Custom Compatible
  // ============================================================================
  ...[
    { preset: 'kilocode', name: 'Kilo Code', category: 'free-tier', tier: 'free', logo: 'kilocode', badge: 'Device Auth', color: '#FF6B35', monogram: 'KC', baseUrl: 'https://api.kilo.ai/api/openrouter', formatType: 'openai', authStyle: 'bearer', authModes: ['device_code', 'apikey'], oauthType: 'kilocode', docsUrl: 'https://kilo.ai/dashboard?tab=apiKeys', serviceKinds: ['chat'], models: ['anthropic/claude-sonnet-4-20250514', 'google/gemini-2.5-pro', 'openai/gpt-4.1', 'deepseek/deepseek-chat'] },
    { preset: 'kilo-gateway', name: 'Kilo Gateway', category: 'free-tier', tier: 'free', logo: 'kilo-gateway', badge: 'Free Models', color: '#8B5CF6', monogram: 'KG', baseUrl: 'https://api.kilo.ai/api/gateway', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://kilo.ai/dashboard?tab=apiKeys', serviceKinds: ['chat'], models: ['kilo-auto/free', 'nvidia/nemotron-3-super-120b-a12b:free', 'kilo-auto/frontier'] },
    { preset: 'api-airforce', name: 'API.airforce', category: 'free-tier', tier: 'free', logo: 'api-airforce', badge: 'Free Tier', color: '#0EA5E9', monogram: 'AF', baseUrl: 'https://api.airforce/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://api.airforce', serviceKinds: ['chat'], models: ['gpt-oss-120b', 'gpt-oss-20b', 'kimi-k2.7-code'] },
    { preset: 'bazaarlink', name: 'Bazaarlink', category: 'free-tier', tier: 'free', logo: 'bazaarlink', badge: 'Free Tier', color: '#0F766E', monogram: 'BZ', baseUrl: 'https://bazaarlink.ai/api/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://bazaarlink.ai', serviceKinds: ['chat'], models: ['auto:free', 'claude-sonnet-4.6', 'gpt-5.4'] },
    { preset: 'poolside', name: 'Poolside', category: 'free-tier', tier: 'free', logo: 'poolside', badge: 'Free Tier', color: '#2563EB', monogram: 'PS', baseUrl: 'https://inference.poolside.ai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://platform.poolside.ai/api-keys', serviceKinds: ['chat'], models: ['poolside/laguna-s-2.1', 'poolside/laguna-xs-2.1'] },
    { preset: 'agnes', name: 'Agnes AI', category: 'free-tier', tier: 'free', logo: 'agnes', badge: 'Free Tier', color: '#7C3AED', monogram: 'AG', baseUrl: 'https://apihub.agnes-ai.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://platform.agnes-ai.com', serviceKinds: ['chat'], models: ['agnes-3.0-flash', 'agnes-2.5-pro'] },
    { preset: 'runcrate', name: 'Runcrate', category: 'free-tier', tier: 'free', logo: '', badge: 'Free Credits', color: '#16A34A', monogram: 'RC', baseUrl: 'https://api.runcrate.ai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://www.runcrate.ai/dashboard/api-keys', serviceKinds: ['chat'], models: ['deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3-Flash'] },
    { preset: 'opencode-zen', name: 'OpenCode Zen', category: 'apikey', tier: 'cheap', logo: 'opencode', badge: 'Coding Gateway', color: '#E87040', monogram: 'OZ', baseUrl: 'https://opencode.ai/zen/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://opencode.ai/auth', serviceKinds: ['chat'], models: ['claude-sonnet-4-6', 'gpt-5.4', 'deepseek-v4-flash'] },
    { preset: 'opencode-go', name: 'OpenCode Go', category: 'apikey', tier: 'cheap', logo: 'opencode-go', badge: 'Coding Plan', color: '#EA580C', monogram: 'OG', baseUrl: 'https://opencode.ai/inference/go/openai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://opencode.ai/auth', serviceKinds: ['chat'], models: ['deepseek-v4-flash', 'glm-5.3', 'kimi-k2.7-code'] },
    { preset: 'glm-cn', name: 'Zhipu GLM Coding (CN)', category: 'apikey', tier: 'cheap', logo: 'glm-cn', color: '#2563EB', monogram: 'GC', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys', serviceKinds: ['chat'], models: ['glm-5.3', 'glm-5.3-flash'] },
    { preset: 'minimax-cn', name: 'MiniMax Coding (CN)', category: 'apikey', tier: 'cheap', logo: 'minimax-cn', color: '#EC4899', monogram: 'MC', baseUrl: 'https://api.minimaxi.com/anthropic', formatType: 'anthropic', authStyle: 'x-api-key', docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', serviceKinds: ['chat'], models: ['MiniMax-M3', 'MiniMax-M2.7'] },
    { preset: 'alicode', name: 'Alibaba Coding (CN)', category: 'apikey', tier: 'cheap', logo: 'alicode', color: '#FF6A00', monogram: 'AC', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://bailian.console.aliyun.com/?apiKey=1', serviceKinds: ['chat'], models: ['qwen3.5-plus', 'qwen3-coder-next'] },
    { preset: 'alicode-intl', name: 'Alibaba Coding (Intl)', category: 'apikey', tier: 'cheap', logo: 'alicode-intl', color: '#FF6A00', monogram: 'AI', baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://www.alibabacloud.com/product/coding', serviceKinds: ['chat'], models: ['qwen3.5-plus', 'qwen3-coder-plus'] },
    { preset: 'alitp-intl', name: 'Alibaba Token Plan (Intl)', category: 'apikey', tier: 'cheap', logo: 'alitp-intl', color: '#EA580C', monogram: 'AT', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://modelstudio.console.alibabacloud.com/?apiKey=1', serviceKinds: ['chat'], models: ['qwen3.8-max-preview', 'qwen3.7-plus'] },
    { preset: 'volcengine-ark', name: 'Volcengine Ark (ByteDance)', category: 'apikey', tier: 'cheap', logo: 'volcengine-ark', color: '#2563EB', monogram: 'VA', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://console.volcengine.com/ark', serviceKinds: ['chat'], models: ['Doubao-Seed-2.0-Code', 'DeepSeek-V4-Flash'] },
    { preset: 'xiaomi-tokenplan', name: 'Xiaomi MiMo Token Plan', category: 'apikey', tier: 'cheap', logo: 'xiaomi-tokenplan', color: '#FF6900', monogram: 'XT', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://mimo.xiaomi.com', serviceKinds: ['chat'], models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'] },
    { preset: 'llm7', name: 'LLM7', category: 'apikey', tier: 'cheap', logo: 'llm7', color: '#7C3AED', monogram: 'L7', baseUrl: 'https://api.llm7.io/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://llm7.io', serviceKinds: ['chat'], models: ['gpt-5.5', 'claude-opus-5', 'deepseek-v4-flash'] },
    { preset: 'synthetic', name: 'Synthetic', category: 'apikey', tier: 'cheap', logo: '', color: '#0EA5E9', monogram: 'SY', baseUrl: 'https://api.synthetic.new/openai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://synthetic.new/user-settings/api', serviceKinds: ['chat'], models: ['hf:zai-org/GLM-5.3', 'hf:moonshotai/Kimi-K3'] },
    { preset: 'morph', name: 'Morph', category: 'apikey', tier: 'cheap', logo: 'morph', color: '#6366F1', monogram: 'MP', baseUrl: 'https://api.morphllm.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://morphllm.com', serviceKinds: ['chat'], models: ['morph-v3-large', 'morph-v3-fast'] },
    { preset: 'blackbox', name: 'Blackbox AI', category: 'apikey', tier: 'cheap', logo: 'blackbox', color: '#18181B', monogram: 'BB', baseUrl: 'https://api.blackbox.ai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://www.blackbox.ai/api-management', serviceKinds: ['chat'], models: ['claude-sonnet-4.6', 'gpt-5.4'] },
    { preset: 'tokenharbor', name: 'Token Harbor', category: 'apikey', tier: 'cheap', logo: 'tokenharbor', color: '#0284C7', monogram: 'TH', baseUrl: 'https://tokenharbor.ai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://tokenharbor.ai/dashboard', serviceKinds: ['chat'], models: ['claude-sonnet-5', 'deepseek-v4.1-flash:free'] },
    { preset: 'tokenrouter', name: 'TokenRouter', category: 'apikey', tier: 'cheap', logo: 'tokenrouter', color: '#4F46E5', monogram: 'TR', baseUrl: 'https://api.tokenrouter.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://www.tokenrouter.com', serviceKinds: ['chat'], models: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4'] },
    { preset: 'bluesminds', name: 'BluesMinds', category: 'apikey', tier: 'cheap', logo: 'bluesminds', color: '#2563EB', monogram: 'BM', baseUrl: 'https://api.bluesminds.com/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://bluesminds.com', serviceKinds: ['chat'], models: ['gpt-4.1', 'claude-sonnet-4-5'] },
    { preset: 'dahl', name: 'Dahl Inference', category: 'apikey', tier: 'cheap', logo: 'dahl', color: '#0D9488', monogram: 'DH', baseUrl: 'https://inference.dahl.global/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://dahl.global/dashboard', serviceKinds: ['chat'], models: ['zai-org/GLM-5.3-Flash', 'MiniMaxAI/MiniMax-M2.7'] },
    { preset: 'sensenova', name: 'SenseNova (CN)', category: 'apikey', tier: 'cheap', logo: 'sensenova', color: '#0284C7', monogram: 'SN', baseUrl: 'https://token.sensenova.cn/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://token.sensenova.cn', serviceKinds: ['chat'], models: ['sensenova-6.8-flash', 'deepseek-v4-flash'] },
    { preset: 'sensenova-intl', name: 'SenseNova (Intl)', category: 'apikey', tier: 'cheap', logo: 'sensenova-intl', color: '#0369A1', monogram: 'SI', baseUrl: 'https://token.sensenova.ai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://platform.sensenova.ai', serviceKinds: ['chat'], models: ['sensenova-6.8-flash'] },
    { preset: 'gitlab', name: 'GitLab Duo', category: 'apikey', tier: 'premium', logo: 'gitlab', badge: 'OAuth PKCE / PAT', color: '#FC6D26', monogram: 'GL', baseUrl: 'https://gitlab.com/api/v4', formatType: 'openai', authStyle: 'bearer', authModes: ['oauth_pkce', 'apikey'], oauthType: 'gitlab', docsUrl: 'https://docs.gitlab.com/ee/api/oauth2.html', serviceKinds: ['chat'], models: ['duo-chat', 'claude-sonnet-4-20250514'] },
    { preset: 'vertex-partner', name: 'Vertex Partner', category: 'apikey', tier: 'premium', logo: 'vertex-partner', color: '#4285F4', monogram: 'VP', baseUrl: 'https://aiplatform.googleapis.com/v1', formatType: 'openai', authStyle: 'bearer', authModes: ['apikey', 'json'], docsUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts', serviceKinds: ['chat'], models: ['deepseek-ai/deepseek-v3.2-maas'] },
    { preset: 'bedrock-xai', name: 'AWS Bedrock (xAI)', category: 'apikey', tier: 'premium', logo: 'bedrock-xai', color: '#FF9900', monogram: 'BX', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://aws.amazon.com/bedrock/', serviceKinds: ['chat'], models: ['us.xai.grok-4.6'] },
    { preset: 'comfyui', name: 'ComfyUI', category: 'local', tier: 'local', logo: 'comfyui', badge: 'Local Image', color: '#111827', monogram: 'CF', baseUrl: 'http://localhost:8188', formatType: 'openai', authStyle: 'none', keyOptional: true, docsUrl: 'https://github.com/comfyanonymous/ComfyUI', serviceKinds: ['image'], models: ['flux-dev', 'sdxl'] },
    { preset: 'sdwebui', name: 'SD WebUI', category: 'local', tier: 'local', logo: 'sdwebui', badge: 'Local Image', color: '#6366F1', monogram: 'SD', baseUrl: 'http://localhost:7860', formatType: 'openai', authStyle: 'none', keyOptional: true, docsUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui', serviceKinds: ['image'], models: ['stable-diffusion-v1-5', 'sdxl-base-1.0'] },
    { preset: 'cartesia', name: 'Cartesia', category: 'service', tier: 'cheap', logo: 'cartesia', badge: 'TTS', color: '#4F46E5', monogram: 'CT', baseUrl: 'https://api.cartesia.ai', formatType: 'openai', authStyle: 'x-api-key', docsUrl: 'https://play.cartesia.ai/keys', serviceKinds: ['tts'], models: [] },
    { preset: 'fish-audio', name: 'Fish Audio', category: 'service', tier: 'cheap', logo: 'fish-audio', badge: 'TTS', color: '#0EA5E9', monogram: 'FA', baseUrl: 'https://api.fish.audio/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://fish.audio/app/api-keys/', serviceKinds: ['tts'], models: [] },
    { preset: 'inworld', name: 'Inworld TTS', category: 'service', tier: 'cheap', logo: 'inworld', badge: 'TTS', color: '#7C3AED', monogram: 'IW', baseUrl: 'https://api.inworld.ai/tts/v1', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://platform.inworld.ai/api-keys', serviceKinds: ['tts'], models: [] },
    { preset: 'playht', name: 'PlayHT', category: 'service', tier: 'cheap', logo: 'playht', badge: 'TTS', color: '#10B981', monogram: 'PH', baseUrl: 'https://api.play.ht/api/v2', formatType: 'openai', authStyle: 'bearer', docsUrl: 'https://play.ht/studio/api-access', serviceKinds: ['tts'], models: [] },
    { preset: 'youcom', name: 'You.com Search', category: 'service', tier: 'cheap', logo: 'youcom', badge: 'Search', color: '#2563EB', monogram: 'YC', baseUrl: 'https://api.ydc-index.io', formatType: 'openai', authStyle: 'x-api-key', docsUrl: 'https://api.you.com', serviceKinds: ['search'], models: [] },
    { preset: 'custom-openai', name: 'Custom OpenAI-Compatible', category: 'custom', tier: 'premium', logo: 'oai-cc', badge: 'Custom', color: '#64748B', monogram: 'CO', baseUrl: '', formatType: 'openai', authStyle: 'bearer', authModes: ['apikey', 'json', 'oauth_pkce', 'device_code'], oauthType: 'custom_oauth', serviceKinds: ['chat'], models: [] },
    { preset: 'custom-anthropic', name: 'Custom Anthropic-Compatible', category: 'custom', tier: 'premium', logo: 'anthropic-m', badge: 'Custom', color: '#B45309', monogram: 'CA', baseUrl: '', formatType: 'anthropic', authStyle: 'x-api-key', authModes: ['apikey', 'json', 'oauth_pkce', 'device_code'], oauthType: 'custom_oauth', serviceKinds: ['chat'], models: [] },
  ].map((x) => ({
    keyOptional: false,
    docsUrl: '',
    logoExt: 'png',
    ...x,
    modelCatalog: (x.models || []).map((id) => ({ id, name: id, kind: x.serviceKinds?.[0] || 'chat' })),
  })),
  {
    preset: 'custom',
    name: 'Custom Provider',
    category: 'custom',
    tier: 'premium',
    color: '#E56A4A',
    monogram: 'CU',
    baseUrl: '',
    formatType: 'openai',
    authModes: ['apikey', 'json', 'oauth_pkce', 'device_code'],
    oauthType: 'custom_oauth',
    serviceKinds: ['chat'],
    models: [],
    modelCatalog: [],
  },
];

const FALLBACK_BY_ID = new Map(FALLBACK_PRESETS.map((p) => [p.preset, p]));

export function normalizePresetItem(p) {
  const id = p.preset || p.id || p.slug || 'custom';
  const fb = FALLBACK_BY_ID.get(id);
  const models = Array.isArray(p.models)
    ? p.models
    : Array.isArray(p.defaultModels)
      ? p.defaultModels
      : fb?.models || [];
  const modelCatalog =
    Array.isArray(p.modelCatalog) && p.modelCatalog.length > 0
      ? p.modelCatalog
      : fb?.modelCatalog || toCatalogEntries(models);

  return {
    preset: id,
    name: p.name || p.label || fb?.name || id,
    category: p.category || fb?.category || 'apikey',
    tier: p.tier || fb?.tier || (p.category === 'free-tier' ? 'free' : p.category === 'local' ? 'local' : 'premium'),
    logo: p.logo || fb?.logo || id,
    logoExt: p.logoExt || fb?.logoExt || 'png',
    badge: p.badge ?? fb?.badge,
    color: p.color || fb?.color || '#E56A4A',
    monogram: p.monogram || fb?.monogram || String(p.name || id).slice(0, 2).toUpperCase(),
    baseUrl: p.baseUrl ?? fb?.baseUrl ?? '',
    formatType: p.formatType || fb?.formatType || 'openai',
    authStyle: p.authStyle || fb?.authStyle || 'bearer',
    authModes: Array.isArray(p.authModes) ? p.authModes : fb?.authModes || [],
    oauthType: p.oauthType || fb?.oauthType || '',
    docsUrl: p.docsUrl || fb?.docsUrl || '',
    keyOptional: Boolean(p.keyOptional ?? fb?.keyOptional),
    serviceKinds:
      Array.isArray(p.serviceKinds) && p.serviceKinds.length > 0
        ? p.serviceKinds
        : fb?.serviceKinds || ['chat'],
    models,
    modelCatalog,
    catalogUpdatedAt: p.catalogUpdatedAt || null,
  };
}

export function formatContextWindow(tokens) {
  const num = Number(tokens || 0);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num >= 1_000_000) {
    const m = num / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${Math.round(num / 1000)}K`;
  }
  return String(num);
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatNumber(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatCompactNumber(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return '0';
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

export function formatRelativeTime(isoOrMs) {
  if (!isoOrMs) return 'Never';
  const date = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function formatTimestamp(isoOrMs) {
  if (!isoOrMs) return '—';
  const date = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to textarea selection copy
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
