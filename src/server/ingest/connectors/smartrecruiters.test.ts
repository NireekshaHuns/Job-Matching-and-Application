import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { smartRecruitersConnector } from './smartrecruiters';
import detailFixture from './__fixtures__/smartrecruiters-acme-detail.json';
import listFixture from './__fixtures__/smartrecruiters-acme-list.json';

/** Route list vs. per-posting detail requests to the right fixture. */
function routingFetcher(
  list: unknown,
  details: Record<string, unknown>,
  opts: { listStatus?: number; detailStatus?: number } = {},
): Fetcher {
  return async (url) => {
    const detail = url.match(/\/postings\/([^?]+)$/);
    if (detail) {
      const body = details[detail[1]];
      return new Response(JSON.stringify(body ?? {}), { status: opts.detailStatus ?? 200 });
    }
    return new Response(JSON.stringify(list), { status: opts.listStatus ?? 200 });
  };
}

describe('smartRecruitersConnector', () => {
  it('maps postings + per-posting JD to the normalized shape', async () => {
    const connector = smartRecruitersConnector(
      [{ identifier: 'Acme', company: 'Acme, Inc.' }],
      routingFetcher(listFixture, detailFixture),
    );
    const postings = await connector.fetch();

    expect(postings).toHaveLength(2);
    const [first, second] = postings;

    expect(first.source).toBe('smartrecruiters');
    expect(first.sourceJobId).toBe('1001');
    expect(first.company).toBe('Acme, Inc.');
    expect(first.title).toBe('Senior Software Engineer, Backend');
    expect(first.location).toBe('New York, NY');
    expect(first.url).toBe('https://jobs.smartrecruiters.com/Acme/1001');
    expect(first.postedDate).toBe('2026-07-18');
    expect(first.jdText).toContain('scale APIs in Go');
    expect(first.jdText).toContain('5+ years');
    // fingerprint uses the normalized company ("ACME"), not the raw string.
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);

    // An empty city/region with remote=true collapses to just "Remote".
    expect(second.location).toBe('Remote');
    expect(second.jdText).toContain('Build UIs in React');
  });

  it('yields an empty JD when the detail fetch fails (best-effort)', async () => {
    const connector = smartRecruitersConnector(
      [{ identifier: 'Acme', company: 'Acme' }],
      routingFetcher(listFixture, {}, { detailStatus: 500 }),
    );
    const postings = await connector.fetch();
    expect(postings).toHaveLength(2);
    expect(postings[0].jdText).toBe('');
  });

  it('returns nothing for an empty company and skips a company that errors', async () => {
    const empty = smartRecruitersConnector(
      [{ identifier: 'Empty', company: 'Empty Co' }],
      routingFetcher({ totalFound: 0, content: [] }, {}),
    );
    expect(await empty.fetch()).toHaveLength(0);

    const gone = smartRecruitersConnector(
      [{ identifier: 'Gone', company: 'Gone Co' }],
      routingFetcher({}, {}, { listStatus: 404 }),
    );
    expect(await gone.fetch()).toHaveLength(0);
  });

  it('pages until a short page and stops', async () => {
    let listCalls = 0;
    const page = (n: number, len: number) => ({
      totalFound: 120,
      content: Array.from({ length: len }, (_, i) => ({
        id: `p${n}-${i}`,
        name: `Engineer ${n}-${i}`,
        location: { city: 'Remote', remote: true },
      })),
    });
    const fetcher: Fetcher = async (url) => {
      if (/\/postings\/[^?]+$/.test(url)) return new Response('{}', { status: 200 });
      const offset = Number(new URL(url).searchParams.get('offset'));
      listCalls++;
      // 100 on page 0, then 20 on page 1 (short -> stop).
      return new Response(JSON.stringify(offset === 0 ? page(0, 100) : page(1, 20)), {
        status: 200,
      });
    };

    const postings = await smartRecruitersConnector(
      [{ identifier: 'Big', company: 'Big Co' }],
      fetcher,
    ).fetch();

    expect(listCalls).toBe(2);
    expect(postings).toHaveLength(120);
  });

  it('stops after a full final page once totalFound is reached', async () => {
    let listCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (/\/postings\/[^?]+$/.test(url)) return new Response('{}', { status: 200 });
      listCalls++;
      // Exactly one full page and totalFound == that page → stop without a 2nd call.
      return new Response(
        JSON.stringify({
          totalFound: 100,
          content: Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, name: `Eng ${i}` })),
        }),
        { status: 200 },
      );
    };
    const postings = await smartRecruitersConnector(
      [{ identifier: 'Big', company: 'Big Co' }],
      fetcher,
    ).fetch();
    expect(listCalls).toBe(1);
    expect(postings).toHaveLength(100);
  });

  it('terminates a runaway feed via the MAX_PAGES guard', async () => {
    let listCalls = 0;
    // Always returns a full page and never reaches totalFound → only MAX_PAGES stops it.
    const fetcher: Fetcher = async (url) => {
      if (/\/postings\/[^?]+$/.test(url)) return new Response('{}', { status: 200 });
      listCalls++;
      return new Response(
        JSON.stringify({
          totalFound: 1_000_000,
          content: Array.from({ length: 100 }, (_, i) => ({ id: `r${listCalls}-${i}`, name: 'X' })),
        }),
        { status: 200 },
      );
    };
    const postings = await smartRecruitersConnector(
      [{ identifier: 'Loop', company: 'Loop Co' }],
      fetcher,
    ).fetch();
    // Bounded: 20 pages max, 100 each.
    expect(listCalls).toBe(20);
    expect(postings).toHaveLength(2000);
  });
});
