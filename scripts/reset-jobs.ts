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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const confirmed = process.argv.includes('--yes');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

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

  const res = await db.execute(sql`delete from jobs where not (${keptPredicate})`);
  console.log(`\nDeleted ${res.rowCount ?? 0} row(s). ${counts.kept} kept.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
