import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  GitBranch,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { consoleLogsApi, formatNumber, formatTimestamp, usageApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
import { LucianSlidingTabs } from '../components/lucian/LucianSlidingTabs';

const TABS = [
  { id: 'server', label: 'Live Server Console (SSE)' },
  { id: 'requests', label: 'Request Stream' },
];

const LEVEL_STYLES = {
  error: 'bg-red-500/20 text-red-300',
  warn: 'bg-amber-500/20 text-amber-300',
  info: 'bg-sky-500/20 text-sky-300',
  debug: 'bg-white/10 text-[#a3a3a3]',
};

export function ConsoleLogPage() {
  const toast = useToast();
  const { t } = useLocale();

  const [tab, setTab] = useState('server');

  // Tab 1: Live Server Console (SSE)
  const [serverLogs, setServerLogs] = useState([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [serverPaused, setServerPaused] = useState(false);
  const [levelFilter, setLevelFilter] = useState('all'); // all | info | warn | error
  const [serverSearch, setServerSearch] = useState('');
  const serverPausedRef = useRef(false);
  serverPausedRef.current = serverPaused;

  // Tab 2: Request Stream
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Load initial server console logs + connect SSE
  const loadServerLogs = useCallback(async () => {
    try {
      const res = await consoleLogsApi.list(250);
      setServerLogs(Array.isArray(res?.logs) ? res.logs : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadServerLogs();
    const es = new EventSource('/api/console-logs/stream', { withCredentials: true });
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.addEventListener('history', (evt) => {
      try {
        const list = JSON.parse(evt.data);
        if (Array.isArray(list)) {
          setServerLogs([...list].reverse());
        }
      } catch {
        // ignore
      }
    });
    es.onmessage = (evt) => {
      if (serverPausedRef.current) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'init' && Array.isArray(msg.logs)) {
          setServerLogs([...msg.logs].reverse());
        } else if (msg.type === 'log' && msg.entry) {
          setServerLogs((prev) => [msg.entry, ...prev].slice(0, 500));
        } else if (msg.type === 'clear') {
          setServerLogs([]);
        } else if (msg && typeof msg.message === 'string') {
          setServerLogs((prev) => [msg, ...prev].slice(0, 500));
        }
      } catch {
        // ignore malformed sse
      }
    };
    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [loadServerLogs]);

  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await usageApi.logs({ limit: 100, offset: 0 });
        setLogs(Array.isArray(res?.logs) ? res.logs : []);
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to load logs');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    fetchLogs(false);
  }, [fetchLogs]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => fetchLogs(true), 3000);
    return () => clearInterval(timer);
  }, [live, fetchLogs]);

  const filteredServerLogs = useMemo(() => {
    const q = serverSearch.trim().toLowerCase();
    return serverLogs.filter((entry) => {
      const lvl = String(entry.level || 'info').toLowerCase();
      if (levelFilter !== 'all' && lvl !== levelFilter) return false;
      if (!q) return true;
      return `${entry.scope || entry.tag || ''} ${entry.message || ''} ${lvl}`
        .toLowerCase()
        .includes(q);
    });
  }, [serverLogs, levelFilter, serverSearch]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (statusFilter === 'ok' && !(log.status >= 200 && log.status < 400)) return false;
      if (statusFilter === '429' && log.status !== 429) return false;
      if (statusFilter === 'err' && log.status >= 200 && log.status < 400) return false;
      if (!q) return true;
      return [
        log.requestedModel,
        log.resolvedModel,
        log.providerSlug,
        log.endpoint,
        log.keyName,
        log.error,
        String(log.status),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [logs, statusFilter, search]);

  const handleClearServerLogs = async () => {
    try {
      await consoleLogsApi.clear();
      setServerLogs([]);
      toast.success('Cleared live console buffer');
    } catch (err) {
      toast.error(err?.message || 'Failed to clear server console');
    }
  };

  const handleClearRequests = async () => {
    setClearing(true);
    try {
      await usageApi.clearLogs();
      setLogs([]);
      setSelectedLog(null);
      setClearOpen(false);
      toast.success('Cleared request logs');
    } catch (err) {
      toast.error(err?.message || 'Failed to clear logs');
    } finally {
      setClearing(false);
    }
  };

  const allServerText = useMemo(
    () =>
      filteredServerLogs
        .map(
          (l) =>
            `[${l.timestamp || ''}] [${String(l.level || 'INFO').toUpperCase()}] ${l.tag ? `[${l.tag}] ` : ''}${l.message}`
        )
        .join('\n'),
    [filteredServerLogs]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LucianSlidingTabs
          tabs={TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="Console log view"
        />
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${
            sseConnected
              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-400'
              : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)]'
          }`}
        >
          <Radio className="h-3 w-3" aria-hidden="true" />
          {sseConnected ? 'SSE Stream Connected' : 'SSE Reconnecting…'}
        </span>
      </div>

      {tab === 'server' ? (
        <>
          <div className="r-card flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setServerPaused((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  !serverPaused
                    ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-500'
                    : 'border-amber-500/40 bg-amber-500/12 text-amber-400'
                }`}
              >
                {serverPaused ? (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {serverPaused ? 'Paused' : 'Streaming'}
              </button>

              <div className="flex items-center gap-1">
                {['all', 'info', 'warn', 'error'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase ${
                      levelFilter === lvl
                        ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={serverSearch}
                  onChange={(e) => setServerSearch(e.target.value)}
                  placeholder="Search server output…"
                  className="field-input w-56 py-1.5 pr-3 pl-8 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CopyButton value={allServerText} size="xs" label="Copy Logs" />
              <button
                type="button"
                onClick={handleClearServerLogs}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>

          <div className="terminal-surface overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-xs">
              <span className="inline-flex items-center gap-2 font-mono text-[#d4d4d4]">
                <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                001router::server-console ({filteredServerLogs.length})
              </span>
              <span className="text-[11px] text-[#8c8c8c]">
                Secrets automatically redacted · newest 500 lines
              </span>
            </div>

            <div className="max-h-[40rem] divide-y divide-[#202020] overflow-y-auto font-mono text-xs">
              {filteredServerLogs.length === 0 ? (
                <div className="p-10 text-center text-[#787878]">
                  Waiting for server console events… Send a request or test a provider.
                </div>
              ) : (
                filteredServerLogs.map((entry, idx) => {
                  const lvl = String(entry.level || 'info').toLowerCase();
                  return (
                    <div
                      key={entry.id || idx}
                      className="flex items-start gap-2.5 px-4 py-2 hover:bg-[#1e1e1e]"
                    >
                      <span className="shrink-0 text-[11px] text-[#787878]">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.2 text-[10px] font-bold uppercase ${
                          LEVEL_STYLES[lvl] || LEVEL_STYLES.info
                        }`}
                      >
                        {lvl}
                      </span>
                      {entry.scope || entry.tag ? (
                        <span className="shrink-0 text-[#E56A4A]">[{entry.scope || entry.tag}]</span>
                      ) : null}
                      <span className="min-w-0 flex-1 break-words text-[#e5e5e5]">
                        {entry.message}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Request Stream Toolbar */}
          <div className="r-card flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setLive((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  live
                    ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-500'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {live ? (
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {live ? t('console.live') : t('console.paused')}
              </button>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter status"
                className="field-input px-2.5 py-1.5 text-xs"
              >
                <option value="all">
                  {t('common.all')} ({logs.length})
                </option>
                <option value="ok">2xx OK</option>
                <option value="429">429 Rate Limit</option>
                <option value="err">4xx / 5xx Errors</option>
              </select>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter model, provider, error…"
                  className="field-input w-56 py-1.5 pr-3 pl-8 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchLogs(false)}
                disabled={loading}
                className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
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

          <div className="grid gap-4 lg:grid-cols-12">
            <div
              className={`terminal-surface overflow-hidden rounded-xl border ${
                selectedLog ? 'lg:col-span-7' : 'lg:col-span-12'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-xs">
                <span className="inline-flex items-center gap-2 font-mono text-[#d4d4d4]">
                  <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                  001router::request-stream ({filteredLogs.length})
                </span>
                <span className="text-[11px] text-[#8c8c8c]">{t('console.selectRow')}</span>
              </div>

              <div className="max-h-[38rem] divide-y divide-[#222222] overflow-y-auto font-mono text-xs">
                {filteredLogs.length === 0 ? (
                  <div className="p-10 text-center text-[#787878]">
                    No log entries match your filter.
                  </div>
                ) : (
                  filteredLogs.map((log) => {
                    const ok = log.status >= 200 && log.status < 400;
                    const active = selectedLog?.id === log.id;
                    const badgeClass = ok
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : log.status === 429
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-red-500/20 text-red-300';

                    return (
                      <button
                        key={log.id}
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors ${
                          active ? 'bg-[#E56A4A]/18' : 'hover:bg-[#1e1e1e]'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span className="shrink-0 text-[11px] text-[#787878]">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${badgeClass}`}
                          >
                            {log.status || 'ERR'}
                          </span>
                          <span className="shrink-0 text-[11px] text-[#a3a3a3]">
                            {log.endpoint || '/v1/chat/completions'}
                          </span>
                          <span className="truncate text-[#ededed]">
                            {log.requestedModel}
                            {log.resolvedModel && log.resolvedModel !== log.requestedModel ? (
                              <span className="text-[#E56A4A]"> → {log.resolvedModel}</span>
                            ) : null}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2.5 text-[11px] text-[#a3a3a3]">
                          {log.adapterUsed ? (
                            <span className="rounded bg-violet-500/20 px-1.5 py-0.2 text-[10px] text-violet-300">
                              {log.adapterUsed}
                            </span>
                          ) : null}
                          {Number(log.estimatedCost) > 0 ? (
                            <span className="text-emerald-300">
                              ${Number(log.estimatedCost).toFixed(4)}
                            </span>
                          ) : null}
                          {log.fallbackHops > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-amber-300">
                              <GitBranch className="h-3 w-3" aria-hidden="true" />
                              {log.fallbackHops}
                            </span>
                          ) : null}
                          <span>{log.latencyMs ?? 0}ms</span>
                          <span>
                            {formatNumber(log.promptTokens || 0)}/
                            {formatNumber(log.completionTokens || 0)}t
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedLog ? (
              <aside className="r-card flex flex-col overflow-hidden lg:col-span-5">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      Request Inspector
                    </h2>
                    <p className="font-mono text-[11px] text-[var(--text-muted)]">
                      {selectedLog.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CopyButton
                      value={JSON.stringify(selectedLog, null, 2)}
                      size="xs"
                      label="JSON"
                      toastMessage="Copied log JSON"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedLog(null)}
                      aria-label="Close inspector"
                      className="r-btn-secondary p-1"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="r-card-subtle p-2.5">
                      <div className="text-[10px] text-[var(--text-muted)]">Provider</div>
                      <code className="mt-0.5 block font-semibold text-[var(--text-primary)]">
                        {selectedLog.providerSlug || '—'}
                      </code>
                    </div>
                    <div className="r-card-subtle p-2.5">
                      <div className="text-[10px] text-[var(--text-muted)]">Status / Latency</div>
                      <div className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                        HTTP {selectedLog.status} · {selectedLog.latencyMs}ms
                      </div>
                    </div>
                    <div className="r-card-subtle p-2.5">
                      <div className="text-[10px] text-[var(--text-muted)]">Requested</div>
                      <code className="mt-0.5 block break-all text-[var(--text-primary)]">
                        {selectedLog.requestedModel}
                      </code>
                    </div>
                    <div className="r-card-subtle p-2.5">
                      <div className="text-[10px] text-[var(--text-muted)]">Resolved</div>
                      <code className="mt-0.5 block break-all text-[#E56A4A]">
                        {selectedLog.resolvedModel || '—'}
                      </code>
                    </div>
                  </div>

                  {/* Feature telemetry pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {Number(selectedLog.estimatedCost) > 0 ? (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10.5px] text-emerald-400">
                        Est. ${Number(selectedLog.estimatedCost).toFixed(5)}
                      </span>
                    ) : null}
                    {selectedLog.adapterUsed ? (
                      <span className="rounded bg-violet-500/15 px-2 py-0.5 font-mono text-[10.5px] text-violet-400">
                        Adapter: {selectedLog.adapterUsed}
                      </span>
                    ) : null}
                    {selectedLog.ponytailApplied ? (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10.5px] text-amber-400">
                        Ponytail
                      </span>
                    ) : null}
                    {selectedLog.headroomApplied ? (
                      <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[10.5px] text-sky-400">
                        Headroom
                      </span>
                    ) : null}
                    {Array.isArray(selectedLog.rtkFilters) && selectedLog.rtkFilters.length > 0 ? (
                      <span className="rounded bg-[#E56A4A]/15 px-2 py-0.5 font-mono text-[10.5px] text-[#E56A4A]">
                        RTK: {selectedLog.rtkFilters.join(', ')}
                      </span>
                    ) : null}
                  </div>

                  {selectedLog.error ? (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-500">
                      <div className="mb-1 flex items-center gap-1.5 font-semibold">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Error
                      </div>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                        {selectedLog.error}
                      </pre>
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-1.5 font-semibold text-[var(--text-primary)]">
                      attemptTrail JSON
                    </div>
                    <pre className="code-surface max-h-80 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(selectedLog.attemptTrail || [], null, 2)}
                    </pre>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={handleClearRequests}
        title="Clear All Request Logs?"
        destructive
        busy={clearing}
        confirmLabel={t('console.clear')}
        message={<p>This permanently deletes stored request logs from local storage.</p>}
      />
    </div>
  );
}
