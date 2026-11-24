import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Play,
  Square,
  Terminal,
  Zap,
} from 'lucide-react';
import {
  combosApi,
  formatNumber,
  getRememberedRouterKey,
  keysApi,
  providersApi,
  settingsApi,
  usageApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Switch } from '../components/Switch';
import { CopyButton } from '../components/CopyButton';
import { LucianThinkingText } from '../components/lucian/LucianGradientText';

export function PlaygroundPage() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const queryModel = searchParams.get('model') || '';
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [combos, setCombos] = useState([]);
  const [requireKey, setRequireKey] = useState(true);

  const [format, setFormat] = useState('openai');
  const [selectedKey, setSelectedKey] = useState('');
  const [modelMode, setModelMode] = useState('select');
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('1024');
  const [systemPrompt, setSystemPrompt] = useState('You are a concise, helpful engineering assistant.');
  const [userPrompt, setUserPrompt] = useState('Write a 3-line haiku about resilient AI routing.');

  const [running, setRunning] = useState(false);
  const [outputText, setOutputText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [rawEvents, setRawEvents] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [metrics, setMetrics] = useState(null);

  const abortRef = useRef(null);

  const loadConfig = useCallback(async () => {
    try {
      const [keysRes, provRes, combosRes, settingsRes] = await Promise.all([
        keysApi.list(),
        providersApi.list(),
        combosApi.list(),
        settingsApi.get(),
      ]);
      const loadedKeys = keysRes?.keys || [];
      const loadedProvs = provRes?.providers || [];
      const loadedCombos = combosRes?.combos || [];

      setKeys(loadedKeys);
      setProviders(loadedProvs);
      setCombos(loadedCombos);
      // `effective` reflects public deployments, where a key is required whatever the stored setting.
      setRequireKey(
        typeof settingsRes?.effective?.requireKey === 'boolean'
          ? settingsRes.effective.requireKey
          : settingsRes?.settings?.requireKey !== false
      );

      setSelectedKey((prev) => {
        if (prev) return prev;
        const firstActive = loadedKeys.find((k) => k.enabled !== false) || loadedKeys[0];
        return getRememberedRouterKey(firstActive) || firstActive?.key || '';
      });

      if (queryModel) {
        const allAvailable = new Set([
          ...loadedCombos.map((c) => c.name),
          ...loadedProvs.flatMap((p) => (p.models || []).map((m) => `${p.slug}/${m}`)),
        ]);
        if (allAvailable.has(queryModel)) {
          setModelMode('select');
          setSelectedModel(queryModel);
        } else {
          setModelMode('custom');
          setCustomModel(queryModel);
        }
      } else {
        setSelectedModel((prev) => {
          if (prev) return prev;
          const firstCombo = loadedCombos.find((c) => c.enabled !== false)?.name;
          if (firstCombo) return firstCombo;
          for (const p of loadedProvs) {
            if (p.enabled !== false && p.models?.length) {
              return `${p.slug}/${p.models[0]}`;
            }
          }
          return '';
        });
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load playground options');
    }
  }, [toast, queryModel]);

  useEffect(() => {
    loadConfig();
    return () => abortRef.current?.abort();
  }, [loadConfig]);

  const modelChoices = useMemo(() => {
    const enabledCombos = combos.filter((c) => c.enabled !== false);
    const providerGroups = providers
      .filter((p) => p.enabled !== false && (p.models || []).length > 0)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        items: p.models.map((m) => `${p.slug}/${m}`),
      }));
    return { enabledCombos, providerGroups };
  }, [combos, providers]);

  const activeModel = modelMode === 'custom' ? customModel.trim() : selectedModel;

  const fetchLatestLogMetrics = async (requestedModel) => {
    try {
      const res = await usageApi.logs({ limit: 5, model: requestedModel });
      const newest = (res?.logs || [])[0];
      if (!newest) return null;
      return {
        resolvedModel: newest.resolvedModel,
        providerSlug: newest.providerSlug,
        fallbackHops: newest.fallbackHops ?? 0,
        savedChars: newest.savedChars ?? 0,
        attemptTrail: newest.attemptTrail || [],
      };
    } catch {
      return null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!activeModel) {
      setErrorMsg('Select or enter a model/combo first.');
      return;
    }
    if (!userPrompt.trim()) {
      setErrorMsg('Enter a user message to send.');
      return;
    }
    if (requireKey && !selectedKey.trim()) {
      setErrorMsg('Router key is required by settings. Create or select an active router key.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorMsg('');
    setOutputText('');
    setThinkingText('');
    setRawEvents('');
    setMetrics(null);

    const startTime = performance.now();
    let firstTokenMs = null;

    const endpoint = format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (selectedKey.trim()) {
      if (format === 'anthropic') {
        headers['x-api-key'] = selectedKey.trim();
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${selectedKey.trim()}`;
      }
    }

    const tempNum = Number(temperature);
    const maxTokNum = Math.max(1, Number(maxTokens) || 1024);

    const body =
      format === 'anthropic'
        ? {
            model: activeModel,
            max_tokens: maxTokNum,
            temperature: Number.isFinite(tempNum) ? tempNum : 0.7,
            stream: streaming,
            ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
            messages: [{ role: 'user', content: userPrompt }],
          }
        : {
            model: activeModel,
            max_tokens: maxTokNum,
            temperature: Number.isFinite(tempNum) ? tempNum : 0.7,
            stream: streaming,
            ...(streaming ? { stream_options: { include_usage: true } } : {}),
            messages: [
              ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
              { role: 'user', content: userPrompt },
            ],
          };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let parsedErr = errText;
        try {
          const json = JSON.parse(errText);
          parsedErr = json?.error?.message || json?.error || json?.message || errText;
        } catch {
          // keep text
        }
        setRawEvents(errText);
        setMetrics({
          status: res.status,
          latencyMs: Math.round(performance.now() - startTime),
          ttftMs: null,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
        setErrorMsg(`HTTP ${res.status}: ${parsedErr || 'Request failed'}`);
        setRunning(false);
        return;
      }

      if (!streaming) {
        const data = await res.json();
        const totalMs = Math.round(performance.now() - startTime);
        setRawEvents(JSON.stringify(data, null, 2));

        let text = '';
        let thinking = '';
        let promptTok = 0;
        let compTok = 0;

        if (format === 'anthropic') {
          const blocks = Array.isArray(data?.content) ? data.content : [];
          for (const b of blocks) {
            if (b.type === 'text') text += b.text || '';
            if (b.type === 'thinking') thinking += b.thinking || '';
          }
          promptTok = data?.usage?.input_tokens || 0;
          compTok = data?.usage?.output_tokens || 0;
        } else {
          text = data?.choices?.[0]?.message?.content || '';
          thinking = data?.choices?.[0]?.message?.reasoning_content || '';
          promptTok = data?.usage?.prompt_tokens || 0;
          compTok = data?.usage?.completion_tokens || 0;
        }

        setOutputText(text);
        setThinkingText(thinking);
        const logExtra = await fetchLatestLogMetrics(activeModel);
        setMetrics({
          status: res.status,
          latencyMs: totalMs,
          ttftMs: null,
          promptTokens: promptTok,
          completionTokens: compTok,
          totalTokens: promptTok + compTok,
          ...logExtra,
        });
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';
      let accThinking = '';
      let accRaw = '';
      let promptTok = 0;
      let compTok = 0;
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        accRaw += chunk;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;

          try {
            const payload = JSON.parse(payloadStr);

            if (format === 'anthropic') {
              const evType = payload.type || currentEvent;
              if (evType === 'message_start' && payload.message?.usage) {
                promptTok = payload.message.usage.input_tokens || promptTok;
              } else if (evType === 'content_block_delta') {
                if (payload.delta?.type === 'text_delta' && payload.delta.text) {
                  if (firstTokenMs === null) {
                    firstTokenMs = Math.round(performance.now() - startTime);
                  }
                  accText += payload.delta.text;
                  setOutputText(accText);
                } else if (payload.delta?.type === 'thinking_delta' && payload.delta.thinking) {
                  accThinking += payload.delta.thinking;
                  setThinkingText(accThinking);
                }
              } else if (evType === 'message_delta' && payload.usage) {
                compTok = payload.usage.output_tokens || compTok;
              } else if (evType === 'error') {
                setErrorMsg(payload.error?.message || 'Upstream streaming error');
              }
            } else {
              const delta = payload.choices?.[0]?.delta;
              if (delta?.content) {
                if (firstTokenMs === null) {
                  firstTokenMs = Math.round(performance.now() - startTime);
                }
                accText += delta.content;
                setOutputText(accText);
              }
              if (delta?.reasoning_content) {
                accThinking += delta.reasoning_content;
                setThinkingText(accThinking);
              }
              if (payload.usage) {
                promptTok = payload.usage.prompt_tokens ?? promptTok;
                compTok = payload.usage.completion_tokens ?? compTok;
              }
            }
          } catch {
            // Ignore partial non-JSON lines
          }
        }
        setRawEvents(accRaw);
      }

      const totalMs = Math.round(performance.now() - startTime);
      const logExtra = await fetchLatestLogMetrics(activeModel);
      setMetrics({
        status: res.status,
        latencyMs: totalMs,
        ttftMs: firstTokenMs,
        promptTokens: promptTok,
        completionTokens: compTok,
        totalTokens: promptTok + compTok,
        ...logExtra,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Playground request failed');
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Controls */}
      <form onSubmit={handleSend} className="r-card space-y-4 p-5 lg:col-span-5">
        <div>
          <span className="block text-xs font-medium text-[var(--text-secondary)]">
            Endpoint Format
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormat('openai')}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                format === 'openai'
                  ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
              }`}
            >
              <div className="font-semibold">OpenAI</div>
              <div className="mt-0.5 font-mono text-[10px] opacity-80">/v1/chat/completions</div>
            </button>
            <button
              type="button"
              onClick={() => setFormat('anthropic')}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                format === 'anthropic'
                  ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
              }`}
            >
              <div className="font-semibold">Anthropic</div>
              <div className="mt-0.5 font-mono text-[10px] opacity-80">/v1/messages</div>
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="pg-key" className="block text-xs font-medium text-[var(--text-secondary)]">
            Router API Key {requireKey ? '(Required)' : '(Optional)'}
          </label>
          <select
            id="pg-key"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="field-input mt-1.5 w-full px-3 py-2 text-xs"
          >
            {!requireKey ? <option value="">No key (auth disabled)</option> : null}
            {keys.length === 0 ? (
              <option value="">No router keys created yet</option>
            ) : (
              keys.map((k) => {
                const tokenVal = getRememberedRouterKey(k) || k.key || '';
                return (
                  <option key={k.id} value={tokenVal}>
                    {k.name} ({k.keyPreview}){k.enabled ? '' : ' [disabled]'}
                  </option>
                );
              })
            )}
          </select>
          <input
            type="password"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            placeholder="Or paste sk-001r-... router key secret directly"
            aria-label="Manual router key secret"
            className="field-input mt-1.5 w-full px-3 py-1.5 font-mono text-xs"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="pg-model" className="block text-xs font-medium text-[var(--text-secondary)]">
              Model or Combo Alias
            </label>
            <button
              type="button"
              onClick={() => setModelMode((m) => (m === 'select' ? 'custom' : 'select'))}
              className="text-[11px] font-medium text-[#E56A4A] hover:underline"
            >
              {modelMode === 'select' ? 'Enter custom ID' : 'Choose from list'}
            </button>
          </div>

          {modelMode === 'select' ? (
            <select
              id="pg-model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            >
              {modelChoices.enabledCombos.length === 0 &&
              modelChoices.providerGroups.length === 0 ? (
                <option value="">No models configured — switch to custom ID</option>
              ) : null}

              {modelChoices.enabledCombos.length > 0 ? (
                <optgroup label="Combos">
                  {modelChoices.enabledCombos.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({c.targets?.length || 0} targets)
                    </option>
                  ))}
                </optgroup>
              ) : null}

              {modelChoices.providerGroups.map((g) => (
                <optgroup key={g.slug} label={`${g.name} (${g.slug})`}>
                  {g.items.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <input
              id="pg-model"
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. free-coder or gemini/gemini-2.5-flash"
              className="field-input mt-1.5 w-full px-3 py-2 font-mono text-xs"
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-end pb-2">
            <Switch checked={streaming} onChange={setStreaming} label="Stream" size="sm" />
          </div>
          <div>
            <label htmlFor="pg-temp" className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Temperature
            </label>
            <input
              id="pg-temp"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
            />
          </div>
          <div>
            <label htmlFor="pg-maxtok" className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Max Tokens
            </label>
            <input
              id="pg-maxtok"
              type="number"
              min="1"
              max="128000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="field-input mt-1 w-full px-2.5 py-1.5 font-mono text-xs"
            />
          </div>
        </div>

        <div>
          <label htmlFor="pg-system" className="block text-xs font-medium text-[var(--text-secondary)]">
            System Prompt
          </label>
          <textarea
            id="pg-system"
            rows={2}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="field-input mt-1.5 w-full px-3 py-2 text-xs"
          />
        </div>

        <div>
          <label htmlFor="pg-user" className="block text-xs font-medium text-[var(--text-secondary)]">
            User Message <span className="text-[var(--text-muted)]">(Ctrl/Cmd + Enter)</span>
          </label>
          <textarea
            id="pg-user"
            rows={4}
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !running) {
                handleSend();
              }
            }}
            className="field-input mt-1.5 w-full px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={running}
            className="r-btn-primary flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {running ? 'Streaming…' : 'Send Request'}
          </button>
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-3.5 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/25"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Stop
            </button>
          ) : null}
        </div>
      </form>

      {/* Right Output & Telemetry */}
      <div className="flex flex-col gap-4 lg:col-span-7">
        <div className="r-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              Response Telemetry
            </div>
            {metrics ? (
              <span
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  metrics.status >= 200 && metrics.status < 400
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-red-500/15 text-red-500'
                }`}
              >
                HTTP {metrics.status}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="r-card-subtle p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Latency
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--text-primary)]">
                {metrics ? `${metrics.latencyMs}ms` : '—'}
              </div>
              {metrics?.ttftMs !== null && metrics?.ttftMs !== undefined ? (
                <div className="text-[10px] text-[var(--text-muted)]">TTFT {metrics.ttftMs}ms</div>
              ) : null}
            </div>

            <div className="r-card-subtle p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Zap className="h-3 w-3" aria-hidden="true" />
                Tokens
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--text-primary)]">
                {metrics ? formatNumber(metrics.totalTokens) : '—'}
              </div>
              {metrics ? (
                <div className="text-[10px] text-[var(--text-muted)]">
                  {metrics.promptTokens} in / {metrics.completionTokens} out
                </div>
              ) : null}
            </div>

            <div className="r-card-subtle p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <GitBranch className="h-3 w-3" aria-hidden="true" />
                Fallback Hops
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--text-primary)]">
                {metrics?.fallbackHops !== undefined ? metrics.fallbackHops : '—'}
              </div>
              {metrics?.providerSlug ? (
                <div className="single-line-truncate text-[10px] text-[#E56A4A]">
                  via {metrics.providerSlug}
                </div>
              ) : null}
            </div>

            <div className="r-card-subtle p-2.5">
              <div className="text-[11px] text-[var(--text-muted)]">Resolved Target</div>
              <div className="single-line-truncate mt-1 font-mono text-xs font-medium text-[var(--text-primary)]">
                {metrics?.resolvedModel || activeModel || '—'}
              </div>
              {metrics?.savedChars > 0 ? (
                <div className="text-[10px] text-emerald-500">
                  -{formatNumber(metrics.savedChars)} chars saved
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-500"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{errorMsg}</span>
          </div>
        ) : null}

        <div className="r-card flex flex-1 flex-col p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Assistant Response</h2>
            <div className="flex items-center gap-2">
              {rawEvents ? (
                <button
                  type="button"
                  onClick={() => setShowRaw((r) => !r)}
                  className="r-btn-secondary px-2.5 py-1 text-xs"
                >
                  {showRaw ? 'Formatted View' : 'Raw Payload / SSE'}
                </button>
              ) : null}
              {outputText ? <CopyButton value={outputText} size="xs" /> : null}
            </div>
          </div>

          {thinkingText ? (
            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
              <button
                type="button"
                onClick={() => setThinkingOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-[var(--text-primary)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                  Thinking / Reasoning
                </span>
                {thinkingOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
              {thinkingOpen ? (
                <pre className="code-surface max-h-48 overflow-auto border-t p-3 whitespace-pre-wrap font-mono text-[11px]">
                  {thinkingText}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div
            className={`mt-3 min-h-[16rem] flex-1 overflow-auto rounded-lg border p-4 ${
              showRaw
                ? 'code-surface'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'
            }`}
          >
            {showRaw ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{rawEvents}</pre>
            ) : outputText ? (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {outputText}
              </div>
            ) : running ? (
              <div className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                <span className="h-2 w-2 animate-ping motion-reduce:animate-none rounded-full bg-[#E56A4A]" aria-hidden="true" />
                <LucianThinkingText>Waiting for upstream tokens…</LucianThinkingText>
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)]">
                Configure model, format, and prompt on the left, then click Send Request.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
