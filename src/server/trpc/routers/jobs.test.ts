import { describe, expect, it } from 'vitest';
import {
  combinedRank,
  escapeLike,
  FRESHNESS_MAX,
  FRESHNESS_WINDOW_DAYS,
  freshnessBoost,
  jobListInput,
  resolveJobQueryPlan,
  TIER_WEIGHT,
} from './jobs';

describe('jobListInput', () => {
  it('applies sensible defaults', () => {
    expect(jobListInput.parse({})).toMatchObject({
      includeExcluded: false,
      employmentType: 'full_time',
      remoteOnly: false,
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

describe('freshnessBoost', () => {
  it('is max for a brand-new post and zero past the window', () => {
    expect(freshnessBoost(0)).toBe(FRESHNESS_MAX);
    expect(freshnessBoost(-5)).toBe(FRESHNESS_MAX); // future/clock skew clamps to max
    expect(freshnessBoost(FRESHNESS_WINDOW_DAYS)).toBe(0);
    expect(freshnessBoost(999)).toBe(0);
  });

  it('decays linearly across the window', () => {
    expect(freshnessBoost(FRESHNESS_WINDOW_DAYS / 2)).toBeCloseTo(FRESHNESS_MAX / 2);
  });
});

describe('combinedRank', () => {
  it('keeps tier dominant when fit and freshness are equal', () => {
    const high = combinedRank({ tierRank: 3, fit: 50, ageDays: 5 });
    const medium = combinedRank({ tierRank: 2, fit: 50, ageDays: 5 });
    // A whole tier (TIER_WEIGHT) separates them regardless of the shared fit/freshness.
    expect(high - medium).toBeCloseTo(TIER_WEIGHT);
  });

  it('caps fit + freshness so they cannot leap more than ~one tier', () => {
    // Max fit (100) + max freshness (20) is the most a lower tier can make up.
    const maxedLower = combinedRank({ tierRank: 1, fit: 100, ageDays: 0 });
    const barePlusOne = combinedRank({ tierRank: 2, fit: 0, ageDays: 999 });
    // A maxed Low can overtake a bare Medium — a known, intended property of the blend.
    expect(maxedLower).toBeGreaterThan(barePlusOne);
  });

  it('uses freshness to break near-ties within the same tier and fit', () => {
    const fresh = combinedRank({ tierRank: 1, fit: 50, ageDays: 0 });
    const stale = combinedRank({ tierRank: 1, fit: 50, ageDays: 999 });
    expect(fresh - stale).toBeCloseTo(FRESHNESS_MAX);
  });

  it('matches the documented formula', () => {
    expect(combinedRank({ tierRank: 2, fit: 40, ageDays: FRESHNESS_WINDOW_DAYS })).toBe(
      2 * TIER_WEIGHT + 40,
    );
  });
});
