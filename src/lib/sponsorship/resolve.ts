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

/** All spaces removed — "WAL MART ASSOCIATES" -> "WALMARTASSOCIATES". */
function compress(key: string): string {
  return key.replace(/ /g, '');
}

/**
 * Cumulative concatenations at token boundaries:
 * "WAL MART ASSOCIATES" -> ["WAL", "WALMART", "WALMARTASSOCIATES"].
 */
function tokenBoundaryPrefixes(key: string): string[] {
  const out: string[] = [];
  let acc = '';
  for (const tok of key.split(' ')) {
    if (!tok) continue;
    acc += tok;
    out.push(acc);
  }
  return out;
}

/**
 * Similarity for names that differ only in WORD SPACING, which neither the token
 * nor the character measure can see.
 *
 * The motivating case is real and expensive: postings say "Walmart" (key
 * `WALMART`) while USCIS files as "Wal-Mart Associates, Inc." (key
 * `WAL MART ASSOCIATES`, since the hyphen becomes a separator). They share no
 * token, `WAL` is too short for the prefix index, and the character ratio is
 * 0.37 — so Walmart scored `Low` ("no sponsorship history") against 1,669 real
 * sponsorships with a 2026 filing.
 *
 * DELIBERATELY BOUNDARY-ALIGNED, not a plain substring test. The shorter
 * compressed name must equal a whole-token prefix of the longer one, so
 * `WALMART` matches `WAL MART ASSOCIATES` but `APPLE` does NOT match
 * `APPLEBEES` — a plain `startsWith` would happily assert that one, and a
 * false High tier is worse than a false Low.
 *
 * Names that compress identically ("WAL MART" vs "WALMART") score 1; the caller
 * still caps fuzzy confidence below an exact hit, so this never impersonates one.
 *
 * KNOWN FALSE POSITIVE, measured against the live sponsor table: "PaperCut" (the
 * print-management vendor) resolves to "PAPER CUT CLOTHING" at 0.85. That pair is
 * structurally identical to the Walmart one — a two-token span plus one trailing
 * token — so the name alone carries no signal to separate them, exactly the
 * ambiguity documented on `similarity`. The trade was measured and taken: one
 * employer with a single filing scores slightly generously, versus Walmart's
 * 1,669 filings being reported as "no sponsorship history". The visible
 * confidence and the correctable `company_aliases` row are the backstop.
 */
export function spacingSimilarity(a: string, b: string): number {
  const ca = compress(a);
  const cb = compress(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const [shortKey, longKey] = ca.length <= cb.length ? [a, b] : [b, a];
  const shortComp = compress(shortKey);

  // How many of the longer name's tokens the shorter name covers.
  const spanned = tokenBoundaryPrefixes(longKey).indexOf(shortComp) + 1;

  // Must span at least TWO tokens. That is precisely what makes this a SPACING
  // difference ("WALMART" = "WAL" + "MART") rather than plain token containment
  // ("APPLE" is just the first token of "APPLE BANK FOR SAVINGS"). The token
  // measure already scores containment, and scores it low on purpose — one
  // shared token out of four is weak evidence, and overriding that here would
  // resolve Apple to a savings bank.
  if (spanned < 2) return 0;

  // Scored on coverage, but floored well above FUZZY_THRESHOLD: a boundary
  // -aligned spacing variant is strong evidence even when the legal name carries
  // several extra tokens.
  const shorter = shortComp.length;
  const longer = compress(longKey).length;
  return 0.75 + 0.2 * (shorter / longer);
}

/**
 * Blended similarity of two already-normalized keys. Takes the max of a
 * token-overlap score (handles suffix/subset variants like "Stripe" vs
 * "Stripe Payments") and a character ratio (handles typos in single-token
 * names like "Databrics" vs "Databricks").
 *
 * Inherent ambiguity: a one-token name fully contained in a two-token candidate
 * ("Stripe" ⊂ "Stripe Payments") is structurally identical to an unrelated pair
 * that happens to share a head token ("Delta" ⊂ "Delta Dental"). The name alone
 * carries no signal to tell them apart, so both surface as a moderate-confidence
 * fuzzy match rather than being silently rejected (which would also drop the
 * real "Stripe Payments" case). The displayed confidence + user-correctable
 * alias (`company_aliases`) are the deliberate backstop — see spec §5.3/§7.
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

  return Math.max(tokenScore, levenshteinRatio(a, b), spacingSimilarity(a, b));
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
  const byBoundary = new Map<string, Set<string>>();

  for (const key of keys) {
    if (!key) continue;
    all.add(key);
    for (const tok of key.split(' ')) {
      if (!tok) continue;
      addTo(byToken, tok, key);
      if (tok.length >= PREFIX_LEN) addTo(byPrefix, tok.slice(0, PREFIX_LEN), key);
    }
    // Space-insensitive bucketing at token boundaries, so a spacing variant is
    // even PROPOSED as a candidate. Without this, `WALMART` generated an empty
    // candidate list against `WAL MART ASSOCIATES` — the similarity measure
    // never got a chance to score it.
    for (const boundary of tokenBoundaryPrefixes(key)) addTo(byBoundary, boundary, key);
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
      // Looking up EVERY cumulative prefix of the query covers both directions:
      // a sponsor whose boundary prefix is the whole query ("Walmart" ->
      // "WAL MART ASSOCIATES"), and a sponsor whose full name is a prefix of the
      // query ("Wal-Mart Associates" -> "WALMART").
      let acc = '';
      for (const tok of tokens) {
        acc += tok;
        for (const key of byBoundary.get(acc) ?? []) out.add(key);
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
