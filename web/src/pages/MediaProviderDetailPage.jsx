import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Globe,
  KeyRound,
  Play,
  Plus,
  Search,
  Sparkles,
  Volume2,
} from 'lucide-react';
import {
  catalogApi,
  FALLBACK_PRESETS,
  getRememberedRouterKey,
  keysApi,
  mediaApi,
  MEDIA_PROVIDER_KINDS,
  providersApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { CopyButton } from '../components/CopyButton';
import { ProviderLogo } from '../components/ProviderLogo';

export function MediaProviderDetailPage() {
  const { kind = 'embedding', id = '' } = useParams();
  const toast = useToast();

  const [provider, setProvider] = useState(null);
  const [preset, setPreset] = useState(null);
  const [routerKeys, setRouterKeys] = useState([]);
  const [routerKeyInput, setRouterKeyInput] = useState('');
  const [loading, setLoading] = useState(true);

  // Quick connect form (when preset not yet connected)
  const [connectBaseUrl, setConnectBaseUrl] = useState('');
  const [connectApiKey, setConnectApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Try-It Playground state
  const [selectedModel, setSelectedModel] = useState('');
  const [promptInput, setPromptInput] = useState('A cozy cyberpunk coffee shop in Tokyo, neon rain');
  const [embedInput, setEmbedInput] = useState('001Router unifies all AI media providers locally.');
  const [ttsInput, setTtsInput] = useState('Hello from 001Router local text to speech gateway.');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [voices, setVoices] = useState(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
  const [webTab, setWebTab] = useState('search'); // search | fetch
  const [searchQuery, setSearchQuery] = useState('latest open source LLM benchmarks 2026');
  const [fetchUrl, setFetchUrl] = useState('https://example.com');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');

  const kindMeta = useMemo(
    () => MEDIA_PROVIDER_KINDS.find((k) => k.id === kind) || MEDIA_PROVIDER_KINDS[0],
    [kind]
  );
  const effectiveKind = kindMeta.id;

  const getKindModels = useCallback(
    (prov, pr) => {
      const catModels = Array.isArray(pr?.modelCatalog)
        ? pr.modelCatalog
            .filter((m) => m?.id && kindMeta.kinds.includes(m.kind))
            .map((m) => m.id)
        : [];
      if (catModels.length > 0) return catModels;
      if (Array.isArray(prov?.models) && prov.models.length > 0) return prov.models;
      return Array.isArray(pr?.models) ? pr.models : [];
    },
    [kindMeta]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setOutput(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    try {
      const [provListRes, catRes, keysRes] = await Promise.all([
        providersApi.list(),
        catalogApi.get().catch(() => null),
        keysApi.list().catch(() => ({ keys: [] })),
      ]);
      const allProviders = provListRes?.providers || [];
      const serverPresets =
        Array.isArray(provListRes?.presets) && provListRes.presets.length > 0
          ? provListRes.presets
          : Array.isArray(catRes?.presets) && catRes.presets.length > 0
            ? catRes.presets
            : [];
      const allPresets =
        serverPresets.length > 0
          ? [
              ...serverPresets,
              ...FALLBACK_PRESETS.filter(
                (fb) => !serverPresets.some((sp) => sp.preset === fb.preset)
              ),
            ]
          : FALLBACK_PRESETS;

      const matchedProvider =
        allProviders.find((p) => p.id === id || p.slug === id || p.preset === id) || null;
      const matchedPreset =
        allPresets.find(
          (pr) => pr.preset === (matchedProvider?.preset || id) || pr.preset === id
        ) || null;

      setProvider(matchedProvider);
      setPreset(matchedPreset);
      setConnectBaseUrl(matchedProvider?.baseUrl || matchedPreset?.baseUrl || '');

      const models = getKindModels(matchedProvider, matchedPreset);
      setSelectedModel((prev) => (models.includes(prev) ? prev : models[0] || ''));

      const loadedKeys = keysRes?.keys || [];
      setRouterKeys(loadedKeys);
      for (const k of loadedKeys) {
        const known = getRememberedRouterKey(k);
        if (known) {
          setRouterKeyInput((prev) => prev || known);
          break;
        }
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load media provider');
    } finally {
      setLoading(false);
    }
  }, [id, effectiveKind, getKindModels, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (effectiveKind !== 'tts') return;
    mediaApi
      .voices(routerKeyInput)
      .then((res) => {
        const rawList = Array.isArray(res?.voices)
          ? res.voices
          : res?.voices && typeof res.voices === 'object'
            ? Object.values(res.voices).flat()
            : [];
        if (rawList.length > 0) {
          const ids = [
            ...new Set(
              rawList.map((v) => (typeof v === 'string' ? v : v?.id || v?.name)).filter(Boolean)
            ),
          ];
          if (ids.length > 0) {
            setVoices(ids);
            setTtsVoice((prev) => (ids.includes(prev) ? prev : ids[0]));
          }
        }
      })
      .catch(() => {});
  }, [effectiveKind, routerKeyInput]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleQuickConnect = async (e) => {
    e.preventDefault();
    if (!preset) return;
    setConnecting(true);
    try {
      const seedModels =
        Array.isArray(preset.models) && preset.models.length > 0
          ? preset.models
          : Array.isArray(preset.modelCatalog)
            ? preset.modelCatalog.map((m) => m?.id).filter(Boolean)
            : [];
      const payload = {
        preset: preset.preset,
        name: preset.name,
        slug: preset.preset,
        baseUrl: connectBaseUrl.trim() || preset.baseUrl,
        formatType: preset.formatType || 'openai',
        models: seedModels,
        apiKeys: connectApiKey.trim()
          ? [{ label: 'Primary Key', key: connectApiKey.trim(), enabled: true }]
          : [],
        enabled: true,
      };
      const res = await providersApi.create(payload);
      if (res?.provider) {
        setProvider(res.provider);
        setConnectApiKey('');
        toast.success(`Connected ${preset.name}!`);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to connect provider');
    } finally {
      setConnecting(false);
    }
  };

  const slug = provider?.slug || preset?.preset || id;
  const fullModelId = selectedModel ? `${slug}/${selectedModel}` : slug;
  const origin = window.location.origin;

  const curlSnippet = useMemo(() => {
    const authHdr = `  -H "Authorization: Bearer ${routerKeyInput || 'sk-001r-YOUR_KEY'}" \\\n`;
    if (effectiveKind === 'embedding') {
      return `curl -X POST ${origin}/v1/embeddings \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: fullModelId, input: embedInput })}'`;
    }
    if (effectiveKind === 'image') {
      return `curl -X POST ${origin}/v1/images/generations \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: fullModelId, prompt: promptInput, size: '1024x1024' })}'`;
    }
    if (effectiveKind === 'video') {
      return `curl -X POST ${origin}/v1/videos/generations \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: fullModelId, prompt: promptInput })}'`;
    }
    if (effectiveKind === 'tts') {
      return `curl -X POST ${origin}/v1/audio/speech \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: fullModelId, input: ttsInput, voice: ttsVoice })}' \\\n  --output speech.mp3`;
    }
    if (effectiveKind === 'stt') {
      return `curl -X POST ${origin}/v1/audio/transcriptions \\\n${authHdr}  -F "model=${fullModelId}" \\\n  -F "file=@sample.wav"`;
    }
    if (webTab === 'fetch') {
      return `curl -X POST ${origin}/v1/web/fetch \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ provider: slug, url: fetchUrl })}'`;
    }
    return `curl -X POST ${origin}/v1/search \\\n${authHdr}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ provider: slug, query: searchQuery, max_results: 5 })}'`;
  }, [effectiveKind, origin, routerKeyInput, fullModelId, embedInput, promptInput, ttsInput, ttsVoice, webTab, slug, fetchUrl, searchQuery]);

  const handleRunTryIt = async (e) => {
    e.preventDefault();
    setRunning(true);
    setOutput(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl('');
    }
    try {
      if (effectiveKind === 'embedding') {
        const res = await mediaApi.embeddings(
          { model: fullModelId, input: embedInput },
          routerKeyInput
        );
        setOutput({ type: 'json', data: res });
      } else if (effectiveKind === 'image') {
        const res = await mediaApi.generateImage(
          { model: fullModelId, prompt: promptInput, size: '1024x1024' },
          routerKeyInput
        );
        setOutput({ type: 'image', data: res });
      } else if (effectiveKind === 'video') {
        const res = await mediaApi.generateVideo(
          { model: fullModelId, prompt: promptInput },
          routerKeyInput
        );
        setOutput({ type: 'json', data: res });
      } else if (effectiveKind === 'tts') {
        const blob = await mediaApi.generateSpeech(
          { model: fullModelId, input: ttsInput, voice: ttsVoice },
          routerKeyInput
        );
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setOutput({ type: 'audio', size: blob.size, mime: blob.type });
      } else if (effectiveKind === 'web') {
        if (webTab === 'fetch') {
          const res = await mediaApi.webFetch({ provider: slug, url: fetchUrl }, routerKeyInput);
          setOutput({ type: 'json', data: res });
        } else {
          const res = await mediaApi.search(
            { provider: slug, query: searchQuery, max_results: 5 },
            routerKeyInput
          );
          setOutput({ type: 'json', data: res });
        }
      }
      toast.success('Request completed');
    } catch (err) {
      setOutput({ type: 'error', message: err?.message || 'Request failed' });
      toast.error(err?.message || 'Live request failed');
    } finally {
      setRunning(false);
    }
  };

  const modelsList = useMemo(
    () => getKindModels(provider, preset),
    [getKindModels, provider, preset]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="r-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3.5">
          <Link
            to={`/media-providers/${effectiveKind}`}
            aria-label={`Back to ${kindMeta.label}`}
            className="r-btn-secondary flex h-9 w-9 items-center justify-center p-0"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ProviderLogo
            preset={preset?.preset || slug}
            logo={preset?.logo}
            name={provider?.name || preset?.name || id}
            color={preset?.color}
            size="lg"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {provider?.name || preset?.name || id}
              </h2>
              <span className="rounded-full bg-[#E56A4A]/14 px-2 py-0.5 text-[10.5px] font-semibold text-[#E56A4A]">
                {kindMeta.label}
              </span>
              {provider ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400">
                  Connected
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400">
                  Not Connected
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-[var(--text-secondary)]">
              {provider?.baseUrl || preset?.baseUrl || 'Custom endpoint'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {provider ? (
            <Link
              to={`/providers/${provider.id}`}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              Manage Keys &amp; Models
            </Link>
          ) : null}
          {preset?.docsUrl ? (
            <a
              href={preset.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              Official Docs
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </section>

      {/* Quick Connect Card if Not Yet Connected */}
      {!loading && !provider && preset ? (
        <section className="r-card border-[#E56A4A]/40 p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Quick Connect {preset.name}
          </h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {preset.keyOptional
              ? 'Self-hosted / local media endpoint — API key is optional.'
              : 'Enter your official API key to activate this provider.'}
          </p>
          <form onSubmit={handleQuickConnect} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input
              type="url"
              required
              value={connectBaseUrl}
              onChange={(e) => setConnectBaseUrl(e.target.value)}
              placeholder="Base URL"
              className="field-input px-3 py-2 font-mono text-xs"
            />
            <input
              type="password"
              required={!preset.keyOptional}
              value={connectApiKey}
              onChange={(e) => setConnectApiKey(e.target.value)}
              placeholder={preset.keyOptional ? 'API Key (optional)' : 'Official API Key'}
              className="field-input px-3 py-2 font-mono text-xs"
            />
            <button
              type="submit"
              disabled={connecting}
              className="r-btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {connecting ? 'Connecting…' : `Connect ${preset.name}`}
            </button>
          </form>
        </section>
      ) : null}

      {/* Interactive Live Try-It Card (9Router Media Detail Parity) */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Live Try-It Example ({kindMeta.endpoint})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={routerKeyInput}
              onChange={(e) => setRouterKeyInput(e.target.value)}
              placeholder={
                routerKeys.length > 0
                  ? 'Router Key (sk-001r-...) for auth'
                  : 'Optional Router Key'
              }
              aria-label="Router API Key for live test"
              className="field-input w-56 px-2.5 py-1.5 font-mono text-xs"
            />
          </div>
        </div>

        {effectiveKind === 'web' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWebTab('search')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                webTab === 'search'
                  ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
              }`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Web Search (/v1/search)
            </button>
            <button
              type="button"
              onClick={() => setWebTab('fetch')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                webTab === 'fetch'
                  ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
              }`}
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              Web Fetch (/v1/web/fetch)
            </button>
          </div>
        ) : null}

        {effectiveKind === 'stt' ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--text-secondary)]">
            Speech-to-Text accepts <code>multipart/form-data</code> audio uploads (WAV, MP3, M4A,
            WebM) at <code>POST {origin}/v1/audio/transcriptions</code>. Use the copyable cURL
            command below to test with any local audio file.
          </div>
        ) : (
          <form onSubmit={handleRunTryIt} className="space-y-3">
            {modelsList.length > 0 && effectiveKind !== 'web' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)]">
                    Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="field-input mt-1 w-full px-3 py-2 font-mono text-xs"
                  >
                    {modelsList.map((m) => (
                      <option key={m} value={m}>
                        {slug}/{m}
                      </option>
                    ))}
                  </select>
                </div>
                {effectiveKind === 'tts' ? (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)]">
                      Voice
                    </label>
                    <select
                      value={ttsVoice}
                      onChange={(e) => setTtsVoice(e.target.value)}
                      className="field-input mt-1 w-full px-3 py-2 font-mono text-xs"
                    >
                      {voices.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}

            {effectiveKind === 'embedding' ? (
              <textarea
                rows={3}
                value={embedInput}
                onChange={(e) => setEmbedInput(e.target.value)}
                className="field-input w-full p-3 text-xs"
                placeholder="Text to embed…"
              />
            ) : effectiveKind === 'image' || effectiveKind === 'video' ? (
              <textarea
                rows={3}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                className="field-input w-full p-3 text-xs"
                placeholder="Prompt…"
              />
            ) : effectiveKind === 'tts' ? (
              <textarea
                rows={3}
                value={ttsInput}
                onChange={(e) => setTtsInput(e.target.value)}
                className="field-input w-full p-3 text-xs"
                placeholder="Text to synthesize…"
              />
            ) : webTab === 'fetch' ? (
              <input
                type="url"
                value={fetchUrl}
                onChange={(e) => setFetchUrl(e.target.value)}
                className="field-input w-full px-3 py-2 font-mono text-xs"
                placeholder="https://example.com"
              />
            ) : (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field-input w-full px-3 py-2 text-xs"
                placeholder="Search query…"
              />
            )}

            <button
              type="submit"
              disabled={running}
              className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {running ? 'Running…' : 'Send Live Request'}
            </button>
          </form>
        )}

        {/* Output Preview */}
        {audioUrl ? (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/8 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Volume2 className="h-4 w-4" aria-hidden="true" />
              Synthesized Audio Ready ({output?.size || 0} bytes)
            </div>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        ) : null}

        {output?.type === 'image' ? (
          <div className="space-y-3">
            {(output.data?.data || []).map((img, i) => {
              const src = img.url || (img.b64_json ? `data:image/png;base64,${img.b64_json}` : '');
              return src ? (
                <img
                  key={i}
                  src={src}
                  alt="Generated output"
                  className="max-h-96 rounded-xl border border-[var(--border-subtle)]"
                />
              ) : null;
            })}
            <pre className="code-surface max-h-60 overflow-auto rounded-lg border p-3 font-mono text-[11px]">
              {JSON.stringify(output.data, null, 2)}
            </pre>
          </div>
        ) : null}

        {output?.type === 'json' ? (
          <pre className="code-surface max-h-72 overflow-auto rounded-lg border p-3 font-mono text-[11px]">
            {JSON.stringify(output.data, null, 2)}
          </pre>
        ) : null}

        {output?.type === 'error' ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-400">
            {output.message}
          </div>
        ) : null}

        {/* Copyable cURL */}
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)]">cURL Example</span>
            <CopyButton value={curlSnippet} size="xs" label="Copy cURL" />
          </div>
          <pre className="code-surface overflow-x-auto rounded-lg border p-3 font-mono text-[11px]">
            {curlSnippet}
          </pre>
        </div>
      </section>
    </div>
  );
}
