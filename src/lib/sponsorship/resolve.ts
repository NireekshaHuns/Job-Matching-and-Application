/**
 * Entity resolution — match a raw posting company name to a canonical USCIS
 * employer key (`sponsors.company_name_normalized`).
 *
 * The spec (§5.3) calls this out as the thing that quietly breaks sponsorship
 * tools: "Stripe" vs "Stripe, Inc." vs "Stripe Payments Company". Normalization
 * (`normalizeCompanyName`) already collapses legal suffixes and punctuation;
 * this adds a fuzzy layer for the residual near-misses and, crucially, always
 * returns a **confidence** so the match can be shown and corrected — never
 * silently asserted.
 *
 * Pure and dependency-light: token overlap + Levenshtein, no external libs.
 *
 * Known limitation: candidate generation uses a token / token-prefix index, so
 * a typo that shares neither a whole token nor a 4-char prefix with any sponsor
 * (rare for company names) won't be proposed. The user-correction path
 * (`company_aliases`) is the backstop for those.
 */
import { normalizeCompanyName } from './normalize';

export type MatchMethod = 'exact' | 'fuzzy' | 'manual';

export interface ResolveResult {
  /** Matched sponsor key, or null when nothing clears the threshold. */
  key: string | null;
  /** 0–1. Exactly 1 only for an exact normalized hit; fuzzy is capped below 1. */
  confidence: number;
  /** How `key` was found. Meaningless (and unused) when `key` is null. */
  method: MatchMethod;
}

/** Minimum blended similarity for a fuzzy match to count. */
export const FUZZY_THRESHOLD = 0.6;
/** Fuzzy confidence is capped here so it never ties an exact hit. */
const FUZZY_CONFIDENCE_CAP = 0.99;
/** Token-prefix length used for cheap typo-tolerant candidate bucketing. */
const PREFIX_LEN = 4;

/** Levenshtein edit distance (two-row DP). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0–1 character-level similarity: 1 - dist / maxLen. */
function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/**
 * Blended similarity of two already-normalized keys. Takes the max of a
 * token-overlap score (handles suffix/subset variants like "Stripe" vs
 * "Stripe Payments") and a character ratio (handles typos in single-token
 * names like "Databrics" vs "Databricks").
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = inter / union;
  const containment = inter / Math.min(aTokens.size, bTokens.size);
  const tokenScore = 0.6 * jaccard + 0.4 * containment;

  return Math.max(tokenScore, levenshteinRatio(a, b));
}

/** An index over sponsor keys supporting exact lookup + fuzzy candidate generation. */
export interface SponsorIndex {
  readonly size: number;
  has(key: string): boolean;
  /** Sponsor keys sharing a whole token or a 4-char token-prefix with `tokens`. */
  candidates(tokens: string[]): string[];
}

function addTo(map: Map<string, Set<string>>, bucket: string, key: string): void {
  const set = map.get(bucket);
  if (set) set.add(key);
  else map.set(bucket, new Set([key]));
}

/** Build a reusable index from the sponsor keys (call once per enrichment run). */
export function buildSponsorIndex(keys: Iterable<string>): SponsorIndex {
  const all = new Set<string>();
  const byToken = new Map<string, Set<string>>();
  const byPrefix = new Map<string, Set<string>>();

  for (const key of keys) {
    if (!key) continue;
    all.add(key);
    for (const tok of key.split(' ')) {
      if (!tok) continue;
      addTo(byToken, tok, key);
      if (tok.length >= PREFIX_LEN) addTo(byPrefix, tok.slice(0, PREFIX_LEN), key);
    }
  }

  return {
    size: all.size,
    has: (k) => all.has(k),
    candidates(tokens) {
      const out = new Set<string>();
      for (const tok of tokens) {
        for (const key of byToken.get(tok) ?? []) out.add(key);
        if (tok.length >= PREFIX_LEN) {
          for (const key of byPrefix.get(tok.slice(0, PREFIX_LEN)) ?? []) out.add(key);
        }
      }
      return [...out];
    },
  };
}

/**
 * Resolve a raw company name to a sponsor key. Exact normalized hit → confidence
 * 1. Otherwise the best fuzzy candidate at/above `FUZZY_THRESHOLD`. Else null
 * (no confident match — the caller surfaces this as "No record"/"Unknown", never
 * a fabricated match).
 */
export function resolveEmployer(
  rawName: string | null | undefined,
  index: SponsorIndex,
): ResolveResult {
  const key = normalizeCompanyName(rawName);
  if (!key) return { key: null, confidence: 0, method: 'fuzzy' };
  if (index.has(key)) return { key, confidence: 1, method: 'exact' };

  const tokens = key.split(' ').filter(Boolean);
  let best: string | null = null;
  let bestScore = 0;
  for (const cand of index.candidates(tokens)) {
    const score = similarity(key, cand);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (best && bestScore >= FUZZY_THRESHOLD) {
    return {
      key: best,
      confidence: Math.min(Math.round(bestScore * 100) / 100, FUZZY_CONFIDENCE_CAP),
      method: 'fuzzy',
    };
  }
  return { key: null, confidence: 0, method: 'fuzzy' };
}
