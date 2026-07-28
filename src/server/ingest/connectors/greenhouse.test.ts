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
    expect(text).not.toContain('<p>');
  });

  it('strips real HTML tags too', () => {
    expect(htmlToText('<p>Hi <b>there</b></p>')).toBe('Hi there');
  });

  it('keeps a comparison operator that is not tag-shaped', () => {
    // "< b" (space after <) is not a tag, so it must survive.
    expect(htmlToText('use a < b for the check')).toBe('use a < b for the check');
  });

  it('turns block/br boundaries into line breaks', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
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
});
