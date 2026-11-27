import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  combosApi,
  getRememberedRouterKey,
  keysApi,
  providersApi,
  rememberRouterKey,
  settingsApi,
  tunnelApi,
} from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CopyButton } from '../components/CopyButton';
import { Switch } from '../components/Switch';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyAccessControls } from '../components/KeyAccessControls';

function SecurityBanner({ message, actionLabel, actionTo }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {actionTo ? (
        <Link
          to={actionTo}
          className="shrink-0 font-semibold text-amber-200 underline hover:text-white"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function OverviewPage() {
  const { defaultPassword } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [settingsState, setSettingsState] = useState({
    requireKey: true,
    tunnelDashboardAccess: false,
    publicDeployment: false,
  });

  const [tunnelState, setTunnelState] = useState({
    tunnel: { enabled: false, running: false, tunnelUrl: '' },
    tailscale: { installed: false, loggedIn: false, running: false, enabled: false, tunnelUrl: '' },
    download: { downloading: false, progress: 0 },
    unavailableReason: '',
  });
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tsBusy, setTsBusy] = useState(false);
  const [tsActionLink, setTsActionLink] = useState(null);
  const [disableTunnelOpen, setDisableTunnelOpen] = useState(false);

  const [initialRevealedKey, setInitialRevealedKey] = useState('');
  const [visibleKeys, setVisibleKeys] = useState(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdBannerKey, setCreatedBannerKey] = useState(null);

  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [pauseTarget, setPauseTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [mutatingKey, setMutatingKey] = useState(false);

  const pollTimerRef = useRef(null);

  const localOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:20128'),
    []
  );
  const localEndpoint = `${localOrigin}/v1`;
  const isRemoteHost =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, settingsRes, tunRes, provRes, combosRes] = await Promise.all([
        keysApi.list().catch(() => ({ keys: [] })),
        settingsApi.get().catch(() => null),
        tunnelApi.status().catch(() => null),
        providersApi.list().catch(() => ({ providers: [] })),
        combosApi.list().catch(() => ({ combos: [] })),
      ]);

      setKeys(keysRes?.keys || []);
      setProviders(provRes?.providers || []);
      setCombos(combosRes?.combos || []);

      if (settingsRes) {
        const s = settingsRes.settings || {};
        setSettingsState({
          requireKey: settingsRes.effective?.requireKey ?? s.requireKey !== false,
          tunnelDashboardAccess: Boolean(s.tunnelDashboardAccess),
          publicDeployment: Boolean(settingsRes.publicDeployment),
        });
      }

      if (tunRes) {
        setTunnelState(tunRes);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    keysApi
      .revealInitial()
      .then((res) => {
        if (res?.revealed && res?.key?.key) {
          rememberRouterKey(res.key);
          setInitialRevealedKey(res.key.key);
        }
      })
      .catch(() => {});

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [loadAll]);

  const startTunnelDownloadPoll = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const status = await tunnelApi.status();
        if (status) setTunnelState(status);
        if (!status?.download?.downloading) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } catch {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }, 1000);
  };

  const handleEnableTunnel = async () => {
    setTunnelBusy(true);
    startTunnelDownloadPoll();
    try {
      const res = await tunnelApi.enable();
      const refreshed = await tunnelApi.status().catch(() => null);
      if (refreshed) setTunnelState(refreshed);
      if (res?.tunnelUrl) {
        toast.success(`Cloudflare Tunnel enabled: ${res.tunnelUrl}`);
      } else {
        toast.success('Cloudflare Tunnel started');
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to enable Cloudflare Tunnel');
    } finally {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setTunnelBusy(false);
    }
  };

  const handleConfirmDisableTunnel = async () => {
    setTunnelBusy(true);
    try {
      await tunnelApi.disable();
      const refreshed = await tunnelApi.status().catch(() => null);
      if (refreshed) setTunnelState(refreshed);
      setDisableTunnelOpen(false);
      toast.success('Cloudflare Tunnel disabled');
    } catch (err) {
      toast.error(err?.message || 'Failed to disable Cloudflare Tunnel');
    } finally {
      setTunnelBusy(false);
    }
  };

  const handleEnableTailscale = async () => {
    setTsBusy(true);
    setTsActionLink(null);
    try {
      const res = await tunnelApi.tailscaleEnable();
      if (res?.needsLogin && res?.authUrl) {
        setTsActionLink({ label: 'Open Tailscale Login', url: res.authUrl });
        toast.error(res.error || 'Tailscale login required');
        return;
      }
      if (res?.funnelNotEnabled && res?.enableUrl) {
        setTsActionLink({ label: 'Enable Funnel on Tailnet', url: res.enableUrl });
        toast.error(res.error || 'Enable Tailscale Funnel first');
        return;
      }
      if (!res?.success) {
        toast.error(res?.error || 'Failed to start Tailscale Funnel');
        return;
      }
      const refreshed = await tunnelApi.status().catch(() => null);
      if (refreshed) setTunnelState(refreshed);
      toast.success(`Tailscale Funnel active: ${res.tunnelUrl}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to start Tailscale Funnel');
    } finally {
      setTsBusy(false);
    }
  };

  const handleDisableTailscale = async () => {
    setTsBusy(true);
    try {
      await tunnelApi.tailscaleDisable();
      const refreshed = await tunnelApi.status().catch(() => null);
      if (refreshed) setTunnelState(refreshed);
      toast.success('Tailscale Funnel disabled');
    } catch (err) {
      toast.error(err?.message || 'Failed to disable Tailscale Funnel');
    } finally {
      setTsBusy(false);
    }
  };

  const handleToggleTunnelDashboard = async (nextVal) => {
    try {
      const res = await settingsApi.update({ tunnelDashboardAccess: nextVal });
      if (res?.settings) {
        setSettingsState((prev) => ({
          ...prev,
          tunnelDashboardAccess: Boolean(res.settings.tunnelDashboardAccess),
        }));
      }
      toast.success(
        nextVal ? 'Dashboard access via tunnel enabled' : 'Dashboard access via tunnel blocked'
      );
    } catch (err) {
      toast.error(err?.message || 'Failed to update tunnel dashboard setting');
    }
  };

  const handleToggleRequireKey = async (nextVal) => {
    try {
      const res = await settingsApi.update({ requireKey: nextVal });
      setSettingsState((prev) => ({
        ...prev,
        requireKey: res?.effective?.requireKey ?? nextVal,
      }));
      toast.success(nextVal ? 'API key enforcement enabled' : 'Local open access enabled');
    } catch (err) {
      toast.error(err?.message || 'Failed to update require-key setting');
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const name = newKeyName.trim();
    if (!name) return;
    setCreatingKey(true);
    try {
      const res = await keysApi.create(name);
      const created = res?.key;
      if (created) {
        rememberRouterKey(created);
        setKeys((prev) => [...prev, { ...created, key: undefined }]);
        setCreatedBannerKey(created);
        setVisibleKeys((prev) => {
          const next = new Set(prev);
          next.add(created.id);
          return next;
        });
      }
      setNewKeyName('');
      setCreateOpen(false);
      toast.success(`Created key "${name}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to create API key');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setMutatingKey(true);
    try {
      const res = await keysApi.patch(renameTarget.id, { name: trimmed });
      setKeys((prev) =>
        prev.map((k) => (k.id === renameTarget.id ? res?.key || { ...k, name: trimmed } : k))
      );
      setRenameTarget(null);
      toast.success('Renamed API key');
    } catch (err) {
      toast.error(err?.message || 'Failed to rename key');
    } finally {
      setMutatingKey(false);
    }
  };

  const applyKeyPatch = async (keyId, patch, successMsg) => {
    setMutatingKey(true);
    try {
      const res = await keysApi.patch(keyId, patch);
      setKeys((prev) => prev.map((k) => (k.id === keyId ? res?.key || { ...k, ...patch } : k)));
      if (successMsg) toast.success(successMsg);
    } catch (err) {
      toast.error(err?.message || 'Failed to update key');
    } finally {
      setMutatingKey(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setMutatingKey(true);
    try {
      await keysApi.remove(deleteTarget.id);
      setKeys((prev) => prev.filter((k) => k.id !== deleteTarget.id));
      toast.success(`Deleted key "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.message || 'Failed to delete key');
    } finally {
      setMutatingKey(false);
    }
  };

  const toggleVisibility = (keyObj) => {
    const remembered = getRememberedRouterKey(keyObj);
    if (!remembered && !visibleKeys.has(keyObj.id)) {
      toast.error('Plaintext keys can only be viewed once when created on this browser.');
      return;
    }
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyObj.id)) next.delete(keyObj.id);
      else next.add(keyObj.id);
      return next;
    });
  };

  const tunnel = tunnelState.tunnel || {};
  const tailscale = tunnelState.tailscale || {};
  const download = tunnelState.download || {};
  const anyTunnelActive = Boolean(tunnel.enabled || tailscale.enabled);
  const tunnelsUnavailable = Boolean(tunnelState.unavailableReason || settingsState.publicDeployment);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {defaultPassword ? (
        <SecurityBanner
          message="Dashboard is still using the default password (1234). Change it before exposing any remote endpoint."
          actionLabel="Change password"
          actionTo="/settings"
        />
      ) : null}

      {/* Card 1: API Endpoint */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-[#E56A4A]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">API Endpoint</h2>
          </div>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>

        {/* Row 1: Local */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
              <Monitor className="h-3 w-3" aria-hidden="true" />
              Local
            </span>
            <code className="truncate font-mono text-xs text-[var(--text-primary)]">
              {localEndpoint}
            </code>
          </div>
          <CopyButton value={localEndpoint} size="xs" toastMessage="Copied local endpoint URL" />
        </div>

        {/* Row 2: Cloudflare Tunnel */}
        {!tunnelsUnavailable ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  tunnel.enabled
                    ? 'bg-orange-500/15 text-orange-400'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                }`}
              >
                <Cloud className="h-3 w-3" aria-hidden="true" />
                Cloudflare Tunnel
              </span>
              {tunnel.enabled && tunnel.tunnelUrl ? (
                <code className="truncate font-mono text-xs text-[var(--text-primary)]">
                  {`${tunnel.tunnelUrl}/v1`}
                </code>
              ) : download.downloading ? (
                <span className="text-xs text-[var(--text-secondary)]">
                  Downloading cloudflared ({download.progress || 0}%)…
                </span>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">
                  Temporary HTTPS URL (*.trycloudflare.com)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {tunnel.enabled && tunnel.tunnelUrl ? (
                <>
                  <CopyButton
                    value={`${tunnel.tunnelUrl}/v1`}
                    size="xs"
                    toastMessage="Copied tunnel endpoint"
                  />
                  <button
                    type="button"
                    disabled={tunnelBusy}
                    onClick={() => setDisableTunnelOpen(true)}
                    className="r-btn-secondary px-3 py-1 text-xs text-red-400 hover:border-red-500/40"
                  >
                    Disable
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={tunnelBusy || defaultPassword || !settingsState.requireKey}
                  onClick={handleEnableTunnel}
                  className="r-btn-primary px-3 py-1 text-xs"
                  title={
                    defaultPassword || !settingsState.requireKey
                      ? 'Change default password and require API key first'
                      : 'Start Cloudflare Quick Tunnel'
                  }
                >
                  {tunnelBusy ? 'Starting…' : 'Enable'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
            {tunnelState.unavailableReason || 'Tunnels are disabled on public deployments.'}
          </div>
        )}

        {/* Row 3: Tailscale Funnel */}
        {!tunnelsUnavailable ? (
          <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    tailscale.enabled
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                  }`}
                >
                  Tailscale
                </span>
                {tailscale.enabled && tailscale.tunnelUrl ? (
                  <code className="truncate font-mono text-xs text-[var(--text-primary)]">
                    {`${tailscale.tunnelUrl}/v1`}
                  </code>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">
                    {tailscale.installed
                      ? 'Expose local router via Tailscale MagicDNS Funnel'
                      : 'Tailscale CLI not detected on PATH'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {tailscale.enabled && tailscale.tunnelUrl ? (
                  <>
                    <CopyButton
                      value={`${tailscale.tunnelUrl}/v1`}
                      size="xs"
                      toastMessage="Copied Tailscale endpoint"
                    />
                    <button
                      type="button"
                      disabled={tsBusy}
                      onClick={handleDisableTailscale}
                      className="r-btn-secondary px-3 py-1 text-xs text-red-400"
                    >
                      Disable
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={tsBusy || !tailscale.installed || defaultPassword}
                    onClick={handleEnableTailscale}
                    className="r-btn-secondary px-3 py-1 text-xs"
                  >
                    {tsBusy ? 'Connecting…' : 'Enable'}
                  </button>
                )}
              </div>
            </div>

            {tsActionLink ? (
              <div className="flex items-center justify-between rounded border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs">
                <span className="text-sky-300">Action required in Tailscale admin:</span>
                <a
                  href={tsActionLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-sky-200 underline"
                >
                  {tsActionLink.label}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Active tunnel warnings & Dashboard access toggle */}
        {anyTunnelActive ? (
          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            {!settingsState.requireKey ? (
              <SecurityBanner message="Require API key is disabled — remote endpoints are open without a key!" />
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  Allow dashboard access via tunnel
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  When disabled, tunnel hosts only serve <code className="font-mono">/v1/*</code>{' '}
                  API traffic and reject dashboard routes.
                </div>
              </div>
              <Switch
                checked={settingsState.tunnelDashboardAccess}
                disabled={defaultPassword}
                onChange={handleToggleTunnelDashboard}
                aria-label="Allow dashboard access via tunnel"
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* One-time reveal banners */}
      {initialRevealedKey ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-emerald-400">
              Initial Router API Key (shown once)
            </div>
            <code className="mt-1 block truncate font-mono text-[var(--text-primary)]">
              {initialRevealedKey}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton value={initialRevealedKey} size="xs" />
            <button
              type="button"
              onClick={() => setInitialRevealedKey('')}
              className="r-btn-secondary px-2.5 py-1 text-xs"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {createdBannerKey ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-emerald-400">
              New API Key Created: {createdBannerKey.name}
            </div>
            <code className="mt-1 block truncate font-mono text-[var(--text-primary)]">
              {createdBannerKey.key}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton value={createdBannerKey.key} size="xs" />
            <button
              type="button"
              onClick={() => setCreatedBannerKey(null)}
              className="r-btn-secondary px-2.5 py-1 text-xs"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* Card 2: API Keys */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#E56A4A]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">API Keys</h2>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create Key
          </button>
        </div>

        {/* Require API key row */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">Require API key</div>
            <div className="text-xs text-[var(--text-muted)]">
              Requests without a valid router key are rejected with HTTP 401.
            </div>
          </div>
          <Switch
            checked={settingsState.requireKey}
            disabled={settingsState.publicDeployment || isRemoteHost}
            onChange={handleToggleRequireKey}
            aria-label="Require API key"
          />
        </div>

        {keys.length === 0 ? (
          <div className="py-10 text-center">
            <KeyRound className="mx-auto mb-3 h-8 w-8 text-[#E56A4A]/70" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--text-primary)]">No API keys yet</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Create your first API key to authenticate IDE extensions and CLI tools.
            </p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="r-btn-primary mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create Key
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {keys.map((keyObj) => {
              const remembered = getRememberedRouterKey(keyObj);
              const isVisible = visibleKeys.has(keyObj.id) && Boolean(remembered);
              const isEnabled = keyObj.enabled !== false;

              return (
                <div
                  key={keyObj.id}
                  className={`py-3.5 first:pt-1 last:pb-1 ${!isEnabled ? 'opacity-65' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {keyObj.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameTarget(keyObj);
                            setRenameValue(keyObj.name);
                          }}
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                          title="Rename key"
                          aria-label={`Rename ${keyObj.name}`}
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                        {!isEnabled ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                            Paused
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <code className="font-mono text-xs text-[var(--text-secondary)]">
                          {isVisible ? remembered : keyObj.keyPreview}
                        </code>
                        <button
                          type="button"
                          onClick={() => toggleVisibility(keyObj)}
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                          title={isVisible ? 'Hide key' : 'Show key'}
                          aria-label={isVisible ? 'Hide key' : 'Show key'}
                        >
                          {isVisible ? (
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                        <CopyButton
                          value={remembered || keyObj.keyPreview}
                          size="xs"
                          iconOnly
                          label="Copy key"
                        />
                      </div>

                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Created {new Date(keyObj.createdAt).toLocaleDateString()} ·{' '}
                        {keyObj.requestCount || 0} requests
                      </div>

                      <KeyAccessControls
                        apiKey={keyObj}
                        combos={combos}
                        providers={providers}
                        onChange={(access) => applyKeyPatch(keyObj.id, { access })}
                      />
                    </div>

                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      <Switch
                        size="sm"
                        checked={isEnabled}
                        onChange={(checked) => {
                          if (!checked) {
                            setPauseTarget(keyObj);
                          } else {
                            applyKeyPatch(keyObj.id, { enabled: true }, 'Resumed API key');
                          }
                        }}
                        aria-label={`Toggle ${keyObj.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(keyObj)}
                        className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-500/12"
                        title="Delete key"
                        aria-label={`Delete ${keyObj.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Create Key Modal */}
      <ModalDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setNewKeyName('');
        }}
        title="Create API Key"
        size="sm"
      >
        <form onSubmit={handleCreateKey} className="space-y-4">
          <div>
            <label
              htmlFor="new-key-name"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Key Name
            </label>
            <input
              id="new-key-name"
              type="text"
              autoFocus
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Claude Code / Cursor Key"
              className="field-input mt-1.5 w-full px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="r-btn-secondary px-3.5 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingKey || !newKeyName.trim()}
              className="r-btn-primary px-3.5 py-2 text-xs"
            >
              {creatingKey ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Rename Key Modal */}
      <ModalDialog
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename API Key"
        size="sm"
      >
        <form onSubmit={handleRenameSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="rename-key-input"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Key Name
            </label>
            <input
              id="rename-key-input"
              type="text"
              autoFocus
              required
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              className="r-btn-secondary px-3.5 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutatingKey || !renameValue.trim()}
              className="r-btn-primary px-3.5 py-2 text-xs"
            >
              Save
            </button>
          </div>
        </form>
      </ModalDialog>

      <ConfirmDialog
        open={disableTunnelOpen}
        onClose={() => setDisableTunnelOpen(false)}
        onConfirm={handleConfirmDisableTunnel}
        title="Disable Cloudflare Tunnel?"
        destructive
        busy={tunnelBusy}
        confirmLabel="Disable Tunnel"
        message={
          <p>Active clients using the current *.trycloudflare.com URL will lose remote access.</p>
        }
      />

      <ConfirmDialog
        open={Boolean(pauseTarget)}
        onClose={() => setPauseTarget(null)}
        onConfirm={async () => {
          const target = pauseTarget;
          setPauseTarget(null);
          if (target) await applyKeyPatch(target.id, { enabled: false }, 'Paused API key');
        }}
        title="Pause API Key?"
        confirmLabel="Pause Key"
        message={
          <p>
            Pause <strong>{pauseTarget?.name}</strong>? Requests using this key will be rejected
            until resumed.
          </p>
        }
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete API Key?"
        destructive
        busy={mutatingKey}
        confirmLabel="Delete Key"
        message={
          <p>
            Permanently revoke <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </p>
        }
      />
    </div>
  );
}

export default OverviewPage;
