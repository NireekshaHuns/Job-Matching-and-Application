import { createCallerFactory, createTRPCRouter } from './trpc';
import { applicationsRouter } from './routers/applications';
import { dashboardRouter } from './routers/dashboard';
import { healthRouter } from './routers/health';
import { jobsRouter } from './routers/jobs';
import { outreachRouter } from './routers/outreach';
import { profileRouter } from './routers/profile';
import { resumesRouter } from './routers/resumes';
import { sponsorsRouter } from './routers/sponsors';

export const appRouter = createTRPCRouter({
  health: healthRouter,
  jobs: jobsRouter,
  resumes: resumesRouter,
  applications: applicationsRouter,
  outreach: outreachRouter,
  profile: profileRouter,
  sponsors: sponsorsRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller — used in RSCs, tests, and Inngest steps. */
export const createCaller = createCallerFactory(appRouter);
