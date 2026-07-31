import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';

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
