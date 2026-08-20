'use client';

/**
 * What the tailoring run actually produced, next to the résumé itself: where
 * each JD keyword landed, and which claims to check before submitting.
 *
 * Both are read off the generated document rather than reported by the model,
 * so "covered" here means the word is genuinely in the text — see
 * `@/server/resume/coverage`.
 */
import type { DefencePoint, KeywordPlacement } from '@/server/resume/coverage';

const STATUS_STYLE: Record<KeywordPlacement['status'], string> = {
  in: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  weak: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  missing: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

const STATUS_LABEL: Record<KeywordPlacement['status'], string> = {
  in: 'in',
  weak: 'weak',
  missing: 'missing',
};

export function TailoringReport({
  coverage,
  defence,
}: {
  coverage: KeywordPlacement[];
  defence: DefencePoint[];
}) {
  if (coverage.length === 0 && defence.length === 0) return null;

  const counts = coverage.reduce<Record<string, number>>((acc, k) => {
    acc[k.status] = (acc[k.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {coverage.length > 0 && (
        <section className="border-border bg-surface rounded-xl border p-4">
          <h3 className="text-fg text-sm font-semibold">Keyword coverage</h3>
          <p className="text-faint mt-0.5 text-xs">
            {counts.in ?? 0} evidenced · {counts.weak ?? 0} listed only · {counts.missing ?? 0}{' '}
            missing. &ldquo;Weak&rdquo; means it appears in a skills list but nothing demonstrates
            it.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {coverage.map((k) => (
              <li key={k.keyword} className="flex items-center gap-2 text-sm">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[k.status]}`}
                >
                  {STATUS_LABEL[k.status]}
                </span>
                <span className="text-fg">{k.keyword}</span>
                {k.where.length > 0 && (
                  <span className="text-faint truncate text-xs">{k.where.join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {defence.length > 0 && (
        <section className="border-border bg-surface rounded-xl border p-4">
          <h3 className="text-fg text-sm font-semibold">Check before you send</h3>
          <p className="text-faint mt-0.5 text-xs">
            Claims worth confirming — a tool you may not want to defend, or a number only you can
            verify.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {defence.map((d, i) => (
              <li key={`${d.claim}-${i}`} className="text-sm">
                <span className="text-fg">{d.claim}</span>
                <span className="text-faint block text-xs">{d.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
