// Shared CLI & IDE tool catalog, status helpers, and manual config snippet builders
// for both CliToolsPage and CliToolDetailPage.

export const MITM_IDE_CARDS = [
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: 'antigravity',
    color: '#4285F4',
    monogram: 'AG',
    description: 'Google Antigravity IDE via 001Router Extension or local proxy bridge',
    mitmDomains: ['daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com'],
    defaultAliases: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', alias: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', alias: 'gemini-2.5-flash' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', alias: 'claude-sonnet-4-5' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', alias: 'claude-opus-4-5' },
    ],
  },
  {
    id: 'kiro',
    name: 'Kiro IDE',
    logo: 'kiro',
    color: '#FF6B00',
    monogram: 'KR',
    description: 'Kiro IDE agent routing & model alias mapping bridge',
    mitmDomains: [
      'runtime.us-east-1.kiro.dev',
      'q.us-east-1.amazonaws.com',
      'codewhisperer.us-east-1.amazonaws.com',
    ],
    defaultAliases: [
      { id: 'auto', name: 'Auto (Kiro Agent)', alias: 'auto' },
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', alias: 'claude-sonnet-4.5' },
      { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', alias: 'claude-haiku-4.5' },
      { id: 'deepseek-3.2', name: 'DeepSeek 3.2', alias: 'deepseek-3.2' },
    ],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    logo: 'copilot',
    color: '#475569',
    monogram: 'CP',
    description: 'VS Code GitHub Copilot Chat BYOK custom OpenAI-compatible provider',
    mitmDomains: ['api.individual.githubcopilot.com'],
    defaultAliases: [
      { id: 'gpt-4o', name: 'GPT-4o', alias: 'gpt-4o' },
      { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', alias: 'claude-3.7-sonnet' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor IDE',
    logo: 'cursor',
    color: '#2563EB',
    monogram: 'CU',
    description: 'Cursor IDE OpenAI Base URL override (requires Tunnel or Tailscale HTTPS)',
    mitmDomains: ['api2.cursor.sh'],
    defaultAliases: [
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', alias: 'claude-sonnet-4.5' },
      { id: 'gpt-4o', name: 'GPT-4o', alias: 'gpt-4o' },
    ],
  },
];

export const CODING_TOOLS = [
  {
    id: 'claude-code',
    backendId: 'claude',
    logo: 'claude',
    name: 'Claude Code',
    tag: '1-Click · Anthropic',
    description: 'Anthropic Claude Code CLI (~/.claude/settings.json)',
    color: '#D97757',
    monogram: 'CC',
    configPathHint: '~/.claude/settings.json',
    docsCmd: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    backendId: 'codex',
    logo: 'codex',
    name: 'Codex CLI',
    tag: '1-Click · TOML',
    description: 'OpenAI Codex CLI (~/.codex/config.toml)',
    color: '#10A37F',
    monogram: 'CX',
    configPathHint: '~/.codex/config.toml',
    docsCmd: 'npm install -g @openai/codex',
  },
  {
    id: 'opencode',
    backendId: 'opencode',
    logo: 'opencode',
    name: 'OpenCode',
    tag: '1-Click · JSON',
    description: 'OpenCode terminal agent (~/.config/opencode/opencode.json)',
    color: '#F59E0B',
    monogram: 'OC',
    configPathHint: '~/.config/opencode/opencode.json',
    docsCmd: 'npm install -g opencode-ai',
  },
  {
    id: 'cline',
    backendId: 'cline',
    logo: 'cline',
    name: 'Cline CLI',
    tag: '1-Click · JSON',
    description: 'Cline autonomous coding agent globalState + secrets',
    color: '#7C3AED',
    monogram: 'CL',
    configPathHint: '~/.cline/data/globalState.json',
    docsCmd: 'npm install -g cline',
  },
  {
    id: 'kilo',
    backendId: 'kilo',
    logo: 'kilocode',
    name: 'Kilo Code CLI',
    tag: '1-Click · JSON',
    description: 'Kilo Code CLI (~/.config/kilo/opencode.json)',
    color: '#FF6B35',
    monogram: 'KC',
    configPathHint: '~/.config/kilo/opencode.json',
    docsCmd: 'npm install -g @kilocode/cli',
  },
  {
    id: 'droid',
    backendId: 'droid',
    logo: 'droid',
    name: 'Factory Droid',
    tag: '1-Click · JSON',
    description: 'Factory Droid CLI (~/.factory/settings.json)',
    color: '#16A34A',
    monogram: 'DR',
    configPathHint: '~/.factory/settings.json',
    docsCmd: 'curl -fsSL https://app.factory.ai/cli | sh',
  },
  {
    id: 'continue',
    backendId: 'continue',
    logo: 'continue',
    name: 'Continue',
    tag: '1-Click · YAML',
    description: 'Continue CLI & IDE (~/.continue/config.yaml)',
    color: '#0EA5E9',
    monogram: 'CN',
    configPathHint: '~/.continue/config.yaml',
    docsCmd: 'npm install -g @continuedev/cli',
  },
  {
    id: 'aider',
    backendId: 'aider',
    logo: 'aider',
    name: 'Aider',
    tag: '1-Click · YAML',
    description: 'Aider AI pair programmer (~/.aider.conf.yml)',
    color: '#15803D',
    monogram: 'AD',
    configPathHint: '~/.aider.conf.yml',
    docsCmd: 'pip install aider-chat',
  },
  {
    id: 'cursor',
    backendId: null,
    logo: 'cursor',
    name: 'Cursor',
    tag: 'IDE Guide',
    description: 'Cursor IDE OpenAI Base URL override',
    color: '#2563EB',
    monogram: 'CU',
    configPathHint: 'Cursor Settings -> Models -> Override OpenAI Base URL',
  },
  {
    id: 'roo-code',
    backendId: null,
    logo: 'roo',
    name: 'Roo Code',
    tag: 'VS Code Guide',
    description: 'Roo Code VS Code extension OpenAI Compatible profile',
    color: '#EC4899',
    monogram: 'RC',
    configPathHint: 'Roo Code Settings -> API Provider -> OpenAI Compatible',
  },
  {
    id: 'windsurf',
    backendId: null,
    logo: 'windsurf',
    name: 'Windsurf',
    tag: 'IDE Guide',
    description: 'Windsurf / OpenAI-compatible IDE endpoint setup',
    color: '#06B6D4',
    monogram: 'WS',
    configPathHint: 'Settings -> Custom OpenAI Compatible Endpoint',
  },
  {
    id: 'copilot',
    backendId: null,
    logo: 'copilot',
    name: 'GitHub Copilot',
    tag: 'VS Code BYOK',
    description: 'VS Code Copilot Chat Manage Models (OpenAI Compatible)',
    color: '#475569',
    monogram: 'CP',
    configPathHint: 'VS Code Chat -> Manage Models -> Add OpenAI Compatible',
  },
  {
    id: 'sdk',
    backendId: null,
    logo: 'openai',
    name: 'OpenAI SDK / cURL',
    tag: 'Node · Python · HTTP',
    description: 'Official OpenAI SDK, Anthropic SDK, and cURL examples',
    color: '#E56A4A',
    monogram: 'SD',
    configPathHint: 'Any OpenAI or Anthropic compatible HTTP client',
  },
];

export function findCodingTool(toolIdParam) {
  const clean = String(toolIdParam || '').trim().toLowerCase();
  return (
    CODING_TOOLS.find(
      (item) =>
        item.id.toLowerCase() === clean ||
        (item.backendId && item.backendId.toLowerCase() === clean)
    ) || null
  );
}

export function getToolSummaryStatus(toolMeta, statusObj) {
  if (!toolMeta?.backendId) {
    return { code: 'guide', label: 'Guide', tone: 'neutral' };
  }
  const st = statusObj?.status;
  if (st === 'configured') {
    return { code: 'configured', label: 'Configured', tone: 'success' };
  }
  if (st === 'other') {
    return { code: 'other', label: 'Other Config', tone: 'warning' };
  }
  if (st === 'installed') {
    return { code: 'installed', label: 'Not Configured', tone: 'muted' };
  }
  if (st === 'not_detected') {
    return { code: 'not_detected', label: 'Not Installed', tone: 'subtle' };
  }
  return { code: 'unknown', label: 'Ready', tone: 'muted' };
}

export function stripTrailingV1(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '');
}

export function ensureV1(url) {
  const base = stripTrailingV1(url);
  return base ? `${base}/v1` : '/v1';
}

export function buildManualConfigSnippets(
  toolMeta,
  {
    originUrl = 'http://127.0.0.1:20128',
    apiKey = 'YOUR_ROUTER_API_KEY',
    model = 'openai/gpt-4o-mini',
    opusModel = '',
    sonnetModel = '',
    haikuModel = '',
    wireApi = 'responses',
  } = {}
) {
  const origin = stripTrailingV1(originUrl) || 'http://127.0.0.1:20128';
  const v1 = `${origin}/v1`;
  const key = apiKey || 'YOUR_ROUTER_API_KEY';
  const mdl = model || 'openai/gpt-4o-mini';

  switch (toolMeta?.id) {
    case 'claude-code':
      return [
        {
          title: '~/.claude/settings.json',
          lang: 'json',
          content: JSON.stringify(
            {
              env: {
                ANTHROPIC_BASE_URL: origin,
                ANTHROPIC_AUTH_TOKEN: key,
                ANTHROPIC_MODEL: mdl,
                ...(opusModel ? { ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel } : {}),
                ...(sonnetModel ? { ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel } : {}),
                ...(haikuModel ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel } : {}),
              },
            },
            null,
            2
          ),
        },
        {
          title: 'Shell environment (Bash / PowerShell)',
          lang: 'bash',
          content: `export ANTHROPIC_BASE_URL="${origin}"\nexport ANTHROPIC_AUTH_TOKEN="${key}"\nexport ANTHROPIC_MODEL="${mdl}"\nclaude`,
        },
      ];

    case 'codex':
      return [
        {
          title: '~/.codex/config.toml',
          lang: 'toml',
          content: [
            `model = "${mdl}"`,
            `model_provider = "router_001"`,
            '',
            `[model_providers.router_001]`,
            `name = "001Router"`,
            `base_url = "${v1}"`,
            `wire_api = "${wireApi === 'chat' ? 'chat' : 'responses'}"`,
          ].join('\n'),
        },
        {
          title: '~/.codex/auth.json',
          lang: 'json',
          content: JSON.stringify({ OPENAI_API_KEY: key }, null, 2),
        },
      ];

    case 'opencode':
    case 'kilo':
      return [
        {
          title: toolMeta.configPathHint || 'opencode.json',
          lang: 'json',
          content: JSON.stringify(
            {
              provider: {
                router001: {
                  npm: '@ai-sdk/openai-compatible',
                  name: '001Router',
                  options: { baseURL: v1, apiKey: key },
                  models: { [mdl]: { name: mdl } },
                },
              },
              model: `router001/${mdl}`,
            },
            null,
            2
          ),
        },
      ];

    case 'droid':
      return [
        {
          title: '~/.factory/settings.json',
          lang: 'json',
          content: JSON.stringify(
            {
              customModels: [
                {
                  id: 'custom:001Router',
                  displayName: `001Router (${mdl})`,
                  model: mdl,
                  baseUrl: v1,
                  apiKey: key,
                  provider: 'generic-chat-completion-api',
                },
              ],
            },
            null,
            2
          ),
        },
      ];

    case 'continue':
      return [
        {
          title: '~/.continue/config.yaml',
          lang: 'yaml',
          content: [
            'models:',
            `  - name: "001Router (${mdl})"`,
            '    provider: openai',
            `    model: ${JSON.stringify(mdl)}`,
            `    apiBase: ${JSON.stringify(v1)}`,
            `    apiKey: ${JSON.stringify(key)}`,
          ].join('\n'),
        },
      ];

    case 'aider':
      return [
        {
          title: '~/.aider.conf.yml',
          lang: 'yaml',
          content: [
            `openai-api-base: ${JSON.stringify(v1)}`,
            `openai-api-key: ${JSON.stringify(key)}`,
            `model: ${JSON.stringify(mdl.startsWith('openai/') ? mdl : `openai/${mdl}`)}`,
          ].join('\n'),
        },
      ];

    case 'cursor':
    case 'windsurf':
    case 'roo-code':
    case 'copilot':
      return [
        {
          title: `${toolMeta.name} Settings`,
          lang: 'text',
          content: [
            `Provider: OpenAI Compatible`,
            `Base URL: ${v1}`,
            `API Key:  ${key}`,
            `Model:    ${mdl}`,
            ...(toolMeta.id === 'cursor'
              ? [
                  '',
                  'Note: Cursor routes cloud checks through api2.cursor.sh; enable Cloudflare Tunnel or Tailscale HTTPS under Endpoint & Key so Cursor accepts the Base URL.',
                ]
              : []),
          ].join('\n'),
        },
      ];

    default:
      return [
        {
          title: 'Node.js (OpenAI SDK v4+)',
          lang: 'javascript',
          content: [
            `import OpenAI from 'openai';`,
            ``,
            `const client = new OpenAI({`,
            `  baseURL: '${v1}',`,
            `  apiKey: '${key}',`,
            `});`,
            ``,
            `const res = await client.chat.completions.create({`,
            `  model: '${mdl}',`,
            `  messages: [{ role: 'user', content: 'Hello from 001Router' }],`,
            `});`,
          ].join('\n'),
        },
        {
          title: 'cURL',
          lang: 'bash',
          content: [
            `curl ${v1}/chat/completions \\`,
            `  -H "Authorization: Bearer ${key}" \\`,
            `  -H "Content-Type: application/json" \\`,
            `  -d '{"model":"${mdl}","messages":[{"role":"user","content":"Hello"}]}'`,
          ].join('\n'),
        },
      ];
  }
}
