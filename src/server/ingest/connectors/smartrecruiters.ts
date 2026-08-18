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
import { looksLikeSwe } from '@/server/enrich/steps/swe-title';

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
 * Ceiling on JD detail fetches per run.
 *
 * The JD needs one extra sequential HTTP request PER POSTING, and this whole
 * connector runs inside a single Inngest step capped at 300s. Visa alone lists
 * well over a thousand roles, so an uncapped run could not finish, would retry
 * from scratch, and contributed nothing. Past the cap a posting is still emitted
 * with an empty `jdText` — the same thing the Simplify connector does, and
 * enrichment handles it (sponsorship falls back to USCIS history).
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

  return {
    source: SOURCE,
    async fetch(): Promise<RawPosting[]> {
      const postings: RawPosting[] = [];
      let detailFetches = 0;

      for (const board of boards) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const offset = page * PAGE_SIZE;
          const res = await fetcher(
            `${API_BASE}/${board.identifier}/postings?limit=${PAGE_SIZE}&offset=${offset}`,
          );
          if (!res.ok) {
            console.warn(`[smartrecruiters] ${board.identifier} -> HTTP ${res.status}`);
            break;
          }
          const data = (await res.json()) as SmartRecruitersList;
          const content = Array.isArray(data.content) ? data.content : [];

          for (const p of content) {
            const title = p.name?.trim() ?? '';
            if (!title || !p.id) continue;
            const location = postingLocation(p.location);

            // Spend the JD budget only on titles enrichment would keep. These
            // boards list every open role at the company — sales, ops, support —
            // and buying a description for a posting that is filtered out moments
            // later is the whole reason this step used to run out of time.
            const wantJd = looksLikeSwe(title) && detailFetches < MAX_DETAIL_FETCHES;
            if (wantJd) detailFetches++;

            postings.push({
              source: SOURCE,
              sourceJobId: p.id,
              company: board.company,
              title,
              location,
              url: `${PUBLIC_BASE}/${board.identifier}/${p.id}`,
              jdText: wantJd ? await fetchJd(board.identifier, p.id) : '',
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
