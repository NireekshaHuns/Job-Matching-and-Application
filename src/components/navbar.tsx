'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isThemedRoute } from '@/lib/themed-routes';
import { ThemeToggle } from './theme-toggle';
import { navIsActive } from './nav-active';

const LINKS = [
  { href: '/jobs', label: 'Jobs' },
  { href: '/studio', label: 'Studio' },
  { href: '/tracker', label: 'Tracker' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
] as const;

export function Navbar({ authSlot }: { authSlot?: ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="border-border bg-bg/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3 text-sm">
        <Link
          href="/"
          className="group font-display flex items-center gap-2 text-base font-semibold"
        >
          <span
            aria-hidden
            className="bg-brand inline-block h-4 w-4 rounded-[5px] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand)_22%,transparent)] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[18deg]"
          />
          Sponsorpath
        </Link>
        <div className="flex items-center gap-5">
          {LINKS.map((link) => {
            const active = navIsActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`after:bg-brand relative transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-full after:origin-left after:rounded-full after:transition-transform after:duration-200 hover:after:scale-x-100 ${
                  active
                    ? 'text-fg font-medium after:scale-x-100'
                    : 'text-muted hover:text-fg after:scale-x-0'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-4">
          {isThemedRoute(pathname) && <ThemeToggle />}
          {authSlot}
        </div>
      </div>
    </nav>
  );
}
