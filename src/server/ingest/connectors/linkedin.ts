/**
 * LinkedIn guest-jobs connector — reads the unauthenticated endpoints behind
 * LinkedIn's logged-out job search:
 *
 *   list   /jobs-guest/jobs/api/seeMoreJobPostings/search  (HTML fragment, 25 cards/page)
 *   detail /jobs-guest/jobs/api/jobPosting/{jobId}         (HTML fragment, JD + criteria)
 *
 * THIS IS NOT A DOCUMENTED API. It is the internal endpoint the logged-out job
 * search page uses to lazy-load results, it returns HTML rather than JSON, it is
 * disallowed by LinkedIn's robots.txt, and its markup can change without notice.
 * Everything below is built around those facts:
 *
 *   - OFF BY DEFAULT. Registered only when LINKEDIN_GUEST_ENABLED is set, so CI,
 *     e2e and a default checkout never touch the network here, and there is a
 *     one-variable kill switch when it stops working.
 *   - LOW VOLUME. Requests are strictly sequential with a delay between them,
 *     pages are capped, and JD fetches are capped (see MAX_DETAIL_FETCHES).
 *   - FAILS SOFT. A 429/403/999 aborts the whole run and returns what was
 *     already collected; there is deliberately no retry, no backoff-and-retry
 *     loop, and no proxy/identity rotation. If LinkedIn says stop, we stop and
 *     the other five connectors carry the run.
 *   - SAYS SO WHEN IT BREAKS. A page that returns HTML but parses to zero cards
 *     warns loudly, because the failure mode of a silent selector change is
 *     ingesting nothing while looking healthy.
 */
import { looksLikeSwe } from '@/server/enrich/steps/swe-title';
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';

/** One keyword/location query to run against the guest search. */
export interface LinkedInSearch {
  keywords: string;
  location: string;
}

export interface LinkedInGuestOptions {
  /** Pause between requests, ms. Injectable so tests don't actually wait. */
  delayMs?: number;
  /** List pages per search (25 cards each). */
  maxPages?: number;
  /** Hard cap on JD detail requests per run — the main volume control. */
  maxDetailFetches?: number;
  /** `f_TPR` window in seconds; default 7 days. */
  postedWithinSeconds?: number;
}

const SOURCE = 'linkedin';
const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
/** Canonical, tracking-free permalink for a posting. */
const VIEW_URL = 'https://www.linkedin.com/jobs/view';

const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 3;
/**
 * Postings past this cap are still emitted, just with an empty `jdText` (the
 * Simplify connector already works that way, and `dedupPostings` prefers a
 * JD-bearing duplicate). Raising it raises the odds of being rate-limited.
 */
const DEFAULT_MAX_DETAIL_FETCHES = 40;
const DEFAULT_DELAY_MS = 1500;
/** Last 7 days. Ingestion is on-demand, so this covers a realistic click cadence. */
const DEFAULT_POSTED_WITHIN_SECONDS = 604_800;

/**
 * Ordinary browser headers. The endpoint serves the logged-out job search, and
 * a request without a User-Agent is answered with an error page rather than
 * results.
 */
export const GUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Statuses that mean "you are being throttled or challenged". 999 is LinkedIn's
 * own non-standard refusal code. Any of these aborts the entire run.
 */
function isBlockedStatus(status: number): boolean {
  return status === 429 || status === 403 || status === 999;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** A row scraped off the search results page, before any JD is attached. */
export interface LinkedInCard {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  postedAt: Date | null;
}

const CARD_RE = /<li[^>]*>([\s\S]*?)<\/li>/g;
const JOB_URN_RE = /data-entity-urn="urn:li:jobPosting:(\d+)"/;
const FULL_LINK_RE = /class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/;
const TITLE_RE = /<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/;
const COMPANY_RE = /<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/;
const LOCATION_RE = /<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/;
const LISTDATE_RE = /<time[^>]*datetime="([^"]+)"/;

/** Trailing digits of a `/jobs/view/software-engineer-at-acme-4012345678` slug. */
const SLUG_ID_RE = /-(\d{6,})(?:\?|$)/;

/** Job id from the card's URN, falling back to the permalink slug. */
function cardJobId(card: string): string | undefined {
  const urn = JOB_URN_RE.exec(card)?.[1];
  if (urn) return urn;
  const href = FULL_LINK_RE.exec(card)?.[1];
  return href ? SLUG_ID_RE.exec(href)?.[1] : undefined;
}

/** Inner text of a matched block, entity-decoded and whitespace-collapsed. */
function text(match: string | undefined): string {
  return match ? htmlToText(match).replace(/\s+/g, ' ').trim() : '';
}

/**
 * LinkedIn labels locations by metro area where an ATS names a city, so these
 * two spellings of one job do NOT produce the same fingerprint. Mapping the
 * common metro forms back to a city recovers some of that overlap.
 *
 * PARTIAL BY DESIGN. "United States" is deliberately left alone —
 * `normalizeLocation` refuses to collapse bare country tags into `remote`
 * because that would merge a genuine on-site metro into remote, and that call
 * should not be reversed from inside a connector. Expect some LinkedIn/ATS
 * duplicates on the board as a result.
 */
const METRO_SUFFIX_RE = /\s+(?:Metropolitan\s+)?Area$/i;
const BAY_AREA_RE = /^San Francisco Bay Area$/i;

export function normalizeLinkedInLocation(location: string | null | undefined): string | null {
  const value = location?.trim();
  if (!value) return null;
  if (BAY_AREA_RE.test(value)) return 'San Francisco, CA';
  const stripped = value.replace(METRO_SUFFIX_RE, '').trim();
  return stripped || value;
}

/** Parse one search-results fragment into cards. Exported for tests + the probe script. */
export function parseSearchCards(html: string): LinkedInCard[] {
  const cards: LinkedInCard[] = [];
  CARD_RE.lastIndex = 0;
  for (const match of html.matchAll(CARD_RE)) {
    const block = match[1];
    const jobId = cardJobId(block);
    const title = text(TITLE_RE.exec(block)?.[1]);
    const company = text(COMPANY_RE.exec(block)?.[1]);
    if (!jobId || !title || !company) continue;

    cards.push({
      jobId,
      title,
      company,
      location: normalizeLinkedInLocation(text(LOCATION_RE.exec(block)?.[1])),
      // Date-only precision: LinkedIn cards age in days where ATS feeds age in
      // minutes. Expected, not a bug.
      postedAt: toPostedAt(LISTDATE_RE.exec(block)?.[1] ?? null),
    });
  }
  return cards;
}

/**
 * Belt-and-braces bound on a single JD. Well above any real posting, low enough
 * that a runaway match can't reach `embedJd`'s input limit.
 */
const MAX_JD_CHARS = 20_000;

const JD_START_RE = /<div[^>]*show-more-less-html__markup[^>]*>/;
/** The JD block runs until the "show more" control or the end of its section. */
const JD_END_RE = /show-more-less-html__button|<\/section>/;
const CRITERIA_ITEM_RE = /description__job-criteria-item[^>]*>([\s\S]*?)<\/li>/g;
const CRITERIA_LABEL_RE = /<h3[^>]*description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>/;
const CRITERIA_VALUE_RE = /<span[^>]*description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/;

export interface LinkedInDetail {
  jdText: string;
  /** "Seniority level" / "Employment type" / "Job function" / "Industries". */
  criteria: Record<string, string>;
}

/**
 * Parse a job-detail fragment into plain-text JD + the criteria table.
 *
 * The criteria are appended to the JD text rather than dropped: LinkedIn states
 * "Employment type: Full-time" (or "Contract") right on the posting, and that
 * line is exactly what the downstream classifier needs to honour the
 * full-time-only invariant. `RawPosting` has no field for it, and inventing one
 * would touch every connector, so it rides along in the text it came from.
 */
export function parseJobDetail(html: string): LinkedInDetail {
  const start = JD_START_RE.exec(html);
  let jdText = '';
  if (start) {
    const rest = html.slice(start.index + start[0].length);
    const end = JD_END_RE.exec(rest);
    // BOTH markers required. Falling back to "rest of the document" on a missing
    // end marker looks harmless but isn't: `htmlToText` doesn't strip <script>
    // contents, so the JD would absorb inline JS and unrelated page copy — and a
    // stray "must be authorized to work without sponsorship" anywhere in that
    // tail flips the job to Excluded (`matchSponsor` reads the untruncated
    // text), while an oversized blob fails `embedJd` outright. Cost control says
    // a processed job is never re-analysed, so either mistake is permanent.
    // No end marker means the markup moved: return nothing and let the zero-JD
    // warning surface it.
    jdText = end ? htmlToText(rest.slice(0, end.index)).slice(0, MAX_JD_CHARS) : '';
  }

  const criteria: Record<string, string> = {};
  CRITERIA_ITEM_RE.lastIndex = 0;
  for (const match of html.matchAll(CRITERIA_ITEM_RE)) {
    const label = text(CRITERIA_LABEL_RE.exec(match[1])?.[1]);
    const value = text(CRITERIA_VALUE_RE.exec(match[1])?.[1]);
    if (label && value) criteria[label] = value;
  }

  const summary = Object.entries(criteria)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  const combined = [jdText, summary].filter(Boolean).join('\n\n');
  return { jdText: combined, criteria };
}

/**
 * Exported so `pnpm linkedin:probe` hits the exact same URL shape the connector
 * does — a probe that built its own URL would prove nothing about this file.
 */
export function buildSearchUrl(
  search: LinkedInSearch,
  start: number,
  postedWithinSeconds: number = DEFAULT_POSTED_WITHIN_SECONDS,
): string {
  const params = new URLSearchParams({
    keywords: search.keywords,
    location: search.location,
    // Full-time only: LinkedIn drops contract/part-time server-side, so the
    // employment-type invariant costs nothing to honour here.
    f_JT: 'F',
    f_TPR: `r${postedWithinSeconds}`,
    sortBy: 'DD',
    start: String(start),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

/** Detail-endpoint URL for a job id. Exported for the probe script. */
export function buildDetailUrl(jobId: string): string {
  return `${DETAIL_URL}/${jobId}`;
}

/**
 * Build a LinkedIn guest connector over the given searches. `fetcher` is
 * injectable so tests use a fixture client instead of the network.
 */
export function linkedInGuestConnector(
  searches: LinkedInSearch[],
  fetcher: Fetcher = globalThis.fetch,
  opts: LinkedInGuestOptions = {},
): JobConnector {
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDetailFetches = opts.maxDetailFetches ?? DEFAULT_MAX_DETAIL_FETCHES;
  const postedWithin = opts.postedWithinSeconds ?? DEFAULT_POSTED_WITHIN_SECONDS;

  return {
    source: SOURCE,
    async fetch(): Promise<RawPosting[]> {
      /** Set once LinkedIn throttles us; stops every remaining request. */
      let blocked = false;
      let requests = 0;

      /** One polite, sequential request. Returns the body, or null to stop. */
      async function get(url: string, label: string): Promise<string | null> {
        if (requests > 0) await sleep(delayMs);
        requests++;
        try {
          const res = await fetcher(url, { headers: GUEST_HEADERS });
          if (isBlockedStatus(res.status)) {
            blocked = true;
            console.warn(
              `[linkedin] ${label} -> HTTP ${res.status} (throttled/challenged) — stopping this run.`,
            );
            return null;
          }
          if (!res.ok) {
            // 400 is how the search reports a `start` past the last result.
            if (res.status !== 400) console.warn(`[linkedin] ${label} -> HTTP ${res.status}`);
            return null;
          }
          return await res.text();
        } catch (err) {
          console.warn(`[linkedin] ${label} failed: ${String(err)}`);
          return null;
        }
      }

      // --- Phase 1: list pages. Cheap, and the only phase that finds new jobs.
      const byJobId = new Map<string, LinkedInCard>();
      /** Which search first surfaced each card, so the JD budget can be shared. */
      const searchOfCard = new Map<string, number>();
      for (const [searchIndex, search] of searches.entries()) {
        if (blocked) break;
        const label = `${search.keywords} @ ${search.location}`;
        for (let page = 0; page < maxPages; page++) {
          const html = await get(buildSearchUrl(search, page * PAGE_SIZE, postedWithin), label);
          if (html === null) break;

          const cards = parseSearchCards(html);
          if (cards.length === 0) {
            // Body with real content but nothing parsed: almost certainly a
            // selector change or a challenge page. Never fail silently.
            if (html.trim().length > 0) {
              console.warn(
                `[linkedin] ${label} page ${page} returned ${html.length} bytes but no job cards — have the card selectors changed?`,
              );
            }
            break;
          }
          for (const card of cards) {
            if (byJobId.has(card.jobId)) continue;
            byJobId.set(card.jobId, card);
            searchOfCard.set(card.jobId, searchIndex);
          }
          if (cards.length < PAGE_SIZE) break;
        }
      }

      // --- Phase 2: JD detail, for SWE-looking titles only, up to the cap.
      // The title pre-filter is a NETWORK BUDGET decision, not a classification
      // one: enrichment applies `looksLikeSwe` itself, but only after the
      // connector has returned, so filtering there would not save the request.
      // Everything fetched is still emitted — this only decides who gets a JD.
      const cards = [...byJobId.values()];
      // SHARE THE BUDGET ACROSS SEARCHES, don't spend it front-to-back. The map
      // is in search order, so taking the cap off the front gave the whole
      // budget to the first search: with 4 searches x 3 pages x 25 cards against
      // a cap of 40, "software engineer" alone produced far more than 40
      // SWE-looking titles and the last search got ZERO JD fetches, every run.
      // Those jobs are still ingested, just permanently JD-less — and a JD-less
      // job cannot be Excluded by its own words, because cost control means an
      // enriched job is never re-analysed.
      //
      // Round-robin instead: each search contributes its next candidate in turn
      // until the budget runs out, so a search that found fewer jobs simply
      // stops contributing rather than being starved by position.
      const bySearch = new Map<number, LinkedInCard[]>();
      for (const card of cards) {
        if (!looksLikeSwe(card.title)) continue;
        const idx = searchOfCard.get(card.jobId) ?? 0;
        const list = bySearch.get(idx) ?? [];
        list.push(card);
        bySearch.set(idx, list);
      }
      const wanted = new Set<string>();
      for (let round = 0; wanted.size < maxDetailFetches; round++) {
        let addedThisRound = false;
        for (const list of bySearch.values()) {
          if (wanted.size >= maxDetailFetches) break;
          const card = list[round];
          if (!card) continue;
          wanted.add(card.jobId);
          addedThisRound = true;
        }
        if (!addedThisRound) break;
      }

      const postings: RawPosting[] = [];
      let detailsFetched = 0;
      let detailsWithoutJd = 0;
      for (const card of cards) {
        let detail: LinkedInDetail | null = null;
        if (!blocked && wanted.has(card.jobId)) {
          const html = await get(buildDetailUrl(card.jobId), `job ${card.jobId}`);
          // Best-effort: a failed detail fetch yields an empty JD, not a lost job.
          if (html !== null) {
            detail = parseJobDetail(html);
            detailsFetched++;
            if (!detail.jdText) detailsWithoutJd++;
          }
        }

        postings.push({
          source: SOURCE,
          sourceJobId: card.jobId,
          company: card.company,
          title: card.title,
          location: card.location,
          url: `${VIEW_URL}/${card.jobId}`,
          jdText: detail?.jdText ?? '',
          postedAt: card.postedAt,
          fingerprint: postingFingerprint(card.company, card.title, card.location),
          raw: { card, criteria: detail?.criteria ?? null },
        });
      }

      if (blocked && postings.length === 0) {
        console.warn('[linkedin] blocked before any posting was collected — returning nothing.');
      }
      // A page we fetched fine but couldn't read a JD out of means the detail
      // markup moved. Say so: the jobs still land, silently JD-less, and cost
      // control means they are never looked at again.
      if (detailsWithoutJd > 0) {
        console.warn(
          `[linkedin] ${detailsWithoutJd}/${detailsFetched} detail pages parsed to an empty JD — check the detail selectors (pnpm linkedin:probe).`,
        );
      }
      return postings;
    },
  };
}
