import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { greenhouseConnector } from './greenhouse';
import acmeFixture from './__fixtures__/greenhouse-acme.json';

/** Fake fetcher: returns the fixture for any URL, or a status for empty boards. */
function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('greenhouseConnector', () => {
  it('maps board jobs to normalized postings', async () => {
    const connector = greenhouseConnector(
      [{ token: 'acme', company: 'Acme, Inc.' }],
      fetcherReturning(acmeFixture),
    );
    const postings = await connector.fetch();

    expect(postings).toHaveLength(2);
    const [first] = postings;
    expect(first.source).toBe('greenhouse');
    expect(first.company).toBe('Acme, Inc.');
    expect(first.title).toBe('Senior Software Engineer, Backend');
    expect(first.location).toBe('New York, NY');
    expect(first.url).toBe('https://boards.greenhouse.io/acme/jobs/1001');
    expect(first.postedAt?.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(first.jdText).toContain('scale APIs');
    // fingerprint uses the normalized company ("ACME"), not the raw string.
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
  });

  it('falls back to offices when top-level location is null, and empty JD when no content', async () => {
    const body = {
      jobs: [
        {
          id: 5,
          title: 'Platform Engineer',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/5',
          location: null,
          offices: [{ name: 'Austin, TX' }, { name: 'Remote' }],
        },
      ],
    };
    const connector = greenhouseConnector(
      [{ token: 'acme', company: 'Acme' }],
      fetcherReturning(body),
    );
    const [posting] = await connector.fetch();
    expect(posting.location).toBe('Austin, TX, Remote');
    expect(posting.jdText).toBe('');
  });

  it('returns nothing for an empty board', async () => {
    const connector = greenhouseConnector(
      [{ token: 'empty', company: 'Empty Co' }],
      fetcherReturning({ jobs: [] }),
    );
    expect(await connector.fetch()).toHaveLength(0);
  });

  it('skips a board that errors and continues', async () => {
    const connector = greenhouseConnector(
      [{ token: 'gone', company: 'Gone Co' }],
      fetcherReturning('', 404),
    );
    expect(await connector.fetch()).toHaveLength(0);
  });

  it('reports dead boards instead of swallowing them', async () => {
    // ATS tokens churn 20-40% a year. A bare console.warn meant a board could
    // go dead and the run still looked completely healthy.
    const fetcher: Fetcher = async (url) =>
      url.includes('/gone/')
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify({ jobs: [] }), { status: 200 });

    const connector = greenhouseConnector(
      [
        { token: 'alive', company: 'Alive' },
        { token: 'gone', company: 'Gone' },
      ],
      fetcher,
    );
    await connector.fetch();

    const report = connector.lastReport?.();
    expect(report?.attempted).toBe(2);
    expect(report?.failed).toBe(1);
    expect(report?.failures).toEqual(['gone -> HTTP 404']);
  });

  it('starts each fetch from a clean report', async () => {
    const fetcher: Fetcher = async () => new Response('nope', { status: 500 });
    const connector = greenhouseConnector([{ token: 'a', company: 'A' }], fetcher);
    await connector.fetch();
    await connector.fetch();
    expect(connector.lastReport?.()).toMatchObject({ attempted: 1, failed: 1 });
  });
});
