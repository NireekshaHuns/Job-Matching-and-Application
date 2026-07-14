import { createTRPCRouter, publicProcedure } from '../trpc';

export const healthRouter = createTRPCRouter({
  check: publicProcedure.query(() => ({ status: 'ok' as const })),
});
