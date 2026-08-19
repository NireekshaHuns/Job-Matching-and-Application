/**
 * Board filter state — the shape, the defaults, and the (de)serialization used
 * to persist it across reloads. Pure and unit-tested; the page owns the React
 * wiring.
 *
 * WHY THIS IS PERSISTED. The board used to hold filters in plain `useState`, so
 * every reload snapped back to "Past week". That default was also why "Find new
 * jobs" looked broken: the age filter reads `coalesce(posted_at, first_seen_at)`,
 * so a posting we *discovered* today but that was *published* three weeks ago was
 * hidden the moment it arrived. Measured on the live DB at the time, the old
 * default showed 2,248 of 11,455 active jobs and hid 4 of the 5 jobs the last
 * refresh found — which is why the default became "Any time".
 *
 * Ingestion now refuses anything published more than a week ago, so that tail no
 * longer exists and the default is a real window again (see `DEFAULT_FILTERS`).
 * Whatever the owner picks is still remembered.
 */

export type Sort = 'combined' | 'fit' | 'recent';
/** Posted-age window in days; 0 means "any age". */
export type Within = 1 | 3 | 7 | 0;
/** Minimum annualized USD pay; 0 means "any pay". */
export type MinSalary = 0 | 80_000 | 100_000 | 120_000 | 150_000;
/** Most years of experience a posting may ask for; 0 means "any". */
export type MaxYears = 0 | 1 | 2 | 3 | 5;

export interface BoardFilters {
  sort: Sort;
  within: Within;
  minSalary: MinSalary;
  maxYears: MaxYears;
  remoteOnly: boolean;
  includeSenior: boolean;
  includeExcluded: boolean;
  includeClosed: boolean;
}

const SORTS: Sort[] = ['combined', 'fit', 'recent'];
const WITHINS: Within[] = [1, 3, 7, 0];
const MIN_SALARIES: MinSalary[] = [0, 80_000, 100_000, 120_000, 150_000];
const MAX_YEARS: MaxYears[] = [0, 1, 2, 3, 5];

/**
 * `within: 3` is narrower than what ingestion admits (a week), on purpose.
 *
 * The wider ingest window is resilience — it lets a scheduled run miss a day
 * without permanently losing that day's postings — while the display window is
 * preference. The gap means a posting published five days ago and discovered
 * today is stored but not shown by default; it is one click away under
 * "Past week". Widen this to 7 if that trade stops being worth it.
 *
 * This used to be 0 ("Any time"), because the table held a long tail of postings
 * whose `posted_at` was months old — a non-zero default hid most of what a
 * refresh found. That is no longer the shape of the data: ingestion skips
 * anything older than a week before it ever reaches the DB, so a 3-day window is
 * a view onto fresh postings rather than a filter that hides the board. Undated
 * postings fall back to when we first saw them, so they still appear.
 */
export const DEFAULT_FILTERS: BoardFilters = {
  sort: 'combined',
  within: 3,
  // "Any pay" by default: most postings state no salary at all, so a non-zero
  // default would quietly narrow the board to the minority that do.
  minSalary: 0,
  // The board is scoped to roles a recent grad can get, and this is the filter
  // that actually enforces it — `seniority` reads the title, which cannot tell a
  // "Software Engineer" wanting eight years from one wanting none.
  maxYears: 3,
  remoteOnly: false,
  includeSenior: false,
  includeExcluded: false,
  includeClosed: false,
};

/** Versioned so a future shape change can't be misread as valid stored state. */
export const BOARD_FILTERS_KEY = 'h1b-board:filters:v1';

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Read persisted filters, falling back to a default per field. Deliberately
 * total: anything unparseable or unrecognized yields defaults rather than
 * throwing, because a corrupt localStorage entry must never break the board.
 */
export function parseStoredFilters(raw: string | null | undefined): BoardFilters {
  if (!raw) return DEFAULT_FILTERS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FILTERS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTERS;

  const v = parsed as Partial<Record<keyof BoardFilters, unknown>>;
  return {
    sort: SORTS.includes(v.sort as Sort) ? (v.sort as Sort) : DEFAULT_FILTERS.sort,
    within: WITHINS.includes(v.within as Within) ? (v.within as Within) : DEFAULT_FILTERS.within,
    // Absent from a v1 entry written before this filter existed — falls back to
    // the default like any unrecognized value, so no key bump is needed.
    minSalary: MIN_SALARIES.includes(v.minSalary as MinSalary)
      ? (v.minSalary as MinSalary)
      : DEFAULT_FILTERS.minSalary,
    maxYears: MAX_YEARS.includes(v.maxYears as MaxYears)
      ? (v.maxYears as MaxYears)
      : DEFAULT_FILTERS.maxYears,
    remoteOnly: bool(v.remoteOnly, DEFAULT_FILTERS.remoteOnly),
    includeSenior: bool(v.includeSenior, DEFAULT_FILTERS.includeSenior),
    includeExcluded: bool(v.includeExcluded, DEFAULT_FILTERS.includeExcluded),
    includeClosed: bool(v.includeClosed, DEFAULT_FILTERS.includeClosed),
  };
}

export function serializeFilters(filters: BoardFilters): string {
  return JSON.stringify(filters);
}

/* -------------------------------------------------------------------------
 * A tiny store over localStorage, shaped for `useSyncExternalStore`.
 *
 * localStorage is an external mutable source that does not exist during SSR,
 * which is exactly what `useSyncExternalStore` is for: the server snapshot is
 * the defaults, the client snapshot is what was persisted, and React reconciles
 * the two without a hydration mismatch or a setState-in-effect.
 * ---------------------------------------------------------------------- */

/** Cached so `getSnapshot` is referentially stable — React loops otherwise. */
let snapshot: BoardFilters | null = null;
const listeners = new Set<() => void>();

/**
 * Client-only. Guarded anyway: this module is still evaluated in the SSR pass
 * (it is imported by a client component), so its module state lives in the
 * server process. React only ever calls `getServerFiltersSnapshot` there, and
 * this guard makes sure a stray server-side call returns defaults rather than
 * throwing — or worse, seeding a cache shared across every request.
 */
export function getFiltersSnapshot(): BoardFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  snapshot ??= parseStoredFilters(window.localStorage.getItem(BOARD_FILTERS_KEY));
  return snapshot;
}

/** SSR and the hydrating render both see the defaults. */
export function getServerFiltersSnapshot(): BoardFilters {
  return DEFAULT_FILTERS;
}

/**
 * Subscribe to filter changes — both our own writes and another tab's.
 *
 * The `storage` event is what keeps two open tabs from clobbering each other:
 * without it, tab B keeps serving its stale cached snapshot, and its next write
 * spreads that stale object back over whatever tab A just saved.
 */
export function subscribeFilters(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== BOARD_FILTERS_KEY) return;
    // Null key means storage was cleared wholesale; either way, re-read.
    snapshot = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Persist and publish. Writing is best-effort: a full or blocked quota (private
 * browsing) must not take the board down with it. */
export function writeFilters(next: BoardFilters): void {
  snapshot = next;
  try {
    window.localStorage.setItem(BOARD_FILTERS_KEY, serializeFilters(next));
  } catch {
    // Ignore — the in-memory snapshot still drives this session.
  }
  for (const listener of listeners) listener();
}
