import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Image,
  KeyRound,
  Layers,
  Lock,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  combosApi,
  formatCompactNumber,
  formatNumber,
  formatRelativeTime,
  getRememberedRouterKey,
  healthApi,
  keysApi,
  providersApi,
  rememberRouterKey,
  SERVICE_KINDS_META,
  settingsApi,
  usageApi,
} from '../lib/api';
import { LucianGlowGrid, LucianGlowCard } from '../components/lucian/LucianGlowGrid';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { CopyButton } from '../components/CopyButton';
import { Switch } from '../components/Switch';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyAccessControls } from '../components/KeyAccessControls';

const SERVICE_ICONS = {
  chat: MessageSquare,
  messages: Shield,
  embedding: Cpu,
  image: Image,
  tts: Volume2,
  stt: Mic,
  search: Search,
  fetch: Globe,
  models: Layers,
};

export function OverviewPage() {
  const toast = useToast();
  const { t } = useLocale();
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [usage, setUsage] = useState(null);
  const [settings, setSettings] = useState(null);
  // Public deployments (Vercel…) always require a router key, whatever the stored setting says.
  const [publicDeployment, setPublicDeployment] = useState(false);
  const [loading, setLoading] = useState(true);

  const [revealedIds, setRevealedIds] = useState(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKeyModal, setCreatedKeyModal] = useState(null);
  const [oneTimeBannerKey, setOneTimeBannerKey] = useState(null);

  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [pingResult, setPingResult] = useState(null);
  const [pinging, setPinging] = useState(false);

  const origin = window.location.origin;
  const openaiBaseUrl = `${origin}/v1`;
  const anthropicBaseUrl = origin;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, providersRes, combosRes, usageRes, settingsRes, revealRes] =
        await Promise.all([
          keysApi.list(),
          providersApi.list(),
          combosApi.list(),
          usageApi.get('24h'),
          settingsApi.get(),
          keysApi.revealInitial().catch(() => null),
        ]);

      const loadedKeys = keysRes?.keys || [];
      for (const k of loadedKeys) {
        if (k.key && !String(k.key).includes('…')) {
          rememberRouterKey(k);
        }
      }
      setKeys(loadedKeys);
      setProviders(providersRes?.providers || []);
      setCombos(combosRes?.combos || []);
      setUsage(usageRes || null);
      setSettings(settingsRes?.settings || null);
      setPublicDeployment(settingsRes?.publicDeployment === true);

      // Handle one-time initial seeded router key reveal (/api/keys/reveal-initial)
      if (revealRes) {
        const rawKey =
          typeof revealRes.key === 'string'
            ? {
                id: revealRes.id || loadedKeys[0]?.id || 'initial',
                name: revealRes.name || loadedKeys[0]?.name || 'Default Router Key',
                key: revealRes.key,
                keyPreview: revealRes.keyPreview || loadedKeys[0]?.keyPreview,
              }
            : revealRes.key?.key
              ? revealRes.key
              : typeof revealRes.initialKey === 'string'
                ? {
                    id: loadedKeys[0]?.id || 'initial',
                    name: loadedKeys[0]?.name || 'Default Router Key',
                    key: revealRes.initialKey,
                  }
                : null;

        if (rawKey?.key) {
          rememberRouterKey(rawKey);
          setOneTimeBannerKey(rawKey);
        }
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const trimmed = newKeyName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await keysApi.create(trimmed);
      const created = res?.key;
      if (created) {
        if (created.key) {
          rememberRouterKey(created);
        }
        setKeys((prev) => [created, ...prev]);
        setCreateOpen(false);
        setNewKeyName('');
        setCreatedKeyModal(created);
        setOneTimeBannerKey(created);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to create router key');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleKey = async (keyItem, nextEnabled) => {
    setKeys((prev) =>
      prev.map((k) => (k.id === keyItem.id ? { ...k, enabled: nextEnabled } : k))
    );
    try {
      const res = await keysApi.patch(keyItem.id, { enabled: nextEnabled });
      if (res?.key) {
        setKeys((prev) => prev.map((k) => (k.id === keyItem.id ? res.key : k)));
      }
      toast.success(
        `Key "${keyItem.name}" ${nextEnabled ? t('common.enabled') : t('common.disabled')}`
      );
    } catch (err) {
      setKeys((prev) =>
        prev.map((k) => (k.id === keyItem.id ? { ...k, enabled: keyItem.enabled } : k))
      );
      toast.error(err?.message || 'Failed to update key');
    }
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setRenaming(true);
    try {
      const res = await keysApi.patch(renameTarget.id, { name: trimmed });
      if (res?.key) {
        setKeys((prev) => prev.map((k) => (k.id === renameTarget.id ? res.key : k)));
      }
      setRenameTarget(null);
      toast.success('Router key renamed');
    } catch (err) {
      toast.error(err?.message || 'Failed to rename key');
    } finally {
      setRenaming(false);
    }
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await keysApi.remove(revokeTarget.id);
      setKeys((prev) => prev.filter((k) => k.id !== revokeTarget.id));
      const deletedName = revokeTarget.name;
      setRevokeTarget(null);
      toast.success(`Revoked router key "${deletedName}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to revoke key');
    } finally {
      setRevoking(false);
    }
  };

  const handleUpdateKeyAccess = async (keyItem, nextAccess) => {
    setKeys((prev) =>
      prev.map((k) => (k.id === keyItem.id ? { ...k, access: nextAccess } : k))
    );
    try {
      const res = await keysApi.patch(keyItem.id, { access: nextAccess });
      if (res?.key) {
        setKeys((prev) => prev.map((k) => (k.id === keyItem.id ? res.key : k)));
      }
      toast.success(
        nextAccess.restricted
          ? `Restricted "${keyItem.name}" to ${nextAccess.allow?.length || 0} allowed target(s)`
          : `Unrestricted access for "${keyItem.name}"`
      );
    } catch (err) {
      setKeys((prev) =>
        prev.map((k) => (k.id === keyItem.id ? { ...k, access: keyItem.access } : k))
      );
      toast.error(err?.message || 'Failed to update key access controls');
    }
  };

  const handleToggleRequireKey = async (nextVal) => {
    const prev = settings?.requireKey !== false;
    setSettings((s) => (s ? { ...s, requireKey: nextVal } : { requireKey: nextVal }));
    try {
      const res = await settingsApi.update({ requireKey: nextVal });
      if (res?.settings) setSettings(res.settings);
      toast.success(
        nextVal ? 'Router API Key authentication required on /v1/*' : 'Router API Key now optional on localhost'
      );
    } catch (err) {
      setSettings((s) => (s ? { ...s, requireKey: prev } : s));
      toast.error(err?.message || 'Failed to update Require API Key setting');
    }
  };

  const handleHealthPing = async () => {
    setPinging(true);
    const t0 = performance.now();
    try {
      const res = await healthApi.check();
      const ms = Math.round(performance.now() - t0);
      setPingResult({ ok: Boolean(res?.ok), ms, port: res?.port });
      toast.success(`Gateway healthy on :${res?.port || 20128} (${ms}ms)`);
    } catch (err) {
      setPingResult({ ok: false, ms: 0 });
      toast.error(err?.message || 'Gateway health check failed');
    } finally {
      setPinging(false);
    }
  };

  const enabledProviders = providers.filter((p) => p.enabled !== false).length;
  const enabledCombos = combos.filter((c) => c.enabled !== false).length;
  const summary = usage?.summary || {};
  const totalReq = summary.totalRequests || 0;
  const successRate =
    totalReq > 0 ? `${((summary.successRequests / totalReq) * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs">
            <span
              className="font-medium text-[var(--text-secondary)]"
              title={
                publicDeployment
                  ? 'Bản công khai: /v1/* luôn bắt buộc router API key (không tắt được)'
                  : undefined
              }
            >
              Require Key{publicDeployment ? ' · bản công khai' : ''}
            </span>
            <Switch
              size="sm"
              checked={publicDeployment || settings?.requireKey !== false}
              onChange={handleToggleRequireKey}
              disabled={publicDeployment}
              aria-label="Require Router API Key on /v1/*"
            />
          </div>
          <button
            type="button"
            onClick={handleHealthPing}
            disabled={pinging}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            {pinging
              ? 'Pinging…'
              : pingResult
                ? pingResult.ok
                  ? `Healthy (${pingResult.ms}ms)`
                  : 'Offline'
                : 'Ping Gateway'}
          </button>
          <Link to="/skills" className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
            Agent Skills →
          </Link>
          <Link to="/settings/pricing" className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
            Pricing →
          </Link>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('overview.createKey')}
          </button>
        </div>
      </div>

      {/* Prominent One-Time Key Reveal Banner (Shown Only Once — Stored as SHA-256 Hash) */}
      {oneTimeBannerKey?.key ? (
        <section
          role="alert"
          aria-label="One-time Router API Key Reveal"
          className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4 shadow-lg"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ux-warn)]"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-sm font-bold text-[var(--ux-warn)]">
                  Copy Your Key Now (Shown Only Once)
                </h2>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  The full secret for{' '}
                  <strong className="text-[var(--text-primary)]">{oneTimeBannerKey.name}</strong> is
                  only displayed once. Copy and save this token before closing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOneTimeBannerKey(null)}
              aria-label="Dismiss one-time key banner"
              className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-[var(--bg-card)] px-3.5 py-2.5">
            <code className="font-mono text-sm font-bold text-[var(--ux-mint)] select-all break-all">
              {oneTimeBannerKey.key}
            </code>
            <CopyButton
              value={oneTimeBannerKey.key}
              label="Copy Secret Key"
              toastMessage={`Copied router key "${oneTimeBannerKey.name}"`}
            />
          </div>
        </section>
      ) : null}

      {/* Unified Primary Endpoint Cards */}
      <section aria-label="Gateway Endpoints" className="grid gap-4 lg:grid-cols-2">
        <div className="r-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E56A4A]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('overview.openaiUrl')}
            </span>
            <CopyButton
              value={openaiBaseUrl}
              label={t('overview.copyUrl')}
              toastMessage="Copied OpenAI Base URL"
            />
          </div>
          <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2.5 font-mono text-sm text-[var(--text-primary)] select-all break-all">
            {openaiBaseUrl}
          </div>
          <p className="mt-2.5 text-xs text-[var(--text-secondary)]">
            {t('overview.openaiDesc')}
          </p>
        </div>

        <div className="r-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E56A4A]">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              {t('overview.anthropicUrl')}
            </span>
            <CopyButton
              value={anthropicBaseUrl}
              label={t('overview.copyUrl')}
              toastMessage="Copied Anthropic Base URL"
            />
          </div>
          <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3.5 py-2.5 font-mono text-sm text-[var(--text-primary)] select-all break-all">
            {anthropicBaseUrl}
          </div>
          <p className="mt-2.5 text-xs text-[var(--text-secondary)]">
            {t('overview.anthropicDesc')}
          </p>
        </div>
      </section>

      {/* 9 Service Kinds Unified Endpoints Grid (Section 9.4 & 9.9) */}
      <section aria-label="9 Service Kinds Unified Endpoints" className="r-card space-y-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                9 Service Kinds — Unified OpenAI &amp; Anthropic Endpoints
              </h2>
              <span className="rounded-full border border-[#E56A4A]/30 bg-[#E56A4A]/12 px-2 py-0.5 text-[10px] font-semibold text-[#E56A4A]">
                1 Port · 9 Service Kinds
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Every endpoint below shares the same Router API Key (<code>Bearer sk-001r-...</code>{' '}
              or <code>x-api-key</code>) and routes to official provider APIs.
            </p>
          </div>
          <Link to="/models" className="text-xs font-medium text-[#E56A4A] hover:underline">
            Explore 470+ Models by Service Kind →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_KINDS_META.map((svc) => {
            const Icon = SERVICE_ICONS[svc.id] || Sparkles;
            const fullUrl = `${origin}${svc.path}`;
            return (
              <div
                key={svc.id}
                className="r-card-subtle flex flex-col justify-between p-3.5 transition-colors hover:border-[#E56A4A]/50"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                      <Icon className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                      {svc.label}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        svc.method === 'GET'
                          ? 'bg-sky-500/15 text-sky-400'
                          : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {svc.method}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {svc.desc}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5">
                  <code className="single-line-truncate font-mono text-[11px] text-[#E56A4A] select-all">
                    {fullUrl}
                  </code>
                  <CopyButton
                    value={fullUrl}
                    size="xs"
                    iconOnly
                    label={`Copy ${svc.label} endpoint`}
                    toastMessage={`Copied ${fullUrl}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick KPI Cards */}
      <LucianGlowGrid
        as="section"
        ariaLabel="Quick Summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <LucianGlowCard as={Link} to="/providers" innerClassName="group p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {t('overview.kpiProviders')}
            </span>
            <Server className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {enabledProviders}
            </span>
            <span className="text-xs text-[var(--text-muted)]">/ {providers.length}</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] group-hover:text-[#E56A4A]">
            {t('overview.manageProviders')} <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </div>
        </LucianGlowCard>

        <LucianGlowCard as={Link} to="/combos" innerClassName="group p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {t('overview.kpiCombos')}
            </span>
            <Layers className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">{enabledCombos}</span>
            <span className="text-xs text-[var(--text-muted)]">/ {combos.length}</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] group-hover:text-[#E56A4A]">
            {t('overview.manageCombos')} <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </div>
        </LucianGlowCard>

        <LucianGlowCard as={Link} to="/usage" innerClassName="group p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {t('overview.kpiRequests')}
            </span>
            <Activity className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {formatNumber(totalReq)}
            </span>
            <span className="text-xs text-emerald-500">{successRate} ok</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] group-hover:text-[#E56A4A]">
            {t('overview.viewUsage')} <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </div>
        </LucianGlowCard>

        <LucianGlowCard as={Link} to="/token-saver" innerClassName="group p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {t('overview.kpiTokenSaver')}
            </span>
            <KeyRound className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {formatCompactNumber(summary.savedChars || 0)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{t('overview.charsTrimmed')}</span>
          </div>
          <div className="mt-2 text-xs text-[var(--text-secondary)]">
            Auth:{' '}
            <span
              className={
                settings?.requireKey === false && !publicDeployment
                  ? 'text-amber-500'
                  : 'text-emerald-500'
              }
            >
              {settings?.requireKey === false && !publicDeployment ? 'Key optional' : 'Key required'}
            </span>
          </div>
        </LucianGlowCard>
      </LucianGlowGrid>

      {/* Router API Keys Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2
              id="router-keys-heading"
              className="text-base font-semibold text-[var(--text-primary)]"
            >
              {t('overview.routerKeys')} ({keys.length})
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">{t('overview.routerKeysDesc')}</p>
          </div>
          <Link to="/cli-tools" className="text-xs font-medium text-[#E56A4A] hover:underline">
            {t('overview.cliSnippetsLink')}
          </Link>
        </div>

        {keys.length === 0 && !loading ? (
          <div className="r-card border-dashed p-8 text-center">
            <KeyRound className="mx-auto h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">
              {t('overview.noKeysTitle')}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{t('overview.noKeysDesc')}</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="r-btn-primary mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('overview.createFirstKey')}
            </button>
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="router-keys-heading"
            className="responsive-table-wrapper"
          >
            <table className="responsive-table responsive-table--stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key Preview &amp; Storage</th>
                  <th>Status</th>
                  <th>Requests</th>
                  <th>Last Used</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((item) => {
                  const fullKey = getRememberedRouterKey(item);
                  const isRevealed = revealedIds.has(item.id);
                  const displayKey =
                    isRevealed && fullKey ? fullKey : item.keyPreview || item.key || 'sk-001r-••••';

                  return (
                    <tr key={item.id} className="text-sm">
                      <td data-label="Name" className="font-medium text-[var(--text-primary)]">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="single-line-truncate">{item.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setRenameTarget(item);
                              setRenameValue(item.name);
                            }}
                            aria-label={`Rename ${item.name}`}
                            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>

                      <td data-label="Key">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]">
                              {displayKey}
                            </code>
                            {fullKey ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleReveal(item.id)}
                                  aria-label={
                                    isRevealed ? `Mask ${item.name}` : `Reveal ${item.name}`
                                  }
                                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                                >
                                  {isRevealed ? (
                                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                </button>
                                <CopyButton
                                  value={fullKey}
                                  size="xs"
                                  iconOnly
                                  label={`Copy key ${item.name}`}
                                  toastMessage={`Copied key "${item.name}"`}
                                />
                              </>
                            ) : null}
                          </div>
                          <KeyAccessControls
                            apiKey={item}
                            combos={combos}
                            providers={providers}
                            onChange={(nextAccess) => handleUpdateKeyAccess(item, nextAccess)}
                          />
                        </div>
                      </td>

                      <td data-label="Status">
                        <div className="inline-flex items-center gap-2">
                          <Switch
                            size="sm"
                            checked={item.enabled}
                            onChange={(val) => handleToggleKey(item, val)}
                            aria-label={`Toggle key ${item.name}`}
                          />
                          <span
                            className={`text-xs font-medium ${
                              item.enabled ? 'text-emerald-500' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {item.enabled ? t('common.active') : t('common.disabled')}
                          </span>
                        </div>
                      </td>

                      <td
                        data-label="Requests"
                        className="font-mono text-xs text-[var(--text-primary)]"
                      >
                        {formatNumber(item.requestCount || 0)}
                      </td>

                      <td data-label="Last Used" className="text-xs text-[var(--text-secondary)]">
                        {formatRelativeTime(item.lastUsedAt)}
                      </td>

                      <td data-label="Actions" className="text-right">
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(item)}
                          aria-label={`Revoke key ${item.name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('overview.revoke')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Key Dialog */}
      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('overview.createKey')}
        subtitle="Generate a client token (sk-001r-...). The full secret is shown only once."
        size="sm"
      >
        <form onSubmit={handleCreateKey} className="space-y-4">
          <div>
            <label
              htmlFor="new-key-name"
              className="block text-sm font-medium text-[var(--text-primary)]"
            >
              Key Label
            </label>
            <input
              id="new-key-name"
              type="text"
              required
              autoFocus
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Claude Code, Cursor, Codex CLI"
              className="field-input mt-2 w-full px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="r-btn-secondary px-3.5 py-2 text-xs"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={creating || !newKeyName.trim()}
              className="r-btn-primary px-4 py-2 text-xs"
            >
              {creating ? t('common.saving') : t('overview.createKey')}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Newly Created Key Modal (Shown Only Once) */}
      <ModalDialog
        open={Boolean(createdKeyModal)}
        onClose={() => setCreatedKeyModal(null)}
        title="Copy Your Key Now (Shown Only Once)"
        subtitle={`Key "${createdKeyModal?.name || ''}" cannot be viewed again after closing.`}
        size="sm"
        footer={
          <button
            type="button"
            onClick={() => setCreatedKeyModal(null)}
            className="r-btn-primary px-4 py-2 text-xs"
          >
            {t('common.done')}
          </button>
        }
      >
        {createdKeyModal ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-[var(--ux-warn)]">
              <strong>Important:</strong> Copy this secret key now. Only a masked preview (
              <code>{createdKeyModal.keyPreview || 'prefix…last4'}</code>) will remain visible
              after closing.
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
              <code className="flex-1 overflow-x-auto text-xs font-semibold text-[var(--ux-mint)] select-all">
                {createdKeyModal.key}
              </code>
              <CopyButton value={createdKeyModal.key} />
            </div>
          </div>
        ) : null}
      </ModalDialog>

      {/* Rename Modal */}
      <ModalDialog
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename Router Key"
        size="sm"
      >
        <form onSubmit={handleRenameSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="rename-key-input"
              className="block text-sm font-medium text-[var(--text-primary)]"
            >
              New Label
            </label>
            <input
              id="rename-key-input"
              type="text"
              required
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="field-input mt-2 w-full px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="r-btn-secondary px-3.5 py-2 text-xs"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={renaming || !renameValue.trim()}
              className="r-btn-primary px-4 py-2 text-xs"
            >
              {renaming ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeConfirm}
        title="Revoke Router API Key?"
        destructive
        busy={revoking}
        confirmLabel={t('overview.revoke')}
        message={
          <p>
            Tools using <strong>{revokeTarget?.name}</strong> (
            <code>{revokeTarget?.keyPreview}</code>) will immediately fail with <code>401</code>{' '}
            when router key auth is enabled.
          </p>
        }
      />
    </div>
  );
}
