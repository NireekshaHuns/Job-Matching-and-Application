/**
 * Backfill jobs.is_us for rows ingested before the US-location step existed.
 * deriveIsUs is pure and free (no LLM), so this is safe to run any time; it only
 * touches rows where is_us IS NULL.
 *
 * Usage: pnpm backfill:is-us
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, isNull } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { deriveIsUs } from '@/server/enrich/steps/location';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const rows = await db
    .select({ id: schema.jobs.id, location: schema.jobs.location })
    .from(schema.jobs)
    .where(isNull(schema.jobs.isUs));

  let updated = 0;
  for (const row of rows) {
    const isUs = deriveIsUs(row.location);
    if (isUs === null) continue; // leave genuinely-unknown rows null (shown by default)
    await db.update(schema.jobs).set({ isUs }).where(eq(schema.jobs.id, row.id));
    updated++;
  }
  console.log(`Backfilled is_us on ${updated}/${rows.length} rows (rest stay unknown).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
