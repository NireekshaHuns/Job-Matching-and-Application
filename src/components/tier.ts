/** Shared H1B sponsor-tier presentation, reused by the board and the landing page. */
export type SponsorTier = 'High' | 'Medium' | 'Low' | 'Excluded';

/** Badge classes per tier — the app's canonical tier color language. */
export const TIER_STYLES: Record<SponsorTier, string> = {
  High: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  Medium:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  Low: 'bg-surface-2 text-muted border-border',
  Excluded:
    'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
};

/**
 * Plain-English explainer copy for the landing page — intentionally independent
 * from the runtime `reason` strings in src/lib/sponsorship/score.ts (which are
 * per-job and data-driven). Not meant to be kept byte-identical with those.
 */
export const TIER_MEANINGS: Record<SponsorTier, string> = {
  High: 'JD offers sponsorship, or a heavy H1B filing history.',
  Medium: 'Sponsored before, but the JD is silent on it.',
  Low: 'No sponsorship history and the JD is silent.',
  Excluded: 'JD rules it out ("no sponsorship", "US citizen / GC only").',
};

/**
 * New-hire sponsorship badge — the USCIS "New Employment" signal, complementary
 * to the tier. Mirrors `newHireStatusEnum` in the schema. All data is historical
 * (see `NEW_HIRE_DISCLAIMER`).
 */
export type NewHireStatus = 'sponsors_new_hires' | 'transfers_only' | 'no_record' | 'unknown';

/** Short badge label per new-hire status. */
export const NEW_HIRE_LABELS: Record<NewHireStatus, string> = {
  sponsors_new_hires: 'Sponsors new hires ✓',
  transfers_only: 'Transfers only',
  no_record: 'No record',
  unknown: 'Unknown',
};

/** Badge classes per new-hire status. */
export const NEW_HIRE_STYLES: Record<NewHireStatus, string> = {
  sponsors_new_hires:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  transfers_only:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  no_record: 'bg-surface-2 text-muted border-border',
  unknown: 'bg-surface-2 text-faint border-border',
};

/** Explainer copy per new-hire status. */
export const NEW_HIRE_MEANINGS: Record<NewHireStatus, string> = {
  sponsors_new_hires: 'Recent USCIS New Employment (initial) approvals on record.',
  transfers_only: 'H1B approvals on record, but no recent new-hire (initial) approvals.',
  no_record: 'Matched a USCIS employer with no approvals on record.',
  unknown: 'No confident match to a USCIS employer.',
};

/** All sponsorship signals are lagged government data — label them as such. */
export const NEW_HIRE_DISCLAIMER = 'Based on prior fiscal years — predictive, not a guarantee.';
