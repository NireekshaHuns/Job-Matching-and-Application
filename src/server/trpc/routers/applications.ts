/**
 * Application tracker. Records real applications (manual or, later, Outlook-
 * verified) with the resume version used, so you know exactly what you sent to
 * each company for interview prep.
 *
 * Single-user personal app: procedures are intentionally public (no auth). If
 * this ever goes multi-user, the create/update/remove mutations gate first.
 * Duplicate applications per job are allowed by design (you may apply again with
 * a different resume); the board just shows the first as "Applied".
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { applicationStatusEnum, applications, jobs } from '@/server/db/schema';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const createApplicationInput = z.object({
  jobId: z.number().int(),
  resumeId: z.number().int().optional(),
  resumeLabel: z.string().max(200).optional(),
  resumeSnapshot: z.string().optional(),
  status: z.enum(applicationStatusEnum.enumValues).default('applied'),
});

export const updateApplicationInput = z.object({
  id: z.number().int(),
  status: z.enum(applicationStatusEnum.enumValues).optional(),
  // nullish: undefined = leave unchanged, null = clear.
  resumeLabel: z.string().max(200).nullish(),
  resumeSnapshot: z.string().nullish(),
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationInput>;

/** Pure: turn an update input into the set of columns to change (unit-tested). */
export function buildApplicationUpdate(
  input: UpdateApplicationInput,
): Partial<typeof applications.$inferInsert> {
  const set: Partial<typeof applications.$inferInsert> = {};
  if (input.status !== undefined) set.status = input.status;
  if (input.resumeLabel !== undefined) set.resumeLabel = input.resumeLabel;
  if (input.resumeSnapshot !== undefined) set.resumeSnapshot = input.resumeSnapshot;
  return set;
}

export const applicationsRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        status: applications.status,
        appliedAt: applications.appliedAt,
        source: applications.source,
        confirmedAt: applications.confirmedAt,
        resumeLabel: applications.resumeLabel,
        resumeSnapshot: applications.resumeSnapshot,
        company: jobs.company,
        title: jobs.title,
        url: jobs.url,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .orderBy(desc(applications.appliedAt));
  }),

  /** Job ids that already have an application — lets the board mark them applied. */
  appliedJobIds: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select({ jobId: applications.jobId }).from(applications);
    return rows.map((r) => r.jobId);
  }),

  create: publicProcedure.input(createApplicationInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .insert(applications)
      .values({
        jobId: input.jobId,
        resumeId: input.resumeId,
        resumeLabel: input.resumeLabel,
        resumeSnapshot: input.resumeSnapshot,
        status: input.status,
      })
      .returning({ id: applications.id });
    return row;
  }),

  update: publicProcedure.input(updateApplicationInput).mutation(async ({ ctx, input }) => {
    const set = buildApplicationUpdate(input);
    if (Object.keys(set).length > 0) {
      await ctx.db.update(applications).set(set).where(eq(applications.id, input.id));
    }
    return { id: input.id };
  }),

  remove: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(applications).where(eq(applications.id, input.id));
      return { id: input.id };
    }),
});
