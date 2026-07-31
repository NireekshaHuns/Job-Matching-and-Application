/**
 * Scheduled cleanup of stale `people_cache` rows (spec §7 privacy hygiene). The
 * on-miss opportunistic delete only runs when the finder is used; this bounds
 * how long cached third-party PII can linger even if it isn't. `db` is injected
 * (type-only import) so this is unit-testable without a live connection.
 */
import { lt } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { peopleCache } from '@/server/db/schema';
import { staleCutoff } from './cache';

/** Delete cache rows older than the TTL. Returns the number of rows removed. */
export async function purgeStalePeopleCache(db: DB, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(peopleCache)
    .where(lt(peopleCache.fetchedAt, staleCutoff(now)))
    .returning({ id: peopleCache.id });
  return removed.length;
}
