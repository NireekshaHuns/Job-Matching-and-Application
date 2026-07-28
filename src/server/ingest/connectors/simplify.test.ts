import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { simplifyNewGradConnector } from './simplify';
import listingsFixture from './__fixtures__/simplify-listings.json';

function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('simplifyNewGradConnector', () => {
  it('maps active + visible listings and skips the rest', async () => {
    const connector = simplifyNewGradConnector({}, fetcherReturning(listingsFixture));
    const postings = await connector.fetch();

    // 4 listings in, 2 hidden/inactive skipped.
    expect(postings).toHaveLength(2);
    const [stripe] = postings;
    expect(stripe.source).toBe('github:simplify-newgrad');
    expect(stripe.company).toBe('Stripe');
    expect(stripe.location).toBe('New York, NY, Remote in USA');
    expect(stripe.postedDate).toBe('2024-07-19');
    expect(stripe.jdText).toBe('');
    // sponsorship is carried in raw, not acted on by the connector.
    expect((stripe.raw as { sponsorship?: string }).sponsorship).toBe('Other');
  });

  it('returns nothing on a fetch error', async () => {
    const connector = simplifyNewGradConnector({}, fetcherReturning('', 500));
    expect(await connector.fetch()).toHaveLength(0);
  });
});
