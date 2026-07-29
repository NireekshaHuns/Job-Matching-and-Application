/**
 * Resume queries for the board. `listBase` powers the "lens" selector — the
 * base resumes a job's fit is scored against.
 */
import { asc, eq } from 'drizzle-orm';
import { resumes } from '@/server/db/schema';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const resumesRouter = createTRPCRouter({
  listBase: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: resumes.id, label: resumes.label, roleFamily: resumes.roleFamily })
      .from(resumes)
      .where(eq(resumes.kind, 'base'))
      .orderBy(asc(resumes.label));
  }),
});
