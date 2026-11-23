import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Waypoints, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { formatCompactNumber } from '../lib/api';
import { ProviderLogo } from './ProviderLogo';

const CANVAS_W = 740;
const CANVAS_H = 410;
const HUB_W = 166;
const HUB_H = 56;
const NODE_W = 180;
const NODE_H = 56;
const COMET_COUNT = 2;

/**
 * Compute organic node coordinates so EVERY connection — even 1-to-1 —
 * forms a soft, modern S-curve conduit instead of a stiff horizontal rod.
 */
function computeLayout(count) {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  if (count === 1) {
    return {
      hub: { x: 186, y: 176 },
      positions: [{ x: 554, y: 234 }],
    };
  }
  if (count === 2) {
    return {
      hub: { x: cx, y: cy },
      positions: [
        { x: 130, y: 146 },
        { x: 610, y: 264 },
      ],
    };
  }
  if (count === 3) {
    return {
      hub: { x: cx, y: 210 },
      positions: [
        { x: 138, y: 108 },
        { x: 602, y: 108 },
        { x: cx, y: 344 },
      ],
    };
  }
  if (count === 4) {
    return {
      hub: { x: cx, y: cy },
      positions: [
        { x: 134, y: 108 },
        { x: 606, y: 108 },
        { x: 134, y: 302 },
        { x: 606, y: 302 },
      ],
    };
  }

  const rx = count <= 6 ? 256 : 270;
  const ry = count <= 6 ? 140 : 152;
  const positions = Array.from({ length: count }, (_, idx) => {
    const angle = (idx / count) * Math.PI * 2 - Math.PI / 6;
    return {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    };
  });
  return { hub: { x: cx, y: cy }, positions };
}

/**
 * Compute fluid edge-to-edge cubic Bezier curves with generous tangent tension
 * so connectors glide seamlessly out of sockets and never clip card borders.
 */
function buildEdgeGeometry(hub, node) {
  const dx = node.x - hub.x;
  const dy = node.y - hub.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy) * 0.85;

  let sx;
  let sy;
  let tx;
  let ty;
  let c1x;
  let c1y;
  let c2x;
  let c2y;

  if (horizontal) {
    const dir = dx >= 0 ? 1 : -1;
    sx = hub.x + dir * (HUB_W / 2 + 3);
    sy = hub.y;
    tx = node.x - dir * (NODE_W / 2 + 3);
    ty = node.y;
    const dist = Math.abs(tx - sx);
    const span = Math.max(76, dist * 0.56);
    c1x = sx + dir * span;
    c1y = sy;
    c2x = tx - dir * span;
    c2y = ty;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    sx = hub.x;
    sy = hub.y + dir * (HUB_H / 2 + 3);
    tx = node.x;
    ty = node.y - dir * (NODE_H / 2 + 3);
    const dist = Math.abs(ty - sy);
    const span = Math.max(54, dist * 0.56);
    c1x = sx;
    c1y = sy + dir * span;
    c2x = tx;
    c2y = ty - dir * span;
  }

  const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  return { d, sx, sy, tx, ty };
}

/**
 * Interactive Provider Topology graph with fluid glassmorphic Bezier conduits,
 * tangent-aligned photonic comet pulses, real provider logos, and light/dark harmony.
 */
export function ProviderTopology({
  providers = [],
  activeRequests = {},
  recentPulseSlugs = {},
  errorProvider = null,
  byProvider = [],
  sseLive = false,
}) {
  const uid = useId().replace(/:/g, '');
  const [zoom, setZoom] = useState(1);
  const [simulatedSlug, setSimulatedSlug] = useState('');
  const [hoveredSlug, setHoveredSlug] = useState('');
  const [motionPaused, setMotionPaused] = useState(false);
  const pulseTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  const effectiveActive = useMemo(() => {
    const map = { ...(activeRequests || {}) };
    for (const [slug, count] of Object.entries(recentPulseSlugs || {})) {
      if (Number(count) > 0) {
        map[slug] = (map[slug] || 0) + Number(count);
      }
    }
    if (simulatedSlug) {
      map[simulatedSlug] = (map[simulatedSlug] || 0) + 1;
    }
    return map;
  }, [activeRequests, recentPulseSlugs, simulatedSlug]);

  const activeTotal = useMemo(
    () => Object.values(effectiveActive).reduce((sum, n) => sum + (Number(n) || 0), 0),
    [effectiveActive]
  );

  const reqMap = useMemo(() => {
    const m = new Map();
    for (const p of byProvider || []) {
      m.set(p.provider, p);
    }
    return m;
  }, [byProvider]);

  const { hub, nodes } = useMemo(() => {
    const list = (providers || []).filter((p) => p.enabled !== false).slice(0, 12);
    const layout = computeLayout(list.length);
    const mapped = list.map((p, idx) => {
      const pos = layout.positions[idx] || { x: CANVAS_W / 2, y: CANVAS_H / 2 };
      const stats = reqMap.get(p.slug);
      const isActive = (effectiveActive[p.slug] || 0) > 0;
      const isErr = errorProvider?.provider === p.slug;
      const edge = buildEdgeGeometry(layout.hub, pos);
      return {
        provider: p,
        x: pos.x,
        y: pos.y,
        edge,
        isActive,
        isErr,
        requests: stats?.requests || 0,
        tokens: stats?.tokens || 0,
      };
    });
    return { hub: layout.hub, nodes: mapped };
  }, [providers, reqMap, effectiveActive, errorProvider]);

  const triggerPulse = () => {
    if (nodes.length === 0) return;
    if (motionPaused) setMotionPaused(false);
    const otherNodes = nodes.filter((n) => n.provider.slug !== simulatedSlug);
    const pool = otherNodes.length > 0 ? otherNodes : nodes;
    const pick = pool[Math.floor(Math.random() * pool.length)].provider.slug;
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    setSimulatedSlug(pick);
    pulseTimerRef.current = setTimeout(() => {
      setSimulatedSlug((prev) => (prev === pick ? '' : prev));
    }, 3400);
  };

  const softGlowId = `topo-soft-${uid}`;
  const cometGlowId = `topo-comet-${uid}`;
  const cometGradId = `topo-comet-grad-${uid}`;

  return (
    <div
      className={`r-card relative flex h-[430px] flex-col overflow-hidden ${
        motionPaused ? 'topology-paused' : ''
      }`}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Waypoints className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide text-[var(--text-primary)] uppercase">
            Live Provider Topology
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-500">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${
                activeTotal > 0 && !motionPaused ? 'animate-pulse motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {activeTotal > 0 ? `${activeTotal} flowing` : sseLive ? 'Live sync' : 'Ready'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {nodes.length > 0 ? (
            <>
              <button
                type="button"
                onClick={triggerPulse}
                className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
                title="Simulate live beam animation"
              >
                <Zap className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
                Test Beam
              </button>
              <button
                type="button"
                onClick={() => setMotionPaused((p) => !p)}
                aria-label={motionPaused ? 'Resume topology animation' : 'Pause topology animation'}
                title={motionPaused ? 'Resume animation' : 'Pause animation'}
                className="r-btn-secondary p-1"
              >
                {motionPaused ? (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.76, Number((z - 0.12).toFixed(2))))}
            aria-label="Zoom out topology"
            className="r-btn-secondary p-1"
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="Reset topology zoom"
            className="r-btn-secondary p-1"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.28, Number((z + 0.12).toFixed(2))))}
            aria-label="Zoom in topology"
            className="r-btn-secondary p-1"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E56A4A]/12 text-[#E56A4A]">
            <Waypoints className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            No connected providers in topology
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
            Connect one or more AI providers to visualize real-time routing beams from 001Router.
          </p>
        </div>
      ) : (
        <div
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--bg-main)]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 56%), radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text-muted) 16%, transparent) 1px, transparent 0)',
            backgroundSize: '100% 100%, 22px 22px',
          }}
        >
          {/* Unified Zoomable Stage */}
          <div
            className="relative h-full w-full max-w-[780px]"
            style={{
              aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Layer 1 (z-0): Fluid Fiber-Optic Bezier Conduits & Tangent-Aligned Comets */}
            <svg
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible select-none"
              role="img"
              aria-label="Live provider routing topology graph"
            >
              <defs>
                <filter id={softGlowId} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="5.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <filter id={cometGlowId} x="-150%" y="-150%" width="400%" height="400%">
                  <feGaussianBlur stdDeviation="3.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <linearGradient id={cometGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
                  <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.85" />
                  <stop offset="82%" stopColor="#10b981" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
                </linearGradient>

                {nodes.map((node) => (
                  <linearGradient
                    key={`grad-${node.provider.id}`}
                    id={`topo-grad-${uid}-${node.provider.id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={node.edge.sx}
                    y1={node.edge.sy}
                    x2={node.edge.tx}
                    y2={node.edge.ty}
                  >
                    <stop offset="0%" stopColor="#E56A4A" />
                    <stop offset="35%" stopColor="#F59E0B" />
                    <stop offset="72%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#10B981" />
                  </linearGradient>
                ))}
              </defs>

              {nodes.map((node) => {
                const { d, sx, sy, tx, ty } = node.edge;
                const edgeId = `edge-${node.provider.id}`;
                const gradUrl = `url(#topo-grad-${uid}-${node.provider.id})`;
                const isHighlighted = node.isActive || hoveredSlug === node.provider.slug;

                if (!node.isActive) {
                  return (
                    <g key={edgeId}>
                      {/* Soft recessed glass conduit sleeve */}
                      <path
                        d={d}
                        fill="none"
                        stroke={node.isErr ? '#ef4444' : 'var(--border-strong)'}
                        strokeWidth={isHighlighted ? 7.5 : 6}
                        strokeOpacity={node.isErr ? 0.14 : isHighlighted ? 0.16 : 0.1}
                        strokeLinecap="round"
                      />
                      {/* Primary crisp fiber path */}
                      <path
                        d={d}
                        fill="none"
                        stroke={
                          node.isErr
                            ? '#ef4444'
                            : isHighlighted
                              ? gradUrl
                              : 'var(--border-strong)'
                        }
                        strokeWidth={isHighlighted ? 2.2 : 1.75}
                        strokeOpacity={node.isErr ? 0.8 : isHighlighted ? 0.85 : 0.52}
                        strokeLinecap="round"
                        strokeDasharray={node.requests > 0 ? undefined : '5 6'}
                      />
                      {/* Delicate ambient silk shimmer when provider already has traffic */}
                      {node.requests > 0 && !node.isErr ? (
                        <path
                          d={d}
                          fill="none"
                          stroke={gradUrl}
                          strokeWidth={2.2}
                          strokeOpacity={isHighlighted ? 0.85 : 0.45}
                          strokeLinecap="round"
                          className="topology-edge-idle-shimmer"
                        />
                      ) : null}
                      {/* Flush layered connector sockets */}
                      <circle
                        cx={sx}
                        cy={sy}
                        r={4.2}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#ef4444' : isHighlighted ? '#E56A4A' : 'var(--border-strong)'}
                        strokeWidth={1.5}
                      />
                      <circle
                        cx={sx}
                        cy={sy}
                        r={1.7}
                        fill={node.isErr ? '#ef4444' : isHighlighted ? '#E56A4A' : 'var(--text-muted)'}
                      />
                      <circle
                        cx={tx}
                        cy={ty}
                        r={4.2}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#ef4444' : isHighlighted ? '#10B981' : 'var(--border-strong)'}
                        strokeWidth={1.5}
                      />
                      <circle
                        cx={tx}
                        cy={ty}
                        r={1.7}
                        fill={node.isErr ? '#ef4444' : isHighlighted ? '#10B981' : 'var(--text-muted)'}
                      />
                    </g>
                  );
                }

                return (
                  <g key={edgeId}>
                    {/* Soft ambient bloom ribbon */}
                    <path
                      d={d}
                      fill="none"
                      stroke={gradUrl}
                      strokeWidth={13}
                      strokeOpacity={0.2}
                      strokeLinecap="round"
                      filter={`url(#${softGlowId})`}
                      className="topology-edge-halo"
                    />
                    {/* Translucent glass tube base */}
                    <path
                      d={d}
                      fill="none"
                      stroke={gradUrl}
                      strokeWidth={5.5}
                      strokeOpacity={0.16}
                      strokeLinecap="round"
                    />
                    {/* Crisp luminous aurora fiber core */}
                    <path
                      d={d}
                      fill="none"
                      stroke={gradUrl}
                      strokeWidth={2.6}
                      strokeOpacity={0.94}
                      strokeLinecap="round"
                    />
                    {/* Silky flowing photonic wave */}
                    <path
                      d={d}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={1.75}
                      strokeOpacity={0.78}
                      strokeLinecap="round"
                      className="topology-edge-silk"
                    />
                    {/* Illuminated layered sockets */}
                    <circle
                      cx={sx}
                      cy={sy}
                      r={4.8}
                      fill="var(--bg-card)"
                      stroke="#E56A4A"
                      strokeWidth={1.8}
                      filter={`url(#${cometGlowId})`}
                    />
                    <circle cx={sx} cy={sy} r={2.2} fill="#E56A4A" />
                    <circle
                      cx={tx}
                      cy={ty}
                      r={4.8}
                      fill="var(--bg-card)"
                      stroke="#10B981"
                      strokeWidth={1.8}
                      filter={`url(#${cometGlowId})`}
                    />
                    <circle cx={tx} cy={ty} r={2.2} fill="#10B981" />

                    {/* Tangent-aligned silky photonic comets (paused cleanly when motionPaused) */}
                    {!motionPaused
                      ? Array.from({ length: COMET_COUNT }, (_, i) => (
                          <g key={`${edgeId}-comet-${i}`} filter={`url(#${cometGlowId})`}>
                            <ellipse rx={11} ry={3.2} fill={`url(#${cometGradId})`} opacity={0.92}>
                              <animateMotion
                                dur="1.65s"
                                repeatCount="indefinite"
                                path={d}
                                rotate="auto"
                                calcMode="spline"
                                keyTimes="0;1"
                                keySplines="0.35 0 0.25 1"
                                begin={`${(i * 0.82).toFixed(2)}s`}
                              />
                            </ellipse>
                            <ellipse rx={4.5} ry={1.5} fill="#ffffff" opacity={0.95}>
                              <animateMotion
                                dur="1.65s"
                                repeatCount="indefinite"
                                path={d}
                                rotate="auto"
                                calcMode="spline"
                                keyTimes="0;1"
                                keySplines="0.35 0 0.25 1"
                                begin={`${(i * 0.82).toFixed(2)}s`}
                              />
                            </ellipse>
                          </g>
                        ))
                      : null}
                  </g>
                );
              })}
            </svg>

            {/* Layer 2 (z-10): Glassmorphic Provider Nodes with Real Logos & Spring Hover */}
            {nodes.map((node) => (
              <div
                key={node.provider.id}
                onMouseEnter={() => setHoveredSlug(node.provider.slug)}
                onMouseLeave={() => setHoveredSlug('')}
                style={{
                  left: `${(node.x / CANVAS_W) * 100}%`,
                  top: `${(node.y / CANVAS_H) * 100}%`,
                  width: `${(NODE_W / CANVAS_W) * 100}%`,
                  minWidth: '154px',
                  maxWidth: '194px',
                  transform:
                    hoveredSlug === node.provider.slug
                      ? 'translate(-50%, calc(-50% - 2px)) scale(1.02)'
                      : 'translate(-50%, -50%)',
                }}
                className={`topology-card-spring absolute z-10 flex h-[56px] items-center gap-2.5 rounded-2xl border bg-[var(--bg-card)]/95 px-3 py-2 backdrop-blur-sm ${
                  node.isActive
                    ? 'topology-node-active border-emerald-500/75'
                    : node.isErr
                      ? 'border-red-500/70 shadow-[0_8px_24px_-8px_rgba(239,68,68,0.3)]'
                      : 'border-[var(--border-subtle)] shadow-[0_8px_22px_-10px_var(--ux-shadow-strong)] hover:border-[var(--border-strong)]'
                }`}
              >
                <ProviderLogo
                  preset={node.provider.preset || node.provider.slug}
                  logo={node.provider.logo}
                  logoExt={node.provider.logoExt}
                  color={node.provider.color}
                  name={node.provider.name}
                  size={30}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                    {node.provider.name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {node.requests > 0
                      ? `${node.requests} req${node.tokens > 0 ? ` · ${formatCompactNumber(node.tokens)} tok` : ''}`
                      : node.provider.slug}
                  </div>
                </div>
                {node.isActive ? (
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    {!motionPaused ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none" />
                    ) : null}
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                ) : node.isErr ? (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                ) : (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      node.requests > 0 ? 'bg-emerald-500/60' : 'bg-[var(--border-strong)]'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}

            {/* Layer 3 (z-20): Center 001Router Core Hub */}
            <div
              style={{
                left: `${(hub.x / CANVAS_W) * 100}%`,
                top: `${(hub.y / CANVAS_H) * 100}%`,
                width: `${(HUB_W / CANVAS_W) * 100}%`,
                minWidth: '154px',
                maxWidth: '184px',
                transform: 'translate(-50%, -50%)',
              }}
              className={`topology-card-spring absolute z-20 flex h-[56px] items-center justify-center gap-2.5 rounded-2xl border bg-[var(--bg-card)]/95 px-3.5 py-2 backdrop-blur-sm ${
                activeTotal > 0
                  ? 'topology-router-core border-[#E56A4A]/85'
                  : 'border-[#E56A4A]/55 shadow-[0_10px_28px_-10px_rgba(229,106,74,0.3)]'
              }`}
            >
              {activeTotal > 0 ? (
                <span
                  aria-hidden="true"
                  className="topology-core-ring pointer-events-none absolute -inset-1 rounded-[18px] border border-[#E56A4A]/45"
                />
              ) : null}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 rounded-[15px] transition-opacity duration-500 ${
                  activeTotal > 0 ? 'opacity-100' : 'opacity-45'
                }`}
                style={{
                  background:
                    'linear-gradient(135deg, rgba(229, 106, 74, 0.14) 0%, rgba(56, 189, 248, 0.08) 60%, rgba(16, 185, 129, 0.12) 100%)',
                }}
              />
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
                <Waypoints className="h-4 w-4" aria-hidden="true" />
              </div>
              <span className="relative text-xs font-bold tracking-tight text-[var(--text-primary)]">
                001Router
              </span>
              {activeTotal > 0 ? (
                <span className="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-amber-500 px-1.5 font-mono text-[10px] font-bold text-white shadow-xs">
                  {activeTotal}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
