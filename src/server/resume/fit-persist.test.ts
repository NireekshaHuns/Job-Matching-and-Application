import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import { jobs, masterSkills, resumeBullets, resumes } from '@/server/db/schema';
import { scoreFits } from './fit-persist';

interface Upsert {
  values: Array<{ jobId: number; resumeId: number; relevanceScore: number; skillGaps: string[] }>;
  conflict: unknown;
}

/** Thenable that also supports .where(), resolving to canned rows. */
function rowsResult(rows: unknown[]) {
  return {
    where: () => rowsResult(rows),
    then: (resolve: (r: unknown[]) => void) => resolve(rows),
  };
}

function makeFakeDb(byTable: Map<unknown, unknown[]>) {
  const upserts: Upsert[] = [];
  const db = {
    select() {
      return { from: (table: unknown) => rowsResult(byTable.get(table) ?? []) };
    },
    insert() {
      return {
        values(values: Upsert['values']) {
          return {
            onConflictDoUpdate(conflict: unknown) {
              upserts.push({ values, conflict });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as DB, upserts };
}

describe('scoreFits', () => {
  it('upserts a fit score for every (job × base resume)', async () => {
    const byTable = new Map<unknown, unknown[]>([
      [masterSkills, [{ skill: 'go' }, { skill: 'kafka' }]],
      [
        resumeBullets,
        [
          { skills: ['go', 'kafka'], roleFamily: 'backend' },
          { skills: ['react'], roleFamily: 'frontend' },
        ],
      ],
      [
        resumes,
        [
          { id: 1, roleFamily: 'backend' },
          { id: 2, roleFamily: 'frontend' },
        ],
      ],
      [jobs, [{ id: 10, techKeywords: ['go', 'kafka'], softKeywords: [] }]],
    ]);
    const fake = makeFakeDb(byTable);

    const count = await scoreFits(fake.db);

    expect(count).toBe(2); // 1 job × 2 resumes
    const rows = fake.upserts.flatMap((u) => u.values);
    const backend = rows.find((r) => r.resumeId === 1);
    const frontend = rows.find((r) => r.resumeId === 2);
    // Backend resume shows go+kafka -> full coverage.
    expect(backend?.relevanceScore).toBe(100);
    expect(backend?.skillGaps).toEqual([]);
    // Frontend resume shows neither -> 0, both are gaps.
    expect(frontend?.relevanceScore).toBe(0);
    expect(frontend?.skillGaps).toEqual(['go', 'kafka']);
    expect(fake.upserts[0].conflict).toBeTruthy();
  });

  it('does nothing when there are no jobs', async () => {
    const byTable = new Map<unknown, unknown[]>([
      [masterSkills, [{ skill: 'go' }]],
      [resumeBullets, []],
      [resumes, [{ id: 1, roleFamily: 'backend' }]],
      [jobs, []],
    ]);
    const fake = makeFakeDb(byTable);
    expect(await scoreFits(fake.db)).toBe(0);
    expect(fake.upserts).toHaveLength(0);
  });
});
