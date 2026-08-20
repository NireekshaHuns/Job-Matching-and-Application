import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';
import {
  addSkillInput,
  extractJdKeywordsInput,
  normalizeSkillList,
  tailorFromCorpusInput,
  upsertBaseResumeInput,
} from './resumes';

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

  it('extractJdKeywordsInput defaults the title and leaves the role family optional', () => {
    const parsed = extractJdKeywordsInput.parse({ jdText: 'Build things.' });
    expect(parsed.jobTitle).toBe('');
    expect(parsed.roleFamily).toBeUndefined();
    expect(extractJdKeywordsInput.parse({ jdText: 'x', roleFamily: 'backend' }).roleFamily).toBe(
      'backend',
    );
    expect(extractJdKeywordsInput.safeParse({ jdText: '' }).success).toBe(false);
  });

  it('tailorFromCorpusInput defaults adjacentKeywords to empty', () => {
    // The generator treats a missing list as "nothing to gesture at", so the
    // default has to be the empty list and not undefined.
    const parsed = tailorFromCorpusInput.parse({ jobTitle: 'SWE' });
    expect(parsed.adjacentKeywords).toEqual([]);
    expect(parsed.selectedKeywords).toEqual([]);
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
