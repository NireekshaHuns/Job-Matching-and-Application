/**
 * Delete stale (past-TTL) rows from `people_cache` (privacy hygiene). The daily
 * Inngest cron does this automatically; this is the manual equivalent.
 *
 * Usage: pnpm people:purge
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/server/db/schema';
import { purgeStalePeopleCache } from '@/server/people/purge';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const purged = await purgeStalePeopleCache(db);
  console.log(`Purged ${purged} stale people_cache row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
