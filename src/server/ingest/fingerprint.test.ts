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

  it('collapses the same remote role across differing location wording', () => {
    const simplify = postingFingerprint('Ramp', 'Software Engineer', 'Remote - US');
    const ashby = postingFingerprint('Ramp', 'Software Engineer', 'United States');
    const greenhouse = postingFingerprint('Ramp', 'Software Engineer', 'Remote');
    expect(simplify).toBe(ashby);
    expect(ashby).toBe(greenhouse);
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
});

describe('normalizeTitle', () => {
  it('strips asides/ids/years but keeps role + seniority words', () => {
    expect(normalizeTitle('Senior Backend Engineer (Remote) - REQ 998')).toBe(
      'senior backend engineer',
    );
    expect(normalizeTitle('Data Scientist #4567')).toBe('data scientist');
  });

  it('does not merge distinct disciplines', () => {
    expect(normalizeTitle('Backend Engineer')).not.toBe(normalizeTitle('Frontend Engineer'));
  });
});

describe('normalizeLocation', () => {
  it('canonicalizes remote/nationwide variants to "remote"', () => {
    for (const loc of ['Remote', 'Remote - US', 'United States', 'Anywhere', 'US', 'WFH']) {
      expect(normalizeLocation(loc)).toBe('remote');
    }
  });

  it('keeps real cities and empty input intact', () => {
    expect(normalizeLocation('Austin, TX')).toBe('austin tx');
    expect(normalizeLocation('Columbus, OH')).toBe('columbus oh'); // "us" inside a word must not match
    expect(normalizeLocation(null)).toBe('');
  });
});
