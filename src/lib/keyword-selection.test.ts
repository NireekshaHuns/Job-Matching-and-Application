import { describe, expect, it } from 'vitest';
import type { EvidenceGrade, GradedKeyword } from '@/server/resume/keyword-evidence';
import type { JdOrGroup } from '@/server/resume/jd-keywords';
import {
  buildPickerGroups,
  defaultKeywordSelection,
  splitSelection,
  type PickerRow,
} from './keyword-selection';

const SCORE: Record<EvidenceGrade, number> = { strong: 4, moderate: 2, weak: 1, missing: 0 };

function kw(term: string, grade: EvidenceGrade, over: Partial<GradedKeyword> = {}): GradedKeyword {
  return {
    term,
    bucket: 'technical',
    section: 'required',
    aliases: [],
    orGroupId: null,
    repetitions: 1,
    importance: 8,
    evidence: {
      grade,
      score: SCORE[grade],
      matchedTerm: grade === 'missing' ? null : term,
      viaAlias: false,
      bulletCount: grade === 'strong' ? 2 : grade === 'missing' ? 0 : 1,
      sample: grade === 'missing' ? null : `A bullet mentioning ${term}`,
    },
    ...over,
  };
}

function group(id: string, label: string, members: string[]): JdOrGroup {
  return { id, label, members };
}

describe('defaultKeywordSelection', () => {
  it('ticks what the corpus supports and leaves the rest alone', () => {
    const keywords = [
      kw('java', 'strong'),
      kw('kafka', 'moderate'),
      kw('bgp', 'missing'),
      kw('vxlan', 'weak'),
    ];
    expect(defaultKeywordSelection({ keywords, orGroups: [] })).toEqual(['java', 'kafka']);
  });

  it('ticks only the best-evidenced member of an either/or requirement', () => {
    // Having Java already satisfies "Python, Java, or Golang" — Golang must not
    // be ticked just because the posting listed it.
    const keywords = [
      kw('python', 'moderate', { orGroupId: 'or-1' }),
      kw('java', 'strong', { orGroupId: 'or-1' }),
      kw('golang', 'missing', { orGroupId: 'or-1' }),
    ];
    const orGroups = [group('or-1', 'Python, Java, or Golang', ['python', 'java', 'golang'])];
    expect(defaultKeywordSelection({ keywords, orGroups })).toEqual(['java']);
  });

  it('breaks a tie inside a group on importance', () => {
    const keywords = [
      kw('gcp', 'moderate', { orGroupId: 'or-1', importance: 5 }),
      kw('aws', 'moderate', { orGroupId: 'or-1', importance: 9 }),
    ];
    const orGroups = [group('or-1', 'AWS, GCP or Azure', ['gcp', 'aws'])];
    expect(defaultKeywordSelection({ keywords, orGroups })).toEqual(['aws']);
  });

  it('ticks nothing in a group where nothing has evidence', () => {
    const keywords = [
      kw('bgp', 'missing', { orGroupId: 'or-1' }),
      kw('vxlan', 'weak', { orGroupId: 'or-1' }),
    ];
    const orGroups = [group('or-1', 'BGP or VXLAN', ['bgp', 'vxlan'])];
    expect(defaultKeywordSelection({ keywords, orGroups })).toEqual([]);
  });

  it('returns ticks in importance order', () => {
    const keywords = [
      kw('java', 'strong', { importance: 10 }),
      kw('redis', 'strong', { importance: 4 }),
    ];
    expect(defaultKeywordSelection({ keywords, orGroups: [] })).toEqual(['java', 'redis']);
  });
});

describe('buildPickerGroups', () => {
  it('splits by bucket and puts either/or requirements first', () => {
    const keywords = [
      kw('java', 'strong', { orGroupId: 'or-1' }),
      kw('golang', 'missing', { orGroupId: 'or-1' }),
      kw('kafka', 'moderate'),
      kw('mentorship', 'moderate', { bucket: 'soft' }),
    ];
    const orGroups = [group('or-1', 'Java or Golang', ['java', 'golang'])];
    const groups = buildPickerGroups({ keywords, orGroups });

    expect(groups.map((g) => g.bucket)).toEqual(['technical', 'soft']);
    expect(groups[0].rows[0].kind).toBe('orGroup');
    expect(groups[0].rows[1]).toEqual({ kind: 'keyword', keyword: keywords[2] });
    expect(groups[1].rows).toHaveLength(1);
  });

  it('renders a grouped keyword exactly once', () => {
    const keywords = [
      kw('java', 'strong', { orGroupId: 'or-1' }),
      kw('golang', 'missing', { orGroupId: 'or-1' }),
    ];
    const orGroups = [group('or-1', 'Java or Golang', ['java', 'golang'])];
    const rows = buildPickerGroups({ keywords, orGroups }).flatMap((g) => g.rows);
    const terms = rows.flatMap((r: PickerRow) =>
      r.kind === 'keyword' ? [r.keyword.term] : r.members.map((m) => m.term),
    );
    expect(terms).toEqual(['java', 'golang']);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('flags a group nothing satisfies', () => {
    const keywords = [
      kw('bgp', 'missing', { orGroupId: 'or-1' }),
      kw('vxlan', 'missing', { orGroupId: 'or-1' }),
    ];
    const orGroups = [group('or-1', 'BGP or VXLAN', ['bgp', 'vxlan'])];
    const row = buildPickerGroups({ keywords, orGroups })[0].rows[0];
    expect(row.kind === 'orGroup' && row.satisfied).toBe(false);
  });

  it('preserves the importance order it was handed, and omits an empty bucket', () => {
    const keywords = [
      kw('redis', 'strong', { importance: 3 }),
      kw('java', 'strong', { importance: 10 }),
    ];
    const groups = buildPickerGroups({ keywords, orGroups: [] });
    expect(groups).toHaveLength(1);
    // `keywords` arrives already sorted by importance; the rows must preserve it.
    expect(groups[0].rows.map((r) => (r.kind === 'keyword' ? r.keyword.term : ''))).toEqual([
      'redis',
      'java',
    ]);
  });

  it('drops a group whose members did not survive the caps', () => {
    const keywords = [kw('java', 'strong', { orGroupId: 'or-1' })];
    const orGroups = [group('or-1', 'Java or Golang', ['java', 'golang'])];
    const rows = buildPickerGroups({ keywords, orGroups })[0].rows;
    expect(rows).toEqual([{ kind: 'keyword', keyword: keywords[0] }]);
  });
});

describe('splitSelection', () => {
  const keywords = [
    kw('java', 'strong', { importance: 10 }),
    kw('kafka', 'moderate', { importance: 8 }),
    kw('bgp', 'missing', { importance: 2 }),
    kw('vxlan', 'weak', { importance: 2 }),
  ];

  it('partitions by evidence, preserving importance order', () => {
    expect(splitSelection(['vxlan', 'bgp', 'kafka', 'java'], keywords)).toEqual({
      defensible: ['java', 'kafka'],
      adjacentOnly: ['bgp', 'vxlan'],
    });
  });

  it('ignores keywords that were not ticked', () => {
    expect(splitSelection(['java'], keywords)).toEqual({ defensible: ['java'], adjacentOnly: [] });
  });

  it('treats a term outside the analysis as defensible', () => {
    // Hand-added, or left over from a previous extraction. The old behaviour
    // claimed every ticked keyword, so this is the safe direction to fall back in.
    expect(splitSelection(['java', 'terraform'], keywords)).toEqual({
      defensible: ['java', 'terraform'],
      adjacentOnly: [],
    });
  });

  it('handles an empty analysis', () => {
    expect(splitSelection(['java'], [])).toEqual({ defensible: ['java'], adjacentOnly: [] });
  });
});
