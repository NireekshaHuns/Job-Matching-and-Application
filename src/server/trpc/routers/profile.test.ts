import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import { createCaller } from '@/server/trpc/root';
import type { Context } from '@/server/trpc/context';
import { setProfileInput } from './profile';

describe('setProfileInput', () => {
  it('accepts valid YYYY-MM-DD dates or null', () => {
    expect(setProfileInput.parse({ optEndDate: '2027-05-01', stemOptEndDate: null })).toEqual({
      optEndDate: '2027-05-01',
      stemOptEndDate: null,
    });
  });

  it('rejects malformed shape, invalid calendar dates, and missing keys', () => {
    expect(() =>
      setProfileInput.parse({ optEndDate: '05/01/2027', stemOptEndDate: null }),
    ).toThrow();
    // Shape-valid but not a real date.
    expect(() =>
      setProfileInput.parse({ optEndDate: '2027-02-30', stemOptEndDate: null }),
    ).toThrow();
    expect(() => setProfileInput.parse({ optEndDate: '2027-05-01' })).toThrow();
  });
});

describe('profile.set', () => {
  it('upserts the single row and returns recomputed nudges', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const caller = createCaller({ db: { insert } as unknown as DB } as Context);

    const res = await caller.profile.set({ optEndDate: '2026-08-01', stemOptEndDate: null });

    // Fixed-id upsert (no dup rows) carrying the input dates.
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, optEndDate: '2026-08-01', stemOptEndDate: null }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
    // Echoes the saved dates and returns computed nudges (clock-independent shape check).
    expect(res.optEndDate).toBe('2026-08-01');
    expect(Array.isArray(res.nudges)).toBe(true);
  });
});
