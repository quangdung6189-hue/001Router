/* Toast micro-interactions adapted from Lucian UX/UI Prompt #435 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#435 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let nextToastId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [pausedIds, setPausedIds] = useState(() => new Set());
  const stackRef = useRef(null);
  const timersRef = useRef(new Map());
  const pausedRef = useRef(new Set());
  const dragStateRef = useRef(new Map());
  const priorFocusRef = useRef(null);

  const dismiss = useCallback((id, { fromKeyboard = false } = {}) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    pausedRef.current.delete(id);
    dragStateRef.current.delete(id);
    setPausedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setToasts((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (fromKeyboard) {
        requestAnimationFrame(() => {
          if (remaining.length > 0) {
            const nextBtn = stackRef.current?.querySelector('button[data-toast-close]');
            nextBtn?.focus?.({ preventScroll: true });
          } else if (priorFocusRef.current && document.contains(priorFocusRef.current)) {
            priorFocusRef.current.focus?.({ preventScroll: true });
            priorFocusRef.current = null;
          }
        });
      }
      return remaining;
    });
  }, []);

  const scheduleDismiss = useCallback(
    (id, durationMs = 4200) => {
      if (durationMs <= 0) return;
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        if (!pausedRef.current.has(id)) {
          dismiss(id);
        }
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  const notify = useCallback(
    (message, variant = 'info', durationMs = 4200) => {
      const id = nextToastId++;
      if (
        typeof document !== 'undefined' &&
        document.activeElement &&
        !stackRef.current?.contains(document.activeElement)
      ) {
        priorFocusRef.current = document.activeElement;
      }
      setToasts((prev) => [...prev.slice(-3), { id, message, variant, durationMs }]);

      if (typeof document.ariaNotify === 'function') {
        try {
          document.ariaNotify(message);
        } catch {
          setAnnouncement('');
          requestAnimationFrame(() => setAnnouncement(message));
        }
      } else {
        setAnnouncement('');
        requestAnimationFrame(() => setAnnouncement(message));
      }

      scheduleDismiss(id, durationMs);
      return id;
    },
    [scheduleDismiss]
  );

  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const supportsPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
    if (!supportsPopover) return;

    try {
      if (toasts.length > 0) {
        if (el.matches(':popover-open')) {
          // Re-promote above any newly opened top-layer <dialog:modal>
          if (document.querySelector('dialog:modal')) {
            el.hidePopover();
            el.showPopover();
          }
        } else {
          el.showPopover();
        }
      } else if (el.matches(':popover-open')) {
        el.hidePopover();
      }
    } catch {
      // Fallback CSS keeps fixed positioning
    }
  }, [toasts]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  const pauseToast = (id) => {
    pausedRef.current.add(id);
    setPausedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const resumeToast = (id) => {
    pausedRef.current.delete(id);
    setPausedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    scheduleDismiss(id, 1800);
  };

  const api = useMemo(
    () => ({
      info: (msg, ms) => notify(msg, 'info', ms),
      success: (msg, ms) => notify(msg, 'success', ms),
      error: (msg, ms) => notify(msg, 'error', ms ?? 5500),
      dismiss,
    }),
    [notify, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div aria-live="polite" className="visually-hidden">
        {announcement}
      </div>

      <div
        ref={stackRef}
        role="region"
        aria-label="Notifications"
        popover={Object.hasOwn(HTMLElement.prototype, 'popover') ? 'manual' : undefined}
        className="toast-stack"
      >
        {toasts.map((t) => {
          const borderAccent =
            t.variant === 'success'
              ? 'border-emerald-500/45'
              : t.variant === 'error'
                ? 'border-red-500/50'
                : 'border-[var(--border-strong)]';
          const progressColor =
            t.variant === 'success'
              ? 'bg-[var(--ux-mint)]'
              : t.variant === 'error'
                ? 'bg-[var(--ux-danger)]'
                : 'bg-[var(--accent)]';

          return (
            <div
              key={t.id}
              data-paused={pausedIds.has(t.id) ? 'true' : 'false'}
              style={{ '--toast-duration': `${t.durationMs || 4200}ms` }}
              className={`toast-card flex items-start gap-3 px-3.5 py-3 text-sm ${borderAccent}`}
              onMouseEnter={() => pauseToast(t.id)}
              onMouseLeave={() => resumeToast(t.id)}
              onFocus={() => pauseToast(t.id)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  resumeToast(t.id);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(t.id, { fromKeyboard: true });
                }
              }}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target.closest('button')) return;
                dragStateRef.current.set(t.id, { x0: e.clientX, dx: 0 });
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // ignore
                }
              }}
              onPointerMove={(e) => {
                const st = dragStateRef.current.get(t.id);
                if (!st) return;
                const dx = Math.max(0, e.clientX - st.x0);
                st.dx = dx;
                e.currentTarget.style.transform = `translate3d(${dx}px, 0, 0)`;
                e.currentTarget.style.opacity = String(Math.max(0.35, 1 - dx / 220));
              }}
              onPointerUp={(e) => {
                const st = dragStateRef.current.get(t.id);
                if (!st) return;
                dragStateRef.current.delete(t.id);
                if (st.dx > 84) {
                  dismiss(t.id);
                } else {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.opacity = '';
                }
              }}
              onPointerCancel={(e) => {
                dragStateRef.current.delete(t.id);
                e.currentTarget.style.transform = '';
                e.currentTarget.style.opacity = '';
              }}
            >
              {t.variant === 'success' ? (
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--ux-mint)]/18 text-[var(--ux-mint)]"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3 fill-none stroke-current"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path className="toast-check-path" d="M3.5 8.5l2.8 2.8L12.5 5" />
                  </svg>
                </span>
              ) : t.variant === 'error' ? (
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ux-danger)]"
                  aria-hidden="true"
                />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#E56A4A]" aria-hidden="true" />
              )}

              <p className="flex-1 leading-snug text-[var(--text-primary)]">{t.message}</p>

              <button
                type="button"
                data-toast-close=""
                onClick={(e) => dismiss(t.id, { fromKeyboard: e.detail === 0 })}
                aria-label="Dismiss notification"
                className="rounded-md p-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[#E56A4A]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              {t.durationMs > 0 ? (
                <span aria-hidden="true" className={`toast-progress ${progressColor}`} />
              ) : null}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
