'use client';

/**
 * The JD keyword review step.
 *
 * Each row carries the four things that decide whether to tick it: what the
 * posting called it, how heavily it weighs, which section it came from, and
 * whether the corpus can actually back it. Chips could only ever show the first
 * of those, and at fifty keywords the other three are the whole point.
 *
 * Every decision here (default ticks, grouping, the defensible/adjacent split)
 * lives in `@/lib/keyword-selection` so it can be tested; this file renders.
 */
import type { EvidenceGrade, GradedKeyword } from '@/server/resume/keyword-evidence';
import type { JdSection } from '@/server/resume/jd-keywords';
import type { PickerGroup, PickerRow } from '@/lib/keyword-selection';

/** Same palette as `TailoringReport`, so the two panels agree on what good looks like. */
const GRADE_STYLE: Record<EvidenceGrade, string> = {
  strong: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  moderate: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  weak: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  missing: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

const GRADE_HINT: Record<EvidenceGrade, string> = {
  strong: 'listed and proven in your bullets',
  moderate: 'supported, but only in one place',
  weak: 'something near this, under another name',
  missing: 'nothing in your corpus supports this',
};

/**
 * Provenance styling carries the down-weighting: a bonus technology reads quiet
 * next to a hard requirement, which is the judgement the whole step exists for.
 */
const SECTION_STYLE: Record<JdSection, string> = {
  required: 'text-fg font-medium',
  preferred: 'text-muted',
  responsibilities: 'text-muted',
  unspecified: 'text-faint',
  education: 'text-faint',
  bonus: 'text-faint',
};

const SECTION_LABEL: Record<JdSection, string> = {
  required: 'required',
  preferred: 'preferred',
  responsibilities: 'the job',
  unspecified: 'unsorted',
  education: 'education',
  bonus: 'bonus',
};

function KeywordRow({
  keyword,
  on,
  onToggle,
}: {
  keyword: GradedKeyword;
  on: boolean;
  onToggle: (term: string) => void;
}) {
  const { evidence } = keyword;
  const evidenced = evidence.grade === 'strong' || evidence.grade === 'moderate';
  // Ticking something the corpus cannot back is a legitimate choice, but it
  // changes what the generator is told to do — so say so at the moment of the
  // click rather than letting it be discovered in the output.
  const adjacent = on && !evidenced;

  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(keyword.term)}
        title={evidence.sample ? `Proven by: ${evidence.sample}` : GRADE_HINT[evidence.grade]}
        className={`press flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors ${
          adjacent
            ? 'border-amber-400/60 bg-amber-500/10'
            : on
              ? 'border-brand bg-brand/10'
              : 'border-border bg-surface-2 hover:bg-surface'
        }`}
      >
        <span
          aria-hidden
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            on ? 'border-brand bg-brand text-brand-contrast' : 'border-border'
          }`}
        >
          {on ? '✓' : ''}
        </span>
        <span className="text-fg min-w-0 flex-1 truncate">{keyword.term}</span>
        <span className="text-faint font-display shrink-0 text-xs tabular-nums" title="Importance">
          {keyword.importance}
        </span>
        <span className={`shrink-0 text-[11px] ${SECTION_STYLE[keyword.section]}`}>
          {SECTION_LABEL[keyword.section]}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${GRADE_STYLE[evidence.grade]}`}
        >
          {evidence.grade}
        </span>
      </button>
      {evidence.viaAlias && evidence.matchedTerm && (
        <p className="text-faint mt-0.5 pl-9 text-[11px]">via {evidence.matchedTerm}</p>
      )}
      {adjacent && (
        <p className="mt-0.5 pl-9 text-[11px] text-amber-700 dark:text-amber-400">
          No evidence — the résumé will gesture at this in the posting&rsquo;s words, not claim it.
        </p>
      )}
    </li>
  );
}

function OrGroupBox({
  row,
  selected,
  onToggle,
}: {
  row: Extract<PickerRow, { kind: 'orGroup' }>;
  selected: Set<string>;
  onToggle: (term: string) => void;
}) {
  const held = row.members.filter(
    (m) => m.evidence.grade === 'strong' || m.evidence.grade === 'moderate',
  ).length;

  return (
    <li className="border-border bg-surface-2/40 rounded-lg border border-dashed p-2">
      <p className="mb-1.5 text-[11px]">
        <span className="text-muted">Any one of: </span>
        <span className="text-fg">{row.group.label}</span>
        {row.satisfied ? (
          <span className="text-faint"> — satisfied by {held} you have.</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            {' '}
            — you have none of these. Missing, and not worth adding.
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-1">
        {row.members.map((m) => (
          <KeywordRow key={m.term} keyword={m} on={selected.has(m.term)} onToggle={onToggle} />
        ))}
      </ul>
    </li>
  );
}

export function KeywordPicker({
  groups,
  selected,
  onToggle,
  onReset,
  onClear,
  stats,
}: {
  groups: PickerGroup[];
  selected: Set<string>;
  onToggle: (term: string) => void;
  /** Back to the evidence-based default selection. */
  onReset: () => void;
  onClear: () => void;
  stats: { total: number; dropped: number; byGrade: Record<EvidenceGrade, number> };
}) {
  const btn = 'press rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2';

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border bg-surface-2/50 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2">
        <span className="text-fg text-xs font-medium">
          {stats.total} keyword{stats.total === 1 ? '' : 's'} · {selected.size} ticked
        </span>
        <span className="text-faint text-xs">
          {stats.byGrade.strong} strong · {stats.byGrade.moderate} moderate · {stats.byGrade.weak}{' '}
          related · {stats.byGrade.missing} missing
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={onReset}>
            Reset to suggested
          </button>
          <button type="button" className={btn} onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      <p className="text-muted text-xs">
        Sorted by how heavily the posting weighs each one. Tick what you can defend in an interview
        — a keyword you can&rsquo;t is worse than a missing one.
        {stats.dropped > 0 && (
          <span className="text-faint">
            {' '}
            {stats.dropped} lower-priority keyword{stats.dropped === 1 ? '' : 's'} not shown.
          </span>
        )}
      </p>

      {groups.length === 0 && <span className="text-faint text-sm">No keywords found.</span>}

      {groups.map((group) => (
        <div key={group.bucket}>
          <div className="text-muted mb-0.5 text-xs font-medium tracking-wide uppercase">
            {group.label}
          </div>
          <p className="text-faint mb-1.5 text-[11px]">{group.hint}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {group.rows.map((row) =>
              row.kind === 'orGroup' ? (
                <OrGroupBox key={row.group.id} row={row} selected={selected} onToggle={onToggle} />
              ) : (
                <KeywordRow
                  key={row.keyword.term}
                  keyword={row.keyword}
                  on={selected.has(row.keyword.term)}
                  onToggle={onToggle}
                />
              ),
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
