import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { functions } from '@/inngest/functions';

/**
 * Each Inngest step is served by one invocation of this route, so the step has
 * to fit in `maxDuration`. Ask for the most the platform allows; the enrichment
 * function is split into per-source steps precisely so it fits (see
 * `src/inngest/functions/enrich.ts`).
 */
export const maxDuration = 300;
// The connectors and the OpenAI SDK need Node APIs, not the edge runtime.
export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({ client: inngest, functions });
