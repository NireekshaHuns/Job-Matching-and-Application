/**
 * Run the enrichment pipeline once against the live DB.
 *
 * Usage: pnpm enrich
 * Requires DATABASE_URL and OPENAI_API_KEY in .env. Fetches from all connectors,
 * enriches new postings (classify + embed via OpenAI), and inserts into `jobs`.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { installDbTimeout } from '@/server/db/http-timeout';
import * as schema from '@/server/db/schema';
import { buildEnrichmentClients, probeRateLimit } from '@/server/enrich/clients';
import { describeRateLimit, isQuotaExhausted } from '@/server/enrich/ratelimit';
import { runEnrichment } from '@/server/enrich/run';
import { buildConnectors } from '@/server/ingest/registry';

/** Below this much remaining daily quota, a bulk run is not worth starting. */
const MIN_REQUESTS_TO_START = 200;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }

  const clients = await buildEnrichmentClients();
  if (!clients) {
    console.error('No LLM key set — need OPENAI_API_KEY, or OPENAI_CLASSIFY_BASE_URL +');
    console.error('OPENAI_CLASSIFY_API_KEY to route classification elsewhere (check .env).');
    process.exit(1);
  }

  // Neon's HTTP driver has no request timeout; a silent socket hangs forever.
  installDbTimeout();
  // Preflight: an exhausted daily quota makes every call 429, and the SDK then
  // backs off silently — the run looks hung rather than throttled (issue #148).
  // Better to say so up front than to discover it two hours in.
  const limit = await probeRateLimit();
  if (limit) {
    console.log(describeRateLimit(limit));
    if (isQuotaExhausted(limit, MIN_REQUESTS_TO_START) && !process.argv.includes('--force')) {
      console.error(
        `Not enough request quota left to be worth starting (need ~${MIN_REQUESTS_TO_START}).`,
      );
      console.error('Wait for the reset, point OPENAI_CLASSIFY_* at another provider, or --force.');
      process.exit(1);
    }
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  console.log('Fetching postings from connectors...');
  const postings = (await Promise.all(buildConnectors().map((c) => c.fetch()))).flat();

  console.log(`Fetched ${postings.length}. Enriching new postings...`);
  // No cap and no reconcile override: the CLI is the un-timed path, used for
  // bulk loads too large for the serverless per-step budget.
  const result = await runEnrichment({
    db,
    postings,
    chat: clients.chat,
    embedder: clients.embedder,
    // A backfill runs for hours; show it is alive and persisting.
    onProgress: (inserted) => console.log(`  …inserted ${inserted} so far`),
  });

  console.log(
    `fetched ${result.stats.fetched}, unique ${result.stats.deduped}, non-SWE filtered ${result.stats.filtered}, ` +
      `enriched ${result.stats.enriched}, failed ${result.stats.failed}, inserted ${result.inserted}.`,
  );
  if (result.failures.length > 0) {
    console.log('sample failures (skipped, not fatal):');
    for (const f of result.failures) console.log(`  ${f}`);
  }
  console.log(
    `freshness: refreshed ${result.reconcile.refreshed}, closed ${result.reconcile.closed} stale; aliases upserted ${result.aliasesWritten}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
