/**
 * Re-run sponsor matching and tiering over every job already in the DB.
 *
 * Two corrections land here, neither of which needs an LLM call or a re-fetch:
 *
 *  1. Company names now resolve to the corporate entity that actually sponsors
 *     new hires, instead of the one with the shortest name. Measured on the live
 *     board, 82 companies matched a stronger USCIS employer — "Deloitte" was
 *     reading 2 filings instead of 1,298, "State Street" 1 instead of 170.
 *  2. An employer with 5+ new-employment approvals in the latest filed year is
 *     tiered High, which the previous lifetime-only threshold of 25 missed.
 *
 * Jobs enriched before either change keep their stale tier until this runs, and
 * `sponsor_tier` is what the board sorts and filters on.
 *
 * Idempotent — every value is re-derived from `jobs` + `sponsors`, so a run that
 * dies partway through is repaired by running it again. The batches are separate
 * statements on purpose (65 of them over ~13k rows); the alternative is one
 * transaction big enough to hold the whole table.
 *
 * Usage: pnpm backfill:sponsor-tier [--dry-run]
 * Requires DATABASE_URL.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { newHireStatus, scoreSponsorship } from '@/lib/sponsorship';
import {
  loadConfirmedAliases,
  loadSponsorState,
  upsertDiscoveredAliases,
} from '@/server/enrich/run';
import { buildSponsorResolver } from '@/server/enrich/steps/resolver';
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

  const sponsorState = await loadSponsorState(db);
  const confirmedAliases = await loadConfirmedAliases(db, sponsorState.idByKey);
  const { resolve, discovered } = buildSponsorResolver({
    historyByKey: sponsorState.historyByKey,
    confirmedAliases,
  });
  console.log(`${sponsorState.historyByKey.size} USCIS employers loaded.`);

  const rows = await db
    .select({
      id: schema.jobs.id,
      company: schema.jobs.company,
      jdText: schema.jobs.jdText,
      tier: schema.jobs.sponsorTier,
      newHireStatus: schema.jobs.newHireStatus,
    })
    .from(schema.jobs);

  interface Update {
    id: number;
    tier: (typeof schema.sponsorTierEnum.enumValues)[number];
    reason: string;
    sponsorCount: number | null;
    newHireStatus: (typeof schema.newHireStatusEnum.enumValues)[number];
    confidence: number | null;
  }
  const updates: Update[] = [];
  const moved: string[] = [];
  const counts = new Map<string, number>();

  for (const row of rows) {
    const match = resolve(row.company);
    const score = scoreSponsorship({ jdText: row.jdText, history: match.history });
    const status = newHireStatus(match.history);

    updates.push({
      id: row.id,
      tier: score.tier,
      reason: score.reason,
      sponsorCount: match.history?.sponsorCount ?? null,
      newHireStatus: status,
      confidence: match.confidence,
    });

    if (score.tier !== row.tier) {
      const key = `${row.tier} → ${score.tier}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (moved.length < 20) {
        moved.push(
          `  ${String(row.company).slice(0, 24).padEnd(25)} ${key.padEnd(20)} ${score.reason}`,
        );
      }
    }
  }

  const changed = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${rows.length} job(s) re-scored; ${changed} change tier.`);
  for (const [move, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${move.padEnd(22)} ${n}`);
  }
  console.log('\nsample:');
  console.log(moved.join('\n'));

  if (dryRun) {
    console.log(`\n--dry-run: would write ${updates.length} row(s).`);
    return;
  }

  let written = 0;
  for (const batch of chunk(updates, CHUNK)) {
    const values = sql.join(
      batch.map(
        (u) =>
          sql`(${u.id}::int, ${u.tier}::sponsor_tier, ${u.reason}::text, ${u.sponsorCount}::int, ${u.newHireStatus}::new_hire_status, ${u.confidence}::real)`,
      ),
      sql`, `,
    );
    const res = await db.execute(sql`
      update ${schema.jobs} as j
         set sponsor_tier = v.tier,
             sponsor_reason = v.reason,
             sponsor_count = v.sponsor_count,
             new_hire_status = v.new_hire_status,
             sponsor_match_confidence = v.confidence
        from (values ${values}) as v(id, tier, reason, sponsor_count, new_hire_status, confidence)
       where j.id = v.id
    `);
    written += res.rowCount ?? 0;
    console.log(`  …${written}/${updates.length}`);
  }
  if (written < updates.length) {
    // Expected only if a row was deleted between the read and the write.
    console.warn(`${updates.length - written} row(s) were not updated — deleted mid-run?`);
  }
  console.log(`\nUpdated ${written} row(s).`);

  // Keep the audit trail honest: `company_aliases` is the record of which USCIS
  // employer each company name resolved to, and leaving it stale would have it
  // disagree with the tiers just written.
  const aliases = await upsertDiscoveredAliases(db, discovered.values(), sponsorState.idByKey);
  console.log(`Recorded ${aliases} discovered alias(es).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
