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
import { desc, eq, ilike, sql } from 'drizzle-orm';
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

const SPONSOR_ROLLUP = {
  id: sponsors.id,
  name: sponsors.companyNameNormalized,
  sponsorCount: sponsors.sponsorCount,
  approvalRate: sponsors.approvalRate,
  lastFiledYear: sponsors.lastFiledYear,
  newEmploymentApprovals: sponsors.newEmploymentApprovals,
  newEmploymentLastYear: sponsors.newEmploymentLastYear,
  newEmploymentRecentYears: sponsors.newEmploymentRecentYears,
} as const;

function toHistory(row: {
  sponsorCount: number;
  approvalRate: number | null;
  lastFiledYear: number | null;
  newEmploymentApprovals: number;
  newEmploymentLastYear: number | null;
}): SponsorHistory {
  return {
    sponsorCount: row.sponsorCount,
    approvalRate: row.approvalRate,
    lastFiledYear: row.lastFiledYear,
    newEmploymentApprovals: row.newEmploymentApprovals,
    newEmploymentLastYear: row.newEmploymentLastYear,
  };
}

export const sponsorsRouter = createTRPCRouter({
  /** Sponsor rollup + current match metadata for a company, for the badge tooltip. */
  detail: publicProcedure
    .input(z.object({ company: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const normalized = normalizeCompanyName(input.company);
      if (!normalized) return { normalized: '', alias: null, sponsor: null };

      const [alias] = await ctx.db
        .select({
          sponsorId: companyAliases.sponsorId,
          matchConfidence: companyAliases.matchConfidence,
          matchMethod: companyAliases.matchMethod,
          confirmed: companyAliases.confirmed,
        })
        .from(companyAliases)
        .where(eq(companyAliases.rawNameNormalized, normalized))
        .limit(1);

      // Prefer the alias's sponsor; else fall back to an exact normalized hit.
      let sponsor = null;
      if (alias?.sponsorId != null) {
        [sponsor] = await ctx.db
          .select(SPONSOR_ROLLUP)
          .from(sponsors)
          .where(eq(sponsors.id, alias.sponsorId))
          .limit(1);
      } else if (!alias) {
        [sponsor] = await ctx.db
          .select(SPONSOR_ROLLUP)
          .from(sponsors)
          .where(eq(sponsors.companyNameNormalized, normalized))
          .limit(1);
      }

      return {
        normalized,
        alias: alias
          ? {
              confidence: alias.matchConfidence,
              method: alias.matchMethod,
              confirmed: alias.confirmed,
            }
          : null,
        sponsor: sponsor ?? null,
      };
    }),

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
        .select(SPONSOR_ROLLUP)
        .from(sponsors)
        .where(eq(sponsors.id, input.sponsorId))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsor not found.' });
      history = toHistory(row);
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

    // Re-derive denormalized fields on affected jobs. Normalization isn't
    // expressible in SQL here, so filter in JS — fine at personal-board scale.
    const jobRows = await ctx.db
      .select({ id: jobs.id, company: jobs.company, jdText: jobs.jdText })
      .from(jobs);
    const affected = jobRows.filter((j) => normalizeCompanyName(j.company) === normalized);

    for (const j of affected) {
      await ctx.db
        .update(jobs)
        .set(recomputeSponsorship(j.jdText, history, confidence))
        .where(eq(jobs.id, j.id));
    }

    return { updatedJobs: affected.length };
  }),
});
