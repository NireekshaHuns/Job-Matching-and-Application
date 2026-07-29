/**
 * Load a parsed inventory into the DB with REPLACE semantics: the file is the
 * source of truth, so master skills, the bullet bank, and base resumes are
 * cleared and rewritten to match it. Tailored resumes (kind='tailored') are
 * left untouched. `db` is injected (type-only `DB` import) so a script or the
 * app can drive it.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import type { Inventory } from './inventory';

export interface LoadCounts {
  skills: number;
  bullets: number;
  baseResumes: number;
}

export async function loadInventory(db: DB, inventory: Inventory): Promise<LoadCounts> {
  // Replace: clear the file-owned data (but keep generated tailored resumes).
  await db.delete(masterSkills);
  await db.delete(resumeBullets);
  await db.delete(resumes).where(eq(resumes.kind, 'base'));

  if (inventory.skills.length > 0) {
    await db.insert(masterSkills).values(inventory.skills);
  }
  if (inventory.bullets.length > 0) {
    await db.insert(resumeBullets).values(inventory.bullets);
  }
  if (inventory.baseResumes.length > 0) {
    await db.insert(resumes).values(
      inventory.baseResumes.map((r) => ({
        label: r.label,
        kind: 'base' as const,
        roleFamily: r.roleFamily,
        content: r.content,
      })),
    );
  }

  return {
    skills: inventory.skills.length,
    bullets: inventory.bullets.length,
    baseResumes: inventory.baseResumes.length,
  };
}
