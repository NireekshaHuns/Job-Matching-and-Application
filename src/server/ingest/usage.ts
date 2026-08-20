/**
 * Persistence for metered-source usage. The rules live in `metering.ts`; this
 * only reads and writes the row.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { meteredSourceUsage } from '@/server/db/schema';
import type { MeteredUsage } from './metering';

/** Recorded usage for a source, or null if it has never run. */
export async function loadMeteredUsage(db: DB, source: string): Promise<MeteredUsage | null> {
  const [row] = await db
    .select({
      month: meteredSourceUsage.month,
      requestsUsed: meteredSourceUsage.requestsUsed,
      lastRunDate: meteredSourceUsage.lastRunDate,
    })
    .from(meteredSourceUsage)
    .where(eq(meteredSourceUsage.source, source))
    .limit(1);
  return row ?? null;
}

export async function saveMeteredUsage(db: DB, source: string, usage: MeteredUsage): Promise<void> {
  await db
    .insert(meteredSourceUsage)
    .values({ source, ...usage, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: meteredSourceUsage.source,
      set: { ...usage, updatedAt: new Date() },
    });
}

/**
 * Add to the month's count without reading it first.
 *
 * `saveMeteredUsage` computes its total from a row fetched before the requests
 * went out, so a second writer's increment is lost. `concurrency: 1` makes that
 * near-impossible in one environment, but a local Inngest dev server or a script
 * pointed at the same database breaks the assumption — and the consequence is
 * undercounting a budget whose entire purpose is not to be exceeded.
 */
export async function addMeteredRequests(
  db: DB,
  source: string,
  month: string,
  requests: number,
  runDate: string,
): Promise<void> {
  await db
    .insert(meteredSourceUsage)
    .values({ source, month, requestsUsed: requests, lastRunDate: runDate, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: meteredSourceUsage.source,
      set: {
        // A row carried over from an earlier month starts again rather than
        // accumulating into the new one.
        requestsUsed: sql`case when ${meteredSourceUsage.month} = ${month} then ${meteredSourceUsage.requestsUsed} + ${requests} else ${requests} end`,
        month,
        lastRunDate: runDate,
        updatedAt: new Date(),
      },
    });
}
