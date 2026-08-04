import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { isAuthConfigured } from '@/server/auth/config';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAuthConfigured()) redirect('/');
  const { error } = await searchParams;

  async function authenticate(formData: FormData) {
    'use server';
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo: '/',
      });
    } catch (err) {
      if (err instanceof AuthError) redirect('/sign-in?error=1');
      throw err; // re-throw the NEXT_REDIRECT that signIn uses on success
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-muted mt-1 text-sm">Sign in to Sponsorpath.</p>

      {error && (
        <p className="mt-4 rounded-md border border-rose-300/60 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-300">
          Incorrect email or password.
        </p>
      )}

      <form action={authenticate} className="mt-6 flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
          className="border-border bg-surface focus:border-brand rounded-md border px-3 py-2 text-sm focus:outline-none"
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          className="border-border bg-surface focus:border-brand rounded-md border px-3 py-2 text-sm focus:outline-none"
        />
        <button
          type="submit"
          className="bg-brand text-brand-contrast rounded-md px-4 py-2 text-sm font-medium transition-transform hover:-translate-y-0.5"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
