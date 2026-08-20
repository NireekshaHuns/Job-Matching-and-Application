/**
 * Re-normalize sponsor join keys left with a dangling `AND`.
 *
 * `normalizeCompanyName` expanded `&` to `AND` before stripping trailing legal
 * suffixes, so "JPMorgan Chase & Co." became `JPMORGAN CHASE AND` — a key that
 * "JPMorgan Chase" can never match. The function is fixed, but the keys were
 * WRITTEN by the old one, so the stored rows still carry the broken form and
 * fixing the code alone makes the mismatch worse, not better.
 *
 * 101 employers are affected, and they are not marginal: JPMorgan Chase (2,112
 * filings, 373 new-hire approvals), Goldman Sachs (607/376), Eli Lilly (226/97),
 * Morgan Stanley (129/72). Every job at those companies was scoring as if they
 * had never sponsored anyone.
 *
 * Both `sponsors` and `sponsor_filings` are keyed by the normalized name, so
 * both are rewritten. `company_aliases` references `sponsors.id` and is
 * untouched. Verified against the live data: no re-keyed row collides with an
 * existing one, so this is a rename rather than a merge — the script refuses to
 * proceed if that ever stops being true.
 *
 * Idempotent: a second run finds nothing to do.
 *
 * Usage: pnpm backfill:sponsor-keys [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { normalizeCompanyName } from '@/lib/sponsorship/normalize';
import * as schema from '@/server/db/schema';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const rows = await db
    .select({
      key: schema.sponsors.companyNameNormalized,
      sponsorCount: schema.sponsors.sponsorCount,
      newEmployment: schema.sponsors.newEmploymentApprovals,
    })
    .from(schema.sponsors)
    .where(sql`${schema.sponsors.companyNameNormalized} like '% AND'`);

  // Re-normalizing the key through the fixed function, rather than trimming the
  // suffix by hand, so this stays correct if normalization changes again.
  const renames = rows
    .map((r) => ({ ...r, fixed: normalizeCompanyName(r.key) }))
    .filter((r) => r.fixed && r.fixed !== r.key);

  console.log(`${rows.length} row(s) with a dangling AND; ${renames.length} to re-key.`);
  for (const r of [...renames].sort((a, b) => b.newEmployment - a.newEmployment).slice(0, 10)) {
    console.log(
      `   ${r.key.padEnd(34)} → ${r.fixed.padEnd(28)} (${r.sponsorCount} filings, ${r.newEmployment} new-hire)`,
    );
  }

  // A collision would mean merging two employers' counts, which is a different
  // and much riskier operation than a rename. Refuse rather than guess.
  const existing = new Set(
    (await db.select({ key: schema.sponsors.companyNameNormalized }).from(schema.sponsors)).map(
      (r) => r.key,
    ),
  );
  const colliding = renames.filter((r) => existing.has(r.fixed));
  if (colliding.length > 0) {
    console.error(`\n${colliding.length} row(s) would collide with an existing key:`);
    for (const c of colliding.slice(0, 10)) console.error(`   ${c.key} → ${c.fixed}`);
    console.error('This script only renames. Merging counts needs a deliberate decision.');
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n--dry-run: would re-key ${renames.length} sponsor(s) and their filings.`);
    return;
  }

  let sponsorsUpdated = 0;
  let filingsUpdated = 0;
  for (const r of renames) {
    const s = await db.execute(
      sql`update sponsors set company_name_normalized = ${r.fixed} where company_name_normalized = ${r.key}`,
    );
    const f = await db.execute(
      sql`update sponsor_filings set company_name_normalized = ${r.fixed} where company_name_normalized = ${r.key}`,
    );
    sponsorsUpdated += s.rowCount ?? 0;
    filingsUpdated += f.rowCount ?? 0;
  }

  console.log(`\nRe-keyed ${sponsorsUpdated} sponsor(s) and ${filingsUpdated} filing row(s).`);
  console.log('Run `pnpm backfill:sponsor-tier` next so jobs pick up the new matches.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
