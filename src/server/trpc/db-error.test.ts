import { describe, expect, it } from 'vitest';
import { dbErrorMessage } from './db-error';

/** An error shaped like the one a driver/ORM actually throws. */
function err(name: string, message: string, cause?: Error): Error {
  const e = new Error(message, cause ? { cause } : undefined);
  e.name = name;
  return e;
}

/** Drizzle's wrapper: the message is the whole statement plus bound params. */
function drizzleWrap(cause: Error): Error {
  return err(
    'DrizzleQueryError',
    'Failed query: select "id", "company", "title" from "jobs" where "jobs"."status" = $1 order by "jobs"."id" desc limit $2 params: active,50',
    cause,
  );
}

/** How tRPC hands a procedure failure to `errorFormatter`. */
function trpcWrap(cause: Error): Error {
  return err('TRPCError', cause.message, cause);
}

const neonQuota = err(
  'NeonDbError',
  'Server error (HTTP status 402): {"message":"Your project has exceeded the data transfer quota. Upgrade your plan to increase limits.","code":"","detail":null}',
);

describe('dbErrorMessage', () => {
  it('explains a Neon plan-quota rejection instead of dumping the query', () => {
    const message = dbErrorMessage(trpcWrap(drizzleWrap(neonQuota)));

    expect(message).toContain('over its plan quota');
    expect(message).toContain('exceeded the data transfer quota');
    // The point of the exercise: no SQL, no bound params.
    expect(message).not.toContain('select');
    expect(message).not.toContain('params');
  });

  it('recognises a quota message that arrives without the 402 envelope', () => {
    const message = dbErrorMessage(
      drizzleWrap(err('NeonDbError', 'compute time quota exceeded for this project')),
    );

    expect(message).toContain('over its plan quota');
  });

  it('keeps a real Postgres complaint, which is the only useful line', () => {
    const message = dbErrorMessage(
      drizzleWrap(err('NeonDbError', 'column "sponsor_match_confidence" does not exist')),
    );

    expect(message).toBe('Database error — column "sponsor_match_confidence" does not exist');
  });

  it('names an unreachable database rather than calling it a query error', () => {
    const message = dbErrorMessage(drizzleWrap(err('TypeError', 'fetch failed')));

    expect(message).toBe("Can't reach the database — fetch failed");
  });

  it('falls back to the HTTP status when the envelope is not JSON we know', () => {
    const message = dbErrorMessage(
      drizzleWrap(err('NeonDbError', 'Server error (HTTP status 500): {oops')),
    );

    expect(message).toBe('Database error — the database rejected the request (HTTP 500).');
  });

  it('still says something when the dump is all there is', () => {
    expect(dbErrorMessage(drizzleWrap(err('NeonDbError', '')))).toBe(
      'Database error — the query failed.',
    );
  });

  it('leaves non-database errors alone, so deliberate messages survive', () => {
    expect(dbErrorMessage(trpcWrap(err('Error', 'Inngest is not configured')))).toBeNull();
    expect(dbErrorMessage(new Error('boom'))).toBeNull();
    expect(dbErrorMessage('boom')).toBeNull();
    expect(dbErrorMessage(undefined)).toBeNull();
  });

  it('truncates a driver message that turns out to be another dump', () => {
    const message = dbErrorMessage(drizzleWrap(err('NeonDbError', 'x'.repeat(1000))));

    expect(message).toMatch(/…$/);
    expect(message!.length).toBeLessThan(300);
  });

  it('prefers the deepest cause over the wrappers above it', () => {
    const deep = err('NeonDbError', 'relation "jobs" does not exist');
    const middle = err('DrizzleQueryError', 'Failed query: select 1 params: ', deep);
    const outer = err('TRPCError', 'something went wrong', middle);

    expect(dbErrorMessage(outer)).toBe('Database error — relation "jobs" does not exist');
  });
});
