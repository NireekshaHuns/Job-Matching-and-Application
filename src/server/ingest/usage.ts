/**
 * Persistence for metered-source usage. The rules live in `metering.ts`; this
 * only reads and writes the row.
 */
import { eq } from 'drizzle-orm';
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
