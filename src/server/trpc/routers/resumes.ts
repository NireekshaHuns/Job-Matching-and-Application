/**
 * Résumé queries for the board. `listBase` powers the "lens" selector — the
 * base résumés a job's fit is scored against. `tailoringSuggestions` surfaces
 * the CLI tailoring assist read-only in the app (spec §5.7): keyword-gap + the
 * user's real bullets to weave in (never fabricated).
 */
import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { jobs, masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import { buildTailoringSuggestions } from '@/server/resume/suggestions';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const resumesRouter = createTRPCRouter({
  listBase: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: resumes.id, label: resumes.label, roleFamily: resumes.roleFamily })
      .from(resumes)
      .where(eq(resumes.kind, 'base'))
      .orderBy(asc(resumes.label));
  }),

  /** Truthful tailoring suggestions for a job against a selected base résumé. */
  tailoringSuggestions: publicProcedure
    .input(z.object({ jobId: z.number().int(), resumeId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select({ techKeywords: jobs.techKeywords, softKeywords: jobs.softKeywords })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1);
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found.' });

      const [resume] = await ctx.db
        .select({ roleFamily: resumes.roleFamily })
        .from(resumes)
        .where(eq(resumes.id, input.resumeId))
        .limit(1);
      if (!resume) throw new TRPCError({ code: 'NOT_FOUND', message: 'Résumé not found.' });

      const [skills, bullets] = await Promise.all([
        ctx.db.select({ skill: masterSkills.skill }).from(masterSkills),
        ctx.db
          .select({
            id: resumeBullets.id,
            text: resumeBullets.text,
            company: resumeBullets.company,
            skills: resumeBullets.skills,
            roleFamily: resumeBullets.roleFamily,
          })
          .from(resumeBullets),
      ]);

      return buildTailoringSuggestions({
        jobKeywords: [...job.techKeywords, ...job.softKeywords],
        resumeRoleFamily: resume.roleFamily,
        masterSkills: skills.map((s) => s.skill),
        bullets,
      });
    }),
});
