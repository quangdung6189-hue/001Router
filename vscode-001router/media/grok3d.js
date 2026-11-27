(function () {
  "use strict";

  const REDUCED_MQ = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  const MOOD_PALETTES = {
    idle: {
      primary: [244, 246, 252],
      secondary: [168, 85, 247],
      accent: [229, 116, 82],
      speed: 0.72,
      pulse: 0.28
    },
    listening: {
      primary: [248, 250, 255],
      secondary: [229, 116, 82],
      accent: [168, 85, 247],
      speed: 1.05,
      pulse: 0.42
    },
    analyzing: {
      primary: [125, 211, 252],
      secondary: [99, 102, 241],
      accent: [244, 246, 252],
      speed: 1.45,
      pulse: 0.56
    },
    thinking: {
      primary: [216, 180, 254],
      secondary: [245, 158, 11],
      accent: [236, 72, 153],
      speed: 1.85,
      pulse: 0.72
    },
    executing: {
      primary: [56, 189, 248],
      secondary: [16, 185, 129],
      accent: [167, 139, 250],
      speed: 1.95,
      pulse: 0.68
    },
    terminal: {
      primary: [52, 211, 153],
      secondary: [56, 189, 248],
      accent: [250, 204, 21],
      speed: 2.05,
      pulse: 0.72
    },
    approval: {
      primary: [251, 191, 36],
      secondary: [249, 115, 22],
      accent: [255, 255, 255],
      speed: 1.15,
      pulse: 0.62
    },
    streaming: {
      primary: [255, 255, 255],
      secondary: [229, 116, 82],
      accent: [56, 189, 248],
      speed: 1.55,
      pulse: 0.64
    },
    happy: {
      primary: [244, 246, 252],
      secondary: [52, 211, 153],
      accent: [125, 211, 252],
      speed: 0.78,
      pulse: 0.34
    },
    done: {
      primary: [244, 246, 252],
      secondary: [16, 185, 129],
      accent: [168, 85, 247],
      speed: 0.75,
      pulse: 0.32
    },
    error: {
      primary: [252, 165, 165],
      secondary: [239, 68, 68],
      accent: [249, 115, 22],
      speed: 1.1,
      pulse: 0.5
    }
  };

  function rgba(rgb, a) {
    return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  function lerpRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rotate3D(x, y, z, rx, ry, rz) {
    // Rotate around X
    const cy = Math.cos(rx);
    const sy = Math.sin(rx);
    const y1 = y * cy - z * sy;
    const z1 = y * sy + z * cy;
    // Rotate around Y
    const cx = Math.cos(ry);
    const sx = Math.sin(ry);
    const x2 = x * cx + z1 * sx;
    const z2 = -x * sx + z1 * cx;
    // Rotate around Z
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    return {
      x: x2 * cz - y1 * sz,
      y: x2 * sz + y1 * cz,
      z: z2
    };
  }

  // Generate deterministic Fibonacci sphere lattice points for 3D holographic mesh
  function buildFibonacciShell(count, radius) {
    const pts = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;
      pts.push({
        x: Math.cos(theta) * r * radius,
        y: y * radius,
        z: Math.sin(theta) * r * radius,
        size: 0.8 + (i % 4) * 0.35,
        phase: (i * 0.71) % (Math.PI * 2)
      });
    }
    return pts;
  }

  function buildCosmicDust(count) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 5) * 0.31;
      const dist = 1.18 + ((i * 17) % 100) / 145;
      const yOff = ((((i * 37) % 100) / 100) - 0.5) * 0.72;
      pts.push({
        angle,
        dist,
        yOff,
        speed: (0.28 + ((i * 13) % 10) * 0.04) * (i % 2 === 0 ? 1 : -0.7),
        size: 0.65 + (i % 3) * 0.45,
        phase: i * 1.13
      });
    }
    return pts;
  }

  const HERO_SHELL = buildFibonacciShell(76, 1.04);
  const HERO_DUST = buildCosmicDust(44);
  const AVATAR_DUST = buildCosmicDust(14);

  /**
   * Draw one frame of the Grok-inspired 3D Singularity / Orbital Slash Core.
   */
  function renderCoreFrame(inst, t) {
    const { canvas, ctx, variant } = inst;
    const isHero = variant === "hero";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(30, Math.round(rect.width || (isHero ? 148 : 34)));
    const H = Math.max(30, Math.round(rect.height || (isHero ? 148 : 34)));

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const mood = canvas.dataset.mood || "idle";
    const isSing = canvas.dataset.singularity === "1";
    const pal = MOOD_PALETTES[mood] || MOOD_PALETTES.idle;
    const primary = isSing ? lerpRgb(pal.primary, [253, 224, 71], 0.28) : pal.primary;
    const secondary = isSing ? [236, 72, 153] : pal.secondary;
    const accent = isSing ? [168, 85, 247] : pal.accent;

    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = Math.min(W, H) * (isHero ? 0.275 : 0.31);
    const focal = R * 4.2;

    // Interactive tilt + orbital spin
    const tiltX = inst.rotX + Math.sin(t * 0.55) * 0.08;
    const tiltY = inst.rotY + t * 0.42 * pal.speed;
    const breath = 1 + Math.sin(t * 1.9) * 0.032 * pal.pulse;

    const project = (px, py, pz) => {
      const scale = focal / (focal + pz);
      return { x: cx + px * scale, y: cy + py * scale, z: pz, scale };
    };

    // 1. Ambient Volumetric Nebula Halo behind the 3D sphere
    const haloR = R * (isHero ? 2.15 : 1.75) * breath;
    const halo = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, haloR);
    halo.addColorStop(0, rgba(secondary, isSing ? 0.42 : 0.28));
    halo.addColorStop(0.45, rgba(accent, isSing ? 0.2 : 0.13));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Helper to draw a 3D tilted orbital ring split into back (z >= 0) and front (z < 0) passes
    const drawOrbitalRing = (pass, ringRadius, rx, ry, rz, lineWidth, colA, colB, alpha, withComet, cometSpeed) => {
      const segs = isHero ? 76 : 36;
      ctx.save();
      ctx.lineCap = "round";
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const p0 = rotate3D(Math.cos(a0) * ringRadius, Math.sin(a0) * ringRadius, 0, rx, ry, rz);
        const p1 = rotate3D(Math.cos(a1) * ringRadius, Math.sin(a1) * ringRadius, 0, rx, ry, rz);
        const midZ = (p0.z + p1.z) * 0.5;
        if (pass === "back" && midZ < 0) continue;
        if (pass === "front" && midZ >= 0) continue;

        const s0 = project(p0.x, p0.y, p0.z);
        const s1 = project(p1.x, p1.y, p1.z);
        const depthFactor = Math.max(0.22, Math.min(1, 0.72 - midZ / (ringRadius * 2.2)));
        const mix = 0.5 + 0.5 * Math.sin(a0 * 2 - t * 1.4);
        const col = lerpRgb(colA, colB, mix);

        ctx.strokeStyle = rgba(col, alpha * depthFactor);
        ctx.lineWidth = lineWidth * s0.scale;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }

      if (withComet) {
        const ca = t * cometSpeed;
        const cp = rotate3D(Math.cos(ca) * ringRadius, Math.sin(ca) * ringRadius, 0, rx, ry, rz);
        const isVisiblePass = (pass === "back" && cp.z >= 0) || (pass === "front" && cp.z < 0);
        if (isVisiblePass) {
          const sp = project(cp.x, cp.y, cp.z);
          const br = (isHero ? 5.5 : 2.6) * sp.scale;
          const cg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, br * 2.1);
          cg.addColorStop(0, "rgba(255,255,255,0.98)");
          cg.addColorStop(0.35, rgba(colA, 0.85));
          cg.addColorStop(1, rgba(colA, 0));
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, br * 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    // Grok signature diagonal slash orbital angle
    const slashRx = 1.18 + tiltX * 0.45;
    const slashRy = -0.58 + Math.sin(t * 0.35) * 0.08 + inst.dragY * 0.35;
    const slashRz = -0.52 + Math.cos(t * 0.25) * 0.05;

    // Gyroscopic telemetry rings
    const gyro1Rx = 1.05 + Math.sin(t * 0.65) * 0.25 + tiltX * 0.35;
    const gyro1Ry = t * 0.55 * pal.speed + inst.dragY;
    const gyro2Rx = -0.95 + Math.cos(t * 0.52) * 0.22 - tiltX * 0.25;
    const gyro2Ry = -t * 0.44 * pal.speed + inst.dragX;

    // 2. BACK PASS: Rings & Cosmic Dust behind the 3D Event Horizon Sphere
    drawOrbitalRing("back", R * 1.54 * breath, slashRx, slashRy, slashRz, isHero ? 3.2 : 1.7, primary, accent, 0.72, true, 1.35 * pal.speed);
    drawOrbitalRing("back", R * 1.34, gyro1Rx, gyro1Ry, 0.4, isHero ? 1.25 : 0.85, secondary, primary, 0.52, isHero, -1.7 * pal.speed);
    if (isHero) {
      drawOrbitalRing("back", R * 1.72, gyro2Rx, gyro2Ry, -0.35, 1.0, accent, secondary, 0.38, true, 0.95 * pal.speed);
    }

    const dustList = isHero ? HERO_DUST : AVATAR_DUST;
    for (let i = 0; i < dustList.length; i++) {
      const d = dustList[i];
      const a = d.angle + t * d.speed * pal.speed;
      const raw = rotate3D(Math.cos(a) * R * d.dist, d.yOff * R, Math.sin(a) * R * d.dist, tiltX * 0.6, inst.rotY * 0.5, -0.45);
      if (raw.z < 0) continue;
      const sp = project(raw.x, raw.y, raw.z);
      const tw = 0.55 + 0.45 * Math.sin(t * 2.1 + d.phase);
      ctx.fillStyle = rgba(i % 2 === 0 ? primary : secondary, 0.42 * tw);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, d.size * sp.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 3D OBSIDIAN EVENT HORIZON SPHERE (Core Body)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * breath, 0, Math.PI * 2);
    ctx.clip();

    // Deep obsidian base sphere with 3D spherical shading
    const lightX = cx - R * 0.36 + inst.ptrX * R * 0.22;
    const lightY = cy - R * 0.38 + inst.ptrY * R * 0.22;
    const coreGrad = ctx.createRadialGradient(lightX, lightY, R * 0.08, cx, cy, R * 1.15);
    coreGrad.addColorStop(0, "#242838");
    coreGrad.addColorStop(0.32, "#11131d");
    coreGrad.addColorStop(0.75, "#06070c");
    coreGrad.addColorStop(1, "#020305");
    ctx.fillStyle = coreGrad;
    ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

    // Inner volumetric plasma vortex swirling inside the glass orb
    ctx.globalCompositeOperation = "lighter";
    const swirlX1 = cx + Math.cos(t * 0.9 * pal.speed) * R * 0.34;
    const swirlY1 = cy + Math.sin(t * 0.75 * pal.speed) * R * 0.32;
    const p1 = ctx.createRadialGradient(swirlX1, swirlY1, 0, swirlX1, swirlY1, R * 0.88);
    p1.addColorStop(0, rgba(secondary, 0.58));
    p1.addColorStop(0.55, rgba(accent, 0.2));
    p1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = p1;
    ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

    const swirlX2 = cx + Math.cos(-t * 1.1 * pal.speed + 2.2) * R * 0.28;
    const swirlY2 = cy + Math.sin(-t * 0.85 * pal.speed + 1.4) * R * 0.28;
    const p2 = ctx.createRadialGradient(swirlX2, swirlY2, 0, swirlX2, swirlY2, R * 0.75);
    p2.addColorStop(0, rgba(accent, 0.52));
    p2.addColorStop(0.55, rgba(primary, 0.14));
    p2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = p2;
    ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

    // 3D Fibonacci neural lattice nodes inside/across front of the Hero orb
    if (isHero) {
      const frontNodes = [];
      for (let i = 0; i < HERO_SHELL.length; i++) {
        const pt = HERO_SHELL[i];
        const rp = rotate3D(pt.x * R * 0.92, pt.y * R * 0.92, pt.z * R * 0.92, tiltX, tiltY, 0.18);
        if (rp.z < R * 0.2) {
          const sp = project(rp.x, rp.y, rp.z);
          frontNodes.push({ ...sp, size: pt.size, phase: pt.phase });
        }
      }
      // Subtle neural web links between close foreground vertices
      for (let i = 0; i < frontNodes.length; i++) {
        const a = frontNodes[i];
        for (let j = i + 1; j < frontNodes.length; j++) {
          const b = frontNodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 290) {
            const k = 1 - Math.sqrt(d2) / 17.2;
            ctx.strokeStyle = rgba(primary, k * 0.26);
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const tw = 0.55 + 0.45 * Math.sin(t * 2.4 + a.phase);
        ctx.fillStyle = rgba(primary, 0.55 * tw);
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.size * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Curved specular glass highlight crest (makes the orb pop in 3D)
    ctx.globalCompositeOperation = "source-over";
    const spec = ctx.createRadialGradient(
      cx - R * 0.34,
      cy - R * 0.38,
      R * 0.04,
      cx - R * 0.24,
      cy - R * 0.28,
      R * 0.62
    );
    spec.addColorStop(0, "rgba(255,255,255,0.42)");
    spec.addColorStop(0.35, "rgba(255,255,255,0.1)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(cx, cy, R * breath, 0, Math.PI * 2);
    ctx.fill();

    // Inner Fresnel horizon rim
    const rimGrad = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * breath);
    rimGrad.addColorStop(0, "rgba(0,0,0,0)");
    rimGrad.addColorStop(0.8, rgba(secondary, 0.32));
    rimGrad.addColorStop(1, rgba(primary, 0.88));
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * breath, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crisp outer rim stroke around sphere
    ctx.strokeStyle = rgba(primary, 0.52);
    ctx.lineWidth = isHero ? 1.25 : 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, R * breath, 0, Math.PI * 2);
    ctx.stroke();

    // 4. FRONT PASS: Iconic Grok Diagonal Accretion Slash + Gyro Rings sweeping IN FRONT of sphere!
    // Soft bloom pass under the front slash
    drawOrbitalRing("front", R * 1.54 * breath, slashRx, slashRy, slashRz, isHero ? 8.5 : 3.8, secondary, accent, 0.28, false, 0);
    // Razor-bright incandescent Grok slash front arc
    drawOrbitalRing("front", R * 1.54 * breath, slashRx, slashRy, slashRz, isHero ? 2.8 : 1.55, [255, 255, 255], primary, 0.96, true, 1.35 * pal.speed);
    // Front gyroscopic telemetry rings
    drawOrbitalRing("front", R * 1.34, gyro1Rx, gyro1Ry, 0.4, isHero ? 1.35 : 0.9, secondary, primary, 0.76, isHero, -1.7 * pal.speed);
    if (isHero) {
      drawOrbitalRing("front", R * 1.72, gyro2Rx, gyro2Ry, -0.35, 1.1, accent, secondary, 0.56, true, 0.95 * pal.speed);
    }

    // 5. Foreground Cosmic Dust particles in front of the sphere
    for (let i = 0; i < dustList.length; i++) {
      const d = dustList[i];
      const a = d.angle + t * d.speed * pal.speed;
      const raw = rotate3D(Math.cos(a) * R * d.dist, d.yOff * R, Math.sin(a) * R * d.dist, tiltX * 0.6, inst.rotY * 0.5, -0.45);
      if (raw.z >= 0) continue;
      const sp = project(raw.x, raw.y, raw.z);
      const tw = 0.6 + 0.4 * Math.sin(t * 2.4 + d.phase);
      ctx.fillStyle = rgba(i % 3 === 0 ? [255, 255, 255] : i % 2 === 0 ? primary : accent, 0.82 * tw);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, d.size * sp.scale * 1.15, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Harmonic Streaming / Thinking Energy Pulse Wave
    if (isHero && (mood === "streaming" || mood === "thinking" || mood === "executing" || mood === "terminal" || mood === "approval")) {
      const wavePhase = (t * 0.7) % 1;
      const waveR = R * (1.05 + wavePhase * 1.1);
      ctx.strokeStyle = rgba(primary, (1 - wavePhase) * 0.35);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Global lightweight manager for all mounted 3D Grok canvases
  const instances = new Map();
  let rafId = 0;
  let paused = false;
  let lastNow = 0;
  let simTime = 0;

  function tick(now) {
    rafId = 0;
    if (paused || document.hidden || REDUCED_MQ.matches) return;
    const dt = lastNow ? Math.min(0.05, Math.max(0, (now - lastNow) / 1000)) : 0.016;
    lastNow = now;
    simTime += dt;

    let alive = 0;
    for (const [canvas, inst] of instances.entries()) {
      if (!canvas.isConnected) {
        instances.delete(canvas);
        continue;
      }
      alive++;
      // Smooth pointer tilt & inertial drag decay
      inst.rotX += (inst.targetRotX - inst.rotX) * Math.min(1, dt * 6);
      inst.rotY += (inst.targetRotY - inst.rotY) * Math.min(1, dt * 6);
      if (!inst.dragging) {
        inst.dragX += inst.velX * dt;
        inst.dragY += inst.velY * dt;
        inst.velX *= Math.exp(-dt * 3.5);
        inst.velY *= Math.exp(-dt * 3.5);
      }
      renderCoreFrame(inst, simTime);
    }

    if (alive > 0) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function ensureRunning() {
    if (paused || REDUCED_MQ.matches || document.hidden) {
      // Draw one clean static 3D frame so the core always looks sculpted
      for (const [canvas, inst] of instances.entries()) {
        if (canvas.isConnected) renderCoreFrame(inst, simTime || 1.4);
      }
      return;
    }
    if (!rafId && instances.size > 0) {
      lastNow = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function bindHeroInteraction(canvas, inst) {
    if (canvas.__grokBound) return;
    canvas.__grokBound = true;

    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / (r.width || 1) - 0.5) * 2;
      const ny = ((e.clientY - r.top) / (r.height || 1) - 0.5) * 2;
      inst.ptrX = nx;
      inst.ptrY = ny;
      inst.targetRotX = -ny * 0.42;
      inst.targetRotY = nx * 0.48;

      if (inst.dragging) {
        const dx = e.clientX - inst.lastPx;
        const dy = e.clientY - inst.lastPy;
        inst.lastPx = e.clientX;
        inst.lastPy = e.clientY;
        inst.dragY += dx * 0.015;
        inst.dragX += dy * 0.015;
        inst.velY = dx * 0.25;
        inst.velX = dy * 0.25;
      }
    }, { passive: true });

    canvas.addEventListener("pointerdown", (e) => {
      inst.dragging = true;
      inst.lastPx = e.clientX;
      inst.lastPy = e.clientY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    });

    const endDrag = () => {
      inst.dragging = false;
    };
    canvas.addEventListener("pointerup", endDrag, { passive: true });
    canvas.addEventListener("pointercancel", endDrag, { passive: true });
    canvas.addEventListener("pointerleave", () => {
      inst.dragging = false;
      inst.ptrX = 0;
      inst.ptrY = 0;
      inst.targetRotX = 0;
      inst.targetRotY = 0;
    }, { passive: true });
  }

  let resizeObs = null;
  if (typeof ResizeObserver === "function") {
    resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const inst = instances.get(entry.target);
        if (inst && entry.target.isConnected) {
          renderCoreFrame(inst, simTime || 1.4);
        }
      }
    });
  }

  function mountAll(rootEl) {
    const scope = rootEl || document;
    // Prune disconnected canvases
    for (const canvas of instances.keys()) {
      if (!canvas.isConnected) {
        resizeObs?.unobserve(canvas);
        instances.delete(canvas);
      }
    }
    const nodes = scope.querySelectorAll("canvas[data-grok3d]");
    nodes.forEach((canvas) => {
      if (!instances.has(canvas)) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const variant = canvas.dataset.grok3d || "avatar";
        const inst = {
          canvas,
          ctx,
          variant,
          ptrX: 0,
          ptrY: 0,
          rotX: 0,
          rotY: 0,
          targetRotX: 0,
          targetRotY: 0,
          dragX: 0,
          dragY: 0,
          velX: 0,
          velY: 0,
          dragging: false,
          lastPx: 0,
          lastPy: 0
        };
        instances.set(canvas, inst);
        resizeObs?.observe(canvas);
        if (variant === "hero") bindHeroInteraction(canvas, inst);
      }
    });
    ensureRunning();
  }

  function setPaused(nextPaused) {
    paused = Boolean(nextPaused);
    if (paused && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    ensureRunning();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!document.hidden) {
      ensureRunning();
    }
  });

  window.GrokSingularity3D = {
    mountAll,
    setPaused
  };
})();
