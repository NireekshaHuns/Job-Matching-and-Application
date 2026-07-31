import type { inngest } from '../client';
import { enrichJobs } from './enrich';
import { outlookReconcile } from './outlook-reconcile';
import { peopleCachePurge } from './people-cache-purge';

/**
 * Registry of Inngest functions served by the app. See the `enrichment-step`
 * skill. Add new durable functions here.
 */
export const functions: ReturnType<typeof inngest.createFunction>[] = [
  enrichJobs,
  outlookReconcile,
  peopleCachePurge,
];
