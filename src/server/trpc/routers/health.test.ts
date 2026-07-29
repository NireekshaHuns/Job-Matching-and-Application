import { describe, expect, it } from 'vitest';
import type { DB } from '@/server/db';
import { createCaller } from '../root';

// health doesn't touch the db; a stub keeps the test free of a real connection.
const ctx = { headers: new Headers(), db: {} as unknown as DB };

describe('health router', () => {
  it('reports ok', async () => {
    const caller = createCaller(ctx);
    await expect(caller.health.check()).resolves.toEqual({ status: 'ok' });
  });
});
