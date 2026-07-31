/**
 * Sponsor-match step: resolve a posting's company to government sponsor history
 * and produce both scores' government inputs — the H1B tier (`scoreSponsorship`)
 * and the new-hire badge (`newHireStatus`) — plus the match confidence for audit.
 */
import { newHireStatus, scoreSponsorship } from '@/lib/sponsorship';
import type { NewHireStatus, SponsorTier } from '@/lib/sponsorship';
import type { SponsorResolver } from './resolver';

export interface SponsorMatch {
  tier: SponsorTier;
  reason: string;
  /** Denormalized onto the job row for fast board reads; null when unmatched. */
  sponsorCount: number | null;
  /** New-hire badge derived from the USCIS new-employment signal. */
  newHireStatus: NewHireStatus;
  /** 0–1 confidence of the company→USCIS match; null when unmatched. */
  matchConfidence: number | null;
}

export function matchSponsor(
  company: string,
  jdText: string,
  resolve: SponsorResolver,
  opts?: { currentYear?: number },
): SponsorMatch {
  const { history, confidence } = resolve(company);
  const { tier, reason } = scoreSponsorship({ jdText, history }, opts);
  return {
    tier,
    reason,
    sponsorCount: history?.sponsorCount ?? null,
    newHireStatus: newHireStatus(history, opts),
    matchConfidence: confidence,
  };
}
