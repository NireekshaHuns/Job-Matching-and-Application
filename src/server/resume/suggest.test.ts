import { describe, expect, it } from 'vitest';
import { SKILL_CATALOG } from './skill-catalog';
import { suggestSkills } from './suggest';

describe('SKILL_CATALOG', () => {
  it('covers all domains, not just languages/frameworks', () => {
    const skills = new Set(SKILL_CATALOG.map((s) => s.skill));
    for (const expected of [
      'jira',
      'trello',
      'confluence',
      'figma',
      'github copilot',
      'langchain',
      'rag',
      'prompt engineering',
      'kubernetes',
      'terraform',
      'pandas',
      'agile',
      'system design',
      'communication',
      'cross-functional collaboration',
    ]) {
      expect(skills.has(expected)).toBe(true);
    }
  });

  it('tags soft skills as soft and tools as technical', () => {
    const byName = new Map(SKILL_CATALOG.map((s) => [s.skill, s.kind]));
    expect(byName.get('communication')).toBe('soft');
    expect(byName.get('jira')).toBe('technical');
  });
});

describe('suggestSkills', () => {
  const catalog = [
    { skill: 'go', kind: 'technical' as const },
    { skill: 'jira', kind: 'technical' as const },
    { skill: 'communication', kind: 'soft' as const },
  ];

  it('excludes skills already in the inventory (case-insensitive)', () => {
    const out = suggestSkills({
      catalog,
      jobTechKeywords: [],
      jobSoftKeywords: [],
      existing: ['Go'],
    });
    expect(out.map((s) => s.skill)).not.toContain('go');
    expect(out.map((s) => s.skill)).toContain('jira');
  });

  it('adds job keywords the catalog missed, with kind by source', () => {
    const out = suggestSkills({
      catalog,
      jobTechKeywords: ['kafka'],
      jobSoftKeywords: ['ownership'],
      existing: [],
    });
    expect(out).toContainEqual({ skill: 'kafka', kind: 'technical' });
    expect(out).toContainEqual({ skill: 'ownership', kind: 'soft' });
  });

  it('de-duplicates across catalog and job keywords', () => {
    const out = suggestSkills({
      catalog,
      jobTechKeywords: ['go', 'jira'],
      jobSoftKeywords: [],
      existing: [],
    });
    expect(out.filter((s) => s.skill === 'jira')).toHaveLength(1);
  });

  it('sorts technical before soft', () => {
    const out = suggestSkills({ catalog, jobTechKeywords: [], jobSoftKeywords: [], existing: [] });
    const firstSoft = out.findIndex((s) => s.kind === 'soft');
    const lastTech = out.map((s) => s.kind).lastIndexOf('technical');
    expect(lastTech).toBeLessThan(firstSoft);
  });
});
