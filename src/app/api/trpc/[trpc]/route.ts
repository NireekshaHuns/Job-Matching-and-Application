import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createTRPCContext } from '@/server/trpc/context';
import { appRouter } from '@/server/trpc/root';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    // The client only ever sees the sanitized message (see `errorFormatter`), so
    // the full error — SQL, params, cause chain — has to land somewhere. Server
    // logs are that somewhere.
    onError: ({ error, path }) => {
      console.error(`[trpc] ${path ?? '<unknown>'} failed:`, error);
    },
  });

export { handler as GET, handler as POST };
