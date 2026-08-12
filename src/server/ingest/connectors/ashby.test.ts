import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { ashbyConnector } from './ashby';
import ashbyFixture from './__fixtures__/ashby-acme.json';

function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('ashbyConnector', () => {
  it('maps jobs with JD text and location', async () => {
    const connector = ashbyConnector(
      [{ board: 'acme', company: 'Acme, Inc.' }],
      fetcherReturning(ashbyFixture),
    );
    const postings = await connector.fetch();

    expect(postings).toHaveLength(2);
    const [first] = postings;
    expect(first.source).toBe('ashby');
    expect(first.title).toBe('Software Engineer, Backend');
    expect(first.location).toBe('San Francisco, CA');
    expect(first.url).toBe('https://jobs.ashbyhq.com/acme/1');
    expect(first.jdText).toContain('Kafka');
    expect(first.postedAt?.toISOString().slice(0, 10)).toBe('2026-07-18');
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
  });

  it('marks remote jobs and flattens HTML descriptions', async () => {
    const postings = await ashbyConnector(
      [{ board: 'acme', company: 'Acme' }],
      fetcherReturning(ashbyFixture),
    ).fetch();
    expect(postings[1].location).toBe('Remote');
    expect(postings[1].jdText).toBe('React & Node.js.');
  });

  it('returns nothing on an error response', async () => {
    const connector = ashbyConnector(
      [{ board: 'gone', company: 'Gone' }],
      fetcherReturning('', 500),
    );
    expect(await connector.fetch()).toHaveLength(0);
  });

  // One call returns all postings — no pagination.
  it('returns nothing for an empty or malformed board without throwing', async () => {
    expect(
      await ashbyConnector([{ board: 'e', company: 'E' }], fetcherReturning({ jobs: [] })).fetch(),
    ).toHaveLength(0);
    expect(
      await ashbyConnector(
        [{ board: 'e', company: 'E' }],
        fetcherReturning({ jobs: null }),
      ).fetch(),
    ).toHaveLength(0);
  });
});
