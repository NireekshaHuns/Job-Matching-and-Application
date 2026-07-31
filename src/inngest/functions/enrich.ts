/**
 * Durable enrichment function. Runs on a cron: fetch from all connectors,
 * enrich the new postings, and write them to `jobs`.
 *
 * All heavy imports (OpenAI SDK, db client, connectors) are dynamic and inside
 * the step, so merely registering this function never pulls secrets at import
 * time — the app boots fine without OPENAI_API_KEY set. IMPORTANT: keep it that
 * way — never add a static import of `@/server/db` (its index calls neon(env...)
 * at load); import the schema (`@/server/db/schema`, env-free) instead.
 *
 * The whole run is one durable step for now (embeddings make per-posting step
 * payloads large). Trade-off: any failure retries the entire fetch+classify+
 * embed run, re-spending on postings already processed in that attempt (the
 * insert dedup saves rows, not API spend). The planned raw_jobs claim pattern
 * will let us split this into per-posting steps.
 */
import { inngest } from '../client';

export const enrichJobs = inngest.createFunction(
  {
    id: 'enrich-jobs',
    // Serialize runs: overlapping runs would each classify/embed the same new
    // postings (spending before the insert-conflict catches the dupes). Manual
    // `pnpm enrich` runs should likewise not overlap a scheduled run.
    concurrency: { limit: 1 },
    triggers: [{ cron: '0 */6 * * *' }],
  },
  async ({ step }) => {
    return step.run('fetch-and-enrich', async () => {
      const { default: OpenAI } = await import('openai');
      const { neon } = await import('@neondatabase/serverless');
      const { drizzle } = await import('drizzle-orm/neon-http');
      const schema = await import('@/server/db/schema');
      const { buildConnectors } = await import('@/server/ingest/registry');
      const { runEnrichment } = await import('@/server/enrich/run');
      const { openaiChat, openaiEmbedder } = await import('@/server/enrich/openai');

      const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
      const embedder = openaiEmbedder(
        openai,
        process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small',
      );

      const postings = (await Promise.all(buildConnectors().map((c) => c.fetch()))).flat();
      const result = await runEnrichment({ db, postings, chat, embedder });
      return {
        ...result.stats,
        inserted: result.inserted,
        aliasesWritten: result.aliasesWritten,
        reconcile: result.reconcile,
      };
    });
  },
);
