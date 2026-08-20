/**
 * Deterministic e2e seed. Wipes and repopulates a THROWAWAY test database with a
 * fixed set of jobs (across every tier + an excluded + a contract role), one base
 * résumé — enough to exercise every board/tracker/dashboard
 * affordance without calling OpenAI.
 *
 * Safety: this TRUNCATEs tables, so it refuses to run unless `E2E_DATABASE_URL`
 * is set. It never falls back to `DATABASE_URL` — that would wipe the dev DB.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';

const { jobs, resumes } = schema;

/** The URL of the throwaway e2e database. Required — no dev-DB fallback. */
export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      'E2E_DATABASE_URL is not set. Point it at a throwaway/test database (e.g. a Neon ' +
        'branch) — the e2e seed truncates tables and must never touch your dev DB.',
    );
  }
  return url;
}

/** Stable titles the specs locate cards by. */
export const SEED = {
  resumeLabel: 'E2E Base',
  high: 'E2E Backend Engineer',
  medium: 'E2E Platform Engineer',
  low: 'E2E Support Engineer',
  excluded: 'E2E Excluded Role',
  contract: 'E2E Contract Engineer',
  /** Hidden unless "Show closed" — status closed. */
  closed: 'E2E Closed Engineer',
  /** Only shown when "Remote only" is on, alongside the remote-flagged ones. */
  remote: 'E2E Remote Engineer',
  /** Hidden unless "Include senior" — seniority `other`. */
  senior: 'E2E Staff Engineer',
  /** posted_at ~20 days ago: outside "Past week", inside "Any time". */
  old: 'E2E Older Engineer',
  /**
   * No posted_at and first seen ~20 days ago. The age filter falls back to
   * first_seen_at, so this must behave like `old` — it used to be exempt from
   * every window, which let stale rows crowd out fresh ones.
   */
  undatedOld: 'E2E Undated Older Engineer',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Comfortably outside the 7-day window; visible under the "Any time" default. */
const TWENTY_DAYS_AGO = new Date(Date.now() - 20 * DAY_MS);

/** Truncate the owned tables and insert the fixed fixture. Idempotent. */
export async function resetAndSeed(): Promise<void> {
  const db = drizzle(neon(e2eDatabaseUrl()), { schema });

  // CASCADE clears dependents (applications, contacts, outreach_log);
  // sponsors / profile are left untouched.
  await db.execute(sql`truncate table ${jobs}, ${resumes} restart identity cascade`);

  const [resume] = await db
    .insert(resumes)
    .values({
      label: SEED.resumeLabel,
      kind: 'base',
      roleFamily: 'backend',
      content: 'React, TypeScript, Node.js, PostgreSQL, REST APIs, testing.',
    })
    .returning({ id: resumes.id });

  const base = {
    source: 'e2e',
    url: 'https://example.com/e2e',
    jdText: 'Seeded posting for e2e tests.',
    location: 'New York, NY',
    seniority: 'entry' as const,
    roleFamily: 'backend' as const,
  };

  const inserted = await db
    .insert(jobs)
    .values([
      {
        ...base,
        fingerprint: 'e2e-high',
        company: 'E2E High Corp',
        title: SEED.high,
        employmentType: 'full_time',
        sponsorTier: 'High',
        sponsorReason: 'Heavy sponsor history.',
        sponsorCount: 250,
        newHireStatus: 'sponsors_new_hires',
        sponsorMatchConfidence: 1,
      },
      {
        ...base,
        fingerprint: 'e2e-medium',
        company: 'E2E Medium Corp',
        title: SEED.medium,
        employmentType: 'full_time',
        sponsorTier: 'Medium',
        sponsorReason: 'Sponsored before; JD silent.',
        sponsorCount: 30,
        newHireStatus: 'transfers_only',
      },
      {
        ...base,
        fingerprint: 'e2e-low',
        company: 'E2E Low Corp',
        title: SEED.low,
        employmentType: 'full_time',
        sponsorTier: 'Low',
        newHireStatus: 'unknown',
      },
      {
        ...base,
        fingerprint: 'e2e-excluded',
        company: 'E2E Excluded Corp',
        title: SEED.excluded,
        employmentType: 'full_time',
        sponsorTier: 'Excluded',
        sponsorReason: 'JD states no sponsorship.',
        newHireStatus: 'unknown',
      },
      {
        ...base,
        fingerprint: 'e2e-contract',
        company: 'E2E Contract Corp',
        title: SEED.contract,
        employmentType: 'contract',
        sponsorTier: 'High',
        newHireStatus: 'sponsors_new_hires',
      },
      {
        ...base,
        fingerprint: 'e2e-closed',
        company: 'E2E Closed Corp',
        title: SEED.closed,
        employmentType: 'full_time',
        sponsorTier: 'High',
        newHireStatus: 'unknown',
        status: 'closed',
        closedAt: new Date(),
      },
      {
        ...base,
        fingerprint: 'e2e-remote',
        company: 'E2E Remote Corp',
        title: SEED.remote,
        employmentType: 'full_time',
        sponsorTier: 'High',
        newHireStatus: 'unknown',
        isRemote: true,
        location: 'Remote - US',
      },
      {
        ...base,
        fingerprint: 'e2e-senior',
        company: 'E2E Senior Corp',
        title: SEED.senior,
        employmentType: 'full_time',
        sponsorTier: 'High',
        newHireStatus: 'unknown',
        seniority: 'other',
      },
      {
        ...base,
        fingerprint: 'e2e-old',
        company: 'E2E Older Corp',
        title: SEED.old,
        employmentType: 'full_time',
        sponsorTier: 'High',
        newHireStatus: 'unknown',
        postedAt: TWENTY_DAYS_AGO,
      },
      {
        // posted_at null on purpose — the age filter must fall back to
        // first_seen_at rather than exempting the row from every window.
        ...base,
        fingerprint: 'e2e-undated-old',
        company: 'E2E Undated Older Corp',
        title: SEED.undatedOld,
        employmentType: 'full_time',
        sponsorTier: 'High',
        newHireStatus: 'unknown',
        postedAt: null,
        firstSeenAt: TWENTY_DAYS_AGO,
        lastSeenAt: TWENTY_DAYS_AGO,
      },
    ])
    .returning({ id: jobs.id, fingerprint: jobs.fingerprint });
}
