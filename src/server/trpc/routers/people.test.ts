import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_DAYS,
  findPeopleInput,
  importPersonInput,
  isCacheFresh,
  peopleCacheKey,
} from './people';

describe('peopleCacheKey', () => {
  it('normalizes company + domain (case/space-insensitive) and stays stable', () => {
    expect(peopleCacheKey('  Stripe ', 'Stripe.com')).toBe('stripe|stripe.com');
    expect(peopleCacheKey('Stripe')).toBe('stripe|');
    // Same inputs → same key (cache hits are reliable).
    expect(peopleCacheKey('Acme', 'acme.io')).toBe(peopleCacheKey('acme', 'ACME.IO'));
  });
});

describe('isCacheFresh', () => {
  const now = new Date('2026-07-15T00:00:00Z');

  it('is fresh within the TTL and stale beyond it', () => {
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(isCacheFresh(oneDayAgo, now)).toBe(true);
    expect(isCacheFresh(eightDaysAgo, now)).toBe(false);
    // Exactly at the TTL edge is considered stale (strict <).
    const atEdge = new Date(now.getTime() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(isCacheFresh(atEdge, now)).toBe(false);
  });
});

describe('input schemas', () => {
  it('find requires a company; domain optional', () => {
    expect(findPeopleInput.parse({ company: 'Stripe' })).toEqual({ company: 'Stripe' });
    expect(() => findPeopleInput.parse({})).toThrow();
  });

  it('import validates email/url and requires a job + name', () => {
    expect(() =>
      importPersonInput.parse({ jobId: 1, name: 'Jane', email: 'not-an-email' }),
    ).toThrow();
    expect(
      importPersonInput.parse({ jobId: 1, name: 'Jane', email: 'jane@acme.com' }),
    ).toMatchObject({ jobId: 1, name: 'Jane' });
  });
});
