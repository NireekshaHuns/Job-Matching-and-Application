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
    expect(deriveIsUs('Vancouver, WA')).toBe(true); // Washington (safe code), not BC
  });

  it('does not mislabel non-US cities whose state-code doubles as a country code', () => {
    // CA/IN/IL/DE/AR are US state codes AND ISO country codes; the city name wins.
    expect(deriveIsUs('Toronto, CA')).toBe(false);
    expect(deriveIsUs('Mumbai, IN')).toBe(false);
    expect(deriveIsUs('Tel Aviv, IL')).toBe(false);
    expect(deriveIsUs('Berlin, DE')).toBe(false);
    expect(deriveIsUs('Buenos Aires, AR')).toBe(false);
  });

  it('keeps US cities that use a US metro or an unambiguous state code', () => {
    expect(deriveIsUs('Manchester, NH')).toBe(true); // New Hampshire, not UK
    expect(deriveIsUs('Sacramento, CA')).toBe(true); // metro match despite ambiguous CA
    expect(deriveIsUs('Austin, TX')).toBe(true);
  });

  it('flags foreign ISO country-code prefixes used by ATS feeds', () => {
    expect(deriveIsUs('NO-Oslo-MSO')).toBe(false); // Norway
    expect(deriveIsUs('GB-London')).toBe(false);
    expect(deriveIsUs('FR-Paris')).toBe(false);
    expect(deriveIsUs('PL-Warsaw-Lixa C')).toBe(false);
  });

  it('does not let a foreign prefix mislabel US locations', () => {
    // Prefixes that collide with US state codes must NOT be treated as foreign.
    expect(deriveIsUs('US-CO-Denver')).toBe(true); // US marker wins
    expect(deriveIsUs('CO-Denver')).toBe(true); // Denver metro → US
    expect(deriveIsUs('US-CA-San Francisco')).toBe(true);
    expect(deriveIsUs('DE-Wilmington')).toBeNull(); // ambiguous (Delaware vs Germany) → unknown
  });

  it('recognizes newly-added non-US cities and NYC', () => {
    expect(deriveIsUs('Oslo, Norway')).toBe(false);
    expect(deriveIsUs('Milan, Italy')).toBe(false);
    expect(deriveIsUs('NYC')).toBe(true);
  });
});
