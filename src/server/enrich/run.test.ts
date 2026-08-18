import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import type { NewJob } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import type { DiscoveredAlias } from './steps/resolver';
import {
  insertJobs,
  loadSponsorState,
  planEnrichmentBatch,
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

describe('planEnrichmentBatch', () => {
  const posting = (fingerprint: string) => ({ fingerprint }) as RawPosting;
  const all = ['a', 'b', 'c', 'd'].map(posting);

  it('passes everything through when there is no cap', () => {
    const { toEnrich, deferred } = planEnrichmentBatch(all, new Set());
    expect(toEnrich).toBe(all);
    expect(deferred).toBe(0);
  });

  it('does not count postings we already hold against the cap', () => {
    // 4 fetched, 3 already known: only 'd' is new, so a cap of 2 defers nothing
    // and the full list still goes through (enrichPostings skips the dupes).
    const existing = new Set(['a', 'b', 'c']);
    const { toEnrich, deferred } = planEnrichmentBatch(all, existing, 2);
    expect(deferred).toBe(0);
    expect(toEnrich).toBe(all);
  });

  it('enriches up to the cap and defers the rest', () => {
    const { toEnrich, deferred } = planEnrichmentBatch(all, new Set(), 2);
    expect(toEnrich.map((p) => p.fingerprint)).toEqual(['a', 'b']);
    expect(deferred).toBe(2);
  });

  it('drops the already-known postings once it has to cap', () => {
    // Capping means only new postings are handed on — the known ones would be
    // skipped anyway, and their fingerprints are still reconciled by the caller.
    const { toEnrich, deferred } = planEnrichmentBatch(all, new Set(['a']), 1);
    expect(toEnrich.map((p) => p.fingerprint)).toEqual(['b']);
    expect(deferred).toBe(2);
  });

  it('handles an empty fetch', () => {
    expect(planEnrichmentBatch([], new Set(), 10)).toEqual({ toEnrich: [], deferred: 0 });
  });

  it('spends the cap on postings that can become rows, not on ones it will drop', () => {
    // The regression this fixes: non-candidates used to consume cap slots, get
    // dropped later by the title filter, never be inserted, and therefore never
    // join `existing` — so the next run met the same rows and spent the same
    // slots on them again, forever. Here the head of the feed is all non-SWE,
    // so the OLD behaviour enriched nothing at all under a cap of 2.
    const titled = (fingerprint: string, title: string) => ({ fingerprint, title }) as RawPosting;
    const feed = [
      titled('n1', 'Registered Nurse'),
      titled('n2', 'Account Executive'),
      titled('s1', 'Software Engineer'),
      titled('n3', 'Mechanical Engineer'),
      titled('s2', 'Backend Engineer'),
      titled('s3', 'Platform Engineer'),
    ];
    const isSwe = (p: RawPosting) => p.title !== 'Mechanical Engineer' && /engineer/i.test(p.title);

    const { toEnrich, deferred } = planEnrichmentBatch(feed, new Set(), 2, isSwe);
    expect(toEnrich.map((p) => p.fingerprint)).toEqual(['s1', 's2']);
    // Only s3 is left over; the four non-candidates are not "deferred work".
    expect(deferred).toBe(1);
  });

  it('advances past non-candidates on the next run instead of restarting', () => {
    const titled = (fingerprint: string, title: string) => ({ fingerprint, title }) as RawPosting;
    const feed = [
      ...['n1', 'n2', 'n3', 'n4'].map((f) => titled(f, 'Sales Executive')),
      ...['s1', 's2', 's3'].map((f, i) => titled(f, `Software Engineer ${i}`)),
    ];
    const isSwe = (p: RawPosting) => p.title.startsWith('Software');

    const first = planEnrichmentBatch(feed, new Set(), 2, isSwe);
    expect(first.toEnrich.map((p) => p.fingerprint)).toEqual(['s1', 's2']);
    expect(first.deferred).toBe(1);

    // Second run, with the first run's output now on record: the only work left
    // is s3. Nothing needs deferring, so the whole fetch passes through for
    // `enrichPostings` to filter — the point is that s3 is reachable at all.
    const second = planEnrichmentBatch(feed, new Set(['s1', 's2']), 2, isSwe);
    expect(second.deferred).toBe(0);
    expect(second.toEnrich.map((p) => p.fingerprint)).toContain('s3');
  });

  it('counts everything when no predicate is given', () => {
    const { toEnrich } = planEnrichmentBatch(all, new Set(), 2);
    expect(toEnrich.map((p) => p.fingerprint)).toEqual(['a', 'b']);
  });
});

describe('runEnrichment hydration', () => {
  it('hydrates the selected slice, not the head of the feed', async () => {
    // Documented here because the failure is invisible and permanent: a source
    // that buys JDs during fetch() spends the budget on postings the cap defers,
    // so from run 2 onward enriched jobs have no JD — and `Excluded` comes from
    // JD text alone, on a row that is never re-analyzed.
    const posting = (fingerprint: string, title: string) =>
      ({ fingerprint, title, jdText: '' }) as RawPosting;
    const feed = Array.from({ length: 10 }, (_, i) => posting(`fp-${i}`, 'Software Engineer'));

    const handedTo: string[][] = [];
    const hydrate = async (ps: RawPosting[]) => {
      handedTo.push(ps.map((p) => p.fingerprint));
      return ps.map((p) => ({ ...p, jdText: 'hydrated' }));
    };

    // Stand in for the planner + hydrate contract without a DB: the slice the
    // planner returns is exactly what hydrate must receive.
    const { toEnrich } = planEnrichmentBatch(
      feed,
      new Set(['fp-0', 'fp-1', 'fp-2']),
      3,
      () => true,
    );
    const hydrated = await hydrate(toEnrich);

    expect(handedTo).toEqual([['fp-3', 'fp-4', 'fp-5']]);
    expect(hydrated.every((p) => p.jdText === 'hydrated')).toBe(true);
  });
});
