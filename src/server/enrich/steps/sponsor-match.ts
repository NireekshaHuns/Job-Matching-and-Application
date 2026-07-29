/**
 * Sponsor-match step: join a posting's company to government sponsor history and
 * produce the H1B tier. Reuses `normalizeCompanyName` (the same join key the
 * ingestion built) and `scoreSponsorship` (the Epic 2 tiering logic).
 */
import { normalizeCompanyName, scoreSponsorship } from '@/lib/sponsorship';
import type { SponsorTier } from '@/lib/sponsorship';
import type { SponsorLookup } from '../types';

export interface SponsorMatch {
  tier: SponsorTier;
  reason: string;
  /** Denormalized onto the job row for fast board reads; null when unmatched. */
  sponsorCount: number | null;
}

export function matchSponsor(company: string, jdText: string, lookup: SponsorLookup): SponsorMatch {
  const key = normalizeCompanyName(company);
  const history = key ? lookup(key) : null;
  const { tier, reason } = scoreSponsorship({ jdText, history });
  return { tier, reason, sponsorCount: history?.sponsorCount ?? null };
}
