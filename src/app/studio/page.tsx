'use client';

/**
 * Tailoring Studio — generate a tailored résumé for a (job × base résumé).
 * Picks a job + a base résumé lens, calls resumes.tailor, and shows the fit
 * before/after, honest gaps, and the tailored LaTeX to copy or download. PDF
 * compile is intentionally local (Overleaf or `pnpm resume:pdf`) — the serverless
 * host has no LaTeX engine.
 */
import type { inferRouterOutputs } from '@trpc/server';
import { useState } from 'react';
import { ErrorState, LoadingSkeleton } from '@/components/page-state';
import type { AppRouter } from '@/server/trpc/root';
import { trpc } from '@/trpc/react';

type TailorResult = inferRouterOutputs<AppRouter>['resumes']['tailor'];

const selectCls =
  'rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none';
const btnCls =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50';

/** Parse a <select> value to an id, or undefined if it isn't a real number. */
function toId(value: string): number | undefined {
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-tex' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StudioPage() {
  const jobs = trpc.jobs.list.useQuery({ limit: 100 });
  const resumes = trpc.resumes.listBase.useQuery();
  const tailor = trpc.resumes.tailor.useMutation();

  const [jobId, setJobId] = useState<number | undefined>();
  const [resumeId, setResumeId] = useState<number | undefined>();

  const effectiveJobId = jobId ?? jobs.data?.[0]?.id;
  const effectiveResumeId = resumeId ?? resumes.data?.[0]?.id;
  const canGenerate = effectiveJobId != null && effectiveResumeId != null && !tailor.isPending;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tailoring Studio</h1>
        <p className="text-sm text-zinc-500">
          Generate a one-page résumé tailored to a job from your truthful inventory. It only
          surfaces skills you have — honest gaps are shown, never faked.
        </p>
      </header>

      {jobs.isError ? (
        <ErrorState message={jobs.error.message} onRetry={() => jobs.refetch()} />
      ) : resumes.isError ? (
        <ErrorState message={resumes.error.message} onRetry={() => resumes.refetch()} />
      ) : !jobs.data || !resumes.data ? (
        <LoadingSkeleton rows={2} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Job
              <select
                className={`${selectCls} min-w-64`}
                value={effectiveJobId ?? ''}
                onChange={(e) => setJobId(toId(e.target.value))}
              >
                {jobs.data.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.company} — {j.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Base résumé
              <select
                className={selectCls}
                value={effectiveResumeId ?? ''}
                onChange={(e) => setResumeId(toId(e.target.value))}
              >
                {resumes.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={btnCls}
              disabled={!canGenerate}
              onClick={() =>
                effectiveJobId != null &&
                effectiveResumeId != null &&
                tailor.mutate({ jobId: effectiveJobId, resumeId: effectiveResumeId })
              }
            >
              {tailor.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>

          {resumes.data.length === 0 && (
            <p className="mb-4 text-sm text-amber-700">
              No base résumé yet. Add one in{' '}
              <a className="underline" href="/settings">
                Settings
              </a>{' '}
              first.
            </p>
          )}

          {tailor.isError && <ErrorState message={tailor.error.message} />}
          {tailor.data && <Result data={tailor.data} />}
        </>
      )}
    </main>
  );
}

function Result({ data }: { data: TailorResult }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(data.latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context / denied) — the .tex is
      // still downloadable, so just leave the button label unchanged.
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            data.source === 'llm'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {data.source === 'llm' ? 'AI-tailored' : 'Base résumé (no OpenAI key)'}
        </span>
        <span className="text-sm text-zinc-600">
          Fit <span className="font-medium text-zinc-900">{data.fit.before}%</span> → achievable{' '}
          <span className="font-medium text-zinc-900">{data.fit.achievable}%</span>
        </span>
        {data.report && (
          <span className="text-xs text-zinc-500">
            {data.report.lint.wordCount} words · {data.report.attempts} attempt
            {data.report.attempts === 1 ? '' : 's'} ·{' '}
            {data.report.lint.ok
              ? 'passes linter'
              : `${data.report.lint.violations.length} lint issue(s)`}
          </span>
        )}
      </div>

      {data.source === 'base' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Set OPENAI_API_KEY to auto-tailor. Meanwhile, weave these truthful keywords into your base
          résumé yourself.
        </p>
      )}

      <ChipRow
        label="You can truthfully surface"
        tone="emerald"
        items={data.coverableKeywords}
        empty="Nothing addable for this lens."
      />
      <ChipRow
        label="Honest gaps (don’t fake)"
        tone="zinc"
        items={data.trueGaps}
        empty="No gaps — you cover everything this JD asks."
      />

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium">Tailored LaTeX</span>
          <button type="button" className={btnCls} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={() => download('resume-tailored.tex', data.latex)}
          >
            Download .tex
          </button>
          <span className="text-xs text-zinc-400">
            Compile in Overleaf or via `pnpm resume:pdf`.
          </span>
        </div>
        <textarea
          readOnly
          aria-label="Tailored résumé LaTeX"
          className="min-h-80 w-full rounded-md border border-zinc-300 p-2 font-mono text-xs"
          value={data.latex}
        />
      </div>
    </div>
  );
}

function ChipRow({
  label,
  items,
  tone,
  empty,
}: {
  label: string;
  items: string[];
  tone: 'emerald' | 'zinc';
  empty: string;
}) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600';
  return (
    <div className="text-sm">
      <span className="font-medium text-zinc-700">{label}:</span>{' '}
      {items.length === 0 ? (
        <span className="text-zinc-400">{empty}</span>
      ) : (
        <span className="inline-flex flex-wrap gap-1.5 align-middle">
          {items.map((k) => (
            <span key={k} className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>
              {k}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
