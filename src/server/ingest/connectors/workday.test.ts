import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { workdayConnector } from './workday';
import detailFixture from './__fixtures__/workday-statestreet-detail.json';
import listFixture from './__fixtures__/workday-statestreet-list.json';

const STATE_STREET = {
  host: 'statestreet.wd1.myworkdayjobs.com',
  tenant: 'statestreet',
  site: 'Global',
  company: 'State Street',
};

/** Route the list POST vs. the per-posting detail GET to the right fixture. */
function routingFetcher(
  list: unknown,
  detail: unknown,
  opts: { listStatus?: number; detailStatus?: number; calls?: string[] } = {},
): Fetcher {
  return async (url, init) => {
    opts.calls?.push(url);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify(list), { status: opts.listStatus ?? 200 });
    }
    return new Response(JSON.stringify(detail), { status: opts.detailStatus ?? 200 });
  };
}

describe('workdayConnector', () => {
  it('produces the requisition the board was missing', async () => {
    // R-792647 is the posting that prompted this connector: it was live on State
    // Street's Workday board and absent from the DB, because nothing here could
    // read Workday at all.
    const connector = workdayConnector([STATE_STREET], routingFetcher(listFixture, detailFixture));
    const postings = await connector.fetch();

    const target = postings.find((p) => p.sourceJobId === 'R-792647');
    expect(target).toBeDefined();
    expect(target?.source).toBe('workday');
    expect(target?.company).toBe('State Street');
    expect(target?.title).toBe('Software Engineer, CRD- New Graduate');
    expect(target?.location).toBe('Burlington Massachusetts');
    expect(target?.url).toBe(
      'https://statestreet.wd1.myworkdayjobs.com/Global/job/Burlington-Massachusetts/Software-Engineer--CRD--New-Graduate_R-792647',
    );
    // Fingerprint uses the normalized company, matching every other connector.
    expect(target?.fingerprint.startsWith('STATE STREET|')).toBe(true);
  });

  it('leaves description and date to hydrate', async () => {
    const calls: string[] = [];
    const connector = workdayConnector(
      [STATE_STREET],
      routingFetcher(listFixture, detailFixture, { calls }),
    );
    const postings = await connector.fetch();

    expect(postings.every((p) => p.jdText === '' && p.postedAt === null)).toBe(true);
    // The list is a POST per page; no detail GET should have happened yet.
    expect(calls.every((u) => !u.includes('/job/'))).toBe(true);
  });

  it('fills in a real posted date and the description on hydrate', async () => {
    const calls: string[] = [];
    const connector = workdayConnector(
      [STATE_STREET],
      routingFetcher(listFixture, detailFixture, { calls }),
    );
    const [first] = await connector.hydrate!(await connector.fetch());

    // Exact URL: `externalPath` already starts with `/job/`, and appending a
    // second one produced `/Global/job/job/...`, which the live API 406s.
    expect(calls).toContain(
      'https://statestreet.wd1.myworkdayjobs.com/wday/cxs/statestreet/Global/job/Burlington-Massachusetts/Software-Engineer--CRD--New-Graduate_R-792647',
    );

    // The list only says "Posted Today"; the detail carries an actual date.
    expect(first.postedAt?.toISOString().slice(0, 10)).toBe('2026-08-18');
    expect(first.jdText).toContain('Charles River Development');
    expect(first.jdText).not.toContain('<');
  });

  it('keeps the posting when the detail request fails', async () => {
    const connector = workdayConnector(
      [STATE_STREET],
      routingFetcher(listFixture, {}, { detailStatus: 500 }),
    );
    const hydrated = await connector.hydrate!(await connector.fetch());

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0].jdText).toBe('');
    expect(hydrated[0].postedAt).toBeNull();
  });

  it('dedupes a posting returned by more than one search term', async () => {
    // Workday scores `searchText` across title and description, so the same
    // requisition comes back under several of the terms this connector sends.
    const connector = workdayConnector([STATE_STREET], routingFetcher(listFixture, detailFixture));
    const postings = await connector.fetch();
    expect(postings).toHaveLength(2);
    expect(new Set(postings.map((p) => p.url)).size).toBe(2);
  });

  it('recovers the requisition id from the path when bulletFields is absent', async () => {
    const list = {
      total: 1,
      jobPostings: [
        {
          title: 'Backend Engineer',
          externalPath: '/job/Boston-Massachusetts/Backend-Engineer_R-123456',
          locationsText: 'Boston, Massachusetts',
          postedOn: 'Posted Today',
        },
      ],
    };
    const connector = workdayConnector([STATE_STREET], routingFetcher(list, detailFixture));
    const [posting] = await connector.fetch();
    expect(posting.sourceJobId).toBe('R-123456');
  });

  it('reports a failed page instead of passing it off as the end of the board', async () => {
    const connector = workdayConnector(
      [STATE_STREET],
      routingFetcher(listFixture, detailFixture, { listStatus: 503 }),
    );
    await connector.fetch();

    const report = connector.lastReport?.();
    // One failure per search term — a bad page stops that term, not the board.
    expect(report?.failed).toBe(3);
    expect(report?.failures[0]).toContain('statestreet.wd1.myworkdayjobs.com -> HTTP 503');
    expect(report?.failures[0]).toContain('offset 0');
  });

  it('stops paging a term once a short page comes back', async () => {
    let posts = 0;
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method === 'POST') {
        posts++;
        return new Response(JSON.stringify(listFixture), { status: 200 });
      }
      return new Response(JSON.stringify(detailFixture), { status: 200 });
    };
    const connector = workdayConnector([STATE_STREET], fetcher);
    await connector.fetch();
    // 2 postings is under PAGE_SIZE, so each of the 3 terms stops after one page.
    expect(posts).toBe(3);
  });

  it('spends at most one detail request per posting handed to it', async () => {
    const detailCalls: string[] = [];
    const list = {
      total: 300,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Software Engineer ${i}`,
        externalPath: `/job/Boston/SWE-${i}_R-${100000 + i}`,
        locationsText: 'Boston, Massachusetts',
      })),
    };
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(list), { status: 200 });
      detailCalls.push(url);
      return new Response(JSON.stringify(detailFixture), { status: 200 });
    };

    const connector = workdayConnector([STATE_STREET], fetcher);
    const all = await connector.fetch();
    // Hydrating a 3-posting slice must cost exactly 3 requests, not 20.
    await connector.hydrate!(all.slice(0, 3));
    expect(detailCalls).toHaveLength(3);
  });

  it('keeps paging when Workday reports total 0 on later pages', async () => {
    // The live API returns the real count at offset 0 and then `total: 0` on
    // every subsequent page while still serving a full page of postings. A
    // total-based stop therefore cut every search term off after two pages —
    // and the requisition this connector was written for sits at offset 40.
    let posts = 0;
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify(detailFixture));
      const { offset } = JSON.parse(String(init.body)) as { offset: number };
      posts++;
      const page = Array.from({ length: 20 }, (_, i) => ({
        title: `Software Engineer ${offset + i}`,
        externalPath: `/job/Boston/SWE_R-${1000 + offset + i}`,
        locationsText: 'Boston, Massachusetts',
      }));
      // Real shape: a truthful total only on the first page.
      return new Response(JSON.stringify({ total: offset === 0 ? 413 : 0, jobPostings: page }));
    };

    const connector = workdayConnector([STATE_STREET], fetcher);
    const postings = await connector.fetch();

    // The first term pages all 8 deep (160 postings) instead of stopping at 2.
    // The other two terms return the same synthetic postings, so the
    // nothing-new guard stops each after a single page: 8 + 1 + 1.
    expect(posts).toBe(10);
    expect(postings.length).toBe(160);
    // Offset 40 is exactly where the real State Street requisition sits.
    expect(postings.some((p) => p.sourceJobId === 'R-1040')).toBe(true);
  });

  it('stops a term that keeps serving the same postings', async () => {
    let posts = 0;
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify(detailFixture));
      posts++;
      const page = Array.from({ length: 20 }, (_, i) => ({
        title: `Software Engineer ${i}`,
        externalPath: `/job/Boston/SWE_R-${i}`,
        locationsText: 'Boston, Massachusetts',
      }));
      return new Response(JSON.stringify({ total: 999, jobPostings: page }));
    };

    const connector = workdayConnector([STATE_STREET], fetcher);
    await connector.fetch();
    // Page 1 is all new, page 2 adds nothing → stop. Three terms, but only the
    // first contributes anything new.
    expect(posts).toBe(4);
  });
});
