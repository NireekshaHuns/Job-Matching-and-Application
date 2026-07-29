/**
 * Load a parsed inventory into the DB with REPLACE semantics: the file is the
 * source of truth, so master skills, the bullet bank, and base resumes are
 * cleared and rewritten to match it. Tailored resumes (kind='tailored') are
 * left untouched. `db` is injected (type-only `DB` import).
 *
 * Atomicity: neon-http has no `transaction()`, so we run every delete/insert in
 * a single `db.batch([...])` — all-or-nothing, so a failed insert can never
 * leave the "truthful data layer" wiped or half-populated.
 *
 * Note: `job_scores.resume_id` cascades on delete, so reloading discards any
 * fit scores computed against the old base resumes. That's fine — those scores
 * are stale once the base resumes change. Run `inventory:load` before scoring.
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

type BatchStatements = Parameters<DB['batch']>[0];
type BatchStatement = BatchStatements[number];

export async function loadInventory(db: DB, inventory: Inventory): Promise<LoadCounts> {
  const statements: BatchStatement[] = [
    db.delete(masterSkills),
    db.delete(resumeBullets),
    db.delete(resumes).where(eq(resumes.kind, 'base')),
  ];

  if (inventory.skills.length > 0) {
    statements.push(db.insert(masterSkills).values(inventory.skills));
  }
  if (inventory.bullets.length > 0) {
    statements.push(db.insert(resumeBullets).values(inventory.bullets));
  }
  if (inventory.baseResumes.length > 0) {
    statements.push(
      db.insert(resumes).values(
        inventory.baseResumes.map((r) => ({
          label: r.label,
          kind: 'base' as const,
          roleFamily: r.roleFamily,
          content: r.content,
        })),
      ),
    );
  }

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  return {
    skills: inventory.skills.length,
    bullets: inventory.bullets.length,
    baseResumes: inventory.baseResumes.length,
  };
}
