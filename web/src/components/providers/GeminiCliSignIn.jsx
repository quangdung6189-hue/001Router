import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw, Terminal } from 'lucide-react';
import { CopyButton } from '../CopyButton';

const DEFAULT_CLI_REDIRECT = 'http://127.0.0.1:1455/oauth2callback';

/**
 * Gemini CLI (Cloud Code Assist) sign-in — the same public OAuth client the official
 * `gemini-cli` binary uses. Google accepts a loopback redirect on any port for that client,
 * so a dashboard hosted on Vercel can finish the flow by pasting the callback URL back.
 *
 * This is the path that resolves the account plan/quota without any GCP project or
 * Cloud Billing, because the upstream is `cloudcode-pa.googleapis.com`.
 */
export function GeminiCliSignIn({ onStart, onComplete, onDiagnose }) {
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
        return 'Dùng 127.0.0.1 hoặc localhost — Google chỉ chấp nhận loopback cho client Gemini CLI.';
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
        message: err?.message || 'Không thể bắt đầu đăng nhập Gemini CLI.',
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
        message: 'Kết nối Gemini CLI thành công — đã đọc gói và quota.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Không thể hoàn tất kết nối Gemini CLI.',
      });
    } finally {
      setBusy('');
    }
  };

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
    <div className="space-y-3 rounded-xl border border-[#E56A4A]/40 bg-[#E56A4A]/8 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            Đăng nhập Gemini CLI (Cloud Code Assist)
          </h3>
        </div>
        <span className="rounded-full border border-[#E56A4A]/40 bg-[#E56A4A]/15 px-2 py-0.5 text-[10px] font-semibold text-[#E56A4A]">
          Không cần GCP Project
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        Dùng OAuth client công khai của <strong>Gemini CLI</strong> — cùng client mà 9router dùng.
        Không cần tạo OAuth client riêng, không cần bật Cloud Billing. Server tự gọi{' '}
        <code>loadCodeAssist</code> để lấy project miễn phí và <code>retrieveUserQuota</code> để
        hiện gói.
      </p>

      <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        <li>
          Redirect URI (Google chấp nhận mọi cổng loopback cho client này):
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              spellCheck={false}
              aria-label="Gemini CLI Redirect URI"
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
              className="ml-3 font-semibold text-[#E56A4A] hover:underline"
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
        aria-label="Gemini CLI callback URL"
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
            Chẩn đoán kết nối (xem Google trả về gì)
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
