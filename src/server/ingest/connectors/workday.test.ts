import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../types';
import { postingLocation, workdayConnector } from './workday';
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
    expect(report?.failures[0]).toContain('statestreet.wd1.myworkdayjobs.com');
    expect(report?.failures[0]).toContain('offset 0');
    expect(report?.failures[0]).toContain('HTTP 503');
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

    // 8 pages for each of the 3 terms, not 2. The stop decision is per term, so
    // a near-synonym still walks its own results instead of looking empty just
    // because an earlier term already claimed them.
    expect(posts).toBe(24);
    // Output is still deduped globally — the terms return the same synthetic
    // postings, so 160 unique rows, not 480.
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
    // Per term: page 1 is new to that term, page 2 repeats it → stop. Two
    // requests each across three terms.
    expect(posts).toBe(6);
  });

  it('gives multi-location postings distinct fingerprints', async () => {
    // Workday renders a multi-location requisition as a COUNT, not a place.
    // Using it as the fingerprint's location made distinct requisitions collide,
    // and `dedupPostings` then dropped one — permanently, since a dropped
    // posting is never inserted and so never recorded as seen. Measured live:
    // 11 of 20 Capital One postings and 4 of 20 NVIDIA ones are count-shaped.
    const list = {
      total: 2,
      jobPostings: [
        {
          title: 'Lead Software Engineer, Full Stack',
          externalPath: '/job/Richmond-VA/Lead-Software-Engineer--Full-Stack_R241175',
          locationsText: '3 Locations',
        },
        {
          title: 'Lead Software Engineer, Full Stack',
          externalPath: '/job/McLean-VA/Lead-Software-Engineer--Full-Stack_R249333',
          locationsText: '3 Locations',
        },
      ],
    };
    const connector = workdayConnector([STATE_STREET], routingFetcher(list, detailFixture));
    const postings = await connector.fetch();

    expect(postings.map((p) => p.location)).toEqual(['Richmond, VA', 'McLean, VA']);
    expect(postings[0].fingerprint).not.toBe(postings[1].fingerprint);
  });

  it('spreads its request budget evenly across boards', async () => {
    // One unbounded tenant could otherwise drain the run before the heaviest
    // sponsors further down the list were reached at all.
    const perHost = new Map<string, number>();
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify(detailFixture));
      const host = new URL(url).host;
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
      const page = Array.from({ length: 20 }, () => ({
        title: `Software Engineer ${Math.random()}`,
        externalPath: `/job/Boston-MA/SWE_R-${Math.floor(Math.random() * 1e9)}`,
        locationsText: 'Boston, MA',
      }));
      return new Response(JSON.stringify({ total: 9999, jobPostings: page }));
    };

    const boards = Array.from({ length: 10 }, (_, i) => ({
      host: `t${i}.wd1.myworkdayjobs.com`,
      tenant: `t${i}`,
      site: 'External',
      company: `Company ${i}`,
    }));
    const connector = workdayConnector(boards, fetcher);
    await connector.fetch();

    // 120 total / 10 boards = 12 each; every board gets its share.
    expect([...perHost.values()]).toEqual(Array(10).fill(12));
  });

  it('keeps the right career site when a tenant publishes two', async () => {
    // `boardForUrl` matches host AND site — building the CXS path with the wrong
    // site 404s, which would mean an empty JD and a mis-tiered job.
    const detailUrls: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method === 'POST') {
        const site = url.includes('/Campus/') ? 'Campus' : 'External';
        return new Response(
          JSON.stringify({
            total: 1,
            jobPostings: [
              {
                title: `${site} Software Engineer`,
                externalPath: `/job/Boston-MA/${site}-SWE_R-100${site === 'Campus' ? 1 : 2}`,
                locationsText: 'Boston, MA',
              },
            ],
          }),
        );
      }
      detailUrls.push(url);
      return new Response(JSON.stringify(detailFixture));
    };

    const boards = [
      { host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'External', company: 'Acme' },
      { host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'Campus', company: 'Acme' },
    ];
    const connector = workdayConnector(boards, fetcher);
    const postings = await connector.fetch();
    await connector.hydrate!(postings);

    expect(detailUrls.some((u) => u.includes('/acme/External/job/'))).toBe(true);
    expect(detailUrls.some((u) => u.includes('/acme/Campus/job/'))).toBe(true);
  });
});

describe('postingLocation', () => {
  it('keeps a real location as given', () => {
    expect(postingLocation('Burlington Massachusetts', '/job/Burlington-MA/X_R-1')).toBe(
      'Burlington Massachusetts',
    );
  });

  it('falls back to the path when Workday reports a count', () => {
    expect(postingLocation('3 Locations', '/job/McLean-VA/X_R-1')).toBe('McLean, VA');
    expect(postingLocation('2 locations', '/job/San-Jose-CA/X_R-1')).toBe('San Jose, CA');
  });

  it('leaves a place with no trailing state code alone', () => {
    expect(postingLocation('5 Locations', '/job/Bengaluru/X_R-1')).toBe('Bengaluru');
  });

  it('returns null when there is nothing to go on', () => {
    expect(postingLocation(undefined, '/job')).toBeNull();
  });
});
