import { describe, expect, it } from 'vitest';
import { normalizeCompanyName } from './normalize';
import {
  buildSponsorIndex,
  FUZZY_THRESHOLD,
  resolveEmployer,
  similarity,
  spacingSimilarity,
} from './resolve';

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

  it('documents the one-of-two-token ambiguity (surfaced, not silently dropped)', () => {
    // A single token contained in a two-token name is a match either way — we
    // cannot distinguish the real "Stripe"/"Stripe Payments" from the unrelated
    // "Delta"/"Delta Dental" by name alone, so both clear the threshold and rely
    // on the visible confidence + correction UI (spec §5.3). Pin the behavior.
    expect(similarity('STRIPE', 'STRIPE PAYMENTS')).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(similarity('DELTA', 'DELTA DENTAL')).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    // Both are moderate confidence, never a near-certain (1.0) assertion.
    expect(similarity('DELTA', 'DELTA DENTAL')).toBeLessThan(1);
  });
});

describe('spacingSimilarity', () => {
  it('matches a brand name against the hyphenated USCIS legal entity', () => {
    // The real case: postings say "Walmart", USCIS files "Wal-Mart Associates,
    // Inc." Sharing no token and only 0.37 character similarity, this scored
    // Low ("no sponsorship history") against 1,669 real sponsorships.
    expect(spacingSimilarity('WALMART', 'WAL MART ASSOCIATES')).toBeGreaterThanOrEqual(
      FUZZY_THRESHOLD,
    );
  });

  it('treats a pure spacing variant as a full match', () => {
    expect(spacingSimilarity('WAL MART', 'WALMART')).toBe(1);
  });

  it('requires token-boundary alignment, so APPLE does not match APPLEBEES', () => {
    // A plain `startsWith` would assert this one. A false High tier — telling
    // the user a company sponsors when it does not — is worse than a false Low.
    expect(spacingSimilarity('APPLE', 'APPLEBEES')).toBe(0);
    expect(spacingSimilarity('MICRO', 'MICROSOFT')).toBe(0);
  });

  it('stays out of plain token containment, which the token measure owns', () => {
    // "APPLE" is exactly the first token of "APPLE BANK FOR SAVINGS" — no
    // spacing difference at all. Firing here would override the token measure's
    // deliberate low score and resolve Apple to a savings bank.
    expect(spacingSimilarity('APPLE', 'APPLE BANK FOR SAVINGS')).toBe(0);
    expect(spacingSimilarity('DELTA', 'DELTA DENTAL')).toBe(0);
    // Two-token spans are the real signal.
    expect(spacingSimilarity('DELTADENTAL', 'DELTA DENTAL')).toBe(1);
  });

  it('is 0 for unrelated names', () => {
    expect(spacingSimilarity('GOOGLE', 'MICROSOFT')).toBe(0);
    expect(spacingSimilarity('', 'GOOGLE')).toBe(0);
  });

  it('pins the known false positive this rule accepts', () => {
    // Measured against the live sponsor table: "PaperCut" (print software) hits
    // "PAPER CUT CLOTHING". Structurally identical to the Walmart case — a
    // two-token span plus a trailing token — so no name-only signal separates
    // them. Documented and accepted, not overlooked: the alternative is Walmart's
    // 1,669 filings reading as "no sponsorship history".
    expect(spacingSimilarity('PAPERCUT', 'PAPER CUT CLOTHING')).toBeGreaterThanOrEqual(
      FUZZY_THRESHOLD,
    );
  });
});

describe('resolveEmployer', () => {
  it('resolves a spacing variant that previously produced no candidates at all', () => {
    // Two independent failures before the fix: candidate generation returned []
    // (no shared token; "WAL" is under the 4-char prefix index), and the score
    // was 0.368 against a 0.6 threshold.
    const idx = index('Wal-Mart Associates, Inc.');
    expect(idx.candidates(['WALMART'])).toContain('WAL MART ASSOCIATES');

    const r = resolveEmployer('Walmart', idx);
    expect(r.key).toBe('WAL MART ASSOCIATES');
    expect(r.confidence).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    // Fuzzy, never impersonating an exact hit.
    expect(r.method).toBe('fuzzy');
    expect(r.confidence).toBeLessThan(1);
  });

  it('resolves the reverse direction too (legal name on the posting)', () => {
    const r = resolveEmployer('Wal-Mart Associates, Inc.', index('Walmart'));
    expect(r.key).toBe('WALMART');
    expect(r.confidence).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it('still refuses an unrelated name that merely shares a character prefix', () => {
    expect(resolveEmployer('Apple', index('Applebees')).key).toBeNull();
  });

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
