import { describe, expect, it } from 'vitest';
import {
  computePriority,
  DEFAULT_PRIORITY_WEIGHTS,
  escapeLike,
  FRESHNESS_WINDOW_DAYS,
  freshnessScore,
  jobListInput,
  resolveJobQueryPlan,
  resolveWeights,
  tierScore,
} from './jobs';

describe('jobListInput', () => {
  it('applies sensible defaults', () => {
    expect(jobListInput.parse({})).toMatchObject({
      includeExcluded: false,
      employmentType: 'full_time',
      remoteOnly: false,
      includeNonUs: false,
      sort: 'combined',
      limit: 50,
      offset: 0,
    });
  });

  it('accepts all and validates sort/tier enums', () => {
    expect(jobListInput.parse({ employmentType: 'all' }).employmentType).toBe('all');
    expect(() => jobListInput.parse({ sort: 'sideways' })).toThrow();
    expect(() => jobListInput.parse({ sponsorTiers: ['Platinum'] })).toThrow();
  });

  it('caps the page size and rejects negative offset', () => {
    expect(() => jobListInput.parse({ limit: 1000 })).toThrow();
    expect(() => jobListInput.parse({ offset: -1 })).toThrow();
  });
});

describe('resolveJobQueryPlan', () => {
  const plan = (overrides = {}) => resolveJobQueryPlan(jobListInput.parse(overrides));

  it('hides Excluded by default, independent of tier filters', () => {
    expect(plan().hideExcluded).toBe(true);
    // Selecting tiers must NOT re-expose Excluded when the toggle is off.
    expect(plan({ sponsorTiers: ['High', 'Excluded'] }).hideExcluded).toBe(true);
  });

  it('shows Excluded only when the toggle is on', () => {
    expect(plan({ includeExcluded: true }).hideExcluded).toBe(false);
  });

  it('hides closed jobs by default, shows them only when the toggle is on', () => {
    expect(plan().hideClosed).toBe(true);
    expect(plan({ includeClosed: true }).hideClosed).toBe(false);
  });

  it('hides non-US jobs by default, shows them only when the toggle is on', () => {
    expect(plan().hideNonUs).toBe(true);
    expect(plan({ includeNonUs: true }).hideNonUs).toBe(false);
  });

  it("maps employmentType 'all' to no filter", () => {
    expect(plan({ employmentType: 'all' }).employmentType).toBeNull();
    expect(plan({ employmentType: 'full_time' }).employmentType).toBe('full_time');
  });

  it('normalizes empty filter arrays to null', () => {
    const p = plan({ sponsorTiers: [], roleFamilies: [], newHireStatuses: [] });
    expect(p.sponsorTiers).toBeNull();
    expect(p.roleFamilies).toBeNull();
    expect(p.newHireStatuses).toBeNull();
  });

  it('passes through a new-hire status filter', () => {
    expect(plan({ newHireStatuses: ['sponsors_new_hires'] }).newHireStatuses).toEqual([
      'sponsors_new_hires',
    ]);
    expect(() => jobListInput.parse({ newHireStatuses: ['maybe'] })).toThrow();
  });

  it('hides senior roles by default, and shows them when includeSenior is on', () => {
    expect(plan().hideSenior).toBe(true);
    expect(plan({ includeSenior: true }).hideSenior).toBe(false);
  });

  it('lets an explicit seniority filter override the default hide-senior', () => {
    const p = plan({ seniorities: ['other'] });
    expect(p.seniorities).toEqual(['other']);
    expect(p.hideSenior).toBe(false);
    // Explicit entry/mid selection also counts as "explicit" → no default hide.
    expect(plan({ seniorities: ['entry', 'mid'] }).hideSenior).toBe(false);
    // Explicit filter + includeSenior together still just uses the filter.
    expect(plan({ seniorities: ['entry'], includeSenior: true }).hideSenior).toBe(false);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so the term is literal', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
    expect(escapeLike('c#')).toBe('c#');
  });
});

describe('component scores', () => {
  it('tierScore maps High/Medium/Low/Excluded ranks to 100/~67/~33/0', () => {
    expect(tierScore(3)).toBe(100);
    expect(tierScore(2)).toBeCloseTo(66.67, 1);
    expect(tierScore(1)).toBeCloseTo(33.33, 1);
    expect(tierScore(0)).toBe(0);
  });

  it('freshnessScore is 100 when new, 0 past the window, linear between', () => {
    expect(freshnessScore(0)).toBe(100);
    expect(freshnessScore(-5)).toBe(100); // future/clock skew clamps to max
    expect(freshnessScore(FRESHNESS_WINDOW_DAYS)).toBe(0);
    expect(freshnessScore(999)).toBe(0);
    expect(freshnessScore(FRESHNESS_WINDOW_DAYS / 2)).toBeCloseTo(50);
  });
});

describe('resolveWeights', () => {
  it('defaults when weights are missing or sum to zero', () => {
    expect(resolveWeights(undefined)).toEqual(DEFAULT_PRIORITY_WEIGHTS);
    expect(resolveWeights({ tier: 0, fit: 0, freshness: 0 })).toEqual(DEFAULT_PRIORITY_WEIGHTS);
  });

  it('merges a partial override onto the defaults', () => {
    expect(resolveWeights({ fit: 50 })).toEqual({ ...DEFAULT_PRIORITY_WEIGHTS, fit: 50 });
  });
});

describe('computePriority', () => {
  it('is a weighted average of the three 0..100 components', () => {
    // tier=100, fit=40, freshness=100 with default {60,30,10}:
    // (60*100 + 30*40 + 10*100) / 100 = (6000+1200+1000)/100 = 82
    const b = computePriority({ tierRank: 3, fit: 40, ageDays: 0 });
    expect(b.tier).toBe(100);
    expect(b.fit).toBe(40);
    expect(b.freshness).toBe(100);
    expect(b.priority).toBeCloseTo(82);
  });

  it('keeps tier dominant under the default mix', () => {
    const high = computePriority({ tierRank: 3, fit: 50, ageDays: 5 }).priority;
    const medium = computePriority({ tierRank: 2, fit: 50, ageDays: 5 }).priority;
    // One tier step (33.3 pts) × the 0.6 tier weight ≈ 20 priority points.
    expect(high - medium).toBeCloseTo((100 / 3) * 0.6, 1);
  });

  it('honors custom weights (e.g. fit-first)', () => {
    const fitFirst = { tier: 0, fit: 100, freshness: 0 };
    expect(computePriority({ tierRank: 3, fit: 42, ageDays: 0 }, fitFirst).priority).toBe(42);
  });

  it('returns 0 priority when all weights are zero (no divide-by-zero)', () => {
    expect(
      computePriority({ tierRank: 3, fit: 100, ageDays: 0 }, { tier: 0, fit: 0, freshness: 0 })
        .priority,
    ).toBe(0);
  });
});
