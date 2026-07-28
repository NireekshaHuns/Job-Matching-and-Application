/**
 * Upsert aggregated sponsor rows into the `sponsors` table.
 *
 * The schema is imported by relative path (not the `@/` alias) so the standalone
 * `tsx` ingest script can run this without needing tsconfig path resolution at
 * runtime. `DB` is a type-only import, so it's erased at runtime.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { sponsors } from '../../../server/db/schema';
import type { SponsorAggregate } from './aggregate';

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
        })),
      )
      .onConflictDoUpdate({
        target: sponsors.companyNameNormalized,
        set: {
          sponsorCount: sql`excluded.sponsor_count`,
          approvalRate: sql`excluded.approval_rate`,
          lastFiledYear: sql`excluded.last_filed_year`,
          updatedAt: sql`now()`,
        },
      });
    written += chunk.length;
  }

  return written;
}
