/** Shared H1B sponsor-tier presentation, reused by the board and the landing page. */
export type SponsorTier = 'High' | 'Medium' | 'Low' | 'Excluded';

/** Badge classes per tier — the app's canonical tier color language. */
export const TIER_STYLES: Record<SponsorTier, string> = {
  High: 'bg-green-100 text-green-800 border-green-200',
  Medium: 'bg-amber-100 text-amber-800 border-amber-200',
  Low: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  Excluded: 'bg-red-100 text-red-800 border-red-200',
};

/** One-line meaning of each tier (mirrors src/lib/sponsorship/score.ts). */
export const TIER_MEANINGS: Record<SponsorTier, string> = {
  High: 'JD offers sponsorship, or a heavy H1B filing history.',
  Medium: 'Sponsored before, but the JD is silent on it.',
  Low: 'No sponsorship history and the JD is silent.',
  Excluded: 'JD rules it out ("no sponsorship", "US citizen / GC only").',
};
