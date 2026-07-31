/**
 * Upsert aggregated sponsor rows into the `sponsors` table and the per-year
 * `sponsor_filings` series.
 *
 * The schema is imported by relative path (not the `@/` alias) so the standalone
 * `tsx` ingest script can run this without needing tsconfig path resolution at
 * runtime. `DB` is a type-only import, so it's erased at runtime.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { sponsorFilings, sponsors } from '../../../server/db/schema';
import type { SponsorAggregate, SponsorFilingRow } from './aggregate';

/** Rows per insert — keeps statements well under Neon's HTTP size limits. */
const CHUNK_SIZE = 500;

/**
 * Insert or update sponsor rows, keyed by `company_name_normalized`. Returns
 * the number of rows sent for upsert (not a new-vs-updated breakdown).
 */
export async function loadSponsors(db: DB, aggregates: SponsorAggregate[]): Promise<number> {
  let written = 0;

  for (let i = 0; i < aggregates.length; i += CHUNK_SIZE) {
    const chunk = aggregates.slice(i, i + CHUNK_SIZE);
    await db
      .insert(sponsors)
      .values(
        chunk.map((a) => ({
          companyNameNormalized: a.companyNameNormalized,
          sponsorCount: a.sponsorCount,
          approvalRate: a.approvalRate,
          lastFiledYear: a.lastFiledYear,
          newEmploymentApprovals: a.newEmploymentApprovals,
          newEmploymentLastYear: a.newEmploymentLastYear,
          newEmploymentRecentYears: a.newEmploymentRecentYears,
        })),
      )
      .onConflictDoUpdate({
        target: sponsors.companyNameNormalized,
        set: {
          sponsorCount: sql`excluded.sponsor_count`,
          approvalRate: sql`excluded.approval_rate`,
          lastFiledYear: sql`excluded.last_filed_year`,
          newEmploymentApprovals: sql`excluded.new_employment_approvals`,
          newEmploymentLastYear: sql`excluded.new_employment_last_year`,
          newEmploymentRecentYears: sql`excluded.new_employment_recent_years`,
          updatedAt: sql`now()`,
        },
      });
    written += chunk.length;
  }

  return written;
}

/**
 * Insert or update per-year filing rows, keyed by (company, fiscal_year). Lets
 * the board show a new-employment trend and recompute rollups if the tiering
 * rules change, without re-parsing the CSVs.
 */
export async function loadSponsorFilings(db: DB, filings: SponsorFilingRow[]): Promise<number> {
  let written = 0;

  for (let i = 0; i < filings.length; i += CHUNK_SIZE) {
    const chunk = filings.slice(i, i + CHUNK_SIZE);
    await db
      .insert(sponsorFilings)
      .values(chunk)
      .onConflictDoUpdate({
        target: [sponsorFilings.companyNameNormalized, sponsorFilings.fiscalYear],
        set: {
          initialApprovals: sql`excluded.initial_approvals`,
          initialDenials: sql`excluded.initial_denials`,
          continuingApprovals: sql`excluded.continuing_approvals`,
          continuingDenials: sql`excluded.continuing_denials`,
        },
      });
    written += chunk.length;
  }

  return written;
}
