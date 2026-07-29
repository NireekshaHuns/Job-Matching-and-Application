/**
 * Embed step: turn a job description into a vector for later resume-relevance
 * similarity search. The embedding model is behind an injected `Embedder`.
 */
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';
import type { Embedder } from '../types';

/**
 * Embed the JD text. Returns null for empty text (some sources have no JD), so
 * we never spend an embedding call on nothing.
 */
export async function embedJd(jdText: string, embedder: Embedder): Promise<number[] | null> {
  if (!jdText.trim()) return null;
  const vector = await embedder.embed(jdText);
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding has ${vector.length} dims, expected ${EMBEDDING_DIMENSIONS}`);
  }
  return vector;
}
