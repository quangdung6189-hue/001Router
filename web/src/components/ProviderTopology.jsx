import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Waypoints, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { ProviderLogo } from './ProviderLogo';

const CANVAS_W = 720;
const CANVAS_H = 410;
const HUB_W = 158;
const HUB_H = 54;
const NODE_W = 168;
const NODE_H = 52;
const ORB_COUNT = 3;

/**
 * Compute organic node coordinates so curves stay graceful for 1–12 providers
 * (avoids stiff vertical straight-line stacks on 2-provider setups).
 */
function computeLayout(count) {
  const cx = count === 1 ? 225 : CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  if (count === 1) {
    return { hub: { x: cx, y: cy }, positions: [{ x: 510, y: cy }] };
  }
  if (count === 2) {
    return {
      hub: { x: cx, y: cy },
      positions: [
        { x: 132, y: 170 },
        { x: 588, y: 240 },
      ],
    };
  }
  if (count === 3) {
    return {
      hub: { x: cx, y: 215 },
      positions: [
        { x: 142, y: 112 },
        { x: 578, y: 112 },
        { x: 360, y: 342 },
      ],
    };
  }
  if (count === 4) {
    return {
      hub: { x: cx, y: cy },
      positions: [
        { x: 136, y: 112 },
        { x: 584, y: 112 },
        { x: 136, y: 298 },
        { x: 584, y: 298 },
      ],
    };
  }

  const rx = count <= 6 ? 248 : 262;
  const ry = count <= 6 ? 138 : 150;
  const positions = Array.from({ length: count }, (_, idx) => {
    const angle = (idx / count) * Math.PI * 2;
    return {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    };
  });
  return { hub: { x: cx, y: cy }, positions };
}

/**
 * Compute clean edge-to-edge Bezier curve between Hub perimeter and Provider perimeter
 * so beams NEVER overlap node text or clip inside cards.
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
    sx = hub.x + dir * (HUB_W / 2 + 2);
    sy = hub.y;
    tx = node.x - dir * (NODE_W / 2 + 2);
    ty = node.y;
    const span = Math.max(48, Math.abs(tx - sx) * 0.5);
    c1x = sx + dir * span;
    c1y = sy;
    c2x = tx - dir * span;
    c2y = ty;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    sx = hub.x;
    sy = hub.y + dir * (HUB_H / 2 + 2);
    tx = node.x;
    ty = node.y - dir * (NODE_H / 2 + 2);
    const span = Math.max(44, Math.abs(ty - sy) * 0.52);
    c1x = sx;
    c1y = sy + dir * span;
    c2x = tx;
    c2y = ty - dir * span;
  }

  const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  return { d, sx, sy, tx, ty };
}

/**
 * Interactive 9Router-style Provider Topology graph.
 * Uses pure HTML cards overlaid on a silky SVG Bezier beam canvas so rounded borders,
 * outer shadows, and glow auras NEVER clip inside SVG foreignObject bounds.
 */
export function ProviderTopology({
  providers = [],
  activeRequests = {},
  errorProvider = null,
  byProvider = [],
}) {
  const [zoom, setZoom] = useState(1);
  const [simulatedSlug, setSimulatedSlug] = useState('');
  const pulseTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  const effectiveActive = useMemo(() => {
    const map = { ...(activeRequests || {}) };
    if (simulatedSlug) {
      map[simulatedSlug] = (map[simulatedSlug] || 0) + 1;
    }
    return map;
  }, [activeRequests, simulatedSlug]);

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
    const otherNodes = nodes.filter((n) => n.provider.slug !== simulatedSlug);
    const pool = otherNodes.length > 0 ? otherNodes : nodes;
    const pick = pool[Math.floor(Math.random() * pool.length)].provider.slug;
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    setSimulatedSlug(pick);
    pulseTimerRef.current = setTimeout(() => {
      setSimulatedSlug((prev) => (prev === pick ? '' : prev));
    }, 3200);
  };

  return (
    <div className="r-card relative flex h-[430px] flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Waypoints className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide text-[var(--text-primary)] uppercase">
            Live Provider Topology
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-emerald-400 ${
                activeTotal > 0 ? 'animate-pulse motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {activeTotal > 0 ? `${activeTotal} active` : 'SSE live'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {nodes.length > 0 ? (
            <button
              type="button"
              onClick={triggerPulse}
              className="r-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
              title="Simulate live beam animation"
            >
              <Zap className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
              Test Beam
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.12).toFixed(2))))}
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
            onClick={() => setZoom((z) => Math.min(1.3, Number((z + 0.12).toFixed(2))))}
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
              'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text-muted) 18%, transparent) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        >
          {/* Unified Zoomable Stage (exact 720x410 aspect ratio so SVG paths & HTML cards stay 100% aligned) */}
          <div
            className="relative h-full w-full max-w-[760px]"
            style={{
              aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Layer 1 (z-0): Silky SVG Bezier Edges + Soft Glows + Port Dots */}
            <svg
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible select-none"
              role="img"
              aria-label="Live provider routing topology graph"
            >
              <defs>
                <filter id="topo-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="4.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <filter id="topo-orb-glow" x="-120%" y="-120%" width="340%" height="340%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <radialGradient id="topo-orb-grad">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="45%" stopColor="#67e8f9" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </radialGradient>

                {nodes.map((node) => (
                  <linearGradient
                    key={`grad-${node.provider.id}`}
                    id={`topo-grad-${node.provider.id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={node.edge.sx}
                    y1={node.edge.sy}
                    x2={node.edge.tx}
                    y2={node.edge.ty}
                  >
                    <stop offset="0%" stopColor="#E56A4A" />
                    <stop offset="50%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                ))}
              </defs>

              {nodes.map((node) => {
                const { d, sx, sy, tx, ty } = node.edge;
                const edgeId = `edge-${node.provider.id}`;
                const gradUrl = `url(#topo-grad-${node.provider.id})`;

                if (!node.isActive) {
                  return (
                    <g key={edgeId}>
                      <path
                        d={d}
                        fill="none"
                        stroke={node.isErr ? '#ef4444' : 'var(--border-strong)'}
                        strokeWidth={node.isErr ? 2 : 1.5}
                        strokeOpacity={node.isErr ? 0.75 : 0.45}
                        strokeLinecap="round"
                        strokeDasharray={node.requests > 0 ? undefined : '5 5'}
                      />
                      <circle
                        cx={sx}
                        cy={sy}
                        r={2.6}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#ef4444' : 'var(--border-strong)'}
                        strokeWidth={1.3}
                      />
                      <circle
                        cx={tx}
                        cy={ty}
                        r={2.6}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#ef4444' : 'var(--border-strong)'}
                        strokeWidth={1.3}
                      />
                    </g>
                  );
                }

                return (
                  <g key={edgeId}>
                    {/* Soft ambient outer aura */}
                    <path
                      d={d}
                      fill="none"
                      stroke={gradUrl}
                      strokeWidth={9}
                      strokeOpacity={0.22}
                      strokeLinecap="round"
                      filter="url(#topo-soft-glow)"
                      className="topology-edge-halo"
                    />
                    {/* Continuous smooth gradient track */}
                    <path
                      d={d}
                      fill="none"
                      stroke={gradUrl}
                      strokeWidth={2.4}
                      strokeOpacity={0.92}
                      strokeLinecap="round"
                    />
                    {/* Soft plasma glide layer */}
                    <path
                      d={d}
                      fill="none"
                      stroke="#67e8f9"
                      strokeWidth={3}
                      strokeOpacity={0.5}
                      strokeLinecap="round"
                      filter="url(#topo-soft-glow)"
                      className="topology-edge-plasma"
                    />
                    {/* Silky white-cyan light pulse stream */}
                    <path
                      d={d}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={1.8}
                      strokeOpacity={0.85}
                      strokeLinecap="round"
                      className="topology-edge-kame"
                    />
                    {/* Illuminated endpoint port dots */}
                    <circle
                      cx={sx}
                      cy={sy}
                      r={3.5}
                      fill="#E56A4A"
                      stroke="var(--bg-card)"
                      strokeWidth={1.5}
                      filter="url(#topo-orb-glow)"
                    />
                    <circle
                      cx={tx}
                      cy={ty}
                      r={3.5}
                      fill="#34d399"
                      stroke="var(--bg-card)"
                      strokeWidth={1.5}
                      filter="url(#topo-orb-glow)"
                    />
                    {/* Smooth glowing light orbs */}
                    {Array.from({ length: ORB_COUNT }, (_, i) => (
                      <g key={`${edgeId}-orb-${i}`}>
                        <circle
                          r={6.5}
                          fill="url(#topo-orb-grad)"
                          opacity={0.85}
                        >
                          <animateMotion
                            dur="1.45s"
                            repeatCount="indefinite"
                            path={d}
                            begin={`${(i * 0.48).toFixed(2)}s`}
                          />
                        </circle>
                        <circle r={2.2} fill="#ffffff">
                          <animateMotion
                            dur="1.45s"
                            repeatCount="indefinite"
                            path={d}
                            begin={`${(i * 0.48).toFixed(2)}s`}
                          />
                        </circle>
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>

            {/* Layer 2 (z-10): Native HTML Provider Cards (crisp DPI, unclipped smooth shadows) */}
            {nodes.map((node) => (
              <div
                key={node.provider.id}
                style={{
                  left: `${(node.x / CANVAS_W) * 100}%`,
                  top: `${(node.y / CANVAS_H) * 100}%`,
                  width: `${(NODE_W / CANVAS_W) * 100}%`,
                  minWidth: '146px',
                  maxWidth: '182px',
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute z-10 flex h-[52px] items-center gap-2.5 rounded-xl border bg-[var(--bg-card)] px-3 py-2 transition-[border-color,box-shadow,transform] duration-300 ease-out ${
                  node.isActive
                    ? 'topology-node-active border-[#E56A4A]/80'
                    : node.isErr
                      ? 'border-red-500/70 shadow-[0_4px_18px_-4px_rgba(239,68,68,0.3)]'
                      : 'border-[var(--border-subtle)] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.28)] hover:border-[var(--border-strong)]'
                }`}
              >
                <ProviderLogo
                  preset={node.provider.preset || node.provider.slug}
                  name={node.provider.name}
                  size={26}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-[var(--text-primary)]">
                    {node.provider.name}
                  </div>
                  <div className="truncate font-mono text-[9.5px] text-[var(--text-muted)]">
                    {node.requests > 0 ? `${node.requests} req` : node.provider.slug}
                  </div>
                </div>
                {node.isActive ? (
                  <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </span>
                ) : null}
              </div>
            ))}

            {/* Layer 3 (z-20): Center 001Router Hub (opaque surface + soft unclipped breathing aura) */}
            <div
              style={{
                left: `${(hub.x / CANVAS_W) * 100}%`,
                top: `${(hub.y / CANVAS_H) * 100}%`,
                width: `${(HUB_W / CANVAS_W) * 100}%`,
                minWidth: '148px',
                maxWidth: '176px',
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute z-20 flex h-[54px] items-center justify-center gap-2.5 rounded-2xl border bg-[var(--bg-card)] px-3.5 py-2 transition-[border-color,box-shadow] duration-300 ease-out ${
                activeTotal > 0
                  ? 'topology-router-core border-[#E56A4A]/85'
                  : 'border-[#E56A4A]/65 shadow-[0_6px_22px_-6px_rgba(229,106,74,0.28)]'
              }`}
            >
              {/* Soft inner ambient sheen (clipped cleanly to rounded-2xl, never clips outer glow) */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 rounded-[15px] transition-opacity duration-500 ${
                  activeTotal > 0 ? 'opacity-100' : 'opacity-40'
                }`}
                style={{
                  background:
                    'linear-gradient(135deg, rgba(229, 106, 74, 0.16) 0%, rgba(56, 189, 248, 0.08) 65%, rgba(52, 211, 153, 0.12) 100%)',
                }}
              />
              <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
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
