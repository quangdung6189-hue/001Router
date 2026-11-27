import { useEffect, useRef } from 'react';

/**
 * Accessible horizontal segmented control using HTML `focusgroup="tablist nomemory"`
 * with roving-arrow keyboard fallback for browsers without native focusgroup.
 */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  ariaLabel = 'View options',
  className = '',
}) {
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    const buttons = [...list.querySelectorAll('button[data-tab-value]')];
    for (const btn of buttons) {
      if (btn.dataset.tabValue === String(value)) {
        btn.setAttribute('focusgroupstart', '');
        try {
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
        } catch {
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      } else {
        btn.removeAttribute('focusgroupstart');
      }
    }

    const supportsFocusGroup = 'focusGroup' in HTMLElement.prototype;
    if (supportsFocusGroup) return undefined;

    list.setAttribute('role', 'tablist');
    for (const btn of buttons) {
      btn.setAttribute('role', 'tab');
      btn.tabIndex = btn.dataset.tabValue === String(value) ? 0 : -1;
    }

    const onKeyDown = (e) => {
      const idx = buttons.indexOf(document.activeElement);
      if (idx < 0) return;
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = buttons.length - 1;
      if (nextIdx < 0) return;
      e.preventDefault();
      const target = buttons[nextIdx];
      target?.focus();
      if (target?.dataset.tabValue !== undefined) {
        onChange?.(target.dataset.tabValue);
      }
    };

    list.addEventListener('keydown', onKeyDown);
    return () => list.removeEventListener('keydown', onKeyDown);
  }, [options, value, onChange]);

  const sizeCls =
    size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]';

  return (
    <div
      ref={listRef}
      focusgroup="tablist nomemory"
      aria-label={ariaLabel}
      className={`r-tablist ${className}`}
    >
      {options.map((opt) => {
        const selected = String(opt.value) === String(value);
        return (
          <button
            key={opt.value}
            type="button"
            data-tab-value={opt.value}
            aria-selected={selected ? 'true' : 'false'}
            onClick={() => onChange?.(opt.value)}
            className={sizeCls}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
