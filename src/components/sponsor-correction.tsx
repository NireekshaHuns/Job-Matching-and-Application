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
    <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
      <div className="mb-1 font-medium text-zinc-700">
        Correct the USCIS employer match for “{company}”
      </div>
      <input
        type="search"
        aria-label="Search USCIS employers"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search USCIS employers…"
        className="w-full rounded border border-zinc-300 px-2 py-1"
      />

      <ul className="mt-1 max-h-40 divide-y divide-zinc-200 overflow-auto">
        {searchQuery.data?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => confirm.mutate({ company, sponsorId: s.id })}
              disabled={confirm.isPending}
              className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left hover:bg-zinc-100 disabled:opacity-50"
            >
              <span className="font-medium text-zinc-800">{s.name}</span>
              <span className="shrink-0 text-zinc-400">
                {s.newEmploymentApprovals} new-hire appr.
              </span>
            </button>
          </li>
        ))}
        {searchQuery.data?.length === 0 && (
          <li className="px-1 py-1 text-zinc-400">No USCIS employers match “{trimmed}”.</li>
        )}
      </ul>

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => confirm.mutate({ company, sponsorId: null })}
          disabled={confirm.isPending}
          className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50"
        >
          Confirm “no match”
        </button>
        <button type="button" onClick={onDone} className="text-zinc-500 hover:underline">
          Cancel
        </button>
        {confirm.isError && <span className="text-red-600">{confirm.error.message}</span>}
      </div>
    </div>
  );
}
