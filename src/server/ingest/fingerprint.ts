/**
 * Shared dedup fingerprint for postings. The same job pulled from two sources
 * must produce the same fingerprint so it collapses to one row. Reuses
 * `normalizeCompanyName` (the sponsor join key) for the company component.
 */
import { normalizeCompanyName } from '@/lib/sponsorship/normalize';

/** Lowercase, strip punctuation, collapse whitespace. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Build the dedup fingerprint from company + title + location. Company is run
 * through the shared normalizer so "Google, Inc." and "GOOGLE LLC" match.
 */
export function postingFingerprint(
  company: string,
  title: string,
  location: string | null,
): string {
  return [normalizeCompanyName(company), normalizeText(title), normalizeText(location)].join('|');
}
