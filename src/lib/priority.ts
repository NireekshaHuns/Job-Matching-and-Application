/**
 * Apply-priority weights — shared, client-safe (no server/db imports) so the
 * board UI and the tRPC scorer use one source of truth for the default mix.
 */
export interface PriorityWeights {
  tier: number;
  fit: number;
  freshness: number;
}

/** Tier-dominant default mix (percentages; the blend is a weighted average). */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { tier: 60, fit: 30, freshness: 10 };

/** Fall back to the default mix when weights are absent or sum to zero. */
export function resolveWeights(w?: Partial<PriorityWeights> | null): PriorityWeights {
  if (!w) return DEFAULT_PRIORITY_WEIGHTS;
  const merged = { ...DEFAULT_PRIORITY_WEIGHTS, ...w };
  const sum = merged.tier + merged.fit + merged.freshness;
  return sum > 0 ? merged : DEFAULT_PRIORITY_WEIGHTS;
}
