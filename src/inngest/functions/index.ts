import type { inngest } from '../client';
import { enrichJobs } from './enrich';

/**
 * Registry of Inngest functions served by the app. See the `enrichment-step`
 * skill. Add new durable functions here.
 */
export const functions: ReturnType<typeof inngest.createFunction>[] = [enrichJobs];
