import { describe, expect, it } from 'vitest';
import { fillCounts } from './dashboard';

describe('fillCounts', () => {
  const order = ['High', 'Medium', 'Low', 'Excluded'] as const;

  it('fills missing keys with zero and preserves the given order', () => {
    expect(
      fillCounts(order, [
        { key: 'Medium', count: 3 },
        { key: 'High', count: 5 },
      ]),
    ).toEqual([
      { key: 'High', count: 5 },
      { key: 'Medium', count: 3 },
      { key: 'Low', count: 0 },
      { key: 'Excluded', count: 0 },
    ]);
  });

  it('returns all zeros for an empty result set', () => {
    expect(fillCounts(order, [])).toEqual([
      { key: 'High', count: 0 },
      { key: 'Medium', count: 0 },
      { key: 'Low', count: 0 },
      { key: 'Excluded', count: 0 },
    ]);
  });

  it('drops keys not present in the order', () => {
    const result = fillCounts(order, [
      { key: 'High', count: 2 },
      { key: 'Bogus' as (typeof order)[number], count: 9 },
    ]);
    expect(result).toHaveLength(order.length);
    expect(result.find((r) => r.key === ('Bogus' as string))).toBeUndefined();
  });
});
