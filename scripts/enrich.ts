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
import OpenAI from 'openai';
import * as schema from '@/server/db/schema';
import { openaiChat, openaiEmbedder } from '@/server/enrich/openai';
import { runEnrichment } from '@/server/enrich/run';
import { buildConnectors } from '@/server/ingest/registry';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set (check .env).');
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
  const embedder = openaiEmbedder(
    openai,
    process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small',
  );

  console.log('Fetching postings from connectors...');
  const postings = (await Promise.all(buildConnectors().map((c) => c.fetch()))).flat();

  console.log(`Fetched ${postings.length}. Enriching new postings...`);
  const result = await runEnrichment({ db, postings, chat, embedder });

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
