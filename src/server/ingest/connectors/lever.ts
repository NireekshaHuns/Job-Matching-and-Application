/**
 * Lever connector — reads the public postings API
 * (`api.lever.co/v0/postings/{company}?mode=json`). Carries full JD text
 * (`descriptionPlain`), so it's a high-signal, direct-from-employer source.
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';
import { emptyReport, fetchBoard } from '../report';

export interface LeverBoard {
  /** Company slug from jobs.lever.co/{token}. */
  token: string;
  company: string;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
  description?: string;
  createdAt?: number;
}

const SOURCE = 'lever';
const API_BASE = 'https://api.lever.co/v0/postings';

export function leverConnector(
  boards: LeverBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  // Reset per fetch, so a report never mixes two runs.
  let report = emptyReport();
  return {
    source: SOURCE,
    lastReport: () => report,
    async fetch(): Promise<RawPosting[]> {
      report = emptyReport();
      const postings: RawPosting[] = [];
      for (const board of boards) {
        const res = await fetchBoard(
          fetcher,
          `${API_BASE}/${board.token}?mode=json`,
          board.token,
          report,
        );
        if (!res) continue;
        const data = (await res.json()) as LeverPosting[];

        for (const p of Array.isArray(data) ? data : []) {
          const title = p.text?.trim() ?? '';
          const url = p.hostedUrl ?? p.applyUrl;
          if (!title || !url) continue;
          const location = p.categories?.location?.trim() || null;
          const jdText =
            p.descriptionPlain?.trim() || (p.description ? htmlToText(p.description) : '');

          postings.push({
            source: SOURCE,
            sourceJobId: p.id ?? null,
            company: board.company,
            title,
            location,
            url,
            jdText,
            postedAt: toPostedAt(p.createdAt),
            fingerprint: postingFingerprint(board.company, title, location),
            raw: p,
          });
        }
      }
      return postings;
    },
  };
}
