import { describe, expect, it } from 'vitest';
import { scoreSponsorship, type SponsorHistory } from './score';

const NOW = 2026;
const heavyRecent: SponsorHistory = {
  sponsorCount: 120,
  approvalRate: 0.95,
  lastFiledYear: 2025,
};
const someOld: SponsorHistory = {
  sponsorCount: 8,
  approvalRate: 0.8,
  lastFiledYear: 2019,
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
    ])('excludes: %j', (jd) => {
      // Excluded wins even if the employer has heavy history.
      expect(tier(jd, heavyRecent)).toBe('Excluded');
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

    it('heavy recent history with a silent JD -> High', () => {
      expect(tier('Build backend services in Go.', heavyRecent)).toBe('High');
    });
  });

  describe('Medium — prior history, silent JD', () => {
    it('some history, silent JD -> Medium', () => {
      expect(tier('Frontend engineer, React.', someOld)).toBe('Medium');
    });

    it('heavy count but stale (outside recency window) -> Medium', () => {
      expect(
        tier('Backend role.', {
          sponsorCount: 200,
          approvalRate: 0.9,
          lastFiledYear: 2015,
        }),
      ).toBe('Medium');
    });
  });

  describe('Low — silent JD, little/no history', () => {
    it('no history match -> Low', () => {
      expect(tier('Great startup, ping pong tables.', null)).toBe('Low');
    });

    it('zero count history -> Low', () => {
      expect(
        tier('Great role.', {
          sponsorCount: 0,
          approvalRate: null,
          lastFiledYear: null,
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

  it('always returns a reason string', () => {
    const result = scoreSponsorship({ jdText: 'Anything.', history: null }, { currentYear: NOW });
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
