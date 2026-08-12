/**
 * Durable enrichment function. Runs on a cron and on demand: fetch from every
 * connector, enrich the new postings, write them to `jobs`, then reconcile
 * freshness.
 *
 * SHAPE OF THE WORK — this is why it is split into steps.
 * Each Inngest step is served by its own HTTP invocation, and on Vercel an
 * invocation is capped at 300s. The whole run used to be a single step, which
 * meant the entire fetch + classify + embed pass had to finish inside one
 * invocation. It did not: production logged
 * `Vercel Runtime Timeout Error: Task timed out after 300 seconds` (504) on
 * /api/inngest, so every run died and nothing was ever ingested. Now each
 * source is its own step, each step enriches at most MAX_NEW_PER_SOURCE new
 * postings, and anything left over continues in a follow-up run.
 *
 * All heavy imports (OpenAI SDK, db client, connectors) are dynamic and inside
 * the steps, so merely registering this function never pulls secrets at import
 * time — the app boots fine without OPENAI_API_KEY set. IMPORTANT: keep it that
 * way — never add a static import of `@/server/db` (its index calls neon(env...)
 * at load); import the schema (`@/server/db/schema`, env-free) instead.
 */
import { inngest } from '../client';

/**
 * New postings enriched per source per run. Each costs one LLM classify plus
 * one embed (a second or two), so this is the knob that keeps a step inside the
 * invocation limit. Deliberately conservative — leftovers are not lost, they
 * just move to the next run.
 */
const MAX_NEW_PER_SOURCE = 100;

/**
 * Ceiling on chained continuation runs, so a source that somehow never drains
 * cannot loop forever. At 100 new postings per source per run this is ample for
 * any realistic backlog.
 */
const MAX_CONTINUATIONS = 12;

interface RefreshEventData {
  /** How many continuations deep we are; absent on a user- or cron-triggered run. */
  continuation?: number;
}

export const enrichJobs = inngest.createFunction(
  {
    id: 'enrich-jobs',
    // Serialize runs: overlapping runs would each classify/embed the same new
    // postings (spending before the insert-conflict catches the dupes). Manual
    // `pnpm enrich` runs should likewise not overlap a scheduled run.
    concurrency: { limit: 1 },
    // Scheduled every 6h, plus an on-demand trigger from the board's
    // "Find new jobs" button (jobs.refresh → inngest.send).
    triggers: [{ cron: '0 */6 * * *' }, { event: 'jobs/refresh.requested' }],
  },
  async ({ event, step }) => {
    const depth = (event?.data as RefreshEventData | undefined)?.continuation ?? 0;

    const { buildConnectors } = await import('@/server/ingest/registry');
    const sources = buildConnectors().map((c) => c.source);

    const seen: string[] = [];
    const perSource: Record<string, { fetched: number; inserted: number; deferred: number }> = {};
    let deferredTotal = 0;

    for (const source of sources) {
      // One step per source: a fresh invocation each, so the 300s budget applies
      // per source rather than to the whole run.
      const result = await step.run(`ingest-${source}`, async () => {
        const { neon } = await import('@neondatabase/serverless');
        const { drizzle } = await import('drizzle-orm/neon-http');
        const schema = await import('@/server/db/schema');
        const { buildConnectors: build } = await import('@/server/ingest/registry');
        const { runEnrichment } = await import('@/server/enrich/run');
        const { buildEnrichmentClients } = await import('@/server/enrich/clients');

        const connector = build().find((c) => c.source === source);
        if (!connector) return { fingerprints: [], fetched: 0, inserted: 0, deferred: 0 };

        const clients = await buildEnrichmentClients();
        if (!clients) throw new Error('No LLM key configured — cannot enrich.');

        const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
        const postings = await connector.fetch();
        const run = await runEnrichment({
          db,
          postings,
          chat: clients.chat,
          embedder: clients.embedder,
          // Reconcile once at the end, over every source — doing it here would
          // close every other source's jobs.
          reconcile: false,
          maxNew: MAX_NEW_PER_SOURCE,
        });
        return {
          // Short strings; the full list is what keeps live jobs from going stale.
          fingerprints: postings.map((p) => p.fingerprint),
          fetched: postings.length,
          inserted: run.inserted,
          deferred: run.deferred,
        };
      });

      seen.push(...result.fingerprints);
      perSource[source] = {
        fetched: result.fetched,
        inserted: result.inserted,
        deferred: result.deferred,
      };
      deferredTotal += result.deferred;
    }

    const reconcile = await step.run('reconcile-freshness', async () => {
      const { neon } = await import('@neondatabase/serverless');
      const { drizzle } = await import('drizzle-orm/neon-http');
      const schema = await import('@/server/db/schema');
      const { reconcileFreshness } = await import('@/server/enrich/run');
      const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
      return reconcileFreshness(db, seen);
    });

    // Work left over: continue in a fresh run rather than pushing this one past
    // its budget. The depth guard stops a pathological source looping forever.
    const willContinue = deferredTotal > 0 && depth < MAX_CONTINUATIONS;
    if (willContinue) {
      await step.sendEvent('continue-enrichment', {
        name: 'jobs/refresh.requested',
        data: { continuation: depth + 1 } satisfies RefreshEventData,
      });
    }

    return { perSource, deferred: deferredTotal, continuation: depth, willContinue, reconcile };
  },
);
