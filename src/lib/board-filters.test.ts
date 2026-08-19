import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_FILTERS_KEY,
  DEFAULT_FILTERS,
  parseStoredFilters,
  serializeFilters,
  type BoardFilters,
} from './board-filters';

/**
 * The store caches its snapshot in module scope (React requires a stable
 * reference), so each store test needs a fresh module rather than a reset hook
 * exported purely for tests.
 */
async function freshStore() {
  vi.resetModules();
  return import('./board-filters');
}

describe('DEFAULT_FILTERS', () => {
  it('applies no pay floor — most postings state no salary at all', () => {
    expect(DEFAULT_FILTERS.minSalary).toBe(0);
  });

  it("caps experience at 3 years, which is the board's whole scope", () => {
    // Unlike the other filters this one defaults ON: the board exists to find
    // roles a recent grad can get, and a posting that states nothing still shows.
    expect(DEFAULT_FILTERS.maxYears).toBe(3);
  });

  it('shows jobs of any age', () => {
    // The whole point of the fix: a non-zero default hides newly ingested jobs
    // whose posted_at is older than the window.
    expect(DEFAULT_FILTERS.within).toBe(0);
  });
});

describe('parseStoredFilters', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(parseStoredFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseStoredFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(parseStoredFilters('')).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips a full filter set', () => {
    const filters: BoardFilters = {
      sort: 'recent',
      within: 3,
      minSalary: 100_000,
      maxYears: 5,
      remoteOnly: true,
      includeSenior: true,
      includeExcluded: false,
      includeClosed: true,
    };
    expect(parseStoredFilters(serializeFilters(filters))).toEqual(filters);
  });

  it('keeps a stored "Past week" choice — the default changed, the choice is still valid', () => {
    expect(parseStoredFilters('{"within":7}').within).toBe(7);
  });

  it('keeps a stored pay floor and rejects one that is not an offered step', () => {
    expect(parseStoredFilters('{"minSalary":150000}').minSalary).toBe(150_000);
    // A hand-edited or stale value must not reach the query as-is.
    expect(parseStoredFilters('{"minSalary":95000}').minSalary).toBe(DEFAULT_FILTERS.minSalary);
    expect(parseStoredFilters('{"minSalary":"100000"}').minSalary).toBe(DEFAULT_FILTERS.minSalary);
  });

  it('keeps a stored experience choice and rejects one off the scale', () => {
    expect(parseStoredFilters('{"maxYears":1}').maxYears).toBe(1);
    expect(parseStoredFilters('{"maxYears":0}').maxYears).toBe(0);
    expect(parseStoredFilters('{"maxYears":4}').maxYears).toBe(DEFAULT_FILTERS.maxYears);
  });

  it('reads a v1 entry written before the pay filter existed', () => {
    // Same key, older shape: the missing field must default, not break parsing.
    expect(parseStoredFilters('{"sort":"recent","within":7,"remoteOnly":true}')).toEqual({
      ...DEFAULT_FILTERS,
      sort: 'recent',
      within: 7,
      remoteOnly: true,
    });
  });

  it('survives corrupt storage rather than breaking the board', () => {
    expect(parseStoredFilters('not json')).toEqual(DEFAULT_FILTERS);
    expect(parseStoredFilters('null')).toEqual(DEFAULT_FILTERS);
    expect(parseStoredFilters('[1,2,3]')).toEqual(DEFAULT_FILTERS);
    expect(parseStoredFilters('"a string"')).toEqual(DEFAULT_FILTERS);
  });

  it('defaults any field it does not recognize, keeping the ones it does', () => {
    const parsed = parseStoredFilters(
      '{"sort":"bogus","within":99,"remoteOnly":"yes","includeClosed":true}',
    );
    expect(parsed.sort).toBe(DEFAULT_FILTERS.sort);
    expect(parsed.within).toBe(DEFAULT_FILTERS.within);
    expect(parsed.remoteOnly).toBe(DEFAULT_FILTERS.remoteOnly);
    // ...but a valid neighbour still comes through.
    expect(parsed.includeClosed).toBe(true);
  });

  it('ignores unknown extra keys', () => {
    expect(parseStoredFilters('{"within":1,"somethingElse":42}')).toEqual({
      ...DEFAULT_FILTERS,
      within: 1,
    });
  });
});

describe('the filter store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('serves defaults on the server and stored filters on the client', async () => {
    window.localStorage.setItem(BOARD_FILTERS_KEY, '{"within":3,"remoteOnly":true}');
    const store = await freshStore();

    expect(store.getServerFiltersSnapshot()).toEqual(DEFAULT_FILTERS);
    expect(store.getFiltersSnapshot()).toMatchObject({ within: 3, remoteOnly: true });
  });

  it('returns a stable reference, or React would re-render forever', async () => {
    const store = await freshStore();
    expect(store.getFiltersSnapshot()).toBe(store.getFiltersSnapshot());
  });

  it('persists a write and exposes it on the next snapshot', async () => {
    const store = await freshStore();
    store.writeFilters({ ...DEFAULT_FILTERS, within: 7 });

    expect(store.getFiltersSnapshot().within).toBe(7);
    // ...and survives a reload, which is the whole point.
    const reloaded = await freshStore();
    expect(reloaded.getFiltersSnapshot().within).toBe(7);
  });

  it('notifies subscribers on write and stops after unsubscribe', async () => {
    const store = await freshStore();
    const seen = vi.fn();
    const unsubscribe = store.subscribeFilters(seen);

    store.writeFilters({ ...DEFAULT_FILTERS, within: 1 });
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.writeFilters({ ...DEFAULT_FILTERS, within: 3 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('re-reads and notifies when another tab writes', async () => {
    const store = await freshStore();
    const seen = vi.fn();
    store.subscribeFilters(seen);
    expect(store.getFiltersSnapshot().within).toBe(DEFAULT_FILTERS.within);

    // Another tab saves a different window; the browser fires `storage` here.
    window.localStorage.setItem(BOARD_FILTERS_KEY, '{"within":7}');
    window.dispatchEvent(new StorageEvent('storage', { key: BOARD_FILTERS_KEY }));

    expect(seen).toHaveBeenCalledTimes(1);
    // Without invalidating the cache this would still report the stale value,
    // and the next local write would spread it back over the other tab's choice.
    expect(store.getFiltersSnapshot().within).toBe(7);
  });

  it('re-reads when storage is cleared wholesale (null key)', async () => {
    const store = await freshStore();
    store.writeFilters({ ...DEFAULT_FILTERS, within: 1 });
    store.subscribeFilters(() => {});

    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(store.getFiltersSnapshot()).toEqual(DEFAULT_FILTERS);
  });

  it('ignores storage events for unrelated keys', async () => {
    const store = await freshStore();
    const seen = vi.fn();
    store.subscribeFilters(seen);

    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-app' }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('stops listening for storage events after unsubscribe', async () => {
    const store = await freshStore();
    const seen = vi.fn();
    store.subscribeFilters(seen)();

    window.dispatchEvent(new StorageEvent('storage', { key: BOARD_FILTERS_KEY }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('keeps working when localStorage refuses the write', async () => {
    const store = await freshStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => store.writeFilters({ ...DEFAULT_FILTERS, within: 1 })).not.toThrow();
    // The session still reflects the choice even though it could not be saved.
    expect(store.getFiltersSnapshot().within).toBe(1);
    vi.restoreAllMocks();
  });
});
