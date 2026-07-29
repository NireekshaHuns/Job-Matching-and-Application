import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';
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
  lookup: () => null,
};

function posting(fingerprint: string, overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    source: 'greenhouse',
    company: 'Stripe',
    title: 'Software Engineer',
    location: 'Remote',
    url: `https://example.com/${fingerprint}`,
    jdText: 'Build APIs.',
    postedDate: '2026-07-01',
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
    // 4 in -> 3 unique -> b already exists -> a and c enriched.
    expect(result.stats).toEqual({ fetched: 4, deduped: 3, enriched: 2 });
    expect(result.rows.map((r) => r.fingerprint).sort()).toEqual(['a', 'c']);
    expect(result.rows[0].sponsorTier).toBe('Low');
    expect(result.rows[0].roleFamily).toBe('backend');
  });

  it('produces no rows when everything already exists', async () => {
    const result = await enrichPostings([posting('a')], new Set(['a']), deps);
    expect(result.rows).toHaveLength(0);
    expect(result.stats.enriched).toBe(0);
  });
});
