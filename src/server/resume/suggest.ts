/**
 * Suggest inventory skills to add: the union of the broad skill catalog and the
 * keywords seen across the user's target jobs, minus what's already in their
 * inventory. Pure — the user prunes the result to what they've truly done.
 */
import type { InventorySkill } from './inventory';

export interface SuggestInput {
  catalog: InventorySkill[];
  /** Technical keywords aggregated from target jobs. */
  jobTechKeywords: string[];
  /** Soft keywords aggregated from target jobs. */
  jobSoftKeywords: string[];
  /** Skills already in the user's inventory (won't be re-suggested). */
  existing: string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Build the de-duplicated candidate list. Catalog entries seed the kind;
 * job keywords add anything the catalog missed (soft vs technical by source).
 * Existing skills are excluded. Sorted: technical first, then alphabetical.
 */
export function suggestSkills(input: SuggestInput): InventorySkill[] {
  const existing = new Set(input.existing.map(norm));
  const chosen = new Map<string, InventorySkill['kind']>();

  const consider = (skill: string, kind: InventorySkill['kind']) => {
    const key = norm(skill);
    if (!key || existing.has(key) || chosen.has(key)) return;
    chosen.set(key, kind);
  };

  for (const c of input.catalog) consider(c.skill, c.kind);
  for (const k of input.jobTechKeywords) consider(k, 'technical');
  for (const k of input.jobSoftKeywords) consider(k, 'soft');

  return [...chosen.entries()]
    .map(([skill, kind]) => ({ skill, kind }))
    .sort((a, b) =>
      a.kind === b.kind ? a.skill.localeCompare(b.skill) : a.kind === 'technical' ? -1 : 1,
    );
}
