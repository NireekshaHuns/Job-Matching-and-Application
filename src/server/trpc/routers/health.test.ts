import { describe, expect, it } from 'vitest';
import { createCaller } from '../root';

describe('health router', () => {
  it('reports ok', async () => {
    const caller = createCaller({ headers: new Headers() });
    await expect(caller.health.check()).resolves.toEqual({ status: 'ok' });
  });
});
