import { useMemo, useState } from 'react';
import { BadgeCheck, CheckCircle2, ExternalLink, RefreshCw, Terminal } from 'lucide-react';
import { CopyButton } from '../CopyButton';

const VARIANTS = {
  gemini_cli: {
    name: 'Gemini CLI',
    title: 'Đăng nhập Gemini CLI (Cloud Code Assist)',
    badge: 'Không cần GCP Project',
    accent: '#E56A4A',
    defaultRedirect: 'http://127.0.0.1:1455/oauth2callback',
    description: (
      <>
        Dùng OAuth client công khai của <strong>Gemini CLI</strong> — cùng client mà 9router dùng.
        Không cần tạo OAuth client riêng, không cần bật Cloud Billing. Server tự gọi{' '}
        <code>loadCodeAssist</code> để lấy project miễn phí và <code>retrieveUserQuota</code> để
        hiện gói.
      </>
    ),
    warning: null,
  },
  antigravity: {
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
  },
};

const FAMILY_LABELS = {
  gemini_argon: 'Gemini 4 Argon',
  gemini: 'Gemini',
  claude_gpt: 'Claude & GPT',
};

function windowLabel(w) {
  const family = FAMILY_LABELS[w?.family] || w?.label || 'Quota';
  return `${family} · ${w?.window === 'weekly' ? 'tuần' : '5 giờ'}`;
}

function pctOf(fraction) {
  return Math.max(0, Math.min(100, Math.round((Number(fraction) || 0) * 100)));
}

/** "24/11 15:30 (còn 3 giờ 12 phút)" — empty when the time is missing or invalid. */
function formatReset(resetTime, nowMs = Date.now()) {
  const ms = Date.parse(resetTime || '');
  if (!Number.isFinite(ms)) return '';
  const when = new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const left = ms - nowMs;
  if (left <= 0) return when;
  const mins = Math.round(left / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  const parts = days ? [`${days} ngày`, `${hours} giờ`] : hours ? [`${hours} giờ`, `${rest} phút`] : [`${rest} phút`];
  return `${when} (còn ${parts.join(' ')})`;
}

function QuotaBar({ label, fraction, resetTime }) {
  const pct = pctOf(fraction);
  const tone = pct >= 50 ? 'bg-emerald-500' : pct >= 20 ? 'bg-amber-500' : 'bg-red-500';
  const reset = formatReset(resetTime);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-[10.5px]">
        <span className="truncate text-[var(--text-primary)]">{label}</span>
        <span className="shrink-0 font-semibold text-[var(--text-secondary)]">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {reset ? (
        <div className="text-[10px] text-[var(--text-muted)]">Reset: {reset}</div>
      ) : null}
    </div>
  );
}

/**
 * Connected Cloud Code accounts: plan, project and the live quota stored on the key.
 * On the Antigravity free tier only the weekly / 5-hour windows are meaningful.
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
        const windows = Array.isArray(meta.quotaWindows) ? meta.quotaWindows : [];
        const buckets = Array.isArray(meta.quotaBuckets) ? meta.quotaBuckets : [];
        const cooling = Boolean(acc.cooldownUntil) && acc.cooldownUntil > nowMs;
        return (
          <div
            key={acc.id || meta.email}
            className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} aria-hidden="true" />
                  <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                    {meta.email || acc.label || 'Google Account'}
                  </span>
                  {acc.enabled === false ? (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      Tắt
                    </span>
                  ) : cooling ? (
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                      Cooldown
                    </span>
                  ) : null}
                </div>
                {meta.projectId ? (
                  <code className="mt-0.5 block truncate pl-5 text-[10px] text-[var(--text-muted)]">
                    {meta.projectId}
                  </code>
                ) : (
                  <p className="mt-0.5 pl-5 text-[10px] text-red-400">
                    Chưa có project Cloud Code — chạy chẩn đoán bên dưới.
                  </p>
                )}
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                style={{ color: accent, borderColor: `${accent}66`, backgroundColor: `${accent}1f` }}
              >
                {meta.tierLabel || 'Chưa đọc được gói'}
              </span>
            </div>

            {windows.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {windows.map((w) => (
                  <QuotaBar
                    key={w.id}
                    label={windowLabel(w)}
                    fraction={w.remainingFraction}
                    resetTime={w.resetTime}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[10.5px] text-[var(--text-muted)]">
                Chưa có quota tuần / 5 giờ — bấm “Làm mới gói & quota”.
              </p>
            )}

            {buckets.length ? (
              <details>
                <summary className="cursor-pointer text-[10.5px] font-medium text-[var(--text-secondary)]">
                  Quota theo model ({buckets.length})
                </summary>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {buckets.map((b) => (
                    <QuotaBar
                      key={b.modelId}
                      label={b.modelId}
                      fraction={b.remainingFraction}
                      resetTime={b.resetTime}
                    />
                  ))}
                </div>
              </details>
            ) : meta.perModelHidden ? (
              <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">
                Gói miễn phí: con số theo từng model Google trả về không phải giới hạn thật nên được ẩn —
                giới hạn thật là quota tuần / 5 giờ ở trên.
              </p>
            ) : null}

            {meta.checkedAt ? (
              <div className="text-[10px] text-[var(--text-muted)]">
                Cập nhật: {formatReset(meta.checkedAt, Number.POSITIVE_INFINITY) || meta.checkedAt}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Plain-language verdict of a diagnostics run: is it the account, the quota, or the request?
 * @returns {{ tone: 'success' | 'error' | 'info', text: string } | null}
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
  const probe = steps.find((s) => s.step === 'chatProbe');
  if (!probe) return null;
  const windows = steps.find((s) => s.step === 'retrieveUserQuotaSummary')?.windows || [];
  const empty = windows.filter((w) => Number(w.remainingFraction) <= 0);
  if (probe.ok) {
    return {
      tone: 'success',
      text: `Chat thử ${probe.model} (không system prompt, không tools) THÀNH CÔNG — tài khoản và quota dùng được. Nếu công cụ của bạn vẫn bị 429 thì Google đang từ chối nội dung request của công cụ đó, thường là system prompt nhận diện client khác (Claude Code, OpenCode, Claude Agent SDK…).`,
    };
  }
  if (probe.status === 429) {
    if (empty.length) {
      const resets = empty.map((w) => formatReset(w.resetTime)).filter(Boolean);
      return {
        tone: 'error',
        text: `Hết quota: ${empty.map(windowLabel).join(', ')} còn 0%${
          resets.length ? ` — reset ${resets.join(', ')}` : ''
        }. Chờ reset hoặc dùng model nhóm khác (Gemini ↔ Claude & GPT).`,
      };
    }
    if (windows.length) {
      return {
        tone: 'error',
        text: `Google từ chối cả request tối giản dù quota vẫn còn (${windows
          .map((w) => `${windowLabel(w)} ${pctOf(w.remainingFraction)}%`)
          .join(', ')}). Tài khoản hoặc client đang bị Google hạn chế — code không sửa được, thử tài khoản khác.`,
      };
    }
    return { tone: 'error', text: 'Chat thử bị 429 và không đọc được quota tuần / 5 giờ.' };
  }
  const msg = probe.response?.error?.message || probe.error || '';
  return { tone: 'error', text: `Chat thử lỗi HTTP ${probe.status ?? '—'}${msg ? `: ${msg}` : ''}` };
}

/**
 * Gemini CLI (Cloud Code Assist) sign-in — the same public OAuth client the official
 * `gemini-cli` binary uses. Google accepts a loopback redirect on any port for that client,
 * so a dashboard hosted on Vercel can finish the flow by pasting the callback URL back.
 *
 * This is the path that resolves the account plan/quota without any GCP project or
 * Cloud Billing, because the upstream is `cloudcode-pa.googleapis.com`.
 */
export function GeminiCliSignIn({
  onStart,
  onComplete,
  onDiagnose,
  onRefresh,
  accounts = [],
  variant = 'gemini_cli',
}) {
  const v = VARIANTS[variant] || VARIANTS.gemini_cli;
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
