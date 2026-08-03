/**
 * Résumé queries for the board. `listBase` powers the "lens" selector — the
 * base résumés a job's fit is scored against. `tailoringSuggestions` surfaces
 * the CLI tailoring assist read-only in the app (spec §5.7): keyword-gap + the
 * user's real bullets to weave in (never fabricated).
 */
import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  jobs,
  masterSkills,
  resumeBullets,
  resumes,
  roleFamilyEnum,
  skillKindEnum,
} from '@/server/db/schema';
import { buildTailoringSuggestions } from '@/server/resume/suggestions';
import {
  selectTailoringInputs,
  tailorResume,
  type TailorBullet,
  type TailorJob,
} from '@/server/resume/tailor';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** Generate a tailored résumé for a (job × base résumé). */
export const tailorInput = z.object({
  jobId: z.number().int(),
  resumeId: z.number().int(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
});

// ---- Settings / inventory management (master skills, bullet bank, base résumés) ----

export const addSkillInput = z.object({
  skill: z.string().trim().min(1).max(100),
  kind: z.enum(skillKindEnum.enumValues),
});
export const removeSkillInput = z.object({ skill: z.string().trim().min(1) });

export const addBulletInput = z.object({
  text: z.string().trim().min(1).max(500),
  skills: z.array(z.string()).default([]),
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  company: z.string().trim().max(200).nullish(),
});
export const updateBulletInput = z.object({
  id: z.number().int(),
  text: z.string().trim().min(1).max(500).optional(),
  skills: z.array(z.string()).optional(),
  // nullish: undefined = leave unchanged, null = clear.
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  company: z.string().trim().max(200).nullish(),
});
export type UpdateBulletInput = z.infer<typeof updateBulletInput>;

export const upsertBaseResumeInput = z.object({
  id: z.number().int().optional(),
  label: z.string().trim().min(1).max(200),
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  content: z.string().min(1),
});

const idInput = z.object({ id: z.number().int() });

/** Lowercase, trim, drop empties, dedupe — matches the fit-scoring join key. */
export function normalizeSkillList(skills: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of skills) {
    const n = s.trim().toLowerCase();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Pure: columns to change for a bullet update (undefined = leave, null = clear). */
export function buildBulletUpdate(
  input: UpdateBulletInput,
): Partial<typeof resumeBullets.$inferInsert> {
  const set: Partial<typeof resumeBullets.$inferInsert> = {};
  if (input.text !== undefined) set.text = input.text;
  if (input.skills !== undefined) set.skills = normalizeSkillList(input.skills);
  if (input.roleFamily !== undefined) set.roleFamily = input.roleFamily;
  if (input.company !== undefined) set.company = input.company;
  return set;
}

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
      const [[job], [resume]] = await Promise.all([
        ctx.db
          .select({ techKeywords: jobs.techKeywords, softKeywords: jobs.softKeywords })
          .from(jobs)
          .where(eq(jobs.id, input.jobId))
          .limit(1),
        ctx.db
          .select({ roleFamily: resumes.roleFamily })
          .from(resumes)
          .where(eq(resumes.id, input.resumeId))
          .limit(1),
      ]);
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found.' });
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

  /**
   * Generate a tailored résumé for a job against a base résumé. Uses the LLM
   * when OPENAI_API_KEY is set (openai imported lazily so the app boots without
   * it); on a missing key or any failure it returns the base résumé unchanged
   * (`source: 'base'`) plus the tailoring inputs, so the UI can still guide
   * manual tailoring. Generation only — nothing is persisted here.
   */
  tailor: publicProcedure.input(tailorInput).mutation(async ({ ctx, input }) => {
    const [[job], [resume]] = await Promise.all([
      ctx.db
        .select({
          title: jobs.title,
          company: jobs.company,
          techKeywords: jobs.techKeywords,
          softKeywords: jobs.softKeywords,
        })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1),
      ctx.db
        .select({ content: resumes.content, roleFamily: resumes.roleFamily })
        .from(resumes)
        .where(eq(resumes.id, input.resumeId))
        .limit(1),
    ]);
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found.' });
    if (!resume) throw new TRPCError({ code: 'NOT_FOUND', message: 'Résumé not found.' });
    if (!resume.content) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Base résumé has no content to tailor.',
      });
    }
    const baseLatex = resume.content;

    const [skills, bullets] = await Promise.all([
      ctx.db.select({ skill: masterSkills.skill }).from(masterSkills),
      ctx.db
        .select({
          text: resumeBullets.text,
          skills: resumeBullets.skills,
          roleFamily: resumeBullets.roleFamily,
        })
        .from(resumeBullets),
    ]);

    const masterSkillList = skills.map((s) => s.skill);
    const tailorJob: TailorJob = {
      title: job.title,
      company: job.company,
      techKeywords: job.techKeywords,
      softKeywords: job.softKeywords,
    };
    const tailorBullets: TailorBullet[] = bullets.map((b) => ({
      text: b.text,
      skills: b.skills,
      roleFamily: b.roleFamily,
    }));

    const inputs = selectTailoringInputs(
      tailorJob,
      masterSkillList,
      tailorBullets,
      resume.roleFamily,
    );

    // Two-score-safe fit snapshot: as-is coverage vs. what truthful tailoring can
    // reach. Reuse the fit selectTailoringInputs already computed (single source).
    const fit = {
      before: inputs.fit.relevanceScore,
      achievable: inputs.fit.achievableScore,
      matched: inputs.fit.matched,
      missingAddable: inputs.fit.missingAddable,
      missingGap: inputs.fit.missingGap,
    };

    const key = process.env.OPENAI_API_KEY;
    if (key) {
      try {
        const { default: OpenAI } = await import('openai');
        const { openaiChat } = await import('@/server/enrich/openai');
        // Text mode: tailoring returns a raw LaTeX document, not JSON.
        const chat = openaiChat(
          new OpenAI({ apiKey: key }),
          process.env.OPENAI_TAILOR_MODEL ?? process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini',
          { jsonMode: false },
        );
        const result = await tailorResume(baseLatex, tailorJob, inputs, chat, {
          maxAttempts: input.maxAttempts,
        });
        return {
          source: 'llm' as const,
          latex: result.latex,
          report: result.report,
          fit,
          coverableKeywords: inputs.coverableKeywords,
          trueGaps: inputs.trueGaps,
        };
      } catch (err) {
        // Fall through to the base résumé on any LLM/parse failure, but log it so
        // a persistently broken LLM path is visible rather than silently no-op'd.
        console.warn(
          `resumes.tailor: LLM tailoring failed for job ${input.jobId} / résumé ${input.resumeId}, returning base résumé`,
          err,
        );
      }
    }

    return {
      source: 'base' as const,
      latex: baseLatex,
      report: null,
      fit,
      coverableKeywords: inputs.coverableKeywords,
      trueGaps: inputs.trueGaps,
    };
  }),

  /** Full résumé inventory for the settings page. */
  inventory: publicProcedure.query(async ({ ctx }) => {
    const [skills, bullets, baseResumes] = await Promise.all([
      ctx.db
        .select({ skill: masterSkills.skill, kind: masterSkills.kind })
        .from(masterSkills)
        .orderBy(asc(masterSkills.skill)),
      ctx.db
        .select({
          id: resumeBullets.id,
          text: resumeBullets.text,
          skills: resumeBullets.skills,
          roleFamily: resumeBullets.roleFamily,
          company: resumeBullets.company,
        })
        .from(resumeBullets)
        .orderBy(asc(resumeBullets.id)),
      ctx.db
        .select({
          id: resumes.id,
          label: resumes.label,
          roleFamily: resumes.roleFamily,
          content: resumes.content,
        })
        .from(resumes)
        .where(eq(resumes.kind, 'base'))
        .orderBy(asc(resumes.label)),
    ]);
    return { skills, bullets, baseResumes };
  }),

  addSkill: publicProcedure.input(addSkillInput).mutation(async ({ ctx, input }) => {
    const skill = input.skill.trim().toLowerCase();
    await ctx.db.insert(masterSkills).values({ skill, kind: input.kind }).onConflictDoNothing();
    return { skill };
  }),

  removeSkill: publicProcedure.input(removeSkillInput).mutation(async ({ ctx, input }) => {
    const skill = input.skill.trim().toLowerCase();
    await ctx.db.delete(masterSkills).where(eq(masterSkills.skill, skill));
    return { skill };
  }),

  addBullet: publicProcedure.input(addBulletInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .insert(resumeBullets)
      .values({
        text: input.text,
        skills: normalizeSkillList(input.skills),
        roleFamily: input.roleFamily ?? null,
        company: input.company ?? null,
      })
      .returning({ id: resumeBullets.id });
    return row;
  }),

  updateBullet: publicProcedure.input(updateBulletInput).mutation(async ({ ctx, input }) => {
    const set = buildBulletUpdate(input);
    if (Object.keys(set).length > 0) {
      await ctx.db.update(resumeBullets).set(set).where(eq(resumeBullets.id, input.id));
    }
    return { id: input.id };
  }),

  removeBullet: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(resumeBullets).where(eq(resumeBullets.id, input.id));
    return { id: input.id };
  }),

  upsertBaseResume: publicProcedure
    .input(upsertBaseResumeInput)
    .mutation(async ({ ctx, input }) => {
      if (input.id !== undefined) {
        await ctx.db
          .update(resumes)
          .set({ label: input.label, roleFamily: input.roleFamily ?? null, content: input.content })
          .where(eq(resumes.id, input.id));
        return { id: input.id };
      }
      const [row] = await ctx.db
        .insert(resumes)
        .values({
          label: input.label,
          kind: 'base',
          roleFamily: input.roleFamily ?? null,
          content: input.content,
        })
        .returning({ id: resumes.id });
      return row;
    }),

  removeBaseResume: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(resumes).where(eq(resumes.id, input.id));
    return { id: input.id };
  }),
});
