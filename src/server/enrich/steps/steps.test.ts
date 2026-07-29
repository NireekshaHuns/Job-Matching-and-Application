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
    postedDate: '2026-07-01',
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
});

describe('matchSponsor', () => {
  const history: SponsorHistory = {
    sponsorCount: 120,
    approvalRate: 0.95,
    lastFiledYear: 2025,
  };

  it('tiers via scoreSponsorship using looked-up history', () => {
    const lookup = (key: string) => (key === 'STRIPE' ? history : null);
    const match = matchSponsor('Stripe, Inc.', 'Backend role.', lookup);
    expect(match.tier).toBe('High');
    expect(match.sponsorCount).toBe(120);
  });

  it('returns Low with null count when the company is unmatched', () => {
    const match = matchSponsor('Unknown Co', 'Backend role.', () => null);
    expect(match.tier).toBe('Low');
    expect(match.sponsorCount).toBeNull();
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
      { tier: 'High', reason: 'why', sponsorCount: 10 },
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
    expect(row.isRemote).toBe(true);
    expect(row.techKeywords).toEqual(['go']);
    expect(row.softKeywords).toEqual(['ownership']);
    expect(row).not.toHaveProperty('relevanceScore');
  });
});
