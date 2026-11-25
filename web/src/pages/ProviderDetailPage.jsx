import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Clock,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  aliasesApi,
  disabledModelsApi,
  providersApi,
  proxyPoolsApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Switch } from '../components/Switch';
import { CopyButton } from '../components/CopyButton';
import { ModalDialog } from '../components/ModalDialog';
import { ProviderLogo } from '../components/ProviderLogo';

function formatCountdown(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function ProviderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [provider, setProvider] = useState(null);
  const [preset, setPreset] = useState(null);
  const [disabledModels, setDisabledModels] = useState([]);
  const [aliases, setAliases] = useState({});
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [modelSearch, setModelSearch] = useState('');
  const [testingKeyId, setTestingKeyId] = useState(null);
  const [refreshingKeyId, setRefreshingKeyId] = useState(null);
  const [keyTestResults, setKeyTestResults] = useState({});
  const [testingModel, setTestingModel] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [inspectingAccount, setInspectingAccount] = useState(false);
  const [accountReport, setAccountReport] = useState(null);

  // Add API key modal
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeySecret, setNewKeySecret] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  // Add custom model modal
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  // Inline alias editor
  const [aliasEditingModel, setAliasEditingModel] = useState(null);
  const [aliasDraft, setAliasDraft] = useState('');

  // Provider config form
  const [cfgBaseUrl, setCfgBaseUrl] = useState('');
  const [cfgFormatType, setCfgFormatType] = useState('openai');
  const [cfgProxyPoolId, setCfgProxyPoolId] = useState('');
  const [cfgEnabled, setCfgEnabled] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const [detailRes, aliasRes, poolsRes] = await Promise.all([
        providersApi.get(id),
        aliasesApi.list().catch(() => ({ aliases: {} })),
        proxyPoolsApi.list().catch(() => ({ pools: [] })),
      ]);
      const p = detailRes?.provider || null;
      if (!p) {
        setNotFound(true);
        return;
      }
      setProvider(p);
      setPreset(detailRes?.preset || null);
      setDisabledModels(detailRes?.disabledModels || []);
      setAliases(aliasRes?.aliases || {});
      setProxyPools(poolsRes?.pools || poolsRes?.proxyPools || []);
      setCfgBaseUrl(p.baseUrl || '');
      setCfgFormatType(p.formatType || 'openai');
      setCfgProxyPoolId(p.proxyPoolId || '');
      setCfgEnabled(p.enabled !== false);
    } catch (err) {
      if (err?.status === 404) {
        setNotFound(true);
      } else {
        toast.error(err?.message || 'Failed to load provider details');
      }
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const aliasByTarget = useMemo(() => {
    const map = new Map();
    if (!provider) return map;
    for (const [alias, target] of Object.entries(aliases || {})) {
      const prefix = `${provider.slug}/`;
      if (target === provider.slug) continue;
      if (target.startsWith(prefix)) {
        const mId = target.slice(prefix.length);
        const list = map.get(mId) || [];
        list.push(alias);
        map.set(mId, list);
      }
    }
    return map;
  }, [aliases, provider]);

  const disabledSet = useMemo(() => new Set(disabledModels), [disabledModels]);

  const filteredModels = useMemo(() => {
    const list = provider?.models || [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.toLowerCase().includes(q));
  }, [provider?.models, modelSearch]);

  const handleResetCooldown = async (keyId = '') => {
    if (!provider) return;
    try {
      const res = await providersApi.resetCooldown(provider.id, keyId);
      if (res?.provider) setProvider(res.provider);
      toast.success(keyId ? 'Reset key cooldown' : 'Reset all cooldowns');
    } catch (err) {
      toast.error(err?.message || 'Failed to reset cooldown');
    }
  };

  const handleTestKey = async (keyItem) => {
    if (!provider) return;
    setTestingKeyId(keyItem.id);
    try {
      const res = await providersApi.testKey(provider.id, keyItem.id);
      setKeyTestResults((prev) => ({ ...prev, [keyItem.id]: res }));
      if (res?.ok) {
        toast.success(`Key "${keyItem.label}" OK (${res.latencyMs || 0}ms)`);
        await loadDetail();
      } else {
        toast.error(res?.message || `Key "${keyItem.label}" test failed`);
      }
    } catch (err) {
      toast.error(err?.message || 'Key test failed');
    } finally {
      setTestingKeyId(null);
    }
  };

  const handleRefreshKey = async (keyItem) => {
    if (!provider) return;
    setRefreshingKeyId(keyItem.id);
    try {
      const res = await providersApi.refreshKey(provider.id, keyItem.id);
      if (res?.provider) setProvider(res.provider);
      toast.success(`Refreshed credentials for "${keyItem.label}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to refresh credentials');
    } finally {
      setRefreshingKeyId(null);
    }
  };

  const handleToggleKeyEnabled = async (keyItem, enabled) => {
    if (!provider) return;
    const nextKeys = (provider.apiKeys || []).map((k) => ({
      id: k.id,
      label: k.label,
      enabled: k.id === keyItem.id ? enabled : k.enabled !== false,
    }));
    try {
      const res = await providersApi.update(provider.id, { apiKeys: nextKeys });
      if (res?.provider) setProvider(res.provider);
      toast.success(`Key "${keyItem.label}" ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to update key');
    }
  };

  const handleDeleteKey = async (keyItem) => {
    if (!provider) return;
    const nextKeys = (provider.apiKeys || [])
      .filter((k) => k.id !== keyItem.id)
      .map((k) => ({ id: k.id, label: k.label, enabled: k.enabled !== false }));
    try {
      const res = await providersApi.update(provider.id, { apiKeys: nextKeys });
      if (res?.provider) setProvider(res.provider);
      toast.success(`Removed key "${keyItem.label}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to remove key');
    }
  };

  const handleAddKeySubmit = async (e) => {
    e.preventDefault();
    if (!provider || !newKeySecret.trim()) return;
    setSavingKey(true);
    try {
      const existing = (provider.apiKeys || []).map((k) => ({
        id: k.id,
        label: k.label,
        enabled: k.enabled !== false,
      }));
      const nextKeys = [
        ...existing,
        {
          label: newKeyLabel.trim() || `Key #${existing.length + 1}`,
          key: newKeySecret.trim(),
          enabled: true,
        },
      ];
      const res = await providersApi.update(provider.id, { apiKeys: nextKeys });
      if (res?.provider) setProvider(res.provider);
      setAddKeyOpen(false);
      setNewKeyLabel('');
      setNewKeySecret('');
      toast.success('Added encrypted API key');
    } catch (err) {
      toast.error(err?.message || 'Failed to add key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleFetchModels = async () => {
    if (!provider) return;
    setFetchingModels(true);
    try {
      const res = await providersApi.fetchModels(provider.id);
      if (res?.ok) {
        setProvider((prev) => (prev ? { ...prev, models: res.models || prev.models } : prev));
        toast.success(res.message || `Synced ${res.models?.length || 0} models`);
      } else {
        toast.error(res?.message || 'Failed to fetch live models');
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to fetch models');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleInspectAccount = async (keyId = '') => {
    if (!provider) return;
    setInspectingAccount(true);
    try {
      const res = await providersApi.inspectAccount(
        provider.id,
        keyId ? { keyId, checkBilling: true } : { checkBilling: true }
      );
      setAccountReport(res);
      if (res?.billingStatus === 'inactive') {
        toast.error(res.billingMessage || 'Billing inactive or $0 credit detected');
      } else if (res?.ok) {
        toast.success(res.tierLabel || 'Verified account & plan');
      } else {
        toast.error(res?.message || res?.billingMessage || 'Inspection failed');
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to inspect account');
    } finally {
      setInspectingAccount(false);
    }
  };

  const handleAddCustomModel = async (e) => {
    e.preventDefault();
    if (!provider || !newModelId.trim()) return;
    setSavingModel(true);
    try {
      const res = await providersApi.addCustomModel(provider.id, newModelId.trim());
      if (res?.provider) setProvider(res.provider);
      setNewModelId('');
      setAddModelOpen(false);
      toast.success('Added custom model ID');
    } catch (err) {
      toast.error(err?.message || 'Failed to add model');
    } finally {
      setSavingModel(false);
    }
  };

  const handleRemoveModel = async (modelId) => {
    if (!provider) return;
    try {
      const res = await providersApi.removeCustomModel(provider.id, modelId);
      if (res?.provider) setProvider(res.provider);
      toast.success(`Removed "${modelId}" from provider`);
    } catch (err) {
      toast.error(err?.message || 'Failed to remove model');
    }
  };

  const handleToggleModelDisabled = async (modelId, currentlyDisabled) => {
    if (!provider) return;
    try {
      if (currentlyDisabled) {
        const res = await disabledModelsApi.enable(provider.slug, modelId);
        setDisabledModels(res?.ids || disabledModels.filter((x) => x !== modelId));
        toast.success(`Enabled "${modelId}"`);
      } else {
        const res = await disabledModelsApi.disable(provider.slug, [modelId]);
        setDisabledModels(res?.ids || [...disabledModels, modelId]);
        toast.success(`Disabled "${modelId}" from routing`);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to update model state');
    }
  };

  const handleTestModel = async (modelId) => {
    if (!provider) return;
    setTestingModel(modelId);
    try {
      const res = await providersApi.test(provider.id, modelId);
      setModelTestResults((prev) => ({ ...prev, [modelId]: res }));
      if (res?.ok) {
        toast.success(`${modelId}: OK (${res.latencyMs || 0}ms)`);
      } else {
        toast.error(res?.message || `${modelId}: test failed`);
      }
    } catch (err) {
      toast.error(err?.message || 'Model test failed');
    } finally {
      setTestingModel(null);
    }
  };

  const handleSaveAlias = async (modelId) => {
    if (!provider) return;
    const cleaned = aliasDraft.trim();
    if (!cleaned) {
      setAliasEditingModel(null);
      return;
    }
    try {
      const res = await aliasesApi.set(cleaned, `${provider.slug}/${modelId}`);
      if (res?.aliases) setAliases(res.aliases);
      setAliasEditingModel(null);
      setAliasDraft('');
      toast.success(`Mapped alias "${cleaned}" → ${provider.slug}/${modelId}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to save alias');
    }
  };

  const handleRemoveAlias = async (aliasName) => {
    try {
      const res = await aliasesApi.remove(aliasName);
      if (res?.aliases) setAliases(res.aliases);
      toast.success(`Removed alias "${aliasName}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to remove alias');
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!provider) return;
    setSavingConfig(true);
    try {
      const res = await providersApi.update(provider.id, {
        baseUrl: cfgBaseUrl.trim(),
        formatType: cfgFormatType,
        proxyPoolId: cfgProxyPoolId || null,
        enabled: cfgEnabled,
      });
      if (res?.provider) setProvider(res.provider);
      toast.success('Provider configuration saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading && !provider) {
    return (
      <div className="r-card p-10 text-center text-xs text-[var(--text-muted)]">
        Loading provider details…
      </div>
    );
  }

  if (notFound || !provider) {
    return (
      <div className="r-card space-y-4 p-10 text-center">
        <Server className="mx-auto h-9 w-9 text-[var(--text-muted)]" aria-hidden="true" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Provider not found</h2>
        <p className="text-xs text-[var(--text-secondary)]">
          No connected provider matches <code>{id}</code>.
        </p>
        <button
          type="button"
          onClick={() => navigate('/providers')}
          className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Providers
        </button>
      </div>
    );
  }

  const keys = provider.apiKeys || [];
  const coolingCount = keys.filter((k) => k.cooldownUntil && k.cooldownUntil > nowMs).length;

  return (
    <div className="space-y-6">
      {/* Header Summary Card */}
      <section className="r-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3.5">
          <Link
            to="/providers"
            aria-label="Back to Providers"
            className="r-btn-secondary flex h-9 w-9 items-center justify-center p-0"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ProviderLogo
            preset={provider.preset || provider.slug}
            logo={preset?.logo}
            logoExt={preset?.logoExt}
            name={provider.name}
            color={preset?.color}
            size="lg"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{provider.name}</h2>
              <code className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs text-[#E56A4A]">
                {provider.slug}
              </code>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  provider.enabled !== false
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-white/10 text-[var(--text-muted)]'
                }`}
              >
                {provider.enabled !== false ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-[var(--text-secondary)]">
              {provider.baseUrl} · {provider.formatType} · {keys.length} key(s) ·{' '}
              {(provider.models || []).length} model(s)
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {coolingCount > 0 ? (
            <button
              type="button"
              onClick={() => handleResetCooldown('')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/12 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/20"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset All Cooldowns ({coolingCount})
            </button>
          ) : null}
          <button
            type="button"
            disabled={inspectingAccount}
            onClick={() => handleInspectAccount('')}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            {inspectingAccount ? 'Đang kiểm tra…' : 'Kiểm tra Gói & Billing'}
          </button>
          <button
            type="button"
            onClick={loadDetail}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAddKeyOpen(true)}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add API Key
          </button>
        </div>
      </section>

      {/* Connections / API Keys Table */}
      {accountReport ? (
        <section
          className={`r-card space-y-2 p-4 text-xs ${
            accountReport.billingStatus === 'inactive' || !accountReport.ok
              ? 'border-amber-500/50 bg-amber-500/8'
              : 'border-emerald-500/40 bg-emerald-500/8'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)]">
                {accountReport.tierLabel || 'Account & Plan Status'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                  accountReport.billingStatus === 'active'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : accountReport.billingStatus === 'free_tier'
                      ? 'bg-sky-500/20 text-sky-400'
                      : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {accountReport.billingStatus || (accountReport.ok ? 'active' : 'error')}
              </span>
              {accountReport.email ? (
                <code className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-[11px]">
                  {accountReport.email}
                </code>
              ) : null}
              {accountReport.organization ? (
                <code className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-[11px]">
                  org: {accountReport.organization}
                </code>
              ) : null}
              {accountReport.projectId ? (
                <code className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-[11px]">
                  project: {accountReport.projectId}
                </code>
              ) : null}
            </div>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {accountReport.modelsCount ?? 0} models
              {accountReport.chatModelsCount !== undefined
                ? ` (${accountReport.chatModelsCount} chat-ready)`
                : ''}{' '}
              · {accountReport.latencyMs ?? 0}ms
            </span>
          </div>
          {accountReport.billingMessage || accountReport.message ? (
            <p className="text-[var(--text-secondary)]">
              {accountReport.billingMessage || accountReport.message}
              {accountReport.billingUrl && accountReport.billingStatus === 'inactive' ? (
                <>
                  {' '}
                  <a
                    href={accountReport.billingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#E56A4A] hover:underline"
                  >
                    Mở trang Billing chính chủ →
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {Array.isArray(accountReport.recommendedModels) &&
          accountReport.recommendedModels.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-[var(--text-muted)]">
              <span>Model ổn định khuyên dùng:</span>
              {accountReport.recommendedModels.map((m) => (
                <code
                  key={m}
                  className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 text-[10.5px] text-[#E56A4A]"
                >
                  {provider.slug}/{m}
                </code>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="r-card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Connections &amp; Live Cooldowns ({keys.length})
            </h3>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            Round-robin &amp; 429 cooldown rotation
          </span>
        </div>

        {keys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-xs text-[var(--text-muted)]">
            No API keys configured for this provider.
          </div>
        ) : (
          <div className="responsive-table-wrapper">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Auth / Secret Preview</th>
                  <th>Cooldown Status</th>
                  <th>Enabled</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const coolMs = k.cooldownUntil ? k.cooldownUntil - nowMs : 0;
                  const isCooling = coolMs > 0;
                  const isOAuth =
                    k.authMethod === 'google_oauth' ||
                    k.authMethod === 'oauth2' ||
                    k.authMethod === 'service_account';
                  const tRes = keyTestResults[k.id];

                  return (
                    <tr key={k.id} className="text-xs">
                      <td className="font-medium text-[var(--text-primary)]">{k.label}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <code className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px]">
                            {k.maskedKey || '••••'}
                          </code>
                          <span className="rounded bg-sky-500/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-400">
                            {k.authMethod || 'api_key'}
                          </span>
                          {tRes ? (
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                tRes.ok
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {tRes.ok ? `OK ${tRes.latencyMs || 0}ms` : 'FAIL'}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {isCooling ? (
                          <div className="inline-flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-400">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {formatCountdown(coolMs)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleResetCooldown(k.id)}
                              className="text-[11px] font-semibold text-[#E56A4A] hover:underline"
                            >
                              Reset
                            </button>
                          </div>
                        ) : (
                          <span className="text-emerald-500">Ready</span>
                        )}
                      </td>
                      <td>
                        <Switch
                          size="sm"
                          checked={k.enabled !== false}
                          onChange={(val) => handleToggleKeyEnabled(k, val)}
                          aria-label={`Toggle key ${k.label}`}
                        />
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={testingKeyId === k.id}
                            onClick={() => handleTestKey(k)}
                            className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                          >
                            <Play className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                            {testingKeyId === k.id ? 'Testing…' : 'Test'}
                          </button>
                          {isOAuth ? (
                            <button
                              type="button"
                              disabled={refreshingKeyId === k.id}
                              onClick={() => handleRefreshKey(k)}
                              className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${refreshingKeyId === k.id ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                              Refresh
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDeleteKey(k)}
                            aria-label={`Remove key ${k.label}`}
                            className="rounded-md border border-red-500/30 bg-red-500/10 p-1 text-red-500 hover:bg-red-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Models, Aliases & Enable/Disable Controls */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Models, Custom Aliases &amp; Routing Controls ({(provider.models || []).length})
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Disable individual models to exclude them from <code>/v1/models</code> and routing, or
              bind short aliases.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Filter models…"
                className="field-input w-48 py-1.5 pr-3 pl-8 text-xs"
              />
            </div>
            <button
              type="button"
              disabled={fetchingModels}
              onClick={handleFetchModels}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              />
              Fetch Live Models
            </button>
            <button
              type="button"
              onClick={() => setAddModelOpen(true)}
              className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Custom Model
            </button>
          </div>
        </div>

        <div className="responsive-table-wrapper">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Model Target</th>
                <th>Aliases</th>
                <th>Routing</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-[var(--text-muted)]">
                    No models match your filter.
                  </td>
                </tr>
              ) : (
                filteredModels.map((mId) => {
                  const fullTarget = `${provider.slug}/${mId}`;
                  const isDisabled = disabledSet.has(mId);
                  const boundAliases = aliasByTarget.get(mId) || [];
                  const mRes = modelTestResults[mId];
                  const isEditingAlias = aliasEditingModel === mId;

                  return (
                    <tr key={mId} className={`text-xs ${isDisabled ? 'opacity-55' : ''}`}>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <code className="font-semibold text-[var(--text-primary)]">
                            {fullTarget}
                          </code>
                          <CopyButton
                            value={fullTarget}
                            size="xs"
                            iconOnly
                            label={`Copy ${fullTarget}`}
                            toastMessage={`Copied ${fullTarget}`}
                          />
                          {mRes ? (
                            <span
                              className={`rounded px-1.5 py-0.2 font-mono text-[10px] font-semibold ${
                                mRes.ok
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {mRes.ok ? `OK ${mRes.latencyMs || 0}ms` : 'ERR'}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {boundAliases.map((a) => (
                            <span
                              key={a}
                              className="inline-flex items-center gap-1 rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/10 px-2 py-0.5 font-mono text-[10.5px] text-[#E56A4A]"
                            >
                              <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                              {a}
                              <button
                                type="button"
                                onClick={() => handleRemoveAlias(a)}
                                aria-label={`Remove alias ${a}`}
                                className="hover:text-red-500"
                              >
                                <X className="h-2.5 w-2.5" aria-hidden="true" />
                              </button>
                            </span>
                          ))}

                          {isEditingAlias ? (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                value={aliasDraft}
                                onChange={(e) => setAliasDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveAlias(mId);
                                  if (e.key === 'Escape') setAliasEditingModel(null);
                                }}
                                placeholder="alias-name"
                                className="field-input w-28 px-2 py-0.5 font-mono text-[11px]"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveAlias(mId)}
                                className="r-btn-primary p-1"
                              >
                                <Check className="h-3 w-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setAliasEditingModel(null)}
                                className="r-btn-secondary p-1"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setAliasEditingModel(mId);
                                setAliasDraft('');
                              }}
                              className="inline-flex items-center gap-1 rounded border border-dashed border-[var(--border-strong)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] hover:border-[#E56A4A] hover:text-[#E56A4A]"
                            >
                              <Pencil className="h-2.5 w-2.5" aria-hidden="true" />
                              Add alias
                            </button>
                          )}
                        </div>
                      </td>

                      <td>
                        <Switch
                          size="sm"
                          checked={!isDisabled}
                          onChange={() => handleToggleModelDisabled(mId, isDisabled)}
                          aria-label={`Toggle model ${mId}`}
                        />
                      </td>

                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={testingModel === mId}
                            onClick={() => handleTestModel(mId)}
                            className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                          >
                            <Play className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                            {testingModel === mId ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveModel(mId)}
                            aria-label={`Remove model ${mId}`}
                            className="rounded-md border border-red-500/30 bg-red-500/10 p-1 text-red-500 hover:bg-red-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Provider Upstream Config Card */}
      <section className="r-card p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Upstream Configuration
        </h3>
        <form onSubmit={handleSaveConfig} className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="pd-baseurl"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Base URL
            </label>
            <input
              id="pd-baseurl"
              type="url"
              required
              value={cfgBaseUrl}
              onChange={(e) => setCfgBaseUrl(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label
              htmlFor="pd-format"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Wire Protocol Format
            </label>
            <select
              id="pd-format"
              value={cfgFormatType}
              onChange={(e) => setCfgFormatType(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 text-xs"
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic Messages</option>
              <option value="gemini-openai">Google Gemini</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="pd-proxy"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Outbound Proxy Pool
            </label>
            <select
              id="pd-proxy"
              value={cfgProxyPoolId}
              onChange={(e) => setCfgProxyPoolId(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 text-xs"
            >
              <option value="">Direct (No Proxy)</option>
              {proxyPools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} ({pool.type || 'http'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end justify-between gap-3">
            <Switch
              checked={cfgEnabled}
              onChange={setCfgEnabled}
              label="Provider Enabled"
            />
            <button
              type="submit"
              disabled={savingConfig}
              className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {savingConfig ? 'Saving…' : 'Save Config'}
            </button>
          </div>
        </form>
      </section>

      {/* Add API Key Modal */}
      <ModalDialog
        open={addKeyOpen}
        onClose={() => setAddKeyOpen(false)}
        title={`Add API Key — ${provider.name}`}
        subtitle="Add a new API key to this provider pool."
        size="sm"
      >
        <form onSubmit={handleAddKeySubmit} className="space-y-4">
          <div>
            <label htmlFor="pd-new-key-label" className="block text-xs font-medium text-[var(--text-secondary)]">
              Key Label
            </label>
            <input
              id="pd-new-key-label"
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              placeholder="e.g. Production Key #2"
              className="field-input mt-1.5 w-full px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="pd-new-key-secret" className="block text-xs font-medium text-[var(--text-secondary)]">
              Secret API Key
            </label>
            <input
              id="pd-new-key-secret"
              type="password"
              required
              autoFocus
              value={newKeySecret}
              onChange={(e) => setNewKeySecret(e.target.value)}
              placeholder="sk-..."
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddKeyOpen(false)}
              className="r-btn-secondary px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingKey || !newKeySecret.trim()}
              className="r-btn-primary px-4 py-1.5 text-xs"
            >
              {savingKey ? 'Saving…' : 'Save Key'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Add Custom Model Modal */}
      <ModalDialog
        open={addModelOpen}
        onClose={() => setAddModelOpen(false)}
        title="Add Custom Model ID"
        subtitle={`Will be callable as ${provider.slug}/<modelId>`}
        size="sm"
      >
        <form onSubmit={handleAddCustomModel} className="space-y-4">
          <div>
            <label htmlFor="pd-custom-model" className="block text-xs font-medium text-[var(--text-secondary)]">
              Model ID
            </label>
            <input
              id="pd-custom-model"
              type="text"
              required
              autoFocus
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="e.g. gpt-4.1-mini or custom-finetune"
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddModelOpen(false)}
              className="r-btn-secondary px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingModel || !newModelId.trim()}
              className="r-btn-primary px-4 py-1.5 text-xs"
            >
              {savingModel ? 'Adding…' : 'Add Model'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
