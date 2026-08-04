'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { isThemedRoute } from '@/lib/themed-routes';

/**
 * Keeps not-yet-migrated pages in light mode. Those pages use hardcoded
 * zinc/white, so a dark body would make them unreadable — until each is
 * restyled (added to THEMED_ROUTES), force light when navigating to one.
 */
export function ThemeGuard() {
  const pathname = usePathname() ?? '/';
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!isThemedRoute(pathname)) setTheme('light');
  }, [pathname, setTheme]);
  return null;
}
