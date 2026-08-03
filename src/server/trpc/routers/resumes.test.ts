import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';
import {
  addBulletInput,
  addSkillInput,
  buildBulletUpdate,
  normalizeSkillList,
  tailorInput,
  updateBulletInput,
  upsertBaseResumeInput,
} from './resumes';

// The tailor mutation dynamically imports these on the LLM path; stub them so we
// can drive a controlled `complete` (success or throw) without a real key.
const llm = vi.hoisted(() => ({
  complete: null as null | ((m: { system: string; user: string }) => Promise<string>),
}));
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));
vi.mock('@/server/enrich/openai', () => ({
  openaiChat: () => ({
    complete: (m: { system: string; user: string }) => {
      if (!llm.complete) throw new Error('llm.complete not configured for this test');
      return llm.complete(m);
    },
  }),
}));

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

describe('tailorInput', () => {
  it('requires integer jobId and resumeId', () => {
    expect(() => tailorInput.parse({ jobId: 1.5, resumeId: 1 })).toThrow();
    expect(() => tailorInput.parse({ jobId: 1 })).toThrow();
    expect(tailorInput.parse({ jobId: 1, resumeId: 2 })).toMatchObject({ jobId: 1, resumeId: 2 });
  });

  it('bounds maxAttempts to 1–5 when provided', () => {
    expect(() => tailorInput.parse({ jobId: 1, resumeId: 2, maxAttempts: 0 })).toThrow();
    expect(() => tailorInput.parse({ jobId: 1, resumeId: 2, maxAttempts: 6 })).toThrow();
    expect(tailorInput.parse({ jobId: 1, resumeId: 2, maxAttempts: 3 }).maxAttempts).toBe(3);
  });
});

describe('resumes.tailor', () => {
  // Force the deterministic fallback path regardless of the dev's real env.
  afterEach(() => {
    vi.unstubAllEnvs();
    llm.complete = null;
    vi.restoreAllMocks();
  });
  const noKey = () => vi.stubEnv('OPENAI_API_KEY', '');
  const jobRow = { title: 'BE', company: 'Acme', techKeywords: ['go'], softKeywords: [] };
  const baseRows = () => [
    [jobRow],
    [{ content: '\\section*{EXPERIENCE}\nbase body', roleFamily: 'backend' }],
    [{ skill: 'go' }],
    [{ text: 'Shipped a Go service.', skills: ['go'], roleFamily: 'backend' }],
  ];

  it('throws NOT_FOUND when the job is missing', async () => {
    noKey();
    await expect(
      caller([[], [{ content: '\\section*{X}', roleFamily: 'backend' }]]).resumes.tailor({
        jobId: 1,
        resumeId: 1,
      }),
    ).rejects.toThrow(/Job not found/);
  });

  it('throws NOT_FOUND when the résumé is missing', async () => {
    noKey();
    await expect(
      caller([
        [{ title: 'BE', company: 'Acme', techKeywords: ['go'], softKeywords: [] }],
        [],
      ]).resumes.tailor({ jobId: 1, resumeId: 999 }),
    ).rejects.toThrow(/not found/i);
  });

  it('throws BAD_REQUEST when the base résumé has no content', async () => {
    noKey();
    await expect(
      caller([
        [{ title: 'BE', company: 'Acme', techKeywords: ['go'], softKeywords: [] }],
        [{ content: null, roleFamily: 'backend' }],
      ]).resumes.tailor({ jobId: 1, resumeId: 1 }),
    ).rejects.toThrow(/no content/i);
  });

  it('falls back to the base résumé (source: base) with a fit snapshot when no key is set', async () => {
    noKey();
    const res = await caller([
      // job
      [
        {
          title: 'Backend Engineer',
          company: 'Acme',
          techKeywords: ['go', 'rust'],
          softKeywords: [],
        },
      ],
      // resume (base LaTeX + role)
      [{ content: '\\section*{EXPERIENCE}\nbase body', roleFamily: 'backend' }],
      // master skills
      [{ skill: 'go' }],
      // bullets
      [{ text: 'Shipped a Go service.', skills: ['go'], roleFamily: 'backend' }],
    ]).resumes.tailor({ jobId: 1, resumeId: 1 });

    expect(res.source).toBe('base');
    expect(res.report).toBeNull();
    expect(res.latex).toContain('base body');
    // "go" matched via the bullet; "rust" is an honest gap (not in inventory).
    expect(res.fit.matched).toEqual(['go']);
    expect(res.fit.missingGap).toEqual(['rust']);
    expect(res.coverableKeywords).toContain('go');
    expect(res.trueGaps).toEqual(['rust']);
  });

  it('returns source: llm with a report when the LLM succeeds', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    llm.complete = async () => '\\section*{EXPERIENCE}\ntailored body';
    const res = await caller(baseRows()).resumes.tailor({
      jobId: 1,
      resumeId: 1,
      maxAttempts: 1,
    });
    expect(res.source).toBe('llm');
    expect(res.report).not.toBeNull();
    expect(res.latex).toContain('tailored body');
  });

  it('falls back to source: base when a key is set but the LLM throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    llm.complete = async () => {
      throw new Error('boom');
    };
    const res = await caller(baseRows()).resumes.tailor({
      jobId: 1,
      resumeId: 1,
      maxAttempts: 1,
    });
    expect(res.source).toBe('base');
    expect(res.latex).toContain('base body');
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

  it('addBulletInput requires text and defaults skills to []', () => {
    expect(() => addBulletInput.parse({ skills: ['go'] })).toThrow();
    expect(addBulletInput.parse({ text: 'Shipped X.' }).skills).toEqual([]);
    expect(addBulletInput.parse({ text: 'Shipped X.', roleFamily: 'backend' }).roleFamily).toBe(
      'backend',
    );
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

  it('addBullet returns the new row id', async () => {
    const { caller: c } = writeCaller([{ id: 9 }]);
    const res = await c.resumes.addBullet({ text: 'Shipped X by 40%.', skills: ['go'] });
    expect(res).toEqual({ id: 9 });
  });

  it('updateBullet with no fields is a no-op (no update issued)', async () => {
    const { caller: c, ops } = writeCaller();
    const res = await c.resumes.updateBullet({ id: 5 });
    expect(res).toEqual({ id: 5 });
    expect(ops).not.toContain('update');
  });

  it('removeBaseResume deletes and echoes the id', async () => {
    const { caller: c, ops } = writeCaller();
    const res = await c.resumes.removeBaseResume({ id: 2 });
    expect(res).toEqual({ id: 2 });
    expect(ops).toContain('delete');
  });
});

describe('buildBulletUpdate', () => {
  it('omits fields left undefined (no-op)', () => {
    expect(buildBulletUpdate({ id: 1 })).toEqual({});
  });

  it('normalizes skills, and clears roleFamily/company with null', () => {
    expect(buildBulletUpdate({ id: 1, skills: [' Go ', 'go', 'Kafka'] })).toEqual({
      skills: ['go', 'kafka'],
    });
    expect(buildBulletUpdate({ id: 1, roleFamily: null, company: null })).toEqual({
      roleFamily: null,
      company: null,
    });
    expect(updateBulletInput.parse({ id: 1, text: 'New.' }).text).toBe('New.');
  });
});
