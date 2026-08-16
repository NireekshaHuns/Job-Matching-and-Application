/**
 * Connector registry — the set of sources the ingestion cron will fan out to.
 * `buildConnectors` takes an injectable fetcher so it can be exercised with a
 * fixture client in tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { ashbyConnector, type AshbyBoard } from './connectors/ashby';
import { greenhouseConnector, type GreenhouseBoard } from './connectors/greenhouse';
import { leverConnector, type LeverBoard } from './connectors/lever';
import { linkedInGuestConnector, type LinkedInSearch } from './connectors/linkedin';
import { simplifyNewGradConnector } from './connectors/simplify';
import { smartRecruitersConnector, type SmartRecruitersBoard } from './connectors/smartrecruiters';
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
  };
}

/**
 * Merge seed + discovered boards, deduped by the given key. Seeds win on a key
 * collision: they are the curated, code-reviewed source of truth, whereas the
 * discovered file is machine-generated and its `company` label can drift (which
 * would change job fingerprints). Discovery only *adds* boards, never overrides.
 */
export function mergeBoards<T>(seed: T[], discovered: T[] | undefined, key: (b: T) => string): T[] {
  const byKey = new Map<string, T>();
  // Discovered first, then seed, so seed entries overwrite on collision.
  for (const b of [...(discovered ?? []), ...seed]) byKey.set(key(b).toLowerCase(), b);
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

export function buildConnectors(fetcher: Fetcher = globalThis.fetch): JobConnector[] {
  const discovered = loadDiscoveredBoards();
  const greenhouse = mergeBoards(GREENHOUSE_BOARDS, discovered.greenhouse, (b) => b.token);
  const lever = mergeBoards(LEVER_BOARDS, discovered.lever, (b) => b.token);
  const ashby = mergeBoards(ASHBY_BOARDS, discovered.ashby, (b) => b.board);

  return [
    greenhouseConnector(greenhouse, fetcher),
    leverConnector(lever, fetcher),
    ashbyConnector(ashby, fetcher),
    smartRecruitersConnector(SMARTRECRUITERS_BOARDS, fetcher),
    simplifyNewGradConnector({}, fetcher),
    // LAST on purpose: `dedupPostings` keeps the first occurrence of a
    // fingerprint, so the official ATS feeds above win any collision and
    // LinkedIn only contributes jobs they didn't already cover.
    ...(linkedInEnabled() ? [linkedInGuestConnector(LINKEDIN_SEARCHES, fetcher)] : []),
  ];
}
