import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ProviderLogo } from '../ProviderLogo';
import './LucianLogoMarquee.css';

const BASE_SPEED = 28;

/**
 * Dual-track counter-flowing logo marquee with scroll-velocity momentum,
 * ResizeObserver width caching (zero 60fps forced reflow), and WCAG 2.2.2 Pause/Play control.
 */
export function LucianLogoMarquee({
  items = [],
  caption = 'Connected AI Ecosystem',
  externalPaused = false,
}) {
  const viewportRef = useRef(null);
  const trackARef = useRef(null);
  const trackBRef = useRef(null);
  const [paused, setPaused] = useState(() =>
    externalPaused ||
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
      ? true
      : false
  );

  useEffect(() => {
    setPaused(externalPaused);
  }, [externalPaused]);

  const hoveredRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const [rowA, rowB] = useMemo(() => {
    if (items.length <= 6) return [items, [...items].reverse()];
    const mid = Math.ceil(items.length / 2);
    return [items.slice(0, mid), items.slice(mid)];
  }, [items]);

  useEffect(() => {
    const vp = viewportRef.current;
    const trA = trackARef.current;
    const trB = trackBRef.current;
    if (!vp || !trA || !trB || items.length === 0) return undefined;

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) return undefined;

    let halfA = trA.firstElementChild?.offsetWidth || 0;
    let halfB = trB.firstElementChild?.offsetWidth || 0;
    let xA = 0;
    let xB = -halfB * 0.5;
    let v = pausedRef.current ? 0 : BASE_SPEED;
    let scrollBoost = 0;
    let lastScrollY = window.scrollY;
    let last = 0;
    let raf = 0;
    let visible = true;
    let pageHidden = document.visibilityState === 'hidden';

    const updateWidths = () => {
      halfA = trA.firstElementChild?.offsetWidth || 0;
      halfB = trB.firstElementChild?.offsetWidth || 0;
      if (halfB > 0 && xB === 0) xB = -halfB * 0.5;
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateWidths) : null;
    if (trA.firstElementChild) ro?.observe(trA.firstElementChild);
    if (trB.firstElementChild) ro?.observe(trB.firstElementChild);

    const onEnter = () => {
      hoveredRef.current = true;
    };
    const onLeave = () => {
      hoveredRef.current = false;
    };
    const onScroll = () => {
      const dy = Math.abs(window.scrollY - lastScrollY);
      lastScrollY = window.scrollY;
      scrollBoost = Math.min(115, scrollBoost + dy * 0.65);
    };
    const onVisibility = () => {
      pageHidden = document.visibilityState === 'hidden';
      if (!pageHidden) start();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const frame = (now) => {
      raf = 0;
      if (!visible || pageHidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;

      scrollBoost *= Math.exp(-dt * 4.2);
      const target = pausedRef.current || hoveredRef.current ? 0 : BASE_SPEED + scrollBoost;
      v += (target - v) * Math.min(1, dt * 4.2);

      if (Math.abs(v) > 0.06) {
        if (halfA > 0) {
          xA -= v * dt;
          if (xA <= -halfA) xA += halfA;
          trA.style.transform = `translate3d(${xA.toFixed(2)}px, 0, 0)`;
        }
        if (halfB > 0) {
          xB += v * 0.86 * dt;
          if (xB >= 0) xB -= halfB;
          trB.style.transform = `translate3d(${xB.toFixed(2)}px, 0, 0)`;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible && !pageHidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = Boolean(entries[0]?.isIntersecting);
            if (visible) start();
            else if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
          })
        : null;
    io?.observe(vp);
    updateWidths();
    start();

    vp.addEventListener('pointerenter', onEnter, { passive: true });
    vp.addEventListener('pointerleave', onLeave, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      vp.removeEventListener('pointerenter', onEnter);
      vp.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [items.length]);

  const renderGroup = (list, keyPrefix, hidden) => (
    <ul
      className="lucian-marquee-list"
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : caption}
    >
      {list.map((item) => (
        <li key={`${keyPrefix}-${item.preset}`} className="lucian-marquee-pill">
          <ProviderLogo preset={item.preset} name={item.name} size="sm" />
          <span className="text-xs font-semibold tracking-tight">{item.name}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="lucian-marquee-wrap space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
          {caption}
        </p>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]"
        >
          {paused ? (
            <>
              <Play className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
              <span>Play</span>
            </>
          ) : (
            <>
              <Pause className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
              <span>Pause</span>
            </>
          )}
        </button>
      </div>
      <div ref={viewportRef} className="lucian-marquee-viewport space-y-2.5">
        <div ref={trackARef} className="lucian-marquee-track">
          {renderGroup(rowA, 'a1', false)}
          {renderGroup(rowA, 'a2', true)}
          {renderGroup(rowA, 'a3', true)}
        </div>
        <div ref={trackBRef} className="lucian-marquee-track">
          {renderGroup(rowB, 'b1', false)}
          {renderGroup(rowB, 'b2', true)}
          {renderGroup(rowB, 'b3', true)}
        </div>
      </div>
    </div>
  );
}
