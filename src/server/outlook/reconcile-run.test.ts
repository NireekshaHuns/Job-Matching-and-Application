import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import { reconcileSinceIso, runOutlookReconcile, writeConfirmations } from './reconcile-run';
import type { ConfirmationUpdate } from './confirm';
import type { MailClient } from './types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-07-27T00:00:00Z');

describe('reconcileSinceIso', () => {
  it('starts at the earliest pending application', () => {
    const since = reconcileSinceIso([NOW - 5 * DAY, NOW - 2 * DAY], NOW, 60);
    expect(since).toBe(new Date(NOW - 5 * DAY).toISOString());
  });

  it('floors the window at maxLookbackDays for old applications', () => {
    const since = reconcileSinceIso([NOW - 200 * DAY], NOW, 60);
    expect(since).toBe(new Date(NOW - 60 * DAY).toISOString());
  });

  it('uses just the lookback window when there are no pending apps', () => {
    expect(reconcileSinceIso([], NOW, 30)).toBe(new Date(NOW - 30 * DAY).toISOString());
  });

  it('never looks into the future if an appliedAt is somehow ahead of now', () => {
    expect(reconcileSinceIso([NOW + 10 * DAY], NOW, 60)).toBe(new Date(NOW).toISOString());
  });
});

describe('writeConfirmations', () => {
  /** Minimal fake DB recording the update/batch calls the writer makes. */
  function fakeDb() {
    const batch = vi.fn<(queries: unknown[]) => Promise<unknown[]>>(async () => []);
    const update = vi.fn(() => ({ set: () => ({ where: () => ({ stmt: true }) }) }));
    return { db: { update, batch } as unknown as DB, update, batch };
  }

  const update: ConfirmationUpdate = {
    applicationId: 1,
    confirmedAt: '2026-07-20T10:00:00Z',
    confirmationEmailId: 'e1',
  };

  it('no-ops (no db.batch) when there are no updates', async () => {
    const { db, update: upd, batch } = fakeDb();
    expect(await writeConfirmations(db, [])).toBe(0);
    expect(upd).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it('issues one conditional update per confirmation in a single batch', async () => {
    const { db, update: upd, batch } = fakeDb();
    const n = await writeConfirmations(db, [
      update,
      { ...update, applicationId: 2, confirmationEmailId: 'e2' },
    ]);
    expect(n).toBe(2);
    expect(upd).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0].length).toBe(2);
  });
});

describe('runOutlookReconcile', () => {
  /** Fake DB with no pending applications, so nothing is matched or written. */
  function emptyDb(): DB {
    const orderBy = async () => [];
    const where = () => ({ orderBy });
    const innerJoin = () => ({ where });
    const from = () => ({ innerJoin });
    return { select: () => ({ from }) } as unknown as DB;
  }

  const mailReturning = (truncated: boolean): MailClient => ({
    listMessages: async () => ({ messages: [], truncated }),
  });

  it('propagates the mail-client truncation flag into the stats (issue #43)', async () => {
    const stats = await runOutlookReconcile({ db: emptyDb(), mail: mailReturning(true) });
    expect(stats).toEqual({ pending: 0, messages: 0, confirmed: 0, truncated: true });
  });

  it('reports truncated: false on a complete read', async () => {
    const stats = await runOutlookReconcile({ db: emptyDb(), mail: mailReturning(false) });
    expect(stats.truncated).toBe(false);
  });
});
