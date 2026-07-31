import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import { staleCutoff } from './cache';
import { purgeStalePeopleCache } from './purge';

describe('purgeStalePeopleCache', () => {
  it('deletes rows past the TTL and returns the count', async () => {
    const returning = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    const where = vi.fn(() => ({ returning }));
    const del = vi.fn(() => ({ where }));
    const db = { delete: del } as unknown as DB;

    const now = new Date('2026-07-15T00:00:00Z');
    const purged = await purgeStalePeopleCache(db, now);

    expect(purged).toBe(2);
    expect(del).toHaveBeenCalledOnce();
    // Filters on the stale cutoff (fetched_at < now - TTL).
    expect(where).toHaveBeenCalledOnce();
  });

  it('reports 0 when nothing is stale', async () => {
    const returning = vi.fn(async () => []);
    const db = {
      delete: () => ({ where: () => ({ returning }) }),
    } as unknown as DB;
    expect(await purgeStalePeopleCache(db, new Date())).toBe(0);
  });
});

describe('staleCutoff', () => {
  it('subtracts the TTL window from now', () => {
    const now = new Date('2026-07-15T00:00:00Z');
    // Default TTL is 7 days.
    expect(staleCutoff(now).toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(staleCutoff(now, 1).toISOString()).toBe('2026-07-14T00:00:00.000Z');
  });
});
