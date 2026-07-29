'use client';

import { useDeferredValue, useState } from 'react';
import { trpc } from '@/trpc/react';

type SponsorTier = 'High' | 'Medium' | 'Low' | 'Excluded';
type Sort = 'combined' | 'sponsor' | 'fit' | 'recent';

const TIER_STYLES: Record<SponsorTier, string> = {
  High: 'bg-green-100 text-green-800 border-green-200',
  Medium: 'bg-amber-100 text-amber-800 border-amber-200',
  Low: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  Excluded: 'bg-red-100 text-red-800 border-red-200',
};

function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${
        muted ? 'bg-zinc-100 text-zinc-500' : 'bg-zinc-100 text-zinc-700'
      }`}
    >
      {children}
    </span>
  );
}

export default function Home() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('combined');
  const [resumeId, setResumeId] = useState<number | undefined>(undefined);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [allEmployment, setAllEmployment] = useState(false);

  const deferredSearch = useDeferredValue(search);
  const utils = trpc.useUtils();
  const resumesQuery = trpc.resumes.listBase.useQuery();
  const appliedQuery = trpc.applications.appliedJobIds.useQuery();
  const applied = new Set(appliedQuery.data ?? []);
  const markApplied = trpc.applications.create.useMutation({
    // Optimistically mark applied so the button flips immediately and a fast
    // double-click can't create duplicate rows; roll back on error.
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
    remoteOnly,
    employmentType: allEmployment ? 'all' : 'full_time',
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">H1B Job Board</h1>
        <p className="text-sm text-zinc-500">
          Two independent scores per job: H1B possibility tier and resume fit.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
        <input
          type="search"
          aria-label="Search company or title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or title…"
          className="min-w-48 flex-1 rounded border border-zinc-300 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded border border-zinc-300 px-1 py-1"
          >
            <option value="combined">Tier × fit</option>
            <option value="sponsor">H1B tier</option>
            <option value="fit">Resume fit</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Resume
          <select
            value={resumeId ?? ''}
            onChange={(e) => setResumeId(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded border border-zinc-300 px-1 py-1"
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
            checked={allEmployment}
            onChange={(e) => setAllEmployment(e.target.checked)}
          />
          Include contract
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeExcluded}
            onChange={(e) => setIncludeExcluded(e.target.checked)}
          />
          Show excluded
        </label>
      </div>

      {jobsQuery.isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
      {jobsQuery.isError && (
        <p className="text-sm text-red-600">Failed to load jobs: {jobsQuery.error.message}</p>
      )}
      {jobsQuery.data?.length === 0 && (
        <p className="text-sm text-zinc-500">
          No jobs yet. Run <code className="rounded bg-zinc-100 px-1">pnpm enrich</code> to populate
          the board.
        </p>
      )}

      <ul className="space-y-3">
        {jobsQuery.data?.map((job) => (
          <li key={job.id} className="rounded-lg border border-zinc-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-900 hover:underline"
                >
                  {job.title}
                </a>
                <div className="text-sm text-zinc-600">
                  {job.company}
                  {job.location ? ` · ${job.location}` : ''}
                  {job.isRemote ? ' · Remote' : ''}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  TIER_STYLES[job.sponsorTier as SponsorTier] ?? TIER_STYLES.Low
                }`}
                title={job.sponsorReason ?? undefined}
              >
                H1B: {job.sponsorTier}
                {job.sponsorCount != null ? ` (${job.sponsorCount})` : ''}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {job.relevanceScore != null && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                  Fit {job.relevanceScore}%
                </span>
              )}
              {job.roleFamily && <Chip>{job.roleFamily}</Chip>}
              {job.seniority && <Chip>{job.seniority}</Chip>}
              {job.employmentType === 'contract' && <Chip muted>contract</Chip>}
              <span className="text-xs text-zinc-400">
                {job.source}
                {job.postedDate ? ` · ${job.postedDate}` : ''}
              </span>
              <span className="ml-auto">
                {applied.has(job.id) ? (
                  <span className="text-xs font-medium text-green-700">Applied ✓</span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      markApplied.mutate({ jobId: job.id, resumeId, resumeLabel: lensLabel })
                    }
                    disabled={markApplied.isPending}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Mark applied
                  </button>
                )}
              </span>
            </div>

            {job.skillGaps != null && job.skillGaps.length > 0 && (
              <div className="mt-2 text-xs text-zinc-500">
                Missing: {job.skillGaps.slice(0, 8).join(', ')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
