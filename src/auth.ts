import { timingSafeEqual } from 'node:crypto';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from '@/server/auth/config';

/** Constant-time string compare so credential checks don't leak length/timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize(creds) {
        const email = process.env.OWNER_EMAIL;
        const password = process.env.OWNER_PASSWORD;
        if (!email || !password) return null;
        const e = typeof creds?.email === 'string' ? creds.email : '';
        const pw = typeof creds?.password === 'string' ? creds.password : '';
        if (
          safeEqual(e.trim().toLowerCase(), email.trim().toLowerCase()) &&
          safeEqual(pw, password)
        ) {
          return { id: 'owner', email };
        }
        return null;
      },
    }),
  ],
});
