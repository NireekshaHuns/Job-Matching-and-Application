import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../types';
import { linkedInGuestConnector, normalizeLinkedInLocation, parseJobDetail } from './linkedin';

/**
 * Read from the repo root rather than `import.meta.url`: under Vitest's module
 * graph that URL is not a real filesystem path, and vitest always runs with the
 * project root as cwd.
 */
const FIXTURE_DIR = 'src/server/ingest/connectors/__fixtures__';
const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), FIXTURE_DIR, name), 'utf8');

const SEARCH_HTML = fixture('linkedin-search.html');
const DETAIL_HTML = fixture('linkedin-job-detail.html');

const SEARCHES = [{ keywords: 'software engineer', location: 'United States' }];

/** Every connector under test runs with no delay, or the suite would sleep. */
const FAST = { delayMs: 0, maxPages: 1 };

const isDetail = (url: string) => url.includes('/jobPosting/');

/** Serve the search fixture for list requests and the detail fixture for JD requests. */
function routingFetcher(
  opts: { search?: string; detail?: string; searchStatus?: number; detailStatus?: number } = {},
): Fetcher {
  return async (url) => {
    if (isDetail(url)) {
      return new Response(opts.detail ?? DETAIL_HTML, { status: opts.detailStatus ?? 200 });
    }
    return new Response(opts.search ?? SEARCH_HTML, { status: opts.searchStatus ?? 200 });
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('linkedInGuestConnector', () => {
  it('maps search cards + JD detail to the normalized shape', async () => {
    const postings = await linkedInGuestConnector(SEARCHES, routingFetcher(), FAST).fetch();

    expect(postings).toHaveLength(4);
    const [first] = postings;

    expect(first.source).toBe('linkedin');
    expect(first.sourceJobId).toBe('4012345678');
    expect(first.company).toBe('Acme, Inc.');
    expect(first.title).toBe('Senior Software Engineer, Backend');
    expect(first.location).toBe('New York, NY');
    expect(first.postedAt?.toISOString().slice(0, 10)).toBe('2026-08-12');
    expect(first.jdText).toContain('scale APIs in Go & Rust');
    expect(first.jdText).toContain('5+ years');
    // fingerprint uses the normalized company ("ACME"), not the raw string.
    expect(first.fingerprint.startsWith('ACME|')).toBe(true);
  });

  it('canonicalizes the URL, dropping LinkedIn tracking params', async () => {
    const postings = await linkedInGuestConnector(SEARCHES, routingFetcher(), FAST).fetch();
    expect(postings[0].url).toBe('https://www.linkedin.com/jobs/view/4012345678');
    expect(postings.every((p) => !p.url.includes('refId'))).toBe(true);
  });

  it('decodes HTML entities in titles', async () => {
    const postings = await linkedInGuestConnector(SEARCHES, routingFetcher(), FAST).fetch();
    expect(postings[1].title).toBe('Full Stack Engineer, R&D');
  });

  it('normalizes metro-area locations toward the ATS city spelling', async () => {
    const postings = await linkedInGuestConnector(SEARCHES, routingFetcher(), FAST).fetch();
    expect(postings[1].location).toBe('San Francisco, CA');
    expect(postings[2].location).toBe('New York City');
    // "United States" is deliberately left alone — see normalizeLinkedInLocation.
    expect(postings[3].location).toBe('United States');
  });

  it('appends LinkedIn job criteria so the classifier sees the employment type', async () => {
    const postings = await linkedInGuestConnector(SEARCHES, routingFetcher(), FAST).fetch();
    expect(postings[0].jdText).toContain('Employment type: Full-time');
    expect(postings[0].jdText).toContain('Seniority level: Mid-Senior level');
    expect(postings[0].raw).toMatchObject({ criteria: { 'Employment type': 'Full-time' } });
  });

  it('skips the JD request for non-software titles', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(url);
      return routingFetcher()(url);
    };
    const postings = await linkedInGuestConnector(SEARCHES, fetcher, FAST).fetch();

    const detailUrls = seen.filter(isDetail);
    // Three software titles get a JD; the account-executive card does not.
    expect(detailUrls).toHaveLength(3);
    expect(detailUrls.some((u) => u.endsWith('/4012345681'))).toBe(false);
    // ...but it is still emitted, just without a description.
    const ae = postings.find((p) => p.sourceJobId === '4012345681');
    expect(ae?.title).toBe('Enterprise Account Executive');
    expect(ae?.jdText).toBe('');
  });

  it('honours the detail-fetch cap, emitting the rest without a JD', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(url);
      return routingFetcher()(url);
    };
    const postings = await linkedInGuestConnector(SEARCHES, fetcher, {
      ...FAST,
      maxDetailFetches: 1,
    }).fetch();

    expect(seen.filter(isDetail)).toHaveLength(1);
    expect(postings).toHaveLength(4);
    expect(postings.filter((p) => p.jdText !== '')).toHaveLength(1);
  });

  it('yields an empty JD when the detail fetch fails (best-effort)', async () => {
    const postings = await linkedInGuestConnector(
      SEARCHES,
      routingFetcher({ detailStatus: 500 }),
      FAST,
    ).fetch();
    expect(postings).toHaveLength(4);
    expect(postings.every((p) => p.jdText === '')).toBe(true);
  });

  it('stops paginating on HTTP 400 (start past the last result) without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let listCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (isDetail(url)) return new Response(DETAIL_HTML, { status: 200 });
      listCalls++;
      // A full first page, then LinkedIn's out-of-range 400.
      return listCalls === 1
        ? new Response(SEARCH_HTML.repeat(7), { status: 200 })
        : new Response('', { status: 400 });
    };

    const postings = await linkedInGuestConnector(SEARCHES, fetcher, {
      delayMs: 0,
      maxPages: 5,
      maxDetailFetches: 0,
    }).fetch();

    expect(listCalls).toBe(2);
    expect(postings.length).toBeGreaterThan(0);
    // 400 is an expected end-of-results signal, not something to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it('aborts every remaining request once LinkedIn throttles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      return new Response('<html>challenge</html>', { status: 429 });
    };

    const postings = await linkedInGuestConnector(
      [
        { keywords: 'software engineer', location: 'United States' },
        { keywords: 'backend engineer', location: 'United States' },
      ],
      fetcher,
      { delayMs: 0, maxPages: 3 },
    ).fetch();

    // One request, then stop — no retry, and the second search is never tried.
    expect(calls).toBe(1);
    expect(postings).toEqual([]);
  });

  it('treats LinkedIn’s non-standard 999 refusal as a block', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      return new Response('', { status: 999 });
    };
    expect(await linkedInGuestConnector(SEARCHES, fetcher, FAST).fetch()).toEqual([]);
    expect(calls).toBe(1);
  });

  it('warns loudly when a page has content but no card parses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const postings = await linkedInGuestConnector(
      SEARCHES,
      routingFetcher({ search: '<div class="totally-different-markup">hello</div>' }),
      FAST,
    ).fetch();

    expect(postings).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no job cards'));
  });

  it('sends the full-time and recency filters with the search', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(url);
      return routingFetcher()(url);
    };
    await linkedInGuestConnector(SEARCHES, fetcher, {
      ...FAST,
      maxDetailFetches: 0,
      postedWithinSeconds: 86_400,
    }).fetch();

    const params = new URL(seen[0]).searchParams;
    expect(params.get('f_JT')).toBe('F');
    expect(params.get('f_TPR')).toBe('r86400');
    expect(params.get('sortBy')).toBe('DD');
    expect(params.get('keywords')).toBe('software engineer');
  });

  it('dedups a job repeated across pages and searches', async () => {
    const postings = await linkedInGuestConnector(
      [
        { keywords: 'software engineer', location: 'United States' },
        { keywords: 'backend engineer', location: 'United States' },
      ],
      routingFetcher(),
      { delayMs: 0, maxPages: 2, maxDetailFetches: 0 },
    ).fetch();

    // The same 4 cards are served for every page of every search.
    expect(postings).toHaveLength(4);
    expect(new Set(postings.map((p) => p.sourceJobId)).size).toBe(4);
  });

  it('survives a network error without losing the run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher: Fetcher = async (url) => {
      if (isDetail(url)) throw new Error('socket hang up');
      return new Response(SEARCH_HTML, { status: 200 });
    };
    const postings = await linkedInGuestConnector(SEARCHES, fetcher, FAST).fetch();
    expect(postings).toHaveLength(4);
    expect(postings.every((p) => p.jdText === '')).toBe(true);
  });
});

describe('parseJobDetail', () => {
  it('stops the JD at the show-more button and keeps criteria separate', () => {
    const { jdText, criteria } = parseJobDetail(DETAIL_HTML);
    expect(jdText).toContain('About the role');
    expect(jdText).toContain('sponsor H-1B visas');
    // The button label and the criteria markup must not leak into the JD body.
    expect(jdText).not.toContain('Show more');
    expect(criteria['Employment type']).toBe('Full-time');
    expect(criteria['Industries']).toBe('Financial Services');
  });

  it('returns empty output for markup it does not recognize', () => {
    expect(parseJobDetail('<div>nothing familiar</div>')).toEqual({ jdText: '', criteria: {} });
  });

  it('yields no JD when the end marker is missing, rather than swallowing the page', () => {
    // Start marker present, end marker gone — the shape a LinkedIn markup change
    // produces. Running to EOF would pull the script body (and its disqualifying
    // phrase) into the JD, and `matchSponsor` would then read it as Excluded.
    const truncated = [
      '<div class="show-more-less-html__markup">',
      '<p>Real description text.</p>',
      '<script>var t = "must be authorized to work without sponsorship";</script>',
      '<footer>Unrelated page copy</footer>',
    ].join('');

    const { jdText } = parseJobDetail(truncated);
    expect(jdText).toBe('');
    expect(jdText).not.toContain('without sponsorship');
  });

  it('caps a runaway JD so it cannot blow past the embedding input limit', () => {
    const huge = 'word '.repeat(20_000);
    const html = `<div class="show-more-less-html__markup"><p>${huge}</p></div></section>`;

    expect(parseJobDetail(html).jdText.length).toBeLessThanOrEqual(20_000);
  });
});

describe('normalizeLinkedInLocation', () => {
  it.each([
    ['San Francisco Bay Area', 'San Francisco, CA'],
    ['New York City Metropolitan Area', 'New York City'],
    ['Greater Boston Area', 'Greater Boston'],
    ['Austin, TX', 'Austin, TX'],
    ['United States', 'United States'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeLinkedInLocation(input)).toBe(expected);
  });

  it('returns null for blank input', () => {
    expect(normalizeLinkedInLocation('')).toBeNull();
    expect(normalizeLinkedInLocation(null)).toBeNull();
  });
});
