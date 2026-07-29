/**
 * Dedup postings by fingerprint within a batch. The same job pulled from two
 * connectors collapses to the first occurrence. Cross-run dedup (against jobs
 * already in the DB) happens in the orchestrator.
 */
import type { RawPosting } from '@/server/ingest/types';

/**
 * "First occurrence" is deterministic: connectors are fetched in registry order
 * and concatenated, so earlier-registered sources (e.g. official ATS feeds) win
 * over later ones for a shared fingerprint.
 */
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
