/**
 * Client-safe messages for database failures.
 *
 * Drizzle wraps every driver failure in an error whose message is the ENTIRE SQL
 * statement plus its bound params, and tRPC hands procedure error messages
 * straight to the browser — so a Neon quota rejection painted a 700-character
 * `select … params: 85,15,30,…` dump across the job board where one sentence
 * belongs, with the actual cause nowhere on screen. The useful part always sits
 * further down the `cause` chain (the driver's own message), so walk to it,
 * name the failures we can recognise, and never let the query text out.
 */

/** Deepest cause worth quoting; the chain is short in practice. */
const MAX_LINKS = 8;
/** Driver messages are one line; anything longer is a dump, not an explanation. */
const MAX_DETAIL = 240;

/** Drizzle's wrapper message — the SQL dump, always dropped. */
const QUERY_DUMP = /^Failed query:/;
/** Errors that mean "this was a database call", by constructor name. */
const DB_ERROR_NAMES = new Set([
  'DrizzleError',
  'DrizzleQueryError',
  'NeonDbError',
  'PostgresError',
]);
/** Neon reports its own refusals as `Server error (HTTP status 402): {json}`. */
const NEON_WRAPPER = /^Server error \(HTTP status (\d+)\):\s*([\s\S]*)$/;
/** Plan limits: Neon answers 402 and says which quota ran out. */
const QUOTA = /quota|exceeded .*limit/i;
/** Nothing answered — wrong host, cold start timeout, no network. */
const UNREACHABLE = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out/i;

function causeChain(error: unknown): Error[] {
  const links: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && links.length < MAX_LINKS) {
    links.push(current);
    current = current.cause;
  }
  return links;
}

function isDbError(err: Error): boolean {
  return DB_ERROR_NAMES.has(err.name) || QUERY_DUMP.test(err.message);
}

/** HTTP status Neon rejected the request with, when this link carries one. */
function neonStatus(err: Error): number | null {
  const status = NEON_WRAPPER.exec(err.message)?.[1];
  return status ? Number(status) : null;
}

/**
 * One link's message with the noise removed: the SQL dump becomes nothing, and
 * Neon's JSON envelope becomes the sentence inside it.
 */
function detailOf(err: Error): string {
  if (QUERY_DUMP.test(err.message)) return '';
  const body = NEON_WRAPPER.exec(err.message)?.[2];
  if (!body) return err.message.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? (parsed as { message?: unknown }).message
        : null;
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    // Envelope we don't recognise: the status alone is still true and useful.
    return '';
  }
}

function truncate(detail: string): string {
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL - 1).trimEnd()}…` : detail;
}

/**
 * A short, honest message for a database failure, or `null` when the error is
 * not one — callers keep their own message in that case, so a deliberate
 * `TRPCError` ("Inngest is not configured") is never rewritten.
 */
export function dbErrorMessage(error: unknown): string | null {
  const chain = causeChain(error);
  if (!chain.some(isDbError)) return null;

  // Deepest first: the driver knows more than the wrapper above it.
  const detail = chain
    .map(detailOf)
    .reverse()
    .find((m) => m.length > 0);
  const status = chain.map(neonStatus).find((s) => s != null);

  if (status === 402 || (detail && QUOTA.test(detail))) {
    return `Database unavailable — the Neon project is over its plan quota. ${
      detail ? truncate(detail) : 'Queries resume when the quota resets.'
    }`;
  }
  if (detail && UNREACHABLE.test(detail)) {
    return `Can't reach the database — ${truncate(detail)}`;
  }
  if (detail) return `Database error — ${truncate(detail)}`;
  return status != null
    ? `Database error — the database rejected the request (HTTP ${status}).`
    : 'Database error — the query failed.';
}
