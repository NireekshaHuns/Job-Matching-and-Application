import { createCallerFactory, createTRPCRouter } from './trpc';
import { healthRouter } from './routers/health';

export const appRouter = createTRPCRouter({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller — used in RSCs, tests, and Inngest steps. */
export const createCaller = createCallerFactory(appRouter);
