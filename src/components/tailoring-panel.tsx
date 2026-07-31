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
      <div className="mt-2 rounded border border-dashed border-zinc-200 p-2 text-xs text-zinc-500">
        Select a résumé lens (top of the board) to see tailoring suggestions.
      </div>
    );
  }
  if (query.isLoading) {
    return <div className="mt-2 text-xs text-zinc-400">Analyzing fit…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="mt-2 text-xs text-red-600">
        Couldn’t load suggestions{query.error ? `: ${query.error.message}` : ''}.
      </div>
    );
  }

  const s = query.data;
  return (
    <div className="mt-2 space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-zinc-700">
          Tailoring{lensLabel ? ` · ${lensLabel}` : ''}
        </span>
        <span className="text-zinc-500">
          Fit <span className="font-medium text-zinc-800">{s.relevanceScore}%</span> → achievable{' '}
          <span className="font-medium text-zinc-800">{s.achievableScore}%</span> after truthful
          tailoring
        </span>
      </div>

      {s.addable.length > 0 ? (
        <div>
          <div className="mb-1 font-medium text-zinc-600">
            Add these — you already have them (weave in your real bullets):
          </div>
          <ul className="space-y-1.5">
            {s.addable.map((a) => (
              <li key={a.keyword}>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                  {a.keyword}
                </span>
                {a.bullets.length > 0 ? (
                  <ul className="mt-1 ml-3 list-disc space-y-0.5 text-zinc-600">
                    {a.bullets.map((b) => (
                      <li key={b.id}>
                        {b.text}
                        {b.company ? <span className="text-zinc-400"> — {b.company}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="ml-2 text-zinc-400">
                    (in your inventory, but no bullet demonstrates it yet — add one)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-zinc-500">Nothing truthful left to add for this lens.</div>
      )}

      {s.gaps.length > 0 && (
        <div className="text-zinc-500">
          <span className="font-medium text-zinc-600">Honest gaps</span> (not in your inventory —
          don’t fake): {s.gaps.join(', ')}
        </div>
      )}
    </div>
  );
}
