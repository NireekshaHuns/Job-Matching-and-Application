/**
 * Employer-name normalization — produces the join key used to match a job's
 * `company` against `sponsors.company_name_normalized`.
 *
 * Postings and government data spell the same employer many ways
 * ("Google", "Google, Inc.", "GOOGLE LLC"), so both sides are run through
 * this before comparison. Kept deliberately simple and deterministic; fuzzy
 * matching (for near-misses) is a later concern handled at ingestion time.
 */

/**
 * Legal-form tokens stripped only from the END of a name (iteratively), so we
 * never clip a real word mid-name (e.g. "CO" in "CISCO" is a substring, not a
 * trailing token, and "US" in "US FOODS" is not trailing).
 */
const TRAILING_SUFFIXES = new Set([
  'INC',
  'INCORPORATED',
  'LLC',
  'LLP',
  'LP',
  'PLLC',
  'LTD',
  'LIMITED',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'PLC',
  'GMBH',
  'SA',
  'AG',
  'NV',
  'BV',
  'USA',
]);

/** Combining diacritical marks, matched via escape so the source stays ASCII. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Normalize a raw company name to its canonical join key. Returns an empty
 * string for empty/nullish input.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return '';

  // Fold diacritics so "Nestlé" and "Nestle" share a key.
  let s = raw.normalize('NFKD').replace(COMBINING_MARKS, '').toUpperCase();

  // Drop trailing "doing business as" / "formerly known as" clauses.
  s = s.replace(/\b(DBA|FKA|AKA|D\/B\/A|F\/K\/A)\b.*$/g, ' ');

  // "&" reads as "AND" across sources.
  s = s.replace(/&/g, ' AND ');

  // Everything else non-alphanumeric becomes a separator.
  s = s.replace(/[^A-Z0-9\s]/g, ' ');

  let tokens = s.split(/\s+/).filter(Boolean);

  // Leading article is noise ("The Home Depot" -> "Home Depot").
  if (tokens[0] === 'THE') tokens = tokens.slice(1);

  // Strip trailing legal suffixes, but never reduce a name to nothing.
  while (tokens.length > 1 && TRAILING_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }

  return tokens.join(' ');
}

/** True when two raw company names normalize to the same non-empty key. */
export function companyKeysMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normalizeCompanyName(a);
  const kb = normalizeCompanyName(b);
  return ka !== '' && ka === kb;
}
