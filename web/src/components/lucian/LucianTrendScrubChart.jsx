/* Lucian UX/UI Prompt #096 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#096 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCompactNumber, formatNumber } from '../../lib/api';
import './lucian-096.css';

const W = 720;
const H = 196;
const PAD_X = 16;
const PAD_TOP = 30;
const PAD_BOT = 14;

function formatMetricVal(val, metricId) {
  const n = Number(val) || 0;
  if (metricId === 'cost') {
    if (n === 0) return '$0.00';
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }
  if (metricId === 'tokens' || metricId === 'savedChars') {
    return n >= 1000 ? formatCompactNumber(n) : formatNumber(Math.round(n));
  }
  return formatNumber(Math.round(n));
}

function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = Math.min(H - PAD_BOT, Math.max(PAD_TOP - 8, p1.y + (p2.y - p0.y) / 6));
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = Math.min(H - PAD_BOT, Math.max(PAD_TOP - 8, p2.y - (p3.y - p1.y) / 6));
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function LucianTrendScrubChart({
  series = [],
  metric = 'requests',
  metrics = [],
  onMetricChange,
  rangeLabel = 'Today',
  chartView = 'line',
  onChartViewChange,
}) {
  const uid = useId().replace(/:/g, '');
  const chRef = useRef(null);
  const tagRef = useRef(null);
  const touchingRef = useRef(false);
  const morphRafRef = useRef(0);
  const backRafRef = useRef(0);

  const activeMetricDef = useMemo(
    () => metrics.find((m) => m.id === metric) || metrics[0] || { id: 'requests', label: 'Requests', color: '#E56A4A' },
    [metrics, metric]
  );

  const buckets = useMemo(() => (Array.isArray(series) ? series : []), [series]);
  const count = buckets.length;

  const targetYs = useMemo(() => {
    if (count === 0) return [];
    const vals = buckets.map((b) => Number(b?.[metric] || 0));
    const mx = Math.max(...vals, 1);
    return vals.map((v) => PAD_TOP + (1 - v / mx) * (H - PAD_TOP - PAD_BOT));
  }, [buckets, metric, count]);

  const [renderedYs, setRenderedYs] = useState(targetYs);
  const prevYsRef = useRef(targetYs);
  const [at, setAt] = useState(Math.max(0, count - 1));
  const [scrubbing, setScrubbing] = useState(false);

  // Morph smoothly when metric/data changes
  useEffect(() => {
    cancelAnimationFrame(morphRafRef.current);
    const rm =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rm || count === 0) {
      prevYsRef.current = targetYs;
      setRenderedYs(targetYs);
      setAt(Math.max(0, count - 1));
      return undefined;
    }
    const from =
      prevYsRef.current.length === targetYs.length
        ? prevYsRef.current.slice()
        : targetYs.map(() => H - PAD_BOT);
    const t0 = performance.now();
    const dur = 580;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const cur = from.map((y, i) => y + ((targetYs[i] ?? H - PAD_BOT) - y) * e);
      prevYsRef.current = cur;
      setRenderedYs(cur);
      if (t < 1) {
        morphRafRef.current = requestAnimationFrame(step);
      }
    };
    setAt(Math.max(0, count - 1));
    morphRafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(morphRafRef.current);
  }, [targetYs, count]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(morphRafRef.current);
      cancelAnimationFrame(backRafRef.current);
    };
  }, []);

  const pts = useMemo(() => {
    if (count === 0) return [];
    const usableW = W - PAD_X * 2;
    return buckets.map((_, i) => ({
      x: count === 1 ? W / 2 : PAD_X + (i / (count - 1)) * usableW,
      y: renderedYs[i] ?? H - PAD_BOT,
    }));
  }, [buckets, renderedYs, count]);

  const linePath = useMemo(() => buildSmoothPath(pts), [pts]);
  const areaPath = useMemo(() => {
    if (pts.length === 0) return '';
    return `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;
  }, [linePath, pts]);

  const clampedAt = Math.max(0, Math.min(Math.max(0, count - 1), at));
  const idxLow = Math.floor(clampedAt);
  const idxHigh = Math.min(Math.max(0, count - 1), idxLow + 1);
  const frac = clampedAt - idxLow;
  const curX = pts.length > 0 ? pts[idxLow].x + (pts[idxHigh].x - pts[idxLow].x) * frac : W / 2;
  const curY = pts.length > 0 ? pts[idxLow].y + (pts[idxHigh].y - pts[idxLow].y) * frac : H - PAD_BOT;
  const nearestIdx = Math.round(clampedAt);
  const activeBucket = buckets[nearestIdx] || null;
  const totalMetricVal = useMemo(
    () => buckets.reduce((sum, b) => sum + Number(b?.[metric] || 0), 0),
    [buckets, metric]
  );

  // Update floating pill tag X offset
  useEffect(() => {
    const ch = chRef.current;
    const tag = tagRef.current;
    if (!ch || !tag) return;
    const cw = ch.clientWidth;
    const tw = tag.offsetWidth || 80;
    const px = (curX / W) * cw;
    const tx = Math.max(8, Math.min(cw - tw - 8, px - tw / 2));
    tag.style.setProperty('--tx', `${tx.toFixed(1)}px`);
  }, [curX, nearestIdx, scrubbing]);

  const indexFromEvent = (clientX) => {
    const ch = chRef.current;
    if (!ch || count <= 1) return 0;
    const rect = ch.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    const ratio = (svgX - PAD_X) / Math.max(1, W - PAD_X * 2);
    return Math.max(0, Math.min(count - 1, ratio * (count - 1)));
  };

  const releaseScrub = () => {
    if (!scrubbing) return;
    setScrubbing(false);
    cancelAnimationFrame(backRafRef.current);
    const targetEnd = Math.max(0, count - 1);
    const rm =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rm) {
      setAt(targetEnd);
      return;
    }
    const from = clampedAt;
    const t0 = performance.now();
    const dur = 420;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setAt(from + (targetEnd - from) * e);
      if (t < 1) backRafRef.current = requestAnimationFrame(step);
    };
    backRafRef.current = requestAnimationFrame(step);
  };

  const gradId = `u096-gd-${uid}`;
  const clipId = `u096-cp-${uid}`;
  const refY = pts.length > 0 ? pts[0].y : H - PAD_BOT;

  return (
    <div
      className={`ux u096 ${scrubbing ? 'scrub' : ''}`}
      style={{ '--c': activeMetricDef.color }}
    >
      <div className="u096-head">
        <div className="u096-h">
          <small>
            <i aria-hidden="true" />
            {activeMetricDef.label} Trend · {rangeLabel}
          </small>
          <b className="u096-p">
            {scrubbing && activeBucket
              ? formatMetricVal(activeBucket[metric] || 0, metric)
              : formatMetricVal(totalMetricVal, metric)}
          </b>
          <div className="u096-d" aria-live="polite">
            {scrubbing && activeBucket ? (
              <>
                <b>{activeBucket.fullLabel || activeBucket.label}</b>
                <span>
                  {formatNumber(activeBucket.requests || 0)} req ·{' '}
                  {formatCompactNumber(activeBucket.tokens || 0)} tok ·{' '}
                  {formatMetricVal(activeBucket.cost || 0, 'cost')}
                </span>
              </>
            ) : (
              <>
                <b>Scrub along curve</b>
                <span>Sweep pointer or use ← / → keys to inspect each time slot</span>
              </>
            )}
          </div>
        </div>

        <div className="u095-controls">
          <div className="u095-seg" role="group" aria-label="Chart metric">
            {metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={metric === m.id}
                onClick={() => onMetricChange?.(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {onChartViewChange ? (
            <div className="u095-seg" role="group" aria-label="Chart style">
              <button
                type="button"
                aria-pressed={chartView === 'bars'}
                onClick={() => onChartViewChange('bars')}
              >
                Bars
              </button>
              <button
                type="button"
                aria-pressed={chartView === 'line'}
                onClick={() => onChartViewChange('line')}
              >
                Scrub Line
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {count === 0 ? (
        <div className="flex flex-1 items-center justify-center py-12 text-xs text-[var(--text-muted)]">
          No activity recorded in this time range.
        </div>
      ) : (
        <>
          <div
            ref={chRef}
            className="u096-ch"
            tabIndex={0}
            role="slider"
            aria-label={`${activeMetricDef.label} history scrubber`}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, count - 1)}
            aria-valuenow={nearestIdx}
            aria-valuetext={
              activeBucket
                ? `${activeBucket.fullLabel || activeBucket.label}: ${formatMetricVal(activeBucket[metric] || 0, metric)}`
                : ''
            }
            onPointerDown={(e) => {
              if (e.pointerType !== 'mouse') {
                touchingRef.current = true;
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }
              cancelAnimationFrame(backRafRef.current);
              setScrubbing(true);
              setAt(indexFromEvent(e.clientX));
            }}
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse' || touchingRef.current) {
                cancelAnimationFrame(backRafRef.current);
                setScrubbing(true);
                setAt(indexFromEvent(e.clientX));
              }
            }}
            onPointerUp={() => {
              if (touchingRef.current) {
                touchingRef.current = false;
                releaseScrub();
              }
            }}
            onPointerCancel={() => {
              touchingRef.current = false;
              releaseScrub();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') releaseScrub();
            }}
            onBlur={releaseScrub}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                releaseScrub();
                return;
              }
              let delta = null;
              if (e.key === 'ArrowLeft') delta = -1;
              else if (e.key === 'ArrowRight') delta = 1;
              else if (e.key === 'Home') delta = -count;
              else if (e.key === 'End') delta = count;
              if (delta === null) return;
              e.preventDefault();
              cancelAnimationFrame(backRafRef.current);
              setScrubbing(true);
              setAt((prev) => Math.max(0, Math.min(count - 1, Math.round(prev) + delta)));
            }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={gradId} className="u096-gd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopOpacity="0.32" />
                  <stop offset="100%" stopOpacity="0" />
                </linearGradient>
                <clipPath id={clipId}>
                  <rect x="0" y="-20" height={H + 40} width={Math.max(0, curX)} />
                </clipPath>
              </defs>

              <line className="u096-ref" x1={PAD_X} x2={W - PAD_X} y1={refY} y2={refY} />
              <path className="u096-base" d={linePath} />
              <g clipPath={`url(#${clipId})`}>
                <path d={areaPath} fill={`url(#${gradId})`} />
                <path className="u096-line" d={linePath} />
              </g>
              <line className="u096-cur" x1={curX} x2={curX} y1="0" y2={H} />
              <circle className="u096-ring" cx={curX} cy={curY} r="5.5" />
              <circle className="u096-dot" cx={curX} cy={curY} r="5" />
            </svg>
            <span ref={tagRef} className="u096-tag">
              {activeBucket
                ? `${activeBucket.label} · ${formatMetricVal(activeBucket[metric] || 0, metric)}`
                : ''}
            </span>
          </div>

          <div className="u096-axis" aria-hidden="true">
            {buckets.map((b, i) => (
              <span key={b.key || i}>{b.label}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
