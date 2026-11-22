import { useId } from 'react';

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id: customId,
  size = 'md',
  'aria-label': ariaLabel,
}) {
  const autoId = useId();
  const id = customId || autoId;
  const trackSize = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const thumbSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const thumbTranslate = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center gap-2.5 select-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="relative inline-flex items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={Boolean(checked)}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange?.(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`${trackSize} rounded-full border transition-colors ${
            checked
              ? 'border-[#E56A4A] bg-[#E56A4A]'
              : 'border-[var(--border-strong)] bg-[var(--bg-subtle)]'
          } peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#E56A4A]`}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 rounded-full shadow-xs transition-transform motion-reduce:transition-none ${thumbSize} ${
            checked ? `${thumbTranslate} bg-white` : 'translate-x-0 bg-[var(--text-muted)]'
          }`}
        />
      </span>
      {label ? <span className="text-sm text-[var(--text-primary)]">{label}</span> : null}
    </label>
  );
}
