import { describe, expect, it } from 'vitest';
import { sponsorTierEnum } from '@/server/db/schema';
import { scoreSponsorship, type SponsorHistory } from './score';

const NOW = 2026;
const heavyRecent: SponsorHistory = {
  sponsorCount: 120,
  approvalRate: 0.95,
  lastFiledYear: 2025,
  newEmploymentApprovals: 60,
  newEmploymentLastYear: 2025,
};
const someOld: SponsorHistory = {
  sponsorCount: 8,
  approvalRate: 0.8,
  lastFiledYear: 2019,
  newEmploymentApprovals: 8,
  newEmploymentLastYear: 2019,
};

function tier(jdText: string, history: SponsorHistory | null = null) {
  return scoreSponsorship({ jdText, history }, { currentYear: NOW }).tier;
}

describe('scoreSponsorship', () => {
  describe('Excluded — explicit disqualifiers (checked first)', () => {
    it.each([
      'We are unable to offer visa sponsorship for this role.',
      'This position does not offer sponsorship.',
      'No sponsorship is available.',
      'No visa sponsorship for this position.',
      'Candidates must be authorized to work in the US without sponsorship.',
      'Must be a US citizen.',
      'U.S. citizenship is required.',
      'Open only to citizens or permanent residents.',
      'Green card required.',
      'We will not sponsor applicants for work visas.',
      // Regression strings from code review — common ATS phrasings.
      'We are not able to provide visa sponsorship.',
      'We cannot provide sponsorship for this role.',
      'We do not currently offer sponsorship.',
      'Sponsorship is not available for this position.',
      'This role is not eligible for visa sponsorship.',
      'Must be authorized to work in the United States without requiring current or future sponsorship.',
    ])('excludes: %j', (jd) => {
      // Excluded wins even if the employer has heavy history.
      expect(tier(jd, heavyRecent)).toBe('Excluded');
    });

    it('inclusive EEO phrasing is NOT excluded (auditable, not silently dropped)', () => {
      expect(
        tier(
          'We welcome applications from citizens or permanent residents and visa holders alike.',
        ),
      ).not.toBe('Excluded');
    });
  });

  describe('High — explicit offer or heavy recent history', () => {
    it.each([
      'Visa sponsorship is available for this role.',
      'We will sponsor qualified candidates.',
      'The company offers visa sponsorship.',
      'We are open to sponsorship.',
      'H1B sponsorship provided.',
    ])('offer in JD -> High: %j', (jd) => {
      expect(tier(jd)).toBe('High');
    });

    it('heavy recent NEW-EMPLOYMENT history with a silent JD -> High', () => {
      expect(tier('Build backend services in Go.', heavyRecent)).toBe('High');
    });

    it('transfer/continuation-heavy body shop cannot reach High on history alone', () => {
      // Big blended count, but zero new-employment -> not a new-hire sponsor.
      expect(
        tier('Backend role.', {
          sponsorCount: 500,
          approvalRate: 0.9,
          lastFiledYear: 2025,
          newEmploymentApprovals: 0,
          newEmploymentLastYear: null,
        }),
      ).toBe('Medium');
    });
  });

  describe('Medium — prior history, silent JD', () => {
    it('some new-employment history, silent JD -> Medium', () => {
      expect(tier('Frontend engineer, React.', someOld)).toBe('Medium');
    });

    it('heavy new-employment but stale (outside recency window) -> Medium', () => {
      expect(
        tier('Backend role.', {
          sponsorCount: 200,
          approvalRate: 0.9,
          lastFiledYear: 2015,
          newEmploymentApprovals: 200,
          newEmploymentLastYear: 2015,
        }),
      ).toBe('Medium');
    });

    it('heavy new-employment exactly at the recency boundary -> High', () => {
      // NOW - RECENT_YEARS = 2023 is the oldest year that still counts.
      expect(
        tier('Backend role.', {
          sponsorCount: 200,
          approvalRate: 0.9,
          lastFiledYear: 2023,
          newEmploymentApprovals: 200,
          newEmploymentLastYear: 2023,
        }),
      ).toBe('High');
    });

    it('heavy new-employment one year past the boundary -> Medium', () => {
      expect(
        tier('Backend role.', {
          sponsorCount: 200,
          approvalRate: 0.9,
          lastFiledYear: 2022,
          newEmploymentApprovals: 200,
          newEmploymentLastYear: 2022,
        }),
      ).toBe('Medium');
    });
  });

  describe('Low — silent JD, little/no history', () => {
    it('no history match -> Low', () => {
      expect(tier('Great startup, ping pong tables.', null)).toBe('Low');
    });

    it('matched employer with zero approvals on record -> Low', () => {
      expect(
        tier('Great role.', {
          sponsorCount: 0,
          approvalRate: null,
          lastFiledYear: null,
          newEmploymentApprovals: 0,
          newEmploymentLastYear: null,
        }),
      ).toBe('Low');
    });
  });

  describe('negation handling', () => {
    it('"does not offer sponsorship" is Excluded, not High', () => {
      expect(tier('This role does not offer sponsorship.')).toBe('Excluded');
    });

    it('an unrelated use of "sponsor" does not trigger High', () => {
      expect(tier('You will sponsor local community meetups.')).toBe('Low');
    });
  });

  describe('output contract', () => {
    const cases: Array<{ jd: string; history: SponsorHistory | null }> = [
      { jd: 'We offer visa sponsorship.', history: null },
      { jd: 'Must be a US citizen.', history: null },
      { jd: 'Backend role.', history: heavyRecent },
      { jd: 'Backend role.', history: someOld },
      { jd: 'Backend role.', history: null },
    ];

    it.each(cases)('always returns a valid tier and a non-empty reason: %j', ({ jd, history }) => {
      const result = scoreSponsorship({ jdText: jd, history }, { currentYear: NOW });
      expect(sponsorTierEnum.enumValues).toContain(result.tier);
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it('tiers by history when the JD is empty', () => {
      expect(tier('', someOld)).toBe('Medium');
      expect(tier('', null)).toBe('Low');
    });

    it('works without opts (uses the current year by default)', () => {
      // No currentYear passed — just assert it returns a valid tier, no throw.
      const result = scoreSponsorship({ jdText: 'Backend role.', history: heavyRecent });
      expect(sponsorTierEnum.enumValues).toContain(result.tier);
    });
  });

  describe('an employer actively sponsoring new hires', () => {
    const history = (years: Array<{ year: number; initialApprovals: number }>) => ({
      sponsorCount: 170,
      approvalRate: 0.96,
      lastFiledYear: 2026,
      newEmploymentApprovals: 11,
      newEmploymentLastYear: 2026,
      newEmploymentRecentYears: years,
    });

    it('is High on a modest but current record', () => {
      // State Street: 11 new-hire approvals in FY2026. Far below the lifetime
      // HEAVY_NEW_EMPLOYMENT bar of 25, which is why it used to read Medium.
      const score = scoreSponsorship(
        { jdText: 'Build things.', history: history([{ year: 2026, initialApprovals: 11 }]) },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('High');
      expect(score.reason).toContain('11 new hires in 2026');
    });

    it('stays Medium below the bar', () => {
      const score = scoreSponsorship(
        { jdText: 'Build things.', history: history([{ year: 2026, initialApprovals: 4 }]) },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('Medium');
    });

    it('is inclusive at the bar', () => {
      const score = scoreSponsorship(
        { jdText: 'Build things.', history: history([{ year: 2026, initialApprovals: 5 }]) },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('High');
    });

    it('ignores a record that is no longer current', () => {
      const score = scoreSponsorship(
        { jdText: 'Build things.', history: history([{ year: 2018, initialApprovals: 40 }]) },
        { currentYear: 2026 },
      );
      expect(score.tier).not.toBe('High');
    });

    it('is not fooled by a fiscal year that is still being reported', () => {
      // FY2026 shows 2 so far; FY2025 closed at 20. Reading only the newest
      // number would drop a steady mid-size sponsor on a reporting artifact.
      const score = scoreSponsorship(
        {
          jdText: 'Build things.',
          history: history([
            { year: 2026, initialApprovals: 2 },
            { year: 2025, initialApprovals: 20 },
          ]),
        },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('High');
      expect(score.reason).toContain('20 new hires in 2025');
    });

    it('never overrules a JD that refuses sponsorship', () => {
      // History is checked AFTER the disqualifiers on purpose: a posting that
      // says no has told us the answer, whatever the employer files.
      const score = scoreSponsorship(
        {
          jdText: 'We do not offer visa sponsorship for this role.',
          history: history([{ year: 2026, initialApprovals: 3288 }]),
        },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('Excluded');
    });

    it('falls back to the lifetime rules when no per-year data is present', () => {
      const score = scoreSponsorship(
        {
          jdText: 'Build things.',
          history: {
            sponsorCount: 170,
            approvalRate: 0.96,
            lastFiledYear: 2026,
            newEmploymentApprovals: 11,
            newEmploymentLastYear: 2026,
          },
        },
        { currentYear: 2026 },
      );
      expect(score.tier).toBe('Medium');
    });
  });
});
