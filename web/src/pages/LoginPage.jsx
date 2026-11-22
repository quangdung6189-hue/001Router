import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
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
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const inputRef = useRef(null);

  const from = location.state?.from && location.state.from !== '/login' ? location.state.from : '/';

  useEffect(() => {
    if (!loading && !authenticated) {
      inputRef.current?.focus();
    }
  }, [loading, authenticated]);

  if (!loading && authenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <div className="landing-grid relative flex min-h-dvh flex-col items-center justify-center px-4 py-10 text-[var(--text-primary)]">
      {/* Top-right Quick Language & Theme Controls */}
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

      <div className="r-card w-full max-w-md p-6 shadow-2xl sm:p-8">
        <div className="mb-4 flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
            <Waypoints className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              001Router
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">{t('login.subtitle')}</p>
          </div>
        </div>

        <p className="mt-5 text-sm text-[var(--text-secondary)]">{t('login.desc')}</p>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-500"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div className="field-group">
            <label
              htmlFor="dashboard-password"
              className="block text-sm font-medium text-[var(--text-primary)]"
            >
              {t('login.passwordLabel')}
            </label>
            <p id="password-hint" className="mt-1 text-xs text-[var(--text-muted)]">
              {t('login.hint')}{' '}
              <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-primary)]">
                1234
              </code>
              .
            </p>
            <div className="relative mt-2">
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
                aria-describedby="password-hint"
                placeholder={t('login.placeholder')}
                className={`field-input w-full py-2.5 pr-11 pl-9 text-sm ${
                  touchedInvalid ? 'user-invalid-fallback' : ''
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-1.5 my-auto flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
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
            disabled={submitting}
            className="r-btn-primary flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            {submitting ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
            <span>{t('login.footer')}</span>
          </div>
          <Link
            to="/landing"
            className="inline-flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-2 font-medium text-[var(--text-primary)] transition-colors hover:border-[#E56A4A]/50 hover:text-[#E56A4A]"
          >
            <span>Explore 001Router Features, 47+ Providers &amp; 9 Service Kinds</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
