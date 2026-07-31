/**
 * Job board queries. `list` returns enriched jobs with BOTH scores kept
 * separate: the H1B `sponsorTier` (on the job) and the resume `relevanceScore`
 * (left-joined from job_scores for a selected resume "lens"). The `combined`
 * sort is a display-only blend (tier-weighted + fit); the scores are never
 * merged into one stored value.
 */
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  employmentTypeEnum,
  jobScores,
  jobs,
  newHireStatusEnum,
  roleFamilyEnum,
  seniorityEnum,
  sponsorTierEnum,
} from '@/server/db/schema';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const jobListInput = z.object({
  /** Resume "lens": left-joins its fit score + skill gaps onto each job. */
  resumeId: z.number().int().optional(),
  sponsorTiers: z.array(z.enum(sponsorTierEnum.enumValues)).optional(),
  /** New-hire badge filter (Sponsors new hires / Transfers only / …). */
  newHireStatuses: z.array(z.enum(newHireStatusEnum.enumValues)).optional(),
  includeExcluded: z.boolean().default(false),
  roleFamilies: z.array(z.enum(roleFamilyEnum.enumValues)).optional(),
  seniorities: z.array(z.enum(seniorityEnum.enumValues)).optional(),
  /** Off by default: the board is scoped to entry/new-grad + mid roles. */
  includeSenior: z.boolean().default(false),
  employmentType: z.enum([...employmentTypeEnum.enumValues, 'all']).default('full_time'),
  remoteOnly: z.boolean().default(false),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['combined', 'sponsor', 'fit', 'recent']).default('combined'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type JobListInput = z.infer<typeof jobListInput>;

export interface JobQueryPlan {
  /** Excluded visibility is governed ONLY by the toggle, independent of tier filters. */
  hideExcluded: boolean;
  sponsorTiers: JobListInput['sponsorTiers'] | null;
  newHireStatuses: JobListInput['newHireStatuses'] | null;
  roleFamilies: JobListInput['roleFamilies'] | null;
  seniorities: JobListInput['seniorities'] | null;
  /** Hide senior ('other') roles by default; an explicit `seniorities` filter overrides. */
  hideSenior: boolean;
  employmentType: (typeof employmentTypeEnum.enumValues)[number] | null;
  remoteOnly: boolean;
  search: string | null;
  sort: JobListInput['sort'];
}

/** Pure translation of raw input into a query plan (unit-tested). */
export function resolveJobQueryPlan(input: JobListInput): JobQueryPlan {
  const seniorities = input.seniorities?.length ? input.seniorities : null;
  return {
    hideExcluded: !input.includeExcluded,
    sponsorTiers: input.sponsorTiers?.length ? input.sponsorTiers : null,
    newHireStatuses: input.newHireStatuses?.length ? input.newHireStatuses : null,
    roleFamilies: input.roleFamilies?.length ? input.roleFamilies : null,
    seniorities,
    // Default board scope is entry/mid; an explicit seniority selection wins.
    hideSenior: !input.includeSenior && seniorities === null,
    employmentType: input.employmentType === 'all' ? null : input.employmentType,
    remoteOnly: input.remoteOnly,
    search: input.search ? input.search : null,
    sort: input.sort,
  };
}

/** Escape LIKE metacharacters so a search term is treated literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Combined-sort weights (display-only blend; scores are never merged into a
 * stored value). One sponsor tier ≈ `TIER_WEIGHT` fit points, so tier stays
 * dominant. Freshness is a gentle nudge that decays linearly from `FRESHNESS_MAX`
 * (a brand-new post) to 0 over `FRESHNESS_WINDOW_DAYS`.
 */
export const TIER_WEIGHT = 100;
export const FRESHNESS_MAX = 20;
export const FRESHNESS_WINDOW_DAYS = 30;

/** Linear recency boost: `FRESHNESS_MAX` at 0 days → 0 at the window edge. */
export function freshnessBoost(ageDays: number): number {
  if (ageDays <= 0) return FRESHNESS_MAX;
  if (ageDays >= FRESHNESS_WINDOW_DAYS) return 0;
  return FRESHNESS_MAX * (1 - ageDays / FRESHNESS_WINDOW_DAYS);
}

/**
 * Pure combined-rank score the SQL below mirrors. Kept as a helper so the
 * intended formula is unit-tested; the DB expression must stay in sync.
 */
export function combinedRank(input: { tierRank: number; fit: number; ageDays: number }): number {
  return input.tierRank * TIER_WEIGHT + input.fit + freshnessBoost(input.ageDays);
}

const TIER_RANK = sql<number>`case ${jobs.sponsorTier}
  when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end`;
const FIT = sql`${jobScores.relevanceScore} desc nulls last`;
const POSTED = sql`${jobs.postedDate} desc nulls last`;
// Whole-day age from the posted calendar date (falling back to the ingest date),
// anchored to UTC so it never depends on the DB session timezone. `date - date`
// yields an integer, so AGE_DAYS matches the `ageDays` freshnessBoost() takes —
// which lets the SQL below mirror the pure helper EXACTLY for every value it can
// produce (integer days). Keep the two in sync.
const AGE_DAYS = sql`((now() at time zone 'UTC')::date - coalesce(${jobs.postedDate}, (${jobs.createdAt} at time zone 'UTC')::date))`;
// clamp(age, 0, window): mirrors freshnessBoost()'s <=0 -> MAX and >=window -> 0 clamps.
const CLAMPED_AGE = sql`least(greatest(${AGE_DAYS}, 0), ${FRESHNESS_WINDOW_DAYS})`;
// FRESHNESS = MAX * (1 - clampedAge/window) — the linear decay, as float.
const FRESHNESS = sql`(${FRESHNESS_MAX} * (1 - ${CLAMPED_AGE}::float / ${FRESHNESS_WINDOW_DAYS}))`;
// Display blend (mirrors combinedRank): tier-major, then fit, then a freshness nudge.
const COMBINED = sql`(${TIER_RANK} * ${TIER_WEIGHT} + coalesce(${jobScores.relevanceScore}, 0) + ${FRESHNESS}) desc`;

export const jobsRouter = createTRPCRouter({
  list: publicProcedure.input(jobListInput).query(async ({ ctx, input }) => {
    const plan = resolveJobQueryPlan(input);

    const where = [];
    if (plan.hideExcluded) where.push(sql`${jobs.sponsorTier} <> 'Excluded'`);
    if (plan.sponsorTiers) where.push(inArray(jobs.sponsorTier, plan.sponsorTiers));
    if (plan.newHireStatuses) where.push(inArray(jobs.newHireStatus, plan.newHireStatuses));
    if (plan.roleFamilies) where.push(inArray(jobs.roleFamily, plan.roleFamilies));
    if (plan.seniorities) where.push(inArray(jobs.seniority, plan.seniorities));
    // Hide senior roles by default; IS DISTINCT FROM keeps null/unclassified visible.
    else if (plan.hideSenior) where.push(sql`${jobs.seniority} is distinct from 'other'`);
    if (plan.employmentType) where.push(eq(jobs.employmentType, plan.employmentType));
    if (plan.remoteOnly) where.push(eq(jobs.isRemote, true));
    if (plan.search) {
      const esc = `%${escapeLike(plan.search)}%`;
      where.push(or(ilike(jobs.company, esc), ilike(jobs.title, esc)));
    }

    // Always end with a unique tiebreaker so limit/offset paging is stable.
    const tiebreak = desc(jobs.id);
    const orderBy =
      plan.sort === 'fit'
        ? [FIT, tiebreak]
        : plan.sort === 'recent'
          ? [POSTED, desc(jobs.createdAt), tiebreak]
          : plan.sort === 'sponsor'
            ? [desc(TIER_RANK), FIT, tiebreak]
            : [COMBINED, tiebreak]; // combined

    // Left-join the lens's score only; with no lens, join on false so score is null.
    const lensOn =
      input.resumeId != null
        ? and(eq(jobScores.jobId, jobs.id), eq(jobScores.resumeId, input.resumeId))
        : sql`false`;

    return ctx.db
      .select({
        id: jobs.id,
        company: jobs.company,
        title: jobs.title,
        location: jobs.location,
        isRemote: jobs.isRemote,
        url: jobs.url,
        source: jobs.source,
        postedDate: jobs.postedDate,
        roleFamily: jobs.roleFamily,
        seniority: jobs.seniority,
        employmentType: jobs.employmentType,
        techKeywords: jobs.techKeywords,
        softKeywords: jobs.softKeywords,
        sponsorTier: jobs.sponsorTier,
        sponsorReason: jobs.sponsorReason,
        sponsorCount: jobs.sponsorCount,
        newHireStatus: jobs.newHireStatus,
        sponsorMatchConfidence: jobs.sponsorMatchConfidence,
        relevanceScore: jobScores.relevanceScore,
        skillGaps: jobScores.skillGaps,
      })
      .from(jobs)
      .leftJoin(jobScores, lensOn)
      .where(where.length ? and(...where) : undefined)
      .orderBy(...orderBy)
      .limit(input.limit)
      .offset(input.offset);
  }),
});
