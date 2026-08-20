/**
 * Which of a job's keywords the candidate can honestly speak to.
 *
 * Used by the outreach drafter for its "relevant strengths" line. This used to
 * be pulled out of the fit scorer as `[...matched, ...missingAddable]` — a
 * percentage engine invoked for two of its side-outputs. Fit scoring is gone,
 * and what outreach actually wanted was always just this intersection.
 *
 * Truthful by construction: a keyword only appears if it is on the résumé or in
 * the master skill list, so a draft can never claim something unsupported.
 */

/** Job keywords covered by the résumé or the user's wider skill set, in job order. */
export function coverableStrengths(
  jobKeywords: string[],
  resumeSkills: string[],
  masterSkills: string[],
): string[] {
  const have = new Set([...resumeSkills, ...masterSkills].map((s) => s.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of jobKeywords) {
    const n = keyword.trim().toLowerCase();
    if (!n || seen.has(n) || !have.has(n)) continue;
    seen.add(n);
    out.push(keyword);
  }
  return out;
}
