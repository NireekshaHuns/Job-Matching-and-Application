import { describe, expect, it } from 'vitest';
import { navIsActive } from './nav-active';

describe('navIsActive', () => {
  it('matches Home only on the exact root', () => {
    expect(navIsActive('/', '/')).toBe(true);
    expect(navIsActive('/jobs', '/')).toBe(false);
  });

  it('matches a section link on itself and nested paths', () => {
    expect(navIsActive('/jobs', '/jobs')).toBe(true);
    expect(navIsActive('/jobs/123', '/jobs')).toBe(true);
    expect(navIsActive('/tracker', '/jobs')).toBe(false);
  });

  it('does not match a different section that shares a prefix string', () => {
    expect(navIsActive('/jobsearch', '/jobs')).toBe(false);
  });
});
