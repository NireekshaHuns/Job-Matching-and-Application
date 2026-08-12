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
  rows: NewJob[];
  /** `filtered` = non-software titles dropped before the (paid) classify step. */
  stats: { fetched: number; deduped: number; filtered: number; enriched: number };
}

/**
 * Dedup a batch, drop postings already in `jobs` and non-software titles, then
 * enrich the rest. Runs sequentially to stay gentle on LLM rate limits.
 */
export async function enrichPostings(
  postings: RawPosting[],
  existingFingerprints: ReadonlySet<string>,
  deps: EnrichDeps,
): Promise<EnrichResult> {
  const deduped = dedupPostings(postings);
  const fresh = deduped.filter((p) => !existingFingerprints.has(p.fingerprint));
  // Drop obviously-non-software titles BEFORE the paid classify/embed loop, so a
  // sales/technician/ops posting never costs an LLM call.
  const swe = fresh.filter((p) => looksLikeSwe(p.title));

  const rows: NewJob[] = [];
  for (const posting of swe) {
    rows.push(await enrichPosting(posting, deps));
  }

  return {
    rows,
    stats: {
      fetched: postings.length,
      deduped: deduped.length,
      filtered: fresh.length - swe.length,
      enriched: swe.length,
    },
  };
}
