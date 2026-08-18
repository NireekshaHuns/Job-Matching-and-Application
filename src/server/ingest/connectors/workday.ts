/**
 * Workday connector — reads the public CXS API behind every
 * `{tenant}.wd{N}.myworkdayjobs.com` careers site.
 *
 * WHY THIS MATTERS. Workday is what large enterprises run, and large enterprises
 * are the heaviest H-1B sponsors — exactly the employers this board exists to
 * surface. Without it the board could only see them second-hand: every
 * `myworkdayjobs.com` URL in the DB arrived via the Simplify GitHub repo, which
 * is why a State Street requisition posted the same day was missing while an
 * older one for the identical role was present.
 *
 * TWO ENDPOINTS. The list gives titles, locations and a vague `postedOn`
 * ("Posted Today", "Posted 30+ Days Ago"); the per-posting detail gives the real
 * `startDate`, the description, and the full-time/part-time flag. The detail is
 * one request per posting, so it is bought in `hydrate` — after the enrichment
 * cap has chosen — rather than during `fetch`. See `JobConnector.hydrate`.
 *
 * Undocumented and per-tenant: the shape below is what the live boards return,
 * and every field is treated as optional because some tenants omit some of them.
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import { emptyReport, recordAttempt, recordFailure } from '../report';
import type { Fetcher, JobConnector, RawPosting } from '../types';

export interface WorkdayBoard {
  /** Careers host, e.g. `statestreet.wd1.myworkdayjobs.com`. */
  host: string;
  /** Tenant segment of the CXS path — usually the subdomain, e.g. `statestreet`. */
  tenant: string;
  /** Career-site name, e.g. `Global`. A tenant can publish several. */
  site: string;
  company: string;
}

interface WorkdayListPosting {
  title?: string;
  /** Path under the site, e.g. `/job/Burlington-Massachusetts/Software-Engineer_R-792647`. */
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  /** Usually holds the requisition id, e.g. `["R-792647"]`. */
  bulletFields?: string[];
}

interface WorkdayDetail {
  jobPostingInfo?: {
    jobDescription?: string;
    /** Real ISO date, unlike the list's "Posted Today". */
    startDate?: string;
    timeType?: string;
    jobReqId?: string;
    externalUrl?: string;
    location?: string;
  };
}

const SOURCE = 'workday';

/** Postings per list request. Workday rejects larger pages on some tenants. */
const PAGE_SIZE = 20;

/**
 * Pages per search term. A big tenant lists thousands of roles across every
 * function (State Street alone has 1,288), so this connector searches for
 * software terms rather than walking the whole board.
 *
 * Depth matters more than it looks: Workday orders by relevance, not date, so
 * recent postings are scattered through the results. The State Street
 * requisition this connector was written for sits at offset 40 of "software
 * engineer" — two pages past where a shallower loop would stop. Fingerprint
 * dedup means successive hourly runs accumulate coverage rather than re-paying
 * for it.
 */
const MAX_PAGES = 8;

/**
 * Search terms sent as `searchText`. Workday scores across title and
 * description, so a handful of broad terms covers far more than an exact-title
 * list would, and the deterministic title filter downstream removes the noise.
 */
const SEARCH_TERMS = ['software engineer', 'software developer', 'backend engineer'];

/** Ceiling on detail requests per hydrate call — each one is a sequential fetch. */
const MAX_DETAIL_FETCHES = 100;

function cxsBase(board: WorkdayBoard): string {
  return `https://${board.host}/wday/cxs/${board.tenant}/${board.site}`;
}

/** Public-facing URL for a posting, which is the CXS path minus the `/wday/cxs` prefix. */
function publicUrl(board: WorkdayBoard, externalPath: string): string {
  return `https://${board.host}/${board.site}${externalPath}`;
}

/**
 * Requisition id, preferred from `bulletFields` and otherwise recovered from the
 * `_R-792647` tail of the path. It is the only stable per-posting id Workday
 * exposes in the list response.
 */
function requisitionId(posting: WorkdayListPosting): string | null {
  const bullet = posting.bulletFields?.find((f) => /^[A-Z]*-?\d{3,}$/i.test(f.trim()));
  if (bullet) return bullet.trim();
  const tail = posting.externalPath?.match(/_([A-Za-z]*-?\d{3,})$/);
  return tail ? tail[1] : null;
}

export function workdayConnector(
  boards: WorkdayBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  // Reset per fetch, so a report never mixes two runs.
  let report = emptyReport();

  /** Board a posting came from, recovered from its URL host at hydrate time. */
  function boardForUrl(url: string): WorkdayBoard | undefined {
    return boards.find((b) => url.startsWith(`https://${b.host}/`));
  }

  async function fetchDetail(board: WorkdayBoard, externalPath: string): Promise<WorkdayDetail> {
    // `externalPath` already begins with `/job/`; appending another one yields
    // `/Global/job/job/...`, which the API answers with a 406.
    const res = await fetcher(`${cxsBase(board)}${externalPath}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[workday] detail ${board.tenant}${externalPath} -> HTTP ${res.status}`);
      return {};
    }
    return (await res.json()) as WorkdayDetail;
  }

  return {
    source: SOURCE,
    lastReport: () => report,

    /**
     * Buy the description for the postings enrichment selected. This is what
     * makes Workday postings tierable at all: sponsorship `Excluded` is derived
     * from description text, and the list response carries none.
     */
    async hydrate(postings: RawPosting[]): Promise<RawPosting[]> {
      const out: RawPosting[] = [];
      let spent = 0;
      for (const posting of postings) {
        const board = boardForUrl(posting.url);
        const externalPath = (posting.raw as { externalPath?: string } | null)?.externalPath;
        if (!board || !externalPath || spent >= MAX_DETAIL_FETCHES) {
          out.push(posting);
          continue;
        }
        spent++;
        const info = (await fetchDetail(board, externalPath)).jobPostingInfo;
        out.push({
          ...posting,
          jdText: info?.jobDescription ? htmlToText(info.jobDescription) : posting.jdText,
          // The list's "Posted Today" is not a date; the detail's startDate is.
          postedAt: toPostedAt(info?.startDate) ?? posting.postedAt,
        });
      }
      return out;
    },

    async fetch(): Promise<RawPosting[]> {
      report = emptyReport();
      const postings: RawPosting[] = [];
      // A term-based search returns the same posting under several terms, and a
      // tenant can list one requisition in multiple locations.
      const seen = new Set<string>();

      for (const board of boards) {
        for (const searchText of SEARCH_TERMS) {
          for (let page = 0; page < MAX_PAGES; page++) {
            recordAttempt(report);
            const res = await fetcher(`${cxsBase(board)}/jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                appliedFacets: {},
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
                searchText,
              }),
            });
            if (!res.ok) {
              // Stop this term rather than the board: one bad page must not cost
              // us the other search terms, and reporting the offset makes a
              // mid-pagination failure distinguishable from a short feed.
              recordFailure(
                report,
                board.host,
                `HTTP ${res.status} at "${searchText}" offset ${page * PAGE_SIZE}`,
              );
              break;
            }

            const data = (await res.json()) as {
              total?: number;
              jobPostings?: WorkdayListPosting[];
            };
            const found = Array.isArray(data.jobPostings) ? data.jobPostings : [];
            let added = 0;

            for (const posting of found) {
              const title = posting.title?.trim() ?? '';
              const externalPath = posting.externalPath?.trim() ?? '';
              if (!title || !externalPath) continue;
              const url = publicUrl(board, externalPath);
              if (seen.has(url)) continue;
              seen.add(url);
              added++;

              const location = posting.locationsText?.trim() || null;
              postings.push({
                source: SOURCE,
                sourceJobId: requisitionId(posting),
                company: board.company,
                title,
                location,
                url,
                // Both filled in by `hydrate`, for postings that survive the cap.
                jdText: '',
                postedAt: null,
                fingerprint: postingFingerprint(board.company, title, location),
                raw: posting,
              });
            }

            // A short page is the end of this term's results.
            if (found.length < PAGE_SIZE) break;
            // DO NOT trust `total` past the first page. Workday reports the real
            // count at offset 0 and then returns `total: 0` for every subsequent
            // page while still serving 20 postings — so a `(page+1)*size >= total`
            // check stopped every term after two pages, and the requisition this
            // connector exists to find sits at offset 40.
            if (page === 0 && data.total != null && data.total <= PAGE_SIZE) break;
            // A full page that contributed nothing new means the tenant is
            // repeating itself; paging further just spends requests.
            if (added === 0) break;
          }
        }
      }
      return postings;
    },
  };
}
