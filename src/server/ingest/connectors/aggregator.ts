/**
 * JSearch aggregator connector — the sanctioned route to Indeed / Glassdoor /
 * ZipRecruiter listings.
 *
 * Those boards retired their public APIs and sit behind commercial bot
 * detection, so a direct connector would need fingerprint spoofing and proxy
 * rotation to work at all. JSearch reaches them through Google for Jobs and
 * returns a stable JSON contract instead, which is why this exists rather than
 * an `indeed.ts` and a `glassdoor.ts`.
 *
 * THE BUDGET IS THE DESIGN CONSTRAINT. The free tier is 200 requests per
 * *month* — perhaps ten refresh runs — so unlike the ATS connectors, which page
 * until a feed is exhausted, everything here is capped up front and a 429 ends
 * the run immediately. One runaway pagination loop would spend the month.
 */
import { postingFingerprint } from '../fingerprint';
import { htmlToText, toPostedAt } from '../html';
import type { Fetcher, JobConnector, RawPosting } from '../types';

/** Exported so the registry can mark this source metered without a literal. */
export const AGGREGATOR_SOURCE = 'aggregator:jsearch';
const SOURCE = AGGREGATOR_SOURCE;
const API_BASE = 'https://api.openwebninja.com/jsearch/search-v2';

/**
 * Hard ceiling on requests per run, across every query. Sized so a run costs
 * well under a tenth of the free monthly allowance and the board stays usable
 * without a paid plan. Raising this is a spending decision, not a tuning one.
 */
const DEFAULT_MAX_REQUESTS = 12;

/** Pages to walk per query before moving on, within the request ceiling. */
const DEFAULT_MAX_PAGES_PER_QUERY = 2;

/**
 * Only postings from the last week. Older results cost the same requests and
 * are mostly already in the DB from previous runs, so the recency filter buys
 * more genuinely-new jobs per request than a wider window would.
 */
const DEFAULT_DATE_POSTED = 'week';

/** A keyword/location pair to search. */
export interface AggregatorQuery {
  query: string;
  /** ISO country code the API filters on. */
  country?: string;
}

export interface AggregatorOptions {
  maxRequests?: number;
  maxPagesPerQuery?: number;
  datePosted?: string;
}

/** The subset of the JSearch job shape this connector reads. */
interface JSearchJob {
  job_id?: string;
  employer_name?: string;
  job_title?: string;
  job_description?: string;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string | null;
  /** The publisher's own posting page — preferred over the aggregator link. */
  job_apply_link?: string | null;
  /** Which upstream board this came from ("Indeed", "Glassdoor", ...). */
  job_publisher?: string | null;
}

/**
 * The API nests results one level deeper than the field name suggests:
 * `{ status, request_id, parameters, data: { jobs, cursor } }`. Reading
 * `data` as the array yields zero postings with no error — the request
 * succeeds, `Array.isArray` is false, and the run silently returns nothing.
 */
interface JSearchResponse {
  data?: {
    jobs?: JSearchJob[];
    /** Opaque pagination token; absent on the last page. */
    cursor?: string | null;
  } | null;
}

/**
 * Human-readable location from the API's split city/state fields.
 *
 * Remote is emitted as the literal "Remote" because `normalizeLocation` maps
 * that to its `remote` token — which is what lets a remote job from here
 * collapse onto the same fingerprint as the ATS copy of it.
 */
export function formatLocation(job: JSearchJob): string | null {
  if (job.job_is_remote) return 'Remote';
  const parts = [job.job_city, job.job_state].map((p) => p?.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return job.job_country?.trim() || null;
}

/**
 * Map one API job to a `RawPosting`, or null if it lacks the fields that make a
 * posting meaningful (company, title, somewhere to apply).
 *
 * The description arrives as text but occasionally carries HTML, so it goes
 * through `htmlToText` — which is also what decodes entities in company names,
 * keeping the sponsor join key intact (see the LinkedIn connector for why that
 * matters).
 */
export function toPosting(job: JSearchJob): RawPosting | null {
  const company = htmlToText(job.employer_name ?? '').trim();
  const title = htmlToText(job.job_title ?? '').trim();
  const url = job.job_apply_link?.trim();
  if (!company || !title || !url) return null;

  const location = formatLocation(job);
  return {
    source: SOURCE,
    sourceJobId: job.job_id ?? null,
    company,
    title,
    location,
    url,
    jdText: job.job_description ? htmlToText(job.job_description) : '',
    postedAt: toPostedAt(job.job_posted_at_datetime_utc),
    fingerprint: postingFingerprint(company, title, location),
    raw: job,
  };
}

/** Quota is gone (429) or the key is rejected (401/403) — stop, don't retry. */
function isFatalStatus(status: number): boolean {
  return status === 429 || status === 401 || status === 403;
}

/**
 * Build the aggregator connector.
 *
 * `apiKey` is required by the caller: the registry omits this connector
 * entirely when `AGGREGATOR_API_KEY` is unset, so CI, e2e and a default
 * checkout never spend a request.
 */
export function aggregatorConnector(
  apiKey: string,
  queries: AggregatorQuery[],
  fetcher: Fetcher = globalThis.fetch,
  opts: AggregatorOptions = {},
): JobConnector {
  const maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const maxPagesPerQuery = opts.maxPagesPerQuery ?? DEFAULT_MAX_PAGES_PER_QUERY;
  const datePosted = opts.datePosted ?? DEFAULT_DATE_POSTED;

  return {
    source: SOURCE,
    async fetch(): Promise<RawPosting[]> {
      const byJobId = new Map<string, RawPosting>();
      let requests = 0;
      let exhausted = false;

      for (const q of queries) {
        if (exhausted || requests >= maxRequests) break;
        let cursor: string | null = null;

        for (let page = 0; page < maxPagesPerQuery; page++) {
          if (requests >= maxRequests) break;

          const params = new URLSearchParams({
            query: q.query,
            country: q.country ?? 'us',
            date_posted: datePosted,
          });
          if (cursor) params.set('cursor', cursor);

          let res: Response;
          try {
            requests++;
            res = await fetcher(`${API_BASE}?${params.toString()}`, {
              headers: { 'x-api-key': apiKey },
              // The Neon/Inngest steps have a wall-clock budget; a hung request
              // should fail this source, not the whole run.
              signal: AbortSignal.timeout(15_000),
            });
          } catch (err) {
            console.warn(`[jsearch] "${q.query}" page ${page} -> ${String(err)}`);
            break;
          }

          if (isFatalStatus(res.status)) {
            // Out of quota or bad key: every further request would fail the same
            // way and still be billed against the plan's rate limit. Stop the
            // whole run and keep what we have.
            console.warn(
              `[jsearch] HTTP ${res.status} — stopping the run after ${requests} request(s). Check the plan's remaining quota.`,
            );
            exhausted = true;
            break;
          }
          if (!res.ok) {
            console.warn(`[jsearch] "${q.query}" page ${page} -> HTTP ${res.status}`);
            break;
          }

          let body: JSearchResponse;
          try {
            body = (await res.json()) as JSearchResponse;
          } catch (err) {
            console.warn(`[jsearch] "${q.query}" page ${page} -> unparseable body: ${String(err)}`);
            break;
          }

          const jobs = Array.isArray(body.data?.jobs) ? body.data.jobs : [];
          for (const job of jobs) {
            const posting = toPosting(job);
            // Keyed by job_id so the same posting returned by two queries costs
            // one row; falling back to the fingerprint when the API omits an id.
            // `??` alone would let an EMPTY id become the key `''`, collapsing
            // every such posting into one row.
            if (posting) byJobId.set(job.job_id?.trim() || posting.fingerprint, posting);
          }

          // A missing cursor means the last page — walking further would spend
          // requests re-reading page one. An unchanged cursor means the same,
          // via a provider bug rather than the end of the results.
          const next = body.data?.cursor ?? null;
          if (!next || next === cursor || jobs.length === 0) break;
          cursor = next;
        }
      }

      // Always report spend, not just at the cap. The only other budget signal
      // this API gives is a 429, which arrives after the money is gone — the
      // same blind spot that made issue #148 take hours to diagnose.
      console.info(
        `[jsearch] spent ${requests} request(s) this run for ${byJobId.size} posting(s).`,
      );
      if (requests >= maxRequests) {
        console.warn(
          `[jsearch] hit the ${maxRequests}-request cap for this run; some queries were not searched.`,
        );
      }
      return [...byJobId.values()];
    },
  };
}
