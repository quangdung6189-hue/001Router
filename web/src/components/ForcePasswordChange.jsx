import { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { settingsApi } from '../lib/api';

const MIN_LEN = 8;

/**
 * Shown instead of the dashboard while the shipped default password ('1234') is still active and the server
 * enforces replacing it. Every other /api route answers 403 PASSWORD_CHANGE_REQUIRED until this succeeds.
 */
export function ForcePasswordChange() {
  const { setDefaultPassword, setPasswordChangeRequired, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) return setError('Enter the current (default) password.');
    if (newPassword.length < MIN_LEN) return setError(`New password must be at least ${MIN_LEN} characters.`);
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      await settingsApi.changePassword(currentPassword, newPassword);
      setDefaultPassword(false);
      setPasswordChangeRequired(false);
    } catch (err) {
      setError(err?.message || 'Failed to change password.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#E56A4A]';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg-main)] px-4 text-[var(--text-primary)]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card,transparent)] p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-[#E56A4A]" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Set a new dashboard password</h1>
        </div>
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            You are still using the default password. For security you must choose a new one (at least {MIN_LEN}{' '}
            characters, not a common password) before continuing.
          </span>
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-secondary)]">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            className={inputClass}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-secondary)]">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_LEN}
            className={inputClass}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-secondary)]">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_LEN}
            className={inputClass}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={logout}
            className="text-sm text-[var(--text-secondary)] hover:underline"
          >
            Sign out
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[#E56A4A] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}
