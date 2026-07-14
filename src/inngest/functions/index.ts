import type { inngest } from '../client';

/**
 * Registry of Inngest functions served by the app. Empty during Phase 0;
 * ingestion (Epic 2) and enrichment (Epic 3) steps are appended here.
 * See the `enrichment-step` skill.
 */
export const functions: ReturnType<typeof inngest.createFunction>[] = [];
