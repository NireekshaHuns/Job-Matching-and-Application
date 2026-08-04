import { auth, signOut } from '@/auth';
import { isAuthConfigured } from '@/server/auth/config';

/**
 * Navbar auth slot (server component). Renders a sign-out control only when auth
 * is configured and a session exists; otherwise nothing (app is open).
 */
export async function AuthNav() {
  if (!isAuthConfigured()) return null;
  const session = await auth();
  if (!session?.user) return null;

  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/sign-in' });
      }}
    >
      <button
        type="submit"
        className="text-muted hover:text-fg text-sm transition-colors"
        title={session.user.email ?? undefined}
      >
        Sign out
      </button>
    </form>
  );
}
