/**
 * Résumé queries for the board. `listBase` powers the "lens" selector — the
 * base résumés a job's fit is scored against. `tailoringSuggestions` surfaces
 * the CLI tailoring assist read-only in the app (spec §5.7): keyword-gap + the
 * user's real bullets to weave in (never fabricated).
 */
import { TRPCError } from '@trpc/server';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  jobs,
  masterSkills,
  resumeBullets,
  resumeProfile,
  resumes,
  roleFamilyEnum,
  skillKindEnum,
} from '@/server/db/schema';
import type { ChatClient, Embedder } from '@/server/enrich/types';
import { ingestResume, type IngestDeps } from '@/server/resume/corpus-ingest';
import { extractJdKeywords } from '@/server/resume/jd-keywords';
import { withProfileDefaults } from '@/server/resume/profile';
import { rankCorpusBullets, type CorpusBullet } from '@/server/resume/retrieve';
import { buildTailoringSuggestions } from '@/server/resume/suggestions';
import {
  selectTailoringInputs,
  tailorFromCorpus,
  tailorResume,
  type CorpusSourceBullet,
  type TailorBullet,
  type TailorJob,
} from '@/server/resume/tailor';
import { buildDefaultTemplate } from '@/server/resume/template';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** Default models: quality tailoring on gpt-4.1, cheap structured work on mini. */
const TAILOR_MODEL = () => process.env.OPENAI_TAILOR_MODEL ?? 'gpt-4.1';
const CLASSIFY_MODEL = () => process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini';
const EMBED_MODEL = () => process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

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

const skillTag = z.string().trim().min(1).max(100);

export const addBulletInput = z.object({
  text: z.string().trim().min(1).max(500),
  skills: z.array(skillTag).default([]),
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  company: z.string().trim().max(200).nullish(),
});
export const updateBulletInput = z.object({
  id: z.number().int(),
  text: z.string().trim().min(1).max(500).optional(),
  skills: z.array(skillTag).optional(),
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

// ---- Corpus Studio (upload-driven tailoring) ----

export const extractJdKeywordsInput = z.object({ jdText: z.string().trim().min(1).max(20_000) });

export const tailorFromCorpusInput = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).default(''),
  selectedKeywords: z.array(z.string().trim().min(1)).default([]),
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
});

export const saveTailoredInput = z.object({
  label: z.string().trim().min(1).max(200),
  latex: z.string().min(1),
});

export const addSkillsInput = z.object({
  skills: z.array(z.string().trim().min(1).max(100)).min(1),
  kind: z.enum(skillKindEnum.enumValues),
});

const nullableText = (max: number) => z.string().trim().max(max).nullish();
export const setResumeProfileInput = z.object({
  name: nullableText(120),
  email: nullableText(200),
  phone: nullableText(60),
  linkedinUrl: nullableText(300),
  githubUrl: nullableText(300),
  gradDate: nullableText(60),
  certText: nullableText(200),
  certUrl: nullableText(300),
  knownMetrics: nullableText(4000),
  stackNotes: nullableText(4000),
});
type SetResumeProfileInput = z.infer<typeof setResumeProfileInput>;

/** Normalize the profile input so every field is written (undefined → null). */
function normalizeProfile(input: SetResumeProfileInput) {
  return {
    name: input.name ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    githubUrl: input.githubUrl ?? null,
    gradDate: input.gradDate ?? null,
    certText: input.certText ?? null,
    certUrl: input.certUrl ?? null,
    knownMetrics: input.knownMetrics ?? null,
    stackNotes: input.stackNotes ?? null,
  };
}

/** Build a real OpenAI chat client, or null when no key is set. */
async function llmChat(opts: { jsonMode: boolean; model: string }): Promise<ChatClient | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const { default: OpenAI } = await import('openai');
  const { openaiChat } = await import('@/server/enrich/openai');
  return openaiChat(new OpenAI({ apiKey: key }), opts.model, { jsonMode: opts.jsonMode });
}

/** Build a real OpenAI embedder, or null when no key is set. */
async function llmEmbedder(): Promise<Embedder | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const { default: OpenAI } = await import('openai');
  const { openaiEmbedder } = await import('@/server/enrich/openai');
  return openaiEmbedder(new OpenAI({ apiKey: key }), EMBED_MODEL());
}

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
        const chat = openaiChat(new OpenAI({ apiKey: key }), TAILOR_MODEL(), { jsonMode: false });
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
    // Lowercase before insert so the app-enforced uniqueness on master_skills.skill
    // (a raw-column unique constraint) can't get case-variant duplicates, and so it
    // matches the lowercase fit-scoring join key (see resume/fit.ts).
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

  // ---- Corpus Studio ----

  /** The candidate profile (stored row merged over the seed defaults). */
  getProfile: publicProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(resumeProfile)
      .orderBy(asc(resumeProfile.id))
      .limit(1);
    return withProfileDefaults(row ?? null);
  }),

  /** Upsert the single profile row (fixed id so concurrent saves can't dup). */
  setProfile: publicProcedure.input(setResumeProfileInput).mutation(async ({ ctx, input }) => {
    const vals = normalizeProfile(input);
    await ctx.db
      .insert(resumeProfile)
      .values({ id: 1, ...vals })
      .onConflictDoUpdate({ target: resumeProfile.id, set: { ...vals, updatedAt: new Date() } });
    return withProfileDefaults(vals);
  }),

  /** Uploaded + tailored résumés in the corpus, plus corpus size counts. */
  listCorpus: publicProcedure.query(async ({ ctx }) => {
    const [list, bullets, skills] = await Promise.all([
      ctx.db
        .select({
          id: resumes.id,
          label: resumes.label,
          kind: resumes.kind,
          roleFamily: resumes.roleFamily,
          createdAt: resumes.createdAt,
        })
        .from(resumes)
        .where(inArray(resumes.kind, ['uploaded', 'tailored']))
        .orderBy(desc(resumes.createdAt)),
      ctx.db.select({ id: resumeBullets.id }).from(resumeBullets),
      ctx.db.select({ skill: masterSkills.skill }).from(masterSkills),
    ]);
    return { resumes: list, bulletCount: bullets.length, skillCount: skills.length };
  }),

  /** Delete a corpus résumé; its bullets cascade away via the FK. */
  removeResume: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(resumes).where(eq(resumes.id, input.id));
    return { id: input.id };
  }),

  /** Bulk-add skills to the superset (e.g. pasted from a skills list). */
  addSkills: publicProcedure.input(addSkillsInput).mutation(async ({ ctx, input }) => {
    const skills = normalizeSkillList(input.skills);
    if (skills.length === 0) return { added: 0 };
    await ctx.db
      .insert(masterSkills)
      .values(skills.map((skill) => ({ skill, kind: input.kind })))
      .onConflictDoNothing();
    return { added: skills.length };
  }),

  /**
   * Extract the tech + soft keywords from a pasted JD and flag which are already
   * covered by the corpus (so the Studio can pre-check them in the tick UI).
   * Requires an OpenAI key.
   */
  extractJdKeywords: publicProcedure
    .input(extractJdKeywordsInput)
    .mutation(async ({ ctx, input }) => {
      const chat = await llmChat({ jsonMode: true, model: CLASSIFY_MODEL() });
      if (!chat) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Set OPENAI_API_KEY to extract JD keywords.',
        });
      }
      const kws = await extractJdKeywords(input.jdText, chat);
      const skills = await ctx.db.select({ skill: masterSkills.skill }).from(masterSkills);
      const corpus = new Set(skills.map((s) => s.skill));
      const flag = (list: string[]) => list.map((k) => ({ keyword: k, inCorpus: corpus.has(k) }));
      return { tech: flag(kws.tech), soft: flag(kws.soft) };
    }),

  /**
   * Generate a résumé from the corpus for a pasted JD + the user-selected
   * keywords: retrieve the most relevant real bullets (semantic + keyword),
   * then synthesize an aggressive-but-coherent one-page LaTeX résumé. Uses the
   * base résumé as the format when one exists, else a default template. Without
   * an OpenAI key it returns just the template (`source: 'base'`).
   */
  tailorFromCorpus: publicProcedure
    .input(tailorFromCorpusInput)
    .mutation(async ({ ctx, input }) => {
      const selected = normalizeSkillList(input.selectedKeywords);
      const roleFamily = input.roleFamily ?? null;

      const [[profileRow], [base], bulletRows] = await Promise.all([
        ctx.db.select().from(resumeProfile).orderBy(asc(resumeProfile.id)).limit(1),
        ctx.db
          .select({ content: resumes.content })
          .from(resumes)
          .where(eq(resumes.kind, 'base'))
          .orderBy(asc(resumes.id))
          .limit(1),
        ctx.db
          .select({
            id: resumeBullets.id,
            text: resumeBullets.text,
            skills: resumeBullets.skills,
            roleFamily: resumeBullets.roleFamily,
            company: resumeBullets.company,
            embedding: resumeBullets.embedding,
          })
          .from(resumeBullets),
      ]);

      const profile = withProfileDefaults(profileRow ?? null);
      const baseTemplate = base?.content?.trim() ? base.content : buildDefaultTemplate(profile);
      const corpusBullets: CorpusBullet[] = bulletRows.map((r) => ({
        ...r,
        embedding: r.embedding ?? null,
      }));

      // Embed the selected keywords as the retrieval query (best-effort).
      let jdEmbedding: number[] | null = null;
      if (selected.length > 0) {
        const embedder = await llmEmbedder();
        if (embedder) {
          try {
            jdEmbedding = await embedder.embed(selected.join(', '));
          } catch {
            jdEmbedding = null;
          }
        }
      }

      const ranked = rankCorpusBullets({
        bullets: corpusBullets,
        jdEmbedding,
        selectedKeywords: selected,
        roleFamily,
      });
      const sourceBullets: CorpusSourceBullet[] = ranked.map((r) => ({
        text: r.text,
        company: r.company,
      }));

      const chat = await llmChat({ jsonMode: false, model: TAILOR_MODEL() });
      if (chat) {
        try {
          const result = await tailorFromCorpus(
            baseTemplate,
            { title: input.jobTitle, company: input.company },
            { selectedKeywords: selected, bullets: sourceBullets, profile },
            chat,
            { maxAttempts: input.maxAttempts },
          );
          return {
            source: 'llm' as const,
            latex: result.latex,
            report: result.report,
            usedBullets: ranked.length,
          };
        } catch (err) {
          console.warn('resumes.tailorFromCorpus: LLM generation failed, returning template', err);
        }
      }
      return { source: 'base' as const, latex: baseTemplate, report: null, usedBullets: ranked.length };
    }),

  /**
   * Persist a tailored résumé back into the corpus (kind='tailored') and
   * re-extract its bullets so future generations learn from it. Uses the LLM to
   * extract + embed when a key is set; stores text only otherwise.
   */
  saveTailored: publicProcedure.input(saveTailoredInput).mutation(async ({ ctx, input }) => {
    const chat = await llmChat({ jsonMode: true, model: CLASSIFY_MODEL() });
    const embedder = await llmEmbedder();
    const deps: IngestDeps = {
      db: ctx.db,
      chat: chat ?? undefined,
      embedder: embedder ?? undefined,
    };
    const result = await ingestResume(
      { label: input.label, text: input.latex, kind: 'tailored' },
      deps,
    );
    return result;
  }),
});
