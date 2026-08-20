import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import {
  buildJdKeywordMessages,
  countRepetitions,
  extractJdKeywords,
  JD_KEYWORD_SYSTEM_PROMPT,
  keywordImportance,
  parseJdKeywordAnalysis,
} from './jd-keywords';

/** Shorthand for the model's raw response. */
function raw(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function kw(term: string, over: Record<string, unknown> = {}) {
  return { term, bucket: 'technical', section: 'required', aliases: [], orGroup: null, ...over };
}

const ctx = { jdText: 'We need Kafka and ownership.', jobTitle: 'Backend Engineer' };

describe('buildJdKeywordMessages', () => {
  it('carries the posting and the title, and names both mining sources', () => {
    const { system, user } = buildJdKeywordMessages({
      jdText: 'Build features from start to finish.',
      jobTitle: 'Cloud Network Engineer',
    });
    expect(system).toBe(JD_KEYWORD_SYSTEM_PROMPT);
    expect(system).toContain('MINE TWO PLACES');
    expect(system).toContain('responsibilities');
    expect(system).toContain('OR-GROUPS');
    // The model must not be the one assigning weight — see the module header.
    expect(system).toContain('Do NOT rank, score, weight, or order anything');
    expect(user).toContain('Cloud Network Engineer');
    expect(user).toContain('Build features from start to finish.');
  });

  it('says so when no title was given', () => {
    expect(buildJdKeywordMessages({ jdText: 'x' }).user).toContain('(not given)');
  });
});

describe('parseJdKeywordAnalysis', () => {
  it('normalizes, trims, lowercases and dedupes', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('  Kafka '), kw('KAFKA'), kw('kafka')] }),
      ctx,
    );
    expect(analysis.keywords.map((k) => k.term)).toEqual(['kafka']);
  });

  it('lets technical win when the model puts one term in both buckets', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('kafka', { bucket: 'soft' }), kw('kafka', { bucket: 'technical' })] }),
      ctx,
    );
    expect(analysis.keywords[0].bucket).toBe('technical');
  });

  it('keeps the stronger section when a term appears twice', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [
          kw('kafka', { section: 'responsibilities' }),
          kw('kafka', { section: 'required' }),
        ],
      }),
      ctx,
    );
    expect(analysis.keywords[0].section).toBe('required');
  });

  it('degrades an unknown section and bucket instead of losing the whole call', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('kafka', { section: 'strongly-preferred', bucket: 'hard' })] }),
      ctx,
    );
    expect(analysis.keywords[0].section).toBe('unspecified');
    expect(analysis.keywords[0].bucket).toBe('technical');
  });

  it('tolerates prose and fences around the JSON', () => {
    const analysis = parseJdKeywordAnalysis(
      `Sure!\n\`\`\`json\n${raw({ keywords: [kw('kafka')] })}\n\`\`\``,
      ctx,
    );
    expect(analysis.keywords).toHaveLength(1);
  });

  it('throws when there is no JSON object at all', () => {
    expect(() => parseJdKeywordAnalysis('I cannot help with that.', ctx)).toThrow(/No JSON object/);
  });

  it('drops benefits and perk noise the prompt already forbids', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('book clubs'), kw('401k matching'), kw('java')] }),
      ctx,
    );
    expect(analysis.keywords.map((k) => k.term)).toEqual(['java']);
  });

  it('drops aliases that merely repeat the term, and caps the rest', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('git', { aliases: ['Git', 'source control', 'vcs', 'a', 'b', 'c'] })] }),
      ctx,
    );
    expect(analysis.keywords[0].aliases).not.toContain('git');
    expect(analysis.keywords[0].aliases.length).toBeLessThanOrEqual(4);
  });

  it('upgrades the legacy {tech, soft} shape rather than returning nothing', () => {
    const analysis = parseJdKeywordAnalysis(raw({ tech: ['Kafka'], soft: ['Ownership'] }), ctx);
    expect(analysis.keywords.map((k) => [k.term, k.bucket, k.section])).toEqual([
      ['kafka', 'technical', 'unspecified'],
      ['ownership', 'soft', 'unspecified'],
    ]);
  });
});

describe('importance', () => {
  it('ranks a required keyword mentioned once above a bonus one repeated four times', () => {
    // The ladder, which is the reason importance is computed and not asked for:
    // bonus 2 + 3 repetitions < required 8, whatever the model would have said.
    const required = keywordImportance({ section: 'required', repetitions: 1, inTitle: false });
    const bonus = keywordImportance({ section: 'bonus', repetitions: 4, inTitle: false });
    expect(required).toBeGreaterThan(bonus);
  });

  it('boosts a term named in the job title', () => {
    const plain = keywordImportance({ section: 'required', repetitions: 1, inTitle: false });
    const titled = keywordImportance({ section: 'required', repetitions: 1, inTitle: true });
    expect(titled).toBe(plain + 2);
  });

  it('clamps to 1..10', () => {
    expect(keywordImportance({ section: 'required', repetitions: 9, inTitle: true })).toBe(10);
    expect(keywordImportance({ section: 'bonus', repetitions: 0, inTitle: false })).toBe(2);
  });

  it('sorts the analysis by importance, and applies the title boost from the real title', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [kw('vxlan', { section: 'bonus' }), kw('networking', { section: 'required' })],
      }),
      { jdText: 'vxlan vxlan vxlan vxlan networking', jobTitle: 'Cloud Networking Engineer' },
    );
    expect(analysis.keywords.map((k) => k.term)).toEqual(['networking', 'vxlan']);
  });
});

describe('countRepetitions', () => {
  it('counts the term and its aliases', () => {
    expect(
      countRepetitions('kafka streams and kafka topics, plus kinesis', 'kafka', ['kinesis']),
    ).toBe(3);
  });

  it('respects word boundaries so "go" is not found in "mongodb"', () => {
    expect(countRepetitions('we use mongodb and golang', 'go', [])).toBe(0);
  });

  it('finds symbol-bearing terms', () => {
    expect(countRepetitions('experience with c# and ci/cd', 'c#', [])).toBe(1);
    expect(countRepetitions('experience with c# and ci/cd', 'ci/cd', [])).toBe(1);
  });
});

describe('caps', () => {
  it('keeps the highest-importance bonus items, not the first ones the model emitted', () => {
    // Ten bonus keywords, cap 6. The last two are repeated in the posting, so
    // they must survive: the old `.slice(0, 40)` on model order would drop them.
    const terms = Array.from({ length: 10 }, (_, i) => `bonus${i}`);
    const jdText = `${terms.join(' ')} bonus8 bonus8 bonus9 bonus9`;
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: terms.map((t) => kw(t, { section: 'bonus' })) }),
      { jdText },
    );
    expect(analysis.keywords).toHaveLength(6);
    expect(analysis.keywords.map((k) => k.term)).toContain('bonus8');
    expect(analysis.keywords.map((k) => k.term)).toContain('bonus9');
    expect(analysis.dropped).toBe(4);
  });

  it('caps the soft bucket without touching the technical one', () => {
    const soft = Array.from({ length: 20 }, (_, i) => kw(`soft${i}`, { bucket: 'soft' }));
    const analysis = parseJdKeywordAnalysis(raw({ keywords: soft }), { jdText: 'x' });
    expect(analysis.keywords).toHaveLength(15);
    expect(analysis.dropped).toBe(5);
  });
});

describe('or-groups', () => {
  it('links surviving members and assigns a stable id', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [
          kw('python', { orGroup: 'Python, Java, or Golang' }),
          kw('java', { orGroup: 'Python, Java, or Golang' }),
          kw('golang', { orGroup: 'Python, Java, or Golang' }),
        ],
        orGroups: [{ label: 'Python, Java, or Golang', members: ['Python', 'Java', 'Golang'] }],
      }),
      { jdText: 'python java golang' },
    );
    expect(analysis.orGroups).toEqual([
      { id: 'or-1', label: 'Python, Java, or Golang', members: ['python', 'java', 'golang'] },
    ]);
    expect(analysis.keywords.every((k) => k.orGroupId === 'or-1')).toBe(true);
  });

  it('drops a group left with one member and clears the dangling id', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [kw('python', { orGroup: 'Python or Golang' })],
        orGroups: [{ label: 'Python or Golang', members: ['Python', 'Golang'] }],
      }),
      { jdText: 'python' },
    );
    expect(analysis.orGroups).toEqual([]);
    expect(analysis.keywords[0].orGroupId).toBeNull();
  });

  it('clears an orGroup label the model never declared as a group', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('python', { orGroup: 'Python or Golang' })], orGroups: [] }),
      { jdText: 'python' },
    );
    expect(analysis.keywords[0].orGroupId).toBeNull();
  });
});

describe('extractJdKeywords', () => {
  it('runs the injected chat client through the parser', async () => {
    const chat: ChatClient = {
      complete: async () => raw({ keywords: [kw('kafka', { aliases: ['event streaming'] })] }),
    };
    const analysis = await extractJdKeywords({ jdText: 'kafka kafka', jobTitle: 'SWE' }, chat);
    expect(analysis.keywords[0]).toMatchObject({
      term: 'kafka',
      bucket: 'technical',
      section: 'required',
      aliases: ['event streaming'],
      repetitions: 2,
    });
  });
});
