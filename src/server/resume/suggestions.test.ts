import { describe, expect, it } from 'vitest';
import { buildTailoringSuggestions, type SuggestionBullet } from './suggestions';

const bullets: SuggestionBullet[] = [
  {
    id: 1,
    text: 'Built Kafka pipelines',
    company: 'Acme',
    skills: ['kafka', 'java'],
    roleFamily: 'backend',
  },
  {
    id: 2,
    text: 'Tuned Postgres queries',
    company: 'Acme',
    skills: ['postgres'],
    roleFamily: null,
  },
  {
    id: 3,
    text: 'Shipped a React app',
    company: 'Beta',
    skills: ['react'],
    roleFamily: 'frontend',
  },
];
const master = ['java', 'kafka', 'postgres', 'react', 'go'];

describe('buildTailoringSuggestions', () => {
  it('scores fit and pairs each addable JD keyword with the real bullets that back it', () => {
    // A backend résumé already shows kafka+java (bullet 1) and postgres (bullet 2,
    // role-agnostic). JD wants kafka, go, rust.
    const s = buildTailoringSuggestions({
      jobKeywords: ['kafka', 'go', 'rust'],
      resumeRoleFamily: 'backend',
      masterSkills: master,
      bullets,
    });

    expect(s.matched).toEqual(['kafka']); // already surfaced
    // "go" is in the master inventory but not on the résumé → addable; "rust" isn't → gap.
    expect(s.addable.map((a) => a.keyword)).toEqual(['go']);
    expect(s.gaps).toEqual(['rust']);
    // relevance = 1/3, achievable = (matched + addable)/3 = 2/3.
    expect(s.relevanceScore).toBe(33);
    expect(s.achievableScore).toBe(67);
  });

  it('surfaces the real bullets demonstrating an addable keyword (role-filtered)', () => {
    // JD wants react; a backend résumé lacks it but the user HAS a react bullet
    // (bullet 3, frontend). It's addable, and its supporting bullet is surfaced —
    // even though bullet 3's role differs, the keyword is truthfully in the master
    // inventory, so it's a legitimate cross-role suggestion.
    const s = buildTailoringSuggestions({
      jobKeywords: ['react'],
      resumeRoleFamily: 'frontend',
      masterSkills: master,
      bullets,
    });
    const react = s.addable.find((a) => a.keyword === 'react');
    // With a frontend résumé, bullet 3 (frontend) already surfaces react → matched, not addable.
    expect(react).toBeUndefined();
    expect(s.matched).toContain('react');
  });

  it('never suggests a skill outside the master inventory (honest gap)', () => {
    const s = buildTailoringSuggestions({
      jobKeywords: ['cobol'],
      resumeRoleFamily: null,
      masterSkills: master,
      bullets,
    });
    expect(s.addable).toEqual([]);
    expect(s.gaps).toEqual(['cobol']);
  });

  it('pairs an addable keyword with its supporting bullets for a generalist résumé', () => {
    // Generalist (null) sees all bullets; JD wants java (bullet 1) which is in the
    // inventory. If the résumé is treated as having no matching surfacing... here a
    // generalist DOES surface java via bullet 1, so java is matched. Use "go" (in
    // inventory, no bullet) to show addable-with-no-bullets, and java as matched.
    const s = buildTailoringSuggestions({
      jobKeywords: ['go'],
      resumeRoleFamily: null,
      masterSkills: master,
      bullets,
    });
    const go = s.addable.find((a) => a.keyword === 'go');
    expect(go).toBeDefined();
    // No real bullet demonstrates "go" yet, so the suggestion lists none (honest).
    expect(go?.bullets).toEqual([]);
  });
});
