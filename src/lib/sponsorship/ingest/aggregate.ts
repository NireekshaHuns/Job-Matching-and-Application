/**
 * Aggregate USCIS records into one row per employer, keyed by the normalized
 * company name so name variants collapse together. Multiple source rows for the
 * same employer-year (the file can split by state/NAICS) are summed on purpose.
 *
 * Pure — reuses `normalizeCompanyName` (the same join key jobs are matched on).
 */
import { normalizeCompanyName } from '../normalize';
import type { UscisRecord } from './parse';

export interface SponsorAggregate {
  companyNameNormalized: string;
  /**
   * Raw lifetime total of approvals (initial + continuing) across all years.
   * NOT recency-weighted — recency is applied at scoring time via
   * `lastFiledYear` (see `scoreSponsorship`).
   */
  sponsorCount: number;
  /** approvals / (approvals + denials), rounded to 4 dp; null if no decisions. */
  approvalRate: number | null;
  /**
   * Latest fiscal year with any decision activity. The Data Hub reports
   * decisions, not filings, so this approximates "last filed year".
   */
  lastFiledYear: number;
}

export function aggregateSponsors(records: UscisRecord[]): SponsorAggregate[] {
  const acc = new Map<string, { approvals: number; denials: number; lastYear: number }>();

  for (const r of records) {
    const key = normalizeCompanyName(r.employer);
    if (!key) continue;

    const approvals = r.initialApprovals + r.continuingApprovals;
    const denials = r.initialDenials + r.continuingDenials;

    const cur = acc.get(key) ?? { approvals: 0, denials: 0, lastYear: 0 };
    cur.approvals += approvals;
    cur.denials += denials;
    if (approvals + denials > 0 && r.fiscalYear > cur.lastYear) {
      cur.lastYear = r.fiscalYear;
    }
    acc.set(key, cur);
  }

  const out: SponsorAggregate[] = [];
  for (const [companyNameNormalized, v] of acc) {
    const decisions = v.approvals + v.denials;
    // Skip employers that appear only with zero activity — no signal.
    if (decisions === 0) continue;

    out.push({
      companyNameNormalized,
      sponsorCount: v.approvals,
      approvalRate: Math.round((v.approvals / decisions) * 10000) / 10000,
      lastFiledYear: v.lastYear,
    });
  }
  return out;
}
