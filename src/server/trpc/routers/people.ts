/**
 * People-finder (spec §5.6). For a company, surface relevant people with
 * inferred emails via Apollo/Hunter — never LinkedIn scraping. The feature
 * no-ops when no provider key is set. Results are cached per query (free-tier
 * cost control); only people the user explicitly imports persist as `contacts`
 * (PII minimization, §7). The cache is TTL'd + purgeable.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, peopleCache } from '@/server/db/schema';
import { buildPeopleProviders, findPeople, type PersonResult } from '@/server/people';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** Cached results older than this are refetched (and eligible for deletion). */
export const CACHE_TTL_DAYS = 7;

/**
 * Stable per-query cache key. JSON-encodes the normalized fields so a value
 * containing the delimiter can't collide with a different (company, domain) pair.
 */
export function peopleCacheKey(company: string, domain?: string | null): string {
  return JSON.stringify([company.trim().toLowerCase(), (domain ?? '').trim().toLowerCase()]);
}

/** The cutoff before which a cache row is stale. */
export function staleCutoff(now: Date, ttlDays: number = CACHE_TTL_DAYS): Date {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);
}

/** True when a cached row is still within the TTL. */
export function isCacheFresh(
  fetchedAt: Date,
  now: Date,
  ttlDays: number = CACHE_TTL_DAYS,
): boolean {
  return now.getTime() - fetchedAt.getTime() < ttlDays * 24 * 60 * 60 * 1000;
}

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
    // third-party PII lingers) before refetching + upserting this query.
    await ctx.db.delete(peopleCache).where(lt(peopleCache.fetchedAt, staleCutoff(new Date())));

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

  /** Purge the cached third-party results (privacy hygiene). */
  purgeCache: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(peopleCache);
    return { ok: true as const };
  }),
});
