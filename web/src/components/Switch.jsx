/* Stretchy tactile switch adapted from Lucian UX/UI Prompt #433 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#433 */
import { useId, useState } from 'react';

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
  const [pressed, setPressed] = useState(false);
  const isChecked = Boolean(checked);

  const release = () => setPressed(false);

  return (
    <label
      htmlFor={id}
      data-checked={isChecked ? 'true' : 'false'}
      data-pressed={pressed ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      onPointerDown={(e) => {
        if (!disabled && e.button === 0) setPressed(true);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      className={`r-switch-root inline-flex items-center gap-2.5 select-none ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="relative inline-flex items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={isChecked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange?.(e.target.checked)}
          onKeyDown={(e) => {
            if (!disabled && e.key === ' ') setPressed(true);
          }}
          onKeyUp={release}
          onBlur={release}
          className="r-switch-input peer sr-only"
        />
        <span aria-hidden="true" data-size={size} className="r-switch-track" />
        <span aria-hidden="true" data-size={size} className="r-switch-thumb" />
      </span>
      {label ? <span className="text-sm text-[var(--text-primary)]">{label}</span> : null}
    </label>
  );
}
