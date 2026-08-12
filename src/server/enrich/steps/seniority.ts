/**
 * Deterministic seniority guard, applied over the LLM's classification. Pure —
 * no DB, no LLM.
 *
 * WHY THIS EXISTS
 * `seniority` has three values and no bucket for "the title states no level".
 * The classifier prompt said "everything senior/staff/lead/manager => other", so
 * an unlevelled "Software Engineer" had nowhere sensible to go and the model
 * frequently parked it in `other` — which the board hides by default. On
 * 2026-08-12 that was 1,324 of 2,540 rows, including plain "Software Engineer"
 * at Palo Alto Networks, HP and xAI sitting next to genuine "Sr. Staff Software
 * Engineer" postings.
 *
 * The rule here is one-directional and deliberately conservative: a title with
 * NO seniority signal cannot be graded `other`. A title that does carry one is
 * left exactly as the model classified it — the JD knows more than the title
 * does, and this must never *promote* a role to senior.
 */
import type { Seniority } from '../types';

/**
 * Level markers that justify `other`. Matched on word boundaries against the
 * title, so "Lead" in "Technical Lead" counts while "Leading" in "Leading Edge
 * Systems Engineer" does not.
 *
 * `manager`/`director`/`head of`/`vp` are here because the enum lumps people
 * management into `other` alongside senior ICs.
 *
 * Kept PRECISE rather than generous, because the two failure directions are not
 * symmetric: a false positive here leaves a job hidden — the exact bug this
 * module exists to fix — while a false negative merely surfaces one senior role
 * the owner can skip past. Vague signals ("expert", "experienced", a bare digit)
 * are left out for that reason.
 */
const SENIOR_PATTERNS: RegExp[] = [
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\bdistinguished\b/i,
  /\blead\b/i, // "Tech Lead", "Lead Engineer" — not "Leading"
  /\bleader\b/i,
  /\bmanager\b/i,
  /\bdirector\b/i,
  /\bhead\s+of\b/i,
  /\bvp\b|\bvice\s+president\b/i,
  /\bchief\b/i,
  /\barchitect\b/i,
  // Level suffixes: "Engineer III", "Engineer IV", "SWE L5". II / L2 are
  // deliberately absent — those are still early-career.
  /\b(?:iii|iv|vi{0,2})\b/i,
  /\bl[5-9]\b/i,
];

/** Does the title itself claim a senior/lead/management level? */
export function titleSignalsSenior(title: string | null | undefined): boolean {
  const text = (title ?? '').trim();
  if (!text) return false;
  return SENIOR_PATTERNS.some((re) => re.test(text));
}

/**
 * The classifier's seniority, corrected when the title contradicts it.
 *
 * Only ever *downgrades* `other` → `mid` for an unlevelled title. `entry` and
 * `mid` are returned untouched, and a title that does signal seniority keeps
 * whatever the model decided — including `entry`, since "New Grad Software
 * Engineer II" is genuinely entry-level despite the numeral.
 */
export function resolveSeniority(
  title: string | null | undefined,
  classified: Seniority,
): Seniority {
  if (classified !== 'other') return classified;
  return titleSignalsSenior(title) ? 'other' : 'mid';
}
