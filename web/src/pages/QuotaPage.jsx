import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Clock,
  Gauge,
  KeyRound,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { formatCompactNumber, formatNumber, quotaApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { ModalDialog } from '../components/ModalDialog';
import { ProviderLogo } from '../components/ProviderLogo';
import { CloudCodeQuota } from '../components/providers/CloudCodeQuota';

function barTone(pct) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function ProgressRow({ label, used, limit, formatFn = formatCompactNumber, unlimitedLabel }) {
  const hasLimit = typeof limit === 'number' && limit > 0;
  const pct = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="font-mono text-[11px] text-[var(--text-primary)]">
          {formatFn(used)} / {hasLimit ? formatFn(limit) : unlimitedLabel}
          {hasLimit ? (
            <span
              className={`ml-1.5 font-semibold ${
                pct >= 90 ? 'text-red-500' : pct >= 70 ? 'text-amber-500' : 'text-emerald-500'
              }`}
            >
              ({pct}%)
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        <div
          className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${
            hasLimit ? barTone(pct) : 'bg-[#E56A4A]/40'
          }`}
          style={{ width: hasLimit ? `${Math.max(used > 0 ? 3 : 0, pct)}%` : used > 0 ? '12%' : '0%' }}
        />
      </div>
    </div>
  );
}

export function QuotaPage() {
  const toast = useToast();
  const { t } = useLocale();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [editItem, setEditItem] = useState(null);
  const [dailyTokenLimit, setDailyTokenLimit] = useState('');
  const [dailyRequestLimit, setDailyRequestLimit] = useState('');
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState('');
  const [saving, setSaving] = useState(false);

  const loadQuota = useCallback(async () => {
    setLoading(true);
    try {
      const res = await quotaApi.list();
      setItems(Array.isArray(res?.items) ? res.items : []);
      const ts = Date.now();
      setLoadedAt(ts);
      setNowMs(ts);
    } catch (err) {
      toast.error(err?.message || 'Failed to load quota data');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  // Tick every 1s if any provider has keys in cooldown
  useEffect(() => {
    const hasCooldown = items.some((it) => (it.maxCooldownRemainingMs || 0) > 0);
    if (!hasCooldown) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [items]);

  const elapsedMs = Math.max(0, nowMs - loadedAt);

  const openBudgetModal = (item) => {
    setEditItem(item);
    setDailyTokenLimit(item.budget?.dailyTokenLimit ? String(item.budget.dailyTokenLimit) : '');
    setDailyRequestLimit(
      item.budget?.dailyRequestLimit ? String(item.budget.dailyRequestLimit) : ''
    );
    setMonthlyTokenLimit(
      item.budget?.monthlyTokenLimit ? String(item.budget.monthlyTokenLimit) : ''
    );
  };

  const handleSaveBudget = async (e) => {
    e.preventDefault();
    if (!editItem) return;
    const parseOpt = (val) => {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };

    setSaving(true);
    try {
      const payload = {
        dailyTokenLimit: parseOpt(dailyTokenLimit),
        dailyRequestLimit: parseOpt(dailyRequestLimit),
        monthlyTokenLimit: parseOpt(monthlyTokenLimit),
      };
      const res = await quotaApi.updateBudget(editItem.providerId, payload);
      setItems((prev) =>
        prev.map((it) =>
          it.providerId === editItem.providerId
            ? { ...it, budget: res?.budget || payload }
            : it
        )
      );
      toast.success(`Updated quota budget for "${editItem.name}"`);
      setEditItem(null);
    } catch (err) {
      toast.error(err?.message || 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const activeProviders = items.filter((i) => i.enabled !== false).length;
  const totalCooldownKeys = items.reduce((sum, i) => {
    const rem = Math.max(0, (i.maxCooldownRemainingMs || 0) - elapsedMs);
    return sum + (rem > 0 ? i.cooldownKeys || 0 : 0);
  }, 0);
  const maxCooldownSec = items.reduce((mx, i) => {
    const rem = Math.max(0, (i.maxCooldownRemainingMs || 0) - elapsedMs);
    return Math.max(mx, Math.ceil(rem / 1000));
  }, 0);
  const requestsToday = items.reduce((s, i) => s + (i.today?.requests || 0), 0);
  const tokensToday = items.reduce((s, i) => s + (i.today?.tokens || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={loadQuota}
          disabled={loading}
          className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </div>

      {/* KPI Row */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('quota.activeProviders')}</span>
            <Server className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">{activeProviders}</span>
            <span className="text-xs text-[var(--text-muted)]">/ {items.length}</span>
          </div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('quota.cooldownKeys')}</span>
            <Clock
              className={`h-4 w-4 ${totalCooldownKeys > 0 ? 'text-amber-500' : 'text-emerald-500'}`}
              aria-hidden="true"
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {totalCooldownKeys}
            </span>
            {maxCooldownSec > 0 ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-500">
                {maxCooldownSec}s left
              </span>
            ) : (
              <span className="text-xs text-emerald-500">All healthy</span>
            )}
          </div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('quota.requestsToday')}</span>
            <Activity className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
            {formatNumber(requestsToday)}
          </div>
        </div>

        <div className="r-card p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t('quota.tokensToday')}</span>
            <Zap className="h-4 w-4 text-sky-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
            {formatCompactNumber(tokensToday)}
          </div>
        </div>
      </section>

      {/* Per-Provider Quota Cards */}
      {items.length === 0 && !loading ? (
        <div className="r-card border-dashed p-10 text-center">
          <Gauge className="mx-auto h-9 w-9 text-[var(--text-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm text-[var(--text-secondary)]">{t('quota.noProviders')}</p>
          <Link
            to="/providers"
            className="r-btn-primary mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            {t('overview.manageProviders')}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const remMs = Math.max(0, (item.maxCooldownRemainingMs || 0) - elapsedMs);
            const remSec = Math.ceil(remMs / 1000);

            return (
              <article key={item.providerId} className="r-card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderLogo
                      preset={item.preset || item.slug}
                      name={item.name}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">
                          {item.name}
                        </h2>
                        <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                          {item.slug}
                        </code>
                        {!item.enabled ? (
                          <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                            {t('common.disabled')}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <KeyRound className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                          {item.activeKeys || 0} active
                        </span>
                        {remSec > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {item.cooldownKeys} cooling · {remSec}s
                          </span>
                        ) : null}
                        {(item.today?.errors || 0) > 0 ? (
                          <span className="text-red-500">
                            {item.today.errors} {t('common.errors')} today
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openBudgetModal(item)}
                    className="r-btn-secondary inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                    {t('quota.setBudget')}
                  </button>
                </div>

                {item.cloudCodeQuota ? (
                  <div className="rounded-xl border border-[#E56A4A]/35 bg-[#E56A4A]/8 p-3">
                    <CloudCodeQuota
                      tierLabel={item.cloudCodeQuota.tierLabel}
                      email={item.cloudCodeQuota.email}
                      projectId={item.cloudCodeQuota.projectId}
                      windows={item.cloudCodeQuota.windows || []}
                      models={item.cloudCodeQuota.models || []}
                      buckets={item.cloudCodeQuota.buckets || []}
                      perModelHidden={item.cloudCodeQuota.perModelHidden === true}
                      accent="#E56A4A"
                      providerSlug={item.slug}
                    />
                  </div>
                ) : null}

                <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
                  <ProgressRow
                    label={t('quota.dailyTokens')}
                    used={item.today?.tokens || 0}
                    limit={item.budget?.dailyTokenLimit}
                    unlimitedLabel={t('quota.unlimited')}
                  />
                  <ProgressRow
                    label={t('quota.dailyRequests')}
                    used={item.today?.requests || 0}
                    limit={item.budget?.dailyRequestLimit}
                    formatFn={formatNumber}
                    unlimitedLabel={t('quota.unlimited')}
                  />
                  <ProgressRow
                    label={t('quota.monthlyTokens')}
                    used={item.month?.tokens || 0}
                    limit={item.budget?.monthlyTokenLimit}
                    unlimitedLabel={t('quota.unlimited')}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Set Budget Modal */}
      <ModalDialog
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        title={`${t('quota.setBudget')} · ${editItem?.name || ''}`}
        subtitle="Leave blank for unlimited. Progress bars highlight at 70% (amber) and 90% (red)."
        size="sm"
      >
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <div>
            <label htmlFor="q-daily-tok" className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('quota.dailyTokens')}
            </label>
            <input
              id="q-daily-tok"
              type="number"
              min="1"
              value={dailyTokenLimit}
              onChange={(e) => setDailyTokenLimit(e.target.value)}
              placeholder="e.g. 500000"
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label htmlFor="q-daily-req" className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('quota.dailyRequests')}
            </label>
            <input
              id="q-daily-req"
              type="number"
              min="1"
              value={dailyRequestLimit}
              onChange={(e) => setDailyRequestLimit(e.target.value)}
              placeholder="e.g. 1000"
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label htmlFor="q-month-tok" className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('quota.monthlyTokens')}
            </label>
            <input
              id="q-month-tok"
              type="number"
              min="1"
              value={monthlyTokenLimit}
              onChange={(e) => setMonthlyTokenLimit(e.target.value)}
              placeholder="e.g. 10000000"
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditItem(null)}
              className="r-btn-secondary px-3.5 py-2 text-xs"
            >
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving} className="r-btn-primary px-4 py-2 text-xs">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
