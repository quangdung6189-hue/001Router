import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-react';
import {
  cliToolsApi,
  combosApi,
  getRememberedRouterKey,
  keysApi,
  providersApi,
  rememberRouterKey,
  tunnelApi,
} from '../lib/api';
import {
  buildManualConfigSnippets,
  findCodingTool,
  getToolSummaryStatus,
  stripTrailingV1,
} from '../lib/cliToolMeta';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { ModalDialog } from '../components/ModalDialog';
import { SegmentedControl } from '../components/SegmentedControl';
import { useToast } from '../context/ToastContext';

const WIRE_API_OPTIONS = [
  { value: 'responses', label: 'Responses API' },
  { value: 'chat', label: 'Chat Completions' },
];

export function CliToolDetailPage() {
  const { toolId } = useParams();
  const toast = useToast();
  const toolMeta = useMemo(() => findCodingTool(toolId), [toolId]);
  const backendId = toolMeta?.backendId || null;

  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [toolStatus, setToolStatus] = useState(null);
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [tunnelState, setTunnelState] = useState({ tunnel: null, tailscale: null });

  const [endpointMode, setEndpointMode] = useState('local');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');

  const [model, setModel] = useState('openai/gpt-4o-mini');
  const [opusModel, setOpusModel] = useState('');
  const [sonnetModel, setSonnetModel] = useState('');
  const [haikuModel, setHaikuModel] = useState('');
  const [wireApi, setWireApi] = useState('responses');

  const [pickerSlot, setPickerSlot] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [notice, setNotice] = useState(null);

  const localOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:20128'),
    []
  );
  const tunnelUrl = tunnelState?.tunnel?.enabled ? tunnelState?.tunnel?.tunnelUrl || '' : '';
  const tailscaleUrl = tunnelState?.tailscale?.enabled
    ? tunnelState?.tailscale?.tunnelUrl || ''
    : '';

  const effectiveBaseUrl = useMemo(() => {
    if (endpointMode === 'tunnel' && tunnelUrl) return stripTrailingV1(tunnelUrl);
    if (endpointMode === 'tailscale' && tailscaleUrl) return stripTrailingV1(tailscaleUrl);
    if (endpointMode === 'custom' && customBaseUrl.trim()) return stripTrailingV1(customBaseUrl);
    return localOrigin;
  }, [endpointMode, tunnelUrl, tailscaleUrl, customBaseUrl, localOrigin]);

  const loadData = useCallback(async () => {
    if (!toolMeta) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [statusRes, keysRes, provRes, combosRes, tunRes] = await Promise.all([
        backendId ? cliToolsApi.get(backendId).catch(() => null) : Promise.resolve(null),
        keysApi.list().catch(() => ({ keys: [] })),
        providersApi.list().catch(() => ({ providers: [] })),
        combosApi.list().catch(() => ({ combos: [] })),
        tunnelApi.status().catch(() => null),
      ]);

      setToolStatus(statusRes);
      const loadedKeys = keysRes?.keys || [];
      const loadedProvs = provRes?.providers || [];
      const loadedCombos = combosRes?.combos || [];
      setKeys(loadedKeys);
      setProviders(loadedProvs);
      setCombos(loadedCombos);
      if (tunRes) setTunnelState(tunRes);

      if (statusRes?.summary?.model) {
        setModel(statusRes.summary.model);
      } else {
        const defaultCombo = loadedCombos.find((c) => c.enabled !== false && c.name);
        const defaultProv = loadedProvs.find((p) => p.enabled !== false && p.models?.length > 0);
        if (defaultCombo) setModel(defaultCombo.name);
        else if (defaultProv) setModel(`${defaultProv.slug}/${defaultProv.models[0]}`);
      }

      if (statusRes?.summary?.opusModel) setOpusModel(statusRes.summary.opusModel);
      if (statusRes?.summary?.sonnetModel) setSonnetModel(statusRes.summary.sonnetModel);
      if (statusRes?.summary?.haikuModel) setHaikuModel(statusRes.summary.haikuModel);
      if (statusRes?.summary?.wireApi) setWireApi(statusRes.summary.wireApi);

      setSelectedKey((prev) => {
        if (prev) return prev;
        const remembered = loadedKeys.find((k) => k.enabled !== false && getRememberedRouterKey(k));
        if (remembered) return getRememberedRouterKey(remembered);
        const active = loadedKeys.find((k) => k.enabled !== false) || loadedKeys[0];
        return getRememberedRouterKey(active) || active?.keyPreview || '';
      });
    } finally {
      setLoading(false);
    }
  }, [toolMeta, backendId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const modelOptions = useMemo(() => {
    const out = [];
    for (const c of combos) {
      if (c.enabled === false || !c.name) continue;
      out.push({ value: c.name, label: c.name, group: 'Combos' });
    }
    for (const p of providers) {
      if (p.enabled === false) continue;
      for (const m of p.models || []) {
        out.push({ value: `${p.slug}/${m}`, label: m, group: p.name || p.slug });
      }
    }
    return out;
  }, [combos, providers]);

  const filteredModelOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return modelOptions.slice(0, 120);
    return modelOptions
      .filter((o) => o.value.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      .slice(0, 120);
  }, [modelOptions, pickerQuery]);

  const resolvedApiKey = (customKeyInput || selectedKey || '').trim();
  const isMaskedOrEmpty = !resolvedApiKey || resolvedApiKey.includes('...');

  const buildApplyPayload = (overrideKey) => ({
    baseUrl: effectiveBaseUrl,
    apiKey: (overrideKey ?? resolvedApiKey) || undefined,
    model: model.trim() || 'openai/gpt-4o-mini',
    ...(backendId === 'claude'
      ? {
          opusModel: opusModel.trim(),
          sonnetModel: sonnetModel.trim(),
          haikuModel: haikuModel.trim(),
        }
      : {}),
    ...(backendId === 'codex' ? { wireApi } : {}),
  });

  const handleApply = async () => {
    if (!backendId) return;
    setApplying(true);
    setNotice(null);
    try {
      const res = await cliToolsApi.apply(backendId, buildApplyPayload());
      if (res?.status) setToolStatus(res.status);
      else await loadData();
      setNotice({ type: 'success', text: `Applied 001Router configuration to ${toolMeta.name}.` });
      toast.success(`Configured ${toolMeta.name}`);
    } catch (err) {
      const msg = err?.message || `Failed to configure ${toolMeta.name}`;
      setNotice({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setApplying(false);
    }
  };

  const handleCreateKeyAndConnect = async () => {
    if (!backendId) return;
    setApplying(true);
    setNotice(null);
    try {
      const createdRes = await keysApi.create(`${toolMeta.name} Key`);
      const createdKey = createdRes?.key;
      if (!createdKey?.key) throw new Error('Failed to create router API key');
      rememberRouterKey(createdKey);
      setKeys((prev) => [...prev, { ...createdKey, key: undefined }]);
      setSelectedKey(createdKey.key);
      setCustomKeyInput('');

      const res = await cliToolsApi.apply(backendId, buildApplyPayload(createdKey.key));
      if (res?.status) setToolStatus(res.status);
      setNotice({
        type: 'success',
        text: `Created key "${createdKey.name}" and connected ${toolMeta.name}.`,
      });
      toast.success(`${toolMeta.name} connected with new API key`);
    } catch (err) {
      const msg = err?.message || 'Create key & connect failed';
      setNotice({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    if (!backendId) return;
    setResetting(true);
    setNotice(null);
    try {
      const res = await cliToolsApi.reset(backendId);
      if (res?.status) setToolStatus(res.status);
      else await loadData();
      setNotice({ type: 'success', text: `Restored backup configuration for ${toolMeta.name}.` });
      toast.success(`Reset ${toolMeta.name}`);
    } catch (err) {
      const msg = err?.message || `Failed to reset ${toolMeta.name}`;
      setNotice({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const handlePickModel = (val) => {
    if (pickerSlot === 'main') setModel(val);
    else if (pickerSlot === 'opus') setOpusModel(val);
    else if (pickerSlot === 'sonnet') setSonnetModel(val);
    else if (pickerSlot === 'haiku') setHaikuModel(val);
    setPickerSlot(null);
    setPickerQuery('');
  };

  if (!toolMeta) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link
          to="/cli-tools"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to CLI Tools
        </Link>
        <div className="r-card p-6 text-sm text-[var(--text-secondary)]">
          Tool <code className="font-mono text-[var(--text-primary)]">{toolId}</code> was not found.
        </div>
      </div>
    );
  }

  const statusMeta = getToolSummaryStatus(toolMeta, toolStatus);
  const snippets = buildManualConfigSnippets(toolMeta, {
    originUrl: effectiveBaseUrl,
    apiKey: isMaskedOrEmpty ? 'YOUR_ROUTER_API_KEY' : resolvedApiKey,
    model,
    opusModel,
    sonnetModel,
    haikuModel,
    wireApi,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/cli-tools"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to CLI Tools
        </Link>

        {toolStatus?.configPath ? (
          <code className="rounded-md bg-[var(--bg-subtle)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">
            {toolStatus.configPath}
          </code>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">{toolMeta.configPathHint}</span>
        )}
      </div>

      {/* Header card */}
      <section className="r-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3.5">
          <ProviderLogo
            logo={toolMeta.logo}
            name={toolMeta.name}
            monogram={toolMeta.monogram}
            color={toolMeta.color}
            size="lg"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{toolMeta.name}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  statusMeta.tone === 'success'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : statusMeta.tone === 'warning'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                }`}
              >
                {statusMeta.label}
              </span>
              <span className="rounded-full bg-[#E56A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#E56A4A]">
                {toolMeta.tag}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{toolMeta.description}</p>
          </div>
        </div>

        {toolMeta.docsCmd ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-1.5">
            <Terminal className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            <code className="font-mono text-[11px] text-[var(--text-primary)]">
              {toolMeta.docsCmd}
            </code>
            <CopyButton value={toolMeta.docsCmd} size="xs" iconOnly label="Copy install command" />
          </div>
        ) : null}
      </section>

      {notice ? (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs ${
            notice.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/35 bg-red-500/10 text-red-400'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice.text}</span>
        </div>
      ) : null}

      {/* Configuration Panel */}
      <section className="r-card space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {backendId ? '1-Click Configuration' : 'Endpoint & Key Parameters'}
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Choose an endpoint, router API key, and target model or combo.
            </p>
          </div>
          {loading ? <span className="text-xs text-[var(--text-muted)]">Loading…</span> : null}
        </div>

        {/* Endpoint Selector */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">
            Router Endpoint
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'local', label: `Local (${localOrigin})`, available: true },
              {
                id: 'tunnel',
                label: tunnelUrl ? `Cloudflare Tunnel (${tunnelUrl})` : 'Cloudflare Tunnel (Off)',
                available: Boolean(tunnelUrl),
              },
              {
                id: 'tailscale',
                label: tailscaleUrl ? `Tailscale (${tailscaleUrl})` : 'Tailscale (Off)',
                available: Boolean(tailscaleUrl),
              },
              { id: 'custom', label: 'Custom URL', available: true },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!opt.available}
                onClick={() => setEndpointMode(opt.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  endpointMode === opt.id
                    ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[#E56A4A]'
                    : opt.available
                      ? 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      : 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)] opacity-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {endpointMode === 'custom' ? (
            <input
              type="url"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="https://your-router-host:20128"
              className="field-input mt-2 w-full px-3 py-2 font-mono text-xs"
            />
          ) : null}
        </div>

        {/* API Key Selector */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Saved Router API Key
            </label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 text-xs"
            >
              <option value="">-- Select a key or create a new one --</option>
              {keys.map((k) => {
                const raw = getRememberedRouterKey(k);
                const val = raw || k.keyPreview || k.id;
                return (
                  <option key={k.id} value={val}>
                    {k.name} ({k.keyPreview}){raw ? ' · full' : ' · preview'}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Or Paste Full API Key
            </label>
            <input
              type="password"
              value={customKeyInput}
              onChange={(e) => setCustomKeyInput(e.target.value)}
              placeholder="sk-001r-..."
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          </div>
        </div>

        {/* Primary Model / Combo */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)]">
            Default Model / Combo
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="provider-slug/model-id or combo-name"
              className="field-input flex-1 px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => {
                setPickerSlot('main');
                setPickerQuery('');
              }}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Browse Models
            </button>
          </div>
        </div>

        {/* Claude specific tier overrides */}
        {backendId === 'claude' ? (
          <div className="grid gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5 sm:grid-cols-3">
            {[
              { id: 'opus', label: 'Opus Tier Override', val: opusModel, setVal: setOpusModel },
              {
                id: 'sonnet',
                label: 'Sonnet Tier Override',
                val: sonnetModel,
                setVal: setSonnetModel,
              },
              { id: 'haiku', label: 'Haiku Tier Override', val: haikuModel, setVal: setHaikuModel },
            ].map((slot) => (
              <div key={slot.id}>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  {slot.label}
                </label>
                <div className="mt-1 flex gap-1">
                  <input
                    type="text"
                    value={slot.val}
                    onChange={(e) => slot.setVal(e.target.value)}
                    placeholder="Optional"
                    className="field-input min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPickerSlot(slot.id);
                      setPickerQuery('');
                    }}
                    className="r-btn-secondary px-2 py-1 text-[11px]"
                    title="Browse models"
                  >
                    Pick
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Codex wire API selector */}
        {backendId === 'codex' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5">
            <div>
              <div className="text-xs font-medium text-[var(--text-primary)]">Wire API Protocol</div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Codex CLI 0.9+ defaults to <code className="font-mono">responses</code>; use{' '}
                <code className="font-mono">chat</code> for legacy OpenAI-compatible backends.
              </div>
            </div>
            <SegmentedControl
              options={WIRE_API_OPTIONS}
              value={wireApi}
              onChange={setWireApi}
              size="sm"
              ariaLabel="Codex wire API protocol"
            />
          </div>
        ) : null}

        {/* Actions */}
        {backendId ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--border-subtle)] pt-4">
            <button
              type="button"
              disabled={applying}
              onClick={handleApply}
              className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {applying ? 'Applying…' : 'Apply Configuration'}
            </button>

            <button
              type="button"
              disabled={applying}
              onClick={handleCreateKeyAndConnect}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              Create Key &amp; Connect
            </button>

            {toolStatus?.hasBackup || toolStatus?.status === 'configured' ? (
              <button
                type="button"
                disabled={resetting}
                onClick={handleReset}
                className="r-btn-secondary ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 text-xs text-amber-400"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {resetting ? 'Restoring…' : 'Reset Backup'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Manual Config Snippets */}
      <section className="r-card space-y-4 p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Manual Configuration Snippets
        </h3>
        <div className="space-y-3">
          {snippets.map((snip) => (
            <div
              key={snip.title}
              className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2">
                <span className="font-mono text-xs font-medium text-[var(--text-primary)]">
                  {snip.title}
                </span>
                <CopyButton value={snip.content} size="xs" />
              </div>
              <pre className="overflow-x-auto p-3.5 font-mono text-xs text-[var(--text-secondary)]">
                <code>{snip.content}</code>
              </pre>
            </div>
          ))}
        </div>
      </section>

      {/* Searchable Model Picker Modal */}
      <ModalDialog
        open={Boolean(pickerSlot)}
        onClose={() => setPickerSlot(null)}
        title="Select Model or Combo"
        subtitle="Pick any active combo or connected provider model."
        size="md"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              autoFocus
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search models or combos…"
              className="field-input w-full py-2 pr-3 pl-9 text-xs"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {filteredModelOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePickModel(opt.value)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="truncate font-mono text-[var(--text-primary)]">{opt.value}</span>
                <span className="ml-2 shrink-0 rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                  {opt.group}
                </span>
              </button>
            ))}
            {filteredModelOptions.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--text-muted)]">
                No matching models or combos found.
              </p>
            ) : null}
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}

export default CliToolDetailPage;
