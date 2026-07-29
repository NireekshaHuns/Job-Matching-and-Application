/**
 * Durable Outlook reconcile. On a cron, checks the mailbox for application-
 * confirmation emails and flips the matching tracked applications to confirmed.
 *
 * Like `enrich`, all heavy/env-bound imports are dynamic and inside the step so
 * registering this function never pulls secrets at import time. If the Graph
 * credentials aren't configured (MS_CLIENT_ID / MS_REFRESH_TOKEN), it no-ops —
 * the app runs fine without Outlook set up.
 */
import { inngest } from '../client';

export const outlookReconcile = inngest.createFunction(
  {
    id: 'outlook-reconcile',
    // Serialize: overlapping runs would race on the same pending applications.
    concurrency: { limit: 1 },
    triggers: [{ cron: '0 */3 * * *' }],
  },
  async ({ step }) => {
    return step.run('reconcile-confirmations', async () => {
      const clientId = process.env.MS_CLIENT_ID;
      const refreshToken = process.env.MS_REFRESH_TOKEN;
      if (!clientId || !refreshToken) {
        return { skipped: 'MS_CLIENT_ID / MS_REFRESH_TOKEN not configured' };
      }

      const { neon } = await import('@neondatabase/serverless');
      const { drizzle } = await import('drizzle-orm/neon-http');
      const schema = await import('@/server/db/schema');
      const { graphMailClient, refreshAccessToken } = await import('@/server/outlook/graph');
      const { runOutlookReconcile } = await import('@/server/outlook/reconcile-run');

      const db = drizzle(neon(process.env.DATABASE_URL ?? ''), { schema });
      const tenant = process.env.MS_TENANT || 'consumers';
      const mail = graphMailClient({
        fetch,
        getAccessToken: () => refreshAccessToken(fetch, { clientId, refreshToken, tenant }),
      });

      return runOutlookReconcile({ db, mail });
    });
  },
);
