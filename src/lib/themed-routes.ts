/**
 * Routes already migrated to the token/dark-mode system. Pages not listed here
 * still use hardcoded light styling, so dark mode is kept off for them until they
 * migrate (see ThemeGuard). Add a route here as it's restyled in Phase 3.
 */
export const THEMED_ROUTES = new Set<string>(['/', '/jobs']);

export function isThemedRoute(pathname: string): boolean {
  return THEMED_ROUTES.has(pathname);
}
