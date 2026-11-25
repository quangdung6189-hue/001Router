import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Cpu, Loader2, Waypoints, Zap } from 'lucide-react';
import { formatCompactNumber, providersApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { ProviderLogo } from './ProviderLogo';

const CANVAS_W = 900;
const CANVAS_H = 390;
const HUB_W = 176;
const HUB_H = 74;
const COMET_COUNT = 3;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.9;

/** Curated brand accents so each provider's conduit & aura feels unmistakable. */
const PROVIDER_ACCENTS = {
  anthropic: '#D97757',
  claude: '#D97757',
  openai: '#10A37F',
  codex: '#10A37F',
  gemini: '#4285F4',
  antigravity: '#6366F1',
  deepseek: '#4D6BFE',
  kimi: '#38BDF8',
  'kimi-coding': '#38BDF8',
  openrouter: '#8B5CF6',
  groq: '#F97316',
  mistral: '#F59E0B',
  cerebras: '#FF6B00',
  nvidia: '#76B900',
  xai: '#94A3B8',
  nous: '#EC4899',
  kilocode: '#F59E0B',
  gitlab: '#FC6D26',
  ollama: '#38BDF8',
};

function resolveProviderAccent(provider) {
  if (typeof provider?.color === 'string' && /^#[0-9a-f]{6}$/i.test(provider.color)) {
    return provider.color;
  }
  const key = String(provider?.preset || provider?.slug || '').toLowerCase();
  return PROVIDER_ACCENTS[key] || '#E56A4A';
}

function stripProviderPrefix(modelId, slug) {
  const raw = String(modelId || '').trim();
  if (!raw) return '';
  if (slug && raw.toLowerCase().startsWith(`${String(slug).toLowerCase()}/`)) {
    return raw.slice(slug.length + 1);
  }
  return raw;
}

function formatShortProviderName(name = '') {
  const clean = String(name || '').trim();
  if (clean.length <= 22) return clean;
  // Keep meaningful brand names legible instead of cutting mid-word (e.g. "Antigravity (Google)")
  return clean.replace(/\s*\(Google\)\s*$/i, ' · Google').replace(/\s+Official\s*$/i, '');
}

/**
 * Subscribe to prefers-reduced-motion so SVG <animateMotion> respects OS preferences
 * alongside CSS @media (prefers-reduced-motion).
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

/**
 * Balanced Bilateral Circuit Layout:
 * Places 001Router dead-center and fans providers into symmetric Left and Right wings
 * with gentle aerodynamic X-arcing and dedicated non-overlapping vertical port pins on the hub.
 */
function computeBilateralLayout(count) {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const nodeW = count <= 6 ? 232 : count <= 8 ? 218 : 206;
  const nodeH = count <= 6 ? 68 : count <= 8 ? 58 : 50;

  if (count === 0) {
    return { hub: { x: cx, y: cy }, nodeW, nodeH, slots: [] };
  }

  if (count === 1) {
    return {
      hub: { x: 248, y: cy },
      nodeW: 244,
      nodeH: 72,
      slots: [
        {
          x: 648,
          y: cy,
          side: 'right',
          hubPinOffsetY: 0,
        },
      ],
    };
  }

  // Distribute symmetrically: even indices -> left wing, odd indices -> right wing.
  // That mirrors top-2 traffic providers directly across from each other.
  const leftIndices = [];
  const rightIndices = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) leftIndices.push(i);
    else rightIndices.push(i);
  }

  const slots = new Array(count);

  const placeWing = (indices, side) => {
    const n = indices.length;
    const dir = side === 'right' ? 1 : -1;
    const baseDistX = count <= 6 ? 312 : 322;
    const padY = n <= 2 ? 84 : n === 3 ? 62 : n === 4 ? 48 : 38;
    const usableH = Math.max(120, CANVAS_H - padY * 2);
    const maxPinSpread = Math.min(44, Math.max(0, (n - 1) * 14));

    indices.forEach((origIdx, row) => {
      const t = n === 1 ? 0.5 : row / (n - 1);
      const centered = t - 0.5; // -0.5 .. +0.5
      const y = n === 1 ? cy : padY + t * usableH;
      // Subtle concave arc around the center hub so conduits look fluid and aerodynamic.
      const arcShift = n >= 3 ? (1 - Math.abs(centered) * 2) * 16 : 0;
      const x = cx + dir * (baseDistX + arcShift);
      const hubPinOffsetY = n === 1 ? 0 : centered * maxPinSpread;

      slots[origIdx] = {
        x,
        y,
        side,
        hubPinOffsetY,
      };
    });
  };

  placeWing(leftIndices, 'left');
  placeWing(rightIndices, 'right');

  return {
    hub: { x: cx, y: cy },
    nodeW,
    nodeH,
    slots,
  };
}

/**
 * Monotonic horizontal cubic Bezier conduit from the hub's dedicated port pin
 * directly into the provider card's inner socket. Guaranteed zero crossing or back-loops.
 */
function buildConduitGeometry(hub, slot, nodeW) {
  const dir = slot.side === 'right' ? 1 : -1;
  const sx = hub.x + dir * (HUB_W / 2 + 4);
  const sy = hub.y + (slot.hubPinOffsetY || 0);
  const tx = slot.x - dir * (nodeW / 2 + 4);
  const ty = slot.y;

  const dist = Math.abs(tx - sx);
  const handle = Math.max(46, dist * 0.48);
  const c1x = sx + dir * handle;
  const c1y = sy;
  const c2x = tx - dir * handle;
  const c2y = ty;

  const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  const dRev = `M ${tx.toFixed(1)} ${ty.toFixed(1)} C ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;

  return { d, dRev, sx, sy, tx, ty, midX, midY };
}

/**
 * Interactive Live Provider Topology with bilateral fiber-optic conduits,
 * per-provider brand gradients, synchronized outbound/return request beams,
 * live active model display, and interactive model route dock.
 */
export function ProviderTopology({
  providers = [],
  activeRequests = {},
  activeModels = {},
  recentPulseSlugs = {},
  recentPulses = {},
  recentRequests = [],
  errorProvider = null,
  byProvider = [],
  byModel = [],
  sseLive = false,
  highlightedSlug = '',
  selectedSlug: controlledSelectedSlug,
  onSelectProvider,
  onHoverProvider,
}) {
  const uid = useId().replace(/:/g, '');
  const { showToast } = useToast();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredSlug, setHoveredSlug] = useState('');
  const [internalSelectedSlug, setInternalSelectedSlug] = useState('');
  const selectedSlug =
    controlledSelectedSlug !== undefined ? controlledSelectedSlug : internalSelectedSlug;
  const setSelectedSlug = useCallback(
    (next) => {
      if (controlledSelectedSlug === undefined) {
        setInternalSelectedSlug(next);
      }
      onSelectProvider?.(next);
    },
    [controlledSelectedSlug, onSelectProvider]
  );

  // Real live-token probe beams keyed by slug:
  // { phase: 'outbound' | 'return' | 'error', model, status?, latencyMs?, tokens?, reply?, message?, seq }
  const [probeBeams, setProbeBeams] = useState({});
  const probeTimersRef = useRef([]);
  const probeCursorRef = useRef(0);
  const mountedRef = useRef(true);
  const stageContainerRef = useRef(null);
  const dragStateRef = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const tid of probeTimersRef.current) clearTimeout(tid);
      probeTimersRef.current = [];
    };
  }, []);

  // Mouse-wheel zoom directly on topology stage (no zoom buttons needed)
  const hasEnabledProviders = (providers || []).some((p) => p.enabled !== false);
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rawStep = Math.abs(e.deltaY) * 0.0014;
      const step = Math.min(0.16, Math.max(0.04, rawStep));
      const direction = e.deltaY < 0 ? 1 : -1;
      setZoom((prev) => {
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, Number((prev + direction * step).toFixed(3)))
        );
        if (next <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasEnabledProviders]);

  const animationsEnabled = !prefersReducedMotion;

  const reqMap = useMemo(() => {
    const m = new Map();
    for (const p of byProvider || []) {
      m.set(p.provider, p);
    }
    return m;
  }, [byProvider]);

  // Group historical model usage per provider, sorted by request volume desc.
  const modelsByProvider = useMemo(() => {
    const map = new Map();
    for (const row of byModel || []) {
      const slug = row.provider;
      if (!slug) continue;
      const cleanId = stripProviderPrefix(row.model, slug);
      if (!cleanId) continue;
      const arr = map.get(slug) || [];
      arr.push({
        id: cleanId,
        requests: Number(row.requests) || 0,
        tokens: Number(row.tokens) || 0,
        errors: Number(row.errors) || 0,
      });
      map.set(slug, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.requests - a.requests || b.tokens - a.tokens || a.id.localeCompare(b.id));
    }
    return map;
  }, [byModel]);

  // Most recent completed request per provider (for fallback model badge / last latency).
  const lastRequestBySlug = useMemo(() => {
    const map = new Map();
    for (const r of recentRequests || []) {
      if (!r?.provider || map.has(r.provider)) continue;
      const code =
        typeof r.httpStatus === 'number'
          ? r.httpStatus
          : typeof r.status === 'number'
            ? r.status
            : r.status === 'ok'
              ? 200
              : 500;
      map.set(r.provider, {
        model: stripProviderPrefix(r.model || r.resolvedModel || r.requestedModel || '', r.provider),
        latencyMs: Number(r.latencyMs) || 0,
        tokens: (Number(r.promptTokens) || 0) + (Number(r.completionTokens) || 0),
        httpStatus: code,
        ok: r.status === 'ok' || (code >= 200 && code < 400),
      });
    }
    return map;
  }, [recentRequests]);

  // Build stable ordered list of enabled providers sorted by traffic so coordinates never jump mid-flight.
  const sortedProviders = useMemo(() => {
    const enabled = (providers || []).filter((p) => p.enabled !== false);
    const copy = [...enabled];
    copy.sort((a, b) => {
      const ra = Number(reqMap.get(a.slug)?.requests || 0);
      const rb = Number(reqMap.get(b.slug)?.requests || 0);
      if (rb !== ra) return rb - ra;
      const ma = Array.isArray(a.models) ? a.models.length : 0;
      const mb = Array.isArray(b.models) ? b.models.length : 0;
      if (mb !== ma) return mb - ma;
      return String(a.name || a.slug).localeCompare(String(b.name || b.slug));
    });
    return copy.slice(0, 12);
  }, [providers, reqMap]);

  // Combine live in-flight state, recent completion pulse, and real token probe beams.
  const { hub, nodeW, nodeH, nodes, activeTotal, totalConfiguredModels } = useMemo(() => {
    const layout = computeBilateralLayout(sortedProviders.length);
    let flowingSum = 0;
    let modelSum = 0;

    const mapped = sortedProviders.map((p, idx) => {
      const slot = layout.slots[idx] || {
        x: CANVAS_W / 2,
        y: CANVAS_H / 2,
        side: 'right',
        hubPinOffsetY: 0,
      };
      const stats = reqMap.get(p.slug);
      const inFlightCount = Number(activeRequests?.[p.slug] || 0);
      const pulseInfo = recentPulses?.[p.slug] || null;
      const pulseCount = Number(recentPulseSlugs?.[p.slug] || 0) || (pulseInfo ? 1 : 0);
      const probe = probeBeams[p.slug] || null;
      const isInFlight = inFlightCount > 0 || probe?.phase === 'outbound';
      const isReturning = !isInFlight && (pulseCount > 0 || probe?.phase === 'return');
      const isActive = isInFlight || isReturning;

      const lastReq = lastRequestBySlug.get(p.slug) || null;
      const hasPulseError =
        probe?.phase === 'error' ||
        Boolean(pulseInfo && pulseInfo.ok === false) ||
        (!isInFlight && errorProvider?.provider === p.slug);

      if (isInFlight) flowingSum += Math.max(1, inFlightCount);
      else if (isReturning) flowingSum += 1;

      const liveModelList = Array.isArray(activeModels?.[p.slug]) ? activeModels[p.slug] : [];
      const usedModels = modelsByProvider.get(p.slug) || [];
      const configuredModels = Array.isArray(p.models)
        ? p.models.map((m) => stripProviderPrefix(m, p.slug)).filter(Boolean)
        : [];
      modelSum += configuredModels.length;

      // Ranked model catalog for this provider: live running -> recently used -> configured.
      const seen = new Set();
      const rankedModels = [];
      const pushModel = (id, meta = {}) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        rankedModels.push({ id, ...meta });
      };

      for (const m of liveModelList) {
        const hist = usedModels.find((u) => u.id === m);
        pushModel(m, { live: true, requests: hist?.requests || 0, tokens: hist?.tokens || 0 });
      }
      if (probe?.model) {
        const hist = usedModels.find((u) => u.id === probe.model);
        pushModel(probe.model, {
          live: probe.phase === 'outbound',
          recent: probe.phase !== 'outbound',
          ok: probe.phase === 'return',
          requests: hist?.requests || 0,
          tokens: hist?.tokens || 0,
        });
      }
      if (pulseInfo?.model) {
        const hist = usedModels.find((u) => u.id === pulseInfo.model);
        pushModel(pulseInfo.model, {
          recent: true,
          ok: pulseInfo.ok,
          latencyMs: pulseInfo.latencyMs,
          requests: hist?.requests || 0,
          tokens: hist?.tokens || 0,
        });
      }
      for (const u of usedModels) {
        pushModel(u.id, { requests: u.requests, tokens: u.tokens, errors: u.errors });
      }
      for (const m of configuredModels) {
        pushModel(m, { requests: 0, tokens: 0 });
      }

      const activeModelLabel =
        liveModelList[0] ||
        probe?.model ||
        pulseInfo?.model ||
        lastReq?.model ||
        rankedModels[0]?.id ||
        '';

      const telemetry =
        probe?.phase === 'return' || probe?.phase === 'error'
          ? {
              ok: probe.phase === 'return',
              httpStatus: probe.status || (probe.phase === 'return' ? 200 : 'ERR'),
              latencyMs: probe.latencyMs || 0,
              tokens: probe.tokens || 0,
              reply: probe.reply || '',
            }
          : pulseInfo
            ? {
                ok: pulseInfo.ok,
                httpStatus: pulseInfo.httpStatus,
                latencyMs: pulseInfo.latencyMs,
                tokens: pulseInfo.tokens,
              }
            : null;

      return {
        provider: p,
        accent: resolveProviderAccent(p),
        x: slot.x,
        y: slot.y,
        side: slot.side,
        edge: buildConduitGeometry(layout.hub, slot, layout.nodeW),
        isInFlight,
        isReturning,
        isActive,
        inFlightCount: inFlightCount || (probe?.phase === 'outbound' ? 1 : 0),
        isErr: hasPulseError,
        requests: Number(stats?.requests || 0),
        tokens: Number(stats?.tokens || 0),
        activeModelLabel,
        rankedModels,
        totalModels: Math.max(configuredModels.length, rankedModels.length),
        telemetry,
      };
    });

    return {
      hub: layout.hub,
      nodeW: layout.nodeW,
      nodeH: layout.nodeH,
      nodes: mapped,
      activeTotal: flowingSum,
      totalConfiguredModels: modelSum,
    };
  }, [
    sortedProviders,
    reqMap,
    activeRequests,
    activeModels,
    recentPulseSlugs,
    recentPulses,
    probeBeams,
    lastRequestBySlug,
    errorProvider,
    modelsByProvider,
  ]);

  const effectiveFocusSlug = hoveredSlug || highlightedSlug || selectedSlug;
  const isBeamProbing = useMemo(
    () => Object.values(probeBeams).some((b) => b?.phase === 'outbound'),
    [probeBeams]
  );

  // Fire a zero-token live connectivity probe (GET /models / loadCodeAssist / oauth usage — 0 tokens burned).
  const runLiveBeamProbe = async (targetNode) => {
    if (!targetNode?.provider?.id) return;
    const slug = targetNode.provider.slug;
    if (probeBeams[slug]?.phase === 'outbound') return;

    const displayModel =
      targetNode.activeModelLabel ||
      targetNode.rankedModels[0]?.id ||
      stripProviderPrefix(targetNode.provider.models?.[0] || '', slug) ||
      '';
    const seq = Date.now() + Math.random();
    const startedAt = performance.now();

    // Phase 1: Outbound streaming request beam while the 0-token auth/endpoint test runs
    setProbeBeams((prev) => ({
      ...prev,
      [slug]: { phase: 'outbound', model: displayModel, seq },
    }));

    const scheduleClear = (delayMs) => {
      const tid = setTimeout(() => {
        if (!mountedRef.current) return;
        setProbeBeams((prev) => {
          if (prev[slug]?.seq !== seq) return prev;
          const next = { ...prev };
          delete next[slug];
          return next;
        });
      }, delayMs);
      probeTimersRef.current.push(tid);
    };

    try {
      const result = await providersApi.test(targetNode.provider.id, '', { zeroToken: true });
      if (!mountedRef.current) return;

      const latencyMs = Number(result?.latencyMs) || Math.max(1, Math.round(performance.now() - startedAt));
      const modelsCount = Number(result?.modelsCount) || 0;

      if (result?.ok) {
        setProbeBeams((prev) => {
          if (prev[slug]?.seq !== seq) return prev;
          return {
            ...prev,
            [slug]: {
              phase: 'return',
              model: displayModel,
              status: result.status || 200,
              latencyMs,
              tokens: 0,
              reply: modelsCount > 0 ? `${modelsCount} models` : '0 tok',
              seq,
            },
          };
        });
        showToast(
          `${targetNode.provider.name}: Kết nối OK (${latencyMs}ms · 0 token${
            modelsCount > 0 ? ` · ${modelsCount} models` : ''
          })`,
          'success'
        );
      } else {
        const errMsg = result?.message || `HTTP ${result?.status || 'ERR'}`;
        setProbeBeams((prev) => {
          if (prev[slug]?.seq !== seq) return prev;
          return {
            ...prev,
            [slug]: {
              phase: 'error',
              model: displayModel,
              status: result?.status || 'ERR',
              latencyMs,
              message: errMsg,
              seq,
            },
          };
        });
        showToast(`${targetNode.provider.name}: ${errMsg}`, 'error');
      }
      scheduleClear(4200);
    } catch (err) {
      if (!mountedRef.current) return;
      const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
      const errMsg = err?.message || 'Test request failed';
      setProbeBeams((prev) => {
        if (prev[slug]?.seq !== seq) return prev;
        return {
          ...prev,
          [slug]: {
            phase: 'error',
            model: displayModel,
            status: Number(err?.status) || 'ERR',
            latencyMs,
            message: errMsg,
            seq,
          },
        };
      });
      showToast(`${targetNode.provider.name}: ${errMsg}`, 'error');
      scheduleClear(4200);
    }
  };

  const triggerBeamTest = () => {
    if (nodes.length === 0) return;
    const pinned = selectedSlug ? nodes.find((n) => n.provider.slug === selectedSlug) : null;
    if (pinned) {
      runLiveBeamProbe(pinned);
      return;
    }
    const idx = probeCursorRef.current % nodes.length;
    probeCursorRef.current += 1;
    const chosen = nodes[idx];
    if (chosen) {
      setSelectedSlug(chosen.provider.slug);
      runLiveBeamProbe(chosen);
    }
  };

  const handleStagePointerDown = (e) => {
    if (e.button !== 0 || zoom <= 1) return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
  };

  const handleStagePointerMove = (e) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      setIsPanning(true);
    }
    if (drag.moved) {
      const maxOffsetX = Math.max(120, ((zoom - 1) * CANVAS_W) / 2 + 80);
      const maxOffsetY = Math.max(90, ((zoom - 1) * CANVAS_H) / 2 + 60);
      setPan({
        x: Math.max(-maxOffsetX, Math.min(maxOffsetX, drag.originX + dx)),
        y: Math.max(-maxOffsetY, Math.min(maxOffsetY, drag.originY + dy)),
      });
    }
  };

  const handleStagePointerUp = () => {
    const drag = dragStateRef.current;
    if (drag?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragStateRef.current = null;
    setIsPanning(false);
  };

  const handleStageDoubleClick = (e) => {
    if (e.target.closest('button')) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleNodeHover = (slug) => {
    setHoveredSlug(slug);
    onHoverProvider?.(slug);
  };

  const handleNodeClick = (slug) => {
    if (suppressClickRef.current) return;
    const next = selectedSlug === slug ? '' : slug;
    setSelectedSlug(next);
  };

  const softGlowId = `topo-soft-${uid}`;
  const cometGlowId = `topo-comet-${uid}`;
  const returnGradId = `topo-ret-grad-${uid}`;
  const errorGradId = `topo-err-grad-${uid}`;

  return (
    <div className="r-card topology-shell relative flex h-[468px] flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Waypoints className="h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
          <span className="truncate text-xs font-semibold tracking-wide text-[var(--text-primary)] uppercase">
            Live Provider Topology
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
              activeTotal > 0
                ? 'bg-[#E56A4A]/15 text-[#E56A4A]'
                : 'bg-emerald-500/12 text-emerald-500'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                activeTotal > 0 ? 'bg-[#E56A4A]' : 'bg-emerald-500'
              } ${
                activeTotal > 0 && animationsEnabled ? 'animate-pulse motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {activeTotal > 0 ? `${activeTotal} flowing` : sseLive ? 'Live sync' : 'Ready'}
          </span>
          {nodes.length > 0 ? (
            <span className="topology-header-meta hidden rounded-full bg-[var(--bg-card)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline-flex">
              {nodes.length} providers · {totalConfiguredModels} models
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {nodes.length > 0 ? (
            <button
              type="button"
              onClick={triggerBeamTest}
              disabled={isBeamProbing && Boolean(selectedSlug && probeBeams[selectedSlug]?.phase === 'outbound')}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]"
              title={
                selectedSlug
                  ? `Kiểm tra kết nối '${selectedSlug}' (không tốn token)`
                  : 'Chọn một gói hoặc bấm để kiểm tra kết nối (không tốn token)'
              }
            >
              {isBeamProbing ? (
                <Loader2 className="h-3 w-3 animate-spin text-[#E56A4A]" aria-hidden="true" />
              ) : (
                <Zap className="h-3 w-3 text-[#E56A4A]" aria-hidden="true" />
              )}
              <span>Beam</span>
            </button>
          ) : null}
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
          ref={stageContainerRef}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
          onPointerLeave={handleStagePointerUp}
          onDoubleClick={handleStageDoubleClick}
          className={`relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--bg-main)] select-none ${
            zoom > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
          }`}
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 52%), radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text-muted) 15%, transparent) 1px, transparent 0)',
            backgroundSize: '100% 100%, 24px 24px',
            overscrollBehavior: 'contain',
          }}
        >
          {/* Unified Wheel-Zoomable Stage (double-click background to reset) */}
          <div
            className="relative h-full w-full max-w-[920px]"
            style={{
              aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 120ms ease-out',
            }}
          >
              {/* Layer 1 (z-0): Symmetric Fiber-Optic Bezier Conduits & Bidirectional Comets */}
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

                  <filter id={cometGlowId} x="-160%" y="-160%" width="420%" height="420%">
                    <feGaussianBlur stdDeviation="3.4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>

                  <linearGradient id={returnGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0" />
                    <stop offset="45%" stopColor="#34D399" stopOpacity="0.88" />
                    <stop offset="82%" stopColor="#38BDF8" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
                  </linearGradient>

                  <linearGradient id={errorGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0" />
                    <stop offset="55%" stopColor="#EF4444" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#FCA5A5" stopOpacity="1" />
                  </linearGradient>

                  {nodes.map((node) => (
                    <g key={`defs-${node.provider.id}`}>
                      <linearGradient
                        id={`topo-grad-${uid}-${node.provider.id}`}
                        gradientUnits="userSpaceOnUse"
                        x1={node.edge.sx}
                        y1={node.edge.sy}
                        x2={node.edge.tx}
                        y2={node.edge.ty}
                      >
                        <stop offset="0%" stopColor="#E56A4A" />
                        <stop offset="45%" stopColor="#F59E0B" />
                        <stop offset="100%" stopColor={node.accent} />
                      </linearGradient>
                      <linearGradient
                        id={`topo-comet-${uid}-${node.provider.id}`}
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#E56A4A" stopOpacity="0" />
                        <stop offset="48%" stopColor={node.accent} stopOpacity="0.88" />
                        <stop offset="85%" stopColor="#F8FAFC" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
                      </linearGradient>
                    </g>
                  ))}
                </defs>

                {nodes.map((node) => {
                  const { d, dRev, sx, sy, tx, ty } = node.edge;
                  const edgeId = `edge-${node.provider.id}`;
                  const gradUrl = `url(#topo-grad-${uid}-${node.provider.id})`;
                  const cometGradUrl = node.isErr
                    ? `url(#${errorGradId})`
                    : node.isReturning
                      ? `url(#${returnGradId})`
                      : `url(#topo-comet-${uid}-${node.provider.id})`;
                  const isFocused = effectiveFocusSlug === node.provider.slug;
                  const isDimmed =
                    Boolean(effectiveFocusSlug) && !isFocused && !node.isActive && !node.isErr;
                  const strokeTone = node.isErr ? '#EF4444' : gradUrl;
                  const groupOpacity = isDimmed ? 0.34 : 1;

                  if (!node.isActive && !node.isErr) {
                    return (
                      <g
                        key={edgeId}
                        style={{ opacity: groupOpacity, transition: 'opacity 200ms ease' }}
                      >
                        {/* Recessed optical sleeve */}
                        <path
                          d={d}
                          fill="none"
                          stroke={isFocused ? gradUrl : 'var(--border-strong)'}
                          strokeWidth={isFocused ? 8 : 6}
                          strokeOpacity={isFocused ? 0.2 : 0.1}
                          strokeLinecap="round"
                        />
                        {/* Primary conduit line */}
                        <path
                          d={d}
                          fill="none"
                          stroke={isFocused ? gradUrl : 'var(--border-strong)'}
                          strokeWidth={isFocused ? 2.4 : 1.7}
                          strokeOpacity={isFocused ? 0.92 : node.requests > 0 ? 0.62 : 0.42}
                          strokeLinecap="round"
                          strokeDasharray={node.requests > 0 || isFocused ? undefined : '4 6'}
                        />
                        {/* Subtle ambient silk flow on warmed routes */}
                        {node.requests > 0 ? (
                          <path
                            d={d}
                            fill="none"
                            stroke={gradUrl}
                            strokeWidth={2.2}
                            strokeOpacity={isFocused ? 0.88 : 0.42}
                            strokeLinecap="round"
                            className="topology-edge-idle-shimmer"
                          />
                        ) : null}
                        {/* Hub socket pin */}
                        <circle
                          cx={sx}
                          cy={sy}
                          r={3.8}
                          fill="var(--bg-card)"
                          stroke={isFocused ? '#E56A4A' : 'var(--border-strong)'}
                          strokeWidth={1.4}
                        />
                        <circle
                          cx={sx}
                          cy={sy}
                          r={1.5}
                          fill={isFocused ? '#E56A4A' : 'var(--text-muted)'}
                        />
                        {/* Provider socket pin */}
                        <circle
                          cx={tx}
                          cy={ty}
                          r={4.2}
                          fill="var(--bg-card)"
                          stroke={isFocused ? node.accent : 'var(--border-strong)'}
                          strokeWidth={1.5}
                        />
                        <circle
                          cx={tx}
                          cy={ty}
                          r={1.7}
                          fill={isFocused ? node.accent : node.requests > 0 ? node.accent : 'var(--text-muted)'}
                          fillOpacity={isFocused ? 1 : 0.72}
                        />
                      </g>
                    );
                  }

                  const activePath = node.isReturning && !node.isErr ? dRev : d;
                  const packetCount = node.isReturning ? 2 : COMET_COUNT;

                  return (
                    <g
                      key={edgeId}
                      style={{ opacity: groupOpacity, transition: 'opacity 200ms ease' }}
                    >
                      {/* Bloom halo ribbon */}
                      <path
                        d={d}
                        fill="none"
                        stroke={strokeTone}
                        strokeWidth={14}
                        strokeOpacity={node.isErr ? 0.24 : 0.22}
                        strokeLinecap="round"
                        filter={`url(#${softGlowId})`}
                        className="topology-edge-halo"
                      />
                      {/* Translucent optical core sleeve */}
                      <path
                        d={d}
                        fill="none"
                        stroke={strokeTone}
                        strokeWidth={6}
                        strokeOpacity={0.18}
                        strokeLinecap="round"
                      />
                      {/* Crisp luminous fiber */}
                      <path
                        d={d}
                        fill="none"
                        stroke={strokeTone}
                        strokeWidth={2.8}
                        strokeOpacity={0.96}
                        strokeLinecap="round"
                      />
                      {/* Directional silk light wave (outbound on streaming, reverse on response) */}
                      <path
                        d={d}
                        fill="none"
                        stroke={node.isErr ? '#FCA5A5' : '#FFFFFF'}
                        strokeWidth={1.8}
                        strokeOpacity={0.82}
                        strokeLinecap="round"
                        className={
                          node.isReturning && !node.isErr
                            ? 'topology-edge-return'
                            : 'topology-edge-silk'
                        }
                      />

                      {/* Illuminated hub & provider sockets */}
                      <circle
                        cx={sx}
                        cy={sy}
                        r={4.8}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#EF4444' : '#E56A4A'}
                        strokeWidth={1.8}
                        filter={`url(#${cometGlowId})`}
                      />
                      <circle cx={sx} cy={sy} r={2.2} fill={node.isErr ? '#EF4444' : '#E56A4A'} />

                      <circle
                        cx={tx}
                        cy={ty}
                        r={5}
                        fill="var(--bg-card)"
                        stroke={node.isErr ? '#EF4444' : node.isReturning ? '#10B981' : node.accent}
                        strokeWidth={1.8}
                        filter={`url(#${cometGlowId})`}
                      />
                      <circle
                        cx={tx}
                        cy={ty}
                        r={2.3}
                        fill={node.isErr ? '#EF4444' : node.isReturning ? '#10B981' : node.accent}
                      />

                      {/* Synchronized tangent-aligned photonic comets */}
                      {animationsEnabled
                        ? Array.from({ length: packetCount }, (_, i) => (
                            <g key={`${edgeId}-comet-${node.isReturning ? 'ret' : 'out'}-${i}`} filter={`url(#${cometGlowId})`}>
                              <ellipse rx={13} ry={3.4} fill={cometGradUrl} opacity={0.94}>
                                <animateMotion
                                  dur={node.isReturning ? '1.25s' : '1.45s'}
                                  repeatCount="indefinite"
                                  path={activePath}
                                  rotate="auto"
                                  calcMode="spline"
                                  keyTimes="0;1"
                                  keySplines="0.35 0 0.25 1"
                                  begin={`${(i * (node.isReturning ? 0.62 : 0.48)).toFixed(2)}s`}
                                />
                              </ellipse>
                              <ellipse rx={5} ry={1.6} fill="#FFFFFF" opacity={0.96}>
                                <animateMotion
                                  dur={node.isReturning ? '1.25s' : '1.45s'}
                                  repeatCount="indefinite"
                                  path={activePath}
                                  rotate="auto"
                                  calcMode="spline"
                                  keyTimes="0;1"
                                  keySplines="0.35 0 0.25 1"
                                  begin={`${(i * (node.isReturning ? 0.62 : 0.48)).toFixed(2)}s`}
                                />
                              </ellipse>
                            </g>
                          ))
                        : null}
                    </g>
                  );
                })}
              </svg>

              {/* Layer 2 (z-10): Bilateral Provider Nodes with Brand Aura & Active Model Chips */}
              {nodes.map((node) => {
                const isFocused = effectiveFocusSlug === node.provider.slug;
                const isSelected = selectedSlug === node.provider.slug;
                const isDimmed =
                  Boolean(effectiveFocusSlug) && !isFocused && !node.isActive && !node.isErr;
                const compactCard = nodeH <= 58;

                return (
                  <div
                    key={node.provider.id}
                    style={{
                      left: `${(node.x / CANVAS_W) * 100}%`,
                      top: `${(node.y / CANVAS_H) * 100}%`,
                      width: `${(nodeW / CANVAS_W) * 100}%`,
                      height: `${(nodeH / CANVAS_H) * 100}%`,
                      minWidth: '172px',
                      maxWidth: '246px',
                      '--node-accent': node.isErr ? '#EF4444' : node.accent,
                      opacity: isDimmed ? 0.56 : 1,
                      transform:
                        isFocused || isSelected
                          ? 'translate(-50%, calc(-50% - 2px)) scale(1.025)'
                          : node.isActive
                            ? 'translate(-50%, -50%) scale(1.015)'
                            : 'translate(-50%, -50%)',
                    }}
                    className="topology-card-spring absolute z-10"
                  >
                    {/* Floating completion telemetry badge synchronized with return pulse */}
                    {node.telemetry ? (
                      <div
                        className={`topology-telemetry-pill pointer-events-none absolute -top-5 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold whitespace-nowrap shadow-sm backdrop-blur-md ${
                          node.telemetry.ok
                            ? 'border-emerald-500/45 bg-[var(--bg-card)]/95 text-emerald-400'
                            : 'border-red-500/50 bg-[var(--bg-card)]/95 text-red-400'
                        }`}
                      >
                        <span>{node.telemetry.httpStatus || (node.telemetry.ok ? 200 : 'ERR')}</span>
                        {node.telemetry.latencyMs > 0 ? (
                          <span className="text-[var(--text-secondary)]">
                            {node.telemetry.latencyMs}ms
                          </span>
                        ) : null}
                        {node.telemetry.tokens > 0 ? (
                          <span className="text-sky-400">
                            {formatCompactNumber(node.telemetry.tokens)}t
                          </span>
                        ) : null}
                        {node.telemetry.reply ? (
                          <span className="max-w-[96px] truncate text-[var(--text-primary)]">
                            {node.telemetry.reply}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onMouseEnter={() => handleNodeHover(node.provider.slug)}
                      onMouseLeave={() => handleNodeHover('')}
                      onFocus={() => handleNodeHover(node.provider.slug)}
                      onBlur={() => handleNodeHover('')}
                      onClick={() => handleNodeClick(node.provider.slug)}
                      title={`${node.provider.name}${node.activeModelLabel ? ` · ${node.activeModelLabel}` : ''} (${node.totalModels} models)`}
                      style={{
                        borderColor: node.isErr
                          ? 'rgba(239, 68, 68, 0.78)'
                          : node.isActive || isSelected
                            ? `${node.accent}bb`
                            : isFocused
                              ? `${node.accent}88`
                              : undefined,
                      }}
                      className={`group relative flex h-full w-full items-center gap-2.5 overflow-hidden rounded-2xl border bg-[var(--bg-card)]/95 px-3 text-left backdrop-blur-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                        node.isErr
                          ? 'topology-node-error'
                          : node.isActive
                            ? 'topology-node-active'
                            : 'border-[var(--border-subtle)] shadow-[0_8px_22px_-12px_var(--ux-shadow-strong)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      {/* Subtle left brand accent rail */}
                      <span
                        aria-hidden="true"
                        style={{
                          backgroundColor: node.isErr ? '#EF4444' : node.accent,
                          opacity: node.isActive || isFocused || isSelected ? 0.95 : 0.35,
                        }}
                        className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full transition-opacity duration-200"
                      />

                      {/* Faint brand wash when active */}
                      {node.isActive || isSelected ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background: `linear-gradient(110deg, ${node.isErr ? '#EF4444' : node.accent}18 0%, transparent 65%)`,
                          }}
                        />
                      ) : null}

                      <div className="relative shrink-0">
                        <ProviderLogo
                          preset={node.provider.preset || node.provider.slug}
                          logo={node.provider.logo}
                          logoExt={node.provider.logoExt}
                          color={node.accent}
                          name={node.provider.name}
                          size={compactCard ? 28 : 32}
                        />
                      </div>

                      <div className="relative min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[12px] font-semibold tracking-tight text-[var(--text-primary)]">
                            {formatShortProviderName(node.provider.name)}
                          </span>
                          {node.isInFlight ? (
                            <span
                              style={{
                                backgroundColor: `${node.accent}24`,
                                color: node.accent,
                              }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-[2px] font-mono text-[9px] font-bold uppercase"
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  animationsEnabled ? 'animate-ping motion-reduce:animate-none' : ''
                                }`}
                                style={{ backgroundColor: node.accent }}
                              />
                              {node.inFlightCount > 1 ? `×${node.inFlightCount}` : 'LIVE'}
                            </span>
                          ) : node.isErr ? (
                            <span className="shrink-0 rounded-full bg-red-500/18 px-1.5 py-[2px] font-mono text-[9px] font-bold text-red-400">
                              ERR
                            </span>
                          ) : node.requests > 0 ? (
                            <span className="shrink-0 font-mono text-[9.5px] font-medium text-[var(--text-muted)]">
                              {formatCompactNumber(node.requests)}r
                              {node.tokens > 0 ? ` · ${formatCompactNumber(node.tokens)}` : ''}
                            </span>
                          ) : (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--border-strong)]" />
                          )}
                        </div>

                        {/* Row 2: Live/Active Model pill + model count */}
                        <div className="mt-1 flex items-center gap-1.5">
                          {node.activeModelLabel ? (
                            <span
                              className={`inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-none ${
                                node.isInFlight
                                  ? 'border font-semibold text-[var(--text-primary)]'
                                  : node.isReturning && !node.isErr
                                    ? 'bg-emerald-500/14 font-semibold text-emerald-400'
                                    : node.isErr
                                      ? 'bg-red-500/14 font-semibold text-red-400'
                                      : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                              }`}
                              style={
                                node.isInFlight
                                  ? {
                                      backgroundColor: `${node.accent}1f`,
                                      borderColor: `${node.accent}55`,
                                    }
                                  : undefined
                              }
                            >
                              <Cpu className="h-2.5 w-2.5 shrink-0 opacity-75" aria-hidden="true" />
                              <span className="truncate">{node.activeModelLabel}</span>
                            </span>
                          ) : (
                            <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                              {node.provider.slug}
                            </span>
                          )}

                          {node.totalModels > 1 ? (
                            <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[9px] font-semibold text-[var(--text-muted)]">
                              +{node.totalModels - 1}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}

              {/* Layer 3 (z-20): Center 001Router Luminous Core Hub */}
              <div
                style={{
                  left: `${(hub.x / CANVAS_W) * 100}%`,
                  top: `${(hub.y / CANVAS_H) * 100}%`,
                  width: `${(HUB_W / CANVAS_W) * 100}%`,
                  height: `${(HUB_H / CANVAS_H) * 100}%`,
                  minWidth: '158px',
                  maxWidth: '190px',
                  transform: 'translate(-50%, -50%)',
                }}
                className={`topology-card-spring absolute z-20 flex items-center justify-center gap-2.5 rounded-2xl border bg-[var(--bg-card)]/96 px-3.5 py-2.5 backdrop-blur-md ${
                  activeTotal > 0
                    ? 'topology-router-core border-[#E56A4A]/90'
                    : 'border-[#E56A4A]/55 shadow-[0_12px_32px_-10px_rgba(229,106,74,0.34)]'
                }`}
              >
                {activeTotal > 0 ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="topology-core-ring pointer-events-none absolute -inset-1.5 rounded-[20px] border border-[#E56A4A]/50"
                    />
                    <span
                      aria-hidden="true"
                      className="topology-core-ring-delayed pointer-events-none absolute -inset-1.5 rounded-[20px] border border-sky-400/35"
                    />
                  </>
                ) : null}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 rounded-[15px] transition-opacity duration-500 ${
                    activeTotal > 0 ? 'opacity-100' : 'opacity-50'
                  }`}
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(229, 106, 74, 0.16) 0%, rgba(56, 189, 248, 0.08) 58%, rgba(16, 185, 129, 0.14) 100%)',
                  }}
                />
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] via-[#eb7a4a] to-[#c94a2e] text-white shadow-sm">
                  <Waypoints className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div className="relative min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold tracking-tight text-[var(--text-primary)]">
                      001Router
                    </span>
                    {activeTotal > 0 ? (
                      <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-gradient-to-br from-[#E56A4A] to-amber-500 px-1.5 font-mono text-[9.5px] font-bold text-white shadow-xs">
                        {activeTotal}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[9.5px] text-[var(--text-muted)]">
                    {activeTotal > 0
                      ? 'Syncing traffic'
                      : `${nodes.length} routes · ${totalConfiguredModels} models`}
                  </div>
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
