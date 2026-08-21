import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';
import { dbErrorMessage } from './db-error';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // tRPC sends a procedure's error message verbatim, and Drizzle's message IS
    // the failed SQL plus its params — useless to a reader and needlessly
    // revealing. Database failures get a one-line explanation instead; every
    // other error keeps the message its thrower chose.
    return {
      ...shape,
      message: dbErrorMessage(error) ?? shape.message,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
