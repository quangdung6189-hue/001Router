/* Lucian UX/UI Prompt #263 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#263 */
import './lucian-263.css';

export function LucianGradientText({ children, className = '' }) {
  return <span className={`ux u263-flow ${className}`.trim()}>{children}</span>;
}

export function LucianThinkingText({ children = 'Thinking…', className = '' }) {
  return (
    <span className={`ux u263-sh ${className}`.trim()} role="status" aria-live="polite">
      {children}
    </span>
  );
}
