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
 * Normalize a job title for dedup. Strips noise that varies across sources for
 * the SAME role — parenthetical/bracketed asides, requisition ids (e.g. "R12345",
 * "#4567", "JR-88"), and 4-digit years — then normalizes. Deliberately keeps
 * role/discipline and seniority words, so distinct roles never collapse.
 */
export function normalizeTitle(title: string | null | undefined): string {
  const stripped = (title ?? '')
    .replace(/[([{].*?[)\]}]/g, ' ') // parenthetical/bracketed asides
    .replace(/\b(?:jr|req)[-\s#]?\d+\b/gi, ' ') // req ids like JR-88 / REQ 123
    .replace(/#\s*\d+/g, ' ') // "#4567"
    .replace(/\br\d{3,}\b/gi, ' ') // greenhouse-style "R12345"
    .replace(/\b(?:19|20)\d{2}\b/g, ' '); // 4-digit years
  return normalizeText(stripped);
}

/** Remote / nationwide location variants that mean the same thing for dedup. */
const REMOTE_LOCATION_RE =
  /\b(remote|anywhere|distributed|work\s?from\s?home|wfh|united states|usa?|u\.s\.?a?\.?|nationwide)\b/i;

/**
 * Normalize a location for dedup. Collapses the many "remote / US-nationwide"
 * spellings ("Remote", "Remote - US", "United States", "Anywhere") to a single
 * `remote` token so the same remote role dedups across sources; otherwise keeps
 * the normalized city text so genuinely different locations stay separate.
 */
export function normalizeLocation(location: string | null | undefined): string {
  const text = normalizeText(location);
  if (text === '') return '';
  return REMOTE_LOCATION_RE.test(location ?? '') ? 'remote' : text;
}

/**
 * Build the dedup fingerprint from company + title + location, each normalized
 * so the same job from two sources (different company spelling, title noise, or
 * remote-location wording) collapses to one row.
 */
export function postingFingerprint(
  company: string,
  title: string,
  location: string | null,
): string {
  return [normalizeCompanyName(company), normalizeTitle(title), normalizeLocation(location)].join(
    '|',
  );
}
