import { describe, expect, it } from 'vitest';
import { reconcileSinceIso } from './reconcile-run';

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
