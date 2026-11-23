import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Globe,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { formatRelativeTime, providersApi, proxyPoolsApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { Switch } from '../components/Switch';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function ProxyPoolsPage() {
  const toast = useToast();
  const { t } = useLocale();

  const [pools, setPools] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadPools = useCallback(async () => {
    setLoading(true);
    try {
      const [poolsRes, provRes] = await Promise.all([
        proxyPoolsApi.list(),
        providersApi.list().catch(() => ({ providers: [] })),
      ]);
      setPools(Array.isArray(poolsRes?.pools) ? poolsRes.pools : []);
      setProviders(Array.isArray(provRes?.providers) ? provRes.providers : []);
    } catch (err) {
      toast.error(err?.message || 'Failed to load proxy pools');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  const openCreateModal = () => {
    setForm({
      id: null,
      name: '',
      url: '',
      enabled: true,
    });
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (pool) => {
    setForm({
      id: pool.id,
      name: pool.name || '',
      url: '',
      urlMasked: pool.urlMasked || '',
      enabled: pool.enabled !== false,
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form) return;
    const name = form.name.trim();
    const url = form.url.trim();

    if (!name) {
      setFormError('Proxy pool name is required.');
      return;
    }
    if (!form.id && !url) {
      setFormError('Proxy URL is required (e.g. http://host:port or socks5://user:pass@host:port).');
      return;
    }

    setFormError('');
    setSaving(true);
    try {
      if (form.id) {
        const payload = {
          name,
          enabled: form.enabled,
          ...(url ? { url } : {}),
        };
        const res = await proxyPoolsApi.update(form.id, payload);
        const updated = res?.pool || res;
        if (updated?.id) {
          setPools((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        } else {
          await loadPools();
        }
        toast.success(`Updated proxy pool "${name}"`);
      } else {
        const res = await proxyPoolsApi.create({
          name,
          url,
          enabled: form.enabled,
        });
        const created = res?.pool || res;
        if (created?.id) {
          setPools((prev) => [...prev, created]);
        } else {
          await loadPools();
        }
        toast.success(`Created proxy pool "${name}"`);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err?.message || 'Failed to save proxy pool');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (pool, nextEnabled) => {
    setPools((prev) =>
      prev.map((p) => (p.id === pool.id ? { ...p, enabled: nextEnabled } : p))
    );
    try {
      const res = await proxyPoolsApi.update(pool.id, { enabled: nextEnabled });
      const updated = res?.pool || res;
      if (updated?.id) {
        setPools((prev) => prev.map((p) => (p.id === pool.id ? updated : p)));
      }
      toast.success(
        `Proxy pool "${pool.name}" ${nextEnabled ? t('common.enabled') : t('common.disabled')}`
      );
    } catch (err) {
      setPools((prev) =>
        prev.map((p) => (p.id === pool.id ? { ...p, enabled: pool.enabled } : p))
      );
      toast.error(err?.message || 'Failed to update proxy pool');
    }
  };

  const handleTestPool = async (pool) => {
    setTestingId(pool.id);
    try {
      const res = await proxyPoolsApi.test(pool.id);
      setTestResults((prev) => ({ ...prev, [pool.id]: res }));
      if (res?.ok) {
        toast.success(`${pool.name}: Reachable (${res.latencyMs ?? 0}ms)`);
      } else {
        toast.error(`${pool.name}: ${res?.message || 'Proxy test failed'}`);
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [pool.id]: { ok: false, message: err?.message || 'Proxy test failed' },
      }));
      toast.error(err?.message || 'Proxy test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await proxyPoolsApi.remove(deleteTarget.id);
      setPools((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(`Deleted proxy pool "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.message || 'Failed to delete proxy pool');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Info Banner & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/12 px-2.5 py-1 font-semibold text-sky-400">
            <Globe className="h-3 w-3" aria-hidden="true" />
            HTTP · HTTPS · SOCKS5 Outbound Relay
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPools}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Proxy Pool
          </button>
        </div>
      </div>

      {/* Instructions Card */}
      <section className="r-card p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
          <div className="space-y-2 text-xs">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Outbound Proxy Pools for Region-Restricted Official APIs
            </h2>
            <p className="leading-relaxed text-[var(--text-secondary)]">
              Configure HTTP, HTTPS, or SOCKS5 outbound proxies here and assign them to specific
              providers in{' '}
              <Link to="/providers" className="font-semibold text-[#E56A4A] hover:underline">
                Providers → Outbound Proxy Pool
              </Link>
              . Proxy credentials (<code>user:password@host:port</code>) are always masked in API
              responses.
            </p>
          </div>
        </div>
      </section>

      {/* Proxy Pools List */}
      {pools.length === 0 && !loading ? (
        <div className="r-card border-dashed p-10 text-center">
          <Globe className="mx-auto h-9 w-9 text-[var(--text-muted)]" aria-hidden="true" />
          <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            No Outbound Proxy Pools Configured
          </h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            All upstream provider requests currently connect directly. Add an HTTP, HTTPS, or SOCKS5
            proxy pool if any official API endpoint requires regional egress routing.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="r-btn-primary mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create First Proxy Pool
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pools.map((pool) => {
            const attachedProviders = providers.filter((p) => p.proxyPoolId === pool.id);
            const testRes = testResults[pool.id];
            const isTesting = testingId === pool.id;

            return (
              <article key={pool.id} className="r-card flex flex-col justify-between p-5">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">
                          {pool.name}
                        </h3>
                        <span className="rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/12 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#E56A4A]">
                          {pool.type || 'HTTP'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Created {formatRelativeTime(pool.createdAt)}
                      </div>
                    </div>

                    <Switch
                      size="sm"
                      checked={pool.enabled !== false}
                      onChange={(val) => handleToggleEnabled(pool, val)}
                      aria-label={`Toggle proxy pool ${pool.name}`}
                    />
                  </div>

                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Masked Proxy Endpoint
                    </div>
                    <code className="mt-0.5 block break-all font-mono text-xs text-[var(--text-primary)]">
                      {pool.urlMasked || 'http://***@localhost:8080'}
                    </code>
                  </div>

                  {/* Attached Providers */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                      <Server className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                      Assigned Providers ({attachedProviders.length}):
                    </span>
                    {attachedProviders.length === 0 ? (
                      <span className="text-[var(--text-muted)]">None yet</span>
                    ) : (
                      attachedProviders.map((p) => (
                        <code
                          key={p.id}
                          className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
                        >
                          {p.name}
                        </code>
                      ))
                    )}
                  </div>

                  {testRes ? (
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                        testRes.ok
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-red-500/40 bg-red-500/10 text-red-400'
                      }`}
                    >
                      {testRes.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>
                        {testRes.ok
                          ? `Proxy OK (${testRes.latencyMs ?? 0}ms) ${testRes.message || ''}`
                          : testRes.message || 'Connection failed'}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                  <button
                    type="button"
                    onClick={() => handleTestPool(pool)}
                    disabled={isTesting}
                    className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    <Activity
                      className={`h-3.5 w-3.5 text-[#E56A4A] ${isTesting ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                      aria-hidden="true"
                    />
                    {isTesting ? t('common.testing') : 'Test Proxy'}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(pool)}
                      className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(pool)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Proxy Pool Modal */}
      <ModalDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form?.id ? `Edit Proxy Pool · ${form.name}` : 'Add Outbound Proxy Pool'}
        subtitle="Supports http://, https://, and socks5:// URLs with optional user:password credentials."
        size="sm"
      >
        {form ? (
          <form onSubmit={handleSave} className="space-y-4">
            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="proxy-name"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Pool Name
              </label>
              <input
                id="proxy-name"
                type="text"
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. US-East Relay or Singapore SOCKS5"
                className="field-input mt-1.5 w-full px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="proxy-url"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Proxy URL {form.id ? '(Leave blank to keep existing encrypted URL)' : ''}
              </label>
              {form.id && form.urlMasked ? (
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Current stored URL: <code>{form.urlMasked}</code>
                </div>
              ) : null}
              <input
                id="proxy-url"
                type="text"
                required={!form.id}
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="http://user:pass@proxy.example.com:8080 or socks5://127.0.0.1:1080"
                autoComplete="off"
                spellCheck={false}
                className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
              />
            </div>

            <div className="pt-1">
              <Switch
                checked={form.enabled}
                onChange={(val) => setForm((prev) => ({ ...prev, enabled: val }))}
                label={t('common.enabled')}
              />
            </div>

            <div className="flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="r-btn-secondary px-3.5 py-2 text-xs"
              >
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={saving} className="r-btn-primary px-4 py-2 text-xs">
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        ) : null}
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={`Delete Proxy Pool "${deleteTarget?.name || ''}"?`}
        destructive
        busy={deleting}
        confirmLabel={t('common.delete')}
        message={
          <p>
            Providers assigned to <strong>{deleteTarget?.name}</strong> will revert to direct
            outbound connections.
          </p>
        }
      />
    </div>
  );
}
