/**
 * Durable daily cleanup of stale `people_cache` rows (spec §7). Bounds how long
 * cached third-party PII lingers even if the finder isn't used (the on-miss
 * opportunistic delete covers the used case).
 *
 * Like the other functions, heavy/env-bound imports are dynamic and inside the
 * step so registration never pulls secrets at import time.
 */
import { inngest } from '../client';

export const peopleCachePurge = inngest.createFunction(
  {
    id: 'people-cache-purge',
    concurrency: { limit: 1 },
    triggers: [{ cron: '0 4 * * *' }], // daily at 04:00 UTC
  },
  async ({ step }) => {
    return step.run('purge-stale-people-cache', async () => {
      const { neon } = await import('@neondatabase/serverless');
      const { drizzle } = await import('drizzle-orm/neon-http');
      const schema = await import('@/server/db/schema');
      const { purgeStalePeopleCache } = await import('@/server/people/purge');

      const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
      const purged = await purgeStalePeopleCache(db);
      return { purged };
    });
  },
);
