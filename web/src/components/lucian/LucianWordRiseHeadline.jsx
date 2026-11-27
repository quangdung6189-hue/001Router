/* Lucian UX/UI Prompt #419 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#419 */
import './lucian-419.css';

/**
 * Word-by-word rising headline from Lucian #419 (SaaS hero).
 * lines: Array<Array<{ text: string, gradient?: boolean }>> — each inner array is one visual line.
 */
export function LucianWordRiseHeadline({ lines, className = '', as: Tag = 'h1' }) {
  const label = lines.map((segs) => segs.map((s) => s.text).join(' ')).join(' ');
  let k = 0;

  return (
    <Tag className={`ux u419 u419-h1 ${className}`.trim()} aria-label={label}>
      {lines.map((segs, li) => (
        <span key={li} className="ln" aria-hidden="true">
          {segs.flatMap((seg, si) => {
            const words = seg.text.split(' ').filter(Boolean);
            return words.map((w, wi) => {
              const i = k++;
              const isLast = si === segs.length - 1 && wi === words.length - 1;
              return (
                <span key={`${si}-${wi}`}>
                  <span className={`u419-w${seg.gradient ? ' gr' : ''}`}>
                    <span style={{ '--i': i }}>{w}</span>
                  </span>
                  {isLast ? null : ' '}
                </span>
              );
            });
          })}
        </span>
      ))}
    </Tag>
  );
}

/** #419 release pill badge */
export function LucianReleasePill({ tag, children, href = '#how-it-works', delay = '0.05s' }) {
  return (
    <a className="ux u419 u419-pill rv" href={href} style={{ '--d': delay }}>
      <b>{tag}</b>
      <span>{children}</span>
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <path d="M3.5 2 6.5 5l-3 3" />
      </svg>
    </a>
  );
}
