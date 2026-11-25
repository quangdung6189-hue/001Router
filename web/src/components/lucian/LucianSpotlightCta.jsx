import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import './LucianSpotlightCta.css';

/**
 * Port of Lucian UX/UI #425 (CTA card) adapted to 001Router's terracotta brand gradient.
 */
export function LucianSpotlightCta({
  eyebrow = 'Ready to Route',
  title = 'One unified endpoint for every model you run',
  description = 'Open the dashboard, connect your providers, and switch models across all your coding tools without touching config files again.',
  primaryLabel = 'Open Dashboard',
  primaryTo = '/',
  secondaryLabel = 'Browse 470+ Models',
  secondaryTo = '/models',
}) {
  const cardRef = useRef(null);

  const handleMove = (e) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };

  return (
    <section
      ref={cardRef}
      onPointerMove={handleMove}
      className="lucian-cta-card px-6 py-10 text-center sm:px-10 sm:py-12"
    >
      <i className="lucian-cta-blob lucian-cta-blob-1" aria-hidden="true" />
      <i className="lucian-cta-blob lucian-cta-blob-2" aria-hidden="true" />
      <span className="lucian-cta-glow" aria-hidden="true" />

      <div className="mx-auto max-w-2xl space-y-4">
        <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide text-white/95 backdrop-blur-xs">
          {eyebrow}
        </span>
        <h2 className="landing-heading text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          {title}
        </h2>
        <p className="landing-copy mx-auto text-sm leading-relaxed text-white/85">
          {description}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link to={primaryTo} className="lucian-cta-btn">
            <span>{primaryLabel}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link
            to={secondaryTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-xs transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
