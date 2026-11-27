import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  KeyRound,
  Puzzle,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  combosApi,
  getRememberedRouterKey,
  keysApi,
  providersApi,
  rememberRouterKey,
  tunnelApi,
} from '../lib/api';
import { MITM_IDE_CARDS } from '../lib/cliToolMeta';
import { ProviderLogo } from '../components/ProviderLogo';
import { CopyButton } from '../components/CopyButton';
import { ModalDialog } from '../components/ModalDialog';
import { useToast } from '../context/ToastContext';

const ALIAS_STORAGE_KEY = 'r001-ide-alias-map-v1';

function readAliasMap() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(ALIAS_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function MitmPage() {
  const toast = useToast();
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [tunnelState, setTunnelState] = useState({ tunnel: null, tailscale: null });
  const [expandedIde, setExpandedIde] = useState('antigravity');
  const [aliasMap, setAliasMap] = useState(() => readAliasMap());
  const [provisionedKey, setProvisionedKey] = useState('');
  const [provisioning, setProvisioning] = useState(false);

  const [pickerTarget, setPickerTarget] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');

  const localOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:20128';
  const tunnelUrl = tunnelState?.tunnel?.enabled ? tunnelState?.tunnel?.tunnelUrl || '' : '';

  const loadData = useCallback(async () => {
    const [keysRes, provRes, combosRes, tunRes] = await Promise.all([
      keysApi.list().catch(() => ({ keys: [] })),
      providersApi.list().catch(() => ({ providers: [] })),
      combosApi.list().catch(() => ({ combos: [] })),
      tunnelApi.status().catch(() => null),
    ]);
    const loadedKeys = keysRes?.keys || [];
    setKeys(loadedKeys);
    setProviders(provRes?.providers || []);
    setCombos(combosRes?.combos || []);
    if (tunRes) setTunnelState(tunRes);

    const remembered = loadedKeys.find((k) => k.enabled !== false && getRememberedRouterKey(k));
    if (remembered) setProvisionedKey(getRememberedRouterKey(remembered));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const modelOptions = useMemo(() => {
    const items = [];
    for (const c of combos) {
      if (c.enabled === false || !c.name) continue;
      items.push({ value: c.name, group: 'Combos' });
    }
    for (const p of providers) {
      if (p.enabled === false) continue;
      for (const m of p.models || []) {
        items.push({ value: `${p.slug}/${m}`, group: p.name || p.slug });
      }
    }
    return items;
  }, [combos, providers]);

  const filteredModelOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return modelOptions.slice(0, 100);
    return modelOptions
      .filter((o) => o.value.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      .slice(0, 100);
  }, [modelOptions, pickerQuery]);

  const updateAlias = (ideId, aliasId, targetVal) => {
    setAliasMap((prev) => {
      const next = {
        ...prev,
        [ideId]: { ...(prev[ideId] || {}), [aliasId]: targetVal },
      };
      try {
        window.localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  const handleProvisionExtensionKey = async () => {
    setProvisioning(true);
    try {
      const res = await keysApi.create('IDE Extension Key');
      const created = res?.key;
      if (!created?.key) throw new Error('Could not create extension key');
      rememberRouterKey(created);
      setKeys((prev) => [...prev, { ...created, key: undefined }]);
      setProvisionedKey(created.key);
      toast.success('Created IDE extension key');
    } catch (err) {
      toast.error(err?.message || 'Failed to provision extension key');
    } finally {
      setProvisioning(false);
    }
  };

  const displayKey = provisionedKey || keys?.[0]?.keyPreview || 'YOUR_ROUTER_API_KEY';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/cli-tools"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to CLI Tools
        </Link>
      </div>

      {/* Security / ToS Advisory */}
      <section className="r-card border-amber-500/35 bg-amber-500/8 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="space-y-1.5 text-xs">
            <h2 className="text-sm font-semibold text-amber-300">
              ToS-Safe IDE Routing Architecture
            </h2>
            <p className="leading-relaxed text-[var(--text-secondary)]">
              Unlike raw DNS <code className="font-mono">hosts</code> patching or port-443 root-CA
              TLS interception, <strong className="text-[var(--text-primary)]">001Router</strong>{' '}
              routes IDEs cleanly via the dedicated{' '}
              <strong className="text-[var(--text-primary)]">001Router IDE Extension</strong>{' '}
              (VS Code / Antigravity) or explicit OpenAI-compatible Base URL overrides—requiring zero
              root certificates or admin firewall edits.
            </p>
          </div>
        </div>
      </section>

      {/* Recommended ToS-Safe 001Router Extension Bridge Card */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E56A4A]/15 text-[#E56A4A]">
              <Puzzle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  001Router IDE Extension (Recommended)
                </h3>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  ToS-Safe · Direct API
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Connects via <code className="font-mono">POST /api/extension/connect</code> using
                your dashboard password or router API key—no MITM certificates needed.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/001router-code.vsix"
              download="001router-code-1.5.0.vsix"
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download VSIX v1.5.0
            </a>
            <button
              type="button"
              disabled={provisioning}
              onClick={handleProvisionExtensionKey}
              className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              {provisioning ? 'Creating…' : 'Create Extension Key'}
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
            <div className="text-[11px] font-medium text-[var(--text-muted)]">Router Base URL</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-[var(--text-primary)]">
                {tunnelUrl || localOrigin}
              </code>
              <CopyButton value={tunnelUrl || localOrigin} size="xs" iconOnly label="Copy URL" />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
            <div className="text-[11px] font-medium text-[var(--text-muted)]">
              OpenAI Endpoint (/v1)
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-[#E56A4A]">
                {`${tunnelUrl || localOrigin}/v1`}
              </code>
              <CopyButton
                value={`${tunnelUrl || localOrigin}/v1`}
                size="xs"
                iconOnly
                label="Copy OpenAI URL"
              />
            </div>
          </div>
        </div>

        {provisionedKey ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs">
            <span className="truncate font-mono text-emerald-300">API Key: {provisionedKey}</span>
            <CopyButton value={provisionedKey} size="xs" />
          </div>
        ) : null}
      </section>

      {/* Per-IDE Cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            IDE Targets &amp; Model Alias Mapping
          </h3>
          <span className="text-xs text-[var(--text-muted)]">
            Configure BYOK / model alias overrides per IDE
          </span>
        </div>

        {MITM_IDE_CARDS.map((ide) => {
          const isOpen = expandedIde === ide.id;
          const ideMappings = aliasMap[ide.id] || {};
          return (
            <div key={ide.id} className="r-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedIde(isOpen ? '' : ide.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderLogo
                    logo={ide.logo}
                    name={ide.name}
                    monogram={ide.monogram}
                    color={ide.color}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {ide.name}
                      </span>
                      <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-400">
                        IDE Bridge
                      </span>
                    </div>
                    <p className="truncate text-xs text-[var(--text-muted)]">{ide.description}</p>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                )}
              </button>

              {isOpen ? (
                <div className="space-y-4 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>Reference domains:</span>
                    {ide.mitmDomains.map((dom) => (
                      <code
                        key={dom}
                        className="rounded bg-[var(--bg-card)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
                      >
                        {dom}
                      </code>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">
                      Model Alias Mapping (IDE slot -&gt; 001Router target)
                    </div>
                    {ide.defaultAliases.map((slot) => (
                      <div key={slot.id} className="grid items-center gap-2 sm:grid-cols-12">
                        <div className="sm:col-span-5">
                          <code className="font-mono text-xs text-[var(--text-primary)]">
                            {slot.alias}
                          </code>
                          <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                            ({slot.name})
                          </span>
                        </div>
                        <div className="flex gap-1.5 sm:col-span-7">
                          <input
                            type="text"
                            value={ideMappings[slot.alias] || ''}
                            onChange={(e) => updateAlias(ide.id, slot.alias, e.target.value)}
                            placeholder="provider/model or combo-name"
                            className="field-input flex-1 px-2.5 py-1.5 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setPickerTarget({ ideId: ide.id, aliasId: slot.alias });
                              setPickerQuery('');
                            }}
                            className="r-btn-secondary px-2.5 py-1 text-xs"
                          >
                            Select
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs">
                    <code className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
                      Base URL: {(tunnelUrl || localOrigin) + '/v1'} · Key: {displayKey}
                    </code>
                    <CopyButton
                      value={JSON.stringify(
                        {
                          ide: ide.id,
                          baseUrl: `${tunnelUrl || localOrigin}/v1`,
                          apiKey: displayKey,
                          aliases: ideMappings,
                        },
                        null,
                        2
                      )}
                      size="xs"
                      label="Copy Profile JSON"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      <ModalDialog
        open={Boolean(pickerTarget)}
        onClose={() => setPickerTarget(null)}
        title="Map IDE Model Slot"
        subtitle={pickerTarget ? `Target for ${pickerTarget.aliasId}` : ''}
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
                onClick={() => {
                  if (pickerTarget) {
                    updateAlias(pickerTarget.ideId, pickerTarget.aliasId, opt.value);
                  }
                  setPickerTarget(null);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--bg-subtle)]"
              >
                <span className="truncate font-mono text-[var(--text-primary)]">{opt.value}</span>
                <span className="ml-2 shrink-0 text-[10px] text-[var(--text-muted)]">
                  {opt.group}
                </span>
              </button>
            ))}
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}

export default MitmPage;
