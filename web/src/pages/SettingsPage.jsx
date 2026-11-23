import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  Flame,
  Globe,
  History,
  KeyRound,
  Layers,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Save,
  Scissors,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Upload,
} from 'lucide-react';
import { catalogApi, securityApi, settingsApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { Switch } from '../components/Switch';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ChangelogModal } from '../components/ChangelogModal';

export function SettingsPage() {
  const toast = useToast();
  const { theme, setTheme, systemScheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const { defaultPassword, setDefaultPassword } = useAuth();

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [timeoutMs, setTimeoutMs] = useState('120000');
  const [tokenSaverEnabled, setTokenSaverEnabled] = useState(true);
  const [tokenSaverMaxChars, setTokenSaverMaxChars] = useState('20000');
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState('full');
  const [requireKey, setRequireKey] = useState(true);
  const [requireLogin, setRequireLogin] = useState(true);
  const [enableTranslator, setEnableTranslator] = useState(true);
  const [fallbackStrategy, setFallbackStrategy] = useState('round-robin');
  const [stickyRoundRobinLimit, setStickyRoundRobinLimit] = useState('3');
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [port, setPort] = useState(20128);

  const [securityStatus, setSecurityStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [catalogAutoSync, setCatalogAutoSync] = useState(true);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [togglingAutoSync, setTogglingAutoSync] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState(null);

  // 3 Secure Export Modes: 'redacted' | 'encrypted' | 'plain'
  const [exportMode, setExportMode] = useState('redacted');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmPwd, setExportConfirmPwd] = useState('');
  const [exporting, setExporting] = useState(false);

  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState('merge');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importError, setImportError] = useState('');
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [res, secRes, syncRes] = await Promise.all([
        settingsApi.get(),
        securityApi.status().catch(() => null),
        catalogApi.syncStatus().catch(() => null),
      ]);
      const s = res?.settings || {};
      setTimeoutMs(String(s.timeoutMs ?? 120000));
      setTokenSaverEnabled(s.tokenSaverEnabled !== false);
      setTokenSaverMaxChars(String(s.tokenSaverMaxChars ?? 20000));
      setCavemanEnabled(Boolean(s.cavemanEnabled));
      setCavemanLevel(
        ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra'].includes(s.cavemanLevel)
          ? s.cavemanLevel
          : 'full'
      );
      setRequireKey(s.requireKey !== false);
      setRequireLogin(s.requireLogin !== false);
      setEnableTranslator(s.enableTranslator !== false);
      setFallbackStrategy(
        ['fill-first', 'round-robin', 'sticky-round-robin'].includes(s.fallbackStrategy)
          ? s.fallbackStrategy
          : 'round-robin'
      );
      setStickyRoundRobinLimit(String(s.stickyRoundRobinLimit ?? 3));
      setPort(s.port || 20128);
      if (syncRes) setSyncStatus(syncRes);
      if (s.catalogAutoSync !== undefined) {
        setCatalogAutoSync(Boolean(s.catalogAutoSync));
      } else if (syncRes?.autoSync !== undefined) {
        setCatalogAutoSync(Boolean(syncRes.autoSync));
      }

      if (secRes) {
        setSecurityStatus(secRes);
        if (typeof secRes.defaultPassword === 'boolean') {
          setDefaultPassword?.(secRes.defaultPassword);
        }
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [toast, setDefaultPassword]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSyncCatalog = async () => {
    setSyncingCatalog(true);
    try {
      const res = await catalogApi.sync();
      const syncRes = await catalogApi.syncStatus().catch(() => null);
      if (syncRes) setSyncStatus(syncRes);
      const total = res?.totalModels ?? res?.total ?? 0;
      const added = res?.addedCount ?? res?.added ?? 0;
      toast.success(
        `Đã đồng bộ ${total} models mới nhất${added > 0 ? ` (+${added} mới)` : ' (đã cập nhật)'}`
      );
    } catch (err) {
      toast.error(err?.message || 'Failed to sync latest models');
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleToggleAutoSync = async (nextVal) => {
    const prev = catalogAutoSync;
    setCatalogAutoSync(nextVal);
    setTogglingAutoSync(true);
    try {
      await settingsApi.update({ catalogAutoSync: nextVal });
      toast.success(
        nextVal ? 'Đã bật tự động đồng bộ mỗi 24h' : 'Đã tạm dừng tự động đồng bộ 24h'
      );
    } catch (err) {
      setCatalogAutoSync(prev);
      toast.error(err?.message || 'Failed to update auto-sync setting');
    } finally {
      setTogglingAutoSync(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const timeoutNum = Number(timeoutMs);
    const maxCharsNum = Number(tokenSaverMaxChars);

    if (!Number.isFinite(timeoutNum) || timeoutNum < 1000) {
      toast.error('Timeout must be at least 1000 ms.');
      return;
    }
    if (!Number.isFinite(maxCharsNum) || maxCharsNum < 500) {
      toast.error('Token Saver Max Chars must be at least 500.');
      return;
    }

    setSavingSettings(true);
    try {
      const stickyLimitNum = Math.max(1, Math.min(100, Number(stickyRoundRobinLimit) || 3));
      const res = await settingsApi.update({
        timeoutMs: Math.round(timeoutNum),
        tokenSaverEnabled,
        tokenSaverMaxChars: Math.round(maxCharsNum),
        cavemanEnabled,
        cavemanLevel,
        requireKey,
        requireLogin,
        enableTranslator,
        fallbackStrategy,
        stickyRoundRobinLimit: Math.round(stickyLimitNum),
      });
      const updated = res?.settings;
      if (updated) {
        setTimeoutMs(String(updated.timeoutMs));
        setTokenSaverEnabled(updated.tokenSaverEnabled !== false);
        setTokenSaverMaxChars(String(updated.tokenSaverMaxChars));
        setCavemanEnabled(Boolean(updated.cavemanEnabled));
        setCavemanLevel(updated.cavemanLevel || 'full');
        setRequireKey(updated.requireKey !== false);
        setRequireLogin(updated.requireLogin !== false);
        setEnableTranslator(updated.enableTranslator !== false);
        setFallbackStrategy(updated.fallbackStrategy || 'round-robin');
        setStickyRoundRobinLimit(String(updated.stickyRoundRobinLimit ?? 3));
      }
      window.dispatchEvent(new Event('001router:settings-updated'));
      toast.success('Gateway settings saved');
    } catch (err) {
      toast.error(err?.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (!currentPassword) {
      setPasswordFeedback({ type: 'error', message: 'Enter your current password.' });
      return;
    }
    if (newPassword.length < 4) {
      setPasswordFeedback({
        type: 'error',
        message: 'New password must be at least 4 characters.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({
        type: 'error',
        message: 'New password and confirmation do not match.',
      });
      return;
    }

    setSavingPassword(true);
    try {
      await settingsApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setDefaultPassword?.(newPassword === '1234');
      setSecurityStatus((prev) =>
        prev ? { ...prev, defaultPassword: newPassword === '1234' } : prev
      );
      setPasswordFeedback({
        type: 'success',
        message: 'Dashboard password updated & session rotated.',
      });
      toast.success('Dashboard password updated');
    } catch (err) {
      setPasswordFeedback({
        type: 'error',
        message: err?.message || 'Failed to update password',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExportDownload = async (e) => {
    e?.preventDefault();
    if (exportMode === 'encrypted' && exportPassphrase.length < 4) {
      toast.error('Enter a passphrase (at least 4 characters) for encrypted export.');
      return;
    }
    if (exportMode === 'plain' && !exportConfirmPwd) {
      toast.error('Confirm your dashboard password to export plaintext API keys.');
      return;
    }

    setExporting(true);
    try {
      const data = await settingsApi.exportConfig({
        secrets: exportMode,
        passphrase: exportPassphrase,
        confirmPassword: exportConfirmPwd,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const day = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `001router-config-${exportMode}-${day}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportConfirmPwd('');
      toast.success(`Exported ${exportMode} configuration JSON`);
    } catch (err) {
      toast.error(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const parsedImport = (() => {
    if (!importText.trim()) return { valid: false, data: null, err: '', isEncrypted: false };
    try {
      const obj = JSON.parse(importText);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { valid: false, data: null, err: 'JSON root must be an object.', isEncrypted: false };
      }
      const isEncrypted = Boolean(obj.encrypted || obj.ciphertext || obj.secrets === 'encrypted');
      return { valid: true, data: obj, err: '', isEncrypted };
    } catch (err) {
      return {
        valid: false,
        data: null,
        err: `Invalid JSON: ${err.message}`,
        isEncrypted: false,
      };
    }
  })();

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      setImportError('');
    } catch {
      setImportError('Failed to read selected file.');
    }
    e.target.value = '';
  };

  const executeImport = async () => {
    if (!parsedImport.valid || !parsedImport.data) return;
    setImporting(true);
    setImportError('');
    try {
      const payload = {
        ...parsedImport.data,
        mode: importMode,
        ...(importPassphrase ? { passphrase: importPassphrase } : {}),
      };
      const res = await settingsApi.importConfig(payload);
      setImportConfirmOpen(false);
      setImportText('');
      setImportPassphrase('');
      await loadSettings();
      const c = res?.counts || {};
      toast.success(
        `Imported (${importMode}): ${c.providers ?? 0} providers, ${c.combos ?? 0} combos, ${
          c.keys ?? 0
        } keys`
      );
    } catch (err) {
      setImportError(err?.message || 'Import failed');
      setImportConfirmOpen(false);
    } finally {
      setImporting(false);
    }
  };

  const handleImportClick = () => {
    if (!parsedImport.valid) {
      setImportError(parsedImport.err || 'Paste or upload valid configuration JSON first.');
      return;
    }
    if (parsedImport.isEncrypted && !importPassphrase) {
      setImportError('This bundle is encrypted. Enter the decryption passphrase.');
      return;
    }
    setImportError('');
    if (importMode === 'replace') {
      setImportConfirmOpen(true);
    } else {
      executeImport();
    }
  };

  const isDefaultPwd = defaultPassword || securityStatus?.defaultPassword === true;
  const lastCatalogSyncLabel = syncStatus?.lastSyncAt
    ? String(syncStatus.lastSyncAt).slice(0, 10)
    : 'v1.2 Live';

  return (
    <div className="space-y-6">
      {/* Default Password Warning Banner (Section 9.8.11) */}
      {isDefaultPwd ? (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3.5 text-xs"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <div>
              <div className="font-semibold text-amber-400">
                Default Dashboard Password (<code>1234</code>) is Active
              </div>
              <p className="mt-0.5 text-[var(--text-secondary)]">
                Your local setup is currently using the initial default password <code>1234</code>.
                We recommend changing it below when you are ready, especially before exposing the
                router beyond <code>127.0.0.1</code>.
              </p>
            </div>
          </div>
          <a
            href="#pwd-current"
            className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-300 hover:bg-amber-500/30"
          >
            Change Password →
          </a>
        </section>
      ) : null}

      {/* Model Catalog Auto-Sync Card */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E56A4A]/15 text-[#E56A4A]">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Đồng bộ danh mục AI Models
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Tự động cập nhật danh sách mô hình AI mới nhất mỗi 24 giờ hoặc đồng bộ thủ công.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSyncCatalog}
            disabled={syncingCatalog || loading}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs shadow-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                syncingCatalog ? 'animate-spin motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {syncingCatalog ? 'Đang đồng bộ…' : 'Đồng bộ ngay (Sync Latest Models)'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span>Cập nhật gần nhất:</span>
              <span className="rounded bg-[var(--bg-card)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                {lastCatalogSyncLabel}
              </span>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                catalogAutoSync
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-400'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-muted)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  catalogAutoSync ? 'bg-emerald-400' : 'bg-[var(--text-muted)]'
                }`}
                aria-hidden="true"
              />
              Auto-Sync Daily (24h): {catalogAutoSync ? 'ON' : 'OFF'}
            </span>
          </div>

          <Switch
            size="sm"
            checked={catalogAutoSync}
            disabled={togglingAutoSync}
            onChange={handleToggleAutoSync}
            aria-label="Toggle Daily Auto-Sync (24h)"
          />
        </div>
      </section>

      {/* Appearance, Language, Pricing & Changelog */}
      <section className="r-card space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('settings.appearance')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/settings/pricing"
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <DollarSign className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              Pricing Settings ($/1M) →
            </Link>
            <button
              type="button"
              onClick={() => setChangelogOpen(true)}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <History className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
              Changelog (v2.0.0)
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Theme Mode</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'dark', label: t('settings.themeDark'), icon: Moon },
                { id: 'light', label: t('settings.themeLight'), icon: Sun },
                {
                  id: 'system',
                  label: `${t('settings.themeSystem')} (${systemScheme})`,
                  icon: Monitor,
                },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    theme === id
                      ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Language</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'vi', label: 'Tiếng Việt' },
                { id: 'en', label: 'English' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLocale(opt.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    locale === opt.id
                      ? 'border-[#E56A4A] bg-[#E56A4A]/14 text-[#E56A4A]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Gateway, RTK & Caveman Settings */}
        <section className="r-card p-5">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Gateway, RTK &amp; Caveman Mode
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Runtime routing parameters persisted locally.
              </p>
            </div>
            <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1 font-mono text-xs text-[var(--text-secondary)]">
              Port {port}
            </span>
          </div>

          <form onSubmit={handleSaveSettings} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="set-timeout"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Upstream Request Timeout (ms)
              </label>
              <input
                id="set-timeout"
                type="number"
                min={1000}
                max={600000}
                step={500}
                required
                disabled={loading}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="r-card-subtle space-y-3 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    <Scissors className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                    RTK Input Token Saver (−20–40%)
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Normalizes whitespace, deduplicates repeated lines, and truncates oversized
                    tool outputs before forwarding.
                  </p>
                </div>
                <Switch
                  checked={tokenSaverEnabled}
                  onChange={setTokenSaverEnabled}
                  disabled={loading}
                  aria-label="Enable RTK Token Saver"
                />
              </div>

              <div>
                <label
                  htmlFor="set-maxchars"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Token Saver Max Chars
                </label>
                <input
                  id="set-maxchars"
                  type="number"
                  min={500}
                  max={500000}
                  step={500}
                  required
                  disabled={loading || !tokenSaverEnabled}
                  value={tokenSaverMaxChars}
                  onChange={(e) => setTokenSaverMaxChars(e.target.value)}
                  className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm disabled:opacity-50"
                />
              </div>
            </div>

            <div className="r-card-subtle space-y-3 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    <Flame className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                    Caveman Mode (Output Token Saver −65%)
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Prepends a terse-style system directive so LLM replies stay technical and compact.
                  </p>
                </div>
                <Switch
                  checked={cavemanEnabled}
                  onChange={setCavemanEnabled}
                  disabled={loading}
                  aria-label="Enable Caveman Mode"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {['lite', 'full', 'ultra'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setCavemanLevel(lvl)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold uppercase transition-colors ${
                      cavemanLevel === lvl
                        ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="r-card-subtle space-y-3 p-3.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <Layers className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                Multi-Key Routing Strategy
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Controls how 001Router distributes requests across multiple API keys on the same
                provider.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'round-robin', label: 'Round Robin' },
                  { id: 'fill-first', label: 'Fill First' },
                  { id: 'sticky-round-robin', label: 'Sticky RR' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFallbackStrategy(opt.id)}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                      fallbackStrategy === opt.id
                        ? 'border-[#E56A4A] bg-[#E56A4A]/15 text-[#E56A4A]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {fallbackStrategy === 'sticky-round-robin' ? (
                <div>
                  <label
                    htmlFor="set-sticky-limit"
                    className="block text-xs font-medium text-[var(--text-secondary)]"
                  >
                    Requests per key before rotating
                  </label>
                  <input
                    id="set-sticky-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={stickyRoundRobinLimit}
                    onChange={(e) => setStickyRoundRobinLimit(e.target.value)}
                    className="field-input mt-1 w-28 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
              ) : null}
            </div>

            <div className="r-card-subtle space-y-3 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    <ArrowLeftRight className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    Enable Translator Debug Tab
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Show or hide the OpenAI ⇄ Anthropic Payload Translator in the sidebar.
                  </p>
                </div>
                <Switch
                  checked={enableTranslator}
                  onChange={setEnableTranslator}
                  disabled={loading}
                  aria-label="Enable Translator tab"
                />
              </div>

              <div className="flex items-start justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Require Dashboard Login (Localhost Only)
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Disable only for trusted local-only dev machines on <code>127.0.0.1</code>.
                    Always enforced on LAN/external binds.
                  </p>
                </div>
                <Switch
                  checked={requireLogin}
                  onChange={setRequireLogin}
                  disabled={loading}
                  aria-label="Require Dashboard Login"
                />
              </div>
            </div>

            <div className="r-card-subtle p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Require Router API Key on <code>/v1/*</code>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Clients must present an active <code>sk-001r-...</code> key via Bearer or{' '}
                    <code>x-api-key</code>.
                  </p>
                </div>
                <Switch
                  checked={requireKey}
                  onChange={setRequireKey}
                  disabled={loading}
                  aria-label="Require Router API Key"
                />
              </div>
              {!requireKey ? (
                <p className="mt-2 rounded bg-amber-500/12 px-2.5 py-1.5 text-[11px] text-amber-500">
                  Warning: Local callers on this machine can hit <code>/v1/*</code> without a key.
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading || savingSettings}
              className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {savingSettings ? t('common.saving') : t('common.save')}
            </button>
          </form>
        </section>

        {/* Change Dashboard Password */}
        <section className="r-card p-5">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Dashboard Password
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Update the bcrypt-hashed (cost ≥ 10) password used for <code>/login</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPasswords((s) => !s)}
              className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
            >
              {showPasswords ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Hide
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Show
                </>
              )}
            </button>
          </div>

          {passwordFeedback ? (
            <div
              role="alert"
              className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                passwordFeedback.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-red-500/40 bg-red-500/10 text-red-500'
              }`}
            >
              {passwordFeedback.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>{passwordFeedback.message}</span>
            </div>
          ) : null}

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div className="field-group">
              <label
                htmlFor="pwd-current"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Current Password
              </label>
              <input
                id="pwd-current"
                name="currentPassword"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="field-input mt-1.5 w-full px-3 py-2 text-sm"
              />
            </div>

            <div className="field-group">
              <label
                htmlFor="pwd-new"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                New Password (min 4 chars)
              </label>
              <input
                id="pwd-new"
                name="newPassword"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={4}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="field-input mt-1.5 w-full px-3 py-2 text-sm"
              />
            </div>

            <div className="field-group">
              <label
                htmlFor="pwd-confirm"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Confirm New Password
              </label>
              <input
                id="pwd-confirm"
                name="confirmPassword"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={4}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="field-input mt-1.5 w-full px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="r-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-xs"
            >
              <Lock className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
              {savingPassword ? t('common.saving') : 'Update Password'}
            </button>
          </form>
        </section>
      </div>

      {/* Backup & Restore (3 Secure Export Modes — Section 9.8.8) */}
      <section className="r-card space-y-5 p-5">
        <div className="border-b border-[var(--border-subtle)] pb-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Backup &amp; Restore (3 Secure Export Modes)
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Migrate providers, combos, proxy pools, and settings safely between machines.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Export Panel with 3 Modes */}
          <form
            onSubmit={handleExportDownload}
            className="r-card-subtle flex flex-col justify-between space-y-4 p-4"
          >
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Export Configuration JSON
              </h3>

              <div className="space-y-2">
                {[
                  {
                    id: 'redacted',
                    title: 'Redacted (Safe Default — Hides All API Keys)',
                    desc: 'Replaces all secrets with "***redacted***". Safe to share or commit to Git.',
                    icon: ShieldCheck,
                    tone: 'text-emerald-400',
                  },
                  {
                    id: 'encrypted',
                    title: 'Encrypted (Passphrase Protected)',
                    desc: 'Protects upstream API keys with your custom passphrase for migration.',
                    icon: Lock,
                    tone: 'text-sky-400',
                  },
                  {
                    id: 'plain',
                    title: 'Plaintext (Requires Dashboard Password Confirmation)',
                    desc: 'Warning: Exports unmasked upstream API keys. Keep strictly private!',
                    icon: ShieldAlert,
                    tone: 'text-amber-400',
                  },
                ].map((m) => {
                  const Icon = m.icon;
                  const active = exportMode === m.id;
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                        active
                          ? 'border-[#E56A4A] bg-[#E56A4A]/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-card)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="export-mode"
                        value={m.id}
                        checked={active}
                        onChange={() => setExportMode(m.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                          <Icon className={`h-3.5 w-3.5 ${m.tone}`} aria-hidden="true" />
                          {m.title}
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{m.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {exportMode === 'encrypted' ? (
                <div>
                  <label
                    htmlFor="export-passphrase"
                    className="block text-xs font-medium text-[var(--text-secondary)]"
                  >
                    Encryption Passphrase
                  </label>
                  <input
                    id="export-passphrase"
                    type="password"
                    required
                    minLength={4}
                    value={exportPassphrase}
                    onChange={(e) => setExportPassphrase(e.target.value)}
                    placeholder="Enter passphrase to encrypt bundle…"
                    className="field-input mt-1.5 w-full px-3 py-2 text-xs"
                  />
                </div>
              ) : null}

              {exportMode === 'plain' ? (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <div className="font-semibold text-amber-400">
                    Security Warning: Plaintext Upstream API Keys Included
                  </div>
                  <label
                    htmlFor="export-confirm-pwd"
                    className="block text-[11px] text-[var(--text-secondary)]"
                  >
                    Enter your current Dashboard Password (sent via <code>X-Confirm-Password</code>):
                  </label>
                  <input
                    id="export-confirm-pwd"
                    type="password"
                    required
                    value={exportConfirmPwd}
                    onChange={(e) => setExportConfirmPwd(e.target.value)}
                    placeholder="Confirm dashboard password…"
                    className="field-input w-full px-3 py-1.5 text-xs"
                  />
                </div>
              ) : null}
            </div>

            <div>
              <button
                type="submit"
                disabled={exporting}
                className="r-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {exporting ? 'Exporting…' : `Export (${exportMode.toUpperCase()}) JSON`}
              </button>
            </div>
          </form>

          {/* Import Panel */}
          <div className="r-card-subtle space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Import Configuration
              </h3>
              <label className="r-btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-xs">
                <Upload className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                Choose .json file
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>
                  <strong className="text-[var(--text-primary)]">Merge</strong>{' '}
                  <span className="text-[var(--text-muted)]">(keep existing keys)</span>
                </span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                <span>
                  <strong className="text-red-500">Replace</strong>{' '}
                  <span className="text-[var(--text-muted)]">(overwrite)</span>
                </span>
              </label>
            </div>

            <textarea
              rows={5}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError('');
              }}
              placeholder='Paste exported 001Router JSON (Redacted, Encrypted, or Plaintext) here…'
              aria-label="Configuration JSON to import"
              className="field-input w-full px-3 py-2 font-mono text-xs"
            />

            {parsedImport.isEncrypted ? (
              <div>
                <label
                  htmlFor="import-passphrase"
                  className="block text-xs font-medium text-sky-400"
                >
                  Encrypted Bundle Detected — Enter Decryption Passphrase:
                </label>
                <input
                  id="import-passphrase"
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="Enter passphrase used during export…"
                  className="field-input mt-1 w-full px-3 py-1.5 text-xs"
                />
              </div>
            ) : null}

            {parsedImport.valid ? (
              <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                {parsedImport.isEncrypted
                  ? 'Encrypted bundle ready to decrypt & import'
                  : `Ready (${importMode}): ${
                      Array.isArray(parsedImport.data.providers)
                        ? parsedImport.data.providers.length
                        : 0
                    } providers, ${
                      Array.isArray(parsedImport.data.combos) ? parsedImport.data.combos.length : 0
                    } combos, ${
                      Array.isArray(parsedImport.data.keys) ? parsedImport.data.keys.length : 0
                    } keys`}
              </div>
            ) : importText.trim() && parsedImport.err ? (
              <p className="text-xs text-red-500">{parsedImport.err}</p>
            ) : null}

            {importError ? <p className="text-xs text-red-500">{importError}</p> : null}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={importing || !parsedImport.valid}
                onClick={handleImportClick}
                className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {importing ? 'Importing…' : `Import (${importMode})`}
              </button>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={importConfirmOpen}
        onClose={() => setImportConfirmOpen(false)}
        onConfirm={executeImport}
        title="Replace Entire Configuration?"
        destructive
        busy={importing}
        confirmLabel="Overwrite & Import"
        message={
          <p>
            Replace mode will overwrite your existing providers, combos, router keys, and settings.
          </p>
        }
      />

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
