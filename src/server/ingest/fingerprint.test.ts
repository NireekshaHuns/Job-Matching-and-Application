import { describe, expect, it } from 'vitest';
import { normalizeLocation, normalizeTitle, postingFingerprint } from './fingerprint';

describe('postingFingerprint', () => {
  it('collapses the same job from different sources / spellings', () => {
    const a = postingFingerprint('Google, Inc.', 'Software Engineer', 'New York, NY');
    const b = postingFingerprint('GOOGLE LLC', 'software engineer', 'new york ny');
    expect(a).toBe(b);
  });

  it('distinguishes different titles at the same company', () => {
    expect(postingFingerprint('Stripe', 'Backend Engineer', 'Remote')).not.toBe(
      postingFingerprint('Stripe', 'Frontend Engineer', 'Remote'),
    );
  });

  it('handles a null location', () => {
    expect(postingFingerprint('Stripe', 'SWE', null)).toBe('STRIPE|swe|');
  });

  it('collapses the same remote role across differing remote wording', () => {
    const a = postingFingerprint('Ramp', 'Software Engineer', 'Remote - US');
    const b = postingFingerprint('Ramp', 'Software Engineer', 'Remote');
    const c = postingFingerprint('Ramp', 'Software Engineer', 'Telecommute');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('collapses title noise (req ids, years, parentheticals) for the same role', () => {
    const noisy = postingFingerprint('Stripe', 'Software Engineer, New Grad 2026 (R12345)', 'SF');
    const clean = postingFingerprint('Stripe', 'Software Engineer, New Grad', 'SF');
    expect(noisy).toBe(clean);
  });

  it('keeps genuinely different cities separate', () => {
    expect(postingFingerprint('Stripe', 'Software Engineer', 'New York, NY')).not.toBe(
      postingFingerprint('Stripe', 'Software Engineer', 'San Francisco, CA'),
    );
  });

  it('does NOT collapse an on-site metro with a country tag into remote', () => {
    // "New York, US" is on-site NYC — must stay distinct from a remote posting.
    expect(postingFingerprint('Stripe', 'Software Engineer', 'New York, US')).not.toBe(
      postingFingerprint('Stripe', 'Software Engineer', 'Remote'),
    );
  });

  it('keeps a parenthesized level distinct from the plain title', () => {
    expect(postingFingerprint('Stripe', 'Software Engineer (Senior)', 'Remote')).not.toBe(
      postingFingerprint('Stripe', 'Software Engineer', 'Remote'),
    );
  });
});

describe('normalizeTitle', () => {
  it('strips noise asides/ids/years but keeps role + seniority words', () => {
    expect(normalizeTitle('Senior Backend Engineer (Remote) - REQ 998')).toBe(
      'senior backend engineer',
    );
    expect(normalizeTitle('Data Scientist #4567')).toBe('data scientist');
  });

  it('keeps a level in parentheses (only noise parentheticals are stripped)', () => {
    expect(normalizeTitle('Software Engineer (Senior)')).toBe('software engineer senior');
    expect(normalizeTitle('Software Engineer (Remote)')).toBe('software engineer');
  });

  it('does not merge distinct disciplines', () => {
    expect(normalizeTitle('Backend Engineer')).not.toBe(normalizeTitle('Frontend Engineer'));
  });
});

describe('normalizeLocation', () => {
  it('canonicalizes explicit remote variants to "remote"', () => {
    for (const loc of ['Remote', 'Remote - US', 'Anywhere', 'WFH', 'Telecommute', 'Virtual']) {
      expect(normalizeLocation(loc)).toBe('remote');
    }
  });

  it('does NOT treat a bare country tag as remote (avoids over-merging cities)', () => {
    expect(normalizeLocation('New York, US')).toBe('new york us');
    expect(normalizeLocation('Boston, MA, US')).toBe('boston ma us');
    expect(normalizeLocation('United States')).toBe('united states');
  });

  it('keeps real cities and empty input intact', () => {
    expect(normalizeLocation('Austin, TX')).toBe('austin tx');
    expect(normalizeLocation('Columbus, OH')).toBe('columbus oh'); // "us" inside a word must not match
    expect(normalizeLocation(null)).toBe('');
  });
});
