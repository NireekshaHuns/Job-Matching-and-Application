/**
 * Enrichment orchestrator. Ties the steps together for one posting and for a
 * batch. Pure with respect to I/O — all external access (LLM, embeddings,
 * sponsor lookup) is injected, so the whole pipeline is unit-testable offline.
 *
 * Cost control: the batch skips any posting whose fingerprint already exists in
 * `jobs`, so classify/embed run at most once per job.
 */
import type { NewJob } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import { buildJobRow } from './steps/build-row';
import { classifyPosting } from './steps/classify';
import { dedupPostings } from './steps/dedup';
import { embedJd } from './steps/embed';
import type { SponsorResolver } from './steps/resolver';
import { matchSponsor } from './steps/sponsor-match';
import { looksLikeSwe } from './steps/swe-title';
import { isRecentEnough } from './recency';
import type { ChatClient, Embedder } from './types';

export interface EnrichDeps {
  chat: ChatClient;
  /** Omit to skip JD embedding — see steps/embed.ts for why that is the default. */
  embedder?: Embedder;
  resolve: SponsorResolver;
}

/** Enrich a single posting into a clean `jobs` row. */
export async function enrichPosting(posting: RawPosting, deps: EnrichDeps): Promise<NewJob> {
  const sponsor = matchSponsor(posting.company, posting.jdText, deps.resolve);
  // Classify always: the title alone carries real signal (role/seniority), even
  // for sources with no JD text. Embedding is skipped when no embedder is
  // supplied, and for empty JDs, so we never pay for nothing.
  const classification = await classifyPosting(posting, deps.chat);
  const embedding = await embedJd(posting.jdText, deps.embedder);
  return buildJobRow(posting, sponsor, classification, embedding);
}

export interface EnrichResult {
  /** Rows not yet handed to `onBatch` (or all of them when no flush is used). */
  rows: NewJob[];
  stats: {
    fetched: number;
    deduped: number;
    /** Non-software titles dropped before the (paid) classify step. */
    filtered: number;
    enriched: number;
    /** Postings skipped because enrichment threw (bad model output, API error). */
    failed: number;
  };
  /** First few failures, for the operator to eyeball. */
  failures: string[];
}

/** How many failure messages to keep — enough to spot a pattern, not a flood. */
const MAX_REPORTED_FAILURES = 5;

export interface EnrichBatchOptions {
  /**
   * Called with completed rows every `batchSize` postings, so a long run
   * persists as it goes. Rows handed over are cleared from the result.
   */
  onBatch?: (rows: NewJob[]) => Promise<void>;
  batchSize?: number;
  /** Postings classified in parallel. Keep modest — these are paid API calls. */
  concurrency?: number;
  /**
   * Skip postings published more than this many days ago. Applied HERE, next to
   * the title filter, because this is the one place every caller passes through:
   * the cap planner's predicate only shapes its output when the cap is actually
   * exceeded, so a guard living only there does nothing in the ordinary case of
   * a fetch that fits. Undated postings are kept.
   */
  maxPostedAgeDays?: number;
}

/**
 * Parallel classify calls. Well inside OpenAI's per-minute limits for the small
 * models used here, while cutting a multi-hour backfill to well under one.
 */
const DEFAULT_CONCURRENCY = 8;

/**
 * Dedup a batch, drop postings already in `jobs` and non-software titles, then
 * enrich the rest.
 *
 * ONE BAD POSTING MUST NOT SINK THE RUN. A model that answers with a role
 * family outside the enum used to throw straight out of here, and because rows
 * were only inserted after the whole loop, a single malformed response threw
 * away every posting classified before it — on a 9,000-posting backfill that is
 * hours of paid work. Failures are now counted and skipped, and `onBatch` lets
 * the caller persist progressively.
 *
 * Postings are classified `concurrency` at a time. Strictly sequential was
 * measured at 0.56 postings/sec, which is 4.6 hours for a 9,200-posting
 * backfill — almost all of it waiting on the network.
 */
export async function enrichPostings(
  postings: RawPosting[],
  existingFingerprints: ReadonlySet<string>,
  deps: EnrichDeps,
  opts: EnrichBatchOptions = {},
): Promise<EnrichResult> {
  const deduped = dedupPostings(postings);
  const fresh = deduped.filter((p) => !existingFingerprints.has(p.fingerprint));
  // Drop obviously-non-software titles and stale postings BEFORE the paid
  // classify/embed loop, so a sales posting or a nine-month-old listing never
  // costs an LLM call. ATS feeds return their whole back catalogue every fetch.
  const swe = fresh.filter(
    (p) => looksLikeSwe(p.title) && isRecentEnough(p.postedAt, opts.maxPostedAgeDays),
  );

  const batchSize = opts.batchSize ?? 0;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  let rows: NewJob[] = [];
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < swe.length; i += concurrency) {
    const slice = swe.slice(i, i + concurrency);
    // Settled, not all: one rejection must not discard its siblings' results.
    const settled = await Promise.allSettled(slice.map((p) => enrichPosting(p, deps)));

    for (const [j, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled') {
        rows.push(outcome.value);
        continue;
      }
      failed++;
      if (failures.length < MAX_REPORTED_FAILURES) {
        const p = slice[j];
        failures.push(`${p.company} — ${p.title}: ${(outcome.reason as Error).message}`);
      }
    }

    if (opts.onBatch && batchSize > 0 && rows.length >= batchSize) {
      await opts.onBatch(rows);
      rows = [];
    }
  }

  return {
    rows,
    stats: {
      fetched: postings.length,
      deduped: deduped.length,
      filtered: fresh.length - swe.length,
      enriched: swe.length - failed,
      failed,
    },
    failures,
  };
}
