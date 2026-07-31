import { describe, expect, it } from 'vitest';
import { aggregateFilings, aggregateSponsors } from './aggregate';
import type { UscisRecord } from './parse';

function rec(
  partial: Partial<UscisRecord> & { employer: string; fiscalYear: number },
): UscisRecord {
  return {
    initialApprovals: 0,
    initialDenials: 0,
    continuingApprovals: 0,
    continuingDenials: 0,
    state: null,
    ...partial,
  };
}

describe('aggregateSponsors', () => {
  it('collapses name variants into one normalized employer', () => {
    const result = aggregateSponsors([
      rec({
        employer: 'GOOGLE LLC',
        fiscalYear: 2024,
        initialApprovals: 120,
        initialDenials: 3,
        continuingApprovals: 50,
        continuingDenials: 1,
      }),
      rec({
        employer: 'Google, Inc.',
        fiscalYear: 2023,
        initialApprovals: 80,
        initialDenials: 2,
        continuingApprovals: 40,
      }),
    ]);
    expect(result).toHaveLength(1);
    const [google] = result;
    expect(google.companyNameNormalized).toBe('GOOGLE');
    // approvals: 120+50+80+40 = 290
    expect(google.sponsorCount).toBe(290);
    // denials: 3+1+2 = 6 -> 290/296
    expect(google.approvalRate).toBeCloseTo(0.9797, 4);
    expect(google.lastFiledYear).toBe(2024);
  });

  it('computes a per-employer approval rate', () => {
    const [acme] = aggregateSponsors([
      rec({ employer: 'ACME CORP', fiscalYear: 2024, initialApprovals: 5, initialDenials: 15 }),
    ]);
    expect(acme.sponsorCount).toBe(5);
    expect(acme.approvalRate).toBe(0.25);
  });

  it('drops employers with no decision activity', () => {
    const result = aggregateSponsors([rec({ employer: 'Ghost Co', fiscalYear: 2024 })]);
    expect(result).toHaveLength(0);
  });

  it('keeps a denials-only employer with a 0 count and 0 approval rate', () => {
    const [deniedOnly] = aggregateSponsors([
      rec({ employer: 'Never Approved Co', fiscalYear: 2024, initialDenials: 5 }),
    ]);
    expect(deniedOnly.sponsorCount).toBe(0);
    expect(deniedOnly.approvalRate).toBe(0);
    expect(deniedOnly.lastFiledYear).toBe(2024);
  });

  it('uses the latest active fiscal year and null rate only when no decisions', () => {
    const result = aggregateSponsors([
      rec({ employer: 'X', fiscalYear: 2020, initialApprovals: 1 }),
      rec({ employer: 'X', fiscalYear: 2025, initialApprovals: 2 }),
    ]);
    expect(result[0].lastFiledYear).toBe(2025);
    expect(result[0].approvalRate).toBe(1);
  });

  describe('new-employment (initial) split', () => {
    it('separates lifetime new-employment approvals from the blended count', () => {
      const [google] = aggregateSponsors([
        rec({
          employer: 'GOOGLE LLC',
          fiscalYear: 2024,
          initialApprovals: 120,
          continuingApprovals: 50,
        }),
        rec({
          employer: 'Google, Inc.',
          fiscalYear: 2023,
          initialApprovals: 80,
          continuingApprovals: 40,
        }),
      ]);
      // blended (unchanged): 120+50+80+40 = 290
      expect(google.sponsorCount).toBe(290);
      // new-employment only: 120+80 = 200
      expect(google.newEmploymentApprovals).toBe(200);
      expect(google.newEmploymentLastYear).toBe(2024);
      expect(google.newEmploymentRecentYears).toEqual([
        { year: 2024, initialApprovals: 120 },
        { year: 2023, initialApprovals: 80 },
      ]);
    });

    it('flags a transfers-only employer: continuing approvals but no new employment', () => {
      const [transfers] = aggregateSponsors([
        rec({ employer: 'Bodyshop LLC', fiscalYear: 2024, continuingApprovals: 200 }),
      ]);
      expect(transfers.sponsorCount).toBe(200);
      expect(transfers.newEmploymentApprovals).toBe(0);
      expect(transfers.newEmploymentLastYear).toBeNull();
      expect(transfers.newEmploymentRecentYears).toEqual([]);
    });

    it('keeps only the most recent few new-employment years, newest first', () => {
      const [acme] = aggregateSponsors([
        rec({ employer: 'Acme', fiscalYear: 2021, initialApprovals: 1 }),
        rec({ employer: 'Acme', fiscalYear: 2022, initialApprovals: 2 }),
        rec({ employer: 'Acme', fiscalYear: 2023, initialApprovals: 3 }),
        rec({ employer: 'Acme', fiscalYear: 2024, initialApprovals: 4 }),
      ]);
      expect(acme.newEmploymentRecentYears).toEqual([
        { year: 2024, initialApprovals: 4 },
        { year: 2023, initialApprovals: 3 },
        { year: 2022, initialApprovals: 2 },
      ]);
      expect(acme.newEmploymentLastYear).toBe(2024);
    });
  });
});

describe('aggregateFilings', () => {
  it('sums split rows into one row per employer-year and drops empty years', () => {
    const filings = aggregateFilings([
      rec({ employer: 'ACME CORP', fiscalYear: 2024, initialApprovals: 5, continuingApprovals: 2 }),
      rec({ employer: 'Acme, Inc.', fiscalYear: 2024, initialApprovals: 3, initialDenials: 1 }),
      rec({ employer: 'Ghost Co', fiscalYear: 2024 }), // no activity -> dropped
    ]);
    expect(filings).toHaveLength(1);
    expect(filings[0]).toEqual({
      companyNameNormalized: 'ACME',
      fiscalYear: 2024,
      initialApprovals: 8,
      initialDenials: 1,
      continuingApprovals: 2,
      continuingDenials: 0,
    });
  });

  it('keeps distinct fiscal years as separate rows', () => {
    const filings = aggregateFilings([
      rec({ employer: 'X', fiscalYear: 2023, initialApprovals: 1 }),
      rec({ employer: 'X', fiscalYear: 2024, initialApprovals: 2 }),
    ]);
    expect(filings).toHaveLength(2);
    expect(filings.map((f) => f.fiscalYear).sort()).toEqual([2023, 2024]);
  });
});
