/**
 * People-finder (spec §5.6). For a company, surface relevant people with
 * inferred emails via Apollo/Hunter — never LinkedIn scraping. The feature
 * no-ops when no provider key is set. Results are cached per query (free-tier
 * cost control); only people the user explicitly imports persist as `contacts`
 * (PII minimization, §7). The cache is TTL'd + purgeable.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, jobs, peopleCache } from '@/server/db/schema';
import { buildPeopleProviders, findPeople, type PersonResult } from '@/server/people';
import { isCacheFresh, peopleCacheKey } from '@/server/people/cache';
import { purgeStalePeopleCache } from '@/server/people/purge';
import { createTRPCRouter, publicProcedure } from '../trpc';

// Re-exported so existing importers/tests keep their paths.
export { CACHE_TTL_DAYS, isCacheFresh, peopleCacheKey, staleCutoff } from '@/server/people/cache';

export const findPeopleInput = z.object({
  company: z.string().min(1).max(200),
  domain: z.string().max(255).optional(),
});

export const importPersonInput = z.object({
  jobId: z.number().int(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
});

function providerKeys() {
  return { hunterKey: process.env.HUNTER_API_KEY, apolloKey: process.env.APOLLO_API_KEY };
}

/**
 * Best-effort company domain from a name (e.g. "Pure Storage" → "purestorage.com").
 * Used to seed the people-finder when we only have a company name (from the board).
 * Often right for well-known employers; wrong guesses simply return no people.
 */
export function companyDomainGuess(company: string): string {
  const slug = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return slug ? `${slug}.com` : '';
}

export const peopleRouter = createTRPCRouter({
  /** Whether any provider key is configured (drives the UI's enabled state). */
  status: publicProcedure.query(() => {
    const { hunterKey, apolloKey } = providerKeys();
    return { configured: Boolean(hunterKey || apolloKey) };
  }),

  /**
   * Find people for a company. Cache-first (per query, TTL'd); on a miss (and
   * when providers are configured) fan out to the providers and cache the merged
   * results. Returns `configured: false` when no key is set.
   */
  find: publicProcedure.input(findPeopleInput).mutation(async ({ ctx, input }) => {
    const keys = providerKeys();
    if (!keys.hunterKey && !keys.apolloKey) {
      return { configured: false as const, cached: false, people: [] as PersonResult[] };
    }

    const key = peopleCacheKey(input.company, input.domain);
    const [cached] = await ctx.db
      .select({ results: peopleCache.results, fetchedAt: peopleCache.fetchedAt })
      .from(peopleCache)
      .where(eq(peopleCache.cacheKey, key))
      .limit(1);

    if (cached && isCacheFresh(cached.fetchedAt, new Date())) {
      return { configured: true as const, cached: true, people: cached.results as PersonResult[] };
    }

    // Cache miss/stale: opportunistically drop any expired rows (bounds how long
    // third-party PII lingers) before refetching + upserting this query. The
    // scheduled Inngest purge is the backstop when the finder isn't used.
    await purgeStalePeopleCache(ctx.db);

    const providers = buildPeopleProviders(keys, fetch);
    const people = await findPeople(providers, { company: input.company, domain: input.domain });

    await ctx.db
      .insert(peopleCache)
      .values({ cacheKey: key, results: people, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: peopleCache.cacheKey,
        set: { results: people, fetchedAt: new Date() },
      });

    return { configured: true as const, cached: false, people };
  }),

  /**
   * Persist a chosen person as a contact for the job (the only PII we keep).
   * Deduped on (jobId, email) so re-importing the same person doesn't pile up
   * duplicate rows.
   */
  import: publicProcedure.input(importPersonInput).mutation(async ({ ctx, input }) => {
    if (input.email) {
      const [existing] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.jobId, input.jobId), eq(contacts.email, input.email)))
        .limit(1);
      if (existing) return existing;
    }

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

  /**
   * On "I applied", best-effort kick off outreach: find people for the job's
   * company (domain guessed from the name) and import the top emailable one as a
   * contact, so the tracker's outreach panel already has someone to draft to.
   * No-ops cleanly when providers are unconfigured or nothing is found.
   */
  kickoffForJob: publicProcedure
    .input(z.object({ jobId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const keys = providerKeys();
      if (!keys.hunterKey && !keys.apolloKey) return { configured: false as const, imported: 0 };

      const [job] = await ctx.db
        .select({ company: jobs.company })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1);
      if (!job) return { configured: true as const, imported: 0 };

      const domain = companyDomainGuess(job.company) || undefined;
      const providers = buildPeopleProviders(keys, fetch);
      const people = await findPeople(providers, { company: job.company, domain });
      // Prefer someone with an email (contactable); else the top result.
      const pick = people.find((p) => p.email) ?? people[0];
      if (!pick) return { configured: true as const, imported: 0, company: job.company };

      if (pick.email) {
        const [existing] = await ctx.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.jobId, input.jobId), eq(contacts.email, pick.email)))
          .limit(1);
        if (existing) return { configured: true as const, imported: 0, company: job.company };
      }

      await ctx.db.insert(contacts).values({
        jobId: input.jobId,
        name: pick.name,
        title: pick.title,
        email: pick.email,
      });
      return { configured: true as const, imported: 1, company: job.company };
    }),

  /** Purge the cached third-party results (privacy hygiene). */
  purgeCache: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(peopleCache);
    return { ok: true as const };
  }),
});
