/**
 * Résumé queries for the Studio: the bullet corpus, JD keyword extraction, and
 * corpus-based tailoring.
 */
import { TRPCError } from '@trpc/server';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  masterSkills,
  resumeBullets,
  resumeProfile,
  resumes,
  roleFamilyEnum,
  skillKindEnum,
} from '@/server/db/schema';
import { resolveLlmEndpoint } from '@/server/enrich/endpoint';
import type { ChatClient, Embedder } from '@/server/enrich/types';
import { ingestResume, type IngestDeps } from '@/server/resume/corpus-ingest';
import { extractJdKeywords } from '@/server/resume/jd-keywords';
import { countByGrade, gradeKeywords, type EvidenceBullet } from '@/server/resume/keyword-evidence';
import { withProfileDefaults } from '@/server/resume/profile';
import { stripLatex } from '@/server/resume/quality';
import { rankCorpusBullets, type CorpusBullet } from '@/server/resume/retrieve';
import { tailorFromCorpus, type CorpusSourceBullet } from '@/server/resume/tailor';
import { buildDefaultTemplate } from '@/server/resume/render';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** Default models: quality tailoring on gpt-4.1, cheap structured work on mini. */
const TAILOR_MODEL = () => process.env.OPENAI_TAILOR_MODEL ?? 'gpt-4.1';
const CLASSIFY_MODEL = () => process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini';
const EMBED_MODEL = () => process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

// ---- Settings / inventory management (master skills, base résumé format) ----

export const addSkillInput = z.object({
  skill: z.string().trim().min(1).max(100),
  kind: z.enum(skillKindEnum.enumValues),
});
export const removeSkillInput = z.object({ skill: z.string().trim().min(1) });

export const upsertBaseResumeInput = z.object({
  id: z.number().int().optional(),
  label: z.string().trim().min(1).max(200),
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
  content: z.string().min(1),
});

const idInput = z.object({ id: z.number().int() });

// ---- Corpus Studio (upload-driven tailoring) ----

export const extractJdKeywordsInput = z.object({
  jdText: z.string().trim().min(1).max(20_000),
  /** Feeds the prompt and the title boost in `keywordImportance`. */
  jobTitle: z.string().trim().max(200).default(''),
  /**
   * Evidence lens. Grading must use the same role filter retrieval will, or the
   * picker shows strong evidence sitting in a bullet generation never sees.
   */
  roleFamily: z.enum(roleFamilyEnum.enumValues).nullish(),
});

export const tailorFromCorpusInput = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).default(''),
  selectedKeywords: z.array(z.string().trim().min(1)).default([]),
  /** Ticked without corpus evidence — gestured at, never claimed. */
  adjacentKeywords: z.array(z.string().trim().min(1)).default([]),
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
  coursework: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  projectName: nullableText(160),
  projectUrl: nullableText(300),
});
type SetResumeProfileInput = z.infer<typeof setResumeProfileInput>;

/** Trim, drop blanks, dedupe case-insensitively — but keep the owner's order. */
export function normalizeCourseList(courses: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of courses) {
    const course = c.trim().replace(/\s+/g, ' ');
    const key = course.toLowerCase();
    if (!course || seen.has(key)) continue;
    seen.add(key);
    out.push(course);
  }
  return out;
}

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
    coursework: normalizeCourseList(input.coursework ?? []),
    projectName: input.projectName ?? null,
    projectUrl: input.projectUrl ?? null,
  };
}

/** Build a real OpenAI chat client (default OpenAI endpoint), or null without a key. */
async function llmChat(opts: { jsonMode: boolean; model: string }): Promise<ChatClient | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const { default: OpenAI } = await import('openai');
  const { openaiChat } = await import('@/server/enrich/openai');
  return openaiChat(new OpenAI({ apiKey: key }), opts.model, { jsonMode: opts.jsonMode });
}

/**
 * Decide which endpoint the tailoring calls use. Only routes to the alternate
 * (OpenAI-compatible) endpoint when BOTH `baseUrl` and `tailorKey` are set — so
 * the OpenAI key is never sent to a third-party base URL by accident. Falls back
 * to plain OpenAI with `openaiKey`, or null when nothing usable is configured.
 * Pure so the routing invariant is unit-tested.
 */
export function resolveTailorEndpoint(env: {
  baseUrl?: string;
  tailorKey?: string;
  openaiKey?: string;
}): { apiKey: string; baseURL?: string } | null {
  // The rule is shared with the classification path — see enrich/endpoint.ts.
  return resolveLlmEndpoint({
    baseUrl: env.baseUrl,
    altKey: env.tailorKey,
    openaiKey: env.openaiKey,
  });
}

/**
 * Chat client for the (expensive) tailoring calls. Routes to an OpenAI-compatible
 * endpoint when `OPENAI_TAILOR_BASE_URL` + `OPENAI_TAILOR_API_KEY` are set — e.g.
 * OpenRouter for a cheap GLM model (set `OPENAI_TAILOR_MODEL=z-ai/glm-4.6`) — and
 * otherwise falls back to plain OpenAI. Tailoring returns raw LaTeX, json off.
 */
async function tailorChat(): Promise<ChatClient | null> {
  const endpoint = resolveTailorEndpoint({
    baseUrl: process.env.OPENAI_TAILOR_BASE_URL,
    tailorKey: process.env.OPENAI_TAILOR_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
  });
  if (!endpoint) return null;
  const { default: OpenAI } = await import('openai');
  const { openaiChat } = await import('@/server/enrich/openai');
  const client = new OpenAI(
    endpoint.baseURL
      ? { apiKey: endpoint.apiKey, baseURL: endpoint.baseURL }
      : { apiKey: endpoint.apiKey },
  );
  return openaiChat(client, TAILOR_MODEL(), { jsonMode: false });
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

export const resumesRouter = createTRPCRouter({
  /** Skills + base résumé format for the settings page. */
  inventory: publicProcedure.query(async ({ ctx }) => {
    const [skills, baseResumes] = await Promise.all([
      ctx.db
        .select({ skill: masterSkills.skill, kind: masterSkills.kind })
        .from(masterSkills)
        .orderBy(asc(masterSkills.skill)),
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
    return { skills, baseResumes };
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
    const [row] = await ctx.db.select().from(resumeProfile).orderBy(asc(resumeProfile.id)).limit(1);
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
      const [analysis, skillRows, bulletRows] = await Promise.all([
        extractJdKeywords({ jdText: input.jdText, jobTitle: input.jobTitle }, chat),
        ctx.db.select({ skill: masterSkills.skill }).from(masterSkills),
        ctx.db
          .select({
            id: resumeBullets.id,
            text: resumeBullets.text,
            skills: resumeBullets.skills,
            roleFamily: resumeBullets.roleFamily,
          })
          .from(resumeBullets),
      ]);

      const bullets: EvidenceBullet[] = bulletRows.map((b) => ({
        id: b.id,
        text: b.text,
        skills: b.skills ?? [],
        roleFamily: b.roleFamily,
      }));
      const keywords = gradeKeywords(analysis.keywords, {
        masterSkills: skillRows.map((r) => r.skill),
        bullets,
        roleFamily: input.roleFamily ?? null,
      });

      return {
        keywords,
        orGroups: analysis.orGroups,
        stats: {
          total: keywords.length,
          dropped: analysis.dropped,
          byGrade: countByGrade(keywords),
        },
      };
    }),

  /**
   * Generate a résumé from the corpus for a pasted JD + the user-selected
   * keywords: retrieve the most relevant real bullets (semantic + keyword),
   * then ask the model for a PLAN and render the document ourselves.
   *
   * The stored base résumé deliberately no longer drives this (#190): an
   * arbitrary LaTeX document has no slots to render into, so the format is the
   * fixed template and the base row is reference material the owner keeps.
   * Without an OpenAI key the untailored template comes back (`source: 'base'`).
   */
  tailorFromCorpus: publicProcedure
    .input(tailorFromCorpusInput)
    .mutation(async ({ ctx, input }) => {
      const selected = normalizeSkillList(input.selectedKeywords);
      // Disjoint even if the client sends overlap: a keyword the corpus backs is
      // claimable, and being in both lists would tell the model two things.
      const selectedSet = new Set(selected);
      const adjacent = normalizeSkillList(input.adjacentKeywords).filter(
        (k) => !selectedSet.has(k),
      );
      const roleFamily = input.roleFamily ?? null;

      const [[profileRow], bulletRows, skillRows] = await Promise.all([
        ctx.db.select().from(resumeProfile).orderBy(asc(resumeProfile.id)).limit(1),
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
        // For the post-generation defence notes: anything the résumé claims
        // that this list does not support is worth checking before submitting.
        ctx.db.select({ skill: masterSkills.skill }).from(masterSkills),
      ]);

      const profile = withProfileDefaults(profileRow ?? null);
      const corpusBullets: CorpusBullet[] = bulletRows.map((r) => ({
        ...r,
        embedding: r.embedding ?? null,
      }));

      // Retrieval sees BOTH lists. An adjacent-only keyword still pulls the
      // nearest real bullet, and that bullet is exactly the adjacent experience
      // the generator has to write about instead of the technology.
      const retrievalKeywords = [...selected, ...adjacent];

      // Embed the keywords as the retrieval query (best-effort).
      let jdEmbedding: number[] | null = null;
      if (retrievalKeywords.length > 0) {
        const embedder = await llmEmbedder();
        if (embedder) {
          try {
            jdEmbedding = await embedder.embed(retrievalKeywords.join(', '));
          } catch {
            jdEmbedding = null;
          }
        }
      }

      const ranked = rankCorpusBullets({
        bullets: corpusBullets,
        jdEmbedding,
        selectedKeywords: retrievalKeywords,
        roleFamily,
      });
      const sourceBullets: CorpusSourceBullet[] = ranked.map((r) => ({
        text: r.text,
        company: r.company,
      }));

      const chat = await tailorChat();
      if (chat) {
        try {
          const result = await tailorFromCorpus(
            { title: input.jobTitle, company: input.company },
            {
              selectedKeywords: selected,
              adjacentKeywords: adjacent,
              bullets: sourceBullets,
              profile,
              masterSkills: skillRows.map((r) => r.skill),
            },
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
      return {
        source: 'base' as const,
        latex: buildDefaultTemplate(profile),
        report: null,
        usedBullets: ranked.length,
      };
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
    // Store the raw LaTeX as the résumé, but extract bullets/skills from the
    // markup-stripped plain text so the corpus doesn't learn LaTeX commands.
    const result = await ingestResume(
      {
        label: input.label,
        text: input.latex,
        extractText: stripLatex(input.latex),
        kind: 'tailored',
      },
      deps,
    );
    return result;
  }),
});
