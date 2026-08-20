import { describe, expect, it } from 'vitest';
import { bulletMatchesRole, resumeSkillsFromBullets, type BulletLike } from './bullets';

const bullets: BulletLike[] = [
  { skills: ['Go', 'Postgres'], roleFamily: 'backend' },
  { skills: ['React'], roleFamily: 'frontend' },
  { skills: ['Communication'], roleFamily: null },
];

describe('bulletMatchesRole', () => {
  it('lets a generalist résumé see every bullet', () => {
    expect(bulletMatchesRole('backend', null)).toBe(true);
    expect(bulletMatchesRole(null, null)).toBe(true);
  });

  it('lets a role-agnostic bullet count for any résumé', () => {
    expect(bulletMatchesRole(null, 'frontend')).toBe(true);
  });

  it('keeps a specialised bullet out of a different role', () => {
    expect(bulletMatchesRole('frontend', 'backend')).toBe(false);
  });
});

describe('resumeSkillsFromBullets', () => {
  it('unions the skills a role can actually draw on', () => {
    expect(resumeSkillsFromBullets(bullets, 'backend').sort()).toEqual([
      'communication',
      'go',
      'postgres',
    ]);
  });

  it('gives a generalist everything', () => {
    expect(resumeSkillsFromBullets(bullets, null)).toHaveLength(4);
  });

  it('lowercases, trims and dedupes', () => {
    const dupes: BulletLike[] = [
      { skills: [' Go ', 'go'], roleFamily: null },
      { skills: ['GO'], roleFamily: null },
    ];
    expect(resumeSkillsFromBullets(dupes, null)).toEqual(['go']);
  });

  it('ignores empty skill entries', () => {
    expect(resumeSkillsFromBullets([{ skills: ['', '  '], roleFamily: null }], null)).toEqual([]);
  });
});
