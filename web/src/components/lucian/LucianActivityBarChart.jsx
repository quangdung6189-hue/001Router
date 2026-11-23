/* Lucian UX/UI Prompt #095 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#095 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatCompactNumber, formatNumber } from '../../lib/api';
import './lucian-095.css';

function niceMax(rawMax, isCost) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return isCost ? 0.03 : 3;
  const stepRaw = rawMax / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const niceStep =
    [1, 2, 2.5, 5, 10]
      .map((k) => k * pow)
      .find((k) => k * 3 >= rawMax) || pow * 10;
  return niceStep * 3;
}

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

function formatAxisTick(val, metricId) {
  const n = Number(val) || 0;
  if (n <= 0) return '0';
  if (metricId === 'cost') {
    if (n < 0.01) return `$${n.toFixed(3)}`;
    if (n < 1) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(1)}`;
  }
  return formatCompactNumber(Math.round(n));
}

function deltaPercent(curr, prev) {
  if (!Number.isFinite(prev) || prev <= 0) {
    return curr > 0 ? '+100%' : '';
  }
  const r = (curr - prev) / prev;
  return `${r >= 0 ? '+' : '−'}${Math.abs(Math.round(r * 100))}%`;
}

export function LucianActivityBarChart({
  series = [],
  metric = 'requests',
  metrics = [],
  onMetricChange,
  rangeLabel = 'Today',
  chartView = 'bars',
  onChartViewChange,
}) {
  const rootRef = useRef(null);
  const chRef = useRef(null);
  const barsRef = useRef(null);
  const tipRef = useRef(null);
  const segRef = useRef(null);
  const segPillRef = useRef(null);
  const segBtnRefs = useRef([]);
  const barBtnRefs = useRef([]);
  const shownValRef = useRef(0);
  const rafRef = useRef(0);

  const [activeIdx, setActiveIdx] = useState(-1);
  const [pinnedIdx, setPinnedIdx] = useState(-1);
  const [displayBig, setDisplayBig] = useState('0');
  const [mountedAnim, setMountedAnim] = useState(false);

  const activeMetricDef = useMemo(
    () => metrics.find((m) => m.id === metric) || metrics[0] || { id: 'requests', label: 'Requests', color: '#E56A4A' },
    [metrics, metric]
  );

  const buckets = useMemo(() => {
    if (!Array.isArray(series) || series.length === 0) return [];
    return series.slice(-12);
  }, [series]);

  const values = useMemo(
    () => buckets.map((b) => Number(b?.[metric] || 0)),
    [buckets, metric]
  );

  const { maxScale, avgVal, totalVal, peakIdx } = useMemo(() => {
    if (values.length === 0) {
      return { maxScale: 3, avgVal: 0, totalVal: 0, peakIdx: -1 };
    }
    const maxV = Math.max(...values, 0);
    const total = values.reduce((acc, v) => acc + v, 0);
    const mean = total / values.length;
    let pIdx = -1;
    if (maxV > 0) {
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] === maxV) {
          pIdx = i;
          break;
        }
      }
    }
    return {
      maxScale: niceMax(maxV, metric === 'cost'),
      avgVal: mean,
      totalVal: total,
      peakIdx: pIdx,
    };
  }, [values, metric]);

  // Reset hover/pin when range/series/metric changes
  useEffect(() => {
    setActiveIdx(-1);
    setPinnedIdx(-1);
  }, [metric, rangeLabel, buckets.length]);

  // Trigger initial spring rise once on mount
  useEffect(() => {
    const rm =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rm) {
      setMountedAnim(true);
      return undefined;
    }
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setMountedAnim(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, []);

  const inspectedIdx = activeIdx >= 0 ? activeIdx : pinnedIdx;
  const inspectedBucket = inspectedIdx >= 0 ? buckets[inspectedIdx] : null;
  const targetHeroValue = inspectedBucket ? Number(inspectedBucket[metric] || 0) : totalVal;

  // Smooth number roll for hero metric
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const rm =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rm) {
      shownValRef.current = targetHeroValue;
      setDisplayBig(formatMetricVal(targetHeroValue, metric));
      return undefined;
    }
    const from = shownValRef.current;
    const to = targetHeroValue;
    const t0 = performance.now();
    const dur = 420;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      const cur = from + (to - from) * ease;
      shownValRef.current = cur;
      setDisplayBig(formatMetricVal(cur, metric));
      if (k < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [targetHeroValue, metric]);

  // Measure sliding metric segmented pill
  useLayoutEffect(() => {
    const pill = segPillRef.current;
    const idx = Math.max(
      0,
      metrics.findIndex((m) => m.id === metric)
    );
    const btn = segBtnRefs.current[idx];
    if (!pill || !btn) return;
    pill.style.setProperty('--px', `${btn.offsetLeft - 3}px`);
    pill.style.setProperty('--pw', `${btn.offsetWidth}px`);
  }, [metric, metrics]);

  // Position floating tooltip over the hovered/pinned bar
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const ch = chRef.current;
    if (!tip || !ch || inspectedIdx < 0) return;
    const btn = barBtnRefs.current[inspectedIdx];
    if (!btn) return;
    const cw = ch.clientWidth;
    const chH = ch.clientHeight;
    const tw = tip.offsetWidth || 84;
    const cx = btn.offsetLeft + btn.offsetWidth / 2;
    const ratio = maxScale > 0 ? Math.min(1, Math.max(0, (values[inspectedIdx] || 0) / maxScale)) : 0;
    const hh = ratio * Math.max(10, chH - 28);
    const tx = Math.max(0, Math.min(cw - tw, cx - tw / 2));
    const ty = Math.max(-4, chH - 28 - hh - 38);
    tip.style.setProperty('--tx', `${tx.toFixed(1)}px`);
    tip.style.setProperty('--ty', `${ty.toFixed(1)}px`);
  }, [inspectedIdx, values, maxScale]);

  const idxFromClientX = (clientX) => {
    let best = 0;
    for (let j = 0; j < buckets.length; j++) {
      const el = barBtnRefs.current[j];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left) best = j;
    }
    return best;
  };

  const handleBarsKeyDown = (e, idx) => {
    if (buckets.length === 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = Math.min(buckets.length - 1, idx + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buckets.length - 1;
    else if (e.key === 'Escape') {
      setActiveIdx(-1);
      setPinnedIdx(-1);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActiveIdx(next);
      barBtnRefs.current[next]?.focus();
    }
  };

  const avgRatio = maxScale > 0 ? Math.min(1, Math.max(0, avgVal / maxScale)) : 0;
  const inspectedDelta =
    inspectedIdx > 0 ? deltaPercent(values[inspectedIdx], values[inspectedIdx - 1]) : '';
  const inspectedDown =
    inspectedIdx > 0 && values[inspectedIdx] < values[inspectedIdx - 1];

  const barGradient = `linear-gradient(180deg, ${activeMetricDef.color}, color-mix(in srgb, ${activeMetricDef.color} 62%, #f59e0b))`;

  return (
    <div
      ref={rootRef}
      className={`ux u095 ${inspectedIdx >= 0 ? 'has' : ''}`}
      style={{
        '--u095-c': activeMetricDef.color,
        '--u095-grad': barGradient,
      }}
    >
      <div className="u095-h">
        <div className="min-w-0">
          <div className="u095-top">
            <small>
              {inspectedBucket
                ? inspectedBucket.fullLabel || inspectedBucket.label
                : `${activeMetricDef.label} · ${rangeLabel}`}
            </small>
            {inspectedDelta ? (
              <span className={`u095-dl ${inspectedDown ? 'dn' : ''}`}>
                {inspectedDelta} vs prev
              </span>
            ) : avgVal > 0 ? (
              <span className="u095-dl">
                Avg {formatMetricVal(avgVal, metric)} / slot
              </span>
            ) : null}
          </div>
          <div className="u095-v" aria-live="polite">
            <b>{displayBig}</b>
            <span className="u095-meta">
              {inspectedBucket ? (
                <>
                  {formatNumber(inspectedBucket.requests || 0)} req ·{' '}
                  {formatCompactNumber(inspectedBucket.tokens || 0)} tok
                  {inspectedBucket.promptTokens || inspectedBucket.completionTokens
                    ? ` (${formatCompactNumber(inspectedBucket.promptTokens || 0)} in / ${formatCompactNumber(inspectedBucket.completionTokens || 0)} out)`
                    : ''}{' '}
                  · {formatMetricVal(inspectedBucket.cost || 0, 'cost')}
                </>
              ) : (
                'Hover or click a bar to pin & inspect token / request details'
              )}
            </span>
          </div>
        </div>

        <div className="u095-controls">
          <div ref={segRef} className="u095-seg" role="group" aria-label="Chart metric">
            <span ref={segPillRef} className="u095-seg-pill" aria-hidden="true" />
            {metrics.map((m, idx) => (
              <button
                key={m.id}
                ref={(el) => {
                  segBtnRefs.current[idx] = el;
                }}
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

      {buckets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-12 text-xs text-[var(--text-muted)]">
          No activity recorded in this time range.
        </div>
      ) : (
        <div ref={chRef} className="u095-ch">
          <div className="u095-grid" aria-hidden="true">
            {[0, 1, 2, 3].map((k) => {
              const tickVal = (maxScale * k) / 3;
              const hideNearAvg = avgVal > 0 && Math.abs(k / 3 - avgRatio) < 0.08;
              return (
                <div
                  key={k}
                  className="u095-gl"
                  style={{ bottom: `${((k / 3) * 100).toFixed(3)}%` }}
                >
                  <span style={{ opacity: hideNearAvg ? 0 : 1 }}>
                    {formatAxisTick(tickVal, metric)}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            ref={barsRef}
            className="u095-bars"
            role="group"
            aria-label={`${activeMetricDef.label} bars`}
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse' || e.buttons > 0) {
                setActiveIdx(idxFromClientX(e.clientX));
              }
            }}
            onPointerDown={(e) => {
              if (e.pointerType !== 'mouse') {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setActiveIdx(idxFromClientX(e.clientX));
              }
            }}
            onPointerLeave={() => setActiveIdx(-1)}
          >
            {buckets.map((bucket, idx) => {
              const val = values[idx] || 0;
              const hRatio = mountedAnim && maxScale > 0 ? Math.min(1, Math.max(0, val / maxScale)) : 0;
              const isOn = idx === activeIdx || (activeIdx < 0 && idx === pinnedIdx);
              const isPinned = idx === pinnedIdx;
              const isPeak = idx === peakIdx && val > 0;
              return (
                <button
                  key={bucket.key || idx}
                  ref={(el) => {
                    barBtnRefs.current[idx] = el;
                  }}
                  type="button"
                  tabIndex={idx === (pinnedIdx >= 0 ? pinnedIdx : buckets.length - 1) ? 0 : -1}
                  className={`u095-b ${val > 0 ? 'nonzero' : ''} ${isPeak ? 'peak' : ''} ${isOn ? 'on' : ''} ${isPinned ? 'pin' : ''}`}
                  style={{
                    '--d': idx,
                    '--pad': buckets.length > 9 ? '3px' : '6px',
                    '--h': hRatio.toFixed(4),
                  }}
                  aria-label={`${bucket.fullLabel || bucket.label}: ${formatMetricVal(val, metric)}`}
                  aria-pressed={isPinned}
                  onClick={() => setPinnedIdx((prev) => (prev === idx ? -1 : idx))}
                  onFocus={() => setActiveIdx(idx)}
                  onBlur={(e) => {
                    if (!barsRef.current?.contains(e.relatedTarget)) setActiveIdx(-1);
                  }}
                  onKeyDown={(e) => handleBarsKeyDown(e, idx)}
                >
                  <i aria-hidden="true" />
                  <em>{bucket.label}</em>
                </button>
              );
            })}
          </div>

          {avgVal > 0 ? (
            <div
              className="u095-avg"
              style={{ '--a': avgRatio.toFixed(4) }}
              aria-hidden="true"
            >
              <span>Avg</span>
            </div>
          ) : null}

          <div ref={tipRef} className="u095-tip" aria-hidden="true">
            <span>
              {inspectedBucket ? formatMetricVal(inspectedBucket[metric] || 0, metric) : ''}
            </span>
            {inspectedDelta ? (
              <small className={inspectedDown ? 'dn' : ''}>{inspectedDelta}</small>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
