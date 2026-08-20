/**
 * Run the enrichment pipeline once against the live DB.
 *
 * Mirrors the Inngest orchestrator rather than shortcutting it: one connector at
 * a time, each with its own `hydrate` pass and the same posting-age guard. Two
 * things go wrong if you flatten every connector into one list instead —
 * a source that fetches descriptions separately (Workday) has no `hydrate` to
 * call and lands every posting with an empty JD and no date, which silently
 * breaks both sponsorship tiering and the age filter; and without the age guard
 * the run pays to classify an ATS feed's entire back catalogue.
 *
 * Usage: pnpm enrich [--max-age-days N]
 * Requires DATABASE_URL and OPENAI_API_KEY in .env.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { installDbTimeout } from '@/server/db/http-timeout';
import * as schema from '@/server/db/schema';
import { buildEnrichmentClients, probeRateLimit } from '@/server/enrich/clients';
import { describeRateLimit, isQuotaExhausted } from '@/server/enrich/ratelimit';
import { reconcileFreshness, runEnrichment } from '@/server/enrich/run';
import { buildConnectors, isMeteredSource } from '@/server/ingest/registry';

/** Below this much remaining daily quota, a bulk run is not worth starting. */
const MIN_REQUESTS_TO_START = 200;

/** Matches the scheduled path's default; override with --max-age-days. */
const DEFAULT_MAX_POSTED_AGE_DAYS = 7;

function maxPostedAgeDays(): number {
  const i = process.argv.indexOf('--max-age-days');
  if (i === -1) return DEFAULT_MAX_POSTED_AGE_DAYS;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_POSTED_AGE_DAYS;
}

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

  const maxAge = maxPostedAgeDays();
  console.log(
    `Skipping postings published more than ${maxAge} days ago (undated ones are kept).\n`,
  );

  // Every fingerprint seen across every source, for one reconcile at the end.
  // Reconciling per source would close every OTHER source's jobs.
  const seen: string[] = [];
  let insertedTotal = 0;

  for (const connector of buildConnectors()) {
    // Metered sources are skipped here on purpose. This script does not go
    // through the durable budget the scheduled path keeps, so a manual run would
    // spend requests the budget cannot see — and the whole safety margin is the
    // 20-request gap between what we allow ourselves and what the plan permits.
    if (isMeteredSource(connector.source)) {
      console.log(`${connector.source.padEnd(24)} skipped (metered — runs on the schedule)`);
      continue;
    }

    const postings = await connector.fetch();
    seen.push(...postings.map((p) => p.fingerprint));

    const report = connector.lastReport?.();
    const boards = report?.failed ? ` (${report.failed}/${report.attempted} boards failed)` : '';
    process.stdout.write(`${connector.source.padEnd(24)} fetched ${postings.length}${boards}`);

    // No cap: the CLI is the un-timed path, used for bulk loads too large for
    // the serverless per-step budget.
    const result = await runEnrichment({
      db,
      postings,
      chat: clients.chat,
      embedder: clients.embedder,
      hydrate: connector.hydrate?.bind(connector),
      maxPostedAgeDays: maxAge,
      reconcile: false,
    });
    insertedTotal += result.inserted;

    console.log(
      ` → enriched ${result.stats.enriched}, failed ${result.stats.failed}, inserted ${result.inserted}`,
    );
    for (const f of result.failures) console.log(`    ${f}`);
  }

  const reconcile = await reconcileFreshness(db, seen);
  console.log(`\nInserted ${insertedTotal} new job(s).`);
  console.log(`freshness: refreshed ${reconcile.refreshed}, closed ${reconcile.closed} stale.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
