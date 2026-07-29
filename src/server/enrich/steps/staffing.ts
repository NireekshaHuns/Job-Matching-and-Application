/**
 * Deterministic staffing / body-shop detector (JD-text only). Consulting and
 * IT-staffing firms post roles that read like direct-hire but are really client
 * placements (corp-to-corp, W-2 contract, "our client"). The LLM classify step
 * catches most as "contract", but these JDs are worded to look full-time — so we
 * override to "contract" on high-precision *engagement* signals.
 *
 * IMPORTANT: this keys on the engagement, NOT the employer. Major body-shops
 * (Infosys, Cognizant, TCS, …) are among the heaviest H1B sponsors, so a genuine
 * direct-hire role at one must stay visible. We only drop the contract/staffing
 * engagement itself, per the employment-filter invariant. Pure + unit-tested.
 */

/** High-precision phrases that signal a staffing/body-shop placement. */
const STAFFING_PHRASES: RegExp[] = [
  /corp[\s-]?to[\s-]?corp/i,
  /\bc2c\b/i,
  /\b1099\b/i,
  /w-?2\s+contract/i,
  /third[\s-]?party\s+(?:candidates?|vendors?|agenc)/i,
  /our client (?:is )?(?:seeking|looking|hiring|needs|requires)/i,
  /on behalf of our client/i,
  /end[\s-]?client/i,
  /(?:staffing|consulting)\s+(?:agency|firm)/i,
];

/** True if the JD text shows a staffing/body-shop engagement (not an employer name). */
export function looksLikeStaffing(jdText: string | null | undefined): boolean {
  if (!jdText) return false;
  return STAFFING_PHRASES.some((re) => re.test(jdText));
}
