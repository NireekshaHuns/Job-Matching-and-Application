import { describe, expect, it } from 'vitest';
import type { SponsorHistory } from '@/lib/sponsorship';
import { buildSponsorResolver } from './resolver';

function history(partial: Partial<SponsorHistory> = {}): SponsorHistory {
  return {
    sponsorCount: 100,
    approvalRate: 0.9,
    lastFiledYear: 2025,
    newEmploymentApprovals: 40,
    newEmploymentLastYear: 2025,
    ...partial,
  };
}

const historyByKey = new Map<string, SponsorHistory>([
  ['STRIPE PAYMENTS', history()],
  ['DATABRICKS', history({ sponsorCount: 5 })],
]);

describe('buildSponsorResolver', () => {
  it('resolves a fuzzy match and records it for persistence', () => {
    const { resolve, discovered } = buildSponsorResolver({
      historyByKey,
      confirmedAliases: new Map(),
    });
    const r = resolve('Stripe');
    expect(r.key).toBe('STRIPE PAYMENTS');
    expect(r.method).toBe('fuzzy');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.history).toEqual(history());

    const alias = discovered.get('STRIPE');
    expect(alias?.sponsorKey).toBe('STRIPE PAYMENTS');
    expect(alias?.rawName).toBe('Stripe');
  });

  it('lets a confirmed alias override resolution and does not record it', () => {
    const { resolve, discovered } = buildSponsorResolver({
      historyByKey,
      // The user says "Stripe" (a posting) actually maps to Databricks' record.
      confirmedAliases: new Map([['STRIPE', 'DATABRICKS']]),
    });
    const r = resolve('Stripe');
    expect(r.key).toBe('DATABRICKS');
    expect(r.method).toBe('manual');
    expect(r.confidence).toBe(1);
    expect(r.history?.sponsorCount).toBe(5);
    expect(discovered.has('STRIPE')).toBe(false);
  });

  it('honors a confirmed "no match" (null) without falling back to fuzzy', () => {
    const { resolve } = buildSponsorResolver({
      historyByKey,
      confirmedAliases: new Map([['STRIPE', null]]),
    });
    const r = resolve('Stripe');
    expect(r.key).toBeNull();
    expect(r.history).toBeNull();
    expect(r.method).toBe('manual');
  });

  it('returns an unresolved result for a blank name', () => {
    const { resolve } = buildSponsorResolver({ historyByKey, confirmedAliases: new Map() });
    const r = resolve('   ');
    expect(r.key).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('does not record a discovery when nothing clears the threshold', () => {
    const { resolve, discovered } = buildSponsorResolver({
      historyByKey,
      confirmedAliases: new Map(),
    });
    const r = resolve('Totally Unrelated Holdings');
    expect(r.key).toBeNull();
    expect(discovered.size).toBe(0);
  });
});
