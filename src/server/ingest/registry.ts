/**
 * Connector registry — the set of sources the ingestion cron will fan out to.
 * `buildConnectors` takes an injectable fetcher so it can be exercised with a
 * fixture client in tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  AGGREGATOR_SOURCE,
  aggregatorConnector,
  type AggregatorQuery,
} from './connectors/aggregator';
import { ashbyConnector, type AshbyBoard } from './connectors/ashby';
import { greenhouseConnector, type GreenhouseBoard } from './connectors/greenhouse';
import { leverConnector, type LeverBoard } from './connectors/lever';
import { linkedInGuestConnector, type LinkedInSearch } from './connectors/linkedin';
import { simplifyNewGradConnector } from './connectors/simplify';
import { smartRecruitersConnector, type SmartRecruitersBoard } from './connectors/smartrecruiters';
import { workdayConnector, type WorkdayBoard } from './connectors/workday';
import type { DiscoveredBoards } from './discover';
import type { Fetcher, JobConnector } from './types';

/**
 * The committed output of `pnpm ats:discover`. Imported rather than read from
 * disk so it is actually present in production: the old `ats-boards.json` sat
 * at the repo root, was git-ignored, and therefore never existed on Vercel —
 * the deployed board ran on the ~16 hand seeds alone while ~350 discovered
 * boards went unused.
 */
import DISCOVERED_BOARDS from './discovered-boards.json';

/** Local, uncommitted override for experimenting without a commit. */
const LOCAL_FILE = 'ats-boards.json';

/**
 * Boards discovered from Simplify apply-links. Starts from the committed set
 * and lets an uncommitted local `ats-boards.json` add to it, so a local
 * `pnpm ats:discover` can be tried out before it is committed.
 */
export function loadDiscoveredBoards(file: string = LOCAL_FILE): Partial<DiscoveredBoards> {
  const committed = DISCOVERED_BOARDS as Partial<DiscoveredBoards>;
  let local: Partial<DiscoveredBoards> = {};
  try {
    if (existsSync(file))
      local = JSON.parse(readFileSync(file, 'utf8')) as Partial<DiscoveredBoards>;
  } catch {
    local = {};
  }
  return {
    greenhouse: mergeBoards(committed.greenhouse ?? [], local.greenhouse, (b) => b.token),
    lever: mergeBoards(committed.lever ?? [], local.lever, (b) => b.token),
    ashby: mergeBoards(committed.ashby ?? [], local.ashby, (b) => b.board),
    // Keyed by host AND site, matching `discover.ts`: one tenant can publish
    // several career sites and they hold different postings, so keying on host
    // alone would silently throw one away.
    workday: mergeBoards(
      committed.workday ?? [],
      local.workday,
      (b) => `${b.host}/${b.site.toLowerCase()}`,
    ),
  };
}

/**
 * Merge seed + discovered boards, deduped by the given key. Seeds win on a key
 * collision: they are the curated, code-reviewed source of truth, whereas the
 * discovered file is machine-generated and its `company` label can drift (which
 * would change job fingerprints). Discovery only *adds* boards, never overrides.
 *
 * ORDER MATTERS, not just membership. A capped run walks this list from the
 * front, so whatever sits at the back is effectively invisible. Building the map
 * discovered-first put the curated H1B sponsors (stripe, databricks, airbnb,
 * anthropic) at indices 154-158 of the merged Greenhouse list — the boards most
 * worth fetching were the ones a stalled window never reached. Seeds are
 * inserted first so they are fetched first; a colliding discovered entry is
 * still dropped in favour of the seed, which is what the seed-wins rule means.
 */
export function mergeBoards<T>(seed: T[], discovered: T[] | undefined, key: (b: T) => string): T[] {
  const byKey = new Map<string, T>();
  // Seeds first — both for precedence AND for position. `Map.set` on an existing
  // key updates the value in place without moving it, so a discovered duplicate
  // can neither displace a seed nor push it down the list.
  for (const b of seed) byKey.set(key(b).toLowerCase(), b);
  for (const b of discovered ?? [])
    if (!byKey.has(key(b).toLowerCase())) byKey.set(key(b).toLowerCase(), b);
  return [...byKey.values()];
}

/**
 * Curated seed tokens per ATS — a focused set of well-known H1B-sponsor
 * companies (tokens validated against the live ATS APIs). This is the board's
 * durable source of truth; `pnpm ats:discover` widens the net into
 * `discovered-boards.json` (merged in, seeds win on collision). Tokens churn
 * (~20–40%), so re-validate before relying on any single one.
 */
export const GREENHOUSE_BOARDS: GreenhouseBoard[] = [
  { token: 'stripe', company: 'Stripe' },
  { token: 'databricks', company: 'Databricks' },
  { token: 'airbnb', company: 'Airbnb' },
  { token: 'figma', company: 'Figma' },
  { token: 'anthropic', company: 'Anthropic' },
  { token: 'purestorage', company: 'Pure Storage' },
  { token: 'twitch', company: 'Twitch' },
  { token: 'sigmacomputing', company: 'Sigma Computing' },
];

export const LEVER_BOARDS: LeverBoard[] = [
  { token: 'plaid', company: 'Plaid' },
  { token: 'palantir', company: 'Palantir' },
  { token: 'spotify', company: 'Spotify' },
  { token: 'veeva', company: 'Veeva Systems' },
];

export const ASHBY_BOARDS: AshbyBoard[] = [
  { board: 'ramp', company: 'Ramp' },
  { board: 'notion', company: 'Notion' },
  { board: 'snowflake', company: 'Snowflake' },
  { board: 'baseten', company: 'Baseten' },
];

/**
 * Workday boards, as `{host, tenant, site}`. Every entry below was validated
 * against the live CXS API, and every one is a real H-1B sponsor with new-hire
 * approvals on record — which is the whole reason to reach Workday at all. The
 * counts are FY2026 new-employment approvals at the time of writing:
 *
 *   NVIDIA 353 · Salesforce 167 · Capital One 158 · PayPal 135 · Adobe 100 ·
 *   CVS Health 100 · Workday 25 · State Street 11 · Mastercard 10 · Broadcom 5
 *
 * `site` is tenant-specific and not guessable — it is the segment after the
 * tenant in the careers URL. Re-validate before relying on any single one; these
 * churn like every other ATS token.
 */
export const WORKDAY_BOARDS: WorkdayBoard[] = [
  {
    host: 'statestreet.wd1.myworkdayjobs.com',
    tenant: 'statestreet',
    site: 'Global',
    company: 'State Street',
  },
  {
    host: 'nvidia.wd5.myworkdayjobs.com',
    tenant: 'nvidia',
    site: 'NVIDIAExternalCareerSite',
    company: 'NVIDIA',
  },
  {
    host: 'salesforce.wd12.myworkdayjobs.com',
    tenant: 'salesforce',
    site: 'External_Career_Site',
    company: 'Salesforce',
  },
  {
    host: 'capitalone.wd12.myworkdayjobs.com',
    tenant: 'capitalone',
    site: 'Capital_One',
    company: 'Capital One',
  },
  { host: 'paypal.wd1.myworkdayjobs.com', tenant: 'paypal', site: 'jobs', company: 'PayPal' },
  {
    host: 'adobe.wd5.myworkdayjobs.com',
    tenant: 'adobe',
    site: 'external_experienced',
    company: 'Adobe',
  },
  {
    host: 'cvshealth.wd1.myworkdayjobs.com',
    tenant: 'cvshealth',
    site: 'CVS_Health_Careers',
    company: 'CVS Health',
  },
  { host: 'workday.wd5.myworkdayjobs.com', tenant: 'workday', site: 'Workday', company: 'Workday' },
  {
    host: 'mastercard.wd1.myworkdayjobs.com',
    tenant: 'mastercard',
    site: 'CorporateCareers',
    company: 'Mastercard',
  },
  {
    host: 'broadcom.wd1.myworkdayjobs.com',
    tenant: 'broadcom',
    site: 'External_Career',
    company: 'Broadcom',
  },
];

/**
 * SmartRecruiters company identifiers are case-sensitive and churn like the
 * other ATS tokens — validate against the live API before relying on them.
 */
export const SMARTRECRUITERS_BOARDS: SmartRecruitersBoard[] = [
  { identifier: 'Square', company: 'Square' },
  { identifier: 'Visa', company: 'Visa' },
];

/**
 * Keyword/location queries for the LinkedIn guest search. Deliberately few and
 * broad: every search costs list requests, and the JD-fetch cap is shared
 * across all of them, so more searches mean thinner coverage of each rather
 * than more jobs. Widen only after watching a real run's counts.
 */
export const LINKEDIN_SEARCHES: LinkedInSearch[] = [
  { keywords: 'software engineer', location: 'United States' },
  { keywords: 'backend engineer', location: 'United States' },
  { keywords: 'full stack engineer', location: 'United States' },
  { keywords: 'machine learning engineer', location: 'United States' },
];

/**
 * LinkedIn is OFF unless explicitly switched on. It reads an undocumented
 * internal endpoint that LinkedIn rate-limits hard, so it must never run in CI,
 * e2e, or a default checkout — and this is the one-variable kill switch when it
 * starts getting blocked. See connectors/linkedin.ts for the full caveats.
 */
export function linkedInEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LINKEDIN_GUEST_ENABLED === 'true';
}

/**
 * Queries for the JSearch aggregator. Deliberately the same four themes as
 * `LINKEDIN_SEARCHES`, so the overlap between the two sources is measurable
 * rather than guessed — if the aggregator turns out to return mostly jobs
 * LinkedIn already found, that shows up as near-zero inserts rather than as a
 * vague impression.
 */
export const AGGREGATOR_QUERIES: AggregatorQuery[] = [
  { query: 'software engineer in United States' },
  { query: 'backend engineer in United States' },
  { query: 'full stack engineer in United States' },
  { query: 'machine learning engineer in United States' },
];

/**
 * The aggregator is a METERED, PAID source — the free plan is 200 requests per
 * month. No key means the connector is not registered at all, so CI, e2e and a
 * default checkout can never spend the allowance, and clearing the variable is
 * the kill switch. See connectors/aggregator.ts for the per-run request cap.
 */
export function aggregatorApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.AGGREGATOR_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Sources that cost money per request. The orchestrator treats these
 * differently: it fetches them at most once per user-triggered refresh, never
 * on a continuation run, and never inside a step that can retry for reasons
 * unrelated to fetching.
 *
 * A connector's own per-run cap can only bound ONE `fetch()` call — it cannot
 * see that the orchestrator is about to call it another twelve times. That
 * accounting has to live here.
 */
const METERED_SOURCES = new Set<string>([AGGREGATOR_SOURCE]);

export function isMeteredSource(source: string): boolean {
  return METERED_SOURCES.has(source);
}

/**
 * Whether the orchestrator should skip a source on this run.
 *
 * A continuation run exists to drain postings already in the DB, and every one
 * of them resets the connector's per-run request counter — so a metered source
 * fetched on continuations would be re-bought up to `MAX_CONTINUATIONS` extra
 * times per user click. Free sources are unaffected; they must keep running or
 * the backlog never drains.
 *
 * Extracted from the Inngest function so the policy is testable without a
 * step-runner harness — it is the guard standing between one button click and
 * half the monthly quota.
 */
export function skipSourceOnRun(source: string, continuationDepth: number): boolean {
  return isMeteredSource(source) && continuationDepth > 0;
}

export function buildConnectors(fetcher: Fetcher = globalThis.fetch): JobConnector[] {
  const discovered = loadDiscoveredBoards();
  const aggregatorKey = aggregatorApiKey();
  const greenhouse = mergeBoards(GREENHOUSE_BOARDS, discovered.greenhouse, (b) => b.token);
  const lever = mergeBoards(LEVER_BOARDS, discovered.lever, (b) => b.token);
  const ashby = mergeBoards(ASHBY_BOARDS, discovered.ashby, (b) => b.board);

  return [
    greenhouseConnector(greenhouse, fetcher),
    leverConnector(lever, fetcher),
    ashbyConnector(ashby, fetcher),
    // Ahead of the rest: these are the enterprise sponsors nothing else reaches,
    // and the board's whole premise is ranking by real sponsorship history.
    workdayConnector(
      mergeBoards(WORKDAY_BOARDS, discovered.workday, (b) => `${b.host}/${b.site.toLowerCase()}`),
      fetcher,
    ),
    smartRecruitersConnector(SMARTRECRUITERS_BOARDS, fetcher),
    simplifyNewGradConnector({}, fetcher),
    // LAST on purpose, so LinkedIn only contributes jobs the official feeds
    // didn't already cover. Note this is NOT simply "first occurrence wins":
    // `dedupPostings` lets a JD-bearing posting replace a JD-less earlier one,
    // so a LinkedIn duplicate can still displace a JD-less Simplify row (and
    // with it, Simplify's direct apply URL). In production each connector is
    // fetched and enriched in its own Inngest step, so cross-connector
    // collisions are resolved by `loadExistingFingerprints` rather than here.
    ...(linkedInEnabled() ? [linkedInGuestConnector(LINKEDIN_SEARCHES, fetcher)] : []),
    // After LinkedIn as well as the ATS feeds: this is the only metered source,
    // so it should contribute what nothing else already covers. Its postings
    // carry the publisher's own apply link, not an aggregator redirect, so a
    // collision here doesn't degrade the URL the board sends you to.
    ...(aggregatorKey ? [aggregatorConnector(aggregatorKey, AGGREGATOR_QUERIES, fetcher)] : []),
  ];
}
