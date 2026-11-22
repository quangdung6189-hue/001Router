import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  DollarSign,
  Info,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { pricingApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog } from '../components/ConfirmDialog';

function fmtRate(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  if (n === 0) return '0.00';
  return n < 0.01 ? n.toFixed(4) : n.toFixed(2);
}

export function PricingPage() {
  const toast = useToast();
  const [pricing, setPricing] = useState({});
  const [customPricing, setCustomPricing] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [onlyCustom, setOnlyCustom] = useState(false);

  const [editingKey, setEditingKey] = useState(null); // `${provider}::${model}`
  const [draft, setDraft] = useState({ input: '', output: '', cached: '', reasoning: '' });
  const [saving, setSaving] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadPricing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingApi.get();
      setPricing(res?.pricing || {});
      setCustomPricing(res?.customPricing || {});
    } catch (err) {
      toast.error(err?.message || 'Failed to load pricing table');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadPricing();
  }, [loadPricing]);

  const rows = useMemo(() => {
    const out = [];
    for (const [provider, modelsMap] of Object.entries(pricing || {})) {
      if (!modelsMap || typeof modelsMap !== 'object') continue;
      for (const [model, rate] of Object.entries(modelsMap)) {
        const isCustom = Boolean(customPricing?.[provider]?.[model]);
        out.push({
          key: `${provider}::${model}`,
          provider,
          model,
          input: Number(rate?.input) || 0,
          output: Number(rate?.output) || 0,
          cached: Number(rate?.cached) || 0,
          reasoning: Number(rate?.reasoning) || 0,
          isCustom,
        });
      }
    }
    out.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
    return out;
  }, [pricing, customPricing]);

  const providerList = useMemo(
    () => [...new Set(rows.map((r) => r.provider))].sort(),
    [rows]
  );

  const customCount = useMemo(() => rows.filter((r) => r.isCustom).length, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (providerFilter && r.provider !== providerFilter) return false;
      if (onlyCustom && !r.isCustom) return false;
      if (!q) return true;
      return r.provider.toLowerCase().includes(q) || r.model.toLowerCase().includes(q);
    });
  }, [rows, search, providerFilter, onlyCustom]);

  const startEdit = (row) => {
    setEditingKey(row.key);
    setDraft({
      input: String(row.input),
      output: String(row.output),
      cached: String(row.cached),
      reasoning: String(row.reasoning),
    });
  };

  const handleSaveRow = async (row) => {
    const rate = {
      input: Math.max(0, Number(draft.input) || 0),
      output: Math.max(0, Number(draft.output) || 0),
      cached: Math.max(0, Number(draft.cached) || 0),
      reasoning: Math.max(0, Number(draft.reasoning) || 0),
    };
    setSaving(true);
    try {
      const res = await pricingApi.update(row.provider, row.model, rate);
      if (res?.pricing) setPricing(res.pricing);
      setCustomPricing((prev) => ({
        ...prev,
        [row.provider]: { ...(prev[row.provider] || {}), [row.model]: rate },
      }));
      setEditingKey(null);
      toast.success(`Updated pricing for ${row.provider}/${row.model}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to update pricing');
    } finally {
      setSaving(false);
    }
  };

  const handleResetRow = async (row) => {
    try {
      const res = await pricingApi.reset(row.provider, row.model);
      if (res?.pricing) setPricing(res.pricing);
      setCustomPricing((prev) => {
        const next = { ...prev };
        if (next[row.provider]) {
          const copy = { ...next[row.provider] };
          delete copy[row.model];
          next[row.provider] = copy;
        }
        return next;
      });
      toast.success(`Reset ${row.provider}/${row.model} to default pricing`);
    } catch (err) {
      toast.error(err?.message || 'Failed to reset model pricing');
    }
  };

  const handleResetAll = async () => {
    setResetting(true);
    try {
      const res = await pricingApi.reset();
      if (res?.pricing) setPricing(res.pricing);
      setCustomPricing({});
      setResetAllOpen(false);
      toast.success('Reset all custom model pricing to defaults');
    } catch (err) {
      toast.error(err?.message || 'Failed to reset pricing');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Total Priced Models</span>
            <DollarSign className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{rows.length}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">USD per 1,000,000 tokens</div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Providers Covered</span>
            <Calculator className="h-4 w-4 text-sky-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
            {providerList.length}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">Catalog + custom overrides</div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Active Custom Overrides</span>
            <Pencil className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-500">{customCount}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Stored locally in <code>db.json</code>
          </div>
        </div>
      </section>

      {/* How Pricing Works Card (exact 9Router formula note) */}
      <section className="r-card flex items-start gap-3 border-sky-500/30 bg-sky-500/8 p-4 text-xs">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
        <div className="space-y-1 text-[var(--text-secondary)]">
          <div className="font-semibold text-[var(--text-primary)]">How Estimated Pricing Works</div>
          <p>
            Cost per request is calculated as:{' '}
            <code>
              (inputTokens × inputRate + outputTokens × outputRate + cachedTokens × cachedRate +
              reasoningTokens × reasoningRate) / 1,000,000
            </code>
            . Figures displayed in Usage &amp; Analytics are <strong>estimated</strong> based on
            these rates and may differ from your provider&apos;s actual billing invoice.
          </p>
        </div>
      </section>

      {/* Filter Toolbar */}
      <div className="r-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search provider or model…"
              className="field-input w-64 py-1.5 pr-3 pl-8 text-xs"
            />
          </div>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="Filter by provider"
            className="field-input px-2.5 py-1.5 text-xs"
          >
            <option value="">All providers ({providerList.length})</option>
            {providerList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={onlyCustom}
              onChange={(e) => setOnlyCustom(e.target.checked)}
              className="accent-[#E56A4A]"
            />
            Custom overrides only ({customCount})
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPricing}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
          {customCount > 0 ? (
            <button
              type="button"
              onClick={() => setResetAllOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset All Defaults
            </button>
          ) : null}
        </div>
      </div>

      {/* Pricing Table */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Model Pricing Table"
        className="responsive-table-wrapper"
      >
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model ID</th>
              <th className="text-right">Input ($/1M)</th>
              <th className="text-right">Output ($/1M)</th>
              <th className="text-right">Cached ($/1M)</th>
              <th className="text-right">Reasoning ($/1M)</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-xs text-[var(--text-muted)]">
                  {loading ? 'Loading pricing catalog…' : 'No models match your search.'}
                </td>
              </tr>
            ) : (
              filteredRows.slice(0, 250).map((row) => {
                const isEditing = editingKey === row.key;
                return (
                  <tr key={row.key} className="text-xs">
                    <td>
                      <code className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-semibold text-[var(--text-primary)]">
                        {row.provider}
                      </code>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <code className="text-[var(--text-primary)]">{row.model}</code>
                        {row.isCustom ? (
                          <span className="rounded-full bg-[#E56A4A]/15 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-[#E56A4A]">
                            CUSTOM
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {isEditing ? (
                      <>
                        {['input', 'output', 'cached', 'reasoning'].map((field) => (
                          <td key={field} className="text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={draft[field]}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, [field]: e.target.value }))
                              }
                              aria-label={`${field} price`}
                              className="field-input w-20 px-2 py-1 text-right font-mono text-xs"
                            />
                          </td>
                        ))}
                        <td className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => handleSaveRow(row)}
                              aria-label="Save pricing"
                              className="r-btn-primary p-1.5"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingKey(null)}
                              aria-label="Cancel edit"
                              className="r-btn-secondary p-1.5"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-right font-mono text-[var(--text-primary)]">
                          ${fmtRate(row.input)}
                        </td>
                        <td className="text-right font-mono text-[var(--text-primary)]">
                          ${fmtRate(row.output)}
                        </td>
                        <td className="text-right font-mono text-[var(--text-secondary)]">
                          ${fmtRate(row.cached)}
                        </td>
                        <td className="text-right font-mono text-[var(--text-secondary)]">
                          ${fmtRate(row.reasoning)}
                        </td>
                        <td className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                              Edit
                            </button>
                            {row.isCustom ? (
                              <button
                                type="button"
                                onClick={() => handleResetRow(row)}
                                title="Reset to default rate"
                                aria-label={`Reset ${row.model}`}
                                className="r-btn-secondary p-1 text-amber-500 hover:border-amber-500/50"
                              >
                                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filteredRows.length > 250 ? (
        <p className="text-center text-xs text-[var(--text-muted)]">
          Showing first 250 of {filteredRows.length} models — narrow your search to inspect more.
        </p>
      ) : null}

      <ConfirmDialog
        open={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        onConfirm={handleResetAll}
        title="Reset All Custom Pricing?"
        destructive
        busy={resetting}
        confirmLabel="Reset All"
        message={
          <p>
            All {customCount} custom rate overrides will be cleared and reverted to built-in catalog
            defaults.
          </p>
        }
      />
    </div>
  );
}
