'use client';

/**
 * Job Board — a left filter rail + a card grid. Two independent scores per card
 * (H1B sponsor tier + the recommended priority), best-effort salary, and per-card
 * Apply / Remove. "Find new jobs" fires the enrichment pipeline; Remove hides a
 * job for good; the board defaults to US, full-time, non-excluded, posted within
 * the last week.
 */
import { useDeferredValue, useState } from 'react';
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
import { trpc } from '@/trpc/react';

type Sort = 'combined' | 'fit' | 'recent';
/** Posted-age window in days; 0 means "any age". */
type Within = 1 | 3 | 7 | 0;

const WITHIN_OPTIONS: { value: Within; label: string }[] = [
  { value: 1, label: 'Past 24 hours' },
  { value: 3, label: 'Past 3 days' },
  { value: 7, label: 'Past week' },
  { value: 0, label: 'Any time' },
];

const inputCls =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-brand focus:outline-none';

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [sort, setSort] = useState<Sort>('combined');
  const [within, setWithin] = useState<Within>(7);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [includeSenior, setIncludeSenior] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [applyFor, setApplyFor] = useState<{ id: number; company: string; title: string } | null>(
    null,
  );
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search);
  const deferredLocation = useDeferredValue(location);
  const utils = trpc.useUtils();
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
  const refresh = trpc.jobs.refresh.useMutation({
    onSuccess: () => setRefreshMsg('Finding new jobs… they’ll appear here in a few minutes.'),
    onError: (e) => setRefreshMsg(`Couldn’t start a refresh: ${e.message}`),
  });

  const jobsQuery = trpc.jobs.list.useQuery({
    search: deferredSearch || undefined,
    location: deferredLocation || undefined,
    sort,
    postedWithinDays: within || undefined,
    remoteOnly,
    includeSenior,
    includeExcluded,
    includeClosed,
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow="Sponsorship-scored"
        title="Job Board"
        subtitle="Every card carries an H-1B possibility tier and a recommended priority — US, full-time, fresh."
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
            onChange={(e) => setSort(e.target.value as Sort)}
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
                      onChange={() => setWithin(o.value)}
                      className="accent-brand"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="border-border border-t pt-4">
              <div className="text-faint mb-2 text-xs font-medium tracking-wide uppercase">
                Show
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <Toggle label="Remote only" checked={remoteOnly} onChange={setRemoteOnly} />
                <Toggle
                  label="Include senior"
                  checked={includeSenior}
                  onChange={setIncludeSenior}
                />
                <Toggle
                  label="Show excluded"
                  checked={includeExcluded}
                  onChange={setIncludeExcluded}
                />
                <Toggle label="Show closed" checked={includeClosed} onChange={setIncludeClosed} />
              </div>
            </div>

            {!jobsQuery.isLoading && (
              <div className="text-faint border-border border-t pt-4 text-xs">
                {jobs.length} job{jobs.length === 1 ? '' : 's'} shown
              </div>
            )}
          </div>
        </aside>

        {/* Card grid */}
        <section>
          {jobsQuery.isLoading && <LoadingSkeleton rows={6} />}
          {jobsQuery.isError && (
            <ErrorState
              message={`Failed to load jobs: ${jobsQuery.error.message}`}
              onRetry={() => jobsQuery.refetch()}
            />
          )}
          {!jobsQuery.isLoading && jobs.length === 0 && (
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
                      <span className="text-faint font-mono text-[11px]">
                        {job.postedDate ?? 'date n/a'}
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
            markApplied.mutate({ jobId: applyFor.id }, { onSuccess: () => setApplyFor(null) })
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
