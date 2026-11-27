/* Lucian UX/UI Prompt #228 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#228 */
import { useEffect, useRef } from 'react';
import './lucian-228.css';

/**
 * Cursor-reactive holographic glow grid.
 * Matches all `.u228-c` cards inside the grid (even when wrapped in reveal containers)
 * and caches bounding metrics between pointer frames to prevent layout thrashing.
 */
export function LucianGlowGrid({
  children,
  className = '',
  as: Tag = 'div',
  ariaLabel,
  ...rest
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reduced = Boolean(mq?.matches);
    let p = { x: -500, y: -500 };
    let o = 0;
    let oT = 0;
    let raf = 0;
    let last = 0;

    // Cached card offsets relative to grid root (refreshed on resize / scroll / DOM change)
    let rootRect = root.getBoundingClientRect();
    let cardCache = [];
    let metricsDirty = true;

    const measure = () => {
      rootRect = root.getBoundingClientRect();
      const k = root.offsetWidth / (rootRect.width || 1);
      const cards = Array.from(root.querySelectorAll('.u228-c'));
      cardCache = cards.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          inner: el.firstElementChild,
          dx: (r.left - rootRect.left) * k,
          dy: (r.top - rootRect.top) * k,
          w: r.width * k,
          h: r.height * k,
        };
      });
      metricsDirty = false;
    };

    const apply = () => {
      if (metricsDirty) measure();
      for (let i = 0; i < cardCache.length; i++) {
        const c = cardCache[i];
        const lx = p.x - c.dx;
        const ly = p.y - c.dy;
        c.el.style.setProperty('--cx', `${lx.toFixed(1)}px`);
        c.el.style.setProperty('--cy', `${ly.toFixed(1)}px`);
        c.el.style.setProperty('--o', o.toFixed(3));
        if (c.inner) {
          c.inner.style.setProperty('--cx', `${(lx - 1).toFixed(1)}px`);
          c.inner.style.setProperty('--cy', `${(ly - 1).toFixed(1)}px`);
          c.inner.style.setProperty('--o', o.toFixed(3));
        }
      }
    };

    const frame = (now) => {
      raf = 0;
      if (!root.isConnected) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      o += (oT - o) * (reduced ? 1 : Math.min(1, dt * (oT ? 9.5 : 3.2)));
      apply();
      if (Math.abs(oT - o) > 0.005) {
        raf = requestAnimationFrame(frame);
      }
    };

    const kick = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onPointerMove = (e) => {
      if (reduced) return;
      if (metricsDirty) measure();
      const k = root.offsetWidth / (rootRect.width || 1);
      p = { x: (e.clientX - rootRect.left) * k, y: (e.clientY - rootRect.top) * k };
      oT = 1;
      apply();
      kick();
    };

    const onPointerLeave = () => {
      oT = 0;
      kick();
    };

    const markDirty = () => {
      metricsDirty = true;
    };

    const onMediaChange = (e) => {
      reduced = e.matches;
      if (reduced) {
        o = 0;
        oT = 0;
        apply();
      }
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(markDirty) : null;
    ro?.observe(root);

    root.addEventListener('pointerenter', markDirty, { passive: true });
    root.addEventListener('pointermove', onPointerMove, { passive: true });
    root.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('scroll', markDirty, { passive: true });
    mq?.addEventListener?.('change', onMediaChange);
    apply();

    return () => {
      ro?.disconnect();
      root.removeEventListener('pointerenter', markDirty);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', markDirty);
      mq?.removeEventListener?.('change', onMediaChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Tag
      ref={rootRef}
      aria-label={ariaLabel}
      className={`ux u228 ${className}`.trim()}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function LucianGlowCard({
  children,
  className = '',
  innerClassName = '',
  as: InnerTag = 'div',
  ...innerProps
}) {
  return (
    <div className={`u228-c ${className}`.trim()}>
      <InnerTag className={`u228-in block ${innerClassName}`.trim()} {...innerProps}>
        {children}
      </InnerTag>
    </div>
  );
}
