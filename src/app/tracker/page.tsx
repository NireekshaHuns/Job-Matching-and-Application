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
type FilingType = Application['filingType'];

const NUDGE_STYLE: Record<'urgent' | 'warning' | 'info', string> = {
  urgent: 'bg-red-50 text-red-800 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
};

/** Contacts + compliant deep-links for one company. */
function OutreachPanel({
  jobId,
  company,
  role,
  onLogged,
}: {
  jobId: number;
  company: string;
  role?: string;
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
  const [email, setEmail] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  // The currently-drafted outreach email (editable before the user sends/copies
  // it), tagged with the contact it targets so "Send" knows the recipient.
  const [draft, setDraft] = useState<{
    subject: string;
    body: string;
    source: 'llm' | 'template';
    contactId: number;
    contactEmail: string | null;
  } | null>(null);
  const [pendingContactId, setPendingContactId] = useState<number | null>(null);
  const draftEmail = trpc.outreach.draftEmail.useMutation({
    onSettled: () => setPendingContactId(null),
  });
  const sendEmail = trpc.outreach.sendEmail.useMutation({
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });
  const draftForContact = (c: {
    id: number;
    name: string;
    title: string | null;
    email: string | null;
  }) => {
    setPendingContactId(c.id);
    draftEmail.mutate(
      { company, role, contactName: c.name, contactTitle: c.title ?? undefined },
      { onSuccess: (d) => setDraft({ ...d, contactId: c.id, contactEmail: c.email }) },
    );
  };

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
            {c.email && <span className="text-zinc-500">{c.email}</span>}
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
                disabled={pendingContactId === c.id}
                onClick={() => draftForContact(c)}
                className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
              >
                {pendingContactId === c.id ? 'Drafting…' : 'Draft email'}
              </button>
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

      {draftEmail.isError && (
        <p className="text-sm text-red-600">Failed to draft email: {draftEmail.error.message}</p>
      )}

      {draft && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">
              Draft email{' '}
              {draft.source === 'template' ? '(template — set OPENAI_API_KEY for AI)' : '(AI)'}
            </span>
            <button
              type="button"
              aria-label="Close draft"
              onClick={() => setDraft(null)}
              className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-white"
            >
              ✕
            </button>
          </div>
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            aria-label="Email subject"
            className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            aria-label="Email body"
            rows={10}
            className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!draft.contactEmail || sendEmail.isPending}
              title={
                draft.contactEmail
                  ? `Send to ${draft.contactEmail}`
                  : 'Add an email to this contact to send'
              }
              onClick={() =>
                sendEmail.mutate({
                  contactId: draft.contactId,
                  subject: draft.subject,
                  body: draft.body,
                })
              }
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sendEmail.isPending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
              }
              className="rounded bg-zinc-900 px-3 py-1 text-xs text-white"
            >
              Copy
            </button>
            <a
              href={`mailto:${draft.contactEmail ?? ''}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
              className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-white"
            >
              Open in email
            </a>
            {!draft.contactEmail && (
              <span className="text-xs text-zinc-500">Add an email to this contact to send</span>
            )}
          </div>
          {sendEmail.isError && (
            <p className="text-sm text-red-600">Send failed: {sendEmail.error.message}</p>
          )}
          {sendEmail.isSuccess && <p className="text-sm text-green-700">Sent ✓</p>}
        </div>
      )}

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
              email: email.trim() || undefined,
              linkedinUrl: linkedinUrl.trim() || undefined,
            },
            {
              onSuccess: () => {
                setName('');
                setTitle('');
                setEmail('');
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
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (to send)"
          aria-label="Contact email"
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
        <select
          value={app.filingType}
          disabled={update.isPending}
          title="H-1B filing type (change-of-status vs. consular)"
          onChange={(e) => update.mutate({ id: app.id, filingType: e.target.value as FilingType })}
          className="rounded border border-zinc-300 px-1 py-1 text-sm disabled:opacity-50"
        >
          <option value="unknown">Filing: —</option>
          <option value="change_of_status">Change of status</option>
          <option value="consular">Consular</option>
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
        <OutreachPanel
          jobId={app.jobId}
          company={app.company}
          role={app.title}
          onLogged={onChanged}
        />
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

type VisaProfile = inferRouterOutputs<AppRouter>['profile']['get'];

/** Editable OPT/STEM-OPT dates + the derived time-sensitive nudges (spec §5.5). */
function VisaEditor({ data, onSaved }: { data: VisaProfile; onSaved: () => void }) {
  const [opt, setOpt] = useState(data.optEndDate ?? '');
  const [stem, setStem] = useState(data.stemOptEndDate ?? '');
  const save = trpc.profile.set.useMutation({ onSuccess: onSaved });

  return (
    <section className="mb-6 rounded-lg border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-700">Visa timeline</h2>
      {data.nudges.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {data.nudges.map((n) => (
            <li key={n.id} className={`rounded border px-2 py-1 text-xs ${NUDGE_STYLE[n.level]}`}>
              <span className="font-medium">{n.title}.</span> {n.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">No time-sensitive visa reminders right now.</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          OPT end date
          <input
            type="date"
            value={opt}
            onChange={(e) => setOpt(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          STEM-OPT end date
          <input
            type="date"
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ optEndDate: opt || null, stemOptEndDate: stem || null })}
          className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          Save dates
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Reminders are calendar-based (approximate) — not legal or lottery advice.
      </p>
    </section>
  );
}

function VisaTimelinePanel() {
  const utils = trpc.useUtils();
  const q = trpc.profile.get.useQuery();
  if (!q.data) return null;
  // Re-seed the editor from server data after a save via the key.
  return (
    <VisaEditor
      key={`${q.data.optEndDate ?? ''}:${q.data.stemOptEndDate ?? ''}`}
      data={q.data}
      onSaved={() => utils.profile.get.invalidate()}
    />
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

      <VisaTimelinePanel />

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
