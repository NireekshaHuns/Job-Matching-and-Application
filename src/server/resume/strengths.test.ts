import { describe, expect, it } from 'vitest';
import { coverableStrengths } from './strengths';

describe('coverableStrengths', () => {
  it('leads with what the résumé actually demonstrates', () => {
    // Load-bearing: callers truncate this list (6 for the drafter, 4 for the
    // email body), so a flat pass in job order can push the one résumé-backed
    // skill off the end and lead with inventory-only evidence instead.
    const out = coverableStrengths(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      ['g'],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(out[0]).toBe('g');
    expect(out.slice(0, 4)).toEqual(['g', 'a', 'b', 'c']);
  });

  it('keeps job order within each group', () => {
    expect(coverableStrengths(['x', 'y', 'z'], ['z', 'x'], ['y'])).toEqual(['x', 'z', 'y']);
  });

  it('drops keywords the candidate cannot support at all', () => {
    // Truthful by construction — a draft can never claim something unbacked.
    expect(coverableStrengths(['kafka', 'go'], ['go'], [])).toEqual(['go']);
  });

  it('dedupes and is case-insensitive', () => {
    expect(coverableStrengths(['Go', 'go', ' GO '], ['go'], [])).toEqual(['Go']);
  });

  it('returns nothing when there is no overlap', () => {
    expect(coverableStrengths(['cobol'], ['go'], ['rust'])).toEqual([]);
  });
});
