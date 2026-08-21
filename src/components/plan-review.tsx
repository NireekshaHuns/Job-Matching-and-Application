'use client';

/**
 * The approval checkpoint between the two generation stages (#190).
 *
 * Stage A decides where every keyword lives, which courses to show and what the
 * skills rows are called; this panel is where the owner signs that off — or
 * changes it — BEFORE a word of prose exists. That ordering is the whole point:
 * once bullets are written, judging the plan means re-reading the résumé, and a
 * retry can silently rewrite a plan that was already right.
 *
 * Editable here: the coursework selection and each keyword's home. The skills
 * rows are shown as decided, since the server has already dropped anything the
 * master-skills list cannot defend.
 */
import { useState } from 'react';
import { describeSlot, type PlacementSlot, type ResumeOutline } from '@/server/resume/plan';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES } from '@/server/resume/template';

/** A slot as a stable `<option>` value, and back again. */
function slotValue(slot: PlacementSlot): string {
  switch (slot.kind) {
    case 'role':
      return `role:${slot.roleId}:${slot.bulletIndex}`;
    case 'project':
      return `project:${slot.bulletIndex}`;
    case 'skills':
      return `skills:${slot.label}`;
    case 'coursework':
      return 'coursework';
    case 'none':
      return 'none';
  }
}

/** Every home the layout offers, in reading order. */
function slotOptions(outline: ResumeOutline): PlacementSlot[] {
  return [
    ...RESUME_ROLES.flatMap((role) =>
      Array.from({ length: role.bullets }, (_, i): PlacementSlot => ({
        kind: 'role',
        roleId: role.id,
        bulletIndex: i,
      })),
    ),
    ...Array.from({ length: BULLET_BUDGET.projects }, (_, i): PlacementSlot => ({
      kind: 'project',
      bulletIndex: i,
    })),
    ...outline.skills.map((row): PlacementSlot => ({ kind: 'skills', label: row.label })),
    { kind: 'coursework' },
    { kind: 'none', reason: '' },
  ];
}

export interface PlanReviewProps {
  outline: ResumeOutline;
  /** The real courses available, so a swap is a pick and never free text. */
  coursePool: string[];
  /** Corpus-backed keywords: the ones that must end up somewhere. */
  mustHave: string[];
  /** What the outline check repaired or flagged. */
  issues: { rule: string; message: string }[];
  pending: boolean;
  onApprove: (outline: ResumeOutline) => void;
  onReplan: () => void;
  /** Caveat worth stating before approval, e.g. no tailoring key is set. */
  note?: string | null;
}

export function PlanReview({
  outline,
  coursePool,
  mustHave,
  issues,
  pending,
  onApprove,
  onReplan,
  note = null,
}: PlanReviewProps) {
  const [coursework, setCoursework] = useState<string[]>(outline.coursework);
  // One home per keyword: the model may list a keyword twice, but a review UI
  // that shows the same word in two rows invites contradicting yourself.
  const [homes, setHomes] = useState<{ keyword: string; slot: PlacementSlot }[]>(() => {
    const byKeyword = new Map<string, PlacementSlot>();
    for (const p of outline.placements) {
      if (!byKeyword.has(p.keyword.toLowerCase())) byKeyword.set(p.keyword.toLowerCase(), p.slot);
    }
    for (const kw of mustHave) {
      if (!byKeyword.has(kw.toLowerCase()))
        byKeyword.set(kw.toLowerCase(), { kind: 'none', reason: '' });
    }
    return [...byKeyword.entries()].map(([keyword, slot]) => ({ keyword, slot }));
  });

  const options = slotOptions(outline);
  const unplanned = homes.filter(
    (h) => h.slot.kind === 'none' && mustHave.some((k) => k.toLowerCase() === h.keyword),
  );

  const toggleCourse = (course: string) =>
    setCoursework((prev) =>
      prev.includes(course) ? prev.filter((c) => c !== course) : [...prev, course],
    );

  const setHome = (keyword: string, value: string) =>
    setHomes((prev) =>
      prev.map((h) =>
        h.keyword === keyword
          ? { ...h, slot: options.find((o) => slotValue(o) === value) ?? h.slot }
          : h,
      ),
    );

  return (
    <div className="border-border bg-surface mt-4 rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Plan review</h3>
        <p className="text-muted text-xs">
          Where everything is going, before any prose is written. Approve it and only the bullets
          get generated — the plan stays as you leave it here.
        </p>
      </div>

      {/* Coursework — a pick from the real pool, never free text. */}
      <div className="mb-4">
        <p className="text-faint mb-1 text-xs font-medium tracking-wide uppercase">
          Coursework ({coursework.length} of {COURSEWORK_SLOTS.min}–{COURSEWORK_SLOTS.max})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {coursePool.map((course) => {
            const on = coursework.includes(course);
            return (
              <button
                key={course}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCourse(course)}
                className={`press rounded-md border px-2 py-1 text-xs transition-colors ${
                  on
                    ? 'border-brand bg-brand/10'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface'
                }`}
              >
                {course}
              </button>
            );
          })}
        </div>
      </div>

      {/* Keyword homes — the decision this checkpoint exists for. */}
      <div className="mb-4">
        <p className="text-faint mb-1 text-xs font-medium tracking-wide uppercase">Keyword homes</p>
        <ul className="flex flex-col gap-1">
          {homes.map((home) => (
            <li key={home.keyword} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-40">{home.keyword}</span>
              <span className="text-faint">→</span>
              <select
                className="border-border bg-surface-2 rounded-md border px-2 py-1 text-xs"
                value={slotValue(home.slot)}
                onChange={(e) => setHome(home.keyword, e.target.value)}
              >
                {options.map((option) => (
                  <option key={slotValue(option)} value={slotValue(option)}>
                    {option.kind === 'none' ? 'not placed' : describeSlot(option)}
                  </option>
                ))}
              </select>
            </li>
          ))}
          {homes.length === 0 && <li className="text-muted text-sm">No keywords selected.</li>}
        </ul>
        {unplanned.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {unplanned.map((u) => u.keyword).join(', ')} — evidenced by your corpus but with nowhere
            to go. Give each one a home, or re-plan.
          </p>
        )}
      </div>

      {/* Skills rows — already filtered to what the master list can defend. */}
      <div className="mb-4">
        <p className="text-faint mb-1 text-xs font-medium tracking-wide uppercase">Skills rows</p>
        <ul className="text-muted flex flex-col gap-0.5 text-xs">
          {outline.skills.map((row) => (
            <li key={row.label}>
              <span className="text-foreground font-medium">{row.label}:</span>{' '}
              {row.items.join(', ')}
            </li>
          ))}
        </ul>
      </div>

      {note && <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">{note}</p>}

      {issues.length > 0 && (
        <details className="border-border text-muted mb-3 rounded-lg border px-3 py-2 text-xs">
          <summary className="cursor-pointer">Plan notes ({issues.length})</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
            {issues.map((issue) => (
              <li key={`${issue.rule}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="press bg-brand text-brand-contrast rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            onApprove({
              coursework,
              skills: outline.skills,
              placements: homes.map((h) => ({ keyword: h.keyword, slot: h.slot })),
            })
          }
        >
          {pending ? 'Writing the bullets…' : 'Approve & write bullets'}
        </button>
        <button
          type="button"
          className="press border-border rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          disabled={pending}
          onClick={onReplan}
        >
          Re-plan
        </button>
      </div>
    </div>
  );
}
