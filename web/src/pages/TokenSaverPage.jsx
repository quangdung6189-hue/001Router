import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  FileCode2,
  Flame,
  Info,
  MessageSquarePlus,
  Play,
  Radio,
  Save,
  Scissors,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  formatCompactNumber,
  formatNumber,
  headroomApi,
  settingsApi,
  tokenSaverApi,
  usageApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { Switch } from '../components/Switch';
import { CopyButton } from '../components/CopyButton';

const SAMPLE_GIT_DIFF = `diff --git a/src/router.js b/src/router.js\r\nindex 8f21a90..c44b2d1 100644\r\n--- a/src/router.js\r\n+++ b/src/router.js\r\n@@ -12,6 +12,24 @@ export async function routeRequest(req) {   \r\n   const ctx = req.context;\r\n   const start = Date.now();\r\n   const a = 1;\r\n   const b = 2;\r\n   const c = 3;\r\n+  // Retry loop with cooldown awareness\r\n+  for (const target of targets) {\r\n+    const res = await dispatch(target, req);\r\n+    if (res.ok) return res;\r\n+  }\r\n   const d = 4;\r\n   const e = 5;\r\n   const f = 6;\r\n+  throw new Error("All targets exhausted");   \r\n }`;

const SAMPLE_BUILD_LOG = [
  'vite v8.3.8 building for production...   ',
  'transforming...   ',
  '',
  ...Array.from(
    { length: 18 },
    () => '✓ [cache hit] transforming module node_modules/lucide-react/dist/esm/icons/index.js   '
  ),
  ...Array.from({ length: 14 }, () => '[warn] chunk size analysis: evaluating vendor bundle...'),
  'dist/index.html                   0.82 kB │ gzip: 0.48 kB',
  'dist/assets/index-D4x8a1.css     28.44 kB │ gzip: 6.12 kB',
  'dist/assets/index-9K2mPq.js     312.10 kB │ gzip: 98.40 kB',
  '✓ built in 1.42s',
].join('\r\n');

const SAMPLE_GREP = [
  'src/server/router.js:12:import { applyRtkStructuredFilter } from "./rtkFilters.js";',
  'src/server/router.js:48:const compressed = compressRequestPayload(payload);',
  'src/server/router.js:89:const saved = compressed.savedChars;',
  'src/server/tokenSaver.js:14:export function compressText(text, maxChars) {',
  'src/server/tokenSaver.js:22:  const rtk = applyRtkStructuredFilter(text);',
  'src/server/rtkFilters.js:10:export const RTK_FILTER_CATALOG = [',
  'src/server/rtkFilters.js:55:export function autoDetectRtkFilter(text) {',
].join('\n');

const RTK_FILTERS = [
  { id: 'git-diff', label: 'git-diff', desc: 'Compacts context hunks & metadata headers' },
  { id: 'git-status', label: 'git-status', desc: 'Groups M/A/D/?? status paths cleanly' },
  { id: 'git-log', label: 'git-log', desc: 'One-line commit hash + subject digest' },
  { id: 'build-output', label: 'build-output', desc: 'Keeps errors/warnings/summary, drops noise' },
  { id: 'grep', label: 'grep', desc: 'Groups matches by filename with line numbers' },
  { id: 'find', label: 'find', desc: 'Collapses common directory prefixes' },
  { id: 'tree', label: 'tree', desc: 'Compresses deep directory trees' },
  { id: 'ls', label: 'ls', desc: 'Strips redundant chmod/owner/date columns' },
  { id: 'search-list', label: 'search-list', desc: 'Condenses repetitive search match listings' },
  { id: 'read-numbered', label: 'read-numbered', desc: 'Trims padded line-number gutters' },
  { id: 'dedup-log', label: 'dedup-log', desc: 'Collapses consecutive repeated log lines' },
  { id: 'smart-truncate', label: 'smart-truncate', desc: '60% head + 35% tail budget clamp' },
];

const CAVEMAN_STANDARD = [
  {
    id: 'lite',
    label: 'Lite (−35%)',
    tagline: 'Concise technical prose — skips filler intros & summaries',
    verboseTokens: 148,
    cavemanTokens: 64,
    sample:
      'Root cause: `useEffect` depends on an inline object recreated every render.\nFix: Memoize `options` or depend on `[options.page, options.limit]`.',
  },
  {
    id: 'full',
    label: 'Full (−65%)',
    tagline: 'Telegraphic bullet style — maximum signal-to-token ratio',
    verboseTokens: 148,
    cavemanTokens: 32,
    sample:
      'Cause: `options` ref recreated each render → infinite `useEffect`.\nFix: depend on `[options.page, options.limit]` or `useMemo`.',
  },
  {
    id: 'ultra',
    label: 'Ultra (−80%)',
    tagline: 'Code/diff only + 1-line diagnosis',
    verboseTokens: 148,
    cavemanTokens: 19,
    sample:
      'Inline `options` ref loops effect; use primitive deps:\n`useEffect(() => fetchList(options), [options.page, options.limit]);`',
  },
];

const CAVEMAN_WENYAN = [
  {
    id: 'wenyan-lite',
    label: 'Wenyan Lite',
    tagline: 'Classical Chinese concise technical annotations (文言簡略)',
    verboseTokens: 148,
    cavemanTokens: 48,
    sample: '因 `options` 每渲重構，致 `useEffect` 循還不止。治法：以 `useMemo` 固之，或依基本欄位。',
  },
  {
    id: 'wenyan',
    label: 'Wenyan Full',
    tagline: 'Dense Literary Chinese compression (文言精煉)',
    verboseTokens: 148,
    cavemanTokens: 28,
    sample: '病：`options` 重建致循環。方：改依 `[options.page, options.limit]`。',
  },
  {
    id: 'wenyan-ultra',
    label: 'Wenyan Ultra',
    tagline: 'Extreme classical telegraphic tokens (文言極簡)',
    verboseTokens: 148,
    cavemanTokens: 16,
    sample: '`options` 重構；改：`[options.page, options.limit]`。',
  },
];

const PONYTAIL_LEVELS = [
  {
    id: 'lite',
    label: 'Lite — Clean YAGNI',
    tagline: 'No speculative abstractions, no unused helpers, direct smallest working fix.',
    ladder: 'Keep existing API · Skip unnecessary wrapper classes · Minimal diff',
  },
  {
    id: 'full',
    label: 'Full — Lazy Senior Dev',
    tagline: 'Deletes dead code before adding new code, refuses over-engineering & premature factories.',
    ladder: 'Inline once-used helpers · Zero ceremony · Direct data flow · Reuse stdlib',
  },
  {
    id: 'ultra',
    label: 'Ultra — Brutal Minimalist',
    tagline: 'Hardest YAGNI constraint: fewest lines, fewest files, zero speculative config knobs.',
    ladder: 'Smallest possible patch · No extra files · No speculative options',
  },
];

export function TokenSaverPage() {
  const toast = useToast();
  const { t } = useLocale();

  // Pillar 1: RTK
  const [enabled, setEnabled] = useState(true);
  const [maxChars, setMaxChars] = useState('20000');

  // Pillar 2: Headroom external proxy
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState('http://localhost:8787');
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState('3000');
  const [headroomStatus, setHeadroomStatus] = useState(null);
  const [probingHeadroom, setProbingHeadroom] = useState(false);

  // Pillar 3: Caveman + Wenyan
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState('full');
  const [wenyanMode, setWenyanMode] = useState(false);

  // Pillar 4: Ponytail ("Lazy Senior Dev")
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState('full');

  // Pillar 5: Custom Global System Prompt
  const [customPromptEnabled, setCustomPromptEnabled] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const [savingSettings, setSavingSettings] = useState(false);
  const [usageSummary, setUsageSummary] = useState(null);

  // Sandbox
  const [sampleText, setSampleText] = useState(SAMPLE_GIT_DIFF);
  const [testMaxChars, setTestMaxChars] = useState('1200');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [setRes, usageRes] = await Promise.all([settingsApi.get(), usageApi.get('all')]);
      const s = setRes?.settings || {};
      setEnabled(s.tokenSaverEnabled !== false);
      setMaxChars(String(s.tokenSaverMaxChars ?? 20000));
      setHeadroomEnabled(Boolean(s.headroomEnabled));
      setHeadroomUrl(s.headroomUrl || 'http://localhost:8787');
      setHeadroomTimeoutMs(String(s.headroomTimeoutMs ?? 3000));
      setCavemanEnabled(Boolean(s.cavemanEnabled));
      const lvl = s.cavemanLevel || 'full';
      setCavemanLevel(lvl);
      setWenyanMode(lvl.startsWith('wenyan'));
      setPonytailEnabled(Boolean(s.ponytailEnabled));
      setPonytailLevel(
        ['lite', 'full', 'ultra'].includes(s.ponytailLevel) ? s.ponytailLevel : 'full'
      );
      setCustomPromptEnabled(Boolean(s.customPromptEnabled));
      setCustomPrompt(s.customPrompt || '');
      setUsageSummary(usageRes?.summary || null);
    } catch (err) {
      toast.error(err?.message || 'Failed to load Token Saver settings');
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateSetting = async (patch, successMsg) => {
    try {
      await settingsApi.update(patch);
      if (successMsg) toast.success(successMsg);
    } catch (err) {
      toast.error(err?.message || 'Failed to update setting');
      throw err;
    }
  };

  const handleToggleEnabled = async (nextVal) => {
    setEnabled(nextVal);
    try {
      await updateSetting(
        { tokenSaverEnabled: nextVal },
        `RTK 12-Filter Input Saver ${nextVal ? t('common.enabled') : t('common.disabled')}`
      );
    } catch {
      setEnabled(!nextVal);
    }
  };

  const handleSaveMaxChars = async (e) => {
    e.preventDefault();
    const n = Number(maxChars);
    if (!Number.isFinite(n) || n < 500) {
      toast.error('Max Chars must be at least 500.');
      return;
    }
    setSavingSettings(true);
    try {
      await updateSetting({ tokenSaverMaxChars: Math.round(n) }, 'Saved RTK Max Chars');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveHeadroom = async (e) => {
    e.preventDefault();
    const tMs = Number(headroomTimeoutMs);
    if (!Number.isFinite(tMs) || tMs < 200 || tMs > 30000) {
      toast.error('Headroom timeout must be between 200 and 30000 ms.');
      return;
    }
    setSavingSettings(true);
    try {
      await updateSetting(
        {
          headroomEnabled,
          headroomUrl: headroomUrl.trim() || 'http://localhost:8787',
          headroomTimeoutMs: Math.round(tMs),
        },
        'Headroom external proxy settings saved'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCheckHeadroom = async () => {
    setProbingHeadroom(true);
    try {
      const res = await headroomApi.status(headroomUrl.trim());
      setHeadroomStatus(res);
      if (res?.online || res?.ok) {
        toast.success(`Headroom online (${res.latencyMs || 0}ms)`);
      } else {
        toast.error(res?.error || 'Headroom unreachable (fail-open will skip automatically)');
      }
    } catch (err) {
      setHeadroomStatus({ online: false, error: err?.message });
      toast.error(err?.message || 'Headroom status check failed');
    } finally {
      setProbingHeadroom(false);
    }
  };

  const handleToggleWenyan = async (nextWenyan) => {
    setWenyanMode(nextWenyan);
    const nextLvl = nextWenyan ? 'wenyan' : 'full';
    setCavemanLevel(nextLvl);
    try {
      await updateSetting(
        { cavemanLevel: nextLvl },
        nextWenyan ? 'Switched Caveman to Wenyan mode (文言文)' : 'Switched Caveman to English mode'
      );
    } catch {
      setWenyanMode(!nextWenyan);
    }
  };

  const handleSaveCustomPrompt = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await updateSetting(
        { customPromptEnabled, customPrompt },
        'Custom Global System Prompt saved'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRunTest = async () => {
    if (!sampleText.trim()) return;
    setTesting(true);
    try {
      const n = Number(testMaxChars);
      const res = await tokenSaverApi.test({
        text: sampleText,
        maxChars: Number.isFinite(n) && n >= 200 ? Math.round(n) : undefined,
      });
      setResult(res);
    } catch (err) {
      toast.error(err?.message || 'Compression test failed');
    } finally {
      setTesting(false);
    }
  };

  const totalSavedChars = usageSummary?.savedChars || 0;
  const estTokensSaved = Math.round(totalSavedChars / 4);
  const totalReq = usageSummary?.totalRequests || 0;
  const avgCharsPerReq = totalReq > 0 ? Math.round(totalSavedChars / totalReq) : 0;

  const activeCavemanList = wenyanMode ? CAVEMAN_WENYAN : CAVEMAN_STANDARD;
  const activeCavemanMeta =
    activeCavemanList.find((l) => l.id === cavemanLevel) || activeCavemanList[1];

  return (
    <div className="space-y-6">
      {/* Per-Request Bypass Header Banner (9Router Parity) */}
      <section className="r-card flex flex-wrap items-center justify-between gap-3 border-sky-500/30 bg-sky-500/8 px-4 py-3 text-xs">
        <div className="flex items-center gap-2.5 text-[var(--text-secondary)]">
          <Info className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          <span>
            Per-request bypass: send header{' '}
            <code className="font-semibold text-[var(--text-primary)]">
              X-9Router-Token-Saver: off
            </code>{' '}
            (or <code>X-001Router-Token-Saver: off</code>) to skip RTK, Headroom, Caveman, Ponytail
            &amp; Custom Prompt for a single call.
          </span>
        </div>
        <CopyButton
          value="X-9Router-Token-Saver: off"
          size="xs"
          label="Copy Header"
          toastMessage="Copied bypass header"
        />
      </section>

      {/* Top KPI & Control Row */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('tokenSaver.status')}</span>
            <Scissors className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {enabled ? `${t('common.active')} (12 Filters)` : t('common.disabled')}
            </span>
            <Switch
              checked={enabled}
              onChange={handleToggleEnabled}
              aria-label="Toggle RTK Input Token Saver"
            />
          </div>
        </div>

        <form onSubmit={handleSaveMaxChars} className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('tokenSaver.maxChars')}</span>
            <Sparkles className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={500}
              max={500000}
              step={500}
              value={maxChars}
              onChange={(e) => setMaxChars(e.target.value)}
              aria-label="Token Saver Max Chars"
              className="field-input w-full px-2.5 py-1.5 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={savingSettings}
              className="r-btn-primary inline-flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-xs"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </form>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('tokenSaver.totalSavedChars')}</span>
            <Scissors className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
            {formatCompactNumber(totalSavedChars)}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            ~{formatNumber(avgCharsPerReq)} chars / req avg
          </div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('tokenSaver.estTokensSaved')}</span>
            <Zap className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-500">
            ~{formatCompactNumber(estTokensSaved)}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">All-time across gateway</div>
        </div>
      </section>

      {/* Pillar 1: 12 Built-in RTK Auto-Detect Filters */}
      <section className="r-card space-y-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              1. RTK Input Compressor — 12 Auto-Detect Structured Filters
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Automatically classifies tool outputs (git, grep, find, tree, ls, builds, logs) and
              strips noise before forwarding to upstream LLMs.
            </p>
          </div>
          <span className="rounded-full bg-[#E56A4A]/14 px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#E56A4A]">
            12 FILTERS ACTIVE
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {RTK_FILTERS.map((f) => (
            <div key={f.id} className="r-card-subtle p-3">
              <code className="font-mono text-xs font-bold text-[#E56A4A]">{f.label}</code>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pillar 2: Headroom External Compression Proxy (Fail-Open) */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Radio className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                2. Headroom External Proxy (Semantic Compression · Fail-Open)
              </h2>
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                FAIL-OPEN SAFE
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Forwards long message histories to a local Headroom semantic compression daemon (
              <code>POST /v1/compress</code>). If offline or slow, requests continue untouched
              without failing.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {headroomEnabled ? 'Headroom ON' : 'Headroom OFF'}
            </span>
            <Switch
              checked={headroomEnabled}
              onChange={async (v) => {
                setHeadroomEnabled(v);
                await updateSetting({ headroomEnabled: v }, `Headroom proxy ${v ? 'enabled' : 'disabled'}`);
              }}
              aria-label="Toggle Headroom External Proxy"
            />
          </div>
        </div>

        <form onSubmit={handleSaveHeadroom} className="grid gap-3 md:grid-cols-12">
          <div className="md:col-span-6">
            <label htmlFor="hr-url" className="block text-xs font-medium text-[var(--text-secondary)]">
              Headroom Proxy URL
            </label>
            <input
              id="hr-url"
              type="url"
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              placeholder="http://localhost:8787"
              className="field-input mt-1 w-full px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="md:col-span-3">
            <label htmlFor="hr-timeout" className="block text-xs font-medium text-[var(--text-secondary)]">
              Timeout (ms)
            </label>
            <input
              id="hr-timeout"
              type="number"
              min={200}
              max={30000}
              step={100}
              value={headroomTimeoutMs}
              onChange={(e) => setHeadroomTimeoutMs(e.target.value)}
              className="field-input mt-1 w-full px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex items-end gap-2 md:col-span-3">
            <button
              type="button"
              disabled={probingHeadroom}
              onClick={handleCheckHeadroom}
              className="r-btn-secondary inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs"
            >
              <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              {probingHeadroom ? 'Probing…' : 'Check Status'}
            </button>
            <button
              type="submit"
              disabled={savingSettings}
              className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save
            </button>
          </div>
        </form>

        {headroomStatus ? (
          <div
            className={`rounded-lg border px-3 py-2 font-mono text-xs ${
              headroomStatus.online || headroomStatus.ok
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            }`}
          >
            {headroomStatus.online || headroomStatus.ok
              ? `ONLINE · ${headroomStatus.url || headroomUrl} (${headroomStatus.latencyMs || 0}ms)`
              : `OFFLINE · ${headroomStatus.error || 'Not reachable — gateway will fail-open safely'}`}
          </div>
        ) : null}

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2">
            <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
              pip install headroom-ai
            </code>
            <CopyButton value="pip install headroom-ai" size="xs" iconOnly label="Copy pip install" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2">
            <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
              headroom proxy --port 8787
            </code>
            <CopyButton
              value="headroom proxy --port 8787"
              size="xs"
              iconOnly
              label="Copy headroom command"
            />
          </div>
        </div>
      </section>

      {/* Pillar 3: Caveman Mode (+ Wenyan Literary Chinese Toggle) */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Flame className="h-5 w-5 text-[#E56A4A]" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                3. Caveman Mode — Output Token Saver (−65% Output Tokens)
              </h2>
              <span className="rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#E56A4A]">
                OUTPUT −65%
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Prepends a terse technical directive into system prompts. Includes Classical Chinese
              Wenyan (文言文) extreme compression levels.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                Wenyan (文言文)
              </span>
              <Switch
                size="sm"
                checked={wenyanMode}
                onChange={handleToggleWenyan}
                aria-label="Toggle Wenyan Classical Chinese Caveman mode"
              />
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {cavemanEnabled ? 'Caveman ON' : 'Caveman OFF'}
              </span>
              <Switch
                checked={cavemanEnabled}
                onChange={async (v) => {
                  setCavemanEnabled(v);
                  await updateSetting(
                    { cavemanEnabled: v, cavemanLevel },
                    `Caveman Mode ${v ? 'enabled' : 'disabled'}`
                  );
                }}
                aria-label="Toggle Caveman Mode Output Token Saver"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {activeCavemanList.map((lvl) => {
            const active = cavemanLevel === lvl.id;
            return (
              <button
                key={lvl.id}
                type="button"
                onClick={async () => {
                  setCavemanLevel(lvl.id);
                  await updateSetting({ cavemanLevel: lvl.id }, `Caveman level → ${lvl.id}`);
                }}
                className={`rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-[#E56A4A] bg-[#E56A4A]/12'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)]">{lvl.label}</span>
                  {active ? (
                    <span className="rounded bg-[#E56A4A] px-1.5 py-0.5 text-[9.5px] font-bold text-white">
                      ACTIVE
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{lvl.tagline}</p>
                <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-card)] p-2 font-mono text-[10.5px] text-emerald-400">
                  {lvl.sample}
                </pre>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          Selected level: <code>{activeCavemanMeta.id}</code> (~{activeCavemanMeta.cavemanTokens} vs{' '}
          {activeCavemanMeta.verboseTokens} verbose tokens)
        </div>
      </section>

      {/* Pillar 4: Ponytail Mode ("Lazy Senior Dev" — YAGNI Code Discipline) */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="h-5 w-5 text-amber-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                4. Ponytail Mode (&quot;Lazy Senior Dev&quot; — Anti-Overengineering)
              </h2>
              <span className="rounded-full border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-400">
                YAGNI LADDER
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Instructs coding models to write the smallest direct patch, skip unnecessary
              abstractions, and delete boilerplate before adding code.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {ponytailEnabled ? 'Ponytail ON' : 'Ponytail OFF'}
            </span>
            <Switch
              checked={ponytailEnabled}
              onChange={async (v) => {
                setPonytailEnabled(v);
                await updateSetting(
                  { ponytailEnabled: v, ponytailLevel },
                  `Ponytail Mode ${v ? 'enabled' : 'disabled'}`
                );
              }}
              aria-label="Toggle Ponytail Mode"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {PONYTAIL_LEVELS.map((lvl) => {
            const active = ponytailLevel === lvl.id;
            return (
              <button
                key={lvl.id}
                type="button"
                onClick={async () => {
                  setPonytailLevel(lvl.id);
                  await updateSetting({ ponytailLevel: lvl.id }, `Ponytail level → ${lvl.id}`);
                }}
                className={`rounded-xl border p-3.5 text-left transition-colors ${
                  active
                    ? 'border-amber-500 bg-amber-500/12'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)]">{lvl.label}</span>
                  {active ? (
                    <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[9.5px] font-bold text-black">
                      ACTIVE
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{lvl.tagline}</p>
                <div className="mt-2 font-mono text-[10px] text-amber-400">{lvl.ladder}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Pillar 5: Custom Global System Prompt */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-emerald-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                5. Custom Global System Prompt
              </h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Automatically appended to the system prompt on all routed chat requests (unless
              bypassed via header).
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {customPromptEnabled ? 'Active' : 'Disabled'}
            </span>
            <Switch
              checked={customPromptEnabled}
              onChange={async (v) => {
                setCustomPromptEnabled(v);
                await updateSetting(
                  { customPromptEnabled: v },
                  `Custom Global Prompt ${v ? 'enabled' : 'disabled'}`
                );
              }}
              aria-label="Toggle Custom Global System Prompt"
            />
          </div>
        </div>

        <form onSubmit={handleSaveCustomPrompt} className="space-y-3">
          <textarea
            rows={4}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Always reply in Vietnamese for explanations while keeping code comments in English. Prefer TypeScript strict types."
            className="field-input w-full p-3 font-mono text-xs leading-relaxed"
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-muted)]">{customPrompt.length} / 8000 chars</span>
            <button
              type="submit"
              disabled={savingSettings}
              className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-xs"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save Custom Prompt
            </button>
          </div>
        </form>
      </section>

      {/* Live Interactive RTK Sandbox */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('tokenSaver.sandboxTitle')}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Tests all 12 RTK filters live via <code>POST /api/token-saver/test</code> and shows
              which filter matched.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSampleText(SAMPLE_GIT_DIFF)}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
            >
              <FileCode2 className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              git-diff
            </button>
            <button
              type="button"
              onClick={() => setSampleText(SAMPLE_BUILD_LOG)}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
            >
              <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              build-output
            </button>
            <button
              type="button"
              onClick={() => setSampleText(SAMPLE_GREP)}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
            >
              <Search className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              grep
            </button>

            <div className="flex items-center gap-1.5">
              <label htmlFor="ts-test-max" className="text-xs text-[var(--text-secondary)]">
                Max:
              </label>
              <input
                id="ts-test-max"
                type="number"
                min={200}
                max={200000}
                value={testMaxChars}
                onChange={(e) => setTestMaxChars(e.target.value)}
                className="field-input w-24 px-2 py-1 font-mono text-xs"
              />
            </div>

            <button
              type="button"
              onClick={handleRunTest}
              disabled={testing || !sampleText.trim()}
              className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {testing ? t('common.loading') : t('tokenSaver.compressNow')}
            </button>
          </div>
        </div>

        {result ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="r-card-subtle p-3">
              <div className="text-[11px] text-[var(--text-muted)]">Matched Filter</div>
              <div className="mt-0.5">
                <span className="inline-flex rounded-full bg-[#E56A4A]/15 px-2.5 py-0.5 font-mono text-xs font-bold text-[#E56A4A]">
                  {result.filter || 'generic'}
                </span>
              </div>
            </div>
            <div className="r-card-subtle p-3">
              <div className="text-[11px] text-[var(--text-muted)]">{t('tokenSaver.original')}</div>
              <div className="mt-0.5 font-mono text-base font-bold text-[var(--text-primary)]">
                {formatNumber(result.originalChars)} chars
              </div>
            </div>
            <div className="r-card-subtle p-3">
              <div className="text-[11px] text-[var(--text-muted)]">
                {t('tokenSaver.compressed')}
              </div>
              <div className="mt-0.5 font-mono text-base font-bold text-[var(--text-primary)]">
                {formatNumber(result.compressedChars)} chars
              </div>
            </div>
            <div className="r-card-subtle p-3">
              <div className="text-[11px] text-[var(--text-muted)]">{t('tokenSaver.saved')}</div>
              <div className="mt-0.5 font-mono text-base font-bold text-emerald-500">
                −{formatNumber(result.savedChars)} ({result.savedPercent ?? 0}%)
              </div>
            </div>
            <div className="r-card-subtle p-3">
              <div className="text-[11px] text-[var(--text-muted)]">Est. Tokens Saved</div>
              <div className="mt-0.5 font-mono text-base font-bold text-emerald-500">
                ~{formatNumber(Math.round((result.savedChars || 0) / 4))} tok
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--text-secondary)]">Raw Tool Output Input</span>
              <span className="font-mono text-[var(--text-muted)]">
                {formatNumber(sampleText.length)} chars
              </span>
            </div>
            <textarea
              rows={12}
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              className="field-input w-full p-3 font-mono text-xs leading-relaxed"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--text-secondary)]">Compressed Output</span>
              {result?.compressed ? (
                <CopyButton value={result.compressed} size="xs" label="Copy" />
              ) : null}
            </div>
            <pre className="code-surface h-[16.5rem] overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {result
                ? result.compressed
                : 'Click "Compress Now" to run the 12-filter RTK engine on the input.'}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
