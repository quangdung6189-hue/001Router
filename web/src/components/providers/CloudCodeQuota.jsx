import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Antigravity quota pools (same ids the server uses). */
export const FAMILY_LABELS = {
  gemini: 'Gemini',
  gemini_argon: 'Gemini 4 Argon',
  claude_gpt: 'Claude & GPT',
};
const FAMILY_ORDER = ['gemini', 'gemini_argon', 'claude_gpt', ''];

/** "Gemini · tuần" / "Claude & GPT · 5 giờ" for a quota window. */
export function windowLabel(w) {
  const family = FAMILY_LABELS[w?.family] || w?.label || 'Quota';
  return `${family} · ${w?.window === 'weekly' ? 'tuần' : '5 giờ'}`;
}

export function pctOf(fraction) {
  return Math.max(0, Math.min(100, Math.round((Number(fraction) || 0) * 100)));
}

/** Absolute local time, e.g. "24/11 15:30"; empty when missing or invalid. */
export function formatWhen(time) {
  const ms = Date.parse(time || '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Time left until `time`, e.g. "3 giờ 12 phút"; empty when past, missing or invalid. */
export function formatLeft(time, nowMs = Date.now()) {
  const ms = Date.parse(time || '');
  if (!Number.isFinite(ms) || ms <= nowMs) return '';
  const mins = Math.max(1, Math.round((ms - nowMs) / 60000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days) return `${days} ngày ${hours} giờ`;
  if (hours) return `${hours} giờ ${rest} phút`;
  return `${rest} phút`;
}

/** "24/11 15:30 (còn 3 giờ 12 phút)". */
export function formatReset(time, nowMs = Date.now()) {
  const when = formatWhen(time);
  if (!when) return '';
  const left = formatLeft(time, nowMs);
  return left ? `${when} (còn ${left})` : when;
}

function toneOf(pct) {
  return pct >= 50 ? 'bg-emerald-500' : pct >= 20 ? 'bg-amber-500' : 'bg-red-500';
}

/** One weekly / 5-hour window: label, %, a thin bar and the time left. */
function WindowMeter({ w }) {
  const pct = pctOf(w.remainingFraction);
  const left = formatLeft(w.resetTime);
  return (
    <div
      className="space-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1.5"
      title={w.resetTime ? `Reset lúc ${formatWhen(w.resetTime)}` : undefined}
    >
      <div className="flex items-center justify-between gap-2 text-[10.5px]">
        <span className="truncate text-[var(--text-primary)]">{windowLabel(w)}</span>
        <span className="shrink-0 font-semibold text-[var(--text-secondary)]">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        <div className={`h-full rounded-full ${toneOf(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-[var(--text-muted)]">
        {left ? `reset sau ${left}` : pct >= 100 ? 'đầy' : '—'}
      </div>
    </div>
  );
}

/** A model row: id (click to copy `slug/id`) and, when meaningful, its remaining %. */
function ModelRow({ m, slug, showPct, copied, onCopy }) {
  const pct = m.remainingFraction === null || m.remainingFraction === undefined ? null : pctOf(m.remainingFraction);
  const fullId = slug ? `${slug}/${m.id}` : m.id;
  return (
    <button
      type="button"
      onClick={() => onCopy(fullId)}
      title={`Sao chép ${fullId}${m.label && m.label !== m.id ? ` — ${m.label}` : ''}`}
      className="flex min-w-0 items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[10.5px] hover:bg-[var(--bg-subtle)]"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {copied === fullId ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        )}
        <code className="truncate text-[var(--text-primary)]">{m.id}</code>
      </span>
      {showPct && pct !== null ? (
        <span className="flex shrink-0 items-center gap-1 text-[var(--text-secondary)]">
          <span className={`h-1.5 w-1.5 rounded-full ${toneOf(pct)}`} aria-hidden="true" />
          {pct}%
        </span>
      ) : null}
    </button>
  );
}

/**
 * Compact plan + quota view of one Cloud Code account (Antigravity or Gemini CLI):
 * the plan, the weekly / 5-hour windows, and the models on the plan (collapsed).
 *
 * `models` is the account's own catalog (fetchAvailableModels). Per-model % is shown only when it
 * is the real limit (paid plans); on the free tier the windows are the limit.
 */
export function CloudCodeQuota({
  tierLabel,
  email,
  projectId,
  windows = [],
  models = [],
  buckets = [],
  perModelHidden = false,
  checkedAt,
  accent = '#F59E0B',
  providerSlug = 'antigravity',
  extra = null,
}) {
  const [copied, setCopied] = useState('');
  const copy = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      // clipboard unavailable (insecure context)
    }
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? '' : c)), 1500);
  };

  // Gemini CLI has no catalog: fall back to its per-model buckets.
  const list =
    Array.isArray(models) && models.length
      ? models
      : (Array.isArray(buckets) ? buckets : [])
          .filter((b) => b?.modelId && !/^tab_/i.test(b.modelId))
          .map((b) => ({ id: b.modelId, label: b.modelId, family: '', kind: 'chat', remainingFraction: b.remainingFraction }));
  const chat = list.filter((m) => m.kind === 'chat');
  const images = list.filter((m) => m.kind === 'image');
  const others = list.filter((m) => m.kind === 'other');
  const showPct = !perModelHidden;
  const groups = FAMILY_ORDER.map((f) => ({
    family: f,
    label: FAMILY_LABELS[f] || 'Khác',
    items: chat.filter((m) => (m.family || '') === f),
  })).filter((g) => g.items.length);

  const plan = String(tierLabel || '').split(' · ')[0] || 'Chưa đọc được gói';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
          style={{ color: accent, borderColor: `${accent}66`, backgroundColor: `${accent}1f` }}
          title={tierLabel || undefined}
        >
          {plan}
        </span>
        {email ? (
          <span className="truncate text-[11px] text-[var(--text-secondary)]">{email}</span>
        ) : null}
        {projectId ? (
          <code className="truncate rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            {projectId}
          </code>
        ) : null}
        {extra}
      </div>

      {windows.length ? (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {windows.map((w) => (
            <WindowMeter key={w.id} w={w} />
          ))}
        </div>
      ) : (
        <p className="text-[10.5px] text-[var(--text-muted)]">
          Chưa có quota tuần / 5 giờ — bấm “Làm mới gói &amp; quota”.
        </p>
      )}

      {chat.length ? (
        <details className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1.5">
          <summary className="cursor-pointer text-[10.5px] font-medium text-[var(--text-secondary)]">
            Model trong gói ({chat.length}) · bấm để sao chép id
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {groups.map((g) => (
              <div key={g.family || 'other'}>
                <div className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {g.label} ({g.items.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {g.items.map((m) => (
                    <ModelRow key={m.id} m={m} slug={providerSlug} showPct={showPct} copied={copied} onCopy={copy} />
                  ))}
                </div>
              </div>
            ))}
            {images.length || others.length ? (
              <div className="px-1.5 text-[10px] text-[var(--text-muted)]">
                {images.length ? `Ảnh: ${images.map((m) => m.id).join(', ')}` : ''}
                {images.length && others.length ? ' · ' : ''}
                {others.length ? `Khác: ${others.map((m) => m.id).join(', ')}` : ''}
              </div>
            ) : null}
            {perModelHidden ? (
              <p className="px-1.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
                Gói miễn phí: % theo từng model không phải giới hạn thật nên được ẩn — giới hạn thật là
                quota tuần / 5 giờ ở trên.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {checkedAt ? (
        <div className="text-[10px] text-[var(--text-muted)]">Cập nhật: {formatWhen(checkedAt) || checkedAt}</div>
      ) : null}
    </div>
  );
}
