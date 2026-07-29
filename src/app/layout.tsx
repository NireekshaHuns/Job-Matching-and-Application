import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { TRPCReactProvider } from '@/trpc/react';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'H1B Job Board',
  description: 'H1B-focused job board + application tracker, ranked against real sponsorship data.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TRPCReactProvider>
          <nav className="border-b border-zinc-200">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-3 text-sm">
              <span className="font-semibold">H1B Board</span>
              <Link href="/" className="text-zinc-600 hover:text-zinc-900">
                Board
              </Link>
              <Link href="/tracker" className="text-zinc-600 hover:text-zinc-900">
                Tracker
              </Link>
            </div>
          </nav>
          {children}
        </TRPCReactProvider>
      </body>
    </html>
  );
}
