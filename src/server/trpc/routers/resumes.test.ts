import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';
import { addSkillInput, normalizeSkillList, upsertBaseResumeInput } from './resumes';

/**
 * Fake db returning queued row-lists for each `.select().from().where().limit()`
 * (or `.from(table)` for the master-skills/bullets reads). Order of calls in
 * `tailoringSuggestions`: [job], [resume] (via Promise.all), then master skills
 * + bullets.
 */
function fakeDb(results: unknown[][]): DB {
  let call = 0;
  const chain = () => {
    const rows = results[call++] ?? [];
    const thenable = {
      from: () => thenable,
      where: () => thenable,
      limit: () => Promise.resolve(rows),
      then: (res: (v: unknown) => unknown) => res(rows),
    };
    return thenable;
  };
  return { select: chain } as unknown as DB;
}

function caller(results: unknown[][]) {
  return createCaller({ db: fakeDb(results) } as Context);
}

/**
 * Fake db that records write ops (insert/update/delete) and returns configured
 * `.returning()` rows. Chain methods are no-ops so the mutation bodies run
 * without a real DB — enough to assert the create-vs-update branch, echoed ids,
 * and no-op updates.
 */
function writeCaller(returning: unknown[] = [{ id: 1 }]) {
  const ops: Array<'insert' | 'update' | 'delete'> = [];
  const make = (op: 'insert' | 'update' | 'delete') => () => {
    ops.push(op);
    const chain = {
      values: () => chain,
      set: () => chain,
      where: () => chain,
      onConflictDoNothing: () => Promise.resolve(undefined),
      returning: () => Promise.resolve(returning),
      then: (r: (v: unknown) => unknown) => r(undefined),
    };
    return chain;
  };
  const db = {
    insert: make('insert'),
    update: make('update'),
    delete: make('delete'),
  } as unknown as DB;
  return { caller: createCaller({ db } as Context), ops };
}

describe('resumes.tailoringSuggestions', () => {
  it('rejects non-integer ids', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid input
      caller([]).resumes.tailoringSuggestions({ jobId: 'x', resumeId: 1 }),
    ).rejects.toThrow();
  });

  it('throws NOT_FOUND when the job is missing', async () => {
    // job lookup → [], resume lookup → [row]
    await expect(
      caller([[], [{ roleFamily: 'backend' }]]).resumes.tailoringSuggestions({
        jobId: 1,
        resumeId: 1,
      }),
    ).rejects.toThrow(/Job not found/);
  });

  it('throws NOT_FOUND when the résumé is missing', async () => {
    await expect(
      caller([[{ techKeywords: ['go'], softKeywords: [] }], []]).resumes.tailoringSuggestions({
        jobId: 1,
        resumeId: 999,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('returns truthful suggestions on the happy path', async () => {
    const res = await caller([
      [{ techKeywords: ['go', 'rust'], softKeywords: [] }], // job
      [{ roleFamily: 'backend' }], // resume
      [{ skill: 'go' }], // master skills
      [
        {
          id: 1,
          text: 'Wrote Go services',
          company: 'Acme',
          skills: ['go'],
          roleFamily: 'backend',
        },
      ], // bullets
    ]).resumes.tailoringSuggestions({ jobId: 1, resumeId: 1 });

    // "go" is matched via the bullet; "rust" is an honest gap (not in inventory).
    expect(res.matched).toEqual(['go']);
    expect(res.gaps).toEqual(['rust']);
    expect(res.addable).toEqual([]);
  });
});

describe('normalizeSkillList', () => {
  it('lowercases, trims, drops empties, and dedupes preserving order', () => {
    expect(normalizeSkillList([' Go ', 'KAFKA', 'go', '', '  ', 'Redis'])).toEqual([
      'go',
      'kafka',
      'redis',
    ]);
  });
});

describe('settings input schemas', () => {
  it('addSkillInput requires a non-empty skill and a valid kind', () => {
    expect(() => addSkillInput.parse({ skill: '', kind: 'technical' })).toThrow();
    expect(() => addSkillInput.parse({ skill: 'go', kind: 'wizardry' })).toThrow();
    expect(addSkillInput.parse({ skill: 'go', kind: 'soft' })).toMatchObject({ kind: 'soft' });
  });

  it('upsertBaseResumeInput requires label + content; id optional', () => {
    expect(() => upsertBaseResumeInput.parse({ label: 'Base', content: '' })).toThrow();
    expect(() => upsertBaseResumeInput.parse({ label: '', content: 'x' })).toThrow();
    expect(upsertBaseResumeInput.parse({ label: 'Base', content: '\\doc' })).not.toHaveProperty(
      'id',
    );
  });
});

describe('resumes settings mutations (write path)', () => {
  it('upsertBaseResume inserts when no id is given', async () => {
    const { caller: c, ops } = writeCaller([{ id: 7 }]);
    const res = await c.resumes.upsertBaseResume({ label: 'Base', content: '\\doc' });
    expect(res).toEqual({ id: 7 });
    expect(ops).toContain('insert');
    expect(ops).not.toContain('update');
  });

  it('upsertBaseResume updates when an id is given', async () => {
    const { caller: c, ops } = writeCaller();
    const res = await c.resumes.upsertBaseResume({ id: 3, label: 'Base', content: '\\doc' });
    expect(res).toEqual({ id: 3 });
    expect(ops).toContain('update');
    expect(ops).not.toContain('insert');
  });

  it('addSkill lowercases before insert', async () => {
    const { caller: c, ops } = writeCaller();
    const res = await c.resumes.addSkill({ skill: 'GraphQL', kind: 'technical' });
    expect(res).toEqual({ skill: 'graphql' });
    expect(ops).toContain('insert');
  });

  it('removeBaseResume deletes and echoes the id', async () => {
    const { caller: c, ops } = writeCaller();
    const res = await c.resumes.removeBaseResume({ id: 2 });
    expect(res).toEqual({ id: 2 });
    expect(ops).toContain('delete');
  });
});
