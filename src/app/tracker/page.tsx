'use client';

import type { inferRouterOutputs } from '@trpc/server';
import { useState } from 'react';
import type { AppRouter } from '@/server/trpc/root';
import { trpc } from '@/trpc/react';

const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
type Status = (typeof STATUSES)[number];

// Derived from the router so the row type can never drift from the query.
type Application = inferRouterOutputs<AppRouter>['applications']['list'][number];

function ApplicationRow({ app, onChanged }: { app: Application; onChanged: () => void }) {
  // Local editor state; the parent remounts this row (via key) when the server
  // row changes, so these re-seed from the fresh prop without a resync effect.
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(app.resumeLabel ?? '');
  const [snapshot, setSnapshot] = useState(app.resumeSnapshot ?? '');

  const update = trpc.applications.update.useMutation({ onSuccess: onChanged });
  const remove = trpc.applications.remove.useMutation({ onSuccess: onChanged });

  return (
    <li className="rounded-lg border border-zinc-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:underline"
          >
            {app.title}
          </a>
          <div className="text-sm text-zinc-600">
            {app.company} · applied {new Date(app.appliedAt).toLocaleDateString()}
            {app.source === 'outlook' ? ' · ✉ confirmed' : ''}
          </div>
        </div>
        <select
          value={app.status}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ id: app.id, status: e.target.value as Status })}
          className="rounded border border-zinc-300 px-1 py-1 text-sm disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
        >
          {open ? 'Hide resume' : 'Resume used'}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate({ id: app.id })}
          className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          Remove
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Resume label (e.g. Backend — Stripe)"
            className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <textarea
            value={snapshot}
            onChange={(e) => setSnapshot(e.target.value)}
            placeholder="Paste the exact resume text you used for this application…"
            rows={10}
            className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() =>
              update.mutate({
                id: app.id,
                resumeLabel: label || null,
                resumeSnapshot: snapshot || null,
              })
            }
            disabled={update.isPending}
            className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Save resume version
          </button>
        </div>
      )}
    </li>
  );
}

export default function Tracker() {
  const utils = trpc.useUtils();
  const query = trpc.applications.list.useQuery();
  const onChanged = () => utils.applications.list.invalidate();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Application Tracker</h1>
        <p className="text-sm text-zinc-500">
          Every application, its status, and the resume version you used.
        </p>
      </header>

      {query.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {query.data?.length === 0 && (
        <p className="text-sm text-zinc-500">
          No applications yet. Mark a job applied from the board.
        </p>
      )}

      <ul className="space-y-3">
        {query.data?.map((app) => (
          <ApplicationRow
            key={`${app.id}:${app.resumeLabel ?? ''}:${app.resumeSnapshot ?? ''}`}
            app={app}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </main>
  );
}
