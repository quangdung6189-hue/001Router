/* Lucian UX/UI Prompt #319 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#319 */
import { useEffect, useRef } from 'react';
import './lucian-319.css';

// 001Router brand palette (coral → amber → rose → mint → orange)
const PALETTE = ['#E56A4A', '#F59E0B', '#FB7185', '#34D399', '#EA580C'];
const S = 72;

function rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Cursor-following aurora (Lucian #319) as a full-bleed backdrop.
 * Pointer is tracked on the parent element so it works under hero content.
 */
export function LucianAuroraBackdrop() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const grainRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const cv = canvasRef.current;
    const gr = grainRef.current;
    const host = root?.parentElement;
    if (!root || !cv || !gr || !host) return undefined;
    const cx = cv.getContext('2d');
    if (!cx) return undefined;

    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const col = PALETTE.map(rgb);
    const B = [0, 1, 2, 3, 4].map((i) => ({
      bx: 0.2 + ((i * 0.37) % 0.7),
      by: 0.25 + ((i * 0.53) % 0.6),
      r: 0.38 + (i % 3) * 0.08,
      ph: i * 1.7,
      sp: 0.18 + i * 0.03,
    }));
    let ptr = null;
    const follow = { x: 0.5, y: 0.5 };

    // Film grain
    const n = document.createElement('canvas');
    n.width = n.height = 96;
    const nc = n.getContext('2d');
    if (nc) {
      const d = nc.createImageData(96, 96);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() * 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      nc.putImageData(d, 0, 0);
      gr.style.backgroundImage = `url(${n.toDataURL()})`;
    }

    const draw = (t) => {
      cx.globalCompositeOperation = 'source-over';
      cx.clearRect(0, 0, S, S);
      cx.globalCompositeOperation = 'lighter';
      B.forEach((b, i) => {
        let x = b.bx + Math.sin(t * b.sp + b.ph) * 0.18;
        let y = b.by + Math.cos(t * b.sp * 0.8 + b.ph * 1.3) * 0.16;
        if (ptr) {
          x += (ptr.x - x) * 0.18;
          y += (ptr.y - y) * 0.18;
        }
        if (i === 0) {
          x = follow.x;
          y = follow.y;
        }
        const c = col[i].join(',');
        const g = cx.createRadialGradient(x * S, y * S, 0, x * S, y * S, b.r * S);
        g.addColorStop(0, `rgba(${c},.85)`);
        g.addColorStop(1, `rgba(${c},0)`);
        cx.fillStyle = g;
        cx.fillRect(0, 0, S, S);
      });
    };

    let vis = true;
    let raf = 0;
    let last = 0;
    let t = 0;
    const frame = (now) => {
      raf = 0;
      if (!root.isConnected || !vis) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      const aim = ptr || { x: 0.3 + Math.sin(t * 0.21) * 0.15, y: 0.35 + Math.cos(t * 0.17) * 0.12 };
      const f = 1 - Math.pow(0.15, dt);
      follow.x += (aim.x - follow.x) * f;
      follow.y += (aim.y - follow.y) * f;
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (rm) {
        draw(2);
        return;
      }
      if (!raf && vis) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const io =
      'IntersectionObserver' in window
        ? new IntersectionObserver((es) => {
            vis = Boolean(es[0]?.isIntersecting);
            run();
          })
        : null;
    io?.observe(root);

    const onMove = (e) => {
      const r = host.getBoundingClientRect();
      ptr = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      if (rm) draw(2);
    };
    const onLeave = () => {
      ptr = null;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    run();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={rootRef} className="ux u319" aria-hidden="true">
      <canvas ref={canvasRef} width={S} height={S} />
      <div ref={grainRef} className="u319-gr" />
      <div className="u319-fade" />
    </div>
  );
}
