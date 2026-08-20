/**
 * Apply-priority weights — shared, client-safe (no server/db imports) so the
 * board UI and the tRPC scorer use one source of truth for the default mix.
 *
 * There was a third component, résumé fit, weighted at 30. Nothing ever scored
 * the résumés in use, so that share of the blend was permanently zero and every
 * job's priority was really tier and freshness renormalized by hand. Removing it
 * makes the number mean what it says.
 */
export interface PriorityWeights {
  tier: number;
  freshness: number;
}

/** Tier-dominant default mix (percentages; the blend is a weighted average). */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { tier: 85, freshness: 15 };

/** Fall back to the default mix when weights are absent or sum to zero. */
export function resolveWeights(w?: Partial<PriorityWeights> | null): PriorityWeights {
  if (!w) return DEFAULT_PRIORITY_WEIGHTS;
  const merged = { ...DEFAULT_PRIORITY_WEIGHTS, ...w };
  const sum = merged.tier + merged.freshness;
  return sum > 0 ? merged : DEFAULT_PRIORITY_WEIGHTS;
}
