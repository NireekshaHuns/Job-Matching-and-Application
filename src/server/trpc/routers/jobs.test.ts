import { describe, expect, it } from 'vitest';
import { escapeLike, jobListInput, resolveJobQueryPlan } from './jobs';

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
    const p = plan({ sponsorTiers: [], roleFamilies: [] });
    expect(p.sponsorTiers).toBeNull();
    expect(p.roleFamilies).toBeNull();
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so the term is literal', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
    expect(escapeLike('c#')).toBe('c#');
  });
});
