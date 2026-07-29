/**
 * Recompute keyword-overlap fit scores for every (job × base resume) into
 * job_scores. Run after enriching jobs and loading the inventory.
 *
 * Usage: pnpm score:fits
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/server/db/schema';
import { scoreFits } from '@/server/resume/fit-persist';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const count = await scoreFits(db);
  console.log(`Scored ${count} (job × base resume) fits.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
