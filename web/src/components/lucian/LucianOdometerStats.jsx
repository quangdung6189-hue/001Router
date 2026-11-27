/* Lucian UX/UI Prompt #426 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#426 */
import { useEffect, useRef } from 'react';
import './lucian-426.css';

const DIGITS = '01234567890123456789'.split('');

/**
 * Odometer stats (Lucian #426): digits roll into place when visible; hover a cell to roll again.
 * items: Array<{ value: string, label: string }>
 */
export function LucianOdometerStats({ items, className = '' }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cells = Array.from(root.querySelectorAll('.u426-c'));
    const stats = cells.map((li) => Array.from(li.querySelectorAll('.u426-col > span')));

    const roll = (cols, from) => {
      cols.forEach((c) => {
        const d = +c.getAttribute('data-d');
        c.style.transition = 'none';
        c.style.setProperty('--d', from === null ? d : from);
      });
      void root.offsetWidth;
      cols.forEach((c) => {
        c.style.transition = '';
        c.style.setProperty('--d', +c.getAttribute('data-d') + 10);
      });
    };

    let shown = false;
    const reveal = () => {
      if (shown) return;
      shown = true;
      if (rm) {
        stats.forEach((cols) =>
          cols.forEach((c) => c.style.setProperty('--d', +c.getAttribute('data-d') + 10))
        );
        return;
      }
      stats.forEach((cols) => roll(cols, 0));
    };

    const offs = cells.map((li, i) => {
      let busy = 0;
      const onEnter = () => {
        if (!shown || rm || Date.now() - busy < 900) return;
        busy = Date.now();
        roll(stats[i], null);
      };
      li.addEventListener('pointerenter', onEnter);
      return () => li.removeEventListener('pointerenter', onEnter);
    });

    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (en) => {
          if (en[0]?.isIntersecting) {
            reveal();
            io?.disconnect();
          }
        },
        { threshold: 0.5 }
      );
      io.observe(root);
    } else reveal();

    return () => {
      io?.disconnect();
      offs.forEach((fn) => fn());
    };
  }, [items]);

  return (
    <ul ref={rootRef} className={`ux u426 ${className}`.trim()}>
      {items.map((st) => {
        let k = 0;
        return (
          <li key={st.label} className="u426-c" aria-label={`${st.value} ${st.label}`}>
            <span className="u426-n" aria-hidden="true">
              {st.value.split('').map((ch, ci) =>
                /\d/.test(ch) ? (
                  <span key={ci} className="u426-col">
                    <span data-d={ch} style={{ '--k': k++ }}>
                      {DIGITS.map((d, di) => (
                        <b key={di}>{d}</b>
                      ))}
                    </span>
                  </span>
                ) : (
                  <i key={ci}>{ch}</i>
                )
              )}
            </span>
            <small>{st.label}</small>
          </li>
        );
      })}
    </ul>
  );
}
