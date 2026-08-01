/**
 * Deterministic software-role title filter, applied BEFORE the paid LLM classify
 * step so obviously-non-software postings never cost an OpenAI call (connectors
 * fetch every open role at a company — sales, ops, technicians, nurses — not just
 * engineering). Pure + unit-tested, mirroring `staffing.ts`.
 *
 * Design: lenient toward software. It DROPS only clear non-software roles and
 * non-software *engineering* disciplines (mechanical/optical/civil/…); it KEEPS
 * anything with a software signal AND generic "engineer/engineering" (which, at
 * the seeded tech companies, is overwhelmingly SWE). Coarse by intent — the LLM
 * classify step still assigns the precise role_family to whatever passes, and the
 * board can filter further. Title-only (JD text is often empty at fetch time).
 *
 * This is a title heuristic, the very thing CLAUDE.md's "filter by classification,
 * not brittle title matching" cautions against — kept deliberately lenient so the
 * broad net holds; tune the arrays if real SWE roles get dropped.
 */

/** Clear non-software signals — if any matches, drop the posting. */
const NON_SWE_PATTERNS: RegExp[] = [
  // Non-software engineering disciplines (still say "engineer", but not SWE).
  /\b(?:mechanical|electrical|electronics?|optical|civil|chemical|industrial|biomedical|aerospace|structural|materials|mining|petroleum|environmental|geotechnical|hardware|analog|\brf\b|sales|field)\s+engineer/i,
  // Clearly non-engineering roles.
  /\b(?:technician|nurse|physician|therapist|pharmacist|accountant|bookkeeper|auditor|recruiter|coordinator|receptionist|paralegal|attorney|barista|cashier|driver|welder|electrician|plumber|machinist|attendee|teacher|tutor|professor|counselor|clerk|writer|copywriter|editor|photographer|videographer)\b/i,
  /\b(?:sales|marketing|account executive|account manager|business development|customer success)\b/i,
  /\b(?:product|program|project)\s+manager\b/i,
  /\bscrum master\b/i,
  /\bgraphic designer\b/i,
];

/** Positive software signals — if any matches (and nothing above did), keep it. */
const SWE_POSITIVE_PATTERNS: RegExp[] = [
  /\bsoftware\b/i,
  /\b(?:developer|programmer)\b/i,
  /\b(?:swe|sde|sdet|fde|fse)\b/i,
  /\bfull[\s-]?stack\b/i,
  /\b(?:front|back)[\s-]?end\b/i,
  /\bdev\s?ops\b/i,
  /\bsite reliability\b|\bsre\b/i,
  /\b(?:platform|infrastructure|data|security|systems?|cloud|backend|frontend|reliability|network|distributed[\s-]systems?)\s+engineer/i,
  /\b(?:machine learning|deep learning|artificial intelligence|computer vision|\bnlp\b)\b/i,
  /\bml\s+engineer\b|\bai\s+engineer\b/i,
  /\b(?:embedded|firmware)\b/i,
  /\b(?:ios|android|mobile)\s+(?:engineer|developer)\b/i,
  /\bdata scientist\b|\bapplied scientist\b|\bresearch engineer\b/i,
  /\bmember of technical staff\b|\bmts\b/i,
  /\bblockchain\b|\bgameplay\b|\bqa\s+engineer\b|\btest engineer\b/i,
  // Language / framework named engineering roles.
  /\b(?:java|python|golang|rust|ruby|scala|kotlin|typescript|javascript|node(?:\.?js)?|react|angular|\.net|php|c\+\+|c#)\b[^.]{0,20}\b(?:engineer|developer)\b/i,
];

/** Bare "engineer/engineering" — kept only after the non-software checks above. */
const GENERIC_ENGINEER = /\bengineer(?:ing)?\b/i;

/**
 * True if the title looks like a software-engineering role. Lenient: keeps
 * software-positive titles and generic "engineer" (minus non-software
 * disciplines); drops clear non-software roles and everything else.
 */
export function looksLikeSwe(title: string | null | undefined): boolean {
  if (!title) return false;
  if (NON_SWE_PATTERNS.some((re) => re.test(title))) return false;
  if (SWE_POSITIVE_PATTERNS.some((re) => re.test(title))) return true;
  return GENERIC_ENGINEER.test(title);
}
