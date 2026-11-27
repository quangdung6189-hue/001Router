import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Lock,
  Moon,
  Sun,
  Terminal,
  Waypoints,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';

export function LoginPage() {
  const { authenticated, loading, login } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [retryAfterSec, setRetryAfterSec] = useState(0);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const inputRef = useRef(null);

  const from = location.state?.from && location.state.from !== '/login' ? location.state.from : '/';
  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  useEffect(() => {
    if (!loading && !authenticated) {
      inputRef.current?.focus();
    }
  }, [loading, authenticated]);

  useEffect(() => {
    if (retryAfterSec <= 0) return;
    const timer = setInterval(() => {
      setRetryAfterSec((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfterSec]);

  if (!loading && authenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (retryAfterSec > 0) return;
    const el = inputRef.current;
    if (el && !el.validity.valid) {
      setTouchedInvalid(true);
      el.focus();
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await login(password);
      navigate(from, { replace: true });
    } catch (err) {
      const waitSec = Number(err?.data?.retryAfterSec || err?.data?.retryAfter || 0);
      if (waitSec > 0) {
        setRetryAfterSec(waitSec);
      }
      setError(err?.message || 'Invalid password');
      setSubmitting(false);
    }
  };

  const handleBlur = () => {
    const el = inputRef.current;
    if (el && !CSS.supports?.('selector(:user-invalid)')) {
      setTouchedInvalid(!el.validity.valid);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-[var(--bg-canvas)] px-4 py-10 text-[var(--text-primary)]">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleLocale}
          className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {locale === 'vi' ? 'Tiếng Việt' : 'English'}
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={resolvedTheme === 'dark' ? t('common.switchLight') : t('common.switchDark')}
          className="r-btn-secondary flex h-8 w-8 items-center justify-center p-0"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-slate-700" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="r-card w-full max-w-sm p-6 shadow-xl sm:p-7">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
            <Waypoints className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            001Router
          </h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t('login.subtitle') || 'Enter your password to access the dashboard'}
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-400"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {error}
              {retryAfterSec > 0 ? ` (${retryAfterSec}s)` : ''}
            </span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="field-group">
            <label
              htmlFor="dashboard-password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              {t('login.passwordLabel')}
            </label>
            {isLocalHost ? (
              <p id="password-hint" className="mt-1 text-[11px] text-[var(--text-muted)]">
                {t('login.hint')}{' '}
                <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-primary)]">
                  1234
                </code>
                .
              </p>
            ) : null}
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </span>
              <input
                ref={inputRef}
                id="dashboard-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (touchedInvalid && e.target.validity.valid) setTouchedInvalid(false);
                }}
                onBlur={handleBlur}
                autoComplete="current-password"
                spellCheck={false}
                enterKeyHint="go"
                required
                aria-describedby={isLocalHost ? 'password-hint' : undefined}
                placeholder={t('login.placeholder')}
                className={`field-input w-full py-2.5 pr-10 pl-9 text-sm ${
                  touchedInvalid ? 'user-invalid-fallback' : ''
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-1.5 my-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <div id="password-error" className="error-msg">
              <span role="img" aria-label="Error">
                !
              </span>
              {t('login.requiredError')}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || retryAfterSec > 0}
            className="r-btn-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold"
          >
            {retryAfterSec > 0
              ? `Try again in ${retryAfterSec}s`
              : submitting
                ? t('login.submitting')
                : t('login.submit')}
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3.5">
          {isLocalHost ? (
            <div>
              <button
                type="button"
                onClick={() => setShowResetHelp((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Forgot password?
              </button>
              {showResetHelp ? (
                <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5 text-[11px] text-[var(--text-secondary)]">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                    <Terminal className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                    Reset from local terminal
                  </div>
                  <p className="mt-1">
                    Run <code className="font-mono text-[var(--text-primary)]">node cli/index.js</code>{' '}
                    on this machine and choose{' '}
                    <strong className="text-[var(--text-primary)]">
                      Settings -&gt; Reset Password
                    </strong>
                    .
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <Link
            to="/landing"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/70 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[#E56A4A]/50 hover:text-[#E56A4A]"
          >
            <span>{t('login.explore')}</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
