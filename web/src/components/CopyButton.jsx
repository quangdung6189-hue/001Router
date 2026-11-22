import { copyToClipboard } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { LucianCopyButton } from './lucian/LucianCopyButton';

export function CopyButton({
  value,
  label,
  copiedLabel,
  className = '',
  size = 'sm',
  toastMessage,
  iconOnly = false,
}) {
  const toast = useToast();
  const { t } = useLocale();

  const resolvedLabel = label || t('common.copy');
  const resolvedCopied = copiedLabel || t('common.copied');

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      if (toastMessage) toast.success(toastMessage);
      return true;
    }
    toast.error('Clipboard copy failed.');
    return false;
  };

  return (
    <LucianCopyButton
      onCopy={handleCopy}
      label={resolvedLabel}
      copiedLabel={resolvedCopied}
      size={size}
      iconOnly={iconOnly}
      className={className}
    />
  );
}
