/**
 * Parse existing `jobs.salary_text` into the `salary_min_usd` / `salary_max_usd`
 * columns the "Min pay" board filter reads.
 *
 * Enrichment fills these going forward; without this, every posting ingested
 * before the columns existed reads as "pay unknown" and the filter only bites on
 * newly-found jobs. `parseSalaryRange` is pure and free (no LLM), so every row
 * can be corrected without re-classifying anything — the cost-control invariant
 * holds.
 *
 * Idempotent, and re-runnable AFTER A PARSER FIX: rows that no longer parse are
 * actively reset to null rather than skipped. Without that, a value written by
 * an earlier, buggier parser would survive the fix forever — and a wrong
 * `salary_max_usd` hides a real job at every threshold above it.
 *
 * Usage: pnpm backfill:salary [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { isNotNull, sql } from 'drizzle-orm';
import { parseSalaryRange } from '@/lib/salary';
import * as schema from '@/server/db/schema';

/**
 * Rows per UPDATE. Each batch is ONE statement over a VALUES list rather than
 * one statement per row: the driver speaks HTTP, so 4,000 round trips take
 * minutes while 20 batched ones take seconds.
 */
const CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Explicit locale: the default follows the machine's and groups digits oddly. */
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const rows = await db
    .select({ id: schema.jobs.id, salaryText: schema.jobs.salaryText })
    .from(schema.jobs)
    .where(isNotNull(schema.jobs.salaryText));

  interface Update {
    id: number;
    text: string;
    minUsd: number | null;
    maxUsd: number | null;
  }
  const updates: Update[] = [];
  /** Reporting only — the write list is `updates`. */
  const parsed: { text: string; minUsd: number; maxUsd: number }[] = [];
  const unparsed: string[] = [];
  for (const row of rows) {
    const text = row.salaryText ?? '';
    const range = parseSalaryRange(row.salaryText);
    if (range) parsed.push({ text, ...range });
    else unparsed.push(text);
    // Unparseable rows are written too, as an explicit null pair — see the
    // header. Skipping them is what would make a bad parse permanent.
    updates.push({
      id: row.id,
      text,
      minUsd: range?.minUsd ?? null,
      maxUsd: range?.maxUsd ?? null,
    });
  }

  const pct = rows.length ? ((parsed.length / rows.length) * 100).toFixed(1) : '0.0';
  console.log(`${rows.length} row(s) state pay; ${parsed.length} parsed (${pct}%).`);
  console.log('\nSample:');
  for (const p of parsed.slice(0, 10)) {
    console.log(`  ${p.text.padEnd(28)} → ${usd(p.minUsd)}–${usd(p.maxUsd)}`);
  }
  // Left as null (= "unknown pay"), so these postings stay visible at every
  // threshold. In practice they are non-USD ranges we refuse to guess at.
  console.log(`\nUnparsed → reset to null (stay visible at every threshold): ${unparsed.length}`);
  for (const u of [...new Set(unparsed)].slice(0, 10)) console.log(`  ${u}`);

  if (dryRun) {
    console.log(`\n--dry-run: would write ${updates.length} row(s), ${parsed.length} with values.`);
    return;
  }

  let updated = 0;
  for (const batch of chunk(updates, CHUNK)) {
    const values = sql.join(
      batch.map((p) => sql`(${p.id}::int, ${p.text}::text, ${p.minUsd}::int, ${p.maxUsd}::int)`),
      sql`, `,
    );
    // Guarded on the exact text the value was derived from, so a row an enrich
    // run re-classified while this script was reading keeps ITS numbers rather
    // than being overwritten with ones parsed from text that no longer applies.
    const res = await db.execute(sql`
      update ${schema.jobs} as j
         set salary_min_usd = v.min_usd,
             salary_max_usd = v.max_usd
        from (values ${values}) as v(id, salary_text, min_usd, max_usd)
       where j.id = v.id
         and j.salary_text = v.salary_text
    `);
    updated += res.rowCount ?? 0;
    console.log(`  …${updated}/${updates.length}`);
  }
  // A shortfall here is expected, not an error: the guard above skips any row an
  // enrich run re-classified while this script was reading.
  console.log(
    `\nWrote ${updated} of ${updates.length} row(s)` +
      (updated < updates.length ? ' (the rest changed under us and kept their own values).' : '.'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
