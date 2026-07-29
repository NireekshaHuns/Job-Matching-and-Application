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
  roleFamilyEnum,
  seniorityEnum,
  sponsorTierEnum,
} from '@/server/db/schema';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const jobListInput = z.object({
  /** Resume "lens": left-joins its fit score + skill gaps onto each job. */
  resumeId: z.number().int().optional(),
  sponsorTiers: z.array(z.enum(sponsorTierEnum.enumValues)).optional(),
  includeExcluded: z.boolean().default(false),
  roleFamilies: z.array(z.enum(roleFamilyEnum.enumValues)).optional(),
  seniorities: z.array(z.enum(seniorityEnum.enumValues)).optional(),
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
  roleFamilies: JobListInput['roleFamilies'] | null;
  seniorities: JobListInput['seniorities'] | null;
  employmentType: (typeof employmentTypeEnum.enumValues)[number] | null;
  remoteOnly: boolean;
  search: string | null;
  sort: JobListInput['sort'];
}

/** Pure translation of raw input into a query plan (unit-tested). */
export function resolveJobQueryPlan(input: JobListInput): JobQueryPlan {
  return {
    hideExcluded: !input.includeExcluded,
    sponsorTiers: input.sponsorTiers?.length ? input.sponsorTiers : null,
    roleFamilies: input.roleFamilies?.length ? input.roleFamilies : null,
    seniorities: input.seniorities?.length ? input.seniorities : null,
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

const TIER_RANK = sql<number>`case ${jobs.sponsorTier}
  when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end`;
const FIT = sql`${jobScores.relevanceScore} desc nulls last`;
const POSTED = sql`${jobs.postedDate} desc nulls last`;
// Display blend: one tier ≈ 100 fit points. Degrades to tier-major with no lens.
const COMBINED = sql`(${TIER_RANK} * 100 + coalesce(${jobScores.relevanceScore}, 0)) desc`;

export const jobsRouter = createTRPCRouter({
  list: publicProcedure.input(jobListInput).query(async ({ ctx, input }) => {
    const plan = resolveJobQueryPlan(input);

    const where = [];
    if (plan.hideExcluded) where.push(sql`${jobs.sponsorTier} <> 'Excluded'`);
    if (plan.sponsorTiers) where.push(inArray(jobs.sponsorTier, plan.sponsorTiers));
    if (plan.roleFamilies) where.push(inArray(jobs.roleFamily, plan.roleFamilies));
    if (plan.seniorities) where.push(inArray(jobs.seniority, plan.seniorities));
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
