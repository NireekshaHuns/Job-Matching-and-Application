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
import { buildEnrichmentClients } from '@/server/enrich/clients';
import { runEnrichment } from '@/server/enrich/run';
import { buildConnectors } from '@/server/ingest/registry';

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
