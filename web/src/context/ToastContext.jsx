import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let nextToastId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const stackRef = useRef(null);
  const timersRef = useRef(new Map());
  const pausedRef = useRef(new Set());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    pausedRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
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
      const openModal = document.querySelector('dialog:modal');
      if (openModal) {
        return null;
      }

      const id = nextToastId++;
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
      if (toasts.length > 0 && !el.matches(':popover-open')) {
        el.showPopover();
      } else if (toasts.length === 0 && el.matches(':popover-open')) {
        el.hidePopover();
      }
    } catch {
      // Fallback CSS keeps fixed positioning
    }
  }, [toasts.length]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

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
          const Icon =
            t.variant === 'success' ? CheckCircle2 : t.variant === 'error' ? AlertCircle : Info;
          const borderAccent =
            t.variant === 'success'
              ? 'border-emerald-500/45'
              : t.variant === 'error'
                ? 'border-red-500/50'
                : 'border-[var(--border-strong)]';
          const iconColor =
            t.variant === 'success'
              ? 'text-emerald-500'
              : t.variant === 'error'
                ? 'text-red-500'
                : 'text-[#E56A4A]';

          return (
            <div
              key={t.id}
              className={`toast-card flex items-start gap-3 px-3.5 py-3 text-sm ${borderAccent}`}
              onMouseEnter={() => pausedRef.current.add(t.id)}
              onMouseLeave={() => {
                pausedRef.current.delete(t.id);
                scheduleDismiss(t.id, 1800);
              }}
              onFocus={() => pausedRef.current.add(t.id)}
              onBlur={() => {
                pausedRef.current.delete(t.id);
                scheduleDismiss(t.id, 1800);
              }}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
              <p className="flex-1 leading-snug text-[var(--text-primary)]">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[#E56A4A]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
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
