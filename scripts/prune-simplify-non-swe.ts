/**
 * One-off cleanup for jobs ingested from SimplifyJobs before the connector was
 * restricted to the software-engineering categories.
 *
 * `jobs` does not persist the original listing, so the category is recovered by
 * re-fetching `listings.json` and joining on `source_job_id` (which the
 * connector stores). Only rows that are STILL IN the feed and are categorized
 * as something other than software get deleted — a row whose listing has since
 * disappeared has an unknowable category, so it is left alone for
 * `reconcileFreshness` to close on its usual 14-day schedule.
 *
 * Deletion is re-ingestable: anything removed in error comes back on the next
 * `pnpm enrich` if it still matches the filter. Rows with an application on them
 * are never deleted — the tracker would lose the job behind a submitted
 * application.
 *
 * Usage: pnpm prune:simplify [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, inArray, isNotNull, and } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { isSoftwareCategory, SIMPLIFY_LISTINGS_URL } from '@/server/ingest/connectors/simplify';

const SOURCE = 'github:simplify-newgrad';
/** Batch size for the delete statements — keeps each SQL round-trip small. */
const CHUNK = 200;

interface Listing {
  id?: string;
  category?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const res = await fetch(SIMPLIFY_LISTINGS_URL);
  if (!res.ok) {
    console.error(`Could not fetch listings.json (HTTP ${res.status}); aborting.`);
    process.exit(1);
  }
  const listings = (await res.json()) as Listing[];
  const categoryById = new Map<string, string | undefined>();
  for (const l of listings) if (l.id) categoryById.set(l.id, l.category);
  console.log(`Fetched ${listings.length} upstream listings.`);

  const rows = await db
    .select({ id: schema.jobs.id, sourceJobId: schema.jobs.sourceJobId })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.source, SOURCE), isNotNull(schema.jobs.sourceJobId)));

  const doomed: number[] = [];
  const byCategory = new Map<string, number>();
  let unmatched = 0;
  for (const row of rows) {
    if (!categoryById.has(row.sourceJobId!)) {
      unmatched++; // gone from the feed — category unknowable, leave it
      continue;
    }
    const category = categoryById.get(row.sourceJobId!);
    if (isSoftwareCategory(category)) continue;
    const label = category ?? '(none)';
    byCategory.set(label, (byCategory.get(label) ?? 0) + 1);
    doomed.push(row.id);
  }

  console.log(`${rows.length} Simplify rows; ${unmatched} no longer in the feed (left alone).`);
  console.log(`${doomed.length} are still listed under a non-software category:`);
  for (const [label, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(28)} ${count}`);
  }

  // Applications are the one thing that would make a delete lossy.
  const applied = doomed.length
    ? await db
        .select({ jobId: schema.applications.jobId })
        .from(schema.applications)
        .where(inArray(schema.applications.jobId, doomed))
    : [];
  const appliedIds = new Set(applied.map((a) => a.jobId));
  if (appliedIds.size > 0) {
    console.log(`Keeping ${appliedIds.size} row(s) that have an application on them.`);
  }
  const deletable = doomed.filter((id) => !appliedIds.has(id));

  if (dryRun) {
    console.log(`--dry-run: would delete ${deletable.length} rows.`);
    return;
  }

  let deleted = 0;
  for (const batch of chunk(deletable, CHUNK)) {
    await db.delete(schema.jobScores).where(inArray(schema.jobScores.jobId, batch));
    const result = await db.delete(schema.jobs).where(inArray(schema.jobs.id, batch));
    deleted += result.rowCount ?? batch.length;
  }
  console.log(`Deleted ${deleted} non-software Simplify rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
