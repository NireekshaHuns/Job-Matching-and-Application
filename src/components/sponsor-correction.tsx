'use client';

import { useState } from 'react';
import { trpc } from '@/trpc/react';

/**
 * Inline entity-resolution correction (spec §5.3). Search USCIS employers and
 * either map this company to one or confirm "no match". Never silently asserts a
 * mapping — the user decides. On success the job board is invalidated so the
 * badge updates immediately.
 */
export function SponsorCorrection({ company, onDone }: { company: string; onDone: () => void }) {
  const [query, setQuery] = useState(company);
  const utils = trpc.useUtils();

  const trimmed = query.trim();
  const searchQuery = trpc.sponsors.search.useQuery(
    { query: trimmed },
    { enabled: trimmed.length > 0 },
  );
  const confirm = trpc.sponsors.confirmAlias.useMutation({
    onSuccess: async () => {
      await utils.jobs.list.invalidate();
      onDone();
    },
  });

  return (
    <div className="border-border bg-surface-2 mt-2 rounded border p-2 text-xs">
      <div className="text-muted mb-1 font-medium">
        Correct the USCIS employer match for “{company}”
      </div>
      <input
        type="search"
        aria-label="Search USCIS employers"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search USCIS employers…"
        className="border-border w-full rounded border px-2 py-1"
      />

      <ul className="divide-border mt-1 max-h-40 divide-y overflow-auto">
        {searchQuery.data?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => confirm.mutate({ company, sponsorId: s.id })}
              disabled={confirm.isPending}
              className="hover:bg-surface-2 flex w-full items-center justify-between gap-2 px-1 py-1 text-left disabled:opacity-50"
            >
              <span className="text-fg font-medium">{s.name}</span>
              <span className="text-faint shrink-0">{s.newEmploymentApprovals} new-hire appr.</span>
            </button>
          </li>
        ))}
        {searchQuery.data?.length === 0 && (
          <li className="text-faint px-1 py-1">No USCIS employers match “{trimmed}”.</li>
        )}
      </ul>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => confirm.mutate({ company, sponsorId: null })}
          disabled={confirm.isPending}
          className="border-border hover:bg-surface-2 rounded border px-2 py-0.5 disabled:opacity-50"
        >
          Confirm “no match”
        </button>
        <button type="button" onClick={onDone} className="text-muted hover:underline">
          Cancel
        </button>
        {confirm.isError && (
          <span className="text-rose-600 dark:text-rose-400">{confirm.error.message}</span>
        )}
      </div>
    </div>
  );
}
