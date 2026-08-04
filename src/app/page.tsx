import Link from 'next/link';

const TIERS = [
  {
    name: 'High',
    dot: 'bg-emerald-500',
    note: 'JD states sponsorship, or a heavy filing history.',
  },
  { name: 'Medium', dot: 'bg-amber-500', note: 'Sponsored before; the JD is silent.' },
  { name: 'Low', dot: 'bg-slate-400', note: 'Silent JD and little or no history.' },
  {
    name: 'Excluded',
    dot: 'bg-rose-500',
    note: '“No sponsorship” / citizens only — hidden but auditable.',
  },
];

const PIPELINE = [
  {
    step: 'Gather',
    detail: 'Postings from public ATS feeds (Greenhouse, Lever, Ashby) and curated GitHub sources.',
  },
  { step: 'Score sponsorship', detail: 'Match each employer against real USCIS H-1B filing data.' },
  {
    step: 'Filter junk',
    detail: 'Drop contract / staffing / body-shop roles; keep US direct-hire.',
  },
  { step: 'Rank vs. résumé', detail: 'Interpretable keyword overlap against a résumé you pick.' },
  {
    step: 'Apply & follow up',
    detail: 'Tailor, track on a kanban, and draft outreach to the right people.',
  },
];

const FEATURES = [
  {
    href: '/jobs',
    title: 'Job board',
    detail: 'US roles, two scores per card, jobright-style sorts.',
  },
  {
    href: '/studio',
    title: 'Tailoring studio',
    detail: 'A one-page résumé tailored to a job — from your own material.',
  },
  {
    href: '/tracker',
    title: 'Tracker',
    detail: 'Kanban pipeline + AI outreach to recruiters and managers.',
  },
  {
    href: '/dashboard',
    title: 'Dashboard',
    detail: 'Tier mix, application funnel, and top sponsors at a glance.',
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6">
      {/* Hero */}
      <section className="relative grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        {/* soft brand glow behind the card */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-0 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-brand-2), transparent 70%)' }}
        />
        <div className="relative">
          <span className="animate-rise border-border bg-surface text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            H-1B sponsorship, scored against real government data
          </span>
          <h1
            className="animate-rise font-display mt-5 text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl"
            style={{ animationDelay: '60ms' }}
          >
            See who’ll <em className="text-brand italic">sponsor you</em> — before you apply.
          </h1>
          <p
            className="animate-rise text-muted mt-5 max-w-xl text-lg"
            style={{ animationDelay: '120ms' }}
          >
            Every job gets two honest, independent scores: an H-1B possibility tier from real USCIS
            filings, and how well it fits a résumé you choose. No black box, no blending.
          </p>
          <div
            className="animate-rise mt-7 flex flex-wrap items-center gap-3"
            style={{ animationDelay: '180ms' }}
          >
            <Link
              href="/jobs"
              className="bg-brand text-brand-contrast rounded-lg px-5 py-2.5 text-sm font-medium shadow-[0_8px_24px_-8px_var(--color-brand)] transition-transform hover:-translate-y-0.5"
            >
              Browse jobs →
            </Link>
            <Link
              href="/studio"
              className="border-border text-fg hover:bg-surface-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
            >
              Tailor a résumé
            </Link>
          </div>
        </div>

        {/* Signature: the verdict card (always dark for instrument drama) */}
        <div
          className="animate-rise relative rounded-2xl border border-white/10 bg-[#0c1120] p-6 text-zinc-100 shadow-2xl"
          style={{ animationDelay: '160ms' }}
        >
          <div className="flex items-center justify-between font-mono text-[11px] tracking-wide text-zinc-500 uppercase">
            <span>Live example</span>
            <span>2 scores · never blended</span>
          </div>
          <div className="mt-3">
            <div className="text-lg font-semibold">Senior Backend Engineer</div>
            <div className="text-sm text-zinc-400">
              Meridian Systems · New York, NY · Remote (US)
            </div>
          </div>

          {/* Tier verdict */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">H-1B possibility</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                High
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="animate-gauge h-full rounded-full bg-emerald-500"
                style={{ width: '94%' }}
              />
            </div>
            <div className="mt-2 font-mono text-[11px] text-zinc-500">
              1,240 approvals · 94% approval rate · last filed 2024
            </div>
          </div>

          {/* Résumé fit */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Résumé fit</span>
              <span className="text-brand-2 font-mono text-sm font-semibold">82%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="animate-gauge h-full rounded-full"
                style={{
                  width: '82%',
                  background: 'var(--color-brand-2)',
                  animationDelay: '0.35s',
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Go', 'Postgres', 'Kubernetes'].map((s) => (
                <span
                  key={s}
                  className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
                >
                  {s}
                </span>
              ))}
              <span className="rounded px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                missing: gRPC
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Tier scale — an instrument, not decoration */}
      <section className="border-border border-t py-14">
        <h2 className="text-faint font-mono text-xs tracking-widest uppercase">
          The sponsorship scale
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <div key={t.name} className="border-border bg-surface rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
                <span className="font-medium">{t.name}</span>
              </div>
              <p className="text-muted mt-2 text-sm">{t.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — a real 5-stage pipeline */}
      <section className="border-border border-t py-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          From posting to offer
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className="border-border bg-surface rounded-xl border p-4">
              <div className="text-brand font-mono text-xs">{String(i + 1).padStart(2, '0')}</div>
              <div className="mt-2 font-medium">{p.step}</div>
              <p className="text-muted mt-1 text-sm">{p.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Feature links */}
      <section className="border-border border-t py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="group border-border bg-surface hover:border-brand rounded-xl border p-5 transition-colors"
            >
              <div className="font-medium">
                {f.title}
                <span className="text-brand transition-transform group-hover:translate-x-0.5">
                  {' '}
                  →
                </span>
              </div>
              <p className="text-muted mt-1 text-sm">{f.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-border text-faint border-t py-8 text-sm">
        Sponsorpath · H-1B sponsorship scored against real USCIS data. Not legal advice.
      </footer>
    </main>
  );
}
