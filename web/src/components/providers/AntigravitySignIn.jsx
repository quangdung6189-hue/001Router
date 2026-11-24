import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw, Terminal } from 'lucide-react';
import { CopyButton } from '../CopyButton';
import { CloudCodeQuota, formatReset, pctOf, windowLabel } from './CloudCodeQuota';

const AG = {
  name: 'Antigravity',
  title: 'Đăng nhập Antigravity (Google)',
  badge: 'Thử nghiệm',
  accent: '#F59E0B',
  defaultRedirect: 'http://localhost:1456/callback',
  description: (
    <>
      Dùng OAuth client của <strong>Antigravity IDE</strong> — dịch vụ Google thay cho Gemini CLI.
      Kết nối tạo (hoặc cập nhật) provider riêng <strong>Antigravity (Google)</strong> với model
      Gemini 3.x/4 và Claude. Chat đi qua <code>daily-cloudcode-pa.googleapis.com</code>.
    </>
  ),
  warning:
    'Đây là client không chính thức: Google có thể chặn hoặc hạn chế tài khoản dùng nó qua công cụ bên thứ ba. Nên dùng tài khoản phụ để thử.',
};

/**
 * Connected Antigravity accounts: plan, quota windows and the models on the plan.
 * On the free tier only the weekly / 5-hour windows are meaningful.
 */
function ConnectedAccounts({ accounts, accent, busy, onRefresh }) {
  const nowMs = Date.now();
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
          Tài khoản đã kết nối ({accounts.length})
        </span>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy !== ''}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]"
          >
            <RefreshCw
              className={`h-3 w-3 ${busy === 'refresh' ? 'animate-spin motion-reduce:animate-none' : ''}`}
              style={{ color: accent }}
              aria-hidden="true"
            />
            <span>{busy === 'refresh' ? 'Đang đọc gói & quota…' : 'Làm mới gói & quota'}</span>
          </button>
        ) : null}
      </div>

      {accounts.map((acc) => {
        const meta = acc.oauthMeta || {};
        const cooling = Boolean(acc.cooldownUntil) && acc.cooldownUntil > nowMs;
        return (
          <div
            key={acc.id || meta.email}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5"
          >
            <CloudCodeQuota
              tierLabel={meta.tierLabel}
              email={meta.email || acc.label}
              projectId={meta.projectId}
              windows={Array.isArray(meta.quotaWindows) ? meta.quotaWindows : []}
              models={Array.isArray(meta.availableModels) ? meta.availableModels : []}
              buckets={Array.isArray(meta.quotaBuckets) ? meta.quotaBuckets : []}
              perModelHidden={meta.perModelHidden === true}
              checkedAt={meta.checkedAt}
              accent={accent}
              extra={
                acc.enabled === false ? (
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                    Tắt
                  </span>
                ) : cooling ? (
                  <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                    Cooldown
                  </span>
                ) : !meta.projectId ? (
                  <span className="text-[10px] text-red-400">Chưa có project Cloud Code — chạy chẩn đoán.</span>
                ) : null
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Plain-language verdict of a diagnostics run, read from the probe matrix:
 * A = the model as the router sends it, B = same model without thinking config,
 * C = the plan's default model, bare.
 * @returns {{ tone: 'success' | 'error', text: string } | null}
 */
function diagnosisVerdict(d) {
  if (!d || d.error) return null;
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const load = steps.find((s) => s.step === 'loadCodeAssist');
  if (load && load.ok === false) {
    return {
      tone: 'error',
      text: `loadCodeAssist lỗi HTTP ${load.status ?? '—'}: Google không nhận tài khoản / client này.`,
    };
  }
  if (!d.discoveredProjectId) {
    return {
      tone: 'error',
      text: 'Google chưa cấp project Cloud Code cho tài khoản này nên chưa thể chat.',
    };
  }
  const probes = steps.find((s) => s.step === 'chatProbe')?.probes || [];
  if (!probes.length) return null;
  const by = Object.fromEntries(probes.map((p) => [p.probe, p]));
  const { A, B, C } = by;
  const windows = steps.find((s) => s.step === 'retrieveUserQuotaSummary')?.windows || [];
  const empty = windows.filter((w) => Number(w.remainingFraction) <= 0);
  const catalog = steps.find((s) => s.step === 'fetchAvailableModels')?.catalog || [];
  const planList = catalog.length
    ? ` Model trong gói: ${catalog.slice(0, 8).join(', ')}${catalog.length > 8 ? ', …' : ''}.`
    : '';

  if (probes.every((p) => p.ok)) {
    return {
      tone: 'success',
      text: `Cả ${probes.length} request thử đều chạy (${probes
        .map((p) => p.model)
        .join(', ')}) — tài khoản, quota và định dạng request đều ổn. Nếu công cụ của bạn vẫn bị 429 thì do nội dung request của công cụ đó (system prompt / tools) hoặc nó gọi model không có trong gói.`,
    };
  }
  if (A && !A.ok) {
    if (A.inCatalog === false) {
      return {
        tone: 'error',
        text: `${A.model} KHÔNG có trong gói của tài khoản này — Google trả 429 cho model ngoài gói.${
          C?.ok ? ` Model ${C.model} trong gói chạy được.` : ''
        }${planList} Hãy gọi một model trong danh sách.`,
      };
    }
    if (B?.ok) {
      return {
        tone: 'error',
        text: `${A.model} chỉ lỗi khi kèm cấu hình thinking (${JSON.stringify(A.thinking)}); bỏ cấu hình đó thì chạy. Gửi kết quả này để chỉnh lại định dạng request.`,
      };
    }
    if (C?.ok) {
      return {
        tone: 'error',
        text: `${A.model} bị Google từ chối (HTTP ${A.status ?? '—'}) nhưng ${C.model} trong gói chạy được → dùng model khác trong gói.${planList}`,
      };
    }
  }
  const failed = probes.filter((p) => !p.ok);
  if (failed.length && failed.every((p) => p.status === 429)) {
    if (empty.length) {
      const resets = empty.map((w) => formatReset(w.resetTime)).filter(Boolean);
      return {
        tone: 'error',
        text: `Hết quota: ${empty.map(windowLabel).join(', ')} còn 0%${
          resets.length ? ` — reset ${resets.join(', ')}` : ''
        }. Chờ reset hoặc dùng model nhóm khác (Gemini ↔ Claude & GPT).`,
      };
    }
    return {
      tone: 'error',
      text: `Google từ chối mọi request thử (${failed.map((p) => p.model).join(', ')}) dù quota vẫn còn${
        windows.length
          ? ` (${windows.map((w) => `${windowLabel(w)} ${pctOf(w.remainingFraction)}%`).join(', ')})`
          : ''
      }. Đây là giới hạn phía Google cho tài khoản / client / IP này — code không sửa được. Thử chạy 001Router trên máy (IP nhà) với cùng tài khoản, hoặc dùng tài khoản khác.`,
    };
  }
  const first = failed[0];
  return {
    tone: 'error',
    text: `Chat thử ${first.model} lỗi HTTP ${first.status ?? '—'}${first.error ? `: ${first.error}` : ''}`,
  };
}

/**
 * Antigravity sign-in — the Antigravity IDE's public OAuth client. Google accepts a loopback
 * redirect on any port for that client, so a dashboard hosted on Vercel can finish the flow by
 * pasting the callback URL back. Also lists the connected accounts with their plan and quota.
 */
export function AntigravitySignIn({ onStart, onComplete, onDiagnose, onRefresh, accounts = [] }) {
  const v = AG;
  const DEFAULT_CLI_REDIRECT = v.defaultRedirect;
  const [redirectUri, setRedirectUri] = useState(DEFAULT_CLI_REDIRECT);
  const [authUrl, setAuthUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);

  const redirectError = useMemo(() => {
    try {
      const u = new URL(redirectUri.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return 'Redirect URI phải bắt đầu bằng http:// hoặc https://';
      }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
        return `Dùng 127.0.0.1 hoặc localhost — Google chỉ chấp nhận loopback cho client ${v.name}.`;
      }
      return '';
    } catch {
      return 'Redirect URI không hợp lệ.';
    }
  }, [redirectUri]);

  const handleOpen = async () => {
    if (redirectError) return;
    setFeedback(null);
    setBusy('start');
    try {
      const url = await onStart(redirectUri.trim());
      setAuthUrl(url);
      setPasted('');
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      setFeedback({
        type: 'info',
        message: w
          ? 'Đã mở tab đăng nhập. Chọn tài khoản → Allow, rồi copy địa chỉ trên thanh địa chỉ dán vào ô bên dưới.'
          : 'Trình duyệt chặn tab mới — bấm liên kết "Mở trang đăng nhập" bên dưới.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err?.message || `Không thể bắt đầu đăng nhập ${v.name}.`,
      });
    } finally {
      setBusy('');
    }
  };

  const handleComplete = async () => {
    const value = pasted.trim();
    if (!value) {
      setFeedback({
        type: 'error',
        message: 'Dán địa chỉ callback (có ?code=…&state=…) từ thanh địa chỉ.',
      });
      return;
    }
    setFeedback(null);
    setBusy('complete');
    try {
      await onComplete(value);
      setPasted('');
      setAuthUrl('');
      setFeedback({
        type: 'success',
        message: `Kết nối ${v.name} thành công — đã đọc gói và quota.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err?.message || `Không thể hoàn tất kết nối ${v.name}.`,
      });
    } finally {
      setBusy('');
    }
  };

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setFeedback(null);
    setBusy('refresh');
    try {
      await onRefresh();
      setFeedback({ type: 'success', message: 'Đã đọc lại gói và quota từ Google.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Không đọc được gói / quota.' });
    } finally {
      setBusy('');
    }
  };

  const verdict = diagnosisVerdict(diagnostics);

  const handleDiagnose = async () => {
    if (!onDiagnose) return;
    setBusy('diagnose');
    setDiagnostics(null);
    try {
      const result = await onDiagnose();
      setDiagnostics(result);
    } catch (err) {
      setDiagnostics({ error: err?.message || 'Chẩn đoán thất bại' });
    } finally {
      setBusy('');
    }
  };

  const feedbackClass =
    feedback?.type === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-400'
      : feedback?.type === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-400';

  return (
    <div
      className="space-y-3 rounded-xl border p-4"
      style={{ borderColor: `${v.accent}66`, backgroundColor: `${v.accent}14` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0" style={{ color: v.accent }} aria-hidden="true" />
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">{v.title}</h3>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: v.accent, borderColor: `${v.accent}66`, backgroundColor: `${v.accent}26` }}
        >
          {v.badge}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{v.description}</p>

      {v.warning ? (
        <p
          role="note"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-500"
        >
          {v.warning}
        </p>
      ) : null}

      {accounts.length > 0 ? (
        <ConnectedAccounts
          accounts={accounts}
          accent={v.accent}
          busy={busy}
          onRefresh={onRefresh ? handleRefresh : null}
        />
      ) : null}

      <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        <li>
          Redirect URI (Google chấp nhận mọi cổng loopback cho client này):
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              spellCheck={false}
              aria-label={`${v.name} Redirect URI`}
              className="field-input min-w-0 flex-1 px-2.5 py-1.5 font-mono text-xs"
            />
            <CopyButton value={redirectUri} size="xs" toastMessage={`Copied ${redirectUri}`} />
          </div>
          {redirectError ? <p className="mt-1 text-red-400">{redirectError}</p> : null}
        </li>
        <li>
          <button
            type="button"
            onClick={handleOpen}
            disabled={busy !== '' || Boolean(redirectError)}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            {busy === 'start' ? (
              <RefreshCw
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Mở đăng nhập Google</span>
          </button>
          {authUrl ? (
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-3 font-semibold hover:underline"
              style={{ color: v.accent }}
            >
              Mở trang đăng nhập (nếu tab không tự mở)
            </a>
          ) : null}
        </li>
        <li>
          Chọn tài khoản → <strong>Allow</strong>. Trình duyệt chuyển tới{' '}
          <code>{redirectUri || DEFAULT_CLI_REDIRECT}</code> và báo{' '}
          <em>“ERR_CONNECTION_REFUSED”</em> — <strong>bình thường</strong>. Copy toàn bộ địa chỉ.
        </li>
        <li>Dán vào ô dưới rồi bấm “Hoàn tất kết nối”.</li>
      </ol>

      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        placeholder={`${redirectUri || DEFAULT_CLI_REDIRECT}?state=...&code=4/0A...&scope=...`}
        aria-label={`${v.name} callback URL`}
        className="field-input w-full px-2.5 py-2 font-mono text-xs"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleComplete}
          disabled={busy !== '' || !pasted.trim()}
          className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          {busy === 'complete' ? (
            <RefreshCw
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>Hoàn tất kết nối</span>
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">
          Phiên đăng nhập hết hạn sau ~10 phút.
        </span>
      </div>

      {feedback ? (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 ${feedbackClass}`}
        >
          {feedback.message}
        </p>
      ) : null}

      {onDiagnose ? (
        <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text-secondary)]">
            Chẩn đoán kết nối (gói, quota và một câu chat thử)
          </summary>
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={handleDiagnose}
              disabled={busy !== ''}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px]"
            >
              {busy === 'diagnose' ? (
                <RefreshCw
                  className="h-3 w-3 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Terminal className="h-3 w-3" aria-hidden="true" />
              )}
              <span>Chạy chẩn đoán</span>
            </button>
            {verdict ? (
              <p
                role="status"
                className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                  verdict.tone === 'success'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                    : 'border-red-500/40 bg-red-500/10 text-red-400'
                }`}
              >
                {verdict.text}
              </p>
            ) : null}
            {diagnostics ? (
              <>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
                <CopyButton
                  value={JSON.stringify(diagnostics, null, 2)}
                  label="Copy JSON"
                  size="xs"
                  toastMessage="Đã copy kết quả chẩn đoán"
                />
              </>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
