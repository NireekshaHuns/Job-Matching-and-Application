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

/**
 * Job keywords covered by the résumé or the user's wider skill set.
 *
 * RÉSUMÉ-BACKED KEYWORDS COME FIRST, then inventory-only ones, each group in job
 * order. The grouping is load-bearing rather than cosmetic: callers truncate
 * this list — the drafter takes 6 and the email body takes 4 — so a flat pass in
 * job order can push the one skill the résumé actually demonstrates off the end
 * and lead with the weaker evidence instead.
 */
export function coverableStrengths(
  jobKeywords: string[],
  resumeSkills: string[],
  masterSkills: string[],
): string[] {
  const onResume = new Set(resumeSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const known = new Set(masterSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));

  const evidenced: string[] = [];
  const claimable: string[] = [];
  const seen = new Set<string>();

  for (const keyword of jobKeywords) {
    const n = keyword.trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (onResume.has(n)) evidenced.push(keyword);
    else if (known.has(n)) claimable.push(keyword);
  }
  return [...evidenced, ...claimable];
}
