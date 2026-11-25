import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { ProviderLogo } from '../ProviderLogo';
import './LucianLogoMarquee.css';

const BASE_SPEED = 32;

/**
 * Port of Lucian UX/UI #421 (Customer logo strip) with WCAG 2.2.2 Pause/Play control
 * and 001Router full-bleed provider icons.
 */
export function LucianLogoMarquee({ items = [], caption = 'Connected AI Ecosystem' }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const [paused, setPaused] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      ? true
      : false
  );
  const hoveredRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const vp = viewportRef.current;
    const tr = trackRef.current;
    if (!vp || !tr || items.length === 0) return undefined;

    const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (rm) return undefined;

    let x = 0;
    let v = pausedRef.current ? 0 : BASE_SPEED;
    let last = 0;
    let raf = 0;
    let visible = true;

    const onEnter = () => {
      hoveredRef.current = true;
    };
    const onLeave = () => {
      hoveredRef.current = false;
    };
    vp.addEventListener('pointerenter', onEnter);
    vp.addEventListener('pointerleave', onLeave);

    const frame = (now) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const firstList = tr.firstElementChild;
      const half = firstList ? firstList.offsetWidth : 0;
      const target = pausedRef.current || hoveredRef.current ? 0 : BASE_SPEED;
      v += (target - v) * Math.min(1, dt * 3.8);
      if (Math.abs(v) > 0.08 && half > 0) {
        x -= v * dt;
        if (x <= -half) x += half;
        tr.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible) {
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
    start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      vp.removeEventListener('pointerenter', onEnter);
      vp.removeEventListener('pointerleave', onLeave);
    };
  }, [items.length]);

  const renderGroup = (hidden) => (
    <ul
      className="lucian-marquee-list"
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : caption}
    >
      {items.map((item) => (
        <li key={`${hidden ? 'dup-' : ''}${item.preset}`} className="lucian-marquee-pill">
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
      <div ref={viewportRef} className="lucian-marquee-viewport">
        <div ref={trackRef} className="lucian-marquee-track">
          {renderGroup(false)}
          {renderGroup(true)}
        </div>
      </div>
    </div>
  );
}
