/**
 * Dedup postings by fingerprint within a batch. The same job pulled from two
 * connectors collapses to the first occurrence. Cross-run dedup (against jobs
 * already in the DB) happens in the orchestrator.
 */
import type { RawPosting } from '@/server/ingest/types';

export function dedupPostings(postings: RawPosting[]): RawPosting[] {
  const seen = new Set<string>();
  const out: RawPosting[] = [];
  for (const posting of postings) {
    if (seen.has(posting.fingerprint)) continue;
    seen.add(posting.fingerprint);
    out.push(posting);
  }
  return out;
}
