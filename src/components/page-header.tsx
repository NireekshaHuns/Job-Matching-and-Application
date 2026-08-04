/**
 * Shared page hero — a mono brand eyebrow, a large Fraunces display title, and an
 * optional subtitle, choreographed with a staggered rise on load. Gives every
 * route the same confident, editorial header instead of a plain 2xl line. The
 * `title` renders as the page's <h1>, so its text stays the accessible name.
 * No `'use client'`: pure markup, usable from server or client pages.
 */
import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional right-aligned controls (kept baseline-aligned with the title). */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-brand-text animate-rise font-mono text-xs font-medium tracking-[0.2em] uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="animate-rise rise-2 font-display mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="animate-rise rise-3 text-muted mt-2 max-w-2xl text-sm sm:text-[0.95rem]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="animate-rise rise-3 flex items-center gap-2">{actions}</div>}
    </header>
  );
}
