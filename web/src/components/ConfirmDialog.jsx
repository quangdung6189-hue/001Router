import { ModalDialog } from './ModalDialog';
import { useLocale } from '../context/LocaleContext';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
}) {
  const { t } = useLocale();
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            autoFocus={destructive}
            className="r-btn-secondary px-3.5 py-2 text-sm"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm ${
              destructive ? 'r-btn-danger' : 'r-btn-primary'
            }`}
          >
            {busy ? (
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : null}
            {busy ? t('common.saving') : confirmLabel || t('common.save')}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-[var(--text-secondary)]">{message}</div>
    </ModalDialog>
  );
}
