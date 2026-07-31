/**
 * SimplifyJobs New-Grad connector — reads the community-maintained
 * `listings.json` (US new-grad SWE roles, updated daily). No auth; the file has
 * no job-description text, so `jdText` is empty and enrichment fills gaps later.
 *
 * The listing's `sponsorship` field is carried through in `raw` but NOT acted on
 * here — connectors don't score/filter (that's enrichment). Attribution: data
 * from github.com/SimplifyJobs/New-Grad-Positions.
 */
import { postingFingerprint } from '../fingerprint';
import type { Fetcher, JobConnector, RawPosting } from '../types';

interface SimplifyListing {
  id?: string;
  company_name?: string;
  title?: string;
  url?: string;
  location?: string;
  locations?: string[];
  date_posted?: number;
  date_updated?: number;
  active?: boolean;
  is_visible?: boolean;
  /** Carried through in `raw`; the connector never acts on it (enrichment does). */
  sponsorship?: string;
}

const DEFAULT_SOURCE = 'github:simplify-newgrad';
const DEFAULT_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';

function toIsoDate(unix?: number): string | null {
  if (unix == null || Number.isNaN(unix)) return null;
  // Repo uses unix seconds; guard in case a value is already in millis.
  const ms = unix < 1e12 ? unix * 1000 : unix;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toLocation(listing: SimplifyListing): string | null {
  if (Array.isArray(listing.locations) && listing.locations.length > 0) {
    return listing.locations.join(', ');
  }
  return listing.location?.trim() || null;
}

export function simplifyNewGradConnector(
  opts: { url?: string; source?: string } = {},
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  const source = opts.source ?? DEFAULT_SOURCE;
  const url = opts.url ?? DEFAULT_URL;

  return {
    source,
    async fetch(): Promise<RawPosting[]> {
      const res = await fetcher(url);
      if (!res.ok) {
        console.warn(`[${source}] ${url} -> HTTP ${res.status}`);
        return [];
      }
      const listings = (await res.json()) as SimplifyListing[];

      const postings: RawPosting[] = [];
      for (const listing of listings) {
        // Skip inactive / hidden listings (defaults treat missing as active).
        if (listing.active === false || listing.is_visible === false) continue;

        const company = listing.company_name?.trim() ?? '';
        const title = listing.title?.trim() ?? '';
        const url = listing.url?.trim() ?? '';
        if (!company || !title || !url) continue;
        const location = toLocation(listing);

        postings.push({
          source,
          sourceJobId: listing.id ?? null,
          company,
          title,
          location,
          url,
          jdText: '',
          // `||` not `??`: treat a 0 / missing date_posted as unknown and fall back.
          postedDate: toIsoDate(listing.date_posted || listing.date_updated),
          fingerprint: postingFingerprint(company, title, location),
          raw: listing,
        });
      }
      return postings;
    },
  };
}
