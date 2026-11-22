import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Cpu,
  Film,
  Globe,
  Image,
  Mic,
  RefreshCw,
  Search,
  Volume2,
} from 'lucide-react';
import {
  catalogApi,
  FALLBACK_PRESETS,
  MEDIA_PROVIDER_KINDS,
  providersApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { CopyButton } from '../components/CopyButton';
import { ProviderLogo } from '../components/ProviderLogo';
import { Switch } from '../components/Switch';

const KIND_ICONS = {
  embedding: Cpu,
  image: Image,
  video: Film,
  tts: Volume2,
  stt: Mic,
  web: Globe,
};

function matchesMediaKinds(presetObj, targetKinds) {
  const services = Array.isArray(presetObj?.serviceKinds)
    ? presetObj.serviceKinds
    : presetObj?.serviceKind
      ? [presetObj.serviceKind]
      : [];
  const catalogKinds = (presetObj?.modelCatalog || []).map((m) => m.kind).filter(Boolean);
  const combined = new Set([...services, ...catalogKinds]);

  // Also match self-hosted presets explicitly by slug
  const p = String(presetObj?.preset || presetObj?.slug || '').toLowerCase();
  if (p.includes('embedding') || p === 'voyage' || p === 'jina' || p === 'cohere') {
    combined.add('embedding');
  }
  if (p.includes('image') || p === 'fal' || p === 'bfl' || p === 'stability' || p === 'recraft') {
    combined.add('image');
  }
  if (p === 'fal' || p === 'runway' || p === 'luma' || p === 'kling') {
    combined.add('video');
  }
  if (p.includes('tts') || p === 'elevenlabs' || p === 'deepgram' || p === 'openai') {
    combined.add('tts');
  }
  if (p.includes('stt') || p === 'deepgram' || p === 'assemblyai' || p === 'groq' || p === 'openai') {
    combined.add('stt');
  }
  if (
    p === 'tavily' ||
    p === 'brave' ||
    p === 'serper' ||
    p === 'exa' ||
    p === 'linkup' ||
    p === 'searxng' ||
    p === 'searchapi' ||
    p === 'google-pse' ||
    p === 'firecrawl' ||
    p === 'jina'
  ) {
    combined.add('search');
    combined.add('fetch');
  }
  return targetKinds.some((k) => combined.has(k));
}

export function MediaProvidersPage({ forcedKind = '' }) {
  const params = useParams();
  const kind = forcedKind || params.kind || 'embedding';
  const toast = useToast();

  const [providers, setProviders] = useState([]);
  const [presets, setPresets] = useState(FALLBACK_PRESETS);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const kindMeta = useMemo(
    () => MEDIA_PROVIDER_KINDS.find((k) => k.id === kind) || MEDIA_PROVIDER_KINDS[0],
    [kind]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [provRes, catRes] = await Promise.all([
        providersApi.list(),
        catalogApi.get().catch(() => null),
      ]);
      setProviders(provRes?.providers || []);
      if (Array.isArray(catRes?.presets) && catRes.presets.length > 0) {
        setPresets(catRes.presets);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load media providers');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const connectedByPreset = useMemo(() => {
    const map = new Map();
    for (const p of providers) {
      map.set(p.preset || p.slug, p);
      map.set(p.slug, p);
    }
    return map;
  }, [providers]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = presets.filter((pr) => matchesMediaKinds(pr, kindMeta.kinds));
    // Include any connected custom provider matching kind
    const seen = new Set(list.map((p) => p.preset));
    for (const cp of providers) {
      if (!seen.has(cp.preset) && matchesMediaKinds(cp, kindMeta.kinds)) {
        list.push({
          preset: cp.preset || cp.slug,
          name: cp.name,
          baseUrl: cp.baseUrl,
          models: cp.models || [],
        });
      }
    }
    return list
      .filter((pr) => {
        if (!q) return true;
        return `${pr.name} ${pr.preset} ${(pr.models || []).join(' ')}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        const ac = connectedByPreset.has(a.preset) ? 0 : 1;
        const bc = connectedByPreset.has(b.preset) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [presets, providers, kindMeta.kinds, search, connectedByPreset]);

  const handleQuickToggle = async (prov, nextEnabled) => {
    try {
      const res = await providersApi.update(prov.id, { enabled: nextEnabled });
      if (res?.provider) {
        setProviders((prev) => prev.map((p) => (p.id === prov.id ? res.provider : p)));
      }
      toast.success(`${prov.name} ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to update provider');
    }
  };

  const KindIcon = KIND_ICONS[kindMeta.id] || Cpu;
  const origin = window.location.origin;

  return (
    <div className="space-y-6">
      {/* Kind Navigation Pills */}
      <nav
        aria-label="Media provider categories"
        className="flex flex-wrap items-center gap-2"
      >
        {MEDIA_PROVIDER_KINDS.map((k) => {
          const Icon = KIND_ICONS[k.id] || Cpu;
          return (
            <NavLink
              key={k.id}
              to={`/media-providers/${k.id}`}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {k.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Endpoint Info Banner */}
      <section className="r-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E56A4A]/14 text-[#E56A4A]">
            <KindIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {kindMeta.label} Providers ({items.length})
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{kindMeta.desc}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-1.5">
            <code className="font-mono text-xs text-[#E56A4A]">{kindMeta.endpoint}</code>
            <CopyButton
              value={`${origin}${kindMeta.endpoint.split(' ')[1] || '/v1'}`}
              size="xs"
              iconOnly
              label="Copy endpoint URL"
            />
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
      </section>

      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${kindMeta.label.toLowerCase()} providers…`}
          className="field-input w-full py-2 pr-3 pl-9 text-xs"
        />
      </div>

      {/* Providers Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((pr) => {
          const connected = connectedByPreset.get(pr.preset);
          const targetId = connected ? connected.id : pr.preset;
          const isLocal = pr.category === 'local' || pr.keyOptional;

          return (
            <article
              key={pr.preset}
              className={`r-card flex flex-col justify-between p-4 transition-colors hover:border-[#E56A4A]/60 ${
                connected ? 'border-[var(--border-strong)]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderLogo
                    preset={pr.preset}
                    logo={pr.logo}
                    logoExt={pr.logoExt}
                    name={connected?.name || pr.name}
                    color={pr.color}
                    size="md"
                  />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {connected?.name || pr.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {connected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Connected
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">Not connected</span>
                      )}
                      {isLocal ? (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-400">
                          Self-Hosted
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {connected ? (
                  <Switch
                    size="sm"
                    checked={connected.enabled !== false}
                    onChange={(val) => handleQuickToggle(connected, val)}
                    aria-label={`Toggle ${connected.name}`}
                  />
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  {(connected?.models || pr.models || []).length} model(s)
                </span>
                <Link
                  to={`/media-providers/${kindMeta.id}/${encodeURIComponent(targetId)}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E56A4A] hover:underline"
                >
                  {connected ? 'Configure & Try It' : 'Connect & Try It'}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
