/**
 * Greenhouse connector — reads the public, unauthenticated job-board API
 * (`boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`). One board
 * token per company; the board's job descriptions come as (entity-encoded)
 * HTML, which we flatten to plain text.
 */
import { postingFingerprint } from '../fingerprint';
import type { Fetcher, JobConnector, RawPosting } from '../types';

export interface GreenhouseBoard {
  /** Board token, e.g. `stripe` from boards.greenhouse.io/stripe. */
  token: string;
  /** Company name to attach to each posting (the board API omits it). */
  company: string;
}

interface GreenhouseJob {
  id: number;
  title?: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string } | null;
  content?: string;
}

const SOURCE = 'greenhouse';
const API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Flatten (possibly entity-encoded) HTML to readable plain text. */
export function htmlToText(html: string): string {
  // Decode first so entity-encoded markup (`&lt;p&gt;`) becomes real tags.
  const decoded = decodeEntities(html);
  const withBreaks = decoded
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toIsoDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Build a Greenhouse connector over the given boards. `fetcher` is injectable
 * so tests can pass a fixture client instead of hitting the network.
 */
export function greenhouseConnector(
  boards: GreenhouseBoard[],
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  return {
    source: SOURCE,
    async fetch(): Promise<RawPosting[]> {
      const postings: RawPosting[] = [];

      for (const board of boards) {
        const res = await fetcher(`${API_BASE}/${board.token}/jobs?content=true`);
        if (!res.ok) {
          console.warn(`[greenhouse] ${board.token} -> HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { jobs?: GreenhouseJob[] };

        for (const job of data.jobs ?? []) {
          const title = job.title?.trim() ?? '';
          if (!title || !job.absolute_url) continue;
          const location = job.location?.name?.trim() || null;

          postings.push({
            source: SOURCE,
            company: board.company,
            title,
            location,
            url: job.absolute_url,
            jdText: job.content ? htmlToText(job.content) : '',
            postedDate: toIsoDate(job.updated_at),
            fingerprint: postingFingerprint(board.company, title, location),
            raw: job,
          });
        }
      }

      return postings;
    },
  };
}
