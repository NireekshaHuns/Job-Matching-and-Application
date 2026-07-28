/**
 * Connector registry — the set of sources the ingestion cron will fan out to.
 * `buildConnectors` takes an injectable fetcher so it can be exercised with a
 * fixture client in tests.
 */
import { greenhouseConnector, type GreenhouseBoard } from './connectors/greenhouse';
import { simplifyNewGradConnector } from './connectors/simplify';
import type { Fetcher, JobConnector } from './types';

/**
 * Starter set of Greenhouse boards. Hand-seeded for now; a later ticket will
 * discover more tokens from the SimplifyJobs listing URLs. Tokens should be
 * validated against the live board API before relying on them.
 */
export const GREENHOUSE_BOARDS: GreenhouseBoard[] = [
  { token: 'stripe', company: 'Stripe' },
  { token: 'databricks', company: 'Databricks' },
  { token: 'airbnb', company: 'Airbnb' },
];

export function buildConnectors(fetcher: Fetcher = globalThis.fetch): JobConnector[] {
  return [greenhouseConnector(GREENHOUSE_BOARDS, fetcher), simplifyNewGradConnector({}, fetcher)];
}
