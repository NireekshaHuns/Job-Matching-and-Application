import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { SponsorAggregate } from './aggregate';
import { loadSponsors } from './load';

interface Capture {
  values: unknown[];
  conflict: unknown;
}

/**
 * Minimal fake implementing just the `insert().values().onConflictDoUpdate()`
 * chain `loadSponsors` uses, so we can assert chunking + upsert without a DB.
 * (The real overwrite-not-duplicate behavior is proven end-to-end against Neon.)
 */
function makeFakeDb() {
  const inserts: Capture[] = [];
  const db = {
    insert() {
      const cap: Capture = { values: [], conflict: null };
      return {
        values(vals: unknown[]) {
          cap.values = vals;
          return {
            onConflictDoUpdate(cfg: unknown) {
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

function agg(name: string): SponsorAggregate {
  return {
    companyNameNormalized: name,
    sponsorCount: 1,
    approvalRate: 1,
    lastFiledYear: 2024,
  };
}

describe('loadSponsors', () => {
  it('issues no inserts for an empty list', async () => {
    const { db, inserts } = makeFakeDb();
    expect(await loadSponsors(db, [])).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('upserts a single batch and uses onConflictDoUpdate', async () => {
    const { db, inserts } = makeFakeDb();
    expect(await loadSponsors(db, [agg('A'), agg('B')])).toBe(2);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toHaveLength(2);
    expect(inserts[0].conflict).toBeTruthy();
  });

  it('splits across the 500-row chunk boundary', async () => {
    const { db, inserts } = makeFakeDb();
    const many = Array.from({ length: 501 }, (_, i) => agg(`C${i}`));
    expect(await loadSponsors(db, many)).toBe(501);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toHaveLength(500);
    expect(inserts[1].values).toHaveLength(1);
  });
});
