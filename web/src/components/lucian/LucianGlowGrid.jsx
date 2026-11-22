/* Lucian UX/UI Prompt #228 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#228 */
import { useEffect, useRef } from 'react';
import './lucian-228.css';

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

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;
    let p = { x: -500, y: -500 };
    let o = 0;
    let oT = 0;
    let raf = 0;
    let last = 0;

    const apply = () => {
      const cards = root.querySelectorAll(':scope > .u228-c');
      const rb = root.getBoundingClientRect();
      const k = root.offsetWidth / (rb.width || 1);
      cards.forEach((el) => {
        const r = el.getBoundingClientRect();
        const lx = p.x - (r.left - rb.left) * k;
        const ly = p.y - (r.top - rb.top) * k;
        el.style.setProperty('--cx', `${lx.toFixed(1)}px`);
        el.style.setProperty('--cy', `${ly.toFixed(1)}px`);
        el.style.setProperty('--o', o.toFixed(3));
        const inner = el.firstElementChild;
        if (inner) {
          inner.style.setProperty('--cx', `${(lx - 1).toFixed(1)}px`);
          inner.style.setProperty('--cy', `${(ly - 1).toFixed(1)}px`);
          inner.style.setProperty('--o', o.toFixed(3));
        }
      });
    };

    const frame = (now) => {
      raf = 0;
      if (!root.isConnected) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      o += (oT - o) * (reduced ? 1 : Math.min(1, dt * (oT ? 8 : 2.5)));
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
      const b = root.getBoundingClientRect();
      const k = root.offsetWidth / (b.width || 1);
      p = { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k };
      oT = 1;
      apply();
      kick();
    };

    const onPointerLeave = () => {
      oT = 0;
      kick();
    };

    const onMediaChange = (e) => {
      reduced = e.matches;
      if (reduced) {
        o = 0;
        oT = 0;
        apply();
      }
    };

    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
    mq.addEventListener?.('change', onMediaChange);
    apply();

    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      mq.removeEventListener?.('change', onMediaChange);
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
