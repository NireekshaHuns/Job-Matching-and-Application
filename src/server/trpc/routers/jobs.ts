/**
 * Job board queries. `list` returns enriched jobs with BOTH scores kept
 * separate: the H1B `sponsorTier` (on the job) and the resume `relevanceScore`
 * (left-joined from job_scores for a selected resume "lens"). The `combined`
 * sort is a display-only Apply Priority Score — a configurable weighted blend of
 * tier + fit + freshness — computed at read time; the two scores are never
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
import { DEFAULT_PRIORITY_WEIGHTS, resolveWeights, type PriorityWeights } from '@/lib/priority';
import { createTRPCRouter, publicProcedure } from '../trpc';

export { DEFAULT_PRIORITY_WEIGHTS, resolveWeights, type PriorityWeights } from '@/lib/priority';

export const jobListInput = z.object({
  /** Resume "lens": left-joins its fit score + skill gaps onto each job. */
  resumeId: z.number().int().optional(),
  sponsorTiers: z.array(z.enum(sponsorTierEnum.enumValues)).optional(),
  /** New-hire badge filter (Sponsors new hires / Transfers only / …). */
  newHireStatuses: z.array(z.enum(newHireStatusEnum.enumValues)).optional(),
  includeExcluded: z.boolean().default(false),
  /** Off by default: closed/stale postings are hidden but retained. */
  includeClosed: z.boolean().default(false),
  roleFamilies: z.array(z.enum(roleFamilyEnum.enumValues)).optional(),
  seniorities: z.array(z.enum(seniorityEnum.enumValues)).optional(),
  /** Off by default: the board is scoped to entry/new-grad + mid roles. */
  includeSenior: z.boolean().default(false),
  employmentType: z.enum([...employmentTypeEnum.enumValues, 'all']).default('full_time'),
  remoteOnly: z.boolean().default(false),
  /** Off by default: the board is scoped to US jobs (on-site + remote); unknowns stay. */
  includeNonUs: z.boolean().default(false),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['combined', 'sponsor', 'fit', 'recent']).default('combined'),
  /** Apply-priority weights for the `combined` sort; absent/all-zero → defaults. */
  weights: z
    .object({
      tier: z.number().int().min(0).max(100),
      fit: z.number().int().min(0).max(100),
      freshness: z.number().int().min(0).max(100),
    })
    .partial()
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type JobListInput = z.infer<typeof jobListInput>;

export interface JobQueryPlan {
  /** Excluded visibility is governed ONLY by the toggle, independent of tier filters. */
  hideExcluded: boolean;
  /** Closed/stale postings are hidden unless the toggle is on. */
  hideClosed: boolean;
  sponsorTiers: JobListInput['sponsorTiers'] | null;
  newHireStatuses: JobListInput['newHireStatuses'] | null;
  roleFamilies: JobListInput['roleFamilies'] | null;
  seniorities: JobListInput['seniorities'] | null;
  /** Hide senior ('other') roles by default; an explicit `seniorities` filter overrides. */
  hideSenior: boolean;
  employmentType: (typeof employmentTypeEnum.enumValues)[number] | null;
  remoteOnly: boolean;
  /** Hide known non-US postings (is_us = false) unless the toggle is on; US + unknown stay. */
  hideNonUs: boolean;
  search: string | null;
  sort: JobListInput['sort'];
}

/** Pure translation of raw input into a query plan (unit-tested). */
export function resolveJobQueryPlan(input: JobListInput): JobQueryPlan {
  const seniorities = input.seniorities?.length ? input.seniorities : null;
  return {
    hideExcluded: !input.includeExcluded,
    hideClosed: !input.includeClosed,
    sponsorTiers: input.sponsorTiers?.length ? input.sponsorTiers : null,
    newHireStatuses: input.newHireStatuses?.length ? input.newHireStatuses : null,
    roleFamilies: input.roleFamilies?.length ? input.roleFamilies : null,
    seniorities,
    // Default board scope is entry/mid; an explicit seniority selection wins.
    hideSenior: !input.includeSenior && seniorities === null,
    employmentType: input.employmentType === 'all' ? null : input.employmentType,
    remoteOnly: input.remoteOnly,
    hideNonUs: !input.includeNonUs,
    search: input.search ? input.search : null,
    sort: input.sort,
  };
}

/** Escape LIKE metacharacters so a search term is treated literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Apply Priority Score (spec §5.4). A transparent, tunable blend of three
 * components, each NORMALIZED to 0–100, combined by configurable weights into a
 * 0–100 priority used only for the default sort + display — never stored (the
 * two-score invariant holds). Adding a factor later (wage-level, warmth) is a
 * new component + weight, no rewrite.
 *
 *   tier      — sponsorship possibility (High=100, Medium≈67, Low≈33, Excluded=0)
 *   fit       — resume relevance for the selected lens (0 when no lens/score)
 *   freshness — linear recency, 100 at 0 days old → 0 at the window edge
 */
export const FRESHNESS_WINDOW_DAYS = 30;

/** Sponsor tier → 0..100 component (mirrors the SQL CASE below). */
export function tierScore(tierRank: number): number {
  return (tierRank / 3) * 100;
}

/** Linear recency → 0..100: 100 at age ≤ 0, 0 at/after the window edge. */
export function freshnessScore(ageDays: number): number {
  if (ageDays <= 0) return 100;
  if (ageDays >= FRESHNESS_WINDOW_DAYS) return 0;
  return 100 * (1 - ageDays / FRESHNESS_WINDOW_DAYS);
}

export interface PriorityBreakdown {
  /** Component scores, each 0..100. */
  tier: number;
  fit: number;
  freshness: number;
  /** Weighted blend, 0..100. */
  priority: number;
}

/**
 * Pure priority the SQL below mirrors. `fit` is 0..100 (pass 0 when there's no
 * lens/score); `tierRank` is 0..3; `ageDays` is whole days since posting.
 */
export function computePriority(
  input: { tierRank: number; fit: number; ageDays: number },
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): PriorityBreakdown {
  const tier = tierScore(input.tierRank);
  const fit = input.fit;
  const freshness = freshnessScore(input.ageDays);
  const sum = weights.tier + weights.fit + weights.freshness;
  const priority =
    sum > 0 ? (weights.tier * tier + weights.fit * fit + weights.freshness * freshness) / sum : 0;
  return { tier, fit, freshness, priority };
}

const TIER_RANK = sql<number>`case ${jobs.sponsorTier}
  when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end`;
const FIT = sql`${jobScores.relevanceScore} desc nulls last`;
const POSTED = sql`${jobs.postedDate} desc nulls last`;
// Whole-day age from the posted calendar date (falling back to the ingest date),
// anchored to UTC so it never depends on the DB session timezone. `date - date`
// yields an integer, so AGE_DAYS matches the `ageDays` the pure helpers take —
// which lets the SQL below mirror them EXACTLY for every value (integer days).
const AGE_DAYS = sql`((now() at time zone 'UTC')::date - coalesce(${jobs.postedDate}, (${jobs.createdAt} at time zone 'UTC')::date))`;
const CLAMPED_AGE = sql`least(greatest(${AGE_DAYS}, 0), ${FRESHNESS_WINDOW_DAYS})`;

// The three 0..100 component expressions, mirroring the pure helpers above.
const TIER_SCORE = sql`(${TIER_RANK}::float / 3 * 100)`;
const FIT_SCORE = sql`coalesce(${jobScores.relevanceScore}, 0)`;
const FRESH_SCORE = sql`(100 * (1 - ${CLAMPED_AGE}::float / ${FRESHNESS_WINDOW_DAYS}))`;

/** Weighted priority SQL expression (weights interpolated as bound params). */
function prioritySql(w: PriorityWeights) {
  const sum = w.tier + w.fit + w.freshness;
  return sql`((${w.tier} * ${TIER_SCORE} + ${w.fit} * ${FIT_SCORE} + ${w.freshness} * ${FRESH_SCORE}) / ${sum})`;
}

export const jobsRouter = createTRPCRouter({
  list: publicProcedure.input(jobListInput).query(async ({ ctx, input }) => {
    const plan = resolveJobQueryPlan(input);

    const where = [];
    if (plan.hideExcluded) where.push(sql`${jobs.sponsorTier} <> 'Excluded'`);
    if (plan.hideClosed) where.push(eq(jobs.status, 'active'));
    if (plan.sponsorTiers) where.push(inArray(jobs.sponsorTier, plan.sponsorTiers));
    if (plan.newHireStatuses) where.push(inArray(jobs.newHireStatus, plan.newHireStatuses));
    if (plan.roleFamilies) where.push(inArray(jobs.roleFamily, plan.roleFamilies));
    if (plan.seniorities) where.push(inArray(jobs.seniority, plan.seniorities));
    // Hide senior roles by default; IS DISTINCT FROM keeps null/unclassified visible.
    else if (plan.hideSenior) where.push(sql`${jobs.seniority} is distinct from 'other'`);
    if (plan.employmentType) where.push(eq(jobs.employmentType, plan.employmentType));
    if (plan.remoteOnly) where.push(eq(jobs.isRemote, true));
    // US + unknown by default; only positively-identified non-US is hidden.
    if (plan.hideNonUs) where.push(sql`${jobs.isUs} is not false`);
    if (plan.search) {
      const esc = `%${escapeLike(plan.search)}%`;
      where.push(or(ilike(jobs.company, esc), ilike(jobs.title, esc)));
    }

    const weights = resolveWeights(input.weights);
    const priority = prioritySql(weights);

    // Always end with a unique tiebreaker so limit/offset paging is stable.
    const tiebreak = desc(jobs.id);
    const orderBy =
      plan.sort === 'fit'
        ? [FIT, tiebreak]
        : plan.sort === 'recent'
          ? [POSTED, desc(jobs.createdAt), tiebreak]
          : plan.sort === 'sponsor'
            ? [desc(TIER_RANK), FIT, tiebreak]
            : [sql`${priority} desc`, tiebreak]; // combined (apply priority)

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
        isUs: jobs.isUs,
        url: jobs.url,
        source: jobs.source,
        postedDate: jobs.postedDate,
        status: jobs.status,
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
        // Apply-priority score + its component breakdown (0..100 each), for the
        // "why this rank" display. ORDER BY uses the UNROUNDED priority above;
        // only the displayed value is rounded, so rows that show the same number
        // still order deterministically. Keep it that way.
        priorityScore: sql<number>`round(${priority})::int`,
        priorityTier: sql<number>`round(${TIER_SCORE})::int`,
        priorityFit: sql<number>`round(${FIT_SCORE})::int`,
        priorityFreshness: sql<number>`round(${FRESH_SCORE})::int`,
      })
      .from(jobs)
      .leftJoin(jobScores, lensOn)
      .where(where.length ? and(...where) : undefined)
      .orderBy(...orderBy)
      .limit(input.limit)
      .offset(input.offset);
  }),
});
