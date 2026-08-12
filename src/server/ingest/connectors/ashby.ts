/**
 * Ashby connector — reads the public job-board API
 * (`api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true`).
 * One call returns all postings with full JD text (`descriptionPlain`).
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';

export interface AshbyBoard {
  /** Board name from jobs.ashbyhq.com/{board}. */
  board: string;
  company: string;
}

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isRemote?: boolean;
  /**
   * The live posting API returns `publishedAt`. An earlier version of this
   * connector read `publishedDate`, which does not exist in the response — every
   * Ashby posting landed with a null date and the board showed "date n/a".
   * `publishedDate` is kept as a fallback in case a board serves the older shape.
   */
  publishedAt?: string;
  publishedDate?: string;
}

const SOURCE = 'ashby';
const API_BASE = 'https://api.ashbyhq.com/posting-api/job-board';

export function ashbyConnector(
  boards: AshbyBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  return {
    source: SOURCE,
    async fetch(): Promise<RawPosting[]> {
      const postings: RawPosting[] = [];
      for (const board of boards) {
        const res = await fetcher(`${API_BASE}/${board.board}?includeCompensation=true`);
        if (!res.ok) {
          console.warn(`[ashby] ${board.board} -> HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { jobs?: AshbyJob[] };

        for (const job of Array.isArray(data.jobs) ? data.jobs : []) {
          const title = job.title?.trim() ?? '';
          const url = job.jobUrl ?? job.applyUrl;
          if (!title || !url) continue;
          // Ashby often flags remote separately from a city location.
          const parts = [job.location?.trim(), job.isRemote ? 'Remote' : ''].filter(Boolean);
          const location = parts.length > 0 ? parts.join(' · ') : null;
          const jdText =
            job.descriptionPlain?.trim() ||
            (job.descriptionHtml ? htmlToText(job.descriptionHtml) : '');

          postings.push({
            source: SOURCE,
            sourceJobId: job.id ?? null,
            company: board.company,
            title,
            location,
            url,
            jdText,
            postedAt: toPostedAt(job.publishedAt ?? job.publishedDate),
            fingerprint: postingFingerprint(board.company, title, location),
            raw: job,
          });
        }
      }
      return postings;
    },
  };
}
