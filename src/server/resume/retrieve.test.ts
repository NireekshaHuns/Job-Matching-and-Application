import { describe, expect, it } from 'vitest';
import { cosineSimilarity, rankCorpusBullets, type CorpusBullet } from './retrieve';

function bullet(partial: Partial<CorpusBullet> & { id: number }): CorpusBullet {
  return {
    text: `bullet ${partial.id}`,
    company: null,
    skills: [],
    roleFamily: null,
    embedding: null,
    ...partial,
  };
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for missing/mismatched vectors', () => {
    expect(cosineSimilarity(null, [1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('rankCorpusBullets', () => {
  it('ranks by keyword overlap when there are no embeddings', () => {
    const bullets = [
      bullet({ id: 1, skills: ['react'] }),
      bullet({ id: 2, skills: ['kafka', 'grpc'] }),
      bullet({ id: 3, skills: ['python'] }),
    ];
    const ranked = rankCorpusBullets({
      bullets,
      jdEmbedding: null,
      selectedKeywords: ['kafka', 'grpc'],
      roleFamily: null,
    });
    expect(ranked[0].id).toBe(2); // covers both selected keywords
  });

  it('filters by role family (null bullet or matching role only)', () => {
    const bullets = [
      bullet({ id: 1, roleFamily: 'backend', skills: ['kafka'] }),
      bullet({ id: 2, roleFamily: 'frontend', skills: ['kafka'] }),
      bullet({ id: 3, roleFamily: null, skills: ['kafka'] }),
    ];
    const ids = rankCorpusBullets({
      bullets,
      jdEmbedding: null,
      selectedKeywords: ['kafka'],
      roleFamily: 'backend',
    }).map((b) => b.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it('drops near-duplicate bullet text', () => {
    const bullets = [
      bullet({ id: 1, text: 'Built a Kafka pipeline', skills: ['kafka'] }),
      bullet({ id: 2, text: 'built   a kafka PIPELINE', skills: ['kafka'] }),
    ];
    const ranked = rankCorpusBullets({
      bullets,
      jdEmbedding: null,
      selectedKeywords: ['kafka'],
      roleFamily: null,
    });
    expect(ranked).toHaveLength(1);
  });

  it('respects the limit', () => {
    const bullets = Array.from({ length: 30 }, (_, i) =>
      bullet({ id: i + 1, text: `b${i}`, skills: ['kafka'] }),
    );
    const ranked = rankCorpusBullets({
      bullets,
      jdEmbedding: null,
      selectedKeywords: ['kafka'],
      roleFamily: null,
      limit: 5,
    });
    expect(ranked).toHaveLength(5);
  });

  it('blends semantic similarity when embeddings are present', () => {
    const bullets = [
      bullet({ id: 1, skills: [], embedding: [1, 0] }), // semantically closest
      bullet({ id: 2, skills: [], embedding: [0, 1] }),
    ];
    const ranked = rankCorpusBullets({
      bullets,
      jdEmbedding: [1, 0],
      selectedKeywords: [],
      roleFamily: null,
    });
    expect(ranked[0].id).toBe(1);
  });
});
