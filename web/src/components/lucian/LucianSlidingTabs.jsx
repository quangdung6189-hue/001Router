/* Lucian UX/UI Prompt #039 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#039 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import './lucian-039.css';

export function LucianSlidingTabs({
  tabs = [],
  value,
  onChange,
  ariaLabel = 'Filter options',
  idPrefix = '',
  className = '',
}) {
  const listRef = useRef(null);
  const pillRef = useRef(null);
  const tabRefs = useRef([]);
  const hasMeasuredRef = useRef(false);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === value)
  );

  const updatePill = useCallback((animate) => {
    const pill = pillRef.current;
    const activeTab = tabRefs.current[activeIndex];
    if (!pill || !activeTab) return;

    if (!animate) {
      pill.style.transition = 'none';
    }
    pill.style.setProperty('--x', `${activeTab.offsetLeft}px`);
    pill.style.setProperty('--w', `${activeTab.offsetWidth}px`);
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = '';
    }
  }, [activeIndex]);

  useLayoutEffect(() => {
    const isSubsequent = hasMeasuredRef.current;
    updatePill(isSubsequent);
    hasMeasuredRef.current = true;
    if (isSubsequent) {
      const activeTab = tabRefs.current[activeIndex];
      activeTab?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
        container: 'nearest',
      });
    }
  }, [updatePill, tabs, activeIndex]);

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl || typeof ResizeObserver === 'undefined') return undefined;

    const ro = new ResizeObserver(() => {
      updatePill(false);
    });
    ro.observe(listEl);
    tabRefs.current.forEach((el) => {
      if (el) ro.observe(el);
    });

    return () => ro.disconnect();
  }, [updatePill, tabs]);

  const handleKeyDown = (e, idx) => {
    let nextIdx = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      const target = tabs[nextIdx];
      if (target) {
        onChange?.(target.id);
        tabRefs.current[nextIdx]?.focus();
      }
    }
  };

  return (
    <div className={`ux u039 ${className}`.trim()}>
      <div ref={listRef} className="u039-tabs" role="tablist" aria-label={ariaLabel}>
        <span ref={pillRef} className="u039-pill" aria-hidden="true" />
        {tabs.map((tab, i) => {
          const selected = i === activeIndex;
          return (
            <button
              key={tab.id}
              id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange?.(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className="u039-tab"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
