import { describe, expect, it } from 'vitest';
import { looksLikeStaffing } from './staffing';

describe('looksLikeStaffing', () => {
  it('flags explicit staffing/body-shop engagement phrases', () => {
    const jds = [
      'This is a Corp-to-Corp opportunity for a backend engineer.',
      'Rate is open for C2C candidates.',
      'W2 contract, no 1099.',
      'Our client is seeking a senior Java developer.',
      'We are hiring on behalf of our client, a Fortune 500 bank.',
      'Only third-party vendors need apply.',
      'Reputable staffing firm placing engineers at top companies.',
      'W2 only, no exceptions.',
      'Candidate must be on W2.',
      'This is a contract-to-hire role.',
      'C2H position available immediately.',
      'Our clients are currently seeking a React developer.',
      'Our client, a leading retailer, needs a data engineer.',
      'Must clear an end client interview before starting.',
    ];
    for (const jd of jds) expect(looksLikeStaffing(jd), jd).toBe(true);
  });

  it('does not flag a normal direct-hire JD (even at a big consulting employer)', () => {
    const jds = [
      'Join our platform team building payment systems in Go and Kafka.',
      'Infosys is hiring a full-time software engineer to join our product org.',
      'We value client focus and collaboration across teams.',
      'You will work with our clients to deliver great software.',
      "We deeply understand our clients' needs and ship for them.",
      'You will serve the end client with empathy and care.',
      'Fill out the W2 form during onboarding.',
    ];
    for (const jd of jds) expect(looksLikeStaffing(jd), jd).toBe(false);
  });

  it('returns false for empty or missing text', () => {
    expect(looksLikeStaffing('')).toBe(false);
    expect(looksLikeStaffing(null)).toBe(false);
    expect(looksLikeStaffing(undefined)).toBe(false);
  });
});
