/**
 * Derive whether a posting is US-based from its free-text location. Pure and
 * deterministic (no DB, no LLM). Returns:
 *   - true  — a confident US signal (US marker, state, or major metro)
 *   - false — a confident non-US signal (known country / city / region)
 *   - null  — unknown / ambiguous
 *
 * US wins when both appear (e.g. "US or Canada" → true): the role IS open in the
 * US. Unknowns stay null and are shown by default — our sources are US-focused,
 * so we hide only what we can positively identify as non-US (high recall),
 * mirroring the app's "never discard the unknown" stance.
 */

/** Full US state names. */
const US_STATES = [
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
];

/** Major US metros that often appear without a state. */
const US_METROS = [
  'new york',
  'san francisco',
  'bay area',
  'silicon valley',
  'seattle',
  'austin',
  'boston',
  'chicago',
  'los angeles',
  'san jose',
  'sunnyvale',
  'mountain view',
  'palo alto',
  'menlo park',
  'cupertino',
  'san diego',
  'atlanta',
  'denver',
  'dallas',
  'houston',
  'washington dc',
  'bellevue',
  'redmond',
  'philadelphia',
  'pittsburgh',
  'portland',
  'phoenix',
  'columbus',
  'charlotte',
  'indianapolis',
  'san antonio',
  'jacksonville',
  'nashville',
  'miami',
  'minneapolis',
  'detroit',
  'sacramento',
  'raleigh',
  'kansas city',
  'salt lake city',
];

/** Explicit US markers (matched as substrings, dots/spaces tolerant). */
const US_MARKERS = ['united states', 'u.s.a', 'u.s.', 'usa', 'us-remote', 'us remote', 'remote us'];

/**
 * Two-letter state codes, only counted when comma-prefixed ("Austin, TX").
 * DELIBERATELY excludes state codes that are also ISO-3166 country codes
 * (CA/IN/IL/DE/GA/AL/AR/AZ/CO/ID/KY/LA/MA/MD/ME/MN/MO/MS/MT/NC/NE/PA/SC/SD/TN/VA),
 * so "Toronto, CA" / "Mumbai, IN" aren't mislabeled US — the non-US city name
 * wins for those. Cities using an ambiguous code fall through to `null` (shown),
 * which is safer than a false US positive.
 */
const SAFE_STATE_CODES = 'ak|ct|fl|hi|ia|ks|mi|nv|nh|nj|nm|ny|nd|oh|ok|or|ri|tx|ut|vt|wa|wv|wi|wy';
const STATE_CODE_RE = new RegExp(`,\\s*(?:${SAFE_STATE_CODES})\\b`, 'i');

/** Known non-US countries, cities, and regions. */
const NON_US = [
  // Canada
  'canada',
  'toronto',
  'vancouver',
  'montreal',
  'ottawa',
  'waterloo',
  'calgary',
  // UK / Ireland ('uk' short form included; 'manchester' also a US city but
  // rare in these feeds — a "Manchester, NH" style US code still wins via SAFE state codes)
  'united kingdom',
  'uk',
  'britain',
  'england',
  'scotland',
  'london',
  'manchester',
  'edinburgh',
  'ireland',
  'dublin',
  // India
  'india',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'pune',
  'mumbai',
  'delhi',
  'gurgaon',
  'gurugram',
  'noida',
  'chennai',
  'kolkata',
  // Europe
  'germany',
  'berlin',
  'munich',
  'france',
  'paris',
  'netherlands',
  'amsterdam',
  'spain',
  'madrid',
  'barcelona',
  'poland',
  'warsaw',
  'krakow',
  'romania',
  'portugal',
  'lisbon',
  'switzerland',
  'zurich',
  'sweden',
  'stockholm',
  // APAC / other
  'australia',
  'sydney',
  'melbourne',
  'singapore',
  'japan',
  'tokyo',
  'china',
  'beijing',
  'shanghai',
  'hong kong',
  'korea',
  'seoul',
  'brazil',
  'sao paulo',
  'mexico',
  'israel',
  'tel aviv',
  'dubai',
  'uae',
  'argentina',
  'buenos aires',
  'colombia',
  'bogota',
  'philippines',
  'manila',
  'vietnam',
  'indonesia',
  'jakarta',
  // Regions
  'emea',
  'apac',
  'latam',
];

/** Word-boundary presence for any term in a list. */
function matchesAny(haystack: string, terms: string[]): boolean {
  return terms.some((t) =>
    new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack),
  );
}

export function deriveIsUs(location: string | null | undefined): boolean | null {
  const loc = (location ?? '').trim().toLowerCase();
  if (!loc) return null;

  const usSignal =
    US_MARKERS.some((m) => loc.includes(m)) ||
    /\bus\b/i.test(loc) ||
    STATE_CODE_RE.test(loc) ||
    matchesAny(loc, US_STATES) ||
    matchesAny(loc, US_METROS);

  if (usSignal) return true; // US is on offer, even for multi-region roles.
  if (matchesAny(loc, NON_US)) return false;
  return null;
}
