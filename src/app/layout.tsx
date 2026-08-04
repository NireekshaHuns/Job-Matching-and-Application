import type { Metadata } from 'next';
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthNav } from '@/components/auth-nav';
import { Navbar } from '@/components/navbar';
import { ThemeGuard } from '@/components/theme-guard';
import { ThemeProvider } from '@/components/theme-provider';
import { TRPCReactProvider } from '@/trpc/react';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
});

export const metadata: Metadata = {
  title: 'Sponsorpath — H-1B jobs, scored against real data',
  description:
    'A job board that scores each employer’s H-1B sponsorship likelihood against real US government data, then tailors your résumé and tracks every application.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="bg-bg text-fg flex min-h-full flex-col">
        <ThemeProvider>
          <ThemeGuard />
          <TRPCReactProvider>
            <Navbar authSlot={<AuthNav />} />
            {children}
          </TRPCReactProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
