'use client';

import type { inferRouterOutputs } from '@trpc/server';
import { ErrorState, LoadingSkeleton } from '@/components/page-state';
import type { AppRouter } from '@/server/trpc/root';
import { trpc } from '@/trpc/react';

type Summary = inferRouterOutputs<AppRouter>['dashboard']['summary'];

const TIER_BAR: Record<string, string> = {
  High: 'bg-emerald-500',
  Medium: 'bg-amber-500',
  Low: 'bg-slate-400',
  Excluded: 'bg-rose-500',
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-surface rounded-lg border p-4">
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-muted text-sm">{label}</div>
    </div>
  );
}

/** A labelled breakdown rendered as proportional bars. */
function Breakdown({
  title,
  rows,
  barClass,
}: {
  title: string;
  rows: { key: string; count: number }[];
  barClass?: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="border-border bg-surface rounded-lg border p-4">
      <h2 className="text-fg mb-3 text-sm font-semibold">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 text-sm">
            <span className="text-muted w-28 shrink-0 truncate capitalize">
              {r.key.replace(/_/g, ' ')}
            </span>
            <span className="bg-surface-2 h-2 flex-1 overflow-hidden rounded">
              <span
                className={`block h-full rounded ${barClass?.(r.key) ?? 'bg-blue-500'}`}
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="text-fg w-10 shrink-0 text-right tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashboardBody({ data }: { data: Summary }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Jobs" value={data.totals.jobs} />
        <StatCard label="Remote" value={data.totals.remote} />
        <StatCard label="Applications" value={data.totals.applications} />
        <StatCard label="Confirmed" value={data.totals.confirmed} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown
          title="Jobs by sponsor tier"
          rows={data.byTier}
          barClass={(k) => TIER_BAR[k] ?? 'bg-blue-500'}
        />
        <Breakdown title="Applications by status" rows={data.applicationsByStatus} />
        <Breakdown title="Jobs by role family" rows={data.byRoleFamily} />
        <Breakdown title="Jobs by employment type" rows={data.byEmploymentType} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="border-border bg-surface rounded-lg border p-4">
          <h2 className="text-fg mb-3 text-sm font-semibold">Top sponsors (by H1B history)</h2>
          {data.topSponsors.length === 0 ? (
            <p className="text-muted text-sm">No jobs yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.topSponsors.map((s) => (
                <li key={s.company} className="flex items-center justify-between gap-3">
                  <span className="text-muted truncate">{s.company}</span>
                  <span className="text-muted shrink-0 tabular-nums">
                    {s.sponsorCount.toLocaleString()} approvals · {s.jobs} job
                    {s.jobs === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-border bg-surface rounded-lg border p-4">
          <h2 className="text-fg mb-3 text-sm font-semibold">Freshness</h2>
          <p className="text-muted text-sm">
            <span className="text-fg font-medium tabular-nums">{data.recentJobs.last7}</span> jobs
            added in the last 7 days ·{' '}
            <span className="text-fg font-medium tabular-nums">{data.recentJobs.last30}</span> in
            the last 30.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const summary = trpc.dashboard.summary.useQuery();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted text-sm">
          A snapshot of the board: sponsor-tier mix, application funnel, and top sponsors.
        </p>
      </header>

      {summary.isLoading && <LoadingSkeleton rows={3} />}
      {summary.isError && (
        <ErrorState
          message={`Failed to load dashboard: ${summary.error.message}`}
          onRetry={() => summary.refetch()}
        />
      )}
      {summary.data && <DashboardBody data={summary.data} />}
    </main>
  );
}
