import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';
import type { NewJob } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import { enrichPostings, type EnrichDeps } from './enrich';

const deps: EnrichDeps = {
  chat: {
    complete: async () =>
      JSON.stringify({
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: ['go'],
      }),
  },
  embedder: {
    embed: async () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01),
  },
  resolve: () => ({ history: null, key: null, confidence: null, method: 'fuzzy' }),
};

function posting(fingerprint: string, overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    source: 'greenhouse',
    company: 'Stripe',
    title: 'Software Engineer',
    location: 'Remote',
    url: `https://example.com/${fingerprint}`,
    jdText: 'Build APIs.',
    postedAt: new Date('2026-07-01T00:00:00Z'),
    fingerprint,
    raw: {},
    ...overrides,
  };
}

describe('enrichPostings', () => {
  it('dedups, skips existing fingerprints, and enriches the rest', async () => {
    const result = await enrichPostings(
      [posting('a'), posting('a'), posting('b'), posting('c')],
      new Set(['b']),
      deps,
    );
    // 4 in -> 3 unique -> b already exists -> a and c enriched (both SWE titles).
    expect(result.stats).toEqual({ fetched: 4, deduped: 3, filtered: 0, enriched: 2, failed: 0 });
    expect(result.rows.map((r) => r.fingerprint).sort()).toEqual(['a', 'c']);
    expect(result.rows[0].sponsorTier).toBe('Low');
    // Unmatched company -> badge is unknown, confidence null (never fabricated).
    expect(result.rows[0].newHireStatus).toBe('unknown');
    expect(result.rows[0].sponsorMatchConfidence).toBeNull();
    expect(result.rows[0].roleFamily).toBe('backend');
  });

  it('produces no rows when everything already exists', async () => {
    const result = await enrichPostings([posting('a')], new Set(['a']), deps);
    expect(result.rows).toHaveLength(0);
    expect(result.stats.enriched).toBe(0);
  });

  it('drops non-software titles before the (paid) classify step', async () => {
    let classifyCalls = 0;
    const counting: EnrichDeps = {
      ...deps,
      chat: {
        complete: async () => {
          classifyCalls++;
          return JSON.stringify({
            employmentType: 'full_time',
            roleFamily: 'backend',
            seniority: 'entry',
            skills: ['go'],
          });
        },
      },
    };
    const result = await enrichPostings(
      [
        posting('a', { title: 'Software Engineer' }),
        posting('b', { title: 'Registered Nurse' }),
        posting('c', { title: 'Backend Developer' }),
        posting('d', { title: 'Sales Coordinator' }),
      ],
      new Set(),
      counting,
    );
    // Only the two software titles reach the LLM; the nurse/sales rows are dropped.
    expect(classifyCalls).toBe(2);
    expect(result.stats).toEqual({ fetched: 4, deduped: 4, filtered: 2, enriched: 2, failed: 0 });
    expect(result.rows.map((r) => r.fingerprint).sort()).toEqual(['a', 'c']);
  });
});

describe('enrichPostings posting-age guard', () => {
  /** A chat client that records every call, so "was this paid for?" is testable. */
  function countingDeps() {
    let calls = 0;
    const counting: EnrichDeps = {
      ...deps,
      chat: {
        complete: async (...args) => {
          calls++;
          return deps.chat.complete(...args);
        },
      },
    };
    return { deps: counting, calls: () => calls };
  }

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('never pays to classify a stale posting', async () => {
    // The regression this covers: the guard used to live only in the cap
    // planner, which returns the fetch untouched whenever nothing needs
    // deferring — so an ordinary run classified every stale posting anyway.
    // ATS feeds return their whole back catalogue on every fetch.
    const { deps: counting, calls } = countingDeps();
    const result = await enrichPostings(
      [
        posting('old-1', { postedAt: daysAgo(270) }),
        posting('old-2', { postedAt: daysAgo(30) }),
        posting('fresh', { postedAt: daysAgo(1) }),
      ],
      new Set(),
      counting,
      { maxPostedAgeDays: 7 },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].fingerprint).toBe('fresh');
    expect(calls()).toBe(1);
  });

  it('keeps a posting whose date we do not know', async () => {
    // Several sources give us none, and Workday has no date until hydration.
    const { deps: counting, calls } = countingDeps();
    const result = await enrichPostings(
      [posting('undated', { postedAt: null })],
      new Set(),
      counting,
      {
        maxPostedAgeDays: 7,
      },
    );
    expect(result.rows).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  it('classifies everything when no limit is set', async () => {
    const { deps: counting, calls } = countingDeps();
    const result = await enrichPostings(
      [posting('ancient', { postedAt: daysAgo(400) })],
      new Set(),
      counting,
    );
    expect(result.rows).toHaveLength(1);
    expect(calls()).toBe(1);
  });
});

describe('enrichPostings failure reporting', () => {
  it('reports which postings threw, so they can stop occupying the cap window', async () => {
    // A failure is never inserted, so it never becomes "seen" — and because the
    // cap slices off the head of each feed, a poisonous posting at the front
    // blocks everything behind it on every run, forever.
    const failing: EnrichDeps = {
      ...deps,
      chat: {
        complete: async (msgs) => {
          const text = JSON.stringify(msgs);
          if (text.includes('POISON')) return 'not json at all';
          return deps.chat.complete(msgs);
        },
      },
    };
    const result = await enrichPostings(
      [
        posting('good-1'),
        posting('bad-1', { jdText: 'POISON' }),
        posting('good-2'),
        posting('bad-2', { jdText: 'POISON' }),
      ],
      new Set(),
      failing,
    );

    expect(result.stats.failed).toBe(2);
    expect(result.failedFingerprints.sort()).toEqual(['bad-1', 'bad-2']);
    expect(result.rows.map((r) => r.fingerprint).sort()).toEqual(['good-1', 'good-2']);
  });

  it('reports nothing when everything succeeds', async () => {
    const result = await enrichPostings([posting('a')], new Set(), deps);
    expect(result.failedFingerprints).toEqual([]);
  });
});

describe('enrichPostings resilience', () => {
  const CLASSIFICATION = {
    employmentType: 'full_time',
    roleFamily: 'backend',
    seniority: 'entry',
    skills: ['go'],
  };

  it('skips a posting whose classification is unusable instead of aborting the run', async () => {
    // The failure that killed a 9,000-posting backfill: one response with a
    // role family outside the enum threw out of the loop, and because rows were
    // only written at the end, every posting classified before it was lost.
    let call = 0;
    const flaky: EnrichDeps = {
      ...deps,
      chat: {
        complete: async () => {
          call++;
          if (call === 2) return JSON.stringify({ ...CLASSIFICATION, roleFamily: 'wizardry' });
          return JSON.stringify(CLASSIFICATION);
        },
      },
    };

    const result = await enrichPostings(
      [posting('a'), posting('b'), posting('c')],
      new Set<string>(),
      flaky,
    );

    expect(result.stats.failed).toBe(1);
    expect(result.stats.enriched).toBe(2);
    expect(result.rows.map((r) => r.fingerprint)).toEqual(['a', 'c']);
    // The failure names the posting so an operator can see the pattern.
    expect(result.failures[0]).toContain('Stripe');
  });

  it('flushes completed rows through onBatch so long runs persist as they go', async () => {
    const batches: number[] = [];
    const result = await enrichPostings(
      ['a', 'b', 'c', 'd', 'e'].map((f) => posting(f)),
      new Set<string>(),
      deps,
      { batchSize: 2, concurrency: 1, onBatch: async (rows) => void batches.push(rows.length) },
    );

    expect(batches).toEqual([2, 2]);
    // The remainder is left for the caller's final insert.
    expect(result.rows).toHaveLength(1);
    expect(result.stats.enriched).toBe(5);
  });

  it('classifies concurrently without losing or duplicating rows', async () => {
    let inFlight = 0;
    let peak = 0;
    const tracking: EnrichDeps = {
      ...deps,
      chat: {
        complete: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return JSON.stringify(CLASSIFICATION);
        },
      },
    };
    const flushed: NewJob[] = [];
    const input = Array.from({ length: 20 }, (_, i) => posting(`f${i}`));

    const result = await enrichPostings(input, new Set<string>(), tracking, {
      batchSize: 6,
      concurrency: 4,
      onBatch: async (rows) => void flushed.push(...rows),
    });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    // Every posting is accounted for exactly once, flushed plus remainder.
    const all = [...flushed, ...result.rows].map((r) => r.fingerprint);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
    expect(result.stats.enriched).toBe(20);
  });
});
