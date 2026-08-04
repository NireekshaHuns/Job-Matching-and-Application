import type { NextAuthConfig } from 'next-auth';

/**
 * Auth is opt-in: it only gates the app when an owner + secret are configured
 * (like the app's other env-gated features). With none set, the app is open —
 * so CI/e2e and first-run dev work without any auth setup.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD);
}

/**
 * Edge-safe base config (no Node-only deps) — used by the middleware and spread
 * into the full config in `src/auth.ts`, which adds the Credentials provider.
 * The placeholder secret is only ever used while auth is disabled (the
 * `authorized` callback returns true then, so it's never used for real auth).
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET ?? 'insecure-placeholder-auth-disabled',
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      if (!isAuthConfigured()) return true; // auth off → everything is public
      const p = request.nextUrl.pathname;
      if (p.startsWith('/sign-in') || p.startsWith('/api/auth')) return true;
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
