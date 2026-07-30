/**
 * Whether a nav link is the active route. Pure (no Next imports) so it's
 * unit-testable without pulling the client router into tests. Home (`/`) matches
 * exactly; other links match themselves or any nested path under them.
 */
export function navIsActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
