/**
 * Tailoring assist (spec §5.7) — suggestions only, never fabrication. Given a
 * job's keywords and the user's truthful inventory (master skills + real bullet
 * bank), report the keyword-gap and, for each JD keyword the user HAS but the
 * résumé doesn't yet surface, the real bullets that demonstrate it (to weave in).
 *
 * Pure and deterministic — reuses `computeFit` + `resumeSkillsFromBullets`, so
 * the same truthfulness bounds as the CLI tailoring apply here: a skill outside
 * the master inventory is shown as an honest gap, never suggested.
 */
import type { RoleFamily } from '@/server/enrich/types';
import { computeFit, resumeSkillsFromBullets } from './fit';

export interface TailoringBullet {
  id: number;
  text: string;
  company: string | null;
}

/** A JD keyword the user can truthfully add, with the real bullets that back it. */
export interface AddableSuggestion {
  keyword: string;
  bullets: TailoringBullet[];
}

export interface TailoringSuggestions {
  /** As-is coverage of the JD by the résumé, 0–100. */
  relevanceScore: number;
  /** Coverage reachable after truthful tailoring (résumé ∪ inventory), 0–100. */
  achievableScore: number;
  /** JD keywords the résumé already surfaces. */
  matched: string[];
  /** Missing-but-truthful keywords + the real bullets to weave them in. */
  addable: AddableSuggestion[];
  /** Missing keywords the user lacks (honest gaps — never faked). */
  gaps: string[];
}

export interface SuggestionBullet {
  id: number;
  text: string;
  company: string | null;
  skills: string[];
  roleFamily: RoleFamily | null;
}

export interface SuggestionInput {
  jobKeywords: string[];
  /** The selected base résumé's role family (null = generalist, sees all bullets). */
  resumeRoleFamily: RoleFamily | null;
  masterSkills: string[];
  bullets: SuggestionBullet[];
}

/** True when a bullet is usable by a résumé of the given role family. */
function bulletMatchesRole(bulletRole: RoleFamily | null, resumeRole: RoleFamily | null): boolean {
  return resumeRole === null || bulletRole === null || bulletRole === resumeRole;
}

export function buildTailoringSuggestions(input: SuggestionInput): TailoringSuggestions {
  const resumeSkills = resumeSkillsFromBullets(input.bullets, input.resumeRoleFamily);
  const fit = computeFit({
    jobKeywords: input.jobKeywords,
    resumeSkills,
    masterSkills: input.masterSkills,
  });

  const addable: AddableSuggestion[] = fit.missingAddable.map((keyword) => {
    const bullets = input.bullets
      .filter(
        (b) =>
          bulletMatchesRole(b.roleFamily, input.resumeRoleFamily) &&
          b.skills.some((s) => s.trim().toLowerCase() === keyword),
      )
      .map((b) => ({ id: b.id, text: b.text, company: b.company }));
    return { keyword, bullets };
  });

  return {
    relevanceScore: fit.relevanceScore,
    achievableScore: fit.achievableScore,
    matched: fit.matched,
    addable,
    gaps: fit.missingGap,
  };
}
