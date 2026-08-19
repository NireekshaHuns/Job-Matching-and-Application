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
 * A false-drop here is unrecoverable (the job never reaches the DB), so the filter
 * leans lenient — in the spirit of the project's "broad net over SWE titles, then
 * filter by classification" approach. Tune the arrays if real SWE roles get dropped.
 */

/**
 * Compounds that are never software however they read otherwise. Checked BEFORE
 * the positive signals, which is the one place that ordering is needed: without
 * it, widening "architect" to catch "Solution Architect" would also rescue
 * "Landscape Architect".
 */
const NEVER_SWE_PATTERNS: RegExp[] = [
  /\b(?:landscape|naval|interior|marine)\s+architect\b/i,
  /\bdata\s+entry\b/i,
];

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

  // --- Titles that are software work without ever saying "software" ---
  //
  // Measured against a live fetch of six enterprise Workday boards, 270 of 1,373
  // titles were being dropped. Most were correctly dropped (account executives,
  // customer success, channel sales), but the ones below were real software
  // roles at exactly the large H1B sponsors this board exists to surface — and a
  // drop here is unrecoverable, since the posting never reaches the DB.

  // "Solution Architect", "Data Architect", "API Technical Lead". A bare
  // "architect" is allowed because NEVER_SWE_PATTERNS above holds the
  // non-software ones.
  /\barchitect(?:ure)?\b/i,
  // "Application Development / Maintenance", "Java Development Associate".
  /\b(?:software|application|applications|platform|api|web|mobile|cloud|systems?|technology|product)\s+development\b/i,
  // "Systems Analyst", "Technology Analyst" — but not "Private Equity Analyst".
  /\b(?:systems?|technology|technical|applications?|data|software|it|security|qa|quality|integration)\s+analyst\b/i,
  // "Quality Assurance, Officer".
  /\bquality\s+assurance\b/i,
  // "API Technical Lead", "Technology Consultant".
  /\btech(?:nical|nology)?\s+(?:lead|consultant|specialist|architect)\b/i,
  /\b(?:database|data)\s+(?:administrator|architect)\b/i,
  /\bci\s?\/?\s?cd\b|\bkubernetes\b|\bterraform\b/i,
  // A named language or runtime in a title is a software role whatever the noun.
  /\b(?:java|python|javascript|typescript|dot\s?net|\.net|c\+\+|ruby|scala|kotlin|swift|rust|php|react|angular|node\.?js|spring boot)\b/i,
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
  // Checked ahead of everything: these compounds must not be rescued by a
  // positive signal the way "Software Sales Engineer" deliberately is.
  if (NEVER_SWE_PATTERNS.some((re) => re.test(title))) return false;
  // Software signal wins next, so a compound title with both a software term and
  // a disqualifier (e.g. "Software Sales Engineer") is kept, not dropped.
  if (SWE_POSITIVE_PATTERNS.some((re) => re.test(title))) return true;
  if (NON_SWE_PATTERNS.some((re) => re.test(title))) return false;
  return GENERIC_ENGINEER.test(title);
}
