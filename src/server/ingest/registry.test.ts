import { describe, expect, it } from 'vitest';
import { buildConnectors } from './registry';

describe('buildConnectors', () => {
  it('registers the greenhouse and simplify connectors', () => {
    const sources = buildConnectors(async () => new Response('{}')).map((c) => c.source);
    expect(sources).toContain('greenhouse');
    expect(sources).toContain('github:simplify-newgrad');
  });
});
