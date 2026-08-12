/**
 * Re-derive jobs.seniority for rows the classifier graded `other` purely because
 * their title states no level.
 *
 * `seniority` has no bucket for "unlevelled", so the model parked plain
 * "Software Engineer" postings in `other` — which the board hides by default.
 * `resolveSeniority` is pure and free (no LLM), so every existing row can be
 * corrected without re-classifying anything.
 *
 * Only ever moves `other` → `mid`, and only when the title carries no
 * senior/lead/management signal. `entry` and `mid` rows are never touched.
 *
 * Usage: pnpm backfill:seniority [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { resolveSeniority } from '@/server/enrich/steps/seniority';

/** Batch size for the update statements. */
const CHUNK = 500;

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
    .select({ id: schema.jobs.id, title: schema.jobs.title, company: schema.jobs.company })
    .from(schema.jobs)
    .where(eq(schema.jobs.seniority, 'other'));

  const rescued = rows.filter((r) => resolveSeniority(r.title, 'other') === 'mid');
  console.log(`${rows.length} row(s) graded "other"; ${rescued.length} have no senior signal.`);

  console.log('\nSample of what changes:');
  for (const r of rescued.slice(0, 15)) {
    console.log(`  ${String(r.company).slice(0, 22).padEnd(23)} ${r.title}`);
  }
  console.log('\nSample of what stays hidden:');
  for (const r of rows.filter((x) => !rescued.includes(x)).slice(0, 8)) {
    console.log(`  ${String(r.company).slice(0, 22).padEnd(23)} ${r.title}`);
  }

  if (dryRun) {
    console.log(`\n--dry-run: would update ${rescued.length} row(s).`);
    return;
  }

  let updated = 0;
  for (const batch of chunk(
    rescued.map((r) => r.id),
    CHUNK,
  )) {
    // Guarded on seniority='other' so a concurrent enrich run can't be clobbered.
    const res = await db
      .update(schema.jobs)
      .set({ seniority: 'mid' })
      .where(and(inArray(schema.jobs.id, batch), eq(schema.jobs.seniority, 'other')))
      .returning({ id: schema.jobs.id });
    updated += res.length;
  }
  console.log(`\nUpdated ${updated} row(s) from "other" to "mid".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
