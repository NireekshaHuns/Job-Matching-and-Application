/**
 * Manually run one Outlook confirmation reconcile: check the mailbox for
 * "application received" emails and flip the matching tracked applications.
 * The Inngest cron does this automatically; this is for on-demand runs.
 *
 * Prereq: MS_CLIENT_ID + MS_REFRESH_TOKEN in .env (see `pnpm outlook:auth`).
 *
 * Usage: pnpm outlook:reconcile
 */
import 'dotenv/config';
import { db } from '@/server/db';
import { graphMailClient, refreshAccessToken } from '@/server/outlook/graph';
import { runOutlookReconcile } from '@/server/outlook/reconcile-run';

async function main() {
  const clientId = process.env.MS_CLIENT_ID;
  const refreshToken = process.env.MS_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    throw new Error('Set MS_CLIENT_ID and MS_REFRESH_TOKEN in .env (run `pnpm outlook:auth`).');
  }
  const tenant = process.env.MS_TENANT || 'consumers';

  const mail = graphMailClient({
    fetch,
    getAccessToken: () => refreshAccessToken(fetch, { clientId, refreshToken, tenant }),
  });

  const stats = await runOutlookReconcile({ db, mail });
  console.log(
    `Reconcile done: ${stats.confirmed} confirmed of ${stats.pending} pending ` +
      `(${stats.messages} messages scanned).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
