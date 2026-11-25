import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Undo2,
  Wrench,
} from 'lucide-react';
import {
  cliToolsApi,
  combosApi,
  getRememberedRouterKey,
  keysApi,
  providersApi,
  rememberRouterKey,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { CopyButton } from '../components/CopyButton';
import { ProviderLogo } from '../components/ProviderLogo';

const CODING_TOOLS = [
  { id: 'claude-code', backendId: 'claude', logo: 'claude', name: 'Claude Code', tag: '1-Click · Anthropic', color: '#D97757', monogram: 'CC' },
  { id: 'codex', backendId: 'codex', logo: 'codex', name: 'Codex CLI', tag: '1-Click · TOML', color: '#10A37F', monogram: 'CX' },
  { id: 'opencode', backendId: 'opencode', logo: 'opencode', name: 'OpenCode', tag: '1-Click · JSON', color: '#F59E0B', monogram: 'OC' },
  { id: 'cline', backendId: 'cline', logo: 'cline', name: 'Cline CLI', tag: '1-Click · JSON', color: '#7C3AED', monogram: 'CL' },
  { id: 'kilo', backendId: 'kilo', logo: 'kilocode', name: 'Kilo Code CLI', tag: '1-Click · JSON', color: '#FF6B35', monogram: 'KC' },
  { id: 'droid', backendId: 'droid', logo: 'droid', name: 'Factory Droid', tag: '1-Click · JSON', color: '#16A34A', monogram: 'DR' },
  { id: 'continue', backendId: 'continue', logo: 'continue', name: 'Continue', tag: '1-Click · YAML', color: '#0EA5E9', monogram: 'CN' },
  { id: 'aider', backendId: 'aider', logo: 'aider', name: 'Aider', tag: '1-Click · YAML', color: '#15803D', monogram: 'AD' },
  { id: 'cursor', backendId: null, logo: 'cursor', name: 'Cursor', tag: 'IDE Guide', color: '#2563EB', monogram: 'CU' },
  { id: 'roo-code', backendId: null, logo: 'roo', name: 'Roo Code', tag: 'VS Code Guide', color: '#EC4899', monogram: 'RC' },
  { id: 'windsurf', backendId: null, logo: 'windsurf', name: 'Windsurf', tag: 'IDE Guide', color: '#06B6D4', monogram: 'WS' },
  { id: 'copilot', backendId: null, logo: 'copilot', name: 'GitHub Copilot', tag: 'VS Code BYOK', color: '#475569', monogram: 'CP' },
  { id: 'sdk', backendId: null, logo: 'openai', name: 'OpenAI SDK / cURL', tag: 'Node · Python · HTTP', color: '#E56A4A', monogram: 'SD' },
];

function StatusBadge({ status, isAuto, t }) {
  if (!isAuto) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-500/12 px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
        {t('cli.status.guide')}
      </span>
    );
  }
  switch (status) {
    case 'configured':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
          {t('cli.status.configured')}
        </span>
      );
    case 'other':
      return (
        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
          {t('cli.status.other')}
        </span>
      );
    case 'installed':
      return (
        <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
          {t('cli.status.installed')}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
          {t('cli.status.notDetected')}
        </span>
      );
  }
}

function CodeSnippet({ title, description, code, fileHint }) {
  return (
    <div className="r-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
            {fileHint ? (
              <code className="rounded bg-[var(--bg-card)] px-2 py-0.5 text-[11px] font-medium text-[#E56A4A]">
                {fileHint}
              </code>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
          ) : null}
        </div>
        <CopyButton value={code} toastMessage={`Copied ${title}`} />
      </div>
      <pre className="code-surface overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CliToolsPage() {
  const toast = useToast();
  const { t } = useLocale();
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [toolStatuses, setToolStatuses] = useState({});
  const [loadingStatuses, setLoadingStatuses] = useState(false);

  const [activeTool, setActiveTool] = useState('claude-code');
  const [baseOrigin, setBaseOrigin] = useState(() => window.location.origin);
  const [selectedKey, setSelectedKey] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');

  // Tool-specific options
  const [claudeOpus, setClaudeOpus] = useState('');
  const [claudeSonnet, setClaudeSonnet] = useState('');
  const [claudeHaiku, setClaudeHaiku] = useState('');
  const [codexWireApi, setCodexWireApi] = useState('responses');

  const [applyingTool, setApplyingTool] = useState('');
  const [resettingTool, setResettingTool] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);

  const loadStatuses = useCallback(async () => {
    setLoadingStatuses(true);
    try {
      const res = await cliToolsApi.statuses();
      const map = res?.statuses || {};
      setToolStatuses(map);
      if (map.claude?.summary) {
        if (map.claude.summary.opusModel) setClaudeOpus((p) => p || map.claude.summary.opusModel);
        if (map.claude.summary.sonnetModel) setClaudeSonnet((p) => p || map.claude.summary.sonnetModel);
        if (map.claude.summary.haikuModel) setClaudeHaiku((p) => p || map.claude.summary.haikuModel);
      }
      if (map.codex?.summary?.wireApi) {
        setCodexWireApi(map.codex.summary.wireApi === 'chat' ? 'chat' : 'responses');
      }
    } catch {
      // Non-fatal; snippets still render
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [keysRes, provRes, combosRes] = await Promise.all([
        keysApi.list(),
        providersApi.list(),
        combosApi.list(),
      ]);
      const loadedKeys = keysRes?.keys || [];
      const loadedProvs = provRes?.providers || [];
      const loadedCombos = combosRes?.combos || [];

      setKeys(loadedKeys);
      setProviders(loadedProvs);
      setCombos(loadedCombos);

      setSelectedKey((prev) => {
        if (prev) return prev;
        const remembered = loadedKeys.find((k) => k.enabled !== false && getRememberedRouterKey(k));
        if (remembered) return getRememberedRouterKey(remembered);
        const active = loadedKeys.find((k) => k.enabled !== false) || loadedKeys[0];
        return getRememberedRouterKey(active) || active?.keyPreview || '';
      });

      setSelectedModel((prev) => {
        if (prev) return prev;
        const firstCombo = loadedCombos.find((c) => c.enabled !== false)?.name;
        if (firstCombo) return firstCombo;
        for (const p of loadedProvs) {
          if (p.enabled !== false && p.models?.length) {
            return `${p.slug}/${p.models[0]}`;
          }
        }
        return 'gemini/gemini-2.5-flash';
      });
    } catch (err) {
      toast.error(err?.message || 'Failed to load CLI tool parameters');
    }
  }, [toast]);

  useEffect(() => {
    loadData();
    loadStatuses();
  }, [loadData, loadStatuses]);

  const modelGroups = useMemo(() => {
    return providers
      .filter((p) => p.enabled !== false && (p.models || []).length > 0)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        items: p.models.map((m) => `${p.slug}/${m}`),
      }));
  }, [providers]);

  const cleanOrigin = (baseOrigin || window.location.origin).replace(/\/+$/, '');
  const openaiBase = `${cleanOrigin}/v1`;
  const effectiveRawKeyInput =
    customKeyInput.trim() ||
    (selectedKey && !selectedKey.includes('…') ? selectedKey : '');
  const apiKey = effectiveRawKeyInput || selectedKey || 'sk-001r-YOUR_ROUTER_KEY';
  const model = customModel.trim() || selectedModel || 'gemini/gemini-2.5-flash';

  const activeToolMeta = CODING_TOOLS.find((item) => item.id === activeTool) || CODING_TOOLS[0];
  const activeBackendId = activeToolMeta.backendId;
  const activeToolStatus = activeBackendId ? toolStatuses[activeBackendId] || null : null;

  const isKeyUnresolved =
    keys.length > 0 &&
    !effectiveRawKeyInput &&
    !(activeToolStatus?.status === 'configured' && activeToolStatus?.summary?.maskedKey);

  const buildApplyPayload = (rawKeyOverride = '') => {
    const payload = {
      baseUrl: cleanOrigin,
      model,
    };
    const keyToUse = rawKeyOverride || effectiveRawKeyInput;
    if (keyToUse) payload.apiKey = keyToUse;
    if (activeBackendId === 'claude') {
      if (claudeOpus.trim()) payload.opusModel = claudeOpus.trim();
      if (claudeSonnet.trim()) payload.sonnetModel = claudeSonnet.trim();
      if (claudeHaiku.trim()) payload.haikuModel = claudeHaiku.trim();
    }
    if (activeBackendId === 'codex') {
      payload.wireApi = codexWireApi;
    }
    return payload;
  };

  const handleApply = async () => {
    if (!activeBackendId) return;
    setApplyingTool(activeBackendId);
    try {
      const res = await cliToolsApi.apply(activeBackendId, buildApplyPayload());
      if (res?.status) {
        setToolStatuses((prev) => ({ ...prev, [activeBackendId]: res.status }));
      } else {
        await loadStatuses();
      }
      toast.success(t('cli.applySuccess'));
    } catch (err) {
      toast.error(err?.message || 'Failed to apply configuration');
    } finally {
      setApplyingTool('');
    }
  };

  const handleCreateKeyAndConnect = async () => {
    if (!activeBackendId) return;
    setCreatingKey(true);
    try {
      const createdRes = await keysApi.create(`${activeToolMeta.name} Key`);
      const createdKey = createdRes?.key;
      if (!createdKey?.key) {
        throw new Error('Failed to create router API key');
      }
      rememberRouterKey(createdKey);
      setKeys((prev) => [...prev, { ...createdKey, key: undefined }]);
      setSelectedKey(createdKey.key);
      setCustomKeyInput('');

      const applyRes = await cliToolsApi.apply(
        activeBackendId,
        buildApplyPayload(createdKey.key)
      );
      if (applyRes?.status) {
        setToolStatuses((prev) => ({ ...prev, [activeBackendId]: applyRes.status }));
      } else {
        await loadStatuses();
      }
      toast.success(t('cli.applySuccess'));
    } catch (err) {
      toast.error(err?.message || 'Failed to create key & connect');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleReset = async () => {
    if (!activeBackendId) return;
    setResettingTool(activeBackendId);
    try {
      const res = await cliToolsApi.reset(activeBackendId);
      if (res?.status) {
        setToolStatuses((prev) => ({ ...prev, [activeBackendId]: res.status }));
      } else {
        await loadStatuses();
      }
      toast.success(t('cli.resetSuccess'));
    } catch (err) {
      toast.error(err?.message || 'Failed to restore backup');
    } finally {
      setResettingTool('');
    }
  };

  const snippetsByTool = useMemo(() => {
    const claudeShell = `# macOS / Linux (bash/zsh)
export ANTHROPIC_BASE_URL="${cleanOrigin}"
export ANTHROPIC_AUTH_TOKEN="${apiKey}"
export ANTHROPIC_MODEL="${model}"
claude

# Windows PowerShell
$env:ANTHROPIC_BASE_URL="${cleanOrigin}"
$env:ANTHROPIC_AUTH_TOKEN="${apiKey}"
$env:ANTHROPIC_MODEL="${model}"
claude`;

    const claudeEnvObj = {
      ANTHROPIC_BASE_URL: cleanOrigin,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: model,
      ...(claudeOpus.trim() ? { ANTHROPIC_DEFAULT_OPUS_MODEL: claudeOpus.trim() } : {}),
      ...(claudeSonnet.trim() ? { ANTHROPIC_DEFAULT_SONNET_MODEL: claudeSonnet.trim() } : {}),
      ...(claudeHaiku.trim() ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: claudeHaiku.trim() } : {}),
    };
    const claudeSettings = JSON.stringify({ env: claudeEnvObj }, null, 2);

    const codexToml = `# ~/.codex/config.toml
model = "${model}"
model_provider = "router_001"

[model_providers.router_001]
name = "001Router"
base_url = "${openaiBase}"
wire_api = "${codexWireApi}"
env_key = "OPENAI_API_KEY"`;

    const codexLaunch = `# ~/.codex/auth.json
{
  "OPENAI_API_KEY": "${apiKey}"
}

# Or launch via environment variable (bash / PowerShell):
export OPENAI_API_KEY="${apiKey}" && codex`;

    const cursorCfg = `Override OpenAI Base URL : ${openaiBase}
OpenAI API Key           : ${apiKey}
Custom Model Name        : ${model}`;

    const clineOpenAi = `API Provider   : OpenAI Compatible
Base URL       : ${openaiBase}
API Key        : ${apiKey}
Model ID       : ${model}`;

    const clineAnthropic = `API Provider   : Anthropic
Use Custom URL : Enabled
Base URL       : ${cleanOrigin}
API Key        : ${apiKey}
Model          : ${model}`;

    const rooCodeCfg = `API Provider     : OpenAI Compatible (or Anthropic with Custom Base URL)
Base URL         : ${openaiBase}
API Key          : ${apiKey}
Model            : ${model}

# Alternative Anthropic Endpoint:
# Base URL       : ${cleanOrigin}`;

    const continueYaml = `# ~/.continue/config.yaml
models:
  - name: "001Router"
    provider: "openai"
    model: "${model}"
    apiBase: "${openaiBase}"
    apiKey: "${apiKey}"
    roles:
      - chat
      - edit
      - apply`;

    const openCodeJson = JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        model: `router001/${model}`,
        provider: {
          router001: {
            npm: '@ai-sdk/openai-compatible',
            name: '001Router',
            options: {
              baseURL: openaiBase,
              apiKey,
            },
            models: {
              [model]: { name: model },
            },
          },
        },
      },
      null,
      2
    );

    const droidJson = JSON.stringify(
      {
        customModels: [
          {
            id: 'custom:001Router',
            model,
            displayName: `001Router (${model})`,
            baseUrl: openaiBase,
            apiKey,
            provider: 'generic-chat-completion-api',
            maxOutputTokens: 16384,
          },
        ],
      },
      null,
      2
    );

    const aiderCli = `aider --openai-api-base "${openaiBase}" --openai-api-key "${apiKey}" --model "openai/${model}"`;

    const aiderYaml = `# ~/.aider.conf.yml
openai-api-base: "${openaiBase}"
openai-api-key: "${apiKey}"
model: "openai/${model}"`;

    const windsurfCfg = `# Windsurf Settings → Cascade / Custom OpenAI-Compatible Provider
Base URL  : ${openaiBase}
API Key   : ${apiKey}
Model ID  : ${model}`;

    const copilotCfg = `VS Code Chat → Manage Models → OpenAI Compatible (BYOK)
Endpoint URL : ${openaiBase}
API Key      : ${apiKey}
Model Name   : ${model}`;

    const nodeSdk = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${openaiBase}",
  apiKey: "${apiKey}",
});

const response = await client.responses.create({
  model: "${model}",
  input: "Hello from 001Router!",
});
console.log(response.output_text);`;

    const pythonSdk = `from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${apiKey}",
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello from 001Router!"}],
)
print(resp.choices[0].message.content)`;

    const curlExample = `# OpenAI Responses API (/v1/responses)
curl -sS "${openaiBase}/responses" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"model":"${model}","input":"Hello!"}'

# OpenAI Chat Completions (/v1/chat/completions)
curl -sS "${openaiBase}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello!"}]}'

# Anthropic Messages (/v1/messages)
curl -sS "${cleanOrigin}/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{"model":"${model}","max_tokens":256,"messages":[{"role":"user","content":"Hello!"}]}'`;

    return {
      'claude-code': [
        {
          title: 'Claude Code Persistent Settings',
          fileHint: '~/.claude/settings.json',
          description: 'Updated directly on 1-Click Apply — includes Opus/Sonnet/Haiku slot overrides.',
          code: claudeSettings,
        },
        {
          title: 'Claude Code Shell Launch',
          fileHint: 'Bash / PowerShell',
          description: 'Session-only alternative without modifying ~/.claude/settings.json.',
          code: claudeShell,
        },
      ],
      codex: [
        {
          title: 'Codex CLI Config',
          fileHint: '~/.codex/config.toml',
          description: `Registers 001Router with wire_api = "${codexWireApi}" on 1-Click Apply.`,
          code: codexToml,
        },
        {
          title: 'Codex Auth & Launch',
          fileHint: '~/.codex/auth.json',
          description: 'Persists OPENAI_API_KEY alongside ~/.codex/config.toml.',
          code: codexLaunch,
        },
      ],
      opencode: [
        {
          title: 'OpenCode JSON Configuration',
          fileHint: '~/.config/opencode/opencode.json',
          description: 'Registers 001Router via @ai-sdk/openai-compatible.',
          code: openCodeJson,
        },
      ],
      cline: [
        {
          title: 'Cline CLI Configuration',
          fileHint: '~/.cline/data/globalState.json',
          description: 'Written cleanly on 1-Click Apply without modifying VS Code databases.',
          code: clineOpenAi,
        },
        {
          title: 'Cline (Anthropic Messages)',
          fileHint: 'Alternative',
          description: 'Uses native /v1/messages with tool_use & thinking translation.',
          code: clineAnthropic,
        },
      ],
      kilo: [
        {
          title: 'Kilo Code CLI Configuration',
          fileHint: '~/.config/kilo/opencode.json',
          description: 'Configures router001 custom provider + ~/.local/share/kilo/auth.json.',
          code: openCodeJson,
        },
      ],
      droid: [
        {
          title: 'Factory Droid Settings',
          fileHint: '~/.factory/settings.json',
          description: 'Adds 001Router entry to customModels cleanly while keeping other models.',
          code: droidJson,
        },
      ],
      continue: [
        {
          title: 'Continue YAML Configuration',
          fileHint: '~/.continue/config.yaml',
          description: 'Inserts a clean managed model entry for 001Router.',
          code: continueYaml,
        },
      ],
      aider: [
        {
          title: 'Aider Config File',
          fileHint: '~/.aider.conf.yml',
          description: 'Written automatically to your home folder on 1-Click Apply.',
          code: aiderYaml,
        },
        {
          title: 'Aider CLI Command',
          fileHint: 'Terminal',
          description: 'Launch flags if overriding per invocation.',
          code: aiderCli,
        },
      ],
      cursor: [
        {
          title: 'Cursor Settings → Models',
          fileHint: 'OpenAI Base URL Override',
          description: 'Enable "Override OpenAI Base URL" in Cursor Settings → Models and paste values below.',
          code: cursorCfg,
        },
      ],
      'roo-code': [
        {
          title: 'Roo Code Provider Profile',
          fileHint: 'VS Code → Roo Code Settings',
          description: 'Point Roo Code directly to 001Router for multi-provider fallback & Token Saver.',
          code: rooCodeCfg,
        },
      ],
      windsurf: [
        {
          title: 'Windsurf Custom OpenAI Provider',
          fileHint: 'Settings → Models / BYOK',
          description: 'Configure Windsurf to route through 001Router.',
          code: windsurfCfg,
        },
      ],
      copilot: [
        {
          title: 'GitHub Copilot VS Code BYOK',
          fileHint: 'VS Code Chat → Manage Models',
          description: 'Official VS Code BYOK custom OpenAI-compatible provider entry.',
          code: copilotCfg,
        },
      ],
      sdk: [
        {
          title: 'OpenAI Node.js SDK (/v1/responses)',
          fileHint: 'npm install openai',
          description: 'Supports both Responses API (/v1/responses) and Chat Completions.',
          code: nodeSdk,
        },
        {
          title: 'OpenAI Python SDK',
          fileHint: 'pip install openai',
          description: 'Drop-in base_url override.',
          code: pythonSdk,
        },
        {
          title: 'cURL (Responses, Chat & Anthropic)',
          fileHint: 'Terminal Test',
          description: 'Verify all three wire protocols directly.',
          code: curlExample,
        },
      ],
    };
  }, [cleanOrigin, openaiBase, apiKey, model, claudeOpus, claudeSonnet, claudeHaiku, codexWireApi]);

  const activeSnippets = snippetsByTool[activeTool] || [];

  return (
    <div className="space-y-6">
      {/* ToS-Safe BYOK Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 text-xs">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--text-primary)]">{t('cli.tosBannerTitle')}</div>
          <p className="mt-0.5 leading-relaxed text-[var(--text-secondary)]">
            {t('cli.tosBannerDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={loadStatuses}
          disabled={loadingStatuses}
          className="r-btn-secondary inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStatuses ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </div>

      {/* Live Parameter Selectors */}
      <section className="r-card p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="cli-origin" className="text-xs font-medium text-[var(--text-secondary)]">
                {t('cli.origin')}
              </label>
              {baseOrigin !== window.location.origin ? (
                <button
                  type="button"
                  onClick={() => setBaseOrigin(window.location.origin)}
                  className="inline-flex items-center gap-1 text-[11px] text-[#E56A4A] hover:underline"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reset
                </button>
              ) : null}
            </div>
            <input
              id="cli-origin"
              type="url"
              value={baseOrigin}
              onChange={(e) => setBaseOrigin(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="cli-key" className="text-xs font-medium text-[var(--text-secondary)]">
                {t('cli.routerKey')}
              </label>
              <Link to="/" className="text-[11px] text-[#E56A4A] hover:underline">
                Manage keys →
              </Link>
            </div>
            <select
              id="cli-key"
              value={selectedKey}
              onChange={(e) => {
                setSelectedKey(e.target.value);
                setCustomKeyInput('');
              }}
              className="field-input mt-1.5 w-full px-3 py-2 text-xs"
            >
              {keys.length === 0 ? (
                <option value="">Local anonymous mode (no router key required)</option>
              ) : (
                keys.map((k) => {
                  const rawRemembered = getRememberedRouterKey(k);
                  const tokenVal = rawRemembered || k.keyPreview || k.id;
                  return (
                    <option key={k.id} value={tokenVal}>
                      {k.name} ({k.keyPreview}){rawRemembered ? ' · full' : ' · preview'}{k.enabled ? '' : ' [off]'}
                    </option>
                  );
                })
              )}
            </select>
          </div>

          <div>
            <label htmlFor="cli-model" className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('cli.modelOrCombo')}
            </label>
            <select
              id="cli-model"
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setCustomModel('');
              }}
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            >
              {combos.length > 0 ? (
                <optgroup label="Combos">
                  {combos.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {modelGroups.map((g) => (
                <optgroup key={g.slug} label={`${g.name} (${g.slug})`}>
                  {g.items.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </optgroup>
              ))}
              {combos.length === 0 && modelGroups.length === 0 ? (
                <option value="gemini/gemini-2.5-flash">gemini/gemini-2.5-flash</option>
              ) : null}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              OpenAI / Responses: <code className="text-[var(--text-primary)]">{openaiBase}</code>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              Anthropic: <code className="text-[var(--text-primary)]">{cleanOrigin}</code>
            </span>
          </div>

          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={t('cli.customOverride')}
            aria-label={t('cli.customOverride')}
            className="field-input w-64 px-2.5 py-1 font-mono text-[11px]"
          />
        </div>
      </section>

      {/* Coding Tools Grid with Auto-Detected Status */}
      <section aria-label="Coding Tools" className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {CODING_TOOLS.map((tool) => {
          const isSelected = activeTool === tool.id;
          const st = tool.backendId ? toolStatuses[tool.backendId] : null;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => setActiveTool(tool.id)}
              aria-pressed={isSelected}
              className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
                isSelected
                  ? 'border-[#E56A4A] bg-[#E56A4A]/10 shadow-xs'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="flex items-center gap-3">
                <ProviderLogo
                  preset={tool.id}
                  logo={tool.logo}
                  name={tool.name}
                  color={tool.color}
                  monogram={tool.monogram}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {tool.name}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">{tool.tag}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <StatusBadge
                  status={st?.status}
                  isAuto={Boolean(tool.backendId)}
                  t={t}
                />
                {st?.summary?.model ? (
                  <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {st.summary.model}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </section>

      {/* 1-Click Auto-Configure Control Panel */}
      {activeBackendId ? (
        <section className="r-card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <ProviderLogo
                preset={activeToolMeta.id}
                logo={activeToolMeta.logo}
                name={activeToolMeta.name}
                color={activeToolMeta.color}
                monogram={activeToolMeta.monogram}
                size="md"
              />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    {activeToolMeta.name}
                  </h2>
                  <StatusBadge status={activeToolStatus?.status} isAuto t={t} />
                </div>
                {activeToolStatus?.configPath ? (
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    {t('cli.configPathLabel')}:{' '}
                    <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">
                      {activeToolStatus.configPath}
                    </code>
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={applyingTool === activeBackendId || creatingKey}
                className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {applyingTool === activeBackendId ? t('cli.applyingBtn') : t('cli.applyBtn')}
              </button>

              <button
                type="button"
                onClick={handleCreateKeyAndConnect}
                disabled={creatingKey || applyingTool === activeBackendId}
                className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {creatingKey ? t('cli.creatingKey') : t('cli.createKeyConnectBtn')}
              </button>

              {(activeToolStatus?.status === 'configured' || activeToolStatus?.hasBackup) ? (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resettingTool === activeBackendId}
                  className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-500 hover:border-rose-500/40"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {resettingTool === activeBackendId ? t('cli.resettingBtn') : t('cli.resetBtn')}
                </button>
              ) : null}
            </div>
          </div>

          {/* Unresolved hashed key prompt */}
          {isKeyUnresolved ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2">
              <p className="text-[var(--text-primary)]">{t('cli.keyHintUnresolved')}</p>
              <input
                type="password"
                value={customKeyInput}
                onChange={(e) => setCustomKeyInput(e.target.value)}
                placeholder="Paste full 001Router API key (sk-001r-...) if writing manually…"
                className="field-input w-full px-3 py-1.5 font-mono text-xs"
              />
            </div>
          ) : null}

          {/* Tool-specific configuration fields */}
          {activeBackendId === 'claude' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  {t('cli.opusSlot')}
                </label>
                <input
                  type="text"
                  value={claudeOpus}
                  onChange={(e) => setClaudeOpus(e.target.value)}
                  placeholder="anthropic/claude-opus-4-6"
                  className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  {t('cli.sonnetSlot')}
                </label>
                <input
                  type="text"
                  value={claudeSonnet}
                  onChange={(e) => setClaudeSonnet(e.target.value)}
                  placeholder="anthropic/claude-sonnet-4-6"
                  className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  {t('cli.haikuSlot')}
                </label>
                <input
                  type="text"
                  value={claudeHaiku}
                  onChange={(e) => setClaudeHaiku(e.target.value)}
                  placeholder="gemini/gemini-2.5-flash"
                  className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
            </div>
          ) : null}

          {activeBackendId === 'codex' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                <Wrench className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                {t('cli.wireApiLabel')}:
              </span>
              {['responses', 'chat'].map((wire) => (
                <button
                  key={wire}
                  type="button"
                  onClick={() => setCodexWireApi(wire)}
                  className={`rounded-lg border px-3 py-1 font-mono text-xs transition-colors ${
                    codexWireApi === wire
                      ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A] font-semibold'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  {wire === 'responses' ? 'responses (/v1/responses · Recommended)' : 'chat (/v1/chat/completions)'}
                </button>
              ))}
            </div>
          ) : null}

          {/* Current Applied Summary */}
          {activeToolStatus?.status === 'configured' || activeToolStatus?.hasBackup ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg bg-[var(--bg-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
              {activeToolStatus.summary?.baseUrl ? (
                <span>
                  Base URL:{' '}
                  <code className="font-mono text-[var(--text-primary)]">
                    {activeToolStatus.summary.baseUrl}
                  </code>
                </span>
              ) : null}
              {activeToolStatus.summary?.maskedKey ? (
                <span>
                  Key:{' '}
                  <code className="font-mono text-[var(--text-primary)]">
                    {activeToolStatus.summary.maskedKey}
                  </code>
                </span>
              ) : null}
              {activeToolStatus.hasBackup ? (
                <span className="text-emerald-500">{t('cli.backupSaved')}</span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Selected Tool Snippets */}
      <section className="space-y-4">
        <div className="text-xs font-medium text-[var(--text-muted)]">
          {t('cli.manualPreviewTitle')}
        </div>
        {activeSnippets.map((snippet) => (
          <CodeSnippet
            key={snippet.title}
            title={snippet.title}
            fileHint={snippet.fileHint}
            description={snippet.description}
            code={snippet.code}
          />
        ))}
      </section>
    </div>
  );
}
