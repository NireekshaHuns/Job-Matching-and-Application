'use client';

import { useDeferredValue, useState } from 'react';
import { ApplyDialog } from '@/components/apply-dialog';
import { Chip } from '@/components/chip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/page-state';
import { SponsorCorrection } from '@/components/sponsor-correction';
import { TailoringPanel } from '@/components/tailoring-panel';
import {
  NEW_HIRE_DISCLAIMER,
  NEW_HIRE_LABELS,
  NEW_HIRE_MEANINGS,
  NEW_HIRE_STYLES,
  TIER_STYLES,
  type NewHireStatus,
} from '@/components/tier';
import { trpc } from '@/trpc/react';

// Recommended = the default sponsorship×fit×freshness blend (server-side).
type Sort = 'combined' | 'fit' | 'recent';
type NewHireFilter = NewHireStatus | 'all';

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('combined');
  const [resumeId, setResumeId] = useState<number | undefined>(undefined);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [includeSenior, setIncludeSenior] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [includeNonUs, setIncludeNonUs] = useState(false);
  const [allEmployment, setAllEmployment] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [newHire, setNewHire] = useState<NewHireFilter>('all');
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [tailoring, setTailoring] = useState<number | null>(null);
  // The job whose apply-confirmation dialog is open (set after opening its posting).
  const [applyFor, setApplyFor] = useState<{
    id: number;
    company: string;
    title: string;
  } | null>(null);

  const deferredSearch = useDeferredValue(search);
  const utils = trpc.useUtils();
  const resumesQuery = trpc.resumes.listBase.useQuery();
  const appliedQuery = trpc.applications.appliedJobIds.useQuery();
  const applied = new Set(appliedQuery.data ?? []);
  const markApplied = trpc.applications.create.useMutation({
    // Optimistically flip the job to applied so it updates immediately; the
    // apply dialog stays open until this settles and rolls back on error.
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
  const lensLabel = resumesQuery.data?.find((r) => r.id === resumeId)?.label;
  const jobsQuery = trpc.jobs.list.useQuery({
    search: deferredSearch || undefined,
    sort,
    resumeId,
    includeExcluded,
    includeSenior,
    remoteOnly,
    includeNonUs,
    employmentType: allEmployment ? 'all' : 'full_time',
    includeClosed,
    newHireStatuses: newHire === 'all' ? undefined : [newHire],
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Job Board</h1>
        <p className="text-muted text-sm">
          Two independent scores per job: H1B possibility tier and resume fit.
        </p>
      </header>

      <div className="border-border bg-surface mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
        <input
          type="search"
          aria-label="Search company or title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or title…"
          className="border-border bg-surface min-w-48 flex-1 rounded border px-2 py-1"
        />
        <label className="flex items-center gap-1">
          Sort
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="border-border bg-surface rounded border px-1 py-1"
          >
            <option value="combined">Recommended</option>
            <option value="fit">Most fit</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Resume
          <select
            aria-label="Resume"
            value={resumeId ?? ''}
            onChange={(e) => setResumeId(e.target.value ? Number(e.target.value) : undefined)}
            className="border-border bg-surface rounded border px-1 py-1"
          >
            <option value="">None</option>
            {resumesQuery.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          New hires
          <select
            aria-label="New hires"
            value={newHire}
            onChange={(e) => setNewHire(e.target.value as NewHireFilter)}
            className="border-border bg-surface rounded border px-1 py-1"
          >
            <option value="all">Any</option>
            <option value="sponsors_new_hires">Sponsors new hires</option>
            <option value="transfers_only">Transfers only</option>
            <option value="no_record">No record</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
          />
          Remote only
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeNonUs}
            onChange={(e) => setIncludeNonUs(e.target.checked)}
          />
          Include non-US
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={allEmployment}
            onChange={(e) => setAllEmployment(e.target.checked)}
          />
          Include contract
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeSenior}
            onChange={(e) => setIncludeSenior(e.target.checked)}
          />
          Include senior
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeExcluded}
            onChange={(e) => setIncludeExcluded(e.target.checked)}
          />
          Show excluded
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          Show closed
        </label>
      </div>

      {jobsQuery.isLoading && <LoadingSkeleton />}
      {jobsQuery.isError && (
        <ErrorState
          message={`Failed to load jobs: ${jobsQuery.error.message}`}
          onRetry={() => jobsQuery.refetch()}
        />
      )}
      {jobsQuery.data?.length === 0 && (
        <EmptyState title="No jobs match your filters yet.">
          Try clearing filters, or ingest postings to populate the board.
        </EmptyState>
      )}

      <ul className="space-y-3">
        {jobsQuery.data?.map((job) => (
          <li key={job.id} className="border-border bg-surface rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg font-medium hover:underline"
                >
                  {job.title}
                </a>
                <div className="text-muted text-sm">
                  {job.company}
                  {job.location ? ` · ${job.location}` : ''}
                  {job.isRemote ? ' · Remote' : ''}
                  {job.isUs === false && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      Non-US
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TIER_STYLES[job.sponsorTier]}`}
                  title={job.sponsorReason ?? undefined}
                >
                  H1B: {job.sponsorTier}
                  {job.sponsorCount != null ? ` (${job.sponsorCount})` : ''}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${NEW_HIRE_STYLES[job.newHireStatus]}`}
                  title={`${NEW_HIRE_MEANINGS[job.newHireStatus]} ${NEW_HIRE_DISCLAIMER}`}
                >
                  {NEW_HIRE_LABELS[job.newHireStatus]}
                </span>
                <button
                  type="button"
                  onClick={() => setCorrecting(correcting === job.id ? null : job.id)}
                  className="text-faint hover:text-muted text-[11px] hover:underline"
                  title="Correct the USCIS employer match"
                >
                  {job.sponsorMatchConfidence != null
                    ? `match ${Math.round(job.sponsorMatchConfidence * 100)}% · correct`
                    : 'no match · correct'}
                </button>
              </div>
            </div>

            {correcting === job.id && (
              <SponsorCorrection company={job.company} onDone={() => setCorrecting(null)} />
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="bg-brand/10 text-brand-text rounded px-1.5 py-0.5 text-xs font-medium"
                title={`Why recommended: sponsorship ${job.priorityTier} · fit ${job.priorityFit} · freshness ${job.priorityFreshness}`}
              >
                Recommended {job.priorityScore}
              </span>
              {job.relevanceScore != null && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                  Fit {job.relevanceScore}%
                </span>
              )}
              {job.roleFamily && <Chip>{job.roleFamily}</Chip>}
              {job.seniority && <Chip>{job.seniority}</Chip>}
              {job.employmentType === 'contract' && <Chip muted>contract</Chip>}
              {job.status === 'closed' && (
                <span
                  className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                  title="No longer seen in the source feed"
                >
                  Closed
                </span>
              )}
              <span className="text-faint text-xs">
                {job.source}
                {job.postedDate ? ` · ${job.postedDate}` : ''}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTailoring(tailoring === job.id ? null : job.id)}
                  className="border-border hover:bg-surface-2 rounded border px-2 py-0.5 text-xs"
                  title="Tailoring suggestions for the selected résumé lens"
                >
                  {tailoring === job.id ? 'Hide tailor' : 'Tailor'}
                </button>
                {applied.has(job.id) ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Applied ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      markApplied.reset(); // clear any prior error before reopening
                      window.open(job.url, '_blank', 'noopener,noreferrer');
                      setApplyFor({ id: job.id, company: job.company, title: job.title });
                    }}
                    className="border-border hover:bg-surface-2 rounded border px-2 py-0.5 text-xs"
                  >
                    Apply
                  </button>
                )}
              </span>
            </div>

            {job.skillGaps != null && job.skillGaps.length > 0 && (
              <div className="text-muted mt-2 text-xs">
                Missing: {job.skillGaps.slice(0, 8).join(', ')}
              </div>
            )}

            {tailoring === job.id && (
              <TailoringPanel jobId={job.id} resumeId={resumeId} lensLabel={lensLabel} />
            )}
          </li>
        ))}
      </ul>

      {applyFor && (
        <ApplyDialog
          company={applyFor.company}
          title={applyFor.title}
          pending={markApplied.isPending}
          error={markApplied.error?.message}
          onConfirm={() =>
            // Attribute the résumé lens selected at confirm time; only close on success.
            markApplied.mutate(
              { jobId: applyFor.id, resumeId, resumeLabel: lensLabel },
              { onSuccess: () => setApplyFor(null) },
            )
          }
          onClose={() => setApplyFor(null)}
        />
      )}
    </main>
  );
}
