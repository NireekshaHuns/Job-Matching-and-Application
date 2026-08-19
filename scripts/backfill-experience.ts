/**
 * Fill `jobs.required_years_experience` for postings ingested before the column
 * existed, by re-reading their stored descriptions.
 *
 * Enrichment fills it going forward. Without this the board's experience filter
 * would only bite on newly-found jobs, and since a null reads as "unknown" (and
 * is therefore kept), every older posting would sail through the filter.
 *
 * Pure and free — `parseRequiredYears` is a regex over text we already hold, so
 * nothing is re-classified and no LLM is called.
 *
 * Idempotent, and safe to re-run after a parser change: postings that no longer
 * parse are reset to null rather than skipped, so a stale value cannot survive.
 *
 * Usage: pnpm backfill:experience [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { parseRequiredYears } from '@/lib/experience';
import * as schema from '@/server/db/schema';

/** Rows per batched UPDATE. */
const CHUNK = 200;

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

  const rows = await db
    .select({ id: schema.jobs.id, jdText: schema.jobs.jdText })
    .from(schema.jobs);

  const updates = rows.map((r) => ({ id: r.id, years: parseRequiredYears(r.jdText) }));
  const stated = updates.filter((u) => u.years != null);
  const buckets = new Map<number, number>();
  for (const u of stated) buckets.set(u.years!, (buckets.get(u.years!) ?? 0) + 1);

  const pct = rows.length ? ((stated.length / rows.length) * 100).toFixed(0) : '0';
  console.log(`${rows.length} job(s); ${stated.length} state a requirement (${pct}%).`);
  console.log(
    'years → ' +
      [...buckets]
        .sort((a, b) => a[0] - b[0])
        .map(([y, n]) => `${y}y:${n}`)
        .join('  '),
  );
  const within3 = stated.filter((u) => (u.years ?? 0) <= 3).length;
  console.log(
    `\nAt the board's 3-year default: ${within3} of the ${stated.length} that state one pass, ` +
      `plus all ${rows.length - stated.length} that state none.`,
  );

  if (dryRun) {
    console.log(`\n--dry-run: would write ${updates.length} row(s).`);
    return;
  }

  let written = 0;
  for (const batch of chunk(updates, CHUNK)) {
    const values = sql.join(
      batch.map((u) => sql`(${u.id}::int, ${u.years}::int)`),
      sql`, `,
    );
    const res = await db.execute(sql`
      update ${schema.jobs} as j
         set required_years_experience = v.years
        from (values ${values}) as v(id, years)
       where j.id = v.id
    `);
    written += res.rowCount ?? 0;
  }
  console.log(`\nUpdated ${written} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
