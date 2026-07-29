/**
 * Ashby connector — reads the public job-board API
 * (`api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true`).
 * One call returns all postings with full JD text (`descriptionPlain`).
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toIsoDate } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';

export interface AshbyBoard {
  /** Board name from jobs.ashbyhq.com/{board}. */
  board: string;
  company: string;
}

interface AshbyJob {
  title?: string;
  location?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  isRemote?: boolean;
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
            company: board.company,
            title,
            location,
            url,
            jdText,
            postedDate: toIsoDate(job.publishedDate),
            fingerprint: postingFingerprint(board.company, title, location),
            raw: job,
          });
        }
      }
      return postings;
    },
  };
}
