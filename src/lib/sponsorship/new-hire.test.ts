import { describe, expect, it } from 'vitest';
import { newHireStatus } from './new-hire';
import type { SponsorHistory } from './score';

const NOW = 2026;

function history(partial: Partial<SponsorHistory>): SponsorHistory {
  return {
    sponsorCount: 0,
    approvalRate: null,
    lastFiledYear: null,
    newEmploymentApprovals: 0,
    newEmploymentLastYear: null,
    ...partial,
  };
}

function status(h: SponsorHistory | null) {
  return newHireStatus(h, { currentYear: NOW });
}

describe('newHireStatus', () => {
  it('unknown when there is no confident company match', () => {
    expect(status(null)).toBe('unknown');
  });

  it('sponsors_new_hires when there are recent New Employment approvals', () => {
    expect(status(history({ newEmploymentApprovals: 12, newEmploymentLastYear: 2025 }))).toBe(
      'sponsors_new_hires',
    );
  });

  it('sponsors_new_hires exactly at the recency boundary', () => {
    // NOW - 3 = 2023 is the oldest year that still counts as recent.
    expect(status(history({ newEmploymentApprovals: 1, newEmploymentLastYear: 2023 }))).toBe(
      'sponsors_new_hires',
    );
  });

  it('transfers_only for continuation approvals with no new employment', () => {
    expect(status(history({ sponsorCount: 300, newEmploymentApprovals: 0 }))).toBe(
      'transfers_only',
    );
  });

  it('transfers_only when new employment exists but is stale', () => {
    expect(
      status(
        history({ sponsorCount: 40, newEmploymentApprovals: 40, newEmploymentLastYear: 2019 }),
      ),
    ).toBe('transfers_only');
  });

  it('no_record when the employer matched but has no approvals on record', () => {
    expect(status(history({ sponsorCount: 0, newEmploymentApprovals: 0 }))).toBe('no_record');
  });

  it('defaults to the current year when no opts are passed', () => {
    // A far-future last year is always "recent"; just assert no throw + valid state.
    expect(newHireStatus(history({ newEmploymentApprovals: 5, newEmploymentLastYear: 9999 }))).toBe(
      'sponsors_new_hires',
    );
  });
});
