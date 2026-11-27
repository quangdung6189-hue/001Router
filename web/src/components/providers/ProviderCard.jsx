import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { ProviderLogo } from '../ProviderLogo';
import { Switch } from '../Switch';
import {
  getGoogleOAuthMeta,
  getKeyAuthKind,
} from './providerAuth';

function ProviderCardBase({
  presetObj,
  configuredProv,
  catalogCount = 0,
  testResult = null,
  nowMs = 0,
  onOpen,
  onToggleEnabled,
}) {
  const { t } = useLocale();
  const isConnected = Boolean(configuredProv);
  const isEnabled = configuredProv ? configuredProv.enabled !== false : true;
  const keys = configuredProv?.apiKeys || [];
  const activeKeyCount = keys.filter((k) => k.enabled !== false).length;
  const googleOAuthKey = keys.find((k) => getKeyAuthKind(k) === 'google_oauth') || null;
  const googleOAuthMeta = googleOAuthKey ? getGoogleOAuthMeta(googleOAuthKey) : null;
  const planKey = !googleOAuthMeta
    ? keys.find((k) => k.enabled !== false && k.oauthMeta?.tierLabel) || null
    : null;
  const planLabel = planKey ? String(planKey.oauthMeta.tierLabel).split(' · ')[0] : '';

  const coolingKeys = keys.filter((k) => k.cooldownUntil && k.cooldownUntil > nowMs);
  const maxCooldownSec = coolingKeys.length
    ? Math.max(...coolingKeys.map((k) => Math.ceil((k.cooldownUntil - nowMs) / 1000)))
    : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(presetObj, configuredProv)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(presetObj, configuredProv);
        }
      }}
      className={`group relative flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 [contain-intrinsic-size:auto_60px] [content-visibility:auto] transition-[border-color,background-color,opacity] duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#E56A4A] ${
        isConnected
          ? 'border-[var(--border-strong)] bg-[var(--bg-card)] hover:border-[#E56A4A]/65'
          : 'border-[var(--border-subtle)] bg-[var(--bg-card)]/90 hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]'
      } ${isConnected && !isEnabled ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderLogo
          preset={presetObj.preset}
          logo={presetObj.logo}
          logoExt={presetObj.logoExt}
          name={configuredProv?.name || presetObj.name}
          color={presetObj.color}
          monogram={presetObj.monogram}
          size={32}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {configuredProv?.name || presetObj.name}
            </span>

            {isConnected ? (
              <div
                className="flex h-5 shrink-0 items-center opacity-90 transition-opacity group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Switch
                  size="sm"
                  checked={isEnabled}
                  onChange={(val) => onToggleEnabled(configuredProv, val)}
                  aria-label={`Toggle ${configuredProv.name}`}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {isConnected ? (
              !isEnabled ? (
                <span className="text-[var(--text-muted)]">{t('common.disabled')}</span>
              ) : coolingKeys.length > 0 ? (
                <span className="font-medium text-amber-400">429 ({maxCooldownSec}s)</span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {presetObj.keyOptional && activeKeyCount === 0
                    ? `1 ${t('common.connected')}`
                    : `${Math.max(1, activeKeyCount)} ${t('common.connected')}`}
                </span>
              )
            ) : (
              <span className="text-[var(--text-muted)]">
                {presetObj.badge || `${catalogCount} models`}
              </span>
            )}

            {isConnected && (planLabel || googleOAuthMeta?.tierLabel) ? (
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                {planLabel || String(googleOAuthMeta.tierLabel).split(' · ')[0]}
              </span>
            ) : null}

            {testResult ? (
              <span
                className={`rounded px-1.5 py-0.2 font-mono text-[10px] ${
                  testResult.ok
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {testResult.ok ? `${testResult.latencyMs}ms` : `ERR ${testResult.status || ''}`}
              </span>
            ) : null}

            {isConnected ? (
              <Link
                to={`/providers/${encodeURIComponent(configuredProv.id)}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={`Manage ${configuredProv.name} details`}
                className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#E56A4A] focus-visible:opacity-100"
              >
                Details
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ProviderCard = memo(ProviderCardBase);

export default ProviderCard;
