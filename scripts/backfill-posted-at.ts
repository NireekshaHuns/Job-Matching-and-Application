/**
 * Backfill `jobs.posted_at` for rows ingested while a connector was dropping
 * the date.
 *
 * The Ashby connector read `publishedDate`, but the API returns `publishedAt`,
 * so every Ashby posting stored a null date and the board showed "date n/a".
 * Fixing the connector only helps NEW postings: insertion is dedup-by-
 * fingerprint, so existing rows are never rewritten and would stay blank
 * forever.
 *
 * Re-fetches each connector and matches on `source_job_id` (falling back to
 * `fingerprint`), then fills in dates that are currently null. Never overwrites
 * a date we already have.
 *
 * Usage: pnpm backfill:posted-at [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { buildConnectors } from '@/server/ingest/registry';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const undated = await db
    .select({
      id: schema.jobs.id,
      source: schema.jobs.source,
      sourceJobId: schema.jobs.sourceJobId,
      fingerprint: schema.jobs.fingerprint,
    })
    .from(schema.jobs)
    .where(isNull(schema.jobs.postedAt));

  if (undated.length === 0) {
    console.log('No rows are missing posted_at.');
    return;
  }
  const bySource = new Map<string, typeof undated>();
  for (const row of undated) {
    const list = bySource.get(row.source) ?? [];
    list.push(row);
    bySource.set(row.source, list);
  }
  console.log(`${undated.length} row(s) missing posted_at:`);
  for (const [source, rows] of bySource) console.log(`  ${source.padEnd(26)} ${rows.length}`);

  let filled = 0;
  for (const connector of buildConnectors()) {
    const rows = bySource.get(connector.source);
    if (!rows || rows.length === 0) continue;

    const postings = await connector.fetch();
    const byId = new Map<string, Date>();
    const byFingerprint = new Map<string, Date>();
    for (const p of postings) {
      if (!p.postedAt) continue;
      if (p.sourceJobId) byId.set(p.sourceJobId, p.postedAt);
      byFingerprint.set(p.fingerprint, p.postedAt);
    }

    let sourceFilled = 0;
    for (const row of rows) {
      const postedAt =
        (row.sourceJobId ? byId.get(row.sourceJobId) : undefined) ??
        byFingerprint.get(row.fingerprint);
      if (!postedAt) continue;
      if (!dryRun) {
        // Guard on isNull so a concurrent enrich run can't be clobbered.
        await db
          .update(schema.jobs)
          .set({ postedAt })
          .where(and(eq(schema.jobs.id, row.id), isNull(schema.jobs.postedAt)));
      }
      sourceFilled++;
    }
    filled += sourceFilled;
    console.log(`  ${connector.source}: matched ${sourceFilled}/${rows.length}`);
  }

  console.log(
    dryRun ? `--dry-run: would fill ${filled} row(s).` : `Filled posted_at on ${filled} row(s).`,
  );
  const left = undated.length - filled;
  if (left > 0) {
    console.log(`${left} row(s) unmatched — those postings are no longer in their feed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
