import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { NewJob } from '@/server/db/schema';
import type { DiscoveredAlias } from './steps/resolver';
import {
  insertJobs,
  loadSponsorState,
  reconcileFreshness,
  staleThreshold,
  upsertDiscoveredAliases,
} from './run';

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

describe('upsertDiscoveredAliases', () => {
  interface UpsertCapture {
    values: Array<Record<string, unknown>>;
    conflict: { target?: unknown; set?: Record<string, unknown>; setWhere?: unknown };
  }

  function makeUpsertDb() {
    const inserts: UpsertCapture[] = [];
    const db = {
      insert() {
        const cap: UpsertCapture = { values: [], conflict: {} };
        return {
          values(vals: Array<Record<string, unknown>>) {
            cap.values = vals;
            return {
              onConflictDoUpdate(cfg: UpsertCapture['conflict']) {
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

  const alias = (rawNameNormalized: string, sponsorKey: string): DiscoveredAlias => ({
    rawName: rawNameNormalized,
    rawNameNormalized,
    sponsorKey,
    confidence: 0.8,
    method: 'fuzzy',
  });

  it('maps sponsor keys to ids, marks rows unconfirmed, and never clobbers a confirmed row', async () => {
    const { db, inserts } = makeUpsertDb();
    const idByKey = new Map([['STRIPE PAYMENTS', 7]]);

    const written = await upsertDiscoveredAliases(
      db,
      [alias('STRIPE', 'STRIPE PAYMENTS')],
      idByKey,
    );

    expect(written).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values[0]).toMatchObject({
      rawNameNormalized: 'STRIPE',
      sponsorId: 7,
      confirmed: false,
    });
    // The sticky-correction guarantee: only update rows that aren't confirmed.
    expect(inserts[0].conflict.setWhere).toBeTruthy();
    expect(inserts[0].conflict.target).toBeTruthy();
  });

  it('writes null sponsorId when the discovered key is not in the id map', async () => {
    const { db, inserts } = makeUpsertDb();
    const written = await upsertDiscoveredAliases(db, [alias('X', 'MISSING KEY')], new Map());
    expect(written).toBe(1);
    expect(inserts[0].values[0].sponsorId).toBeNull();
  });

  it('writes nothing for an empty list', async () => {
    const { db, inserts } = makeUpsertDb();
    expect(await upsertDiscoveredAliases(db, [], new Map())).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('staleThreshold', () => {
  it('subtracts the given number of days from now', () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    expect(staleThreshold(now, 14).toISOString()).toBe('2026-07-17T00:00:00.000Z');
  });
});

describe('reconcileFreshness', () => {
  interface UpdateCapture {
    set: Record<string, unknown>;
  }

  /** Fake for update().set().where().returning(); returns the queued row lists in order. */
  function makeUpdateDb(returns: Array<Array<{ id: number }>>) {
    const updates: UpdateCapture[] = [];
    let call = 0;
    const db = {
      update() {
        const cap: UpdateCapture = { set: {} };
        return {
          set(vals: Record<string, unknown>) {
            cap.set = vals;
            return {
              where() {
                return {
                  returning() {
                    updates.push(cap);
                    return Promise.resolve(returns[call++] ?? []);
                  },
                };
              },
            };
          },
        };
      },
    };
    return { db: db as unknown as DB, updates };
  }

  it('refreshes+reopens seen jobs, then closes stale ones', async () => {
    // 1st update = refresh (2 rows), 2nd = close-stale (1 row).
    const { db, updates } = makeUpdateDb([[{ id: 1 }, { id: 2 }], [{ id: 9 }]]);
    const stats = await reconcileFreshness(db, ['a', 'b', 'a'], new Date('2026-07-31T00:00:00Z'));

    expect(stats).toEqual({ refreshed: 2, closed: 1 });
    // Refresh reopens (active + clears closedAt); close-stale sets closed.
    expect(updates[0].set).toMatchObject({ status: 'active', closedAt: null });
    expect(updates[1].set).toMatchObject({ status: 'closed' });
  });

  it('skips all updates when nothing was seen (no signal = no closing)', async () => {
    const { db, updates } = makeUpdateDb([[{ id: 5 }]]);
    const stats = await reconcileFreshness(db, [], new Date());
    // A total fetch outage must not close a still-live board.
    expect(stats).toEqual({ refreshed: 0, closed: 0 });
    expect(updates).toHaveLength(0);
  });
});

describe('loadSponsorState', () => {
  it('maps sponsor rows into history + id maps, preserving new-employment fields', async () => {
    const rows = [
      {
        id: 1,
        key: 'GOOGLE',
        sponsorCount: 100,
        approvalRate: 0.98,
        lastFiledYear: 2025,
        newEmploymentApprovals: 40,
        newEmploymentLastYear: 2025,
      },
      {
        id: 2,
        key: 'FOO',
        sponsorCount: 3,
        approvalRate: null,
        lastFiledYear: 2020,
        newEmploymentApprovals: 0,
        newEmploymentLastYear: null,
      },
    ];
    const db = {
      select: () => ({ from: () => Promise.resolve(rows) }),
    } as unknown as DB;

    const { historyByKey, idByKey } = await loadSponsorState(db);
    expect(historyByKey.get('GOOGLE')?.newEmploymentApprovals).toBe(40);
    expect(historyByKey.get('FOO')?.approvalRate).toBeNull();
    expect(historyByKey.has('UNKNOWN')).toBe(false);
    expect(idByKey.get('GOOGLE')).toBe(1);
    expect(idByKey.get('FOO')).toBe(2);
  });
});
