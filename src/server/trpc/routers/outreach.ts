/**
 * Outreach tracking: hiring-manager/recruiter contacts per job and a log of
 * touches. Contacts are ones the user chose to save (from clicking the
 * compliant deep-links); we never harvest them automatically.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { TRPCError } from '@trpc/server';
import { desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/server/db';
import {
  contacts,
  jobs,
  masterSkills,
  outreachChannelEnum,
  outreachLog,
  resumeBullets,
  resumes,
} from '@/server/db/schema';
import { draftOutreachEmail, templateOutreachEmail } from '@/server/outreach/email';
import { resumeSkillsFromBullets } from '@/server/resume/bullets';
import { coverableStrengths } from '@/server/resume/strengths';
import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * The sender's truthful skills that match a job (job keywords ∩ what they can
 * present), for a "why I'm a fit" line in outreach. Returns undefined when there
 * is no job context or nothing matches — never invents skills.
 */
async function loadCoverableStrengths(
  db: DB,
  jobId?: number,
  resumeId?: number,
): Promise<string[] | undefined> {
  if (jobId == null) return undefined;
  const [job] = await db
    .select({ techKeywords: jobs.techKeywords, softKeywords: jobs.softKeywords })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return undefined;

  const [skills, bullets, resume] = await Promise.all([
    db.select({ skill: masterSkills.skill }).from(masterSkills),
    db
      .select({ skills: resumeBullets.skills, roleFamily: resumeBullets.roleFamily })
      .from(resumeBullets),
    resumeId != null
      ? db
          .select({ roleFamily: resumes.roleFamily })
          .from(resumes)
          .where(eq(resumes.id, resumeId))
          .limit(1)
      : Promise.resolve([] as { roleFamily: (typeof resumes.$inferSelect)['roleFamily'] }[]),
  ]);

  // Best-effort: an absent or unresolved resumeId falls back to the generalist
  // role family (sees all bullets) rather than throwing — this is a draft aid,
  // not the stricter résumé lookup in the resumes router.
  const coverable = coverableStrengths(
    [...job.techKeywords, ...job.softKeywords],
    resumeSkillsFromBullets(bullets, resume[0]?.roleFamily ?? null),
    skills.map((s) => s.skill),
  );
  return coverable.length > 0 ? coverable.slice(0, 6) : undefined;
}

export const addContactInput = z.object({
  jobId: z.number().int(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
});

export const sendEmailInput = z.object({
  contactId: z.number().int(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
});

export const logTouchInput = z.object({
  contactId: z.number().int(),
  channel: z.enum(outreachChannelEnum.enumValues).default('linkedin'),
});

export const draftEmailInput = z.object({
  company: z.string().min(1).max(200),
  role: z.string().max(200).optional(),
  contactName: z.string().max(200).optional(),
  contactTitle: z.string().max(200).optional(),
  /** When set, the draft weaves in the sender's skills that match this job. */
  jobId: z.number().int().optional(),
  resumeId: z.number().int().optional(),
});

export const outreachRouter = createTRPCRouter({
  contactsByJob: publicProcedure
    .input(z.object({ jobId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: contacts.id,
          name: contacts.name,
          title: contacts.title,
          email: contacts.email,
          linkedinUrl: contacts.linkedinUrl,
        })
        .from(contacts)
        .where(eq(contacts.jobId, input.jobId))
        .orderBy(desc(contacts.id));
      if (rows.length === 0) return [];

      const touches = await ctx.db
        .select({
          contactId: outreachLog.contactId,
          count: sql<number>`count(*)::int`,
          last: sql<string | null>`max(${outreachLog.contactedAt})`,
        })
        .from(outreachLog)
        .where(
          inArray(
            outreachLog.contactId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(outreachLog.contactId);
      const byId = new Map(touches.map((t) => [t.contactId, t]));

      return rows.map((r) => ({
        ...r,
        touches: byId.get(r.id)?.count ?? 0,
        lastContactedAt: byId.get(r.id)?.last ?? null,
      }));
    }),

  addContact: publicProcedure.input(addContactInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .insert(contacts)
      .values({
        jobId: input.jobId,
        name: input.name,
        title: input.title,
        email: input.email,
        linkedinUrl: input.linkedinUrl,
      })
      .returning({ id: contacts.id });
    return row;
  }),

  removeContact: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(contacts).where(eq(contacts.id, input.id));
      return { id: input.id };
    }),

  logTouch: publicProcedure.input(logTouchInput).mutation(async ({ ctx, input }) => {
    await ctx.db.insert(outreachLog).values({ contactId: input.contactId, channel: input.channel });
    return { ok: true };
  }),

  /**
   * Draft an outreach email for a contact/company. Uses the LLM when
   * OPENAI_API_KEY is set (openai imported lazily so the app boots without it),
   * and falls back to the deterministic template otherwise or on any failure.
   */
  draftEmail: publicProcedure.input(draftEmailInput).mutation(async ({ ctx, input }) => {
    const fitSkills = await loadCoverableStrengths(ctx.db, input.jobId, input.resumeId);
    const req = { ...input, fitSkills };
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      try {
        const { default: OpenAI } = await import('openai');
        const { openaiChat } = await import('@/server/enrich/openai');
        const chat = openaiChat(
          new OpenAI({ apiKey: key }),
          process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini',
        );
        return { ...(await draftOutreachEmail(req, chat)), source: 'llm' as const };
      } catch (err) {
        // Fall through to the template on any LLM/parse failure, but log it so a
        // persistently broken LLM path is visible rather than silently templated.
        console.warn('draftEmail: LLM draft failed, using template', err);
      }
    }
    return { ...templateOutreachEmail(req), source: 'template' as const };
  }),

  /**
   * Send a reviewed draft to a saved contact via Microsoft Graph `Mail.Send`,
   * then log an `email` touch. Draft-first: the client only calls this on an
   * explicit Send of content the user has already reviewed/edited. Graph is
   * imported lazily so the app boots without MS creds; a clear error surfaces
   * when they're missing or the contact has no email on file.
   */
  sendEmail: publicProcedure.input(sendEmailInput).mutation(async ({ ctx, input }) => {
    const clientId = process.env.MS_CLIENT_ID;
    const refreshToken = process.env.MS_REFRESH_TOKEN;
    if (!clientId || !refreshToken) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Outlook is not configured (MS_CLIENT_ID / MS_REFRESH_TOKEN). Run pnpm outlook:auth.',
      });
    }

    const { graphMailSender, refreshAccessToken } = await import('@/server/outlook/graph');
    const { sendOutreachEmail } = await import('@/server/outreach/send');
    const tenant = process.env.MS_TENANT || 'consumers';
    const sender = graphMailSender({
      fetch,
      getAccessToken: () => refreshAccessToken(fetch, { clientId, refreshToken, tenant }),
    });

    const result = await sendOutreachEmail({
      db: ctx.db,
      sender,
      contactId: input.contactId,
      subject: input.subject,
      body: input.body,
    });
    if (result.status === 'not_found') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found.' });
    }
    if (result.status === 'no_email') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This contact has no email address — add one before sending.',
      });
    }
    return { ok: true as const };
  }),

  /**
   * Count outreach touches since `sinceMs` — the daily nudge. The client passes
   * its own local midnight so the count resets at the user's midnight, not the
   * server's (Vercel runs in UTC).
   */
  todayCount: publicProcedure
    .input(z.object({ sinceMs: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(outreachLog)
        .where(gte(outreachLog.contactedAt, new Date(input.sinceMs)));
      return row?.n ?? 0;
    }),
});
