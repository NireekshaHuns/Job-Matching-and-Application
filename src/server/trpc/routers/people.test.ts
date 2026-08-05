import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';
import {
  CACHE_TTL_DAYS,
  companyDomainGuess,
  findPeopleInput,
  importPersonInput,
  isCacheFresh,
  peopleCacheKey,
} from './people';

describe('companyDomainGuess', () => {
  it('slugifies a company name into a .com domain, dropping suffixes/punctuation', () => {
    expect(companyDomainGuess('Stripe')).toBe('stripe.com');
    expect(companyDomainGuess('Pure Storage')).toBe('purestorage.com');
    expect(companyDomainGuess('Acme, Inc.')).toBe('acme.com');
    expect(companyDomainGuess('')).toBe('');
  });
});

describe('peopleCacheKey', () => {
  it('normalizes company + domain (case/space-insensitive) and stays stable', () => {
    expect(peopleCacheKey('  Stripe ', 'Stripe.com')).toBe('["stripe","stripe.com"]');
    expect(peopleCacheKey('Stripe')).toBe('["stripe",""]');
    // Same inputs → same key (cache hits are reliable).
    expect(peopleCacheKey('Acme', 'acme.io')).toBe(peopleCacheKey('acme', 'ACME.IO'));
  });

  it('does not collide when a value contains the delimiter', () => {
    expect(peopleCacheKey('Acme|', 'evil.com')).not.toBe(peopleCacheKey('Acme', '|evil.com'));
  });
});

describe('people.find gating', () => {
  it('returns configured:false (and touches no db) when no provider key is set', async () => {
    vi.stubEnv('HUNTER_API_KEY', '');
    vi.stubEnv('APOLLO_API_KEY', '');
    // db is a poison object: any access throws, proving the no-key path is db-free.
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('db must not be touched without a provider key');
        },
      },
    ) as unknown as DB;

    const caller = createCaller({ db } as Context);
    expect(await caller.people.find({ company: 'Stripe' })).toEqual({
      configured: false,
      cached: false,
      people: [],
    });
    vi.unstubAllEnvs();
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
