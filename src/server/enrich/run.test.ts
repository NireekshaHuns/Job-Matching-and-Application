import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { NewJob } from '@/server/db/schema';
import { insertJobs } from './run';

interface Capture {
  values: unknown[];
  conflict: unknown;
}

/** Fake db implementing only insert().values().onConflictDoNothing(). */
function makeFakeDb() {
  const inserts: Capture[] = [];
  const db = {
    insert() {
      const cap: Capture = { values: [], conflict: null };
      return {
        values(vals: unknown[]) {
          cap.values = vals;
          return {
            onConflictDoNothing(cfg: unknown) {
              cap.conflict = cfg;
              inserts.push(cap);
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as DB, inserts };
}

function job(fingerprint: string): NewJob {
  return {
    fingerprint,
    source: 'greenhouse',
    url: 'https://example.com',
    company: 'Co',
    title: 'SWE',
    jdText: 'text',
    employmentType: 'full_time',
    sponsorTier: 'Low',
  };
}

describe('insertJobs', () => {
  it('inserts in chunks of 200 and uses onConflictDoNothing', async () => {
    const { db, inserts } = makeFakeDb();
    const rows = Array.from({ length: 201 }, (_, i) => job(`f${i}`));
    expect(await insertJobs(db, rows)).toBe(201);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toHaveLength(200);
    expect(inserts[1].values).toHaveLength(1);
    expect(inserts[0].conflict).toBeTruthy();
  });

  it('writes nothing for an empty list', async () => {
    const { db, inserts } = makeFakeDb();
    expect(await insertJobs(db, [])).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});
