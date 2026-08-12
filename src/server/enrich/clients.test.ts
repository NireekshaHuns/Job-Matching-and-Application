import { describe, expect, it } from 'vitest';
import { embeddingsEnabled } from './clients';

describe('embeddingsEnabled', () => {
  it('is OFF unless explicitly switched on', () => {
    // jobs.embedding is written but never read, so the default must not spend
    // an embedding call per posting.
    expect(embeddingsEnabled({})).toBe(false);
    expect(embeddingsEnabled({ ENRICH_EMBEDDINGS: '' })).toBe(false);
    expect(embeddingsEnabled({ ENRICH_EMBEDDINGS: '0' })).toBe(false);
    expect(embeddingsEnabled({ ENRICH_EMBEDDINGS: 'false' })).toBe(false);
  });

  it('accepts 1 and true', () => {
    expect(embeddingsEnabled({ ENRICH_EMBEDDINGS: '1' })).toBe(true);
    expect(embeddingsEnabled({ ENRICH_EMBEDDINGS: 'true' })).toBe(true);
  });
});
