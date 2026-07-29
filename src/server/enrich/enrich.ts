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
import { matchSponsor } from './steps/sponsor-match';
import type { ChatClient, Embedder, SponsorLookup } from './types';

export interface EnrichDeps {
  chat: ChatClient;
  embedder: Embedder;
  lookup: SponsorLookup;
}

/** Enrich a single posting into a clean `jobs` row. */
export async function enrichPosting(posting: RawPosting, deps: EnrichDeps): Promise<NewJob> {
  const sponsor = matchSponsor(posting.company, posting.jdText, deps.lookup);
  const classification = await classifyPosting(posting, deps.chat);
  const embedding = await embedJd(posting.jdText, deps.embedder);
  return buildJobRow(posting, sponsor, classification, embedding);
}

export interface EnrichResult {
  rows: NewJob[];
  stats: { fetched: number; deduped: number; enriched: number };
}

/**
 * Dedup a batch, drop postings already in `jobs`, and enrich the rest. Runs
 * sequentially to stay gentle on LLM rate limits.
 */
export async function enrichPostings(
  postings: RawPosting[],
  existingFingerprints: ReadonlySet<string>,
  deps: EnrichDeps,
): Promise<EnrichResult> {
  const deduped = dedupPostings(postings);
  const fresh = deduped.filter((p) => !existingFingerprints.has(p.fingerprint));

  const rows: NewJob[] = [];
  for (const posting of fresh) {
    rows.push(await enrichPosting(posting, deps));
  }

  return {
    rows,
    stats: {
      fetched: postings.length,
      deduped: deduped.length,
      enriched: fresh.length,
    },
  };
}
