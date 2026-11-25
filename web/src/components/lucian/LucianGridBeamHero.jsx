import { useEffect, useRef } from 'react';
import './LucianGridBeamHero.css';

const BEAM_COLORS = ['229,106,74', '245,158,11', '52,211,153'];
const GRID_STEP = 40;

/**
 * Port of Lucian UX/UI #226 (Grid-beam hero background) adapted to 001Router's palette.
 * Glides photonic beams along grid lines and lights up the grid around the cursor.
 */
export function LucianGridBeamHero({ children, className = '' }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const cv = canvasRef.current;
    if (!root || !cv) return undefined;

    const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const onMove = (e) => {
      const r = root.getBoundingClientRect();
      root.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
      root.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
    };
    const onLeave = () => {
      root.style.setProperty('--mx', '-320px');
      root.style.setProperty('--my', '-320px');
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);

    if (rm) {
      return () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
      };
    }

    const cx = cv.getContext('2d');
    if (!cx) {
      return () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
      };
    }

    let W = 0;
    let H = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let beams = [];
    let acc = 0;
    let raf = 0;
    let last = 0;
    let visible = true;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      W = Math.max(320, Math.round(rect.width));
      H = Math.max(260, Math.round(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = () => {
      const vertical = Math.random() < 0.48;
      const span = vertical ? W : H;
      const maxCols = Math.max(2, Math.floor(span / GRID_STEP) - 1);
      const line = (1 + Math.floor(Math.random() * maxCols)) * GRID_STEP - 1;
      const dir = Math.random() < 0.5 ? 1 : -1;
      beams.push({
        v: vertical,
        l: line,
        p: dir > 0 ? -70 : (vertical ? H : W) + 70,
        d: dir,
        sp: 95 + Math.random() * 85,
        len: 58 + Math.random() * 48,
        c: BEAM_COLORS[Math.floor(Math.random() * BEAM_COLORS.length)],
      });
    };

    const draw = () => {
      cx.clearRect(0, 0, W, H);
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        const x0 = b.v ? b.l : b.p - b.d * b.len;
        const y0 = b.v ? b.p - b.d * b.len : b.l;
        const x1 = b.v ? b.l : b.p;
        const y1 = b.v ? b.p : b.l;
        const g = cx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(${b.c},0)`);
        g.addColorStop(0.75, `rgba(${b.c},0.7)`);
        g.addColorStop(1, `rgba(${b.c},0.96)`);
        cx.strokeStyle = g;
        cx.lineWidth = 1.6;
        cx.beginPath();
        cx.moveTo(x0 + 0.5, y0 + 0.5);
        cx.lineTo(x1 + 0.5, y1 + 0.5);
        cx.stroke();
        cx.fillStyle = `rgba(${b.c},0.95)`;
        cx.beginPath();
        cx.arc(x1 + 0.5, y1 + 0.5, 2, 0, Math.PI * 2);
        cx.fill();
      }
    };

    const frame = (now) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      acc += dt;
      if (acc > 0.45 && beams.length < 10) {
        acc = 0;
        spawn();
      }
      for (let i = 0; i < beams.length; i++) {
        beams[i].p += beams[i].d * beams[i].sp * dt;
      }
      beams = beams.filter((b) => {
        const lim = (b.v ? H : W) + 90;
        return b.d > 0 ? b.p < lim : b.p > -90;
      });
      draw();
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    for (let i = 0; i < 5; i++) {
      spawn();
      beams[i].p = (beams[i].v ? H : W) * (0.15 + i * 0.17);
    }
    draw();
    start();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(root);

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
    io?.observe(root);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <section ref={rootRef} className={`lucian-hero-stage ${className}`.trim()}>
      <div className="lucian-hero-grid" aria-hidden="true" />
      <div className="lucian-hero-grid-lit" aria-hidden="true" />
      <canvas ref={canvasRef} className="lucian-hero-canvas" aria-hidden="true" />
      <div className="lucian-hero-aura" aria-hidden="true" />
      <div className="relative z-10">{children}</div>
    </section>
  );
}
