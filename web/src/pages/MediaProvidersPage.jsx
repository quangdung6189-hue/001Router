import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import {
  ArrowRight,
  AudioLines,
  Database,
  Globe,
  Image as ImageIcon,
  Layers,
  Mic,
  RefreshCw,
  Search,
  Video,
} from 'lucide-react';
import { FALLBACK_PRESETS, MEDIA_PROVIDER_KINDS, providersApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { Switch } from '../components/Switch';

const KIND_ICON = {
  embedding: Database,
  image: ImageIcon,
  video: Video,
  tts: AudioLines,
  stt: Mic,
  systemone: Layers,
  web: Globe,
};

function MediaProviderGrid({ items, connectedByPreset, targetKindId, matchKinds, onToggle }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((pr) => {
        const connected = connectedByPreset.get(pr.preset);
        const targetId = connected ? connected.id : pr.preset;
        const isLocal = pr.category === 'local' || pr.keyOptional;
        const catalogMatches = Array.isArray(pr.modelCatalog)
          ? pr.modelCatalog.filter((m) => matchKinds.includes(m?.kind))
          : [];
        const modelCount =
          catalogMatches.length > 0
            ? catalogMatches.length
            : (connected?.models || pr.models || []).length;

        return (
          <article
            key={pr.preset}
            className={`r-card flex flex-col justify-between p-3.5 transition-colors hover:border-[#E56A4A]/60 ${
              connected ? 'border-[var(--border-strong)]' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <ProviderLogo
                  preset={pr.preset}
                  logo={pr.logo}
                  logoExt={pr.logoExt}
                  name={connected?.name || pr.name}
                  color={pr.color}
                  size="sm"
                />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {connected?.name || pr.name}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {connected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Connected
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]">Not connected</span>
                    )}
                    {isLocal ? (
                      <span className="rounded-full bg-sky-500/15 px-1.5 py-0.2 text-[10px] font-medium text-sky-400">
                        Local
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {connected ? (
                <Switch
                  size="sm"
                  checked={connected.enabled !== false}
                  onChange={(val) => onToggle(connected, val)}
                  aria-label={`Toggle ${connected.name}`}
                />
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {modelCount} model(s)
              </span>
              <Link
                to={`/media-providers/${targetKindId}/${encodeURIComponent(targetId)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#E56A4A] hover:underline"
              >
                {connected ? 'Configure' : 'Connect'}
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function MediaProvidersPage({ forcedKind }) {
  const { kind } = useParams();
  const activeKindId = forcedKind || kind || 'image';
  const toast = useToast();

  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const kindMeta = useMemo(
    () => MEDIA_PROVIDER_KINDS.find((k) => k.id === activeKindId) || MEDIA_PROVIDER_KINDS[0],
    [activeKindId]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await providersApi.list();
      setProviders(res?.providers || []);
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
      if (p.preset) map.set(p.preset, p);
    }
    return map;
  }, [providers]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return FALLBACK_PRESETS.filter((pr) => {
      const sk = pr.serviceKinds || [];
      const cat = pr.modelCatalog || [];
      const matchesKind =
        kindMeta.kinds.some((k) => sk.includes(k)) || cat.some((m) => kindMeta.kinds.includes(m?.kind));
      if (!matchesKind) return false;
      if (!q) return true;
      return `${pr.name} ${pr.preset} ${pr.badge || ''}`.toLowerCase().includes(q);
    });
  }, [kindMeta, search]);

  const webSearchItems = useMemo(
    () =>
      items.filter(
        (pr) =>
          (pr.serviceKinds || []).includes('search') ||
          (pr.modelCatalog || []).some((m) => m?.kind === 'search')
      ),
    [items]
  );

  const webFetchItems = useMemo(
    () =>
      items.filter(
        (pr) =>
          (pr.serviceKinds || []).includes('fetch') ||
          (pr.modelCatalog || []).some((m) => m?.kind === 'fetch')
      ),
    [items]
  );

  const handleQuickToggle = async (prov, nextEnabled) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === prov.id ? { ...p, enabled: nextEnabled } : p))
    );
    try {
      await providersApi.update(prov.id, { enabled: nextEnabled });
      toast.success(`${prov.name} ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setProviders((prev) =>
        prev.map((p) => (p.id === prov.id ? { ...p, enabled: prov.enabled } : p))
      );
      toast.error(err?.message || 'Failed to update status');
    }
  };

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:20128';
  const KindIcon = KIND_ICON[kindMeta.id] || Database;

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar matching 9Router Media Providers */}
      <nav aria-label="Media Provider Kinds" className="flex flex-wrap gap-1.5">
        {MEDIA_PROVIDER_KINDS.map((k) => {
          const Icon = KIND_ICON[k.id] || Database;
          return (
            <NavLink
              key={k.id}
              to={`/media-providers/${k.id}`}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[#E56A4A]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
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
      <section className="r-card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E56A4A]/14 text-[#E56A4A]">
            <KindIcon className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {kindMeta.label} ({items.length})
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

      {kindMeta.id === 'web' ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Web Search Providers
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Route <code className="font-mono">POST /v1/search</code> queries.
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{webSearchItems.length}</span>
            </div>
            <MediaProviderGrid
              items={webSearchItems}
              connectedByPreset={connectedByPreset}
              targetKindId="web"
              matchKinds={['search']}
              onToggle={handleQuickToggle}
            />
          </section>

          <section className="space-y-3 border-t border-[var(--border-subtle)] pt-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Web Fetch Providers
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Extract clean Markdown via <code className="font-mono">POST /v1/web/fetch</code>.
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{webFetchItems.length}</span>
            </div>
            <MediaProviderGrid
              items={webFetchItems}
              connectedByPreset={connectedByPreset}
              targetKindId="web"
              matchKinds={['fetch']}
              onToggle={handleQuickToggle}
            />
          </section>
        </div>
      ) : (
        <MediaProviderGrid
          items={items}
          connectedByPreset={connectedByPreset}
          targetKindId={kindMeta.id}
          matchKinds={kindMeta.kinds}
          onToggle={handleQuickToggle}
        />
      )}
    </div>
  );
}

export default MediaProvidersPage;
