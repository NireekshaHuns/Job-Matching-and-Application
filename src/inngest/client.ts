import { Inngest } from 'inngest';

/**
 * Inngest client — the durable pipeline orchestrator. Ingestion + enrichment
 * functions register against this client and are served from
 * `src/app/api/inngest/route.ts`. Functions are added in Epics 2–3.
 */
export const inngest = new Inngest({ id: 'h1b-job-board' });
