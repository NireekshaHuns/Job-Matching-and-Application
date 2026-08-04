'use client';

import { trpc } from '@/trpc/react';

/**
 * Read-only tailoring assist (spec §5.7): the keyword-gap for the selected
 * résumé lens, plus the user's REAL bullets to weave in for each addable JD
 * keyword. Suggestions only — never fabricates a skill.
 */
export function TailoringPanel({
  jobId,
  resumeId,
  lensLabel,
}: {
  jobId: number;
  resumeId?: number;
  lensLabel?: string;
}) {
  const enabled = resumeId != null;
  const query = trpc.resumes.tailoringSuggestions.useQuery(
    { jobId, resumeId: resumeId ?? 0 },
    { enabled },
  );

  if (!enabled) {
    return (
      <div className="border-border text-muted mt-2 rounded border border-dashed p-2 text-xs">
        Select a résumé lens (top of the board) to see tailoring suggestions.
      </div>
    );
  }
  if (query.isLoading) {
    return <div className="text-faint mt-2 text-xs">Analyzing fit…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">
        Couldn’t load suggestions{query.error ? `: ${query.error.message}` : ''}.
      </div>
    );
  }

  const s = query.data;
  return (
    <div className="border-border bg-surface-2 mt-2 space-y-2 rounded border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted font-medium">
          Tailoring{lensLabel ? ` · ${lensLabel}` : ''}
        </span>
        <span className="text-muted">
          Fit <span className="text-fg font-medium">{s.relevanceScore}%</span> → achievable{' '}
          <span className="text-fg font-medium">{s.achievableScore}%</span> after truthful tailoring
        </span>
      </div>

      {s.addable.length > 0 ? (
        <div>
          <div className="text-muted mb-1 font-medium">
            Add these — you already have them (weave in your real bullets):
          </div>
          <ul className="space-y-1.5">
            {s.addable.map((a) => (
              <li key={a.keyword}>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {a.keyword}
                </span>
                {a.bullets.length > 0 ? (
                  <ul className="text-muted mt-1 ml-3 list-disc space-y-0.5">
                    {a.bullets.map((b) => (
                      <li key={b.id}>
                        {b.text}
                        {b.company ? <span className="text-faint"> — {b.company}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-faint ml-2">
                    (in your inventory, but no bullet demonstrates it yet — add one)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-muted">Nothing truthful left to add for this lens.</div>
      )}

      {s.gaps.length > 0 && (
        <div className="text-muted">
          <span className="text-muted font-medium">Honest gaps</span> (not in your inventory — don’t
          fake): {s.gaps.join(', ')}
        </div>
      )}
    </div>
  );
}
