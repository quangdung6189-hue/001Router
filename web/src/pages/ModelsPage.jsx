import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowUpDown,
  Brain,
  Calendar,
  Clock,
  Cpu,
  Eye,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  catalogApi,
  FALLBACK_PRESETS,
  formatContextWindow,
  formatNumber,
  normalizePresetItem,
  providersApi,
  settingsApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { Switch } from '../components/Switch';

const NEW_MODEL_WINDOW_DAYS = 30;

// Parse a location-agnostic YYYY-MM-DD calendar date without UTC timezone drift
function parseReleaseDateKey(released) {
  if (!released) return 0;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(released).trim());
  if (!match) return 0;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return y * 10000 + m * 100 + d;
}

function isReleasedWithinDays(released, days = NEW_MODEL_WINDOW_DAYS) {
  if (!released) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(released).trim());
  if (!match) return false;
  const isoDate = `${match[1]}-${match[2]}-${match[3]}`;

  if (typeof globalThis.Temporal !== 'undefined' && globalThis.Temporal?.PlainDate) {
    try {
      const rel = globalThis.Temporal.PlainDate.from(isoDate);
      const today = globalThis.Temporal.Now.plainDateISO();
      const cutoff = today.subtract({ days });
      return (
        globalThis.Temporal.PlainDate.compare(rel, cutoff) >= 0 &&
        globalThis.Temporal.PlainDate.compare(rel, today.add({ days: 7 })) <= 0
      );
    } catch {
      return false;
    }
  }

  // Fallback for runtimes without native Temporal: construct local calendar midnight from integers
  const relLocal = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(relLocal.getTime())) return false;
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayLocal.getTime() - relLocal.getTime()) / 86_400_000);
  return diffDays >= -7 && diffDays <= days;
}

const KIND_TABS = [
  { id: 'all', label: 'All Models' },
  { id: 'chat', label: 'Chat / LLM' },
  { id: 'vision', label: 'Vision' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'embedding', label: 'Embedding' },
  { id: 'image', label: 'Image Gen' },
  { id: 'tts', label: 'TTS' },
  { id: 'stt', label: 'STT' },
  { id: 'video', label: 'Video' },
  { id: 'search', label: 'Web Search' },
  { id: 'fetch', label: 'Web Fetch' },
];

const TIER_TABS = [
  { id: 'all', label: 'All Tiers' },
  { id: 'free', label: 'Free Forever' },
  { id: 'cheap', label: 'Cheap ($0.20–$0.60)' },
  { id: 'premium', label: 'Flagship / Cloud' },
  { id: 'local', label: 'Local LLM' },
];

const TIER_BADGE = {
  free: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cheap: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  premium: 'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30',
  local: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
};

const KIND_BADGE = {
  chat: 'bg-[#E56A4A]/15 text-[#E56A4A] border-[#E56A4A]/30',
  embedding: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  image: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  tts: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  stt: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  video: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  search: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  fetch: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
};

export function ModelsPage() {
  const toast = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const outletCtx = useOutletContext() || {};
  const headerSearch = outletCtx.headerSearch || '';
  const setHeaderSearch = outletCtx.setHeaderSearch;

  const [catalogData, setCatalogData] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [catalogAutoSync, setCatalogAutoSync] = useState(true);
  const [togglingAutoSync, setTogglingAutoSync] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState([]);
  const [presets, setPresets] = useState(FALLBACK_PRESETS);
  const [loading, setLoading] = useState(true);

  const [selectedKind, setSelectedKind] = useState('all');
  const [selectedTier, setSelectedTier] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [sortBy, setSortBy] = useState('newest'); // newest | name | context | price
  const [localSearch, setLocalSearch] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // grid | table

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, provRes, statusRes, settingsRes] = await Promise.all([
        catalogApi.get().catch(() => null),
        providersApi.list().catch(() => null),
        catalogApi.syncStatus().catch(() => null),
        settingsApi.get().catch(() => null),
      ]);

      if (catRes) setCatalogData(catRes);
      if (statusRes) setSyncStatus(statusRes);
      if (settingsRes?.settings?.catalogAutoSync !== undefined) {
        setCatalogAutoSync(Boolean(settingsRes.settings.catalogAutoSync));
      } else if (statusRes?.autoSync !== undefined) {
        setCatalogAutoSync(Boolean(statusRes.autoSync));
      }
      if (Array.isArray(provRes?.providers)) {
        setConnectedProviders(provRes.providers);
      }
      if (Array.isArray(provRes?.presets) && provRes.presets.length > 0) {
        const norm = provRes.presets.map(normalizePresetItem);
        const seen = new Set(norm.map((p) => p.preset));
        setPresets([
          ...norm,
          ...FALLBACK_PRESETS.filter((fb) => !seen.has(fb.preset)).map(normalizePresetItem),
        ]);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load AI model catalog');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleSyncCatalog = async () => {
    setSyncingCatalog(true);
    try {
      const res = await catalogApi.sync();
      await loadCatalog();
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

  const handleToggleAutoSync = async (nextVal) => {
    const prev = catalogAutoSync;
    setCatalogAutoSync(nextVal);
    setTogglingAutoSync(true);
    try {
      await settingsApi.update({ catalogAutoSync: nextVal });
      toast.success(
        nextVal ? 'Đã bật tự động đồng bộ mỗi 24h' : 'Đã tạm dừng tự động đồng bộ 24h'
      );
    } catch (err) {
      setCatalogAutoSync(prev);
      toast.error(err?.message || 'Failed to update auto-sync setting');
    } finally {
      setTogglingAutoSync(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const presetMetaMap = useMemo(
    () => new Map(presets.map((p) => [p.preset, p])),
    [presets]
  );

  const connectedPresetMap = useMemo(() => {
    const map = new Map();
    for (const p of connectedProviders) {
      if (p.preset && !map.has(p.preset)) {
        map.set(p.preset, p);
      }
      if (p.slug && !map.has(p.slug)) {
        map.set(p.slug, p);
      }
    }
    return map;
  }, [connectedProviders]);

  // Flatten all models from catalogApi + fallback presets + custom user-added models
  const allModels = useMemo(() => {
    const list = [];
    const seenFullIds = new Set();

    const sourceProviders =
      Array.isArray(catalogData?.providers) && catalogData.providers.length > 0
        ? catalogData.providers
        : presets.filter((p) => p.preset !== 'custom');

    for (const provEntry of sourceProviders) {
      const presetId = provEntry.preset || provEntry.id;
      const meta = presetMetaMap.get(presetId) || normalizePresetItem(provEntry);
      const connectedProv = connectedPresetMap.get(presetId);
      const slug = connectedProv?.slug || presetId;
      const tier = provEntry.tier || meta.tier || 'premium';
      const models =
        Array.isArray(provEntry.models) && provEntry.models.length > 0
          ? provEntry.models
          : Array.isArray(meta.modelCatalog)
            ? meta.modelCatalog
            : [];

      for (const m of models) {
        const modelObj = typeof m === 'string' ? { id: m, name: m, kind: 'chat' } : m;
        if (!modelObj?.id) continue;
        const fullId = `${slug}/${modelObj.id}`;
        if (seenFullIds.has(fullId)) continue;
        seenFullIds.add(fullId);

        const isFree =
          Boolean(modelObj.free) ||
          tier === 'free' ||
          tier === 'local' ||
          (modelObj.inputPrice === 0 && modelObj.outputPrice === 0);

        list.push({
          fullId,
          id: modelObj.id,
          name: modelObj.name || modelObj.id,
          kind: modelObj.kind || 'chat',
          preset: presetId,
          providerName: connectedProv?.name || provEntry.name || meta.name || presetId,
          logo: provEntry.logo || meta.logo || presetId,
          logoExt: provEntry.logoExt || meta.logoExt || 'png',
          color: meta.color || '#E56A4A',
          monogram: meta.monogram,
          tier,
          connected: Boolean(connectedProv && connectedProv.enabled !== false),
          contextWindow: modelObj.contextWindow || null,
          maxOutput: modelObj.maxOutput || null,
          released: modelObj.released || null,
          releasedKey: parseReleaseDateKey(modelObj.released),
          isNew: isReleasedWithinDays(modelObj.released, NEW_MODEL_WINDOW_DAYS),
          free: isFree,
          inputPrice: modelObj.inputPrice,
          outputPrice: modelObj.outputPrice,
          vision: Boolean(modelObj.vision),
          reasoning: Boolean(modelObj.reasoning),
          tools: Boolean(modelObj.tools),
        });
      }
    }

    // Also include any custom models from user-added custom providers
    for (const cp of connectedProviders) {
      const meta = presetMetaMap.get(cp.preset) || {};
      for (const mId of cp.models || []) {
        const fullId = `${cp.slug}/${mId}`;
        if (seenFullIds.has(fullId)) continue;
        seenFullIds.add(fullId);
        list.push({
          fullId,
          id: mId,
          name: mId,
          kind: 'chat',
          preset: cp.preset || cp.slug,
          providerName: cp.name,
          logo: meta.logo || cp.preset,
          logoExt: meta.logoExt || 'png',
          color: meta.color || '#E56A4A',
          monogram: String(cp.name || cp.slug).slice(0, 2).toUpperCase(),
          tier: meta.tier || 'premium',
          connected: cp.enabled !== false,
          contextWindow: null,
          released: null,
          releasedKey: 0,
          isNew: false,
          free: meta.tier === 'free' || meta.tier === 'local',
          vision: false,
          reasoning: false,
          tools: true,
        });
      }
    }

    return list;
  }, [catalogData, presets, presetMetaMap, connectedPresetMap, connectedProviders]);

  const providerOptions = useMemo(() => {
    const map = new Map();
    for (const m of allModels) {
      if (!map.has(m.preset)) {
        map.set(m.preset, {
          preset: m.preset,
          name: m.providerName,
          count: 0,
        });
      }
      map.get(m.preset).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allModels]);

  const effectiveSearch = (headerSearch || localSearch).trim().toLowerCase();

  const filteredModels = useMemo(() => {
    const matched = allModels.filter((m) => {
      if (connectedOnly && !m.connected) return false;
      if (newOnly && !m.isNew) return false;
      if (selectedProvider !== 'all' && m.preset !== selectedProvider) return false;
      if (selectedTier !== 'all') {
        if (selectedTier === 'free' && !m.free && m.tier !== 'free') return false;
        if (selectedTier !== 'free' && m.tier !== selectedTier) return false;
      }
      if (selectedKind !== 'all') {
        if (selectedKind === 'vision') {
          if (!m.vision) return false;
        } else if (selectedKind === 'reasoning') {
          if (!m.reasoning) return false;
        } else if (m.kind !== selectedKind) {
          return false;
        }
      }
      if (!effectiveSearch) return true;
      const hay = [
        m.fullId,
        m.name,
        m.id,
        m.providerName,
        m.preset,
        m.kind,
        m.tier,
        m.released,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(effectiveSearch);
    });

    const sorted = [...matched];
    sorted.sort((a, b) => {
      if (sortBy === 'newest') {
        if (b.releasedKey !== a.releasedKey) return b.releasedKey - a.releasedKey;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'context') {
        const diff = Number(b.contextWindow || 0) - Number(a.contextWindow || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      }
      if (sortBy === 'price') {
        const priceA = a.free ? 0 : (a.inputPrice ?? Number.POSITIVE_INFINITY);
        const priceB = b.free ? 0 : (b.inputPrice ?? Number.POSITIVE_INFINITY);
        if (priceA !== priceB) return priceA - priceB;
        const outA = a.free ? 0 : (a.outputPrice ?? Number.POSITIVE_INFINITY);
        const outB = b.free ? 0 : (b.outputPrice ?? Number.POSITIVE_INFINITY);
        if (outA !== outB) return outA - outB;
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
    return sorted;
  }, [
    allModels,
    connectedOnly,
    newOnly,
    selectedProvider,
    selectedTier,
    selectedKind,
    effectiveSearch,
    sortBy,
  ]);

  const stats = useMemo(() => {
    const total = allModels.length;
    const providersCount = new Set(allModels.map((m) => m.preset)).size;
    const freeCount = allModels.filter((m) => m.free).length;
    const visionCount = allModels.filter((m) => m.vision).length;
    const reasoningCount = allModels.filter((m) => m.reasoning).length;
    const newCount = allModels.filter((m) => m.isNew).length;
    return { total, providersCount, freeCount, visionCount, reasoningCount, newCount };
  }, [allModels]);

  const lastUpdatedLabel = useMemo(() => {
    const raw = syncStatus?.lastSyncAt || catalogData?.generatedAt;
    if (!raw) return 'v1.2 Live';
    return String(raw).slice(0, 10);
  }, [syncStatus, catalogData]);

  return (
    <div className="space-y-6">
      {/* Daily Auto-Sync Bar */}
      <section className="r-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <Clock className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
            <span>Cập nhật gần nhất:</span>
            <span className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--text-primary)]">
              {lastUpdatedLabel}
            </span>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
              catalogAutoSync
                ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-400'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                catalogAutoSync ? 'bg-emerald-400' : 'bg-[var(--text-muted)]'
              }`}
              aria-hidden="true"
            />
            Auto-Sync Daily (24h): {catalogAutoSync ? 'ON' : 'OFF'}
          </span>

          <Switch
            size="sm"
            checked={catalogAutoSync}
            disabled={togglingAutoSync}
            onChange={handleToggleAutoSync}
            aria-label="Toggle Daily Auto-Sync (24h)"
          />
        </div>

        <button
          type="button"
          onClick={handleSyncCatalog}
          disabled={syncingCatalog || loading}
          className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs shadow-xs"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              syncingCatalog ? 'animate-spin motion-reduce:animate-none' : ''
            }`}
            aria-hidden="true"
          />
          {syncingCatalog ? 'Đang đồng bộ…' : 'Đồng bộ ngay (Sync Latest Models)'}
        </button>
      </section>

      {/* Top Summary Strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="r-card p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">Total AI Models</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {formatNumber(stats.total)}
            </span>
            <span className="text-xs text-[#E56A4A]">across {stats.providersCount} providers</span>
          </div>
        </div>

        <div className="r-card p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">
            Free / Local Models
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-400">
              {formatNumber(stats.freeCount)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">$0 / 1M tokens</span>
          </div>
        </div>

        <div className="r-card p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">
            Multimodal Vision
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-sky-400">
              {formatNumber(stats.visionCount)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">image &amp; document input</span>
          </div>
        </div>

        <div className="r-card p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">
            Reasoning / Thinking
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-400">
              {formatNumber(stats.reasoningCount)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">CoT &amp; deep thinking</span>
          </div>
        </div>

        <div className="r-card flex flex-col justify-between p-3.5">
          <div className="text-[11px] font-medium text-[var(--text-secondary)]">New (Last 30d)</div>
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-400">
                {formatNumber(stats.newCount)}
              </span>
              <span className="text-xs text-[var(--text-muted)]">recent releases</span>
            </div>
            <button
              type="button"
              onClick={loadCatalog}
              disabled={loading}
              className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
              aria-label="Reload catalog"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              />
              Reload
            </button>
          </div>
        </div>
      </section>

      {/* Filter Controls Bar */}
      <section className="r-card space-y-3.5 p-4">
        {/* Service Kind Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedKind(tab.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                selectedKind === tab.id
                  ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tier Pills + Provider Dropdown + Search + View Mode */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TIER_TABS.map((tier) => (
              <button
                key={tier.id}
                type="button"
                onClick={() => setSelectedTier(tier.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedTier === tier.id
                    ? 'border-[#E56A4A] bg-[#E56A4A] text-white'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tier.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              aria-label="Filter by provider"
              className="field-input px-2.5 py-1.5 text-xs"
            >
              <option value="all">All Providers ({providerOptions.length})</option>
              {providerOptions.map((p) => (
                <option key={p.preset} value={p.preset}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>

            <div className="relative">
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
                placeholder="Search 470+ models (e.g. claude, gpt-6, deepseek, flux)…"
                aria-label="Search models"
                className="field-input w-56 py-1.5 pr-3 pl-8 text-xs sm:w-64"
              />
            </div>

            <div className="relative inline-flex items-center">
              <ArrowUpDown
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort models"
                className="field-input py-1.5 pr-2.5 pl-8 text-xs"
              >
                <option value="newest">Mới nhất (Newest First)</option>
                <option value="name">Tên A → Z (Name)</option>
                <option value="context">Context lớn nhất (Context)</option>
                <option value="price">Giá thấp nhất (Price)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setNewOnly((v) => !v)}
              aria-pressed={newOnly}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                newOnly
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              Mới 30 ngày (New)
              {stats.newCount > 0 ? (
                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[10px] font-bold text-emerald-300">
                  {stats.newCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => setConnectedOnly((v) => !v)}
              aria-pressed={connectedOnly}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                connectedOnly
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
              }`}
            >
              Connected Only
            </button>

            <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
                className={`rounded p-1.5 ${
                  viewMode === 'grid'
                    ? 'bg-[#E56A4A] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-label="Table view"
                className={`rounded p-1.5 ${
                  viewMode === 'table'
                    ? 'bg-[#E56A4A] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>
          Showing <strong className="text-[var(--text-primary)]">{filteredModels.length}</strong> of{' '}
          {allModels.length} models
        </span>
        {(selectedKind !== 'all' ||
          selectedTier !== 'all' ||
          selectedProvider !== 'all' ||
          connectedOnly ||
          newOnly ||
          effectiveSearch) && (
          <button
            type="button"
            onClick={() => {
              setSelectedKind('all');
              setSelectedTier('all');
              setSelectedProvider('all');
              setConnectedOnly(false);
              setNewOnly(false);
              setLocalSearch('');
              setHeaderSearch?.('');
            }}
            className="font-medium text-[#E56A4A] hover:underline"
          >
            Reset all filters
          </button>
        )}
      </div>

      {/* Models Listing */}
      {filteredModels.length === 0 ? (
        <div className="r-card border-dashed p-10 text-center">
          <Cpu className="mx-auto h-9 w-9 text-[var(--text-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
            No AI models match your current filters
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Try clearing the search query or switching Service Kind / Tier filters.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredModels.map((m) => (
            <article
              key={m.fullId}
              className="r-card flex flex-col justify-between p-4 transition-colors hover:border-[#E56A4A]/60"
            >
              <div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProviderLogo
                      preset={m.preset}
                      logo={m.logo}
                      logoExt={m.logoExt}
                      name={m.providerName}
                      color={m.color}
                      monogram={m.monogram}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {m.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                        <span className="truncate">{m.providerName}</span>
                        {m.connected ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Connected
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      KIND_BADGE[m.kind] || KIND_BADGE.chat
                    }`}
                  >
                    {m.kind}
                  </span>
                </div>

                {/* Copyable Routing ID Box */}
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1.5">
                  <code className="single-line-truncate font-mono text-xs text-[#E56A4A] select-all">
                    {m.fullId}
                  </code>
                  <CopyButton
                    value={m.fullId}
                    size="xs"
                    iconOnly
                    label={`Copy ${m.fullId}`}
                    toastMessage={`Copied ${m.fullId}`}
                  />
                </div>

                {/* Metadata & Capability Badges */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      TIER_BADGE[m.tier] || TIER_BADGE.premium
                    }`}
                  >
                    {m.tier}
                  </span>

                  {m.contextWindow ? (
                    <span className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
                      {formatContextWindow(m.contextWindow)} ctx
                    </span>
                  ) : null}

                  {m.free ? (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10.5px] font-bold text-emerald-400">
                      FREE
                    </span>
                  ) : m.inputPrice !== undefined || m.outputPrice !== undefined ? (
                    <span className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
                      ${m.inputPrice ?? 0}/${m.outputPrice ?? 0} /1M
                    </span>
                  ) : null}

                  {m.vision ? (
                    <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                      <Eye className="h-2.5 w-2.5" aria-hidden="true" />
                      Vision
                    </span>
                  ) : null}

                  {m.reasoning ? (
                    <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                      <Brain className="h-2.5 w-2.5" aria-hidden="true" />
                      Reasoning
                    </span>
                  ) : null}

                  {m.tools ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      <Wrench className="h-2.5 w-2.5" aria-hidden="true" />
                      Tools
                    </span>
                  ) : null}

                  {m.released ? (
                    <span className="inline-flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      <Calendar className="h-2.5 w-2.5" aria-hidden="true" />
                      {m.released}
                    </span>
                  ) : null}

                  {m.isNew ? (
                    <span className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300 uppercase">
                      NEW
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                <Link
                  to="/providers"
                  className="text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {m.connected ? 'Manage Provider' : 'Connect Provider →'}
                </Link>
                <button
                  type="button"
                  onClick={() => navigate(`/playground?model=${encodeURIComponent(m.fullId)}`)}
                  className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-xs hover:border-[#E56A4A] hover:text-[#E56A4A]"
                >
                  <Sparkles className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                  Try in Playground
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="AI Models Explorer Table"
          className="responsive-table-wrapper"
        >
          <table className="responsive-table responsive-table--stack">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model &amp; Routing ID</th>
                <th>Kind</th>
                <th>Tier</th>
                <th>Context</th>
                <th>Pricing / 1M</th>
                <th>Capabilities</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((m) => (
                <tr key={m.fullId} className="text-xs">
                  <td data-label="Provider">
                    <div className="flex items-center gap-2">
                      <ProviderLogo
                        preset={m.preset}
                        logo={m.logo}
                        logoExt={m.logoExt}
                        name={m.providerName}
                        color={m.color}
                        monogram={m.monogram}
                        size="sm"
                      />
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">
                          {m.providerName}
                        </div>
                        {m.connected ? (
                          <div className="text-[10px] text-emerald-400">● Connected</div>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  <td data-label="Model & Routing ID">
                    <div className="font-semibold text-[var(--text-primary)]">{m.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[#E56A4A]">
                        {m.fullId}
                      </code>
                      <CopyButton
                        value={m.fullId}
                        size="xs"
                        iconOnly
                        label={`Copy ${m.fullId}`}
                        toastMessage={`Copied ${m.fullId}`}
                      />
                    </div>
                  </td>

                  <td data-label="Kind">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        KIND_BADGE[m.kind] || KIND_BADGE.chat
                      }`}
                    >
                      {m.kind}
                    </span>
                  </td>

                  <td data-label="Tier">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        TIER_BADGE[m.tier] || TIER_BADGE.premium
                      }`}
                    >
                      {m.tier}
                    </span>
                  </td>

                  <td data-label="Context" className="font-mono">
                    {formatContextWindow(m.contextWindow)}
                  </td>

                  <td data-label="Pricing / 1M" className="font-mono">
                    {m.free ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                        FREE
                      </span>
                    ) : m.inputPrice !== undefined || m.outputPrice !== undefined ? (
                      <span>
                        ${m.inputPrice ?? 0} / ${m.outputPrice ?? 0}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>

                  <td data-label="Capabilities">
                    <div className="flex flex-wrap items-center gap-1">
                      {m.vision ? (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400">
                          Vision
                        </span>
                      ) : null}
                      {m.reasoning ? (
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-400">
                          Reasoning
                        </span>
                      ) : null}
                      {m.tools ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                          Tools
                        </span>
                      ) : null}
                      {m.released ? (
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {m.released}
                        </span>
                      ) : null}
                      {m.isNew ? (
                        <span className="rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300 uppercase">
                          NEW
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td data-label="Action" className="text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/playground?model=${encodeURIComponent(m.fullId)}`)}
                      className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
                    >
                      <Sparkles className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                      Try
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
