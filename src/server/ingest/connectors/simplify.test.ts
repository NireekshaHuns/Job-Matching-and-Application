import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../types';
import { isSoftwareCategory, simplifyNewGradConnector } from './simplify';
import listingsFixture from './__fixtures__/simplify-listings.json';

function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('isSoftwareCategory', () => {
  it('accepts every covered label, case- and space-insensitively', () => {
    expect(isSoftwareCategory('Software')).toBe(true);
    expect(isSoftwareCategory('Software Engineering')).toBe(true);
    expect(isSoftwareCategory('AI/ML/Data')).toBe(true);
    expect(isSoftwareCategory('Data Science, AI & Machine Learning')).toBe(true);
    expect(isSoftwareCategory('  software  ')).toBe(true);
    expect(isSoftwareCategory('SOFTWARE ENGINEERING')).toBe(true);
    expect(isSoftwareCategory('ai/ml/data')).toBe(true);
  });

  it('rejects the sections the board does not cover, and a missing label', () => {
    expect(isSoftwareCategory('Hardware')).toBe(false);
    expect(isSoftwareCategory('Quant')).toBe(false);
    expect(isSoftwareCategory('Quantitative Finance')).toBe(false);
    expect(isSoftwareCategory('Product')).toBe(false);
    expect(isSoftwareCategory('Product Management')).toBe(false);
    expect(isSoftwareCategory(undefined)).toBe(false);
    expect(isSoftwareCategory('')).toBe(false);
  });
});

describe('simplifyNewGradConnector', () => {
  it('maps active, visible, software-category listings and skips the rest', async () => {
    const connector = simplifyNewGradConnector({}, fetcherReturning(listingsFixture));
    const postings = await connector.fetch();

    // 8 listings in: 1 hidden, 1 inactive, 2 out-of-scope, 1 uncategorized.
    expect(postings.map((p) => p.company)).toEqual(['Stripe', 'Databricks', 'Model Co']);
    const [stripe] = postings;
    expect(stripe.source).toBe('github:simplify-newgrad');
    expect(stripe.company).toBe('Stripe');
    expect(stripe.location).toBe('New York, NY, Remote in USA');
    expect(stripe.postedAt?.toISOString().slice(0, 10)).toBe('2024-07-19');
    expect(stripe.jdText).toBe('');
    // sponsorship is carried in raw, not acted on by the connector.
    expect((stripe.raw as { sponsorship?: string }).sponsorship).toBe('Other');
  });

  it('keeps the legacy "Software Engineering" label as well as "Software"', async () => {
    const connector = simplifyNewGradConnector({}, fetcherReturning(listingsFixture));
    const postings = await connector.fetch();
    expect(postings.some((p) => p.company === 'Databricks')).toBe(true);
  });

  it('warns when live listings exist but no category matches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renamed = [
      {
        company_name: 'Renamed Co',
        title: 'Software Engineer',
        url: 'https://jobs.example.com/renamed/1',
        category: 'SWE',
        active: true,
        is_visible: true,
      },
    ];
    const connector = simplifyNewGradConnector({}, fetcherReturning(renamed));

    expect(await connector.fetch()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('category label changed'));
    warn.mockRestore();
  });

  it('stays quiet when the feed itself is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const connector = simplifyNewGradConnector({}, fetcherReturning([]));

    expect(await connector.fetch()).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns nothing on a fetch error', async () => {
    const connector = simplifyNewGradConnector({}, fetcherReturning('', 500));
    expect(await connector.fetch()).toHaveLength(0);
  });
});
