/* Lucian UX/UI Prompt #002 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#002 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './lucian-002.css';

export function LucianMagneticButton({
  to,
  onClick,
  label = 'Open Dashboard',
  activeLabel = 'Opening…',
  size = 'md',
  className = '',
}) {
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const magRef = useRef(null);
  const txtRef = useRef(null);
  const orbRef = useRef(null);
  const timerRef = useRef(null);
  const [state, setState] = useState('idle');

  useEffect(() => {
    const root = rootRef.current;
    const btn = btnRef.current;
    const mag = magRef.current;
    const txt = txtRef.current;
    const orb = orbRef.current;
    if (!root || !btn || !mag || !txt || !orb) return undefined;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;

    const resetOffsets = () => {
      mag.style.translate = '0px 0px';
      txt.style.translate = '0px 0px';
      orb.style.translate = '0px 0px';
    };

    const onMediaChange = (e) => {
      reduced = e.matches;
      if (reduced) resetOffsets();
    };

    const onPointerMove = (e) => {
      if (reduced) return;
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const p = Math.max(0, 1 - Math.hypot(dx, dy) / 240);
      mag.style.translate = `${(dx * 0.12 * p).toFixed(1)}px ${(dy * 0.22 * p).toFixed(1)}px`;
      txt.style.translate = `${(dx * 0.05 * p).toFixed(1)}px ${(dy * 0.08 * p).toFixed(1)}px`;
      orb.style.translate = `${(dx * 0.1 * p).toFixed(1)}px ${(dy * 0.14 * p).toFixed(1)}px`;
    };

    const onPointerLeave = () => {
      resetOffsets();
    };

    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
    mq.addEventListener?.('change', onMediaChange);

    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      mq.removeEventListener?.('change', onMediaChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handlePress = (e) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setState('go');
    timerRef.current = setTimeout(() => {
      setState('idle');
    }, reduced ? 400 : 1400);
    onClick?.(e);
  };

  const inner = (
    <>
      <span className="u002-fill" aria-hidden="true" />
      <span ref={txtRef} className="u002-txt">
        <span>{label}</span>
        <span aria-hidden="true">{activeLabel}</span>
      </span>
      <span ref={orbRef} className="u002-orb" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 12h13M13 6l6 6-6 6" />
        </svg>
        <svg viewBox="0 0 24 24">
          <path d="M5 12h13M13 6l6 6-6 6" />
        </svg>
      </span>
    </>
  );

  const btnClasses = `u002-btn ${size === 'sm' ? 'u002-btn--sm' : ''} ${className}`.trim();

  return (
    <div ref={rootRef} className="ux u002" data-state={state}>
      <span className="u002-glow" aria-hidden="true" />
      <div ref={magRef} className="u002-mag">
        {to ? (
          <Link ref={btnRef} to={to} onClick={handlePress} className={btnClasses}>
            {inner}
          </Link>
        ) : (
          <button ref={btnRef} type="button" onClick={handlePress} className={btnClasses}>
            {inner}
          </button>
        )}
      </div>
      <span className="u002-live" aria-live="polite">
        {state === 'go' ? activeLabel : ''}
      </span>
    </div>
  );
}
