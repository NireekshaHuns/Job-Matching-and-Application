import { describe, expect, it } from 'vitest';
import { groupByColumn } from './kanban';

const app = (id: number, status: string) => ({ id, status });

describe('groupByColumn', () => {
  it('places each app in exactly one column and preserves the total', () => {
    const apps = [app(1, 'applied'), app(2, 'applied'), app(3, 'interviewing'), app(4, 'offer')];
    const cols = groupByColumn(apps);
    expect(cols.map((c) => c.key)).toEqual(['applied', 'interviewing', 'offer', 'rejected']);
    expect(cols.reduce((n, c) => n + c.apps.length, 0)).toBe(apps.length);
    expect(cols[0].apps.map((a) => a.id)).toEqual([1, 2]);
  });

  it('routes saved/withdrawn to a trailing Other column', () => {
    const cols = groupByColumn([app(1, 'saved'), app(2, 'withdrawn'), app(3, 'rejected')]);
    const other = cols.find((c) => c.key === 'other');
    expect(other?.apps.map((a) => a.id)).toEqual([1, 2]);
    expect(cols.at(-1)?.key).toBe('other');
  });

  it('omits the Other column when there are no leftover statuses', () => {
    const cols = groupByColumn([app(1, 'applied'), app(2, 'offer')]);
    expect(cols.some((c) => c.key === 'other')).toBe(false);
    expect(cols).toHaveLength(4);
  });
});
