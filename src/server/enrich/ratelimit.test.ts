import { describe, expect, it } from 'vitest';
import { describeRateLimit, isQuotaExhausted, parseRateLimitHeaders } from './ratelimit';

/** The exact shape observed when the daily cap ran out mid-backfill. */
const EXHAUSTED = {
  'x-ratelimit-limit-requests': '10000',
  'x-ratelimit-remaining-requests': '1',
  'x-ratelimit-reset-requests': '23h59m49.524s',
  'x-ratelimit-limit-tokens': '200000',
  'x-ratelimit-remaining-tokens': '199997',
};

describe('parseRateLimitHeaders', () => {
  it('reads the standard headers from a plain object', () => {
    expect(parseRateLimitHeaders(EXHAUSTED)).toEqual({
      limitRequests: 10000,
      remainingRequests: 1,
      resetRequests: '23h59m49.524s',
      remainingTokens: 199997,
    });
  });

  it('reads them from a Headers instance too', () => {
    const headers = new Headers(EXHAUSTED);
    expect(parseRateLimitHeaders(headers).remainingRequests).toBe(1);
    expect(parseRateLimitHeaders(headers).resetRequests).toBe('23h59m49.524s');
  });

  it('leaves missing values null rather than defaulting to zero', () => {
    // Zero would read as "exhausted" and wrongly block a run.
    const status = parseRateLimitHeaders({});
    expect(status.remainingRequests).toBeNull();
    expect(status.limitRequests).toBeNull();
    expect(status.resetRequests).toBeNull();
  });

  it('treats an unparseable value as unknown', () => {
    expect(
      parseRateLimitHeaders({ 'x-ratelimit-remaining-requests': 'n/a' }).remainingRequests,
    ).toBeNull();
  });
});

describe('isQuotaExhausted', () => {
  it('flags the real-world exhausted case', () => {
    expect(isQuotaExhausted(parseRateLimitHeaders(EXHAUSTED), 100)).toBe(true);
  });

  it('passes when there is ample quota', () => {
    const plenty = parseRateLimitHeaders({ 'x-ratelimit-remaining-requests': '9000' });
    expect(isQuotaExhausted(plenty, 100)).toBe(false);
  });

  it('does NOT block when the provider reports nothing', () => {
    // Some gateways send no rate-limit headers; refusing to run would be worse
    // than trying.
    expect(isQuotaExhausted(parseRateLimitHeaders({}), 100)).toBe(false);
  });
});

describe('describeRateLimit', () => {
  it('summarizes quota and reset window', () => {
    expect(describeRateLimit(parseRateLimitHeaders(EXHAUSTED))).toBe(
      'rate limit: 1/10000 requests remaining, resets in 23h59m49.524s',
    );
  });

  it('says so plainly when the provider is silent', () => {
    expect(describeRateLimit(parseRateLimitHeaders({}))).toContain('not reported');
  });
});
