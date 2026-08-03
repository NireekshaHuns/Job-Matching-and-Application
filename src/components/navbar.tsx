'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navIsActive } from './nav-active';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/tracker', label: 'Tracker' },
  { href: '/studio', label: 'Studio' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
] as const;

export function Navbar() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="border-b border-zinc-200">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-3 text-sm">
        <span className="font-semibold">H1B Board</span>
        {LINKS.map((link) => {
          const active = navIsActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={active ? 'font-medium text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
