'use client';

import type { inferRouterOutputs } from '@trpc/server';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import { outreachLinks } from '@/lib/outreach-links';
import type { AppRouter } from '@/server/trpc/root';
import { trpc } from '@/trpc/react';

const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
type Status = (typeof STATUSES)[number];

// Derived from the router so the row type can never drift from the query.
type Application = inferRouterOutputs<AppRouter>['applications']['list'][number];

/** Contacts + compliant deep-links for one company. */
function OutreachPanel({
  jobId,
  company,
  onLogged,
}: {
  jobId: number;
  company: string;
  onLogged: () => void;
}) {
  const utils = trpc.useUtils();
  const contactsQuery = trpc.outreach.contactsByJob.useQuery({ jobId });
  const invalidate = () => {
    utils.outreach.contactsByJob.invalidate({ jobId });
    onLogged();
  };
  const addContact = trpc.outreach.addContact.useMutation({ onSuccess: invalidate });
  const removeContact = trpc.outreach.removeContact.useMutation({ onSuccess: invalidate });
  const logTouch = trpc.outreach.logTouch.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  return (
    <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
      <div className="flex flex-wrap gap-2">
        {outreachLinks(company).map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
          >
            {link.label} <span aria-hidden>↗</span>
          </a>
        ))}
      </div>

      <ul className="space-y-1">
        {contactsQuery.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.name}</span>
            {c.title && <span className="text-zinc-500">{c.title}</span>}
            {c.linkedinUrl && (
              <a
                href={c.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline"
              >
                profile
              </a>
            )}
            <span className="text-xs text-zinc-400">
              {c.touches} touch{c.touches === 1 ? '' : 'es'}
              {c.lastContactedAt
                ? ` · last ${new Date(c.lastContactedAt).toLocaleDateString()}`
                : ''}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => logTouch.mutate({ contactId: c.id, channel: 'linkedin' })}
                className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-50"
              >
                Log LinkedIn
              </button>
              <button
                type="button"
                onClick={() => logTouch.mutate({ contactId: c.id, channel: 'email' })}
                className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-50"
              >
                Log email
              </button>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => removeContact.mutate({ id: c.id })}
                className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          addContact.mutate(
            {
              jobId,
              name: name.trim(),
              title: title.trim() || undefined,
              linkedinUrl: linkedinUrl.trim() || undefined,
            },
            {
              onSuccess: () => {
                setName('');
                setTitle('');
                setLinkedinUrl('');
              },
            },
          );
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Contact name"
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Contact title"
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <input
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="LinkedIn URL"
          aria-label="Contact LinkedIn URL"
          className="min-w-48 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={addContact.isPending}
          className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          Add contact
        </button>
      </form>
    </div>
  );
}

function ApplicationRow({ app, onChanged }: { app: Application; onChanged: () => void }) {
  // Local editor state; the parent remounts this row (via key) when the server
  // row changes, so these re-seed from the fresh prop without a resync effect.
  const [open, setOpen] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
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
            {app.confirmedAt && (
              <span className="ml-1 text-green-700">
                · ✉ confirmed {new Date(app.confirmedAt).toLocaleDateString()}
              </span>
            )}
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
          onClick={() => setOutreachOpen((o) => !o)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
        >
          {outreachOpen ? 'Hide outreach' : 'Outreach'}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate({ id: app.id })}
          className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          Remove
        </button>
      </div>

      {outreachOpen && (
        <OutreachPanel jobId={app.jobId} company={app.company} onLogged={onChanged} />
      )}

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
  // Client-local midnight so "today" resets at the user's midnight, not UTC.
  const [sinceMs] = useState(() => new Date().setHours(0, 0, 0, 0));
  const todayQuery = trpc.outreach.todayCount.useQuery({ sinceMs });
  const onChanged = () => {
    utils.applications.list.invalidate();
    utils.outreach.todayCount.invalidate();
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Application Tracker</h1>
          <p className="text-sm text-zinc-500">
            Every application, its status, and the resume version you used.
          </p>
        </div>
        <span className="text-sm text-zinc-500">
          Outreach today: <span className="font-medium text-zinc-900">{todayQuery.data ?? 0}</span>
        </span>
      </header>

      {query.isLoading && <LoadingSkeleton />}
      {query.isError && (
        <ErrorState
          message={`Failed to load applications: ${query.error.message}`}
          onRetry={() => query.refetch()}
        />
      )}
      {query.data?.length === 0 && (
        <EmptyState title="No applications yet.">
          Mark a job applied from the{' '}
          <Link href="/jobs" className="text-blue-700 hover:underline">
            job board
          </Link>
          .
        </EmptyState>
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
