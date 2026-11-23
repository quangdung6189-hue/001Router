// Pure helpers that classify a stored provider key (API key / OAuth / service account …)
// and derive Google OAuth tier info. Shared by the providers grid and the connect modal.

export function getKeyAuthKind(keyEntry) {
  if (!keyEntry || typeof keyEntry !== 'object') return 'api';
  const rawType = String(
    keyEntry.authMethod ||
      keyEntry.authType ||
      keyEntry.authMode ||
      keyEntry.type ||
      keyEntry.source ||
      ''
  ).toLowerCase();
  if (
    rawType.includes('service_account') ||
    rawType.includes('service-account') ||
    rawType === 'vertex_sa' ||
    Boolean(
      keyEntry.serviceAccountMeta?.clientEmail ||
        keyEntry.clientEmail ||
        keyEntry.serviceAccount?.clientEmail ||
        keyEntry.meta?.clientEmail
    )
  ) {
    return 'service_account';
  }
  if (
    rawType === 'device_code' ||
    keyEntry.oauthMeta?.flow === 'device_code' ||
    keyEntry.oauthMeta?.provider === 'kilocode'
  ) {
    return 'device_code';
  }
  // Gemini CLI / Cloud Code Assist accounts are Google OAuth, but surfaced as their own kind so
  // the UI can show the Cloud Code quota buckets instead of the AI Studio free/paid tier.
  // Antigravity keys use the same Cloud Code wire format, so they share the Gemini CLI display.
  if (
    rawType === 'gemini_cli' ||
    rawType === 'antigravity' ||
    keyEntry.oauthMeta?.flow === 'gemini_cli' ||
    keyEntry.oauthMeta?.flow === 'antigravity'
  ) {
    return 'gemini_cli';
  }
  if (
    rawType === 'google_oauth' ||
    rawType === 'google-oauth' ||
    rawType.includes('google_oauth') ||
    String(keyEntry.oauthProvider || '').toLowerCase() === 'google' ||
    keyEntry.oauthMeta?.provider === 'google' ||
    (!rawType.includes('oauth2') &&
      !rawType.includes('device') &&
      Boolean(keyEntry.oauthMeta?.tierLabel || keyEntry.oauthMeta?.tier))
  ) {
    return 'google_oauth';
  }
  if (rawType === 'oauth2') {
    return 'oauth2';
  }
  if (
    rawType.includes('oauth') ||
    rawType.includes('pkce') ||
    Boolean(keyEntry.oauthProvider) ||
    /oauth\s*pkce/i.test(String(keyEntry.label || ''))
  ) {
    return 'oauth_pkce';
  }
  return 'api';
}

export function getGoogleOAuthMeta(keyEntry, overrideMeta = null) {
  const baseMeta =
    (keyEntry && typeof keyEntry === 'object' && (keyEntry.oauthMeta || keyEntry.meta)) || {};
  const extra = overrideMeta && typeof overrideMeta === 'object' ? overrideMeta : {};
  const meta = { ...baseMeta, ...extra };

  const email = String(meta.email || keyEntry?.email || '').trim();
  const name = String(meta.name || keyEntry?.accountName || '').trim();
  const projectId = String(meta.projectId || meta.project_id || keyEntry?.projectId || '').trim();
  const tier = String(meta.tier || meta.planTier || '').toLowerCase();
  const rawTierLabel = String(meta.tierLabel || meta.planLabel || '').trim();

  const billingActive =
    meta.billingActive === true ||
    meta.billingEnabled === true ||
    tier.includes('pay') ||
    tier.includes('paid') ||
    tier.includes('billing') ||
    /pay-as-you-go|billing\s*active/i.test(rawTierLabel);

  const isFreeTier =
    !billingActive &&
    (tier.includes('free') || /free\s*tier/i.test(rawTierLabel));

  const tierLabel =
    rawTierLabel ||
    (billingActive
      ? 'Pay-as-you-go (Cloud Billing Active)'
      : isFreeTier
        ? 'Gemini API Free Tier'
        : 'Gemini API · Google Account Connected');

  const shortTierLabel = billingActive
    ? 'Pay-as-you-go'
    : isFreeTier
      ? 'Free Tier'
      : 'Connected';

  const modelsCount =
    typeof meta.modelsCount === 'number' && Number.isFinite(meta.modelsCount)
      ? meta.modelsCount
      : Array.isArray(meta.models)
        ? meta.models.length
        : null;

  const topModels = Array.isArray(meta.topModels)
    ? meta.topModels.filter((m) => typeof m === 'string' && m.trim())
    : [];

  const quotaSummary =
    meta.quotaSummary && typeof meta.quotaSummary === 'object'
      ? meta.quotaSummary
      : Array.isArray(meta.quotaBuckets) && meta.quotaBuckets.length > 0
        ? {
            label: 'Cloud Code Assist',
            rpmEstimate: `${meta.quotaBuckets.length} model buckets`,
            rpdEstimate: `${Math.round(
              (meta.quotaBuckets.reduce((sum, b) => sum + (Number(b?.remainingFraction) || 0), 0) /
                meta.quotaBuckets.length) *
                100
            )}% còn lại`,
            note: 'Quota đọc trực tiếp từ cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota.',
          }
        : billingActive
          ? {
              label: 'Pay-as-you-go (Tier 1+)',
              rpmEstimate: '150–1,000+ RPM',
              rpdEstimate: '10,000+ RPD',
              note: 'Cloud Billing đã bật — hạn mức theo Google Cloud Quotas.',
            }
          : isFreeTier
            ? {
                label: 'Gemini API Free Tier',
                rpmEstimate: '5–15 RPM',
                rpdEstimate: '25–1,500 RPD',
                note: 'Gói miễn phí (Flash ~15 RPM / 1,500 RPD; Pro ~2–5 RPM).',
              }
            : {
                label: 'Google Account (Standard)',
                rpmEstimate: 'Theo hạn mức GCP Project',
                rpdEstimate: 'Xem Cloud Console Quotas',
                note: 'Bật Cloud Billing API trên GCP Project để đọc trạng thái thanh toán.',
              };

  const checkedAt = meta.checkedAt || meta.refreshedAt || meta.updatedAt || null;

  return {
    email,
    name,
    projectId,
    tier,
    billingActive,
    isFreeTier,
    tierLabel,
    shortTierLabel,
    modelsCount,
    topModels,
    quotaSummary,
    checkedAt,
  };
}

export function getGoogleTierPillClass(meta) {
  if (meta?.billingActive) {
    return 'border-indigo-500/35 bg-indigo-500/15 text-indigo-500';
  }
  if (meta?.isFreeTier) {
    return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-500';
  }
  return 'border-blue-500/35 bg-blue-500/15 text-blue-500';
}

export function getGoogleTierDotClass(meta) {
  if (meta?.billingActive) return 'bg-emerald-500';
  if (meta?.isFreeTier) return 'bg-emerald-500';
  return 'bg-blue-500';
}
