import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Database,
  DollarSign,
  Eye,
  GitBranch,
  Radio,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  formatCompactNumber,
  formatNumber,
  formatRelativeTime,
  formatTimestamp,
  providersApi,
  usageApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProviderLogo } from '../components/ProviderLogo';
import { ProviderTopology } from '../components/ProviderTopology';
import { LucianSlidingTabs } from '../components/lucian/LucianSlidingTabs';
import { LucianGlowGrid, LucianGlowCard } from '../components/lucian/LucianGlowGrid';
import { LucianActivityBarChart } from '../components/lucian/LucianActivityBarChart';
import { LucianTrendScrubChart } from '../components/lucian/LucianTrendScrubChart';

const MAIN_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Request Details' },
];

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '60d', label: '60d' },
  { id: 'all', label: 'All' },
];

const METRICS = [
  { id: 'requests', label: 'Requests', color: '#E56A4A' },
  { id: 'tokens', label: 'Tokens', color: '#38bdf8' },
  { id: 'cost', label: 'Est. Cost ($)', color: '#10b981' },
  { id: 'savedChars', label: 'Saved Chars', color: '#a855f7' },
  { id: 'errors', label: 'Errors', color: '#ef4444' },
];

const TABLE_VIEWS = [
  { id: 'model', label: 'Usage by Model' },
  { id: 'provider', label: 'Usage by Account' },
  { id: 'key', label: 'Usage by API Key' },
  { id: 'endpoint', label: 'Usage by Endpoint' },
];

function formatCost(val) {
  const n = Number(val) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const MAX_LIVE_RECENT_UI = 100;

/**
 * Merge incoming recent requests into existing history WITHOUT ever wiping
 * or dropping previously seen requests (e.g. when a serverless SSE reconnect
 * emits an empty snapshot). Enriches existing items with fuller token/cost metadata.
 */
function mergeRecentRequests(existing = [], incoming = []) {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return existing;
  }
  const byId = new Map();
  for (const item of existing) {
    if (!item) continue;
    const key = item.id || `${item.timestamp}-${item.provider}-${item.model}-${item.latencyMs}`;
    byId.set(key, item);
  }
  for (const item of incoming) {
    if (!item) continue;
    const key = item.id || `${item.timestamp}-${item.provider}-${item.model}-${item.latencyMs}`;
    const prev = byId.get(key);
    if (prev) {
      byId.set(key, {
        ...prev,
        ...item,
        promptTokens: Math.max(Number(prev.promptTokens) || 0, Number(item.promptTokens) || 0),
        completionTokens: Math.max(
          Number(prev.completionTokens) || 0,
          Number(item.completionTokens) || 0
        ),
        cachedTokens: Math.max(Number(prev.cachedTokens) || 0, Number(item.cachedTokens) || 0),
        cost: Math.max(Number(prev.cost) || 0, Number(item.cost) || 0),
        savedChars: Math.max(Number(prev.savedChars) || 0, Number(item.savedChars) || 0),
        fallbackHops: Math.max(Number(prev.fallbackHops) || 0, Number(item.fallbackHops) || 0),
        error: item.error || prev.error,
        attemptTrail: item.attemptTrail || prev.attemptTrail,
      });
    } else {
      byId.set(key, item);
    }
  }
  return [...byId.values()]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, MAX_LIVE_RECENT_UI);
}

export function UsagePage() {
  const toast = useToast();
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState('overview');
  const [range, setRange] = useState('today');
  const [chartMetric, setChartMetric] = useState('requests');
  const [chartView, setChartView] = useState('bars'); // bars (#095) | line (#096)
  const [tableView, setTableView] = useState('model');
  const [tableMode, setTableMode] = useState('tokens'); // tokens | costs

  const [usage, setUsage] = useState(null);
  const [providers, setProviders] = useState([]);
  const [activeRequests, setActiveRequests] = useState({});
  const [recentRequests, setRecentRequests] = useState([]);
  const [recentPulseSlugs, setRecentPulseSlugs] = useState({});
  const [newArrivalIds, setNewArrivalIds] = useState(() => new Set());
  const [errorProvider, setErrorProvider] = useState(null);
  const [sseLive, setSseLive] = useState(false);

  const seenReqIdsRef = useRef(new Set());
  const hydratedRecentRef = useRef(false);
  const pulseTimersRef = useRef([]);

  // Request Details tab filters
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [modelFilter, setModelFilter] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setModelFilter(modelInput);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [modelInput]);

  useEffect(() => {
    return () => {
      for (const tid of pulseTimersRef.current) clearTimeout(tid);
      pulseTimersRef.current = [];
    };
  }, []);

  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const ingestRecentBatch = useCallback((incoming, { animateNew = true } = {}) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return [];
    const newlyArrived = [];
    for (const item of incoming) {
      if (!item) continue;
      const key = item.id || `${item.timestamp}-${item.provider}-${item.model}-${item.latencyMs}`;
      if (!seenReqIdsRef.current.has(key)) {
        seenReqIdsRef.current.add(key);
        if (hydratedRecentRef.current) {
          newlyArrived.push({ key, item });
        }
      }
    }
    hydratedRecentRef.current = true;
    setRecentRequests((prev) => mergeRecentRequests(prev, incoming));

    if (animateNew && newlyArrived.length > 0) {
      const addedKeys = newlyArrived.map((x) => x.key);
      setNewArrivalIds((prev) => {
        const next = new Set(prev);
        for (const k of addedKeys) next.add(k);
        return next;
      });
      const clearHighlightTimer = setTimeout(() => {
        setNewArrivalIds((prev) => {
          const next = new Set(prev);
          for (const k of addedKeys) next.delete(k);
          return next;
        });
      }, 2600);
      pulseTimersRef.current.push(clearHighlightTimer);

      const slugsToPulse = [...new Set(newlyArrived.map((x) => x.item.provider).filter(Boolean))];
      if (slugsToPulse.length > 0) {
        setRecentPulseSlugs((prev) => {
          const next = { ...prev };
          for (const slug of slugsToPulse) {
            next[slug] = (next[slug] || 0) + 1;
          }
          return next;
        });
        const clearBeamTimer = setTimeout(() => {
          setRecentPulseSlugs((prev) => {
            const next = { ...prev };
            for (const slug of slugsToPulse) {
              const rem = (next[slug] || 1) - 1;
              if (rem <= 0) delete next[slug];
              else next[slug] = rem;
            }
            return next;
          });
        }, 2800);
        pulseTimersRef.current.push(clearBeamTimer);
      }
    }
    return newlyArrived;
  }, []);

  const loadUsage = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoadingUsage(true);
      try {
        const [usageRes, provRes] = await Promise.all([
          usageApi.get(range),
          providersApi.list(),
        ]);
        setUsage(usageRes || null);
        setProviders(provRes?.providers || []);
        if (usageRes?.activeRequests) setActiveRequests(usageRes.activeRequests);
        if (Array.isArray(usageRes?.recentRequests) && usageRes.recentRequests.length > 0) {
          ingestRecentBatch(usageRes.recentRequests, { animateNew: silent });
        }
        if (usageRes?.errorProvider !== undefined) setErrorProvider(usageRes.errorProvider);
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to load usage stats');
      } finally {
        if (!silent) setLoadingUsage(false);
      }
    },
    [range, toast, ingestRecentBatch]
  );

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await usageApi.logs({
        limit,
        offset,
        status: statusFilter,
        provider: providerFilter,
        model: modelFilter.trim(),
      });
      setLogs(res?.logs || []);
      setLogsTotal(res?.total ?? 0);
    } catch (err) {
      toast.error(err?.message || 'Failed to load request logs');
    } finally {
      setLoadingLogs(false);
    }
  }, [limit, offset, statusFilter, providerFilter, modelFilter, toast]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Dual-mode live stream: SSE (/api/usage/stream) + resilient incremental polling (/api/usage/live)
  // so multi-instance serverless deployments (Vercel + Supabase) deliver every single request
  // batch reliably and NEVER clear previous history on reconnect.
  useEffect(() => {
    let closed = false;
    const es = new EventSource('/api/usage/stream', { withCredentials: true });
    es.onopen = () => {
      if (!closed) setSseLive(true);
    };
    es.onerror = () => {
      if (!closed) setSseLive(false);
    };
    es.onmessage = (evt) => {
      if (closed) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.activeRequests) setActiveRequests(msg.activeRequests);
        if (Array.isArray(msg.recentRequests) && msg.recentRequests.length > 0) {
          const arrived = ingestRecentBatch(msg.recentRequests, { animateNew: true });
          if (arrived.length > 0) {
            loadUsage({ silent: true });
          }
        }
        if (msg.errorProvider !== undefined) setErrorProvider(msg.errorProvider);
      } catch {
        // ignore malformed SSE packet
      }
    };

    const pollLive = async () => {
      if (closed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
        return;
      }
      try {
        const snap = await usageApi.live(MAX_LIVE_RECENT_UI);
        if (closed || !snap) return;
        setSseLive(true);
        if (snap.activeRequests) setActiveRequests(snap.activeRequests);
        if (snap.errorProvider !== undefined) setErrorProvider(snap.errorProvider);
        if (Array.isArray(snap.recentRequests) && snap.recentRequests.length > 0) {
          const arrived = ingestRecentBatch(snap.recentRequests, { animateNew: true });
          if (arrived.length > 0) {
            loadUsage({ silent: true });
          }
        }
      } catch {
        // transient network hiccup — keep existing history intact
      }
    };

    const pollTimer = setInterval(pollLive, 3000);
    return () => {
      closed = true;
      es.close();
      clearInterval(pollTimer);
      setSseLive(false);
    };
  }, [ingestRecentBatch, loadUsage]);

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      await usageApi.clearLogs();
      setClearOpen(false);
      seenReqIdsRef.current.clear();
      setRecentRequests([]);
      setNewArrivalIds(new Set());
      toast.success('Cleared request logs');
      setOffset(0);
      await Promise.all([loadUsage(), loadLogs()]);
    } catch (err) {
      toast.error(err?.message || 'Failed to clear logs');
    } finally {
      setClearing(false);
    }
  };

  const summary = usage?.summary || {};
  const totalReq = summary.totalRequests || 0;
  const byDay = usage?.byDay || [];
  const chartSeries = useMemo(() => {
    if (Array.isArray(usage?.series) && usage.series.length > 0) {
      return usage.series;
    }
    return byDay.map((d) => ({
      key: d.date,
      label: String(d.date || '').slice(5),
      fullLabel: d.date,
      requests: d.requests || 0,
      tokens: d.tokens || 0,
      promptTokens: d.promptTokens || 0,
      completionTokens: d.completionTokens || 0,
      cost: d.cost || 0,
      savedChars: d.savedChars || 0,
      errors: d.errors || 0,
    }));
  }, [usage?.series, byDay]);
  const byProvider = usage?.byProvider || [];
  const byModel = usage?.byModel || [];
  const byKey = usage?.byKey || [];
  const byEndpoint = usage?.byEndpoint || [];

  const maxProvReq = useMemo(
    () => Math.max(1, ...byProvider.map((p) => Number(p.requests || 0))),
    [byProvider]
  );

  const maxModelReq = useMemo(
    () => Math.max(1, ...byModel.map((m) => Number(m.requests || 0))),
    [byModel]
  );

  const visibleLogs = useMemo(() => {
    if (outcomeFilter === 'ok') return logs.filter((l) => l.status >= 200 && l.status < 400);
    if (outcomeFilter === 'err') return logs.filter((l) => !l.status || l.status >= 400);
    return logs;
  }, [logs, outcomeFilter]);

  const providerOptions = useMemo(() => {
    const slugs = new Set(providers.map((p) => p.slug));
    for (const p of byProvider) {
      if (p.provider) slugs.add(p.provider);
    }
    return [...slugs].sort();
  }, [providers, byProvider]);

  const activeRangeLabel = useMemo(
    () => RANGES.find((r) => r.id === range)?.label || range,
    [range]
  );

  const groupedRows = useMemo(() => {
    if (tableView === 'provider') {
      return byProvider.map((r) => ({
        key: r.provider,
        label: r.provider,
        requests: r.requests,
        promptTokens: r.promptTokens || 0,
        completionTokens: r.completionTokens || 0,
        cachedTokens: r.cachedTokens || 0,
        tokens: r.tokens || 0,
        cost: r.cost || 0,
        errors: r.errors || 0,
        lastUsed: r.lastUsed,
      }));
    }
    if (tableView === 'key') {
      return byKey.map((r) => ({
        key: r.keyName,
        label: r.keyName,
        requests: r.requests,
        promptTokens: r.promptTokens || 0,
        completionTokens: r.completionTokens || 0,
        cachedTokens: 0,
        tokens: r.tokens || 0,
        cost: r.cost || 0,
        errors: r.errors || 0,
        lastUsed: r.lastUsed,
      }));
    }
    if (tableView === 'endpoint') {
      return byEndpoint.map((r) => ({
        key: r.endpoint,
        label: r.endpoint,
        requests: r.requests,
        promptTokens: r.promptTokens || 0,
        completionTokens: r.completionTokens || 0,
        cachedTokens: 0,
        tokens: r.tokens || 0,
        cost: r.cost || 0,
        errors: r.errors || 0,
        lastUsed: r.lastUsed,
      }));
    }
    return byModel.map((r) => ({
      key: r.model,
      label: r.model,
      sub: r.provider,
      requests: r.requests,
      promptTokens: r.promptTokens || 0,
      completionTokens: r.completionTokens || 0,
      cachedTokens: r.cachedTokens || 0,
      tokens: r.tokens || 0,
      cost: r.cost || 0,
      errors: r.errors || 0,
      lastUsed: r.lastUsed,
    }));
  }, [tableView, byModel, byProvider, byKey, byEndpoint]);

  return (
    <div className="space-y-6">
      {/* Top 2-Tab Switcher + 6 Time Periods + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LucianSlidingTabs
          tabs={MAIN_TABS}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Usage view"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  range === r.id
                    ? 'bg-[#E56A4A] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              loadUsage();
              loadLogs();
            }}
            disabled={loadingUsage || loadingLogs}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingUsage || loadingLogs ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            {t('common.refresh')}
          </button>

          <button
            type="button"
            onClick={() => setClearOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('console.clear')}
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* 5 Exact 9Router Overview Cards */}
          <LucianGlowGrid
            as="section"
            ariaLabel="Usage Summary"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <LucianGlowCard innerClassName="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Total Requests</span>
                <Activity className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                {formatNumber(totalReq)}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {formatNumber(summary.successRequests || 0)} ok ·{' '}
                <span className={(summary.errorRequests || 0) > 0 ? 'text-red-500' : ''}>
                  {formatNumber(summary.errorRequests || 0)} err
                </span>
              </div>
            </LucianGlowCard>

            <LucianGlowCard innerClassName="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Input Tokens</span>
                <ArrowUpRight className="h-4 w-4 text-sky-400" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                {formatCompactNumber(summary.promptTokens || 0)}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Avg latency: {Math.round(summary.avgLatencyMs || 0)}ms
              </div>
            </LucianGlowCard>

            <LucianGlowCard innerClassName="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Cached Tokens</span>
                <Database className="h-4 w-4 text-violet-400" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                {formatCompactNumber(summary.cachedTokens || 0)}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">Prompt cache read hits</div>
            </LucianGlowCard>

            <LucianGlowCard innerClassName="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Output Tokens</span>
                <ArrowDownLeft className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
                {formatCompactNumber(summary.completionTokens || 0)}
              </div>
              <div className="mt-1 text-xs text-emerald-500">
                −{formatCompactNumber(summary.savedChars || 0)} chars RTK saved
              </div>
            </LucianGlowCard>

            <LucianGlowCard innerClassName="p-4">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Est. Cost</span>
                <DollarSign className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-400">
                ~{formatCost(summary.totalCost || 0)}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                <span>Estimated, not billing</span>
                <Link to="/settings/pricing" className="font-semibold text-[#E56A4A] hover:underline">
                  Edit →
                </Link>
              </div>
            </LucianGlowCard>
          </LucianGlowGrid>

          {/* Live Provider Topology (8 cols) + Live Recent Requests Feed (4 cols) */}
          <section className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <ProviderTopology
                providers={providers}
                activeRequests={activeRequests}
                recentPulseSlugs={recentPulseSlugs}
                errorProvider={errorProvider}
                byProvider={byProvider}
                sseLive={sseLive}
              />
            </div>

            <div className="r-card flex h-[430px] flex-col overflow-hidden xl:col-span-4">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Radio
                    className={`h-3.5 w-3.5 ${sseLive ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">
                    Live Recent Requests
                  </span>
                </div>
                <span className="rounded-full bg-[var(--bg-card)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--text-secondary)]">
                  {recentRequests.length} saved
                </span>
              </div>

              <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
                {recentRequests.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[var(--text-muted)]">
                    Live requests stream here in real time as clients call 001Router.
                  </div>
                ) : (
                  recentRequests.map((r, idx) => {
                    const reqKey =
                      r.id || `${r.timestamp}-${r.provider}-${r.model}-${r.latencyMs}-${idx}`;
                    const httpCode =
                      typeof r.httpStatus === 'number'
                        ? r.httpStatus
                        : typeof r.status === 'number'
                          ? r.status
                          : r.status === 'ok'
                            ? 200
                            : 500;
                    const ok =
                      r.status === 'ok' || (httpCode >= 200 && httpCode < 400);
                    const isFresh = newArrivalIds.has(reqKey);
                    const totalTok = (Number(r.promptTokens) || 0) + (Number(r.completionTokens) || 0);
                    return (
                      <button
                        key={reqKey}
                        type="button"
                        onClick={() =>
                          setSelectedLog({
                            ...r,
                            providerSlug: r.provider,
                            status: httpCode,
                            estimatedCost: r.cost ?? r.estimatedCost ?? 0,
                          })
                        }
                        className={`block w-full space-y-1.5 px-4 py-2.5 text-left text-xs transition-colors hover:bg-[var(--bg-elevated)]/70 ${
                          isFresh ? 'live-req-new bg-emerald-500/[0.06]' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                ok ? 'bg-emerald-500' : 'bg-red-500'
                              }`}
                            />
                            <code className="truncate font-semibold text-[var(--text-primary)]">
                              {r.model || r.resolvedModel || r.requestedModel || r.provider}
                            </code>
                            {isFresh ? (
                              <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.2 font-mono text-[9px] font-bold text-emerald-500">
                                NEW
                              </span>
                            ) : null}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px]">
                            <span
                              className={`rounded px-1.5 py-0.2 text-[9.5px] font-bold ${
                                ok
                                  ? 'bg-emerald-500/15 text-emerald-500'
                                  : 'bg-red-500/15 text-red-500'
                              }`}
                            >
                              {httpCode}
                            </span>
                            <span className="text-[var(--text-muted)]">
                              {r.latencyMs ?? 0}ms
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-medium text-[var(--text-primary)]">
                              {r.provider || 'router'}
                            </span>
                            {r.fallbackHops > 0 ? (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold text-amber-500">
                                <GitBranch className="h-2.5 w-2.5" aria-hidden="true" />
                                {r.fallbackHops}
                              </span>
                            ) : null}
                            {r.savedChars > 0 ? (
                              <span className="rounded bg-violet-500/12 px-1 text-[9.5px] font-semibold text-violet-400">
                                −{formatCompactNumber(r.savedChars)}c
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                            {totalTok > 0
                              ? `${formatCompactNumber(r.promptTokens || 0)}/${formatCompactNumber(r.completionTokens || 0)} tok`
                              : '0 tok'}
                            {Number(r.cost) > 0 ? ` · ${formatCost(r.cost)}` : ''} ·{' '}
                            {formatRelativeTime(r.timestamp)}
                          </span>
                        </div>
                        {!ok && r.error ? (
                          <div className="truncate rounded bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-500">
                            {r.error}
                          </div>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* Activity Trend Chart powered by Lucian UX/UI (#095 Morphing Bars + #096 Scrub Line) */}
          <section aria-label={`Activity Trend (${activeRangeLabel})`}>
            {chartView === 'bars' ? (
              <LucianActivityBarChart
                series={chartSeries}
                metric={chartMetric}
                metrics={METRICS}
                onMetricChange={setChartMetric}
                rangeLabel={activeRangeLabel}
                chartView={chartView}
                onChartViewChange={setChartView}
              />
            ) : (
              <LucianTrendScrubChart
                series={chartSeries}
                metric={chartMetric}
                metrics={METRICS}
                onMetricChange={setChartMetric}
                rangeLabel={activeRangeLabel}
                chartView={chartView}
                onChartViewChange={setChartView}
              />
            )}
          </section>

          {/* ProviderBarChart & TopModelsChart */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="r-card p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Traffic by Provider
              </h2>
              {byProvider.length === 0 ? (
                <p className="mt-4 text-xs text-[var(--text-muted)]">No provider traffic yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {byProvider.map((item) => {
                    const pct = Math.round(((item.requests || 0) / maxProvReq) * 100);
                    return (
                      <li key={item.provider} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-2">
                            <ProviderLogo preset={item.provider} name={item.provider} size="xs" />
                            <code className="font-semibold text-[var(--text-primary)]">
                              {item.provider}
                            </code>
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {formatNumber(item.requests)} reqs · {formatCompactNumber(item.tokens)}{' '}
                            tok · <span className="text-emerald-400">{formatCost(item.cost)}</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                          <div
                            className="h-full rounded-full bg-[#E56A4A]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="r-card p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Top Models</h2>
              {byModel.length === 0 ? (
                <p className="mt-4 text-xs text-[var(--text-muted)]">No model traffic yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {byModel.slice(0, 10).map((item) => {
                    const pct = Math.round(((item.requests || 0) / maxModelReq) * 100);
                    return (
                      <li key={item.model} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <code className="single-line-truncate font-medium text-[var(--text-primary)]">
                            {item.model}
                          </code>
                          <span className="shrink-0 text-[var(--text-secondary)]">
                            {formatNumber(item.requests)} reqs · {formatCompactNumber(item.tokens)}{' '}
                            tok · <span className="text-emerald-400">{formatCost(item.cost)}</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                          <div
                            className="h-full rounded-full bg-sky-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* 4-View Grouped Usage Table (Model / Account / API Key / Endpoint + Costs/Tokens toggle) */}
          <section className="r-card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {TABLE_VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setTableView(v.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      tableView === v.id
                        ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTableMode('tokens')}
                  className={`rounded-md px-2.5 py-1 font-medium ${
                    tableMode === 'tokens'
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Tokens
                </button>
                <button
                  type="button"
                  onClick={() => setTableMode('costs')}
                  className={`rounded-md px-2.5 py-1 font-medium ${
                    tableMode === 'costs'
                      ? 'bg-[var(--bg-card)] text-emerald-400 shadow-xs'
                      : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Est. Costs
                </button>
              </div>
            </div>

            <div className="responsive-table-wrapper">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>{TABLE_VIEWS.find((v) => v.id === tableView)?.label}</th>
                    <th className="text-right">Requests</th>
                    <th className="text-right">Input</th>
                    <th className="text-right">Output</th>
                    <th className="text-right">
                      {tableMode === 'costs' ? 'Est. Cost' : 'Total Tokens'}
                    </th>
                    <th className="text-right">Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-[var(--text-muted)]">
                        No usage records in this period.
                      </td>
                    </tr>
                  ) : (
                    groupedRows.map((row) => (
                      <tr key={row.key} className="text-xs">
                        <td>
                          <code className="font-semibold text-[var(--text-primary)]">
                            {row.label}
                          </code>
                          {row.sub ? (
                            <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                              ({row.sub})
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right font-mono">
                          {formatNumber(row.requests)}
                          {row.errors > 0 ? (
                            <span className="ml-1 text-red-500">({row.errors} err)</span>
                          ) : null}
                        </td>
                        <td className="text-right font-mono text-[var(--text-secondary)]">
                          {formatCompactNumber(row.promptTokens)}
                        </td>
                        <td className="text-right font-mono text-[var(--text-secondary)]">
                          {formatCompactNumber(row.completionTokens)}
                        </td>
                        <td className="text-right font-mono font-semibold text-emerald-400">
                          {tableMode === 'costs'
                            ? formatCost(row.cost)
                            : formatCompactNumber(row.tokens)}
                        </td>
                        <td className="text-right text-[var(--text-muted)]">
                          {formatRelativeTime(row.lastUsed)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        /* Tab 2: Request Details */
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Request Details ({formatNumber(logsTotal)})
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Full request audit trail including fallback hops, cost estimates, and attemptTrail.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                aria-label="Filter outcome"
                className="field-input px-2.5 py-1.5 text-xs"
              >
                <option value="all">All outcomes</option>
                <option value="ok">Success (2xx)</option>
                <option value="err">Errors (4xx/5xx)</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setOffset(0);
                }}
                aria-label="Filter status code"
                className="field-input px-2.5 py-1.5 text-xs"
              >
                <option value="">Any status</option>
                <option value="200">200 OK</option>
                <option value="403">403 Forbidden</option>
                <option value="429">429 Rate Limit</option>
                <option value="500">500 Server Error</option>
                <option value="502">502 Bad Gateway</option>
              </select>

              <select
                value={providerFilter}
                onChange={(e) => {
                  setProviderFilter(e.target.value);
                  setOffset(0);
                }}
                aria-label="Filter provider"
                className="field-input px-2.5 py-1.5 text-xs"
              >
                <option value="">All providers</option>
                {providerOptions.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>

              <input
                type="search"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="Filter model…"
                className="field-input w-44 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="responsive-table-wrapper">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th className="text-right">Tokens</th>
                  <th className="text-right">Est. Cost</th>
                  <th className="text-right">Latency</th>
                  <th className="text-right">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-[var(--text-muted)]">
                      No request logs match your filters.
                    </td>
                  </tr>
                ) : (
                  visibleLogs.map((log) => {
                    const ok = log.status >= 200 && log.status < 400;
                    return (
                      <tr key={log.id} className="text-xs">
                        <td className="font-mono text-[11px] text-[var(--text-secondary)]">
                          {formatTimestamp(log.timestamp)}
                        </td>
                        <td>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                              ok
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : log.status === 429
                                  ? 'bg-amber-500/15 text-amber-400'
                                  : 'bg-red-500/15 text-red-400'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[var(--text-primary)]">{log.requestedModel}</code>
                            {log.fallbackHops > 0 ? (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.2 font-mono text-[10px] text-amber-400">
                                <GitBranch className="h-2.5 w-2.5" aria-hidden="true" />
                                {log.fallbackHops}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <code className="text-[var(--text-secondary)]">
                            {log.providerSlug || '—'}
                          </code>
                        </td>
                        <td className="text-right font-mono">
                          {formatNumber(log.promptTokens || 0)}/{formatNumber(log.completionTokens || 0)}
                        </td>
                        <td className="text-right font-mono text-emerald-400">
                          {formatCost(log.estimatedCost || 0)}
                        </td>
                        <td className="text-right font-mono">{log.latencyMs ?? 0}ms</td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                          >
                            <Eye className="h-3 w-3" aria-hidden="true" />
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {logsTotal > limit ? (
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>
                Showing {offset + 1}–{Math.min(offset + limit, logsTotal)} of {logsTotal}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="r-btn-secondary px-3 py-1 text-xs"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={offset + limit >= logsTotal}
                  onClick={() => setOffset(offset + limit)}
                  className="r-btn-secondary px-3 py-1 text-xs"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* Request Detail Modal */}
      <ModalDialog
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Request Log Detail"
        subtitle={selectedLog ? `${selectedLog.endpoint || '/v1/chat/completions'} · ${selectedLog.id}` : ''}
        size="lg"
      >
        {selectedLog ? (
          <div className="space-y-3 text-xs">
            {selectedLog.error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <pre className="whitespace-pre-wrap font-mono">{selectedLog.error}</pre>
              </div>
            ) : null}
            <pre className="code-surface max-h-[60vh] overflow-auto rounded-lg border p-3 font-mono text-[11px]">
              {JSON.stringify(selectedLog, null, 2)}
            </pre>
          </div>
        ) : null}
      </ModalDialog>

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={handleClearLogs}
        title="Clear All Request Logs?"
        destructive
        busy={clearing}
        confirmLabel={t('console.clear')}
        message={<p>This permanently clears all stored usage metrics and request logs.</p>}
      />
    </div>
  );
}
