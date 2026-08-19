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
import { emptyReport, fetchBoard } from '../report';
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

/**
 * Ceiling on list requests per `fetch()`, shared evenly across boards.
 *
 * All of this — the list walk, `hydrate`, and 100 LLM classify calls — runs
 * inside ONE Inngest step with a 300s budget, and CXS is slower per request than
 * a static ATS feed. An even per-board share also stops the first board draining
 * the whole run: the enrichment cap is 100 new postings per source, and one
 * unbounded tenant can produce several hundred, which would leave the heaviest
 * sponsors further down the list permanently unreached.
 */
const MAX_LIST_REQUESTS = 120;

/**
 * Workday renders a multi-location requisition as a COUNT ("3 Locations"), not a
 * place. That is a display string, and using it as the fingerprint's location
 * makes distinct requisitions collide — one is then dropped by `dedupPostings`,
 * never inserted, never recorded, and re-dropped on every later run. Measured on
 * the live boards: 11 of 20 Capital One postings and 4 of 20 NVIDIA ones are
 * count-shaped, so this silently loses exactly the enterprise roles this
 * connector exists to reach.
 *
 * `externalPath` carries the real primary location per posting
 * (`/job/McLean-VA/...`), which is both distinct and consistent with how other
 * sources spell it.
 */
const COUNT_LOCATION_RE = /^\d+\s+locations?$/i;

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
 *
 * The bullet must start with a letter: `bulletFields` is tenant-defined and
 * routinely carries other things (a year, a salary), which a digits-only pattern
 * would happily accept ahead of the real id.
 */
function requisitionId(posting: WorkdayListPosting): string | null {
  const bullet = posting.bulletFields?.find((f) => /^[A-Z][A-Z0-9]*-?\d{3,}$/i.test(f.trim()));
  if (bullet) return bullet.trim();
  const tail = posting.externalPath?.match(/_([A-Za-z]+-?\d{3,}(?:-\d+)?)$/);
  return tail ? tail[1] : null;
}

/**
 * A real location for the posting. Falls back to the path's location segment
 * when Workday gives a count instead of a place — see `COUNT_LOCATION_RE`.
 * `McLean-VA` becomes `McLean, VA`, which normalizes to the same fingerprint
 * component as another source's "McLean, VA".
 */
export function postingLocation(
  locationsText: string | undefined,
  externalPath: string,
): string | null {
  const text = locationsText?.trim();
  if (text && !COUNT_LOCATION_RE.test(text)) return text;

  const slug = externalPath.split('/')[2];
  if (!slug) return text || null;
  const place = slug.replace(/-/g, ' ').trim();
  // Re-comma a trailing state code so it reads like every other source.
  return place.replace(/\s+([A-Z]{2})$/, ', $1') || text || null;
}

export function workdayConnector(
  boards: WorkdayBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  // Reset per fetch, so a report never mixes two runs.
  let report = emptyReport();

  /**
   * Board a posting came from, recovered from its URL at hydrate time. Matches
   * host AND site: one tenant can publish several career sites, and building the
   * CXS path with the wrong site yields a 404 — which would mean an empty JD and
   * a permanently mis-tiered job.
   */
  function boardForUrl(url: string): WorkdayBoard | undefined {
    return boards.find((b) => url.startsWith(`https://${b.host}/${b.site}/`));
  }

  async function fetchDetail(board: WorkdayBoard, externalPath: string): Promise<WorkdayDetail> {
    // `externalPath` already begins with `/job/`; appending another one yields
    // `/Global/job/job/...`, which the API answers with a 406.
    //
    // Best-effort throughout: a posting whose description cannot be fetched is
    // still emitted, so neither a bad response nor a dropped connection may
    // escape and take the whole run down.
    try {
      const res = await fetcher(`${cxsBase(board)}${externalPath}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn(`[workday] detail ${board.tenant}${externalPath} -> HTTP ${res.status}`);
        return {};
      }
      return (await res.json()) as WorkdayDetail;
    } catch (err) {
      console.warn(`[workday] detail ${board.tenant}${externalPath} -> ${String(err)}`);
      return {};
    }
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

      // Even share per board, so board 1 cannot drain the run before the
      // heaviest sponsors further down the list are reached at all.
      const perBoard = Math.max(1, Math.floor(MAX_LIST_REQUESTS / Math.max(1, boards.length)));

      for (const board of boards) {
        let spent = 0;
        for (const searchText of SEARCH_TERMS) {
          // Tracked per TERM so the stop decision doesn't depend on what an
          // earlier, near-synonymous term already claimed — otherwise term 2's
          // first page looks empty, it stops immediately, and the extra terms
          // are inert. `seen` still dedups the OUTPUT globally.
          const seenInTerm = new Set<string>();
          for (let page = 0; page < MAX_PAGES; page++) {
            if (spent >= perBoard) break;
            spent++;
            // Stop this term rather than the board on failure: one bad page must
            // not cost us the other search terms, and reporting the offset makes
            // a mid-pagination failure distinguishable from a short feed.
            const res = await fetchBoard(
              fetcher,
              `${cxsBase(board)}/jobs`,
              `${board.host} "${searchText}" offset ${page * PAGE_SIZE}`,
              report,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  appliedFacets: {},
                  limit: PAGE_SIZE,
                  offset: page * PAGE_SIZE,
                  searchText,
                }),
              },
            );
            if (!res) break;

            const data = (await res.json()) as {
              total?: number;
              jobPostings?: WorkdayListPosting[];
            };
            const found = Array.isArray(data.jobPostings) ? data.jobPostings : [];
            /** Postings this page contributed to THIS term's walk. */
            let newInTerm = 0;

            for (const posting of found) {
              const title = posting.title?.trim() ?? '';
              const externalPath = posting.externalPath?.trim() ?? '';
              if (!title || !externalPath) continue;
              const url = publicUrl(board, externalPath);
              if (seenInTerm.has(url)) continue;
              seenInTerm.add(url);
              newInTerm++;
              // Emitted once, however many terms surfaced it.
              if (seen.has(url)) continue;
              seen.add(url);

              const location = postingLocation(posting.locationsText, externalPath);
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
            //
            // `total` is deliberately NOT consulted. Workday reports the real
            // count at offset 0 and then returns `total: 0` for every subsequent
            // page while still serving 20 postings — so a `(page+1)*size >= total`
            // check stopped every term after two pages, and the requisition this
            // connector exists to find sits at offset 40.
            if (found.length < PAGE_SIZE) break;
            // A full page that repeated this term's own earlier results means
            // the tenant is looping; paging further just spends requests.
            if (newInTerm === 0) break;
          }
        }
      }
      return postings;
    },
  };
}
