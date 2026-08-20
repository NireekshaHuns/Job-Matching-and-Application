/**
 * RAG retrieval over the bullet corpus: given the selected JD keywords (and,
 * when available, the JD embedding), rank the user's real bullets by relevance
 * and return the top-K as raw material for the tailoring model to synthesize
 * from. Pure and unit-testable — embeddings/DB are resolved by the caller and
 * passed in as plain rows.
 */
import { bulletMatchesRole, type BulletLike } from './bullets';

export interface CorpusBullet extends BulletLike {
  id: number;
  text: string;
  company: string | null;
  /** Bullet-text embedding, or null when it wasn't embedded (no API key). */
  embedding: number[] | null;
}

export interface RetrieveInput {
  bullets: CorpusBullet[];
  /** JD embedding for semantic similarity; null falls back to keyword overlap. */
  jdEmbedding: number[] | null;
  /** The keywords the user chose to target (lowercased). */
  selectedKeywords: string[];
  /** Restrict to bullets usable by this role family (null = all). */
  roleFamily: BulletLike['roleFamily'];
  /** Max bullets to return. */
  limit?: number;
}

export interface RankedBullet extends CorpusBullet {
  score: number;
}

const DEFAULT_LIMIT = 18;

/** Cosine similarity of two equal-length vectors; 0 if either is missing/empty. */
export function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Fraction of selected keywords a bullet's skill tags cover, 0–1. */
function keywordOverlap(bullet: CorpusBullet, selected: Set<string>): number {
  if (selected.size === 0) return 0;
  const tags = new Set(bullet.skills.map((s) => s.trim().toLowerCase()));
  let hits = 0;
  for (const k of selected) if (tags.has(k)) hits++;
  return hits / selected.size;
}

/** Collapse whitespace/case for near-duplicate bullet detection. */
function dedupKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Rank corpus bullets by a blend of semantic similarity (when embeddings exist)
 * and keyword overlap, drop role-mismatched and near-duplicate bullets, and
 * return the top-K. Ties break toward more keyword coverage, then newer ids.
 */
export function rankCorpusBullets(input: RetrieveInput): RankedBullet[] {
  const selected = new Set(input.selectedKeywords.map((k) => k.trim().toLowerCase()));
  const haveEmbeddings = input.jdEmbedding != null;

  const scored: RankedBullet[] = input.bullets
    .filter((b) => bulletMatchesRole(b.roleFamily, input.roleFamily))
    .map((b) => {
      const overlap = keywordOverlap(b, selected);
      const sim = haveEmbeddings
        ? Math.max(0, cosineSimilarity(input.jdEmbedding, b.embedding))
        : 0;
      // Weight semantic similarity and keyword coverage together; when there are
      // no embeddings, ranking is pure keyword overlap.
      const score = haveEmbeddings ? 0.6 * sim + 0.4 * overlap : overlap;
      return { ...b, score };
    });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ao = keywordOverlap(a, selected);
    const bo = keywordOverlap(b, selected);
    if (bo !== ao) return bo - ao;
    return b.id - a.id;
  });

  const seen = new Set<string>();
  const out: RankedBullet[] = [];
  for (const b of scored) {
    const key = dedupKey(b.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= (input.limit ?? DEFAULT_LIMIT)) break;
  }
  return out;
}
