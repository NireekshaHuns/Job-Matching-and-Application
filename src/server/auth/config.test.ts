import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthConfigured } from './config';

describe('isAuthConfigured', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false unless the secret, owner email, and password are all set', () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('OWNER_EMAIL', '');
    vi.stubEnv('OWNER_PASSWORD', '');
    expect(isAuthConfigured()).toBe(false);

    vi.stubEnv('AUTH_SECRET', 'secret');
    vi.stubEnv('OWNER_EMAIL', 'owner@example.com');
    expect(isAuthConfigured()).toBe(false); // password still missing

    vi.stubEnv('OWNER_PASSWORD', 'pw');
    expect(isAuthConfigured()).toBe(true);
  });
});
