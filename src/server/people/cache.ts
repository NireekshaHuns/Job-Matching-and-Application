/**
 * People-finder cache helpers (pure, dependency-light). Shared by the tRPC
 * router and the scheduled purge so the TTL rules can't drift.
 */

/** Cached results older than this are refetched (and eligible for deletion). */
export const CACHE_TTL_DAYS = 7;

/**
 * Stable per-query cache key. JSON-encodes the normalized fields so a value
 * containing the delimiter can't collide with a different (company, domain) pair.
 */
export function peopleCacheKey(company: string, domain?: string | null): string {
  return JSON.stringify([company.trim().toLowerCase(), (domain ?? '').trim().toLowerCase()]);
}

/** The cutoff before which a cache row is stale. */
export function staleCutoff(now: Date, ttlDays: number = CACHE_TTL_DAYS): Date {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);
}

/** True when a cached row is still within the TTL. */
export function isCacheFresh(
  fetchedAt: Date,
  now: Date,
  ttlDays: number = CACHE_TTL_DAYS,
): boolean {
  return now.getTime() - fetchedAt.getTime() < ttlDays * 24 * 60 * 60 * 1000;
}
