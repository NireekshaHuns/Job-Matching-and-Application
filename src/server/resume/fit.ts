/**
 * Keyword-overlap fit scoring — the interpretable "rank vs resume" signal.
 * Pure: given a job's keywords, the skills a base resume already shows, and the
 * user's master skills, it reports coverage and gaps. Stays entirely separate
 * from the H1B sponsor tier (two-score rule).
 */
import type { RoleFamily } from '@/server/enrich/types';

export interface FitInput {
  /** Job's technical + soft keywords (already lowercased upstream). */
  jobKeywords: string[];
  /** Skills the base resume already surfaces (from its bullet bank). */
  resumeSkills: string[];
  /** The user's truthful master skills superset. */
  masterSkills: string[];
}

export interface FitResult {
  /** As-is coverage of jobKeywords by the resume, 0–100. */
  relevanceScore: number;
  /** Coverage reachable after truthful tailoring (resume ∪ master), 0–100. */
  achievableScore: number;
  matched: string[];
  /** Job keywords not yet on the resume (the tailoring worklist). */
  missing: string[];
  /** Missing keywords the user HAS (tailor them in). */
  missingAddable: string[];
  /** Missing keywords the user lacks (honest gaps — never faked). */
  missingGap: string[];
}

function toSet(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const n = v.trim().toLowerCase();
    if (n) out.add(n);
  }
  return out;
}

export function computeFit({ jobKeywords, resumeSkills, masterSkills }: FitInput): FitResult {
  const job = [...toSet(jobKeywords)];

  // No extracted keywords = no signal. Score 0 (not 100) so failed/sparse
  // extractions don't float to the top of a relevance-sorted board.
  if (job.length === 0) {
    return {
      relevanceScore: 0,
      achievableScore: 0,
      matched: [],
      missing: [],
      missingAddable: [],
      missingGap: [],
    };
  }

  const resumeSet = toSet(resumeSkills);
  const masterSet = toSet(masterSkills);

  const matched = job.filter((k) => resumeSet.has(k));
  const missing = job.filter((k) => !resumeSet.has(k));
  const missingAddable = missing.filter((k) => masterSet.has(k));
  const missingGap = missing.filter((k) => !masterSet.has(k));

  const pct = (n: number) => Math.round((n / job.length) * 100);

  return {
    relevanceScore: pct(matched.length),
    achievableScore: pct(matched.length + missingAddable.length),
    matched,
    missing,
    missingAddable,
    missingGap,
  };
}

export interface BulletLike {
  skills: string[];
  roleFamily: RoleFamily | null;
}

/**
 * True when a bullet is usable by a résumé of the given role family: role-
 * agnostic bullets (roleFamily=null) always count, and a generalist résumé
 * (roleFamily=null) sees ALL bullets. Shared so callers can't drift.
 */
export function bulletMatchesRole(
  bulletRole: RoleFamily | null,
  resumeRole: RoleFamily | null,
): boolean {
  return resumeRole === null || bulletRole === null || bulletRole === resumeRole;
}

/**
 * The skills a base resume can present = union of bullet-bank skills whose
 * role_family matches the resume's (see `bulletMatchesRole`).
 */
export function resumeSkillsFromBullets(
  bullets: BulletLike[],
  roleFamily: RoleFamily | null,
): string[] {
  const out = new Set<string>();
  for (const b of bullets) {
    if (bulletMatchesRole(b.roleFamily, roleFamily)) {
      for (const s of b.skills) {
        const n = s.trim().toLowerCase();
        if (n) out.add(n);
      }
    }
  }
  return [...out];
}
