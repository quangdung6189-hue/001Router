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
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-[#E56A4A] text-white hover:bg-[#cc5236]'
            }`}
          >
            {busy ? t('common.saving') : confirmLabel || t('common.save')}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-[var(--text-secondary)]">{message}</div>
    </ModalDialog>
  );
}
