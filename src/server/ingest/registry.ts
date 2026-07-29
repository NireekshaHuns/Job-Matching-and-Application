/**
 * Connector registry — the set of sources the ingestion cron will fan out to.
 * `buildConnectors` takes an injectable fetcher so it can be exercised with a
 * fixture client in tests.
 */
import { ashbyConnector, type AshbyBoard } from './connectors/ashby';
import { greenhouseConnector, type GreenhouseBoard } from './connectors/greenhouse';
import { leverConnector, type LeverBoard } from './connectors/lever';
import { simplifyNewGradConnector } from './connectors/simplify';
import type { Fetcher, JobConnector } from './types';

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
  return [
    greenhouseConnector(GREENHOUSE_BOARDS, fetcher),
    leverConnector(LEVER_BOARDS, fetcher),
    ashbyConnector(ASHBY_BOARDS, fetcher),
    simplifyNewGradConnector({}, fetcher),
  ];
}
