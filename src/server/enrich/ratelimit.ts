/**
 * Read and interpret provider rate-limit headers.
 *
 * WHY: when a key's daily request quota runs out, every call 429s and the SDK
 * retries with exponential backoff. The process then sits at 0% CPU with no
 * open sockets and no output — indistinguishable from a wedged connection. That
 * cost hours of misdiagnosis during a bulk backfill (issue #148): the symptom
 * looks like a hang, so you go looking for a missing timeout instead of asking
 * the API how much quota is left.
 *
 * Pure parsing here; the network probe lives in `clients.ts`.
 */

export interface RateLimitStatus {
  limitRequests: number | null;
  remainingRequests: number | null;
  /** Provider-formatted reset window, e.g. "23h59m49.5s". */
  resetRequests: string | null;
  remainingTokens: number | null;
}

type HeaderSource = Headers | Record<string, string | null | undefined>;

function get(headers: HeaderSource, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  return (headers as Record<string, string | null | undefined>)[name] ?? null;
}

function toInt(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/** Standard `x-ratelimit-*` headers. Missing values stay null, never 0. */
export function parseRateLimitHeaders(headers: HeaderSource): RateLimitStatus {
  return {
    limitRequests: toInt(get(headers, 'x-ratelimit-limit-requests')),
    remainingRequests: toInt(get(headers, 'x-ratelimit-remaining-requests')),
    resetRequests: get(headers, 'x-ratelimit-reset-requests'),
    remainingTokens: toInt(get(headers, 'x-ratelimit-remaining-tokens')),
  };
}

/**
 * Is there too little request quota left to be worth starting a bulk run?
 * `null` (provider sends no headers, e.g. some gateways) is NOT treated as
 * exhausted — refusing to run because a provider is quiet would be worse than
 * letting it try.
 */
export function isQuotaExhausted(status: RateLimitStatus, needed: number): boolean {
  return status.remainingRequests != null && status.remainingRequests < needed;
}

/** One-line summary for the operator; "unknown" when the provider is silent. */
export function describeRateLimit(status: RateLimitStatus): string {
  if (status.remainingRequests == null) return 'rate limit: not reported by this provider';
  const limit = status.limitRequests != null ? `/${status.limitRequests}` : '';
  const reset = status.resetRequests ? `, resets in ${status.resetRequests}` : '';
  return `rate limit: ${status.remainingRequests}${limit} requests remaining${reset}`;
}
