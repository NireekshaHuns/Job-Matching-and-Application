import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { NewJob } from '@/server/db/schema';
import { insertJobs, loadSponsorLookup } from './run';

interface InsertCapture {
  values: Array<{ fingerprint: string }>;
  conflict: unknown;
}

/**
 * Fake db for insert().values().onConflictDoNothing().returning(). `dropOne`
 * simulates a race where one fingerprint conflicts and is not returned.
 */
function makeInsertDb(dropOne = false) {
  const inserts: InsertCapture[] = [];
  const db = {
    insert() {
      const cap: InsertCapture = { values: [], conflict: null };
      return {
        values(vals: Array<{ fingerprint: string }>) {
          cap.values = vals;
          return {
            onConflictDoNothing(cfg: unknown) {
              cap.conflict = cfg;
              inserts.push(cap);
              return {
                returning() {
                  const kept = dropOne ? vals.slice(1) : vals;
                  return Promise.resolve(kept.map((v) => ({ fingerprint: v.fingerprint })));
                },
              };
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
  it('inserts in chunks of 200 and counts rows actually inserted', async () => {
    const { db, inserts } = makeInsertDb();
    const rows = Array.from({ length: 201 }, (_, i) => job(`f${i}`));
    expect(await insertJobs(db, rows)).toBe(201);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toHaveLength(200);
    expect(inserts[0].conflict).toBeTruthy();
  });

  it('does not count rows dropped by a conflict', async () => {
    const { db } = makeInsertDb(true); // drops 1 per chunk
    const rows = Array.from({ length: 5 }, (_, i) => job(`f${i}`));
    expect(await insertJobs(db, rows)).toBe(4);
  });

  it('writes nothing for an empty list', async () => {
    const { db, inserts } = makeInsertDb();
    expect(await insertJobs(db, [])).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('loadSponsorLookup', () => {
  it('maps sponsor rows into a lookup, preserving null approval rate', async () => {
    const rows = [
      { key: 'GOOGLE', sponsorCount: 100, approvalRate: 0.98, lastFiledYear: 2025 },
      { key: 'FOO', sponsorCount: 3, approvalRate: null, lastFiledYear: 2020 },
    ];
    const db = {
      select: () => ({ from: () => Promise.resolve(rows) }),
    } as unknown as DB;

    const lookup = await loadSponsorLookup(db);
    expect(lookup('GOOGLE')?.sponsorCount).toBe(100);
    expect(lookup('FOO')?.approvalRate).toBeNull();
    expect(lookup('UNKNOWN')).toBeNull();
  });
});
