/* Lucian UX/UI Prompt #008 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#008 */
import { useEffect, useRef, useState } from 'react';
import './lucian-008.css';

export function LucianCopyButton({
  onCopy,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'sm',
  iconOnly = false,
  className = '',
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async (e) => {
    e?.stopPropagation?.();
    const ok = await onCopy?.(e);
    if (ok === false) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(false);
    // Restart gleam & stroke-dashoffset animation cleanly on rapid re-clicks
    requestAnimationFrame(() => {
      setCopied(true);
    });
    timerRef.current = setTimeout(() => {
      setCopied(false);
    }, 1800);
  };

  const sizeClass = size === 'xs' ? 'u008-btn--xs' : 'u008-btn--sm';
  const iconClass = iconOnly ? 'u008-btn--icon' : '';

  return (
    <span className={`ux u008${copied ? ' is-copied' : ''}`}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={`u008-btn ${sizeClass} ${iconClass} ${className}`.trim()}
      >
        <span className="u008-ico" aria-hidden="true">
          <svg className="u008-cp" viewBox="0 0 24 24">
            <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
            <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
          </svg>
          <svg className="u008-ok" viewBox="0 0 24 24">
            <path d="M5.5 12.5l4.2 4.2L18.5 8" />
          </svg>
        </span>
        {!iconOnly ? <span className="u008-label">{copied ? copiedLabel : label}</span> : null}
      </button>
      {iconOnly ? (
        <span className="u008-tip" role="status">
          {copied ? copiedLabel : ''}
        </span>
      ) : (
        <span className="visually-hidden" role="status">
          {copied ? copiedLabel : ''}
        </span>
      )}
    </span>
  );
}
