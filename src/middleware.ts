import NextAuth from 'next-auth';
import { authConfig } from '@/server/auth/config';

// Edge middleware from the base config only (no Node deps). The `authorized`
// callback allows everything when auth is disabled, and otherwise redirects
// unauthenticated requests to /sign-in.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on all routes except static assets, the auth API, and the Inngest
  // webhook (external, session-less — must not be redirected when auth is on).
  matcher: ['/((?!api/auth|api/inngest|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
