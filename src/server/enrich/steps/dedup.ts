/**
 * Dedup postings by fingerprint within a batch. The same job pulled from two
 * connectors collapses to one entry. Cross-run dedup (against jobs already in
 * the DB) happens in the orchestrator.
 */
import type { RawPosting } from '@/server/ingest/types';

const hasJd = (p: RawPosting): boolean => (p.jdText ?? '').trim().length > 0;

/**
 * Collapse postings sharing a fingerprint. Order follows first occurrence
 * (connectors are concatenated in registry order, so official ATS feeds precede
 * aggregators). On a collision the JD-bearing posting wins even if it came
 * second, so the surviving row keeps the full description (e.g. a Greenhouse
 * posting beats a JD-less Simplify duplicate) — otherwise the earlier one stays.
 */
export function dedupPostings(postings: RawPosting[]): RawPosting[] {
  const indexByFingerprint = new Map<string, number>();
  const out: RawPosting[] = [];
  for (const posting of postings) {
    const existing = indexByFingerprint.get(posting.fingerprint);
    if (existing === undefined) {
      indexByFingerprint.set(posting.fingerprint, out.length);
      out.push(posting);
      continue;
    }
    if (!hasJd(out[existing]) && hasJd(posting)) out[existing] = posting;
  }
  return out;
}
