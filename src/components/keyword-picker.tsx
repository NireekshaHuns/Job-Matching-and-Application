'use client';

/**
 * JD keyword tick UI. Shows extracted technical + soft keywords as toggle chips;
 * keywords already covered by the corpus are marked, and gaps (not in any
 * uploaded résumé) get an amber ring so the user knows what they're choosing to
 * claim. Selection state is owned by the parent.
 */

export interface KeywordFlag {
  keyword: string;
  inCorpus: boolean;
}

export interface KeywordGroup {
  label: string;
  items: KeywordFlag[];
}

export function KeywordPicker({
  groups,
  selected,
  onToggle,
}: {
  groups: KeywordGroup[];
  selected: Set<string>;
  onToggle: (keyword: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-xs">
        Tick the keywords to work into the résumé. <span className="text-fg">Solid</span> = already
        in your corpus;{' '}
        <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
          amber
        </span>{' '}
        = a gap you don&rsquo;t have yet (you&rsquo;ll want to be ready to speak to these).
      </p>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
            {group.label}
          </div>
          {group.items.length === 0 ? (
            <span className="text-faint text-sm">None found.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const on = selected.has(item.keyword);
                const gap = !item.inCorpus;
                const base = 'rounded-full border px-2.5 py-1 text-xs transition-colors';
                const cls = on
                  ? 'border-brand bg-brand text-white'
                  : gap
                    ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface';
                return (
                  <button
                    key={item.keyword}
                    type="button"
                    aria-pressed={on}
                    className={`${base} ${cls}`}
                    onClick={() => onToggle(item.keyword)}
                  >
                    {on ? '✓ ' : gap ? '+ ' : ''}
                    {item.keyword}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
