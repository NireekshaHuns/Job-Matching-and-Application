import { createCallerFactory, createTRPCRouter } from './trpc';
import { healthRouter } from './routers/health';
import { jobsRouter } from './routers/jobs';
import { resumesRouter } from './routers/resumes';

export const appRouter = createTRPCRouter({
  health: healthRouter,
  jobs: jobsRouter,
  resumes: resumesRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller — used in RSCs, tests, and Inngest steps. */
export const createCaller = createCallerFactory(appRouter);
