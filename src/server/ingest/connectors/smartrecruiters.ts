/**
 * SmartRecruiters connector — reads the public postings API
 * (`api.smartrecruiters.com/v1/companies/{company}/postings`). The list is
 * paged (100/page) and carries no description, so the JD is pulled per posting
 * from the detail endpoint (`/postings/{id}`) and its `jobAd` sections flattened
 * to text. Detail fetches are best-effort — a failure just yields an empty JD.
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';
import { emptyReport, fetchBoard } from '../report';

export interface SmartRecruitersBoard {
  /** Company identifier from api.smartrecruiters.com/v1/companies/{identifier}. */
  identifier: string;
  /** Display company name to attach to each posting. */
  company: string;
}

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: SmartRecruitersLocation;
}

interface SmartRecruitersList {
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

interface JobAdSection {
  text?: string;
}
interface SmartRecruitersDetail {
  jobAd?: { sections?: Record<string, JobAdSection | undefined> };
}

const SOURCE = 'smartrecruiters';
const API_BASE = 'https://api.smartrecruiters.com/v1/companies';
const PUBLIC_BASE = 'https://jobs.smartrecruiters.com';
const PAGE_SIZE = 100;
/** Safety cap on pages per board so a bad `totalFound` can't loop forever. */
const MAX_PAGES = 20;

/**
 * Ceiling on JD detail fetches per hydrate call.
 *
 * The JD costs one extra sequential HTTP request PER POSTING, and this runs
 * inside a single Inngest step capped at 300s — Visa alone lists well over a
 * thousand roles, so buying a description for every posting could not finish,
 * retried from scratch, and contributed nothing.
 *
 * The budget is spent in `hydrate`, on the postings enrichment actually
 * selected, rather than in `fetch` on the head of the feed. See `JobConnector.hydrate`.
 */
const MAX_DETAIL_FETCHES = 120;

/** "City, Region" (+ " · Remote"), or null when nothing is known. */
function postingLocation(loc: SmartRecruitersLocation | undefined): string | null {
  if (!loc) return null;
  const place = [loc.city?.trim(), loc.region?.trim()].filter(Boolean).join(', ');
  const parts = [place, loc.remote ? 'Remote' : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Flatten a posting's job-ad sections (HTML) into one plain-text JD. */
function detailToJd(detail: SmartRecruitersDetail): string {
  const sections = detail.jobAd?.sections ?? {};
  const text = Object.values(sections)
    .map((s) => s?.text?.trim())
    .filter((t): t is string => Boolean(t))
    .map(htmlToText)
    .join('\n\n')
    .trim();
  return text;
}

export function smartRecruitersConnector(
  boards: SmartRecruitersBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  async function fetchJd(identifier: string, id: string): Promise<string> {
    try {
      const res = await fetcher(`${API_BASE}/${identifier}/postings/${id}`);
      if (!res.ok) {
        console.warn(`[smartrecruiters] detail ${identifier}/${id} -> HTTP ${res.status}`);
        return '';
      }
      return detailToJd((await res.json()) as SmartRecruitersDetail);
    } catch (err) {
      console.warn(`[smartrecruiters] detail ${identifier}/${id} failed: ${String(err)}`);
      return '';
    }
  }

  // Reset per fetch, so a report never mixes two runs.
  let report = emptyReport();

  return {
    source: SOURCE,
    lastReport: () => report,

    /**
     * Buy the JD for the postings enrichment picked. `sourceJobId` carries the
     * SmartRecruiters posting id and the board identifier is recovered from the
     * public URL, so no extra state has to survive the step boundary.
     */
    async hydrate(postings: RawPosting[]): Promise<RawPosting[]> {
      const out: RawPosting[] = [];
      let spent = 0;
      for (const posting of postings) {
        const identifier = posting.url.slice(PUBLIC_BASE.length + 1).split('/')[0];
        if (!posting.sourceJobId || !identifier || spent >= MAX_DETAIL_FETCHES) {
          out.push(posting);
          continue;
        }
        spent++;
        out.push({ ...posting, jdText: await fetchJd(identifier, posting.sourceJobId) });
      }
      return out;
    },

    async fetch(): Promise<RawPosting[]> {
      report = emptyReport();
      const postings: RawPosting[] = [];

      for (const board of boards) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const offset = page * PAGE_SIZE;
          // A failure here also truncates pagination mid-board, so a 500 on page
          // 3 looks exactly like "this company has 300 jobs". Say so.
          const res = await fetchBoard(
            fetcher,
            `${API_BASE}/${board.identifier}/postings?limit=${PAGE_SIZE}&offset=${offset}`,
            `${board.identifier} at offset ${offset}`,
            report,
          );
          if (!res) break;
          const data = (await res.json()) as SmartRecruitersList;
          const content = Array.isArray(data.content) ? data.content : [];

          for (const p of content) {
            const title = p.name?.trim() ?? '';
            if (!title || !p.id) continue;
            const location = postingLocation(p.location);

            postings.push({
              source: SOURCE,
              sourceJobId: p.id,
              company: board.company,
              title,
              location,
              url: `${PUBLIC_BASE}/${board.identifier}/${p.id}`,
              // Filled in by `hydrate`, for the postings that survive the cap.
              jdText: '',
              postedAt: toPostedAt(p.releasedDate),
              fingerprint: postingFingerprint(board.company, title, location),
              raw: p,
            });
          }

          // Last page: a short page, or we've covered everything reported found.
          if (content.length < PAGE_SIZE) break;
          if (data.totalFound != null && offset + content.length >= data.totalFound) break;
        }
      }

      return postings;
    },
  };
}
