import { describe, expect, it } from 'vitest';
import { buildConnectors } from './registry';

describe('buildConnectors', () => {
  it('registers the ATS + simplify connectors', () => {
    const sources = buildConnectors(async () => new Response('{}')).map((c) => c.source);
    expect(sources).toEqual(
      expect.arrayContaining(['greenhouse', 'lever', 'ashby', 'github:simplify-newgrad']),
    );
  });
});
