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
  /** Section of the README this listing belongs to — see SWE_CATEGORIES. */
  category?: string;
  /** Carried through in `raw`; the connector never acts on it (enrichment does). */
  sponsorship?: string;
}

/**
 * `listings.json` backs every section of the repo's README, not just the
 * software one — a full fetch is ~2,800 active listings, and Hardware, Quant
 * and Product are not roles this board is for. Filtering here keeps them out
 * before they cost an LLM classify on ingest.
 *
 * Several labels are in play. `Software` is what the repo writes today and
 * `Software Engineering` is an older label still on ~16 live rows; both map to
 * the README's software-engineering section.
 *
 * `AI/ML/Data` (~880 active) IS included. It was excluded at first on the
 * grounds that it is mostly research, but the owner's strongest differentiator
 * is applied AI — LLMs, RAG, vector search — and the section carries plenty of
 * genuine ML-platform and AI-infrastructure engineering. Deciding from a coarse
 * category label was the wrong place to draw the line: enrichment's
 * `role_family` classification reads the actual JD, and the board can filter on
 * it, so a research-only posting is separable downstream.
 */
const SWE_CATEGORIES = new Set([
  'software',
  'software engineering',
  'ai/ml/data',
  // Older spelling of the same section, still attached to a couple of rows.
  'data science, ai & machine learning',
]);

/** Does this listing belong to a section the board covers? */
export function isSoftwareCategory(category: string | undefined): boolean {
  if (!category) return false;
  return SWE_CATEGORIES.has(category.trim().toLowerCase());
}

const DEFAULT_SOURCE = 'github:simplify-newgrad';
/** Exported so the one-off prune script reads the same feed as the connector. */
export const SIMPLIFY_LISTINGS_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';

function toPostedAt(unix?: number): Date | null {
  if (unix == null || Number.isNaN(unix)) return null;
  // Repo uses unix seconds; guard in case a value is already in millis.
  const ms = unix < 1e12 ? unix * 1000 : unix;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toLocation(listing: SimplifyListing): string | null {
  if (Array.isArray(listing.locations) && listing.locations.length > 0) {
    return listing.locations.join(', ');
  }
  return listing.location?.trim() || null;
}

export function simplifyNewGradConnector(
  opts: {
    url?: string;
    source?: string;
    /**
     * Skip the category filter. For ATS-board DISCOVERY only, which just reads
     * apply URLs: a company that posts a Hardware or Quant role has a board
     * that carries its software roles too, so narrowing the scan there loses
     * employers for no benefit. Ingestion stays filtered.
     */
    allCategories?: boolean;
  } = {},
  fetcher: Fetcher = globalThis.fetch,
): JobConnector {
  const source = opts.source ?? DEFAULT_SOURCE;
  const url = opts.url ?? SIMPLIFY_LISTINGS_URL;
  const inScope = (category: string | undefined) =>
    opts.allCategories === true || isSoftwareCategory(category);

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
      let live = 0;
      for (const listing of listings) {
        // Skip inactive / hidden listings (defaults treat missing as active).
        if (listing.active === false || listing.is_visible === false) continue;
        live++;
        // Roles the board covers; the file spans every README section.
        if (!inScope(listing.category)) continue;

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
          postedAt: toPostedAt(listing.date_posted || listing.date_updated),
          fingerprint: postingFingerprint(company, title, location),
          raw: listing,
        });
      }
      // Live listings but nothing matched: the upstream `category` labels have
      // almost certainly changed. Say so loudly — the failure mode of a silent
      // category filter is ingesting zero jobs and looking like an empty feed.
      if (live > 0 && postings.length === 0 && !opts.allCategories) {
        console.warn(
          `[${source}] ${live} active listings but none matched ${[...SWE_CATEGORIES].join('/')} — has the upstream category label changed?`,
        );
      }
      return postings;
    },
  };
}
