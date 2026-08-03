import { describe, expect, it } from 'vitest';
import { deriveIsUs } from './location';

describe('deriveIsUs', () => {
  it('detects US metros and state codes', () => {
    expect(deriveIsUs('New York, NY')).toBe(true);
    expect(deriveIsUs('San Francisco, CA')).toBe(true);
    expect(deriveIsUs('Austin, TX')).toBe(true); // not fooled by "us" inside "Austin"
    expect(deriveIsUs('Seattle')).toBe(true);
  });

  it('detects explicit US markers and remote-US', () => {
    expect(deriveIsUs('United States')).toBe(true);
    expect(deriveIsUs('Remote (US)')).toBe(true);
    expect(deriveIsUs('Remote, US')).toBe(true);
  });

  it('flags known non-US locations', () => {
    expect(deriveIsUs('London, UK')).toBe(false);
    expect(deriveIsUs('Bangalore, India')).toBe(false);
    expect(deriveIsUs('Toronto, Canada')).toBe(false);
    expect(deriveIsUs('Berlin, Germany')).toBe(false);
    expect(deriveIsUs('Remote - EMEA')).toBe(false);
    expect(deriveIsUs('Sydney, Australia')).toBe(false);
  });

  it('returns null for unknown / bare remote / empty', () => {
    expect(deriveIsUs('Remote')).toBeNull();
    expect(deriveIsUs('')).toBeNull();
    expect(deriveIsUs(null)).toBeNull();
    expect(deriveIsUs(undefined)).toBeNull();
  });

  it('prefers US when a role spans US and non-US', () => {
    expect(deriveIsUs('US or Canada')).toBe(true);
    expect(deriveIsUs('Vancouver, WA')).toBe(true); // Washington state, not BC
  });
});
