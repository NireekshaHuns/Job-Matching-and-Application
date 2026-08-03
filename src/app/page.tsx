import Link from 'next/link';
import { TIER_MEANINGS, TIER_STYLES, type SponsorTier } from '@/components/tier';

const TIERS: SponsorTier[] = ['High', 'Medium', 'Low', 'Excluded'];

const PIPELINE = [
  {
    step: 'Gather',
    detail: 'Pull postings from public ATS feeds (Greenhouse, Lever, Ashby) + aggregators.',
  },
  { step: 'Check sponsorship', detail: 'Match each employer against real USCIS H-1B filing data.' },
  { step: 'Filter junk', detail: 'Drop contract / staffing / body-shop roles; keep direct-hire.' },
  {
    step: 'Rank vs. résumé',
    detail: 'Score each job against a selected résumé by keyword overlap.',
  },
  { step: 'Apply & follow up', detail: 'Track applications, verify via Outlook, and reach out.' },
];

const FEATURES = [
  {
    href: '/jobs',
    title: 'Job Board',
    detail: 'Sort by Recommended, résumé fit, or most recent — US roles only.',
  },
  {
    href: '/tracker',
    title: 'Tracker',
    detail: 'Mark applications, keep the résumé you used, see Outlook-confirmed ones.',
  },
  {
    href: '/dashboard',
    title: 'Dashboard',
    detail: 'Tier mix, application funnel, top sponsors, and freshness at a glance.',
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      {/* Hero */}
      <section className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
          Find SWE jobs that will actually sponsor your H-1B.
        </h1>
        <p className="mt-4 text-lg text-zinc-600">
          A job board that scores every employer&apos;s sponsorship likelihood against real US
          government data — then ranks roles against your résumé, filters out staffing shops, and
          tracks your applications end to end.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/jobs"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Browse jobs →
          </Link>
          <Link
            href="/tracker"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Track applications
          </Link>
        </div>
      </section>

      {/* Two-score explainer */}
      <section className="mt-16">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          Two independent scores per job
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Sponsorship and résumé fit are kept separate and never blended into one number — so you
          always see <em>why</em> a job ranks where it does.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 p-5">
            <h3 className="text-sm font-semibold text-zinc-800">H-1B possibility tier</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Ranked from government filing history + the JD&apos;s own wording.
            </p>
            <ul className="mt-3 space-y-2">
              {TIERS.map((tier) => (
                <li key={tier} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}
                  >
                    {tier}
                  </span>
                  <span className="text-zinc-600">{TIER_MEANINGS[tier]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-zinc-200 p-5">
            <h3 className="text-sm font-semibold text-zinc-800">Résumé fit</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Interpretable keyword overlap against a résumé you pick — not a black box.
            </p>
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                >
                  Fit 82%
                </span>
                <span className="text-zinc-600">How well the JD matches your skills.</span>
              </div>
              <div className="text-zinc-600">
                <span aria-hidden className="text-xs text-zinc-500">
                  Missing: Kafka, Go
                </span>
                <p className="mt-1">
                  The exact skills a JD wants that your résumé doesn&apos;t show.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="mt-16">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">How it works</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className="rounded-lg border border-zinc-200 p-4">
              <div className="text-xs font-medium text-zinc-400">Step {i + 1}</div>
              <div className="mt-1 text-sm font-semibold text-zinc-800">{p.step}</div>
              <p className="mt-1 text-sm text-zinc-500">{p.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Feature links */}
      <section className="mt-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="text-sm font-semibold text-zinc-800">{f.title} →</div>
              <p className="mt-1 text-sm text-zinc-500">{f.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
