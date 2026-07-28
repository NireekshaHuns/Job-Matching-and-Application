import { describe, expect, it } from 'vitest';
import { postingFingerprint } from './fingerprint';

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
});
