/**
 * Posting-age guard, shared by the cap planner and the enrichment loop.
 *
 * Its own module because it has two callers and they must not drift: the cap
 * planner uses it so stale postings don't consume the per-run budget, and
 * `enrichPostings` uses it so they never reach a paid LLM call. A guard in only
 * the first place silently does nothing whenever the fetch fits under the cap,
 * which is the ordinary case.
 */

/**
 * Is a posting recent enough to be worth paying to classify?
 *
 * An unknown date passes. Several sources give us none at all, and treating
 * "we don't know" as "too old" would silently drop them.
 *
 * A non-finite or non-positive limit also passes: this is configured from the
 * environment, and `Number("7 days")` is `NaN`, which would otherwise compare
 * false against every dated posting and turn a typo into a near-total ingestion
 * blackout that still reports success.
 */
export function isRecentEnough(
  postedAt: Date | null,
  maxAgeDays: number | undefined,
  now: Date = new Date(),
): boolean {
  if (maxAgeDays == null || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return true;
  if (!postedAt) return true;
  const ageMs = now.getTime() - postedAt.getTime();
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}
