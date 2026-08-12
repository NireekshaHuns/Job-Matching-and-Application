/**
 * Per-request timeout for Neon's HTTP driver.
 *
 * WHY: `@neondatabase/serverless` issues plain `fetch` calls with **no timeout**.
 * A connection that opens and then goes silent hangs forever — the caller sits
 * in `kevent` at 0% CPU with no error and no recovery. That wedged a bulk
 * enrichment backfill twice, both times around an insert flush, with the
 * process alive but making no progress for over ten minutes.
 *
 * Node's fetch has no default timeout either, so this has to be supplied.
 * `neonConfig.fetchFunction` is global to the process, so installing it once
 * covers every client built afterwards.
 */
import { neonConfig } from '@neondatabase/serverless';

/** Generous next to a typical query (milliseconds), strict next to "forever". */
export const DEFAULT_DB_TIMEOUT_MS = 30_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wrap a fetch so every call aborts after `ms`. An `init.signal` from the
 * caller is preserved — the request aborts on whichever fires first, so this
 * can never mask a cancellation the caller asked for.
 */
export function withRequestTimeout(fetchImpl: FetchLike, ms: number): FetchLike {
  return (input, init = {}) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, signal });
  };
}

let installed = false;

/**
 * Install the timeout on Neon's HTTP driver. Idempotent — safe to call from
 * every entry point (scripts, Inngest steps) without tracking who got there
 * first.
 */
export function installDbTimeout(ms: number = DEFAULT_DB_TIMEOUT_MS): void {
  if (installed) return;
  installed = true;
  neonConfig.fetchFunction = withRequestTimeout(
    (input, init) => globalThis.fetch(input as RequestInfo, init),
    ms,
  );
}
