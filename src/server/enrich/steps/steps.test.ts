import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import type { SponsorHistory } from '@/lib/sponsorship';
import type { ChatClient, Embedder } from '../types';
import { buildJobRow } from './build-row';
import { classifyPosting, parseClassification } from './classify';
import { dedupPostings } from './dedup';
import { embedJd } from './embed';
import { matchSponsor } from './sponsor-match';

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    source: 'greenhouse',
    company: 'Stripe',
    title: 'Software Engineer',
    location: 'Remote - US',
    url: 'https://example.com/1',
    jdText: 'Build APIs in Go.',
    postedAt: new Date('2026-07-01T00:00:00Z'),
    fingerprint: 'STRIPE|software engineer|remote us',
    raw: {},
    ...overrides,
  };
}

describe('dedupPostings', () => {
  it('keeps the first occurrence of each fingerprint', () => {
    const result = dedupPostings([
      posting({ fingerprint: 'a', source: 'greenhouse' }),
      posting({ fingerprint: 'a', source: 'github:x' }),
      posting({ fingerprint: 'b' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('greenhouse');
  });

  it('upgrades to the JD-bearing posting on a collision, keeping its position', () => {
    const result = dedupPostings([
      posting({ fingerprint: 'a', source: 'github:simplify', jdText: '' }),
      posting({ fingerprint: 'b', source: 'lever' }),
      posting({ fingerprint: 'a', source: 'greenhouse', jdText: 'Full JD here.' }),
    ]);
    expect(result).toHaveLength(2);
    // 'a' stays first (first occurrence) but now carries the Greenhouse JD.
    expect(result[0].fingerprint).toBe('a');
    expect(result[0].source).toBe('greenhouse');
    expect(result[0].jdText).toBe('Full JD here.');
  });

  it('does not downgrade a JD-bearing winner to a later JD-less duplicate', () => {
    const result = dedupPostings([
      posting({ fingerprint: 'a', source: 'greenhouse', jdText: 'Full JD.' }),
      posting({ fingerprint: 'a', source: 'github:simplify', jdText: '' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('greenhouse');
  });
});

describe('matchSponsor', () => {
  const history: SponsorHistory = {
    sponsorCount: 120,
    approvalRate: 0.95,
    lastFiledYear: 2025,
    newEmploymentApprovals: 60,
    newEmploymentLastYear: 2025,
  };
  const opts = { currentYear: 2026 };

  it('tiers + badges a matched employer and surfaces the confidence', () => {
    const resolve = () => ({ history, key: 'STRIPE', confidence: 0.82, method: 'fuzzy' as const });
    const match = matchSponsor('Stripe, Inc.', 'Backend role.', resolve, opts);
    expect(match.tier).toBe('High');
    expect(match.sponsorCount).toBe(120);
    expect(match.newHireStatus).toBe('sponsors_new_hires');
    expect(match.matchConfidence).toBe(0.82);
  });

  it('returns Low/unknown/null when the company is unmatched', () => {
    const resolve = () => ({
      history: null,
      key: null,
      confidence: null,
      method: 'fuzzy' as const,
    });
    const match = matchSponsor('Unknown Co', 'Backend role.', resolve, opts);
    expect(match.tier).toBe('Low');
    expect(match.sponsorCount).toBeNull();
    expect(match.newHireStatus).toBe('unknown');
    expect(match.matchConfidence).toBeNull();
  });
});

describe('parseClassification / classifyPosting', () => {
  const validJson = JSON.stringify({
    employmentType: 'full_time',
    roleFamily: 'backend',
    seniority: 'entry',
    skills: ['Go', 'go', ' Kafka '],
    softKeywords: ['Ownership', 'ownership'],
  });

  it('parses valid JSON and normalizes skills + soft keywords', () => {
    const c = parseClassification(validJson);
    expect(c.employmentType).toBe('full_time');
    expect(c.skills).toEqual(['go', 'kafka']);
    expect(c.softKeywords).toEqual(['ownership']);
  });

  it('extracts a stated salary and defaults it to null when absent', () => {
    const withSalary = parseClassification(
      JSON.stringify({
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: [],
        salary: '  $150k–$180k  ',
      }),
    );
    expect(withSalary.salary).toBe('$150k–$180k');
    expect(parseClassification(validJson).salary).toBeNull();
  });

  it('defaults soft keywords to [] when omitted', () => {
    const c = parseClassification(
      JSON.stringify({
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: [],
      }),
    );
    expect(c.softKeywords).toEqual([]);
  });

  it('tolerates a ```json fenced response', () => {
    const c = parseClassification('```json\n' + validJson + '\n```');
    expect(c.roleFamily).toBe('backend');
  });

  it('tolerates leading prose before the JSON object', () => {
    const c = parseClassification('Here is the JSON:\n' + validJson);
    expect(c.roleFamily).toBe('backend');
  });

  it('rejects an invalid enum value', () => {
    const bad = JSON.stringify({
      employmentType: 'full_time',
      roleFamily: 'wizardry',
      seniority: 'entry',
      skills: [],
    });
    expect(() => parseClassification(bad)).toThrow();
  });

  it('calls the injected chat client', async () => {
    const chat: ChatClient = { complete: async () => validJson };
    const c = await classifyPosting(posting(), chat);
    expect(c.seniority).toBe('entry');
  });
});

describe('embedJd', () => {
  const embedder: Embedder = {
    embed: async () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
  };

  it('returns a vector for non-empty text', async () => {
    const v = await embedJd('Build APIs.', embedder);
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('returns null for empty text without calling the embedder', async () => {
    let called = false;
    const spy: Embedder = {
      embed: async () => {
        called = true;
        return [];
      },
    };
    expect(await embedJd('   ', spy)).toBeNull();
    expect(called).toBe(false);
  });

  it('throws on a wrong-dimension vector', async () => {
    const bad: Embedder = { embed: async () => [0.1, 0.2] };
    await expect(embedJd('text', bad)).rejects.toThrow();
  });
});

describe('buildJobRow', () => {
  it('assembles a jobs row keeping the two scores separate', () => {
    const row = buildJobRow(
      posting(),
      {
        tier: 'High',
        reason: 'why',
        sponsorCount: 10,
        newHireStatus: 'sponsors_new_hires',
        matchConfidence: 0.9,
      },
      {
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: ['go'],
        softKeywords: ['ownership'],
      },
      null,
    );
    expect(row.fingerprint).toBe('STRIPE|software engineer|remote us');
    expect(row.sponsorTier).toBe('High');
    expect(row.newHireStatus).toBe('sponsors_new_hires');
    expect(row.sponsorMatchConfidence).toBe(0.9);
    expect(row.isRemote).toBe(true);
    expect(row.isUs).toBe(true); // location carries a US signal
    expect(row.techKeywords).toEqual(['go']);
    expect(row.softKeywords).toEqual(['ownership']);
    expect(row).not.toHaveProperty('relevanceScore');
  });

  it('overrides a full_time label to contract when the JD reads as a staffing placement', () => {
    const row = buildJobRow(
      posting({ jdText: 'Our client is seeking a Go engineer. Corp-to-corp only.' }),
      {
        tier: 'Medium',
        reason: 'why',
        sponsorCount: 1,
        newHireStatus: 'transfers_only',
        matchConfidence: 1,
      },
      {
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: ['go'],
        softKeywords: [],
      },
      null,
    );
    expect(row.employmentType).toBe('contract');
  });

  it('derives is_us=false for a known non-US location', () => {
    const row = buildJobRow(
      posting({ location: 'London, UK' }),
      {
        tier: 'Low',
        reason: 'why',
        sponsorCount: 0,
        newHireStatus: 'unknown',
        matchConfidence: null,
      },
      {
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: ['go'],
        softKeywords: [],
      },
      null,
    );
    expect(row.isUs).toBe(false);
  });

  it('leaves a genuine full_time role untouched', () => {
    const row = buildJobRow(
      posting({ jdText: 'Join our platform team building payments in Go.' }),
      {
        tier: 'Medium',
        reason: 'why',
        sponsorCount: 1,
        newHireStatus: 'transfers_only',
        matchConfidence: 1,
      },
      {
        employmentType: 'full_time',
        roleFamily: 'backend',
        seniority: 'entry',
        skills: ['go'],
        softKeywords: [],
      },
      null,
    );
    expect(row.employmentType).toBe('full_time');
  });
});
