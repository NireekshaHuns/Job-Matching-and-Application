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
  });

  console.log(
    `fetched ${result.stats.fetched}, unique ${result.stats.deduped}, non-SWE filtered ${result.stats.filtered}, enriched ${result.stats.enriched}, inserted ${result.inserted}.`,
  );
  console.log(
    `freshness: refreshed ${result.reconcile.refreshed}, closed ${result.reconcile.closed} stale; aliases upserted ${result.aliasesWritten}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
