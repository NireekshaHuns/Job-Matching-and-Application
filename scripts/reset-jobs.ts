/**
 * Empty the board and start over.
 *
 * WHY THIS EXISTS. The `jobs` table accumulated under a pipeline that was
 * mis-tiering sponsorship, dropping software titles at ingest, and barely
 * advancing its fetch window. Re-deriving what could be re-derived has already
 * happened (see the backfill scripts); what remains is a large tail of postings
 * that are stale, were never reachable in the first place, or were classified by
 * rules that have since changed. Refetching under the fixed pipeline is cheaper
 * and more honest than trying to repair them in place.
 *
 * WHAT SURVIVES. Anything the owner has touched:
 *  - jobs with an application, a contact, or logged outreach — the tracker is
 *    the one thing here that cannot be refetched;
 *  - jobs that were explicitly dismissed, because "never show me this again"
 *    must outlive a refill that would otherwise resurrect them.
 *
 * `job_scores` rows cascade with their job. Everything else in the schema
 * (sponsors, resumes, the corpus) is untouched.
 *
 * DESTRUCTIVE AND IRREVERSIBLE. Runs as a dry run unless `--yes` is passed.
 *
 * Usage: pnpm reset:jobs [--yes]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';

async function countApplications(db: ReturnType<typeof drizzle>): Promise<number> {
  const rows = await db
    .execute(sql`select count(*)::int as n from applications`)
    .then((r) => r.rows as Array<{ n: number }>);
  return rows[0]?.n ?? 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const confirmed = process.argv.includes('--yes');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  // Say which database is about to be emptied. `pnpm reset:jobs --yes` in a
  // shell that happens to have a production URL loaded is one keystroke away.
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`Target: ${url.hostname}${url.pathname}\n`);
  } catch {
    console.log('Target: (unparseable DATABASE_URL)\n');
  }

  /** Jobs the owner has touched, in any way we can detect. */
  const keptPredicate = sql`
    exists (select 1 from applications a where a.job_id = jobs.id)
    or exists (select 1 from contacts c where c.job_id = jobs.id)
    or exists (
      select 1 from outreach_log o
      join contacts c2 on c2.id = o.contact_id
      where c2.job_id = jobs.id
    )
    or jobs.dismissed_at is not null
  `;

  const [counts] = await db
    .execute(
      sql`
    select
      count(*)::int as total,
      count(*) filter (where ${keptPredicate})::int as kept
    from jobs
  `,
    )
    .then((r) => r.rows as Array<{ total: number; kept: number }>);

  const doomed = counts.total - counts.kept;
  console.log(`${counts.total} job(s) in the table.`);
  console.log(`  keeping ${counts.kept} (applied to, contacted, or dismissed)`);
  console.log(`  deleting ${doomed}`);

  const bySource = await db
    .execute(
      sql`select source, count(*)::int as n from jobs where not (${keptPredicate}) group by source order by n desc`,
    )
    .then((r) => r.rows as Array<{ source: string; n: number }>);
  console.log('\nto delete, by source:');
  for (const row of bySource) console.log(`   ${String(row.source).padEnd(24)} ${row.n}`);

  if (!confirmed) {
    console.log(`\nDry run. Nothing was deleted. Re-run with --yes to delete ${doomed} row(s).`);
    return;
  }

  // The tracker is the one thing here that cannot be refetched, and
  // `applications.job_id` cascades — so a hole in the predicate above would take
  // it silently rather than raising a foreign-key error. The predicate is the
  // only line of defence, so verify it held rather than trusting it.
  const applicationsBefore = await countApplications(db);

  const res = await db.execute(sql`delete from jobs where not (${keptPredicate})`);
  const applicationsAfter = await countApplications(db);

  console.log(`\nDeleted ${res.rowCount ?? 0} row(s). ${counts.kept} kept.`);
  if (applicationsAfter !== applicationsBefore) {
    console.error(
      `\nAPPLICATIONS LOST: ${applicationsBefore} before, ${applicationsAfter} after. ` +
        'The keep-predicate missed something — investigate before running this again.',
    );
    process.exit(1);
  }
  console.log(`Tracker intact: ${applicationsAfter} application(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
