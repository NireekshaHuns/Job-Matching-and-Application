import { describe, expect, it, vi } from 'vitest';
import type { Embedder } from '@/server/enrich/types';
import { embedBullets } from './corpus-ingest';

const VECTOR = [0.1, 0.2, 0.3];

function batchingEmbedder(): Embedder & { calls: { embed: number; embedMany: number } } {
  const calls = { embed: 0, embedMany: 0 };
  return {
    calls,
    async embed() {
      calls.embed++;
      return VECTOR;
    },
    async embedMany(texts) {
      calls.embedMany++;
      return texts.map(() => VECTOR);
    },
  };
}

describe('embedBullets', () => {
  it('returns nulls when there is no embedder', async () => {
    expect(await embedBullets(['a', 'b'])).toEqual([null, null]);
  });

  it('returns an empty array for no bullets, without calling the embedder', async () => {
    const embedder = batchingEmbedder();
    expect(await embedBullets([], embedder)).toEqual([]);
    expect(embedder.calls.embedMany).toBe(0);
    expect(embedder.calls.embed).toBe(0);
  });

  it('uses ONE batch call rather than one call per bullet', async () => {
    const embedder = batchingEmbedder();
    const out = await embedBullets(['a', 'b', 'c'], embedder);

    expect(out).toEqual([VECTOR, VECTOR, VECTOR]);
    expect(embedder.calls.embedMany).toBe(1);
    expect(embedder.calls.embed).toBe(0);
  });

  it('falls back to per-bullet embedding when the embedder cannot batch', async () => {
    let calls = 0;
    const embedder: Embedder = {
      async embed() {
        calls++;
        return VECTOR;
      },
    };

    expect(await embedBullets(['a', 'b'], embedder)).toEqual([VECTOR, VECTOR]);
    expect(calls).toBe(2);
  });

  it('falls back when the batch call throws', async () => {
    const embedder: Embedder = {
      async embed() {
        return VECTOR;
      },
      async embedMany() {
        throw new Error('rate limited');
      },
    };

    expect(await embedBullets(['a', 'b'], embedder)).toEqual([VECTOR, VECTOR]);
  });

  it('falls back when the batch result length does not match the input', async () => {
    // A short result would otherwise misalign vectors with bullets — silently
    // attaching bullet B's vector to bullet C.
    const embedder: Embedder = {
      async embed() {
        return VECTOR;
      },
      async embedMany() {
        return [VECTOR];
      },
    };

    expect(await embedBullets(['a', 'b', 'c'], embedder)).toEqual([VECTOR, VECTOR, VECTOR]);
  });

  it('keeps other bullets when a single embed fails', async () => {
    const embed = vi
      .fn()
      .mockResolvedValueOnce(VECTOR)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(VECTOR);
    const embedder: Embedder = { embed };

    expect(await embedBullets(['a', 'b', 'c'], embedder)).toEqual([VECTOR, null, VECTOR]);
  });
});
