import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import leverFixture from './__fixtures__/lever-acme.json';
import { leverConnector } from './lever';

function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('leverConnector', () => {
  it('maps postings with plain-text JD and normalized fingerprint', async () => {
    const connector = leverConnector(
      [{ token: 'acme', company: 'Acme, Inc.' }],
      fetcherReturning(leverFixture),
    );
    const postings = await connector.fetch();

    expect(postings).toHaveLength(2);
    const [first] = postings;
    expect(first.source).toBe('lever');
    expect(first.title).toBe('Senior Backend Engineer');
    expect(first.location).toBe('New York, NY');
    expect(first.url).toBe('https://jobs.lever.co/acme/abc-123');
    expect(first.jdText).toContain('distributed services in Go');
    expect(first.postedDate).toBe('2024-07-19');
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
  });

  it('flattens HTML description when no plain text is present', async () => {
    const postings = await leverConnector(
      [{ token: 'acme', company: 'Acme' }],
      fetcherReturning(leverFixture),
    ).fetch();
    expect(postings[1].jdText).toBe('React & TypeScript role.');
  });

  it('returns nothing on an error response', async () => {
    const connector = leverConnector(
      [{ token: 'gone', company: 'Gone' }],
      fetcherReturning('', 404),
    );
    expect(await connector.fetch()).toHaveLength(0);
  });
});
