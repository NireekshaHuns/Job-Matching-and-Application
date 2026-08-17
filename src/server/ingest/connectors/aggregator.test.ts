import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../types';
import { aggregatorConnector, formatLocation, toPosting } from './aggregator';
import searchFixture from './__fixtures__/jsearch-search.json';

const QUERIES = [{ query: 'software engineer in United States' }];

/** Records every URL requested so the caps can be asserted on call count. */
function recordingFetcher(
  handler: (url: string, call: number) => { body?: unknown; status?: number },
): { fetcher: Fetcher; urls: string[] } {
  const urls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    const { body = {}, status = 200 } = handler(url, urls.length);
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { fetcher, urls };
}

/** A page of N synthetic jobs plus a cursor, so pagination never terminates. */
function endlessPage(n: number, offset: number) {
  return {
    cursor: `cursor-${offset}`,
    data: Array.from({ length: n }, (_, i) => ({
      job_id: `job-${offset + i}`,
      employer_name: `Company ${offset + i}`,
      job_title: 'Software Engineer',
      job_city: 'Austin',
      job_state: 'TX',
      job_apply_link: `https://example.com/${offset + i}`,
      job_description: 'Work on things.',
    })),
  };
}

describe('aggregatorConnector', () => {
  it('maps API jobs to normalized postings and drops unusable rows', async () => {
    const { fetcher } = recordingFetcher(() => ({ body: { ...searchFixture, cursor: null } }));
    const postings = await aggregatorConnector('key', QUERIES, fetcher).fetch();

    // 5 in the fixture; one has no employer name and one has no apply link.
    expect(postings).toHaveLength(3);

    const [first] = postings;
    expect(first.source).toBe('aggregator:jsearch');
    expect(first.sourceJobId).toBe('jsearch-1001');
    expect(first.company).toBe('Acme, Inc.');
    expect(first.title).toBe('Senior Software Engineer, Backend');
    expect(first.location).toBe('New York, NY');
    // The publisher's own link, not an aggregator redirect.
    expect(first.url).toBe('https://acme.com/careers/1001');
    expect(first.postedAt?.toISOString()).toBe('2026-08-12T14:30:00.000Z');
    expect(first.jdText).toContain('scale APIs');
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
  });

  it('decodes entities in the employer name so the sponsor join key survives', async () => {
    const { fetcher } = recordingFetcher(() => ({ body: { ...searchFixture, cursor: null } }));
    const postings = await aggregatorConnector('key', QUERIES, fetcher).fetch();

    const nestle = postings.find((p) => p.sourceJobId === 'jsearch-1002');
    expect(nestle?.company).toBe('Nestlé USA');
    // `normalizeCompanyName` folds the diacritic and strips the trailing "USA",
    // so the key is NESTLE. The point of the assertion is what it is NOT:
    // an undecoded `Nestl&eacute;` turns the `&` into " AND " and yields
    // "NESTL AND EACUTE USA", which matches no sponsor row and dedups with
    // nothing.
    expect(nestle?.fingerprint.startsWith('NESTLE|')).toBe(true);
  });

  it('sends the api key and the recency filter, and flattens HTML descriptions', async () => {
    const { fetcher, urls } = recordingFetcher(() => ({
      body: { ...searchFixture, cursor: null },
    }));
    const seen: RequestInit[] = [];
    const spy: Fetcher = async (url, init) => {
      seen.push(init ?? {});
      return fetcher(url, init);
    };

    const postings = await aggregatorConnector('secret-key', QUERIES, spy).fetch();

    expect(urls[0]).toContain('date_posted=week');
    expect(urls[0]).toContain('country=us');
    expect((seen[0].headers as Record<string, string>)['x-api-key']).toBe('secret-key');

    const remote = postings.find((p) => p.sourceJobId === 'jsearch-1002');
    expect(remote?.jdText).toContain('Python');
    expect(remote?.jdText).not.toContain('<li>');
  });

  it('stops the entire run on 429 and keeps what it already collected', async () => {
    const { fetcher, urls } = recordingFetcher((_url, call) => {
      if (call === 0) return { body: { ...searchFixture, cursor: null } };
      return { status: 429, body: { message: 'quota exceeded' } };
    });

    const postings = await aggregatorConnector(
      'key',
      [{ query: 'a' }, { query: 'b' }, { query: 'c' }],
      fetcher,
    ).fetch();

    // Query 1 succeeded, query 2 hit the quota wall, query 3 was never attempted.
    expect(urls).toHaveLength(2);
    expect(postings).toHaveLength(3);
  });

  it.each([401, 403])('treats HTTP %i as fatal rather than retrying', async (status) => {
    const { fetcher, urls } = recordingFetcher(() => ({ status, body: {} }));
    const postings = await aggregatorConnector(
      'bad-key',
      [{ query: 'a' }, { query: 'b' }],
      fetcher,
    ).fetch();

    expect(urls).toHaveLength(1);
    expect(postings).toEqual([]);
  });

  it('never exceeds the per-run request cap even with endless pagination', async () => {
    const { fetcher, urls } = recordingFetcher((_url, call) => ({
      body: endlessPage(3, call * 3),
    }));

    const queries = Array.from({ length: 10 }, (_, i) => ({ query: `q${i}` }));
    await aggregatorConnector('key', queries, fetcher, {
      maxRequests: 5,
      maxPagesPerQuery: 50,
    }).fetch();

    expect(urls).toHaveLength(5);
  });

  it('walks pages within a query using the cursor, up to maxPagesPerQuery', async () => {
    const { fetcher, urls } = recordingFetcher((_url, call) => ({
      body: endlessPage(2, call * 2),
    }));

    const postings = await aggregatorConnector('key', QUERIES, fetcher, {
      maxPagesPerQuery: 3,
    }).fetch();

    expect(urls).toHaveLength(3);
    // Page 1 has no cursor param; later pages carry the previous page's cursor.
    expect(urls[0]).not.toContain('cursor=');
    expect(urls[1]).toContain('cursor=cursor-0');
    expect(postings).toHaveLength(6);
  });

  it('stops paginating a query when the cursor runs out', async () => {
    const { fetcher, urls } = recordingFetcher(() => ({
      body: { data: endlessPage(2, 0).data, cursor: null },
    }));

    await aggregatorConnector('key', QUERIES, fetcher, { maxPagesPerQuery: 5 }).fetch();
    expect(urls).toHaveLength(1);
  });

  it('collapses the same job returned by two different queries', async () => {
    const { fetcher } = recordingFetcher(() => ({
      body: { data: endlessPage(2, 0).data, cursor: null },
    }));

    const postings = await aggregatorConnector(
      'key',
      [{ query: 'a' }, { query: 'b' }],
      fetcher,
    ).fetch();

    expect(postings).toHaveLength(2);
  });

  it('survives a non-fatal HTTP error and an unparseable body without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const broken: Fetcher = async () => new Response('not json at all', { status: 200 });
    await expect(aggregatorConnector('key', QUERIES, broken).fetch()).resolves.toEqual([]);

    const serverError: Fetcher = async () => new Response('{}', { status: 500 });
    await expect(aggregatorConnector('key', QUERIES, serverError).fetch()).resolves.toEqual([]);

    warn.mockRestore();
  });

  it('does not throw when the network rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: Fetcher = async () => {
      throw new Error('ECONNRESET');
    };

    await expect(aggregatorConnector('key', QUERIES, failing).fetch()).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('formatLocation', () => {
  it('joins city and state, and prefers the remote marker', () => {
    expect(formatLocation({ job_city: 'Austin', job_state: 'TX' })).toBe('Austin, TX');
    expect(formatLocation({ job_city: 'Austin', job_state: 'TX', job_is_remote: true })).toBe(
      'Remote',
    );
  });

  it('falls back to country, then null', () => {
    expect(formatLocation({ job_country: 'US' })).toBe('US');
    expect(formatLocation({})).toBeNull();
  });

  it('emits "Remote" so the fingerprint matches an ATS copy of the same role', () => {
    const remote = toPosting({
      job_id: 'x',
      employer_name: 'Acme',
      job_title: 'Software Engineer',
      job_is_remote: true,
      job_apply_link: 'https://acme.com/x',
    });
    expect(remote?.fingerprint.endsWith('|remote')).toBe(true);
  });
});
