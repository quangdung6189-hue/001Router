import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cpu, FileJson2, KeyRound, ShieldCheck } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { ProviderLogo } from '../ProviderLogo';
import { Switch } from '../Switch';
import { GoogleMark } from './GoogleMark';
import {
  getGoogleOAuthMeta,
  getGoogleTierDotClass,
  getGoogleTierPillClass,
  getKeyAuthKind,
} from './providerAuth';

// Colour-code the preset badge ("Free Tier", "$0.60/1M", "Coding Plan", "Device Auth"…)
// so users can scan the grid by meaning instead of reading every pill.
// Full class strings are listed literally so Tailwind can see them at build time.
const BADGE_TONES = {
  free: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-500',
  price: 'border-amber-500/30 bg-amber-500/12 text-amber-500',
  coding: 'border-violet-500/30 bg-violet-500/12 text-violet-400',
  auth: 'border-orange-500/30 bg-orange-500/12 text-orange-400',
  local: 'border-sky-500/30 bg-sky-500/12 text-sky-400',
  neutral: 'border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
};

function getBadgeToneClass(badge) {
  const label = String(badge || '').toLowerCase();
  if (/free/.test(label)) return BADGE_TONES.free;
  if (/\$|\/1m/.test(label)) return BADGE_TONES.price;
  if (/coding|plan|gateway|coder/.test(label)) return BADGE_TONES.coding;
  if (/auth|oauth|pat|device/.test(label)) return BADGE_TONES.auth;
  if (/local/.test(label)) return BADGE_TONES.local;
  return BADGE_TONES.neutral;
}

/**
 * One provider tile in the providers grid.
 *
 * Memoised on purpose: the grid holds 100+ tiles and the page ticks every second while a key is
 * cooling down. The parent therefore passes `nowMs = 0` to tiles without cooldown keys and stable
 * `onOpen` / `onToggleEnabled` callbacks, so only tiles whose own data changed re-render.
 */
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
  const hasServiceAccount = keys.some((k) => getKeyAuthKind(k) === 'service_account');
  const hasOAuthPkce = keys.some((k) => getKeyAuthKind(k) === 'oauth_pkce');
  const hasOAuth2 = keys.some((k) => getKeyAuthKind(k) === 'oauth2');
  const hasDeviceCode = keys.some((k) => getKeyAuthKind(k) === 'device_code');
  const googleOAuthKey = keys.find((k) => getKeyAuthKind(k) === 'google_oauth') || null;
  const googleOAuthMeta = googleOAuthKey ? getGoogleOAuthMeta(googleOAuthKey) : null;
  const coolingKeys = keys.filter((k) => k.cooldownUntil && k.cooldownUntil > nowMs);
  const maxCooldownSec = coolingKeys.length
    ? Math.max(...coolingKeys.map((k) => Math.ceil((k.cooldownUntil - nowMs) / 1000)))
    : 0;
  const statusLabel = !isConnected
    ? t('common.noConnections')
    : !isEnabled
      ? t('common.disabled')
      : coolingKeys.length > 0
        ? `429 (${maxCooldownSec}s)`
        : t('common.connected');

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
      // content-visibility keeps off-screen cards out of layout/paint (the grid holds 100+ cards);
      // the focus outline is inset so paint containment never clips it.
      className={`group relative flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 [contain-intrinsic-size:auto_68px] [content-visibility:auto] transition-[border-color,background-color,opacity] duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#E56A4A] ${
        isConnected
          ? 'border-[var(--border-strong)] bg-[var(--bg-card)] shadow-[inset_3px_0_0_0_rgba(16,185,129,0.65)] hover:border-[#E56A4A]/70'
          : 'border-[var(--border-subtle)] bg-[var(--bg-card)]/90 hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]'
      } ${isConnected && !isEnabled ? 'opacity-60 shadow-none' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Logo tile + status dot (replaces the repeated "No connections" text) */}
        <span className="relative shrink-0">
          <ProviderLogo
            preset={presetObj.preset}
            logo={presetObj.logo}
            logoExt={presetObj.logoExt}
            name={configuredProv?.name || presetObj.name}
            color={presetObj.color}
            monogram={presetObj.monogram}
            size={44}
          />
          <span
            role="img"
            title={statusLabel}
            aria-label={statusLabel}
            className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-card)] ${
              !isConnected
                ? 'bg-[var(--border-strong)]'
                : !isEnabled
                  ? 'bg-[var(--text-muted)]'
                  : coolingKeys.length > 0
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
            }`}
          />
        </span>

        <div className="min-w-0 flex-1">
          {/* Name gets the full row so long names are no longer squeezed by the badge */}
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13.5px] leading-5 font-semibold text-[var(--text-primary)]">
              {configuredProv?.name || presetObj.name}
            </span>
            {/* Quick enable/disable lives on the name row so it never forces the card taller */}
            {isConnected ? (
              <div
                className="flex h-5 shrink-0 items-center"
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

          <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px]">
            {presetObj.badge && !isConnected ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] leading-4 font-semibold ${getBadgeToneClass(presetObj.badge)}`}
              >
                {presetObj.badge}
              </span>
            ) : null}

            {isConnected ? (
              !isEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-muted)]">
                  {t('common.disabled')}
                </span>
              ) : coolingKeys.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  429 ({maxCooldownSec}s)
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {presetObj.keyOptional && activeKeyCount === 0
                    ? `1 ${t('common.connected')}`
                    : `${Math.max(1, activeKeyCount)} ${t('common.connected')}`}
                </span>
              )
            ) : null}

            {catalogCount > 0 ? (
              <span
                title={`${catalogCount} ${t('common.models')}`}
                className="inline-flex shrink-0 items-center gap-1 text-[10.5px] whitespace-nowrap text-[var(--text-muted)] tabular-nums"
              >
                <Cpu className="h-3 w-3" aria-hidden="true" />
                {catalogCount} {t('common.models')}
              </span>
            ) : null}

            {isConnected && hasServiceAccount ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-sky-500">
                <FileJson2 className="h-2.5 w-2.5" aria-hidden="true" />
                {t('providers.badge.serviceAccount')}
              </span>
            ) : null}

            {isConnected && hasOAuthPkce ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/35 bg-indigo-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-indigo-500">
                <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                {t('providers.badge.oauthPkce')}
              </span>
            ) : null}

            {isConnected && hasOAuth2 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-violet-400">
                <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                {t('providers.badge.oauth2')}
              </span>
            ) : null}

            {isConnected && hasDeviceCode ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/35 bg-orange-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-orange-400">
                <KeyRound className="h-2.5 w-2.5" aria-hidden="true" />
                {t('providers.badge.deviceCode')}
              </span>
            ) : null}

            {isConnected && googleOAuthMeta ? (
              <>
                <span
                  title={
                    googleOAuthMeta.email
                      ? `${googleOAuthMeta.email} · ${googleOAuthMeta.tierLabel}`
                      : googleOAuthMeta.tierLabel
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-blue-500/35 bg-blue-500/12 px-1.5 py-0.2 text-[9.5px] font-semibold text-blue-500"
                >
                  <GoogleMark className="h-2.5 w-2.5 shrink-0" />
                  {t('providers.badge.googleOAuth')}
                </span>
                <span
                  title={
                    googleOAuthMeta.email
                      ? `${googleOAuthMeta.email} — ${googleOAuthMeta.tierLabel}`
                      : googleOAuthMeta.tierLabel
                  }
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[9.5px] font-semibold ${getGoogleTierPillClass(
                    googleOAuthMeta
                  )}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${getGoogleTierDotClass(googleOAuthMeta)}`}
                    aria-hidden="true"
                  />
                  {googleOAuthMeta.billingActive
                    ? t('providers.badge.payAsYouGo')
                    : googleOAuthMeta.isFreeTier
                      ? t('providers.badge.freeTier')
                      : t('providers.badge.googleConnected')}
                </span>
              </>
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
                title="Manage keys, cooldowns, aliases & models"
                aria-label={`Manage ${configuredProv.name} details`}
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[#E56A4A]/12 hover:text-[#E56A4A]"
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
