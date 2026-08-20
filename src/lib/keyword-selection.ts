/**
 * The decisions the keyword picker makes, kept out of the component.
 *
 * Which keywords start ticked, how the rows are grouped, and — the load-bearing
 * one — how a ticked keyword is classified for the generator: something the
 * résumé may claim outright, or something it may only gesture at. That split is
 * what stops the tailoring step from claiming a tool the corpus has never seen,
 * so it lives in a pure module with tests rather than inside a `.tsx`.
 *
 * Client-safe: types only from the server modules, no server-only imports.
 */
import type { EvidenceGrade, GradedKeyword } from '@/server/resume/keyword-evidence';
import type { JdOrGroup, KeywordBucket } from '@/server/resume/jd-keywords';

export interface KeywordSelectionInput {
  keywords: readonly GradedKeyword[];
  orGroups: readonly JdOrGroup[];
}

/** Grades that count as real evidence: tickable by default, claimable outright. */
export const EVIDENCED_GRADES: readonly EvidenceGrade[] = ['strong', 'moderate'];

const GRADE_RANK: Record<EvidenceGrade, number> = { strong: 3, moderate: 2, weak: 1, missing: 0 };

export function hasEvidence(keyword: GradedKeyword): boolean {
  return EVIDENCED_GRADES.includes(keyword.evidence.grade);
}

/** Best-evidenced first, then most important, then posting order. */
function byStrength(a: GradedKeyword, b: GradedKeyword): number {
  return (
    GRADE_RANK[b.evidence.grade] - GRADE_RANK[a.evidence.grade] ||
    b.evidence.score - a.evidence.score ||
    b.importance - a.importance
  );
}

function membersOf(group: JdOrGroup, byTerm: Map<string, GradedKeyword>): GradedKeyword[] {
  return group.members.map((t) => byTerm.get(t)).filter((k): k is GradedKeyword => k !== undefined);
}

/**
 * The ticks to start with: everything the corpus actually supports, except
 * inside an either/or requirement, where only the best-evidenced member is
 * ticked.
 *
 * That exception is the whole reason OR-groups are extracted. Having Python and
 * Java already satisfies "Python, Java, or Golang", so Golang stays unticked —
 * a keyword you cannot defend in an interview is worse than a missing one. A
 * group where nothing has evidence gets no ticks at all rather than a guess.
 *
 * `weak` is deliberately not ticked. It renders invitingly, but ticking it turns
 * into an adjacent-only instruction that costs the generator a bullet's worth of
 * budget, so it should be a decision rather than a default.
 */
export function defaultKeywordSelection(input: KeywordSelectionInput): string[] {
  const byTerm = new Map(input.keywords.map((k) => [k.term, k]));
  const grouped = new Set<string>();
  const picked = new Set<string>();

  for (const group of input.orGroups) {
    const members = membersOf(group, byTerm);
    for (const m of members) grouped.add(m.term);
    const best = members.filter(hasEvidence).sort(byStrength)[0];
    if (best) picked.add(best.term);
  }

  // Preserve importance order, which `keywords` already carries.
  return input.keywords
    .filter((k) => (grouped.has(k.term) ? picked.has(k.term) : hasEvidence(k)))
    .map((k) => k.term);
}

export type PickerRow =
  | { kind: 'keyword'; keyword: GradedKeyword }
  | {
      kind: 'orGroup';
      group: JdOrGroup;
      members: GradedKeyword[];
      /** True when at least one member has real evidence. */
      satisfied: boolean;
    };

export interface PickerGroup {
  bucket: KeywordBucket;
  label: string;
  hint: string;
  /** Either/or requirements first, then single keywords by importance. */
  rows: PickerRow[];
}

const BUCKET_META: Record<KeywordBucket, { label: string; hint: string }> = {
  technical: {
    label: 'Technical & domain',
    hint: 'Tools, platforms, and the engineering concepts the posting names.',
  },
  soft: {
    label: 'Signal & behavioural',
    hint: 'Shown through what a bullet describes, never stated as a phrase.',
  },
};

/**
 * Rows for the picker, grouped by bucket. Every keyword appears exactly once —
 * a member of an either/or requirement is rendered inside its group and not
 * again on its own.
 */
export function buildPickerGroups(input: KeywordSelectionInput): PickerGroup[] {
  const byTerm = new Map(input.keywords.map((k) => [k.term, k]));
  const claimed = new Set<string>();
  const groupRows = new Map<KeywordBucket, PickerRow[]>();

  for (const group of input.orGroups) {
    const members = membersOf(group, byTerm);
    if (members.length < 2) continue;
    for (const m of members) claimed.add(m.term);
    // A group's home is its first surviving member's bucket; in practice every
    // member of an either/or requirement is the same kind of thing.
    const bucket = members[0].bucket;
    const rows = groupRows.get(bucket) ?? [];
    rows.push({
      kind: 'orGroup',
      group,
      members: [...members].sort(byStrength),
      satisfied: members.some(hasEvidence),
    });
    groupRows.set(bucket, rows);
  }

  const out: PickerGroup[] = [];
  for (const bucket of ['technical', 'soft'] as const) {
    const singles: PickerRow[] = input.keywords
      .filter((k) => k.bucket === bucket && !claimed.has(k.term))
      .map((keyword) => ({ kind: 'keyword' as const, keyword }));
    const rows = [...(groupRows.get(bucket) ?? []), ...singles];
    if (rows.length === 0) continue;
    out.push({ bucket, ...BUCKET_META[bucket], rows });
  }
  return out;
}

export interface SelectionSplit {
  /** Ticked and backed by the corpus — the résumé may claim these outright. */
  defensible: string[];
  /** Ticked without evidence — gesture at in the posting's words, never claim. */
  adjacentOnly: string[];
}

/**
 * Split the ticked terms for the generator.
 *
 * Order is preserved from `keywords` (importance desc), because the tailoring
 * prompt tells the model to drop from the end of the list if they cannot all fit
 * naturally — so the order has to actually mean something. Terms not in the
 * analysis (hand-added, or left over from a previous extraction) are treated as
 * defensible, matching the old behaviour where every ticked keyword was claimed.
 */
export function splitSelection(
  selected: Iterable<string>,
  keywords: readonly GradedKeyword[],
): SelectionSplit {
  const ticked = new Set(selected);
  const defensible: string[] = [];
  const adjacentOnly: string[] = [];

  for (const k of keywords) {
    if (!ticked.has(k.term)) continue;
    ticked.delete(k.term);
    (hasEvidence(k) ? defensible : adjacentOnly).push(k.term);
  }
  // Whatever is left was never in the analysis.
  for (const term of ticked) defensible.push(term);

  return { defensible, adjacentOnly };
}
