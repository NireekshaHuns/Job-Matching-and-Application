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
import type { DiscoveredBoards } from './discover';
import type { Fetcher, JobConnector } from './types';

/** File written by `pnpm ats:discover` (git-ignored); merged over the seeds. */
const DISCOVERED_FILE = 'ats-boards.json';

function loadDiscoveredBoards(): Partial<DiscoveredBoards> {
  try {
    if (!existsSync(DISCOVERED_FILE)) return {};
    return JSON.parse(readFileSync(DISCOVERED_FILE, 'utf8')) as Partial<DiscoveredBoards>;
  } catch {
    return {};
  }
}

/** Merge seed + discovered boards, deduped by the given key. */
function mergeBoards<T>(seed: T[], discovered: T[] | undefined, key: (b: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const b of [...seed, ...(discovered ?? [])]) byKey.set(key(b).toLowerCase(), b);
  return [...byKey.values()];
}

/**
 * Hand-seeded starter tokens per ATS. A later ticket discovers more from the
 * SimplifyJobs listing URLs + public seed lists. Validate tokens against the
 * live API before relying on them (~20–40% churn at any time).
 */
export const GREENHOUSE_BOARDS: GreenhouseBoard[] = [
  { token: 'stripe', company: 'Stripe' },
  { token: 'databricks', company: 'Databricks' },
  { token: 'airbnb', company: 'Airbnb' },
];

export const LEVER_BOARDS: LeverBoard[] = [
  { token: 'netflix', company: 'Netflix' },
  { token: 'plaid', company: 'Plaid' },
];

export const ASHBY_BOARDS: AshbyBoard[] = [
  { board: 'ramp', company: 'Ramp' },
  { board: 'notion', company: 'Notion' },
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
    simplifyNewGradConnector({}, fetcher),
  ];
}
