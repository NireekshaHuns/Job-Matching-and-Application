/**
 * Sponsor detail + entity-resolution correction (spec §5.3). The board shows a
 * confidence-scored company→USCIS match; here the user can inspect it and
 * correct it. A correction writes a `confirmed` alias (authoritative on future
 * enrichment) and re-derives the denormalized sponsorship fields on every job
 * for that company so the board updates immediately.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { TRPCError } from '@trpc/server';
import { desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { companyAliases, jobs, sponsors } from '@/server/db/schema';
import {
  newHireStatus,
  normalizeCompanyName,
  scoreSponsorship,
  type SponsorHistory,
} from '@/lib/sponsorship';
import { createTRPCRouter, publicProcedure } from '../trpc';
import { escapeLike } from './jobs';

export const confirmAliasInput = z.object({
  /** The company name as shown on the board (raw). */
  company: z.string().min(1).max(200),
  /** Sponsor to map to, or null to confirm "no match". */
  sponsorId: z.number().int().nullable(),
});

/**
 * Pure: the denormalized sponsorship fields for a job given its JD and the
 * resolved history. Mirrors the enrichment build-row logic so a correction and
 * a fresh enrichment produce identical rows. `confidence` is the match
 * confidence to stamp (1 for a confirmed match, null for a confirmed no-match).
 */
export function recomputeSponsorship(
  jdText: string,
  history: SponsorHistory | null,
  confidence: number | null,
) {
  const { tier, reason } = scoreSponsorship({ jdText, history });
  return {
    sponsorTier: tier,
    sponsorReason: reason,
    sponsorCount: history?.sponsorCount ?? null,
    newHireStatus: newHireStatus(history),
    sponsorMatchConfidence: confidence,
  };
}

/** The `sponsors` columns needed to build a `SponsorHistory`. */
const HISTORY_COLUMNS = {
  sponsorCount: sponsors.sponsorCount,
  approvalRate: sponsors.approvalRate,
  lastFiledYear: sponsors.lastFiledYear,
  newEmploymentApprovals: sponsors.newEmploymentApprovals,
  newEmploymentLastYear: sponsors.newEmploymentLastYear,
} as const;

export const sponsorsRouter = createTRPCRouter({
  /** Candidate USCIS employers for the correction dropdown, strongest new-hire sponsors first. */
  search: publicProcedure
    .input(z.object({ query: z.string().trim().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: sponsors.id,
          name: sponsors.companyNameNormalized,
          sponsorCount: sponsors.sponsorCount,
          newEmploymentApprovals: sponsors.newEmploymentApprovals,
        })
        .from(sponsors)
        .where(ilike(sponsors.companyNameNormalized, `%${escapeLike(input.query)}%`))
        .orderBy(desc(sponsors.newEmploymentApprovals), desc(sponsors.sponsorCount))
        .limit(10);
    }),

  /**
   * Record a user correction: upsert a `confirmed` alias and re-derive the
   * denormalized sponsorship fields on every job for that company. Returns the
   * number of jobs updated.
   */
  confirmAlias: publicProcedure.input(confirmAliasInput).mutation(async ({ ctx, input }) => {
    const normalized = normalizeCompanyName(input.company);
    if (!normalized) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Company name is empty after normalization.',
      });
    }

    let history: SponsorHistory | null = null;
    if (input.sponsorId != null) {
      const [row] = await ctx.db
        .select(HISTORY_COLUMNS)
        .from(sponsors)
        .where(eq(sponsors.id, input.sponsorId))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsor not found.' });
      history = row;
    }
    const confidence = input.sponsorId != null ? 1 : null;

    await ctx.db
      .insert(companyAliases)
      .values({
        rawName: input.company,
        rawNameNormalized: normalized,
        sponsorId: input.sponsorId,
        matchConfidence: confidence ?? 0,
        matchMethod: 'manual',
        confirmed: true,
      })
      .onConflictDoUpdate({
        target: companyAliases.rawNameNormalized,
        set: {
          rawName: sql`excluded.raw_name`,
          sponsorId: sql`excluded.sponsor_id`,
          matchConfidence: sql`excluded.match_confidence`,
          matchMethod: sql`excluded.match_method`,
          confirmed: true,
          updatedAt: sql`now()`,
        },
      });

    // Find affected jobs. Normalization isn't expressible in SQL here, so pull
    // just id + company and filter in JS; only the matched subset then needs its
    // (potentially large) jdText loaded to recompute the tier.
    const idAndCompany = await ctx.db.select({ id: jobs.id, company: jobs.company }).from(jobs);
    const affectedIds = idAndCompany
      .filter((j) => normalizeCompanyName(j.company) === normalized)
      .map((j) => j.id);
    if (affectedIds.length === 0) return { updatedJobs: 0 };

    const affected = await ctx.db
      .select({ id: jobs.id, jdText: jobs.jdText })
      .from(jobs)
      .where(inArray(jobs.id, affectedIds));

    for (const j of affected) {
      await ctx.db
        .update(jobs)
        .set(recomputeSponsorship(j.jdText, history, confidence))
        .where(eq(jobs.id, j.id));
    }

    return { updatedJobs: affected.length };
  }),
});
