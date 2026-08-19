/**
 * Sponsor resolver — turns a raw posting company name into government history
 * plus a confidence-scored match to a USCIS employer.
 *
 * Wiring for entity resolution (spec §5.3): a user-`confirmed` alias always
 * wins; otherwise `resolveEmployer` (exact → fuzzy → null). Every non-confirmed
 * match is recorded in `discovered` so the caller can persist it to
 * `company_aliases` (auditable + correctable). Pure: all data is passed in, so
 * this is unit-testable without a DB.
 */
import {
  buildSponsorIndex,
  normalizeCompanyName,
  resolveEmployer,
  type MatchMethod,
  type SponsorHistory,
} from '@/lib/sponsorship';

export interface SponsorResolution {
  /** Aggregated government history for the matched employer, or null. */
  history: SponsorHistory | null;
  /** Matched sponsor key, or null when unresolved. */
  key: string | null;
  /** 0–1 match confidence; null when unresolved. */
  confidence: number | null;
  /** How the match was made (only meaningful when `key` is non-null). */
  method: MatchMethod;
}

/** Resolve a raw company name to history + match metadata. */
export type SponsorResolver = (company: string) => SponsorResolution;

/** A company→sponsor match discovered during enrichment, pending persistence. */
export interface DiscoveredAlias {
  rawName: string;
  rawNameNormalized: string;
  sponsorKey: string;
  confidence: number;
  method: MatchMethod;
}

export interface ResolverInputs {
  /** Government history keyed by normalized sponsor name. */
  historyByKey: Map<string, SponsorHistory>;
  /**
   * User-confirmed aliases: normalized raw posting name → sponsor key, or null
   * for a confirmed "no match". These override any recomputed resolution.
   */
  confirmedAliases: Map<string, string | null>;
}

/**
 * Build a resolver plus the set of non-confirmed matches it discovers (keyed by
 * normalized raw name, so each distinct company is recorded once).
 */
export function buildSponsorResolver(inputs: ResolverInputs): {
  resolve: SponsorResolver;
  discovered: Map<string, DiscoveredAlias>;
} {
  const index = buildSponsorIndex(inputs.historyByKey.keys());
  const discovered = new Map<string, DiscoveredAlias>();

  const resolve: SponsorResolver = (company) => {
    const rawNorm = normalizeCompanyName(company);
    if (!rawNorm) return { history: null, key: null, confidence: null, method: 'fuzzy' };

    // A user-confirmed mapping is authoritative — never silently re-resolve it.
    if (inputs.confirmedAliases.has(rawNorm)) {
      const key = inputs.confirmedAliases.get(rawNorm) ?? null;
      // A confirmed match is confidence 1; a confirmed "no match" (null key) is
      // unmatched, so confidence must be null — never assert a match that isn't.
      return {
        history: key ? (inputs.historyByKey.get(key) ?? null) : null,
        key,
        confidence: key ? 1 : null,
        method: 'manual',
      };
    }

    // The history map doubles as the strength lookup, so the resolver can prefer
    // the family member that actually sponsors new hires over the one whose name
    // happens to be shortest.
    const r = resolveEmployer(company, index, {
      strengthOf: (key) => inputs.historyByKey.get(key),
    });
    if (r.key) {
      discovered.set(rawNorm, {
        rawName: company,
        rawNameNormalized: rawNorm,
        sponsorKey: r.key,
        confidence: r.confidence,
        method: r.method,
      });
      return {
        history: inputs.historyByKey.get(r.key) ?? null,
        key: r.key,
        confidence: r.confidence,
        method: r.method,
      };
    }
    return { history: null, key: null, confidence: null, method: r.method };
  };

  return { resolve, discovered };
}
