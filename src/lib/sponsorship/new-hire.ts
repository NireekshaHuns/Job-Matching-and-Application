/**
 * New-hire sponsorship badge — derives the four-state signal from USCIS history.
 *
 * The spec (§5.1) makes the New Employment (initial) approvals column the key
 * signal: it separates genuine new-hire sponsors from transfer/continuation-only
 * employers. This is complementary to `scoreSponsorship`'s tier (which also reads
 * the JD); here we report only what the government data says.
 *
 * All four states are meaningful and visible — none is ever dropped:
 *   - sponsors_new_hires: recent New Employment approvals on record
 *   - transfers_only:     H1B approvals on record, but no recent new employment
 *   - no_record:          matched a USCIS employer with no approvals on record
 *   - unknown:            no confident match to a USCIS employer
 *
 * Pure and deterministic. History is passed in (null when unmatched).
 */
import type { newHireStatusEnum } from '@/server/db/schema';
import type { SponsorHistory } from './score';

export type NewHireStatus = (typeof newHireStatusEnum.enumValues)[number];

/** New Employment no older than this many years counts as "recent". */
const RECENT_YEARS = 3;

/**
 * Map aggregated sponsor history to a new-hire badge. `null` history means no
 * confident company→USCIS match, which is `unknown` (never fabricated as a
 * negative — see spec §7: never silently assert a match).
 */
export function newHireStatus(
  history: SponsorHistory | null,
  opts?: { currentYear?: number },
): NewHireStatus {
  if (!history) return 'unknown';

  const currentYear = opts?.currentYear ?? new Date().getUTCFullYear();
  const newRecent =
    history.newEmploymentLastYear != null &&
    history.newEmploymentLastYear >= currentYear - RECENT_YEARS;

  if (history.newEmploymentApprovals > 0 && newRecent) return 'sponsors_new_hires';
  // Approvals on record (continuing, or older new-employment) but not recent new hires.
  if (history.sponsorCount > 0 || history.newEmploymentApprovals > 0) return 'transfers_only';
  return 'no_record';
}
