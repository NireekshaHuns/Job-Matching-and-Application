/**
 * Read-only dashboard aggregates. One `summary` query fans out a handful of
 * grouped counts (run in parallel) so the overview page renders in a single
 * round trip. Distribution counts are keyed on enums; since a SQL `GROUP BY`
 * omits groups with zero rows, `fillCounts` re-expands each result over the full
 * enum order (zeros filled) so the UI can render a stable, complete breakdown.
 */
import { desc, sql } from 'drizzle-orm';
import {
  applicationStatusEnum,
  applications,
  employmentTypeEnum,
  jobs,
  roleFamilyEnum,
  sponsorTierEnum,
} from '@/server/db/schema';
import { createTRPCRouter, publicProcedure } from '../trpc';

export interface CountRow<T extends string> {
  key: T;
  count: number;
}

/**
 * Re-expand grouped counts over a fixed key order, filling missing keys with 0.
 * Pure and unit-tested. Extra keys in `rows` not present in `order` are dropped.
 */
export function fillCounts<T extends string>(
  order: readonly T[],
  rows: { key: T; count: number }[],
): CountRow<T>[] {
  const found = new Map(rows.map((r) => [r.key, r.count]));
  return order.map((key) => ({ key, count: found.get(key) ?? 0 }));
}

const int = (expr: ReturnType<typeof sql>) => sql<number>`${expr}::int`;

export const dashboardRouter = createTRPCRouter({
  summary: publicProcedure.query(async ({ ctx }) => {
    const [
      [totalsRow],
      tierRows,
      roleRows,
      employmentRows,
      statusRows,
      [appTotalsRow],
      topSponsors,
      [recentRow],
    ] = await Promise.all([
      ctx.db
        .select({
          jobs: int(sql`count(*)`),
          remote: int(sql`count(*) filter (where ${jobs.isRemote})`),
        })
        .from(jobs),
      ctx.db
        .select({ key: jobs.sponsorTier, count: int(sql`count(*)`) })
        .from(jobs)
        .groupBy(jobs.sponsorTier),
      ctx.db
        .select({
          // roleFamily is nullable; unclassified jobs fold into 'other'.
          key: sql<
            (typeof roleFamilyEnum.enumValues)[number]
          >`coalesce(${jobs.roleFamily}, 'other')`,
          count: int(sql`count(*)`),
        })
        .from(jobs)
        .groupBy(sql`coalesce(${jobs.roleFamily}, 'other')`),
      ctx.db
        .select({ key: jobs.employmentType, count: int(sql`count(*)`) })
        .from(jobs)
        .groupBy(jobs.employmentType),
      ctx.db
        .select({ key: applications.status, count: int(sql`count(*)`) })
        .from(applications)
        .groupBy(applications.status),
      ctx.db
        .select({
          total: int(sql`count(*)`),
          confirmed: int(sql`count(*) filter (where ${applications.confirmedAt} is not null)`),
        })
        .from(applications),
      ctx.db
        .select({
          company: jobs.company,
          jobs: int(sql`count(*)`),
          sponsorCount: int(sql`max(${jobs.sponsorCount})`),
        })
        .from(jobs)
        .groupBy(jobs.company)
        .orderBy(desc(sql`max(${jobs.sponsorCount})`), desc(sql`count(*)`))
        .limit(8),
      ctx.db
        .select({
          last7: int(sql`count(*) filter (where ${jobs.createdAt} >= now() - interval '7 days')`),
          last30: int(sql`count(*) filter (where ${jobs.createdAt} >= now() - interval '30 days')`),
        })
        .from(jobs),
    ]);

    return {
      totals: {
        jobs: totalsRow?.jobs ?? 0,
        remote: totalsRow?.remote ?? 0,
        applications: appTotalsRow?.total ?? 0,
        confirmed: appTotalsRow?.confirmed ?? 0,
      },
      byTier: fillCounts(sponsorTierEnum.enumValues, tierRows),
      byRoleFamily: fillCounts(roleFamilyEnum.enumValues, roleRows),
      byEmploymentType: fillCounts(employmentTypeEnum.enumValues, employmentRows),
      applicationsByStatus: fillCounts(applicationStatusEnum.enumValues, statusRows),
      topSponsors,
      recentJobs: { last7: recentRow?.last7 ?? 0, last30: recentRow?.last30 ?? 0 },
    };
  }),
});
