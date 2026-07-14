/**
 * Per-request tRPC context. Kept minimal during Phase 0 (just request headers).
 * Epic 1 adds the Drizzle `db` handle here for dependency injection, and later
 * epics add the authenticated user / session.
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  return { headers: opts.headers };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
