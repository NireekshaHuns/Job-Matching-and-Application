'use client';

/**
 * Job Board — a left filter rail + a card grid. Two independent scores per card
 * (H1B sponsor tier + the recommended priority), best-effort salary, and per-card
 * Apply / Remove. "Find new jobs" fires the enrichment pipeline; Remove hides a
 * job for good; the board defaults to US, full-time, non-excluded, any age.
 *
 * Filter state lives in `@/lib/board-filters` and is persisted, so a reload
 * keeps whatever was picked instead of snapping back to a default that hides
 * most of the board.
 */
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useState, useSyncExternalStore } from 'react';
import { ApplyDialog } from '@/components/apply-dialog';
import { Chip } from '@/components/chip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import {
  NEW_HIRE_DISCLAIMER,
  NEW_HIRE_LABELS,
  NEW_HIRE_MEANINGS,
  NEW_HIRE_STYLES,
  TIER_STYLES,
} from '@/components/tier';
import {
  getFiltersSnapshot,
  getServerFiltersSnapshot,
  subscribeFilters,
  writeFilters,
  type BoardFilters,
  type MinSalary,
  type Sort,
  type Within,
} from '@/lib/board-filters';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/relative-time';
import { trpc } from '@/trpc/react';

const WITHIN_OPTIONS: { value: Within; label: string }[] = [
  { value: 1, label: 'Past 24 hours' },
  { value: 3, label: 'Past 3 days' },
  { value: 7, label: 'Past week' },
  { value: 0, label: 'Any time' },
];

/**
 * "Any" first and default. A posting that states no pay always passes this
 * filter, so these thresholds only ever hide jobs that named a ceiling below
 * the bar.
 */
const MIN_SALARY_OPTIONS: { value: MinSalary; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 80_000, label: '$80k+' },
  { value: 100_000, label: '$100k+' },
  { value: 120_000, label: '$120k+' },
  { value: 150_000, label: '$150k+' },
];

/** How often to re-check the pipeline while waiting for a refresh to land. */
const WATCH_POLL_MS = 10_000;
/** Give up waiting after this long and say so, rather than spinning forever. */
const WATCH_MS = 5 * 60_000;

const inputCls =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-brand focus:outline-none';

export default function JobsPage() {
  // Free-text search stays transient — it's a lookup, not a standing preference.
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [applyFor, setApplyFor] = useState<{ id: number; company: string; title: string } | null>(
    null,
  );

  /**
   * Persisted rail state. Backed by localStorage through `useSyncExternalStore`
   * so the server renders the defaults and the client swaps in what was saved,
   * with no hydration mismatch.
   */
  const filters = useSyncExternalStore(
    subscribeFilters,
    getFiltersSnapshot,
    getServerFiltersSnapshot,
  );
  const { sort, within, minSalary, remoteOnly, includeSenior, includeExcluded, includeClosed } =
    filters;

  // Spread the STORE's snapshot, not the rendered `filters`. Two calls without
  // an intervening commit (a preset, a reset button, a transition) would
  // otherwise rebuild from the pre-first-write object and drop the first change.
  const setFilter = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) =>
    writeFilters({ ...getFiltersSnapshot(), [key]: value });

  const router = useRouter();
  const deferredSearch = useDeferredValue(search);
  const deferredLocation = useDeferredValue(location);
  const utils = trpc.useUtils();
  const kickoff = trpc.people.kickoffForJob.useMutation();
  const appliedQuery = trpc.applications.appliedJobIds.useQuery();
  const applied = new Set(appliedQuery.data ?? []);

  const markApplied = trpc.applications.create.useMutation({
    onMutate: async (vars) => {
      await utils.applications.appliedJobIds.cancel();
      const prev = utils.applications.appliedJobIds.getData();
      utils.applications.appliedJobIds.setData(undefined, (old) => [...(old ?? []), vars.jobId]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.applications.appliedJobIds.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.applications.appliedJobIds.invalidate(),
  });

  const dismiss = trpc.jobs.dismiss.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });
  /**
   * Watching the pipeline after a refresh. Firing the event only proves Inngest
   * accepted it — not that any app is subscribed — so the honest signal is
   * `lastSeenAt` moving past the moment we asked. Everything below is derived
   * from that one timestamp rather than held in state.
   */
  const [requestedAt, setRequestedAt] = useState<Date | null>(null);
  const refresh = trpc.jobs.refresh.useMutation({
    onSuccess: (data) => setRequestedAt(new Date(data.requestedAt)),
    onError: () => setRequestedAt(null),
  });

  const status = trpc.jobs.pipelineStatus.useQuery(
    { since: requestedAt ?? undefined },
    {
      // Decided from the query's own data so polling stops the moment a run
      // lands, without needing the derived flags below (which depend on it).
      refetchInterval: (query) => {
        if (!requestedAt) return false;
        const raw = query.state.data?.lastSeenAt;
        const seen = raw ? new Date(raw) : null;
        if (seen && seen > requestedAt) return false;
        if (Date.now() - requestedAt.getTime() > WATCH_MS) return false;
        return WATCH_POLL_MS;
      },
    },
  );

  const lastSeen = status.data?.lastSeenAt ? new Date(status.data.lastSeenAt) : null;
  const landed = requestedAt != null && lastSeen != null && lastSeen > requestedAt;
  // `dataUpdatedAt` (when we last checked) is the clock here rather than
  // Date.now(), which would be an impure read during render. It advances on
  // every poll, so the deadline is still noticed within one interval.
  const gaveUp =
    requestedAt != null && !landed && status.dataUpdatedAt - requestedAt.getTime() > WATCH_MS;
  const watching = requestedAt != null && !landed && !gaveUp;

  // The one genuine side effect: show the newly-ingested jobs once a run lands.
  useEffect(() => {
    if (landed) void utils.jobs.list.invalidate();
  }, [landed, utils]);

  // "Landed" means the first run finished its reconcile — NOT that every new
  // posting is in. A large delta drains across continuation runs, so the copy
  // says results are arriving rather than claiming the board is complete.
  //
  // Report the actual insert count. A run that finds nothing new is a normal
  // outcome, and claiming "new jobs are landing" when zero arrived is what made
  // a working button look broken.
  const newCount = status.data?.newSince ?? 0;
  const landedMsg =
    newCount > 0
      ? `${newCount} new job${newCount === 1 ? '' : 's'} added — more may still be arriving.`
      : 'Checked every source — nothing new since your last refresh.';

  const refreshMsg = refresh.isError
    ? `Couldn’t start a refresh: ${refresh.error.message}`
    : landed
      ? landedMsg
      : gaveUp
        ? 'The run was queued but nothing has ingested yet. If this keeps happening, check that the app is registered in Inngest Cloud.'
        : watching
          ? 'Looking for new jobs…'
          : null;

  // Not gated on the store having hydrated. Anyone with saved filters pays one
  // extra `list` fetch on mount (defaults, then the stored key) and sees the
  // rail flip a frame after hydration. Gating would mean tracking "have we
  // hydrated" in state — a setState-in-effect — to save one cached round trip.
  const jobsQuery = trpc.jobs.list.useQuery({
    search: deferredSearch || undefined,
    location: deferredLocation || undefined,
    sort,
    postedWithinDays: within || undefined,
    minSalaryUsd: minSalary,
    remoteOnly,
    includeSenior,
    includeExcluded,
    includeClosed,
  });

  const jobs = jobsQuery.data ?? [];
  const loading = jobsQuery.isLoading;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow="Sponsorship-scored"
        title="Job Board"
        subtitle="Every card carries an H-1B possibility tier and a recommended priority — US, full-time, direct-hire."
        actions={
          <button
            type="button"
            className="press bg-brand text-brand-contrast rounded-lg px-4 py-2 text-sm font-semibold shadow-[0_8px_24px_-8px_var(--color-brand)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? 'Starting…' : '⟳ Find new jobs'}
          </button>
        }
      />

      {refreshMsg && (
        <div className="border-brand/30 bg-brand/8 text-brand-text animate-rise mb-4 rounded-lg border px-3 py-2 text-sm">
          {refreshMsg}
        </div>
      )}

      {/* Top toolbar: search + location + sort */}
      <div className="border-border bg-surface mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <input
          type="search"
          aria-label="Search company or title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or title…"
          className={`${inputCls} min-w-56 flex-1`}
        />
        <input
          type="search"
          aria-label="Filter by location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (e.g. MA, Boston)…"
          className={`${inputCls} min-w-44`}
        />
        <label className="text-muted flex items-center gap-1.5 text-sm">
          Sort
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setFilter('sort', e.target.value as Sort)}
            className={inputCls}
          >
            <option value="combined">Recommended</option>
            <option value="fit">Most fit</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Left filter rail */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-border bg-surface flex flex-col gap-5 rounded-xl border p-4">
            <div>
              <div className="text-faint mb-2 text-xs font-medium tracking-wide uppercase">
                Date posted
              </div>
              <div className="flex flex-col gap-1.5">
                {WITHIN_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="within"
                      checked={within === o.value}
                      onChange={() => setFilter('within', o.value)}
                      className="accent-brand"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="border-border border-t pt-4">
              <div className="text-faint mb-2 text-xs font-medium tracking-wide uppercase">
                Min pay
              </div>
              <select
                aria-label="Minimum pay"
                value={minSalary}
                onChange={(e) => setFilter('minSalary', Number(e.target.value) as MinSalary)}
                className={`${inputCls} w-full`}
              >
                {MIN_SALARY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-faint mt-1.5 text-xs">
                Jobs that don&rsquo;t state pay are still shown.
              </p>
            </div>

            <div className="border-border border-t pt-4">
              <div className="text-faint mb-2 text-xs font-medium tracking-wide uppercase">
                Show
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <Toggle
                  label="Remote only"
                  checked={remoteOnly}
                  onChange={(v) => setFilter('remoteOnly', v)}
                />
                <Toggle
                  label="Include senior"
                  checked={includeSenior}
                  onChange={(v) => setFilter('includeSenior', v)}
                />
                <Toggle
                  label="Show excluded"
                  checked={includeExcluded}
                  onChange={(v) => setFilter('includeExcluded', v)}
                />
                <Toggle
                  label="Show closed"
                  checked={includeClosed}
                  onChange={(v) => setFilter('includeClosed', v)}
                />
              </div>
            </div>

            {!loading && (
              <div className="text-faint border-border border-t pt-4 text-xs">
                {jobs.length} job{jobs.length === 1 ? '' : 's'} shown
              </div>
            )}
          </div>
        </aside>

        {/* Card grid */}
        <section>
          {loading && <LoadingSkeleton rows={6} />}
          {jobsQuery.isError && (
            <ErrorState
              message={`Failed to load jobs: ${jobsQuery.error.message}`}
              onRetry={() => jobsQuery.refetch()}
            />
          )}
          {!loading && jobs.length === 0 && (
            <EmptyState title="No jobs match your filters yet.">
              Widen the date range or clear a filter — or hit <strong>Find new jobs</strong> to
              fetch fresh postings.
            </EmptyState>
          )}

          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {jobs.map((job) => {
              const openApply = () => {
                markApplied.reset();
                window.open(job.url, '_blank', 'noopener,noreferrer');
                setApplyFor({ id: job.id, company: job.company, title: job.title });
              };
              // Some feeds (older Ashby rows) never gave a post date. Showing
              // when we first saw it beats "date n/a" — it is the same evidence
              // the age filter uses, so the card agrees with the filter.
              const posted = formatRelativeTime(job.postedAt);
              const firstSeen = formatRelativeTime(job.firstSeenAt);
              const seen = firstSeen ? `seen ${firstSeen}` : null;
              return (
                <li
                  key={job.id}
                  className="group border-border bg-surface lift relative flex flex-col gap-3 rounded-xl border p-4"
                >
                  <button
                    type="button"
                    aria-label="Remove from board"
                    title="Remove from board — it won’t come back"
                    className="text-faint hover:bg-surface-2 absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-500"
                    onClick={() => dismiss.mutate({ id: job.id })}
                  >
                    ✕
                  </button>

                  {/* Clickable body → opens the posting + the did-you-apply prompt */}
                  <button type="button" onClick={openApply} className="min-w-0 text-left">
                    <div className="mb-2 flex items-center justify-between gap-2 pr-6">
                      <span
                        className="text-faint font-mono text-[11px]"
                        title={
                          formatAbsoluteTime(job.postedAt ?? job.firstSeenAt) ??
                          (posted ? undefined : 'This source did not publish a posting date.')
                        }
                      >
                        {posted ?? seen ?? 'date n/a'}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_STYLES[job.sponsorTier]}`}
                        title={job.sponsorReason ?? undefined}
                      >
                        H-1B {job.sponsorTier}
                      </span>
                    </div>
                    <div className="text-muted truncate text-xs">{job.company}</div>
                    <h3 className="text-fg font-display mt-0.5 line-clamp-2 text-base font-semibold tracking-tight group-hover:underline">
                      {job.title}
                    </h3>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="bg-brand/10 text-brand-text rounded px-1.5 py-0.5 text-[11px] font-medium"
                      title={`Sponsorship ${job.priorityTier} · fit ${job.priorityFit} · freshness ${job.priorityFreshness}`}
                    >
                      ★ {job.priorityScore}
                    </span>
                    {job.roleFamily && <Chip>{job.roleFamily}</Chip>}
                    {job.seniority && <Chip>{job.seniority}</Chip>}
                    {job.isRemote && <Chip muted>remote</Chip>}
                    {job.status === 'closed' && (
                      <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                        closed
                      </span>
                    )}
                  </div>

                  <span
                    className={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${NEW_HIRE_STYLES[job.newHireStatus]}`}
                    title={`${NEW_HIRE_MEANINGS[job.newHireStatus]} ${NEW_HIRE_DISCLAIMER}`}
                  >
                    {NEW_HIRE_LABELS[job.newHireStatus]}
                  </span>

                  <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-3">
                    <span className="text-muted min-w-0 truncate text-xs">
                      {job.salaryText ? (
                        <span className="text-fg font-medium">{job.salaryText}</span>
                      ) : (
                        (job.location ?? 'Location n/a')
                      )}
                    </span>
                    {applied.has(job.id) ? (
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        Applied ✓
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={openApply}
                        className="press bg-brand text-brand-contrast rounded-md px-3 py-1 text-xs font-semibold"
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {applyFor && (
        <ApplyDialog
          company={applyFor.company}
          title={applyFor.title}
          pending={markApplied.isPending}
          error={markApplied.error?.message}
          onConfirm={() =>
            markApplied.mutate(
              { jobId: applyFor.id },
              {
                onSuccess: () => {
                  // Best-effort: auto-find + import a contact, then hand off to the
                  // Tracker where the outreach panel + draft live.
                  kickoff.mutate({ jobId: applyFor.id });
                  setApplyFor(null);
                  router.push('/tracker');
                },
              },
            )
          }
          onClose={() => setApplyFor(null)}
        />
      )}
    </main>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-brand"
      />
      {label}
    </label>
  );
}
