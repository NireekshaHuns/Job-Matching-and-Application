import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import { masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import type { Inventory } from './inventory';
import { loadInventory } from './inventory-load';

interface Stmt {
  op: 'delete' | 'insert';
  table: unknown;
  where?: unknown;
  values?: unknown[];
}

/** Fake db capturing the statements passed to a single db.batch() call. */
function makeFakeDb() {
  let batched: Stmt[] = [];
  const db = {
    delete(table: unknown) {
      const stmt: Stmt = { op: 'delete', table };
      return Object.assign(stmt, {
        where(w: unknown) {
          stmt.where = w;
          return stmt;
        },
      });
    },
    insert(table: unknown) {
      return {
        values(values: unknown[]) {
          return { op: 'insert', table, values } satisfies Stmt;
        },
      };
    },
    batch(stmts: Stmt[]) {
      batched = stmts;
      return Promise.resolve([]);
    },
  };
  return {
    db: db as unknown as DB,
    get batched() {
      return batched;
    },
  };
}

const fullInventory: Inventory = {
  skills: [{ skill: 'go', kind: 'technical' }],
  bullets: [
    { text: 'Shipped a Go service.', skills: ['go'], roleFamily: 'backend', company: null },
  ],
  baseResumes: [{ label: 'Backend', roleFamily: 'backend', content: 'x' }],
};

describe('loadInventory', () => {
  it('runs all deletes and inserts in a single atomic batch', async () => {
    const fake = makeFakeDb();
    const counts = await loadInventory(fake.db, fullInventory);

    // 3 deletes + 3 inserts, all in one batch.
    expect(fake.batched).toHaveLength(6);
    const deletes = fake.batched.filter((s) => s.op === 'delete');
    expect(deletes.map((d) => d.table)).toEqual([masterSkills, resumeBullets, resumes]);
    // Only base resumes are deleted (tailored ones survive).
    const resumeDelete = deletes.find((d) => d.table === resumes);
    expect(resumeDelete?.where).toBeTruthy();

    expect(counts).toEqual({ skills: 1, bullets: 1, baseResumes: 1 });
  });

  it('skips insert statements for empty sections', async () => {
    const fake = makeFakeDb();
    const counts = await loadInventory(fake.db, { skills: [], bullets: [], baseResumes: [] });
    // Only the 3 deletes, no inserts.
    expect(fake.batched).toHaveLength(3);
    expect(fake.batched.every((s) => s.op === 'delete')).toBe(true);
    expect(counts).toEqual({ skills: 0, bullets: 0, baseResumes: 0 });
  });
});
