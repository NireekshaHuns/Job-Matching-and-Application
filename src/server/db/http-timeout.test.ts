import { describe, expect, it } from 'vitest';
import { withRequestTimeout } from './http-timeout';

/** A fetch that never resolves until its signal aborts — the hang we hit. */
const hangingFetch = (_input: RequestInfo | URL, init: RequestInit = {}) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('withRequestTimeout', () => {
  it('aborts a request that never responds', async () => {
    const wrapped = withRequestTimeout(hangingFetch, 20);
    // Without this, the Neon driver waits forever: no timeout, no error.
    await expect(wrapped('https://db.example/query')).rejects.toThrow('aborted');
  });

  it('leaves a fast request alone', async () => {
    const ok = async () => new Response('{}', { status: 200 });
    const wrapped = withRequestTimeout(ok, 1000);
    expect((await wrapped('https://db.example/query')).status).toBe(200);
  });

  it("still honours the caller's own signal", async () => {
    // Combining rather than replacing matters: a caller-initiated cancel must
    // not be swallowed by our timeout.
    const controller = new AbortController();
    const wrapped = withRequestTimeout(hangingFetch, 10_000);
    const promise = wrapped('https://db.example/query', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  it('passes the rest of the init through untouched', async () => {
    let seen: RequestInit | undefined;
    const capture = async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return new Response('{}');
    };
    await withRequestTimeout(capture, 1000)('https://db.example/query', {
      method: 'POST',
      headers: { 'x-test': '1' },
    });
    expect(seen?.method).toBe('POST');
    expect(seen?.headers).toEqual({ 'x-test': '1' });
    expect(seen?.signal).toBeDefined();
  });
});
