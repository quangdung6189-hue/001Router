import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import './LucianSpotlightCta.css';

/**
 * Port of Lucian UX/UI #425 (CTA card) upgraded into an ethereal astral prism stage
 * with GPU-composited shine, starlight shimmer, and interactive cursor spotlight.
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
      className="lucian-cta-card px-6 py-12 text-center sm:px-10 sm:py-16"
    >
      <span className="lucian-cta-stars" aria-hidden="true" />
      <i className="lucian-cta-blob lucian-cta-blob-1" aria-hidden="true" />
      <i className="lucian-cta-blob lucian-cta-blob-2" aria-hidden="true" />
      <i className="lucian-cta-blob lucian-cta-blob-3" aria-hidden="true" />
      <span className="lucian-cta-glow" aria-hidden="true" />

      <div className="relative z-10 mx-auto max-w-2xl space-y-5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/12 px-3.5 py-1 text-xs font-semibold tracking-wide text-white backdrop-blur-sm">
          <Sparkles className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
          {eyebrow}
        </span>
        <h2 className="landing-heading text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
        <p className="landing-copy mx-auto text-sm leading-relaxed text-white/85 sm:text-base">
          {description}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
          <Link to={primaryTo} className="lucian-cta-btn group">
            <span>{primaryLabel}</span>
            <ArrowRight
              className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </Link>
          <Link
            to={secondaryTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
