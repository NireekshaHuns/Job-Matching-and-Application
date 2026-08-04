'use client';

import type { inferRouterOutputs } from '@trpc/server';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import { categorizePerson, type ContactKind } from '@/lib/contacts';
import { groupByColumn } from '@/lib/kanban';
import { outreachLinks } from '@/lib/outreach-links';

/** People-finder result groups, in the order the user cares about. */
const PEOPLE_GROUPS: { key: ContactKind; label: string }[] = [
  { key: 'recruiter', label: 'Recruiters' },
  { key: 'manager', label: 'Hiring managers' },
  { key: 'other', label: 'Others' },
];
import type { NudgeLevel } from '@/lib/visa/nudges';
import type { AppRouter } from '@/server/trpc/root';
import { trpc } from '@/trpc/react';

const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
type Status = (typeof STATUSES)[number];

// Derived from the router so the row type can never drift from the query.
type Application = inferRouterOutputs<AppRouter>['applications']['list'][number];
type FilingType = Application['filingType'];

const NUDGE_STYLE: Record<NudgeLevel, string> = {
  urgent:
    'bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-300/50 dark:border-rose-500/25',
  warning:
    'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-300/50 dark:border-amber-500/25',
  info: 'bg-blue-500/10 text-blue-800 dark:text-blue-300 border-blue-300/50 dark:border-blue-500/25',
};

/**
 * People-finder (spec §5.6): infer emails via Apollo/Hunter and import a chosen
 * person as a contact. No-ops (with a hint) when no provider key is configured.
 * Only imported people persist — the search results are transient/cached.
 */
function FindPeople({
  jobId,
  company,
  onImported,
}: {
  jobId: number;
  company: string;
  onImported: () => void;
}) {
  const status = trpc.people.status.useQuery();
  const [domain, setDomain] = useState('');
  const find = trpc.people.find.useMutation();
  const importPerson = trpc.people.import.useMutation({ onSuccess: onImported });
  const purge = trpc.people.purgeCache.useMutation({
    onSuccess: () => find.reset(), // clear the shown results after a purge
  });
  const [imported, setImported] = useState<Set<string>>(new Set());

  // Wait until we know whether keys are configured (avoids flashing the search UI).
  if (!status.data) return null;
  if (!status.data.configured) {
    return (
      <p className="text-faint text-xs">
        Email inference is off — set <code>HUNTER_API_KEY</code> or <code>APOLLO_API_KEY</code> to
        find contacts automatically. (The compliant search links above always work.)
      </p>
    );
  }

  const people = find.data?.people ?? [];

  return (
    <div className="border-border rounded-lg border border-dashed p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted font-medium">Find people</span>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="company domain (optional, e.g. stripe.com)"
          aria-label="Company domain"
          className="border-border bg-surface min-w-56 flex-1 rounded border px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={find.isPending}
          onClick={() => find.mutate({ company, domain: domain.trim() || undefined })}
          className="border-border hover:bg-surface-2 rounded border px-2 py-1 text-xs disabled:opacity-50"
        >
          {find.isPending ? 'Searching…' : 'Search'}
        </button>
        {find.data?.cached && <span className="text-faint text-xs">cached</span>}
        <button
          type="button"
          onClick={() => purge.mutate()}
          disabled={purge.isPending}
          title="Delete all cached third-party results (privacy)"
          className="text-faint hover:text-muted text-xs hover:underline disabled:opacity-50"
        >
          Clear cache
        </button>
      </div>

      {find.isError && (
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
          Search failed: {find.error.message}
        </p>
      )}
      {find.isSuccess && people.length === 0 && (
        <p className="text-muted mt-1 text-xs">No people found for “{company}”.</p>
      )}

      {people.length > 0 &&
        PEOPLE_GROUPS.map(({ key, label }) => {
          // Up to ~5 per group so the user gets a focused set of managers + recruiters.
          const items = people.filter((p) => categorizePerson(p.title) === key).slice(0, 5);
          if (items.length === 0) return null;
          return (
            <div key={key} className="mt-2">
              <div className="text-muted text-[11px] font-medium tracking-wide uppercase">
                {label}
              </div>
              <ul className="space-y-1">
                {items.map((p, i) => {
                  const rowKey = `${key}:${i}:${p.email ?? p.name}`;
                  return (
                    <li key={rowKey} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-fg font-medium">{p.name}</span>
                      {p.title && <span className="text-muted">{p.title}</span>}
                      {p.email && <span className="text-muted">{p.email}</span>}
                      {p.emailConfidence != null && (
                        <span className="text-faint">{p.emailConfidence}%</span>
                      )}
                      <span className="text-faint">· {p.source}</span>
                      <button
                        type="button"
                        disabled={importPerson.isPending || imported.has(rowKey)}
                        onClick={() =>
                          importPerson.mutate(
                            {
                              jobId,
                              name: p.name,
                              title: p.title ?? undefined,
                              email: p.email ?? undefined,
                            },
                            { onSuccess: () => setImported((s) => new Set(s).add(rowKey)) },
                          )
                        }
                        className="border-border hover:bg-surface-2 ml-auto rounded border px-1.5 py-0.5 disabled:opacity-50"
                      >
                        {imported.has(rowKey) ? 'Added ✓' : 'Add as contact'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
    </div>
  );
}

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
      { company, role, contactName: c.name, contactTitle: c.title ?? undefined, jobId },
      { onSuccess: (d) => setDraft({ ...d, contactId: c.id, contactEmail: c.email }) },
    );
  };

  return (
    <div className="border-border mt-3 space-y-3 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {outreachLinks(company).map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border hover:bg-surface-2 rounded border px-2 py-1 text-xs"
          >
            {link.label} <span aria-hidden>↗</span>
          </a>
        ))}
      </div>

      <FindPeople jobId={jobId} company={company} onImported={invalidate} />

      <ul className="space-y-1">
        {contactsQuery.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.name}</span>
            {c.title && <span className="text-muted">{c.title}</span>}
            {c.email && <span className="text-muted">{c.email}</span>}
            {c.linkedinUrl && (
              <a
                href={c.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline dark:text-blue-300"
              >
                profile
              </a>
            )}
            <span className="text-faint text-xs">
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
                className="border-border hover:bg-surface-2 rounded border px-1.5 py-0.5 text-xs disabled:opacity-50"
              >
                {pendingContactId === c.id ? 'Drafting…' : 'Draft email'}
              </button>
              <button
                type="button"
                onClick={() => logTouch.mutate({ contactId: c.id, channel: 'linkedin' })}
                className="border-border hover:bg-surface-2 rounded border px-1.5 py-0.5 text-xs"
              >
                Log LinkedIn
              </button>
              <button
                type="button"
                onClick={() => logTouch.mutate({ contactId: c.id, channel: 'email' })}
                className="border-border hover:bg-surface-2 rounded border px-1.5 py-0.5 text-xs"
              >
                Log email
              </button>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => removeContact.mutate({ id: c.id })}
                className="rounded border border-rose-300/50 px-1.5 py-0.5 text-xs text-rose-700 hover:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-300"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>

      {draftEmail.isError && (
        <p className="text-sm text-rose-700 dark:text-rose-400">
          Failed to draft email: {draftEmail.error.message}
        </p>
      )}

      {draft && (
        <div className="border-border bg-surface-2 space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-muted text-xs font-medium">
              Draft email{' '}
              {draft.source === 'template' ? '(template — set OPENAI_API_KEY for AI)' : '(AI)'}
            </span>
            <button
              type="button"
              aria-label="Close draft"
              onClick={() => setDraft(null)}
              className="border-border hover:bg-surface-2 rounded border px-1.5 py-0.5 text-xs"
            >
              ✕
            </button>
          </div>
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            aria-label="Email subject"
            className="border-border bg-surface w-full rounded border px-2 py-1 text-sm"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            aria-label="Email body"
            rows={10}
            className="border-border bg-surface w-full rounded border px-2 py-1 font-mono text-xs"
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
              className="bg-brand rounded px-3 py-1 text-xs text-white"
            >
              Copy
            </button>
            <a
              href={`mailto:${draft.contactEmail ?? ''}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
              className="border-border hover:bg-surface-2 rounded border px-3 py-1 text-xs"
            >
              Open in email
            </a>
            {!draft.contactEmail && (
              <span className="text-muted text-xs">Add an email to this contact to send</span>
            )}
          </div>
          {sendEmail.isError && (
            <p className="text-sm text-rose-700 dark:text-rose-400">
              Send failed: {sendEmail.error.message}
            </p>
          )}
          {sendEmail.isSuccess && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Sent ✓</p>
          )}
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
          className="border-border bg-surface rounded border px-2 py-1 text-sm"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Contact title"
          className="border-border bg-surface rounded border px-2 py-1 text-sm"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (to send)"
          aria-label="Contact email"
          className="border-border bg-surface rounded border px-2 py-1 text-sm"
        />
        <input
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="LinkedIn URL"
          aria-label="Contact LinkedIn URL"
          className="border-border bg-surface min-w-48 flex-1 rounded border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={addContact.isPending}
          className="bg-brand rounded px-3 py-1 text-xs text-white disabled:opacity-50"
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
    <li className="border-border bg-surface rounded-lg border p-4">
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
          <div className="text-muted text-sm">
            {app.company} · applied {new Date(app.appliedAt).toLocaleDateString()}
            {app.confirmedAt && (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                · ✉ confirmed {new Date(app.confirmedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <select
          value={app.status}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ id: app.id, status: e.target.value as Status })}
          className="border-border bg-surface rounded border px-1 py-1 text-sm disabled:opacity-50"
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
          className="border-border bg-surface rounded border px-1 py-1 text-sm disabled:opacity-50"
        >
          <option value="unknown">Filing: —</option>
          <option value="change_of_status">Change of status</option>
          <option value="consular">Consular</option>
        </select>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="border-border hover:bg-surface-2 rounded border px-2 py-1 text-xs"
        >
          {open ? 'Hide resume' : 'Resume used'}
        </button>
        <button
          type="button"
          onClick={() => setOutreachOpen((o) => !o)}
          className="border-border hover:bg-surface-2 rounded border px-2 py-1 text-xs"
        >
          {outreachOpen ? 'Hide outreach' : 'Outreach'}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate({ id: app.id })}
          className="rounded border border-rose-300/50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-300"
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
        <div className="border-border mt-3 space-y-2 border-t pt-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Resume label (e.g. Backend — Stripe)"
            className="border-border bg-surface w-full rounded border px-2 py-1 text-sm"
          />
          <textarea
            value={snapshot}
            onChange={(e) => setSnapshot(e.target.value)}
            placeholder="Paste the exact resume text you used for this application…"
            rows={10}
            className="border-border bg-surface w-full rounded border px-2 py-1 font-mono text-xs"
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
            className="bg-brand rounded px-3 py-1 text-xs text-white disabled:opacity-50"
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
    <section className="border-border bg-surface mb-6 rounded-lg border p-4">
      <h2 className="text-muted text-sm font-semibold">Visa timeline</h2>
      {data.nudges.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {data.nudges.map((n) => (
            <li key={n.id} className={`rounded border px-2 py-1 text-xs ${NUDGE_STYLE[n.level]}`}>
              <span className="font-medium">{n.title}.</span> {n.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted mt-2 text-xs">No time-sensitive visa reminders right now.</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          OPT end date
          <input
            type="date"
            value={opt}
            onChange={(e) => setOpt(e.target.value)}
            className="border-border bg-surface rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          STEM-OPT end date
          <input
            type="date"
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            className="border-border bg-surface rounded border px-2 py-1"
          />
        </label>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ optEndDate: opt || null, stemOptEndDate: stem || null })}
          className="bg-brand rounded px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          Save dates
        </button>
      </div>
      <p className="text-faint mt-2 text-[11px]">
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
      <PageHeader
        eyebrow="Pipeline"
        title="Application Tracker"
        subtitle="Every application, its status, and the résumé version you used."
        actions={
          <span className="border-border bg-surface-2 text-muted rounded-full border px-3 py-1 text-sm">
            Outreach today:{' '}
            <span className="text-fg font-display font-semibold tabular-nums">
              {todayQuery.data ?? 0}
            </span>
          </span>
        }
      />

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
          <Link href="/jobs" className="text-blue-700 hover:underline dark:text-blue-300">
            job board
          </Link>
          .
        </EmptyState>
      )}

      {query.data && query.data.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {groupByColumn(query.data).map((col) => (
            <section key={col.key} aria-labelledby={`col-${col.key}`} className="w-80 shrink-0">
              <h2
                id={`col-${col.key}`}
                className="text-muted mb-2 flex items-center gap-2 text-sm font-semibold"
              >
                {col.label}
                <span
                  aria-hidden
                  className="bg-surface-2 text-muted rounded-full px-2 py-0.5 text-xs"
                >
                  {col.apps.length}
                </span>
              </h2>
              <ul className="space-y-3">
                {col.apps.map((app) => (
                  <ApplicationRow
                    key={`${app.id}:${app.resumeLabel ?? ''}:${app.resumeSnapshot ?? ''}`}
                    app={app}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
              {col.apps.length === 0 && (
                <p className="border-border text-faint rounded-lg border border-dashed p-4 text-center text-xs">
                  Nothing here yet
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
