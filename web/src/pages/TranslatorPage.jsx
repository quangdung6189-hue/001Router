import { useState } from 'react';
import { AlertCircle, ArrowLeftRight, Braces, Play, Wrench } from 'lucide-react';
import { debugApi } from '../lib/api';
import { useLocale } from '../context/LocaleContext';
import { CopyButton } from '../components/CopyButton';

const SAMPLES = {
  'claude-to-openai': {
    basic: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a concise TypeScript architect.',
      messages: [{ role: 'user', content: 'Explain discriminated unions in 2 sentences.' }],
    },
    tool: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'Use available tools to inspect workspace files before answering.',
      tools: [
        {
          name: 'read_file',
          description: 'Read a text file from disk',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
      messages: [
        { role: 'user', content: 'Check package.json version.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read package.json.' },
            { type: 'tool_use', id: 'toolu_01ABC', name: 'read_file', input: { path: 'package.json' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_01ABC', content: '{"name":"001router","version":"1.1.0"}' },
          ],
        },
      ],
    },
    stream: {
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 2048,
      temperature: 0.3,
      stream: true,
      stop_sequences: ['</done>'],
      system: [{ type: 'text', text: 'Return structured markdown.' }],
      messages: [{ role: 'user', content: 'List 3 tips for resilient HTTP retries.' }],
    },
  },
  'openai-to-claude': {
    basic: {
      model: 'gpt-4.1',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: 'You are a concise TypeScript architect.' },
        { role: 'user', content: 'Explain discriminated unions in 2 sentences.' },
      ],
    },
    tool: {
      model: 'gpt-4.1',
      max_tokens: 1024,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a text file from disk',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ],
      messages: [
        { role: 'system', content: 'Use tools to inspect files.' },
        { role: 'user', content: 'Check package.json version.' },
        {
          role: 'assistant',
          content: 'Let me read package.json.',
          tool_calls: [
            {
              id: 'call_01XYZ',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"package.json"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_01XYZ',
          content: '{"name":"001router","version":"1.1.0"}',
        },
      ],
    },
    stream: {
      model: 'gpt-4o',
      max_tokens: 1024,
      temperature: 0.4,
      stream: true,
      stop: ['</done>'],
      messages: [
        { role: 'system', content: 'Return clean bullet points.' },
        { role: 'user', content: 'List 3 tips for resilient HTTP retries.' },
      ],
    },
  },
};

export function TranslatorPage() {
  const { t } = useLocale();
  const [direction, setDirection] = useState('claude-to-openai');
  const [inputJson, setInputJson] = useState(() =>
    JSON.stringify(SAMPLES['claude-to-openai'].tool, null, 2)
  );
  const [outputJson, setOutputJson] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDirectionChange = (nextDir) => {
    setDirection(nextDir);
    setInputJson(JSON.stringify(SAMPLES[nextDir].tool, null, 2));
    setOutputJson('');
    setError('');
  };

  const loadSample = (kind) => {
    setInputJson(JSON.stringify(SAMPLES[direction][kind], null, 2));
    setError('');
  };

  const handleFormatInput = () => {
    try {
      const parsed = JSON.parse(inputJson);
      setInputJson(JSON.stringify(parsed, null, 2));
      setError('');
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleTranslate = async () => {
    setError('');
    let parsed;
    try {
      parsed = JSON.parse(inputJson);
    } catch (err) {
      setError(`Invalid input JSON: ${err.message}`);
      return;
    }

    setLoading(true);
    try {
      const res = await debugApi.translate(direction, parsed);
      setOutputJson(JSON.stringify(res?.translated ?? res, null, 2));
    } catch (err) {
      setError(err?.message || 'Translation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Direction & Sample Bar */}
      <div className="r-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleDirectionChange('claude-to-openai')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              direction === 'claude-to-openai'
                ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            {t('translator.claudeToOpenai')}
          </button>

          <button
            type="button"
            onClick={() => handleDirectionChange('openai-to-claude')}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              direction === 'openai-to-claude'
                ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            {t('translator.openaiToClaude')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadSample('basic')}
            className="r-btn-secondary px-2.5 py-1.5 text-xs"
          >
            {t('translator.sampleBasic')}
          </button>
          <button
            type="button"
            onClick={() => loadSample('tool')}
            className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs"
          >
            <Wrench className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
            {t('translator.sampleTool')}
          </button>
          <button
            type="button"
            onClick={() => loadSample('stream')}
            className="r-btn-secondary px-2.5 py-1.5 text-xs"
          >
            {t('translator.sampleStream')}
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-500"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Side-by-side JSON Input & Translated Output */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="r-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Input Payload ({direction === 'claude-to-openai' ? 'Anthropic' : 'OpenAI'})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFormatInput}
                className="r-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px]"
              >
                <Braces className="h-3 w-3" aria-hidden="true" />
                {t('translator.formatJson')}
              </button>
              <button
                type="button"
                onClick={handleTranslate}
                disabled={loading}
                className="r-btn-primary inline-flex items-center gap-1 px-3 py-1 text-xs"
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                {loading ? t('common.loading') : t('translator.translateBtn')}
              </button>
            </div>
          </div>

          <textarea
            rows={20}
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            spellCheck={false}
            aria-label="Input JSON payload"
            className="code-surface flex-1 resize-none border-0 p-4 font-mono text-xs leading-relaxed focus:outline-none"
          />
        </div>

        <div className="r-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Translated Output ({direction === 'claude-to-openai' ? 'OpenAI' : 'Anthropic'})
            </span>
            {outputJson ? (
              <CopyButton value={outputJson} size="xs" toastMessage="Copied translated JSON" />
            ) : null}
          </div>

          <pre className="code-surface min-h-[26rem] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {outputJson || '// Click "Translate" to preview POST /api/debug/translate output.'}
          </pre>
        </div>
      </div>
    </div>
  );
}
