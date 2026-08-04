'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

/**
 * Light/dark toggle. The icon is chosen purely by the `.dark` class (set by
 * next-themes before hydration), so there's no mount-state or hydration flash.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle light/dark theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="border-border text-muted hover:text-fg inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}
