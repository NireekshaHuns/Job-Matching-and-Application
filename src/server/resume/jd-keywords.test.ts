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
      raw({
        keywords: [kw('book clubs'), kw('401k matching'), kw('equity compensation'), kw('java')],
      }),
      ctx,
    );
    expect(analysis.keywords.map((k) => k.term)).toEqual(['java']);
    // Everything dropped is accounted for, not just what the caps removed.
    expect(analysis.dropped).toBe(3);
  });

  it('keeps real keywords that merely contain a perk word', () => {
    // Matching "vision" or "equity" as a substring silently deletes the single
    // most important keyword on a computer-vision or equity-research posting.
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [
          kw('computer vision'),
          kw('vision transformers'),
          kw('equity research'),
          kw('vision'),
        ],
      }),
      { jdText: 'computer vision, vision transformers, equity research' },
    );
    expect(analysis.keywords.map((k) => k.term).sort()).toEqual([
      'computer vision',
      'equity research',
      'vision transformers',
    ]);
  });

  it('keeps the good elements when one is malformed', () => {
    // A model half-remembering the older shape emits a bare string. An
    // array-level `.catch` would discard a call that has already been paid for.
    const analysis = parseJdKeywordAnalysis(
      `{"keywords":[${JSON.stringify(kw('kafka'))},"kubernetes",null]}`,
      ctx,
    );
    expect(analysis.keywords.map((k) => k.term)).toEqual(['kafka']);
  });

  it('drops aliases that merely repeat the term, and caps the rest', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({ keywords: [kw('git', { aliases: ['Git', 'source control', 'vcs', 'a', 'b', 'c'] })] }),
      ctx,
    );
    // Exact, so both the self-alias drop and the cap are pinned — asserting
    // only "does not contain git" would also pass on an empty list.
    expect(analysis.keywords[0].aliases).toEqual(['source control', 'vcs', 'a', 'b']);
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

  it('counts a phrase and an alias nested inside it once', () => {
    // The prompt asks for umbrella and implementation aliases, so overlapping
    // needles are the normal case. Counting both would hand a keyword mentioned
    // once the repetition bonus for two.
    expect(
      countRepetitions('we do cloud networking here', 'networking', ['cloud networking']),
    ).toBe(1);
  });

  it('finds a multi-word term that wrapped in the pasted posting', () => {
    const analysis = parseJdKeywordAnalysis(raw({ keywords: [kw('distributed systems')] }), {
      jdText: 'experience with distributed\nsystems at scale',
    });
    expect(analysis.keywords[0].repetitions).toBe(1);
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

  it('does not let technical bonus items starve the behavioural ones', () => {
    // A shared per-section counter would spend the whole "nice to have" budget
    // on the technical list and leave no room for a single soft keyword.
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [
          ...Array.from({ length: 8 }, (_, i) => kw(`tech${i}`, { section: 'bonus' })),
          kw('curiosity', { section: 'bonus', bucket: 'soft' }),
        ],
      }),
      { jdText: 'x' },
    );
    expect(analysis.keywords.map((k) => k.term)).toContain('curiosity');
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

  it('never leaks the internal pending sentinel, even past the group cap', () => {
    // Ten declared groups against a cap of eight: the members of the last two
    // must come back with a null id, not the placeholder used while building.
    const members = Array.from({ length: 20 }, (_, i) => `lang${i}`);
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: members.map((m, i) => kw(m, { orGroup: `group${Math.floor(i / 2)}` })),
        orGroups: Array.from({ length: 10 }, (_, g) => ({
          label: `group${g}`,
          members: [`lang${g * 2}`, `lang${g * 2 + 1}`],
        })),
      }),
      { jdText: members.join(' ') },
    );
    expect(analysis.orGroups).toHaveLength(8);
    expect(analysis.keywords.every((k) => k.orGroupId !== 'pending')).toBe(true);
    expect(analysis.keywords.filter((k) => k.orGroupId === null)).toHaveLength(4);
  });

  it('gives a term shared by two groups to the first one only', () => {
    const analysis = parseJdKeywordAnalysis(
      raw({
        keywords: [kw('python'), kw('java'), kw('ruby')],
        orGroups: [
          { label: 'Python or Java', members: ['python', 'java'] },
          { label: 'Python or Ruby', members: ['python', 'ruby'] },
        ],
      }),
      { jdText: 'python java ruby' },
    );
    // The second group is left with one member, so it is not a choice at all.
    expect(analysis.orGroups).toEqual([
      { id: 'or-1', label: 'Python or Java', members: ['python', 'java'] },
    ]);
    expect(analysis.keywords.find((k) => k.term === 'ruby')?.orGroupId).toBeNull();
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
