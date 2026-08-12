/**
 * Compact "time ago" labels for job cards ("20m ago", "5h ago", "3d ago").
 *
 * Deliberately coarse and non-localized: the board shows dozens of these in a
 * dense grid, so they must stay short and scannable. Pure — `now` is injected so
 * the output is testable and stable.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Relative age of `posted`, or null when the date is missing/invalid so callers
 * can decide what to render instead.
 *
 * Anything under a minute reads "just now". Future timestamps are clamped to
 * "just now" too — feeds occasionally publish a slightly-ahead timestamp, and
 * "in 3 minutes" on a job card is worse than a small white lie.
 */
export function formatRelativeTime(
  posted: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (posted == null || posted === '') return null;
  const then = posted instanceof Date ? posted : new Date(posted);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return null;

  const diff = now.getTime() - ms;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;

  const weeks = Math.floor(diff / WEEK);
  // Past ~2 months, weeks stop being meaningful for a job posting — anything
  // that old is stale regardless of exactly how stale.
  if (weeks < 9) return `${weeks}w ago`;
  return 'over 2mo ago';
}

/** Full timestamp for the card's `title` tooltip, or null when unknown. */
export function formatAbsoluteTime(posted: Date | string | null | undefined): string | null {
  if (posted == null || posted === '') return null;
  const then = posted instanceof Date ? posted : new Date(posted);
  if (Number.isNaN(then.getTime())) return null;
  return then.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
