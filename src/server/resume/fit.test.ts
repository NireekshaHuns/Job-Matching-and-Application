import { describe, expect, it } from 'vitest';
import { computeFit, resumeSkillsFromBullets, type BulletLike } from './fit';

describe('computeFit', () => {
  it('scores as-is coverage and splits gaps into addable vs true gaps', () => {
    const fit = computeFit({
      jobKeywords: ['go', 'kafka', 'grpc', 'terraform'],
      resumeSkills: ['go', 'kafka'], // already on the resume
      masterSkills: ['go', 'kafka', 'grpc'], // user also knows grpc (not on resume)
    });
    expect(fit.relevanceScore).toBe(50); // 2/4 on resume
    expect(fit.matched).toEqual(['go', 'kafka']);
    expect(fit.missingAddable).toEqual(['grpc']); // has it, tailor in
    expect(fit.missingGap).toEqual(['terraform']); // truly lacking
    expect(fit.achievableScore).toBe(75); // 3/4 reachable truthfully
  });

  it('returns 100 when the job lists no keywords', () => {
    const fit = computeFit({ jobKeywords: [], resumeSkills: [], masterSkills: [] });
    expect(fit.relevanceScore).toBe(100);
    expect(fit.achievableScore).toBe(100);
  });

  it('normalizes case/whitespace on both sides', () => {
    const fit = computeFit({
      jobKeywords: ['Go', ' Kafka '],
      resumeSkills: ['GO', 'kafka'],
      masterSkills: [],
    });
    expect(fit.relevanceScore).toBe(100);
  });
});

describe('resumeSkillsFromBullets', () => {
  const bullets: BulletLike[] = [
    { skills: ['go', 'postgresql'], roleFamily: 'backend' },
    { skills: ['react'], roleFamily: 'frontend' },
    { skills: ['git'], roleFamily: null }, // role-agnostic, always counts
  ];

  it('includes matching role_family bullets plus role-agnostic ones', () => {
    expect(resumeSkillsFromBullets(bullets, 'backend').sort()).toEqual(['git', 'go', 'postgresql']);
  });

  it('excludes other roles', () => {
    expect(resumeSkillsFromBullets(bullets, 'frontend').sort()).toEqual(['git', 'react']);
  });
});
