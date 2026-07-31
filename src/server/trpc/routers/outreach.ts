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
import { contacts, outreachChannelEnum, outreachLog } from '@/server/db/schema';
import { draftOutreachEmail, templateOutreachEmail } from '@/server/outreach/email';
import { createTRPCRouter, publicProcedure } from '../trpc';

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
  draftEmail: publicProcedure.input(draftEmailInput).mutation(async ({ input }) => {
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      try {
        const { default: OpenAI } = await import('openai');
        const { openaiChat } = await import('@/server/enrich/openai');
        const chat = openaiChat(
          new OpenAI({ apiKey: key }),
          process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini',
        );
        return { ...(await draftOutreachEmail(input, chat)), source: 'llm' as const };
      } catch (err) {
        // Fall through to the template on any LLM/parse failure, but log it so a
        // persistently broken LLM path is visible rather than silently templated.
        console.warn('draftEmail: LLM draft failed, using template', err);
      }
    }
    return { ...templateOutreachEmail(input), source: 'template' as const };
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
        message: 'Outlook is not configured (MS_CLIENT_ID / MS_REFRESH_TOKEN). Run pnpm outlook:auth.',
      });
    }

    const [contact] = await ctx.db
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found.' });
    }
    if (!contact.email) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This contact has no email address — add one before sending.',
      });
    }

    const { graphMailSender, refreshAccessToken } = await import('@/server/outlook/graph');
    const tenant = process.env.MS_TENANT || 'consumers';
    const sender = graphMailSender({
      fetch,
      getAccessToken: () => refreshAccessToken(fetch, { clientId, refreshToken, tenant }),
    });
    await sender.sendMail({ to: contact.email, subject: input.subject, body: input.body });

    await ctx.db.insert(outreachLog).values({ contactId: contact.id, channel: 'email' });
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
