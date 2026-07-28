import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { greenhouseConnector, htmlToText } from './greenhouse';
import acmeFixture from './__fixtures__/greenhouse-acme.json';

/** Fake fetcher: returns the fixture for any URL, or a status for empty boards. */
function fetcherReturning(body: unknown, status = 200): Fetcher {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('htmlToText', () => {
  it('decodes entity-encoded markup and flattens to text', () => {
    const text = htmlToText(
      '&lt;p&gt;Build &amp;amp; scale APIs.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;',
    );
    expect(text).toContain('Build & scale APIs.');
    expect(text).toContain('Go');
    expect(text).not.toContain('<');
  });
});

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
    expect(first.postedDate).toBe('2026-07-20');
    expect(first.jdText).toContain('scale APIs');
    // fingerprint uses the normalized company ("ACME"), not the raw string.
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
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
});
