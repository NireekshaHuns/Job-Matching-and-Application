import { describe, expect, it } from 'vitest';
import type { SponsorHistory } from '@/lib/sponsorship';
import { confirmAliasInput, recomputeSponsorship } from './sponsors';

const NOW_HISTORY: SponsorHistory = {
  sponsorCount: 120,
  approvalRate: 0.95,
  lastFiledYear: 2025,
  newEmploymentApprovals: 60,
  newEmploymentLastYear: 2025,
};

describe('confirmAliasInput', () => {
  it('requires a company and allows a null sponsor (confirmed no-match)', () => {
    expect(confirmAliasInput.parse({ company: 'Stripe', sponsorId: null })).toEqual({
      company: 'Stripe',
      sponsorId: null,
    });
    expect(confirmAliasInput.parse({ company: 'Stripe', sponsorId: 7 }).sponsorId).toBe(7);
  });

  it('rejects a missing company or missing sponsorId key', () => {
    expect(() => confirmAliasInput.parse({ sponsorId: 1 })).toThrow();
    expect(() => confirmAliasInput.parse({ company: 'X' })).toThrow();
  });
});

describe('recomputeSponsorship', () => {
  it('derives both scores + badge for a confirmed match', () => {
    const upd = recomputeSponsorship('Backend role.', NOW_HISTORY, 1);
    expect(upd.sponsorCount).toBe(120);
    expect(upd.sponsorMatchConfidence).toBe(1);
    // Recent heavy new-employment history -> High + sponsors_new_hires.
    expect(upd.sponsorTier).toBe('High');
    expect(upd.newHireStatus).toBe('sponsors_new_hires');
  });

  it('yields an unknown/unmatched row for a confirmed no-match', () => {
    const upd = recomputeSponsorship('Backend role.', null, null);
    expect(upd.sponsorCount).toBeNull();
    expect(upd.sponsorMatchConfidence).toBeNull();
    expect(upd.newHireStatus).toBe('unknown');
    expect(upd.sponsorTier).toBe('Low');
  });

  it('still honors a JD disqualifier over history (Excluded)', () => {
    const upd = recomputeSponsorship('We do not offer visa sponsorship.', NOW_HISTORY, 1);
    expect(upd.sponsorTier).toBe('Excluded');
  });
});
