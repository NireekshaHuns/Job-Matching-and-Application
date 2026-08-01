/**
 * Connector registry — the set of sources the ingestion cron will fan out to.
 * `buildConnectors` takes an injectable fetcher so it can be exercised with a
 * fixture client in tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { ashbyConnector, type AshbyBoard } from './connectors/ashby';
import { greenhouseConnector, type GreenhouseBoard } from './connectors/greenhouse';
import { leverConnector, type LeverBoard } from './connectors/lever';
import { simplifyNewGradConnector } from './connectors/simplify';
import { smartRecruitersConnector, type SmartRecruitersBoard } from './connectors/smartrecruiters';
import type { DiscoveredBoards } from './discover';
import type { Fetcher, JobConnector } from './types';

/** File written by `pnpm ats:discover` (git-ignored); merged with the seeds. */
const DISCOVERED_FILE = 'ats-boards.json';

/** Read the discovered-boards file (cwd-relative); degrade to `{}` if absent/malformed. */
export function loadDiscoveredBoards(file: string = DISCOVERED_FILE): Partial<DiscoveredBoards> {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<DiscoveredBoards>;
  } catch {
    return {};
  }
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
 * durable source of truth; `pnpm ats:discover` can still widen the net into
 * `ats-boards.json` (merged in, seeds win on collision). Tokens churn
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
  ];
}
