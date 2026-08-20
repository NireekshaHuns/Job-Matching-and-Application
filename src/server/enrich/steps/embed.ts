/**
 * Embed step: turn a job description into a vector. The embedding model is
 * behind an injected `Embedder`.
 *
 * OFF BY DEFAULT. `jobs.embedding` is written but never read: résumé relevance
 * was removed entirely (#180), and the Studio
 * embeds the pasted JD fresh at tailor time rather than reading this column.
 * Passing no embedder skips the call entirely — which matters on a bulk load,
 * where it is one paid request per posting for a column nothing consumes. The
 * column and its index stay in place so turning this back on is just a matter
 * of supplying an embedder again.
 */
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';
import type { Embedder } from '../types';

/**
 * Embed the JD text, or null when there is no embedder or nothing to embed
 * (some sources carry no JD), so we never spend a call on nothing.
 */
export async function embedJd(jdText: string, embedder?: Embedder): Promise<number[] | null> {
  if (!embedder || !jdText.trim()) return null;
  const vector = await embedder.embed(jdText);
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding has ${vector.length} dims, expected ${EMBEDDING_DIMENSIONS}`);
  }
  return vector;
}
