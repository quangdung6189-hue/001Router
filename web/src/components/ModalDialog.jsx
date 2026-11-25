import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

let cachedDisplayTransitionSupport;
function canTransitionDisplay() {
  if (cachedDisplayTransitionSupport !== undefined) return cachedDisplayTransitionSupport;
  if (
    typeof window === 'undefined' ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete') ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransitionSupport = getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransitionSupport;
}

function supportsTopLayerExit() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('overlay', 'auto')) &&
    canTransitionDisplay()
  );
}

/**
 * Accessible native <dialog> modal wrapper.
 * Follows modern-web-guidance: dialog & animate-to-from-top-layer.
 * Uses showModal() for top-layer modality, Esc dismissal, focus restoration,
 * and animated top-layer entry/exit (with Firefox/Safari exit fallback).
 */
export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  lightDismiss = true,
  children,
  footer,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const pressedOutsideRef = useRef(false);
  const programmaticCloseRef = useRef(false);
  const unmountTimerRef = useRef(null);
  const [rendered, setRendered] = useState(Boolean(open));

  useEffect(() => {
    return () => {
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    };
  }, []);

  const animateCloseDialog = useCallback(async (dialog) => {
    if (!dialog || !dialog.open) return;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute('data-closing', '');
      const animations = dialog.getAnimations?.({ subtree: false }) || [];
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 400)),
        ]);
      }
      if (!dialog.hasAttribute('data-closing')) return;
      dialog.removeAttribute('data-closing');
    }
    if (dialog.open) {
      dialog.close();
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      setRendered(true);
      dialog.removeAttribute('data-closing');
      if (!dialog.open) {
        programmaticCloseRef.current = false;
        dialog.returnValue = '';
        dialog.showModal();
      }
    } else if (dialog.open) {
      programmaticCloseRef.current = true;
      animateCloseDialog(dialog).then(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.returnValue = '';
        }
      });
    } else {
      setRendered(false);
    }
  }, [open, animateCloseDialog]);

  // Intercept native cancel (Esc / closedby light dismiss) so exit animates on browsers without overlay transition
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (event) => {
      if (supportsTopLayerExit()) return;
      event.preventDefault();
      animateCloseDialog(dialog);
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [animateCloseDialog]);

  // Fallback for browsers without <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !lightDismiss || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    const onPointerDown = (e) => {
      pressedOutsideRef.current = isOutside(e);
    };

    const onPointerUp = (e) => {
      if (pressedOutsideRef.current && isOutside(e)) {
        animateCloseDialog(dialog);
      }
      pressedOutsideRef.current = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [lightDismiss, animateCloseDialog]);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.removeAttribute('data-closing');
      dialog.returnValue = '';
    }
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    // Keep content visible during native top-layer CSS exit transition before unmounting
    const delayMs = supportsTopLayerExit() ? 230 : 0;
    if (delayMs > 0) {
      unmountTimerRef.current = setTimeout(() => {
        unmountTimerRef.current = null;
        if (dialogRef.current && !dialogRef.current.open) {
          setRendered(false);
        }
      }, delayMs);
    } else {
      setRendered(false);
    }
    if (programmaticCloseRef.current) {
      programmaticCloseRef.current = false;
      return;
    }
    onClose?.();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-size={size}
      closedby={lightDismiss ? 'any' : 'closerequest'}
      onClose={handleClose}
    >
      {rendered ? (
        <div className="flex max-h-[min(90dvh,52rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => animateCloseDialog(dialogRef.current)}
              aria-label="Close modal"
              className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[#E56A4A]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-5 py-3.5">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
