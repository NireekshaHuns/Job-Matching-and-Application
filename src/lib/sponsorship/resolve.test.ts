import { describe, expect, it } from 'vitest';
import { normalizeCompanyName } from './normalize';
import { buildSponsorIndex, FUZZY_THRESHOLD, resolveEmployer, similarity } from './resolve';

/** Build an index from raw sponsor names (normalized the way ingestion does). */
function index(...rawNames: string[]) {
  return buildSponsorIndex(rawNames.map((n) => normalizeCompanyName(n)));
}

describe('similarity', () => {
  it('is 1 for identical keys', () => {
    expect(similarity('STRIPE', 'STRIPE')).toBe(1);
  });

  it('rewards a subset name (Stripe ⊂ Stripe Payments)', () => {
    expect(similarity('STRIPE', 'STRIPE PAYMENTS')).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it('catches a single-token typo via character ratio', () => {
    expect(similarity('DATABRICS', 'DATABRICKS')).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it('does not over-credit one shared token among many', () => {
    // "Apple" should NOT confidently resolve to "Apple Bank For Savings".
    expect(similarity('APPLE', 'APPLE BANK FOR SAVINGS')).toBeLessThan(FUZZY_THRESHOLD);
  });
});

describe('resolveEmployer', () => {
  it('returns an exact match at confidence 1', () => {
    const r = resolveEmployer('Google, Inc.', index('GOOGLE LLC'));
    expect(r).toEqual({ key: 'GOOGLE', confidence: 1, method: 'exact' });
  });

  it('resolves a suffix/subset variant as a fuzzy match below 1', () => {
    const r = resolveEmployer('Stripe', index('Stripe Payments Company'));
    expect(r.method).toBe('fuzzy');
    expect(r.key).toBe('STRIPE PAYMENTS');
    expect(r.confidence).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(r.confidence).toBeLessThan(1);
  });

  it('resolves a typo to the closest sponsor', () => {
    const r = resolveEmployer('Databrics', index('Databricks', 'Snowflake'));
    expect(r.key).toBe('DATABRICKS');
    expect(r.method).toBe('fuzzy');
  });

  it('returns null when nothing clears the threshold', () => {
    const r = resolveEmployer('Totally Unrelated Co', index('Stripe', 'Databricks'));
    expect(r.key).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('returns null for an empty/blank name', () => {
    expect(resolveEmployer('', index('Stripe')).key).toBeNull();
    expect(resolveEmployer(null, index('Stripe')).key).toBeNull();
  });

  it('prefers the exact hit even when fuzzy candidates exist', () => {
    const r = resolveEmployer('Stripe', index('Stripe', 'Stripe Payments Company'));
    expect(r).toEqual({ key: 'STRIPE', confidence: 1, method: 'exact' });
  });
});

describe('buildSponsorIndex', () => {
  it('reports its size and answers exact membership', () => {
    const idx = index('Google LLC', 'Stripe, Inc.');
    expect(idx.size).toBe(2);
    expect(idx.has('GOOGLE')).toBe(true);
    expect(idx.has('MISSING')).toBe(false);
  });

  it('surfaces candidates sharing a token or prefix but not unrelated keys', () => {
    const idx = index('Stripe Payments Company', 'Snowflake Computing');
    const cands = idx.candidates(['STRIPE']);
    expect(cands).toContain('STRIPE PAYMENTS');
    expect(cands).not.toContain('SNOWFLAKE COMPUTING');
  });
});
