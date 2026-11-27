import { useEffect, useRef } from 'react';
import './LucianGridBeamHero.css';

// Aligned with .landing-grid (32px) so photonic beams lock seamlessly onto the page grid
const GRID_STEP = 32;

const BEAM_PALETTE = [
  '229, 106, 74',  // 001Router coral
  '245, 158, 11',  // molten amber
  '167, 139, 250', // astral violet
  '52, 211, 153',  // aurora mint
];

const AURORA_ORBS = [
  { bx: 0.18, by: 0.24, r: 0.42, ph: 0.0, sp: 0.22, rgb: '229, 106, 74' },
  { bx: 0.82, by: 0.28, r: 0.38, ph: 1.9, sp: 0.19, rgb: '167, 139, 250' },
  { bx: 0.52, by: 0.18, r: 0.34, ph: 3.4, sp: 0.16, rgb: '245, 158, 11' },
  { bx: 0.72, by: 0.76, r: 0.36, ph: 4.8, sp: 0.21, rgb: '52, 211, 153' },
];

/**
 * Unified 60fps Celestial Hero Stage:
 * Combines ethereal drifting aurora clouds, interactive cursor-linked starlight constellation,
 * photonic grid beams, and click ripples inside a single rAF loop & single canvas.
 */
export function LucianGridBeamHero({ children, className = '', paused = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const root = rootRef.current;
    const cv = canvasRef.current;
    if (!root || !cv) return undefined;

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reduced = Boolean(mq?.matches);

    const cx = cv.getContext('2d', { alpha: true });
    if (!cx) return undefined;

    let W = 0;
    let H = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let rect = root.getBoundingClientRect();
    let rectDirty = false;
    let visible = true;
    let pageHidden = document.visibilityState === 'hidden';
    let raf = 0;
    let last = 0;
    let t = 0;
    let beamAcc = 0;

    // Pointer state (smoothly spring-interpolated for liquid aura tracking)
    const ptr = { active: false, tx: 0, ty: 0, x: 0, y: 0 };
    let nodes = [];
    let beams = [];
    let ripples = [];

    const isLightTheme = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'light') return true;
      if (attr === 'dark') return false;
      return !window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    };

    const refreshRect = () => {
      rect = root.getBoundingClientRect();
      rectDirty = false;
    };

    const seedNodes = () => {
      const count = Math.max(24, Math.min(46, Math.round((W * H) / 18500)));
      nodes = Array.from({ length: count }, (_, i) => {
        const z = 0.45 + (i % 7) * 0.09;
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * (14 + z * 12),
          vy: (Math.random() - 0.5) * (11 + z * 10),
          r: 1.05 + z * 1.35,
          z,
          phase: Math.random() * Math.PI * 2,
          rgb: BEAM_PALETTE[i % BEAM_PALETTE.length],
        };
      });
    };

    const spawnBeam = () => {
      const vertical = Math.random() < 0.48;
      const span = vertical ? W : H;
      const maxLines = Math.max(2, Math.floor(span / GRID_STEP) - 1);
      const line = (1 + Math.floor(Math.random() * maxLines)) * GRID_STEP;
      const dir = Math.random() < 0.5 ? 1 : -1;
      beams.push({
        v: vertical,
        l: line,
        p: dir > 0 ? -90 : (vertical ? H : W) + 90,
        d: dir,
        sp: 92 + Math.random() * 96,
        len: 68 + Math.random() * 64,
        rgb: BEAM_PALETTE[Math.floor(Math.random() * BEAM_PALETTE.length)],
      });
    };

    const resize = () => {
      refreshRect();
      W = Math.max(320, Math.round(rect.width));
      H = Math.max(280, Math.round(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!ptr.active) {
        ptr.x = ptr.tx = W * 0.5;
        ptr.y = ptr.ty = H * 0.36;
      }
      seedNodes();
    };

    const drawStaticOrFrame = (dt) => {
      const light = isLightTheme();
      const alphaScale = light ? 0.52 : 1;

      cx.clearRect(0, 0, W, H);

      // 1. Ethereal drifting aurora clouds + cursor follower orb
      cx.save();
      cx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      for (let i = 0; i < AURORA_ORBS.length; i++) {
        const orb = AURORA_ORBS[i];
        const ox = (orb.bx + Math.sin(t * orb.sp + orb.ph) * 0.11) * W;
        const oy = (orb.by + Math.cos(t * orb.sp * 0.85 + orb.ph * 1.2) * 0.1) * H;
        const rad = Math.max(W, H) * orb.r;
        const g = cx.createRadialGradient(ox, oy, 0, ox, oy, rad);
        g.addColorStop(0, `rgba(${orb.rgb}, ${(0.17 * alphaScale).toFixed(3)})`);
        g.addColorStop(0.45, `rgba(${orb.rgb}, ${(0.06 * alphaScale).toFixed(3)})`);
        g.addColorStop(1, `rgba(${orb.rgb}, 0)`);
        cx.fillStyle = g;
        cx.fillRect(0, 0, W, H);
      }

      if (ptr.active) {
        const pr = Math.min(W, H) * 0.38;
        const pg = cx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, pr);
        pg.addColorStop(0, `rgba(229, 106, 74, ${(0.18 * alphaScale).toFixed(3)})`);
        pg.addColorStop(0.42, `rgba(167, 139, 250, ${(0.09 * alphaScale).toFixed(3)})`);
        pg.addColorStop(1, 'rgba(229, 106, 74, 0)');
        cx.fillStyle = pg;
        cx.fillRect(0, 0, W, H);
      }
      cx.restore();

      // 2. Photonic grid beams
      if (!reduced) {
        for (let i = 0; i < beams.length; i++) {
          const b = beams[i];
          const x0 = b.v ? b.l : b.p - b.d * b.len;
          const y0 = b.v ? b.p - b.d * b.len : b.l;
          const x1 = b.v ? b.l : b.p;
          const y1 = b.v ? b.p : b.l;

          const grad = cx.createLinearGradient(x0, y0, x1, y1);
          grad.addColorStop(0, `rgba(${b.rgb}, 0)`);
          grad.addColorStop(0.68, `rgba(${b.rgb}, ${(0.55 * alphaScale).toFixed(3)})`);
          grad.addColorStop(1, `rgba(${b.rgb}, ${(0.95 * alphaScale).toFixed(3)})`);

          cx.strokeStyle = grad;
          cx.lineWidth = 1.65;
          cx.beginPath();
          cx.moveTo(x0 + 0.5, y0 + 0.5);
          cx.lineTo(x1 + 0.5, y1 + 0.5);
          cx.stroke();

          // Luminous comet head
          const halo = cx.createRadialGradient(x1 + 0.5, y1 + 0.5, 0, x1 + 0.5, y1 + 0.5, 7);
          halo.addColorStop(0, `rgba(255, 255, 255, ${(0.9 * alphaScale).toFixed(3)})`);
          halo.addColorStop(0.35, `rgba(${b.rgb}, ${(0.75 * alphaScale).toFixed(3)})`);
          halo.addColorStop(1, `rgba(${b.rgb}, 0)`);
          cx.fillStyle = halo;
          cx.beginPath();
          cx.arc(x1 + 0.5, y1 + 0.5, 7, 0, Math.PI * 2);
          cx.fill();
        }
      }

      // 3. Starlight constellation mesh
      const linkDist = 118;
      const ptrDist = 175;
      const linkDistSq = linkDist * linkDist;
      const ptrDistSq = ptrDist * ptrDist;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (!reduced && dt > 0) {
          a.x += a.vx * dt;
          a.y += a.vy * dt;
          if (a.x < -16) a.x = W + 16;
          else if (a.x > W + 16) a.x = -16;
          if (a.y < -16) a.y = H + 16;
          else if (a.y > H + 16) a.y = -16;
        }

        // Node-to-node filaments
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDistSq) {
            const k = 1 - Math.sqrt(d2) / linkDist;
            cx.strokeStyle = `rgba(${a.rgb}, ${(k * 0.22 * alphaScale).toFixed(3)})`;
            cx.lineWidth = 0.85;
            cx.beginPath();
            cx.moveTo(a.x, a.y);
            cx.lineTo(b.x, b.y);
            cx.stroke();
          }
        }

        // Cursor-to-node magnetic filaments
        if (ptr.active) {
          const dx = a.x - ptr.x;
          const dy = a.y - ptr.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < ptrDistSq) {
            const k = 1 - Math.sqrt(d2) / ptrDist;
            cx.strokeStyle = `rgba(${a.rgb}, ${(k * 0.55 * alphaScale).toFixed(3)})`;
            cx.lineWidth = 1.15;
            cx.beginPath();
            cx.moveTo(ptr.x, ptr.y);
            cx.lineTo(a.x, a.y);
            cx.stroke();
          }
        }

        // Gentle breathing starlight particle (slow period ~4.5s, never rapid flash)
        const pulse = 0.65 + 0.35 * Math.sin(t * 1.35 + a.phase);
        const nr = a.r * (0.9 + 0.25 * pulse);
        cx.fillStyle = `rgba(${a.rgb}, ${(0.72 * pulse * alphaScale).toFixed(3)})`;
        cx.beginPath();
        cx.arc(a.x, a.y, nr, 0, Math.PI * 2);
        cx.fill();
      }

      // 4. Interactive photonic click ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 240 * dt;
        rp.a = Math.max(0, 1 - rp.r / rp.maxR);
        if (rp.a <= 0.01) {
          ripples.splice(i, 1);
          continue;
        }
        cx.strokeStyle = `rgba(${rp.rgb}, ${(rp.a * 0.55 * alphaScale).toFixed(3)})`;
        cx.lineWidth = 1.5;
        cx.beginPath();
        cx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        cx.stroke();
      }
    };

    const frame = (now) => {
      raf = 0;
      if (!visible || pageHidden || pausedRef.current || reduced) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;

      // Smooth pointer inertia
      const ease = 1 - Math.pow(0.0012, dt);
      ptr.x += (ptr.tx - ptr.x) * ease;
      ptr.y += (ptr.ty - ptr.y) * ease;

      beamAcc += dt;
      if (beamAcc > 0.38 && beams.length < 11) {
        beamAcc = 0;
        spawnBeam();
      }
      for (let i = 0; i < beams.length; i++) {
        beams[i].p += beams[i].d * beams[i].sp * dt;
      }
      beams = beams.filter((b) => {
        const lim = (b.v ? H : W) + 110;
        return b.d > 0 ? b.p < lim : b.p > -110;
      });

      drawStaticOrFrame(dt);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduced || pausedRef.current) {
        drawStaticOrFrame(0);
        return;
      }
      if (!raf && visible && !pageHidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e) => {
      if (rectDirty) refreshRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      ptr.active = true;
      ptr.tx = lx;
      ptr.ty = ly;
      root.style.setProperty('--mx', `${Math.round(lx)}px`);
      root.style.setProperty('--my', `${Math.round(ly)}px`);
      if (reduced || pausedRef.current) {
        ptr.x = lx;
        ptr.y = ly;
        drawStaticOrFrame(0);
      }
    };

    const onLeave = () => {
      ptr.active = false;
      root.style.setProperty('--mx', '-340px');
      root.style.setProperty('--my', '-340px');
    };

    const onDown = (e) => {
      if (reduced || pausedRef.current) return;
      if (e.target?.closest?.('a, button, input, code')) return;
      if (rectDirty) refreshRect();
      ripples.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        r: 6,
        maxR: 190,
        a: 1,
        rgb: BEAM_PALETTE[Math.floor(Math.random() * BEAM_PALETTE.length)],
      });
    };

    const onScroll = () => {
      rectDirty = true;
    };

    const onVisibility = () => {
      pageHidden = document.visibilityState === 'hidden';
      if (!pageHidden) start();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onMediaChange = (e) => {
      reduced = e.matches;
      if (reduced && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      start();
    };

    resize();
    for (let i = 0; i < 6; i++) {
      spawnBeam();
      beams[i].p = (beams[i].v ? H : W) * (0.1 + i * 0.16);
    }
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

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });
    root.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    mq?.addEventListener?.('change', onMediaChange);

    // Expose resume trigger when paused prop flips from true -> false
    root.__heroResume = start;

    return () => {
      delete root.__heroResume;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      mq?.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  useEffect(() => {
    if (!paused) {
      rootRef.current?.__heroResume?.();
    }
  }, [paused]);

  return (
    <section
      ref={rootRef}
      data-paused={paused ? 'true' : 'false'}
      className={`lucian-hero-stage ${className}`.trim()}
    >
      <div className="lucian-hero-grid" aria-hidden="true" />
      <div className="lucian-hero-grid-lit" aria-hidden="true" />
      <div className="lucian-hero-orbit lucian-hero-orbit-a" aria-hidden="true" />
      <div className="lucian-hero-orbit lucian-hero-orbit-b" aria-hidden="true" />
      <canvas ref={canvasRef} className="lucian-hero-canvas" aria-hidden="true" />
      <div className="lucian-hero-aura" aria-hidden="true" />
      <div className="lucian-hero-vignette" aria-hidden="true" />
      <div className="relative z-10">{children}</div>
    </section>
  );
}
