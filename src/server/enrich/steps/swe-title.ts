/**
 * Deterministic software-role title filter, applied BEFORE the paid LLM classify
 * step so obviously-non-software postings never cost an OpenAI call (connectors
 * fetch every open role at a company — sales, ops, technicians, nurses — not just
 * engineering). Pure + unit-tested, mirroring `staffing.ts`.
 *
 * Design: lenient toward software. A software signal wins FIRST (so a compound
 * title like "Embedded Hardware Engineer" or "Software Sales Engineer" is kept,
 * not dropped by the denylist); otherwise clear non-software roles and
 * non-software *engineering* disciplines (mechanical/optical/civil/…) are dropped;
 * a bare "engineer/engineering" is kept (at the seeded tech companies it's
 * overwhelmingly SWE). Coarse by intent — the LLM classify step still assigns the
 * precise role_family to whatever passes. Title-only (JD text is often empty at
 * fetch time).
 *
 * The positive list also covers SOFTWARE-ADJACENT roles whose titles never say
 * "engineer" — technical product/program manager, solutions architect, solutions
 * engineer, developer advocate, systems analyst, tech lead. These are jobs a
 * software engineer applies to, and several were being dropped by blanket rules
 * (any "product manager" was denied, which took "Technical Product Manager" with
 * it). An unqualified "Product Manager" stays denied: without a technical
 * qualifier it is usually a business role.
 *
 * A false-drop here is unrecoverable (the job never reaches the DB), so the filter
 * leans lenient — in the spirit of the project's "broad net over SWE titles, then
 * filter by classification" approach. Tune the arrays if real SWE roles get dropped.
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
  // Named-language roles are already covered by "developer" / generic "engineer";
  // "golang" is the one language token that isn't a common English word on its own.
  /\bgolang\b/i,

  // --- Software-adjacent roles ------------------------------------------------
  // Deliberately broad: these are jobs a software engineer applies to, even
  // though the title never says "engineer". Listed as POSITIVES so they beat the
  // non-software denylist below — a "Technical Product Manager" would otherwise
  // be dropped by the blanket `product manager` rule.

  // Technical PM/TPM. A qualifier is required on purpose: an unqualified
  // "Product Manager" is usually a business role and stays denied.
  /\b(?:technical|tech|platform|engineering|developer|api|infrastructure|data|cloud|ml|ai|security)\s+(?:product|program|project)\s+manager\b/i,
  /\btpm\b/i,
  // "Product Manager, Developer Tools" — qualifier trailing rather than leading.
  /\b(?:product|program)\s+manager\b[\s,–—-]*(?:developer|platform|infrastructure|api|data|cloud|ml\b|ai\b|security|engineering|technical)/i,

  // Architects and technical leadership.
  /\b(?:solutions?|cloud|technical|enterprise|systems?|security|data)\s+architect\b/i,
  /\b(?:tech|technical|engineering)\s+lead\b/i,
  /\b(?:engineering|software)\s+(?:manager|director|lead)\b/i,
  /\bdirector\s+of\s+engineering\b/i,

  // Technical individual contributors whose titles avoid "engineer".
  /\bsolutions?\s+(?:engineer|consultant|developer)\b/i,
  /\bforward[\s-]?deployed\b/i,
  /\b(?:systems?|technical|business systems|data|security)\s+analyst\b/i,
  /\b(?:ml|mlops|dataops|devrel)\b/i,
  /\bdeveloper\s+(?:advocate|relations|experience)\b/i,
  /\b(?:database|system)s?\s+administrator\b|\bsysadmin\b|\bdba\b/i,
  /\bresearch\s+scientist\b/i,
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
  // Software signal wins first, so a compound title with both a software term and
  // a disqualifier (e.g. "Software Sales Engineer") is kept, not dropped.
  if (SWE_POSITIVE_PATTERNS.some((re) => re.test(title))) return true;
  if (NON_SWE_PATTERNS.some((re) => re.test(title))) return false;
  return GENERIC_ENGINEER.test(title);
}
