/**
 * Job board queries. `list` returns enriched jobs with BOTH scores kept
 * separate: the H1B `sponsorTier` (on the job) and the resume `relevanceScore`
 * (left-joined from job_scores for a selected resume "lens"). A combined tier ×
 * fit ordering is offered only as the default sort — the scores are never merged
 * into one stored value.
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

/** H1B tier as a sortable rank (High highest). */
const TIER_RANK = sql<number>`case ${jobs.sponsorTier}
  when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end`;
const FIT = sql`${jobScores.relevanceScore} desc nulls last`;

export const jobsRouter = createTRPCRouter({
  list: publicProcedure.input(jobListInput).query(async ({ ctx, input }) => {
    const where = [];
    if (!input.includeExcluded && !input.sponsorTiers?.length) {
      where.push(sql`${jobs.sponsorTier} <> 'Excluded'`);
    }
    if (input.sponsorTiers?.length) where.push(inArray(jobs.sponsorTier, input.sponsorTiers));
    if (input.roleFamilies?.length) where.push(inArray(jobs.roleFamily, input.roleFamilies));
    if (input.seniorities?.length) where.push(inArray(jobs.seniority, input.seniorities));
    if (input.employmentType !== 'all') {
      where.push(eq(jobs.employmentType, input.employmentType));
    }
    if (input.remoteOnly) where.push(eq(jobs.isRemote, true));
    if (input.search) {
      where.push(
        or(ilike(jobs.company, `%${input.search}%`), ilike(jobs.title, `%${input.search}%`)),
      );
    }

    const orderBy =
      input.sort === 'fit'
        ? [FIT, desc(jobs.postedDate)]
        : input.sort === 'recent'
          ? [desc(jobs.postedDate), desc(jobs.createdAt)]
          : input.sort === 'sponsor'
            ? [desc(TIER_RANK), FIT]
            : [desc(TIER_RANK), FIT, desc(jobs.postedDate)]; // combined

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
