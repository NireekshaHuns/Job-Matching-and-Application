/**
 * Durable enrichment function: fetch from every connector, enrich the new
 * postings, write them to `jobs`, then reconcile freshness.
 *
 * RUNS HOURLY, plus on demand. A postings feed is only worth what it costs to
 * read, and the free ATS sources cost nothing per request — so the limiting
 * factor is the LLM classify call, which the posting-age guard and the title
 * filter already bound. Hourly means a job posted this morning is on the board
 * this morning, instead of whenever the owner next remembers to click.
 *
 * The one source that DOES cost money per request is held to a separate budget;
 * see `decideMeteredRun`. Without that, 720 scheduled runs a month against a
 * 200-request plan would exhaust it inside a day.
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
 * Postings older than this never reach the paid classify step.
 *
 * A week rather than the few days the board actually displays: the extra margin
 * is what lets a scheduled run miss a day or two without permanently losing the
 * postings from that window. An undated posting is always kept.
 */
const DEFAULT_MAX_POSTED_AGE_DAYS = 7;
const MAX_POSTED_AGE_DAYS = (() => {
  // Validated at the boundary and failing toward the default: an unparseable
  // value must not be able to quietly turn ingestion off.
  const parsed = Number(process.env.INGEST_MAX_POSTED_AGE_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_POSTED_AGE_DAYS;
})();

/**
 * Ceiling on chained continuation runs, so a source that somehow never drains
 * cannot loop forever. At 100 new postings per source per run this is ample for
 * any realistic backlog.
 */
const MAX_CONTINUATIONS = 12;

interface RefreshEventData {
  /** How many continuations deep we are; absent on a user-triggered run. */
  continuation?: number;
}

export const enrichJobs = inngest.createFunction(
  {
    id: 'enrich-jobs',
    // Serialize runs: overlapping runs would each classify/embed the same new
    // postings (spending before the insert-conflict catches the dupes). Manual
    // `pnpm enrich` runs should likewise not overlap a scheduled run.
    concurrency: { limit: 1 },
    triggers: [
      // The board's "Find new jobs" button (jobs.refresh → inngest.send), plus
      // this function's own continuation events.
      { event: 'jobs/refresh.requested' },
      // Hourly. `concurrency: 1` above means a tick that lands while the
      // previous run is still draining queues rather than overlapping it.
      { cron: '0 * * * *' },
    ],
  },
  async ({ event, step }) => {
    const depth = (event?.data as RefreshEventData | undefined)?.continuation ?? 0;

    const { buildConnectors, isMeteredSource, skipSourceOnRun } =
      await import('@/server/ingest/registry');
    const sources = buildConnectors().map((c) => c.source);

    const seen: string[] = [];
    const perSource: Record<
      string,
      { fetched: number; inserted: number; deferred: number; boardsFailed: number }
    > = {};
    let deferredTotal = 0;

    for (const source of sources) {
      const metered = isMeteredSource(source);

      // A metered source is fetched ONCE per user-triggered refresh. A
      // continuation exists to drain postings already sitting in the DB, and
      // this run's `requests` counter resets to zero on every one of them — so
      // without this guard, one click would re-buy the same listings up to
      // MAX_CONTINUATIONS more times. Nothing is lost by skipping: a metered
      // source returns far fewer than MAX_NEW_PER_SOURCE postings, so it is
      // never the source that deferred.
      if (skipSourceOnRun(source, depth)) {
        perSource[source] = { fetched: 0, inserted: 0, deferred: 0, boardsFailed: 0 };
        continue;
      }

      // One step per source: a fresh invocation each, so the 300s budget applies
      // per source rather than to the whole run.
      //
      // For a metered source the fetch is split into its OWN step, because
      // `step.run` re-executes its whole callback on retry — and this callback
      // fails for reasons that have nothing to do with fetching (a missing LLM
      // key, a classify/embed 5xx, a Neon timeout). Sharing a retry boundary
      // would re-buy the listings on every attempt. Split, the fetch memoizes
      // on success and only enrichment retries. Safe to serialize between steps
      // because the connector's request cap bounds how much it can return.
      const prefetched = metered
        ? await step.run(`fetch-${source}`, async () => {
            const { neon } = await import('@neondatabase/serverless');
            const { drizzle } = await import('drizzle-orm/neon-http');
            const schema = await import('@/server/db/schema');
            const { buildConnectors: build } = await import('@/server/ingest/registry');
            const { decideMeteredRun, recordMeteredRun } = await import('@/server/ingest/metering');
            const { loadMeteredUsage, saveMeteredUsage } = await import('@/server/ingest/usage');
            const { installDbTimeout } = await import('@/server/db/http-timeout');
            installDbTimeout();
            const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });

            // The budget lives in the DB because it outlives a run. An hourly
            // schedule against a ~200-request monthly plan would otherwise burn
            // the quota inside a day, and an exhausted plan just answers 429.
            const now = new Date();
            const usage = await loadMeteredUsage(db, source);
            const decision = decideMeteredRun(usage, now);
            if (!decision.run) {
              console.info(`[${source}] skipped — ${decision.reason}`);
              return [];
            }

            const connector = build().find((c) => c.source === source);
            if (!connector) return [];
            const postings = await connector.fetch();

            // Recorded even on a failed/partial fetch: the requests were spent
            // either way, and forgetting them is how a budget gets overrun.
            const spent = connector.lastReport?.()?.attempted ?? 0;
            await saveMeteredUsage(db, source, recordMeteredRun(usage, spent, now));
            console.info(`[${source}] spent ${spent} request(s); ${postings.length} posting(s).`);
            return postings;
          })
        : null;

      const result = await step.run(`ingest-${source}`, async () => {
        const { neon } = await import('@neondatabase/serverless');
        const { drizzle } = await import('drizzle-orm/neon-http');
        const schema = await import('@/server/db/schema');
        const { buildConnectors: build } = await import('@/server/ingest/registry');
        const { runEnrichment } = await import('@/server/enrich/run');
        type JobConnector = Awaited<ReturnType<typeof build>>[number];
        const { buildEnrichmentClients } = await import('@/server/enrich/clients');
        const { installDbTimeout } = await import('@/server/db/http-timeout');
        installDbTimeout();

        const clients = await buildEnrichmentClients();
        if (!clients) throw new Error('No LLM key configured — cannot enrich.');

        let postings;
        let boardsFailed = 0;
        let hydrator: JobConnector['hydrate'];
        if (prefetched) {
          // Assigned on BOTH branches: a source that needs hydration but is also
          // metered would otherwise ingest every posting with an empty JD, and
          // sponsorship is derived from JD text on a row that is never re-analyzed.
          const metredConnector = build().find((c) => c.source === source);
          hydrator = metredConnector?.hydrate?.bind(metredConnector);
          // Step output round-trips through JSON, so `postedAt` arrives as a
          // string. Revive it — `jobs.posted_date` and the board's "5h ago"
          // rendering both depend on it being a real Date.
          postings = prefetched.map((p) => ({
            ...p,
            postedAt: p.postedAt ? new Date(p.postedAt) : null,
          }));
        } else {
          const connector = build().find((c) => c.source === source);
          if (!connector)
            return { fingerprints: [], fetched: 0, inserted: 0, deferred: 0, boardsFailed: 0 };
          postings = await connector.fetch();
          hydrator = connector.hydrate?.bind(connector);
          // Dead ATS tokens used to vanish into a console.warn — the run looked
          // healthy while a board quietly contributed nothing. Carry the count out.
          const report = connector.lastReport?.();
          if (report && report.failed > 0) {
            boardsFailed = report.failed;
            console.warn(
              `[${source}] ${report.failed}/${report.attempted} boards failed: ${report.failures.join(', ')}`,
            );
          }
        }

        const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
        const run = await runEnrichment({
          db,
          postings,
          chat: clients.chat,
          embedder: clients.embedder,
          // Sources that charge a request per description fill them in after the
          // cap has chosen, so the budget lands on postings that get enriched.
          hydrate: hydrator,
          maxPostedAgeDays: MAX_POSTED_AGE_DAYS,
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
          boardsFailed,
        };
      });

      seen.push(...result.fingerprints);
      perSource[source] = {
        fetched: result.fetched,
        inserted: result.inserted,
        deferred: result.deferred,
        boardsFailed: result.boardsFailed,
      };
      deferredTotal += result.deferred;
    }

    const reconcile = await step.run('reconcile-freshness', async () => {
      const { neon } = await import('@neondatabase/serverless');
      const { drizzle } = await import('drizzle-orm/neon-http');
      const schema = await import('@/server/db/schema');
      const { reconcileFreshness } = await import('@/server/enrich/run');
      const { installDbTimeout } = await import('@/server/db/http-timeout');
      installDbTimeout();
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
