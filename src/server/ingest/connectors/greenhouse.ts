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
  /** Present on many boards; used when top-level `location` is empty. */
  offices?: Array<{ name?: string }>;
  content?: string;
}

/** Prefer the top-level location; fall back to joined office names. */
function jobLocation(job: GreenhouseJob): string | null {
  const primary = job.location?.name?.trim();
  if (primary) return primary;
  const offices = (job.offices ?? [])
    .map((o) => o.name?.trim())
    .filter((name): name is string => Boolean(name));
  return offices.length > 0 ? offices.join(', ') : null;
}

const SOURCE = 'greenhouse';
const API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

function decodeEntitiesOnce(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Decode to a fixed point so multi-encoded entities (`&amp;amp;`) fully resolve. */
function decodeEntities(s: string): string {
  let current = s;
  for (let i = 0; i < 5; i++) {
    const next = decodeEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Flatten (possibly entity-encoded) HTML to readable plain text.
 *
 * Decodes entities to a fixed point so markup like `&lt;p&gt;` becomes a real
 * tag, then strips only tag-shaped spans ONCE — a `<` must be followed by a
 * letter or `/` to count as a tag, so prose like "use a < b" survives. There is
 * no decode after stripping, so tags can't be re-created and destroyed. (Inline
 * pseudo-tags like `<String>` may still be dropped; fine for classifier input.)
 */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(html);
  const withBreaks = decoded
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n');
  const stripped = withBreaks.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  return stripped
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
          const location = jobLocation(job);

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
