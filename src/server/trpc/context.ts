import { db } from '@/server/db';

/**
 * Per-request tRPC context: request headers plus the Drizzle `db` handle
 * (dependency-injected, so routers use `ctx.db` rather than importing the
 * env-bound client — which also keeps the router graph import-clean for tests).
 * Later epics add the authenticated user / session.
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  return { headers: opts.headers, db };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
