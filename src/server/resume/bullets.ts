/**
 * Which of the user's real bullets a résumé may draw on.
 *
 * Its own module because it outlived what it was written for. It began inside
 * the fit-scoring code, but the Studio's retrieval (`retrieve.ts`) and the
 * outreach drafter both depend on it, and fit scoring does not exist any more.
 */
import type { RoleFamily } from '@/server/enrich/types';

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
 * The skills a résumé can present = union of bullet-bank skills whose
 * role_family matches the résumé's (see `bulletMatchesRole`).
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
