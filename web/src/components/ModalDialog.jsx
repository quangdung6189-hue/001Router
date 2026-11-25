import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Accessible native <dialog> modal wrapper.
 * Uses showModal() for top-layer modality, Esc dismissal, and focus restoration.
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      programmaticCloseRef.current = false;
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!open && dialog.open) {
      programmaticCloseRef.current = true;
      dialog.close();
      dialog.returnValue = '';
    }
  }, [open]);

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
        dialog.close();
      }
      pressedOutsideRef.current = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [lightDismiss]);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) dialog.returnValue = '';
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
      {open ? (
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
              onClick={() => dialogRef.current?.close()}
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
