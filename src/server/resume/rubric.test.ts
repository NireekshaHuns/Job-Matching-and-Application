import { describe, expect, it } from 'vitest';
import { BUZZWORDS, RESUME_RUBRIC_PROMPT, WEAK_VERBS, WORD_MAX, WORD_MIN } from './rubric';

describe('RESUME_RUBRIC_PROMPT', () => {
  it('encodes the non-negotiable rules', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    expect(p).toContain('truthful');
    expect(p).toContain('never invent');
    expect(p).toContain('xyz');
    expect(p).toContain('keyword-stuff');
    expect(p).toContain(`${WORD_MIN}`);
    expect(p).toContain(`${WORD_MAX}`);
  });

  it('tells the model exactly what the linter penalizes (no drift)', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    for (const weak of WEAK_VERBS) expect(p).toContain(weak);
    for (const buzz of BUZZWORDS) expect(p).toContain(buzz);
  });

  it('has a sane word target', () => {
    expect(WORD_MIN).toBeLessThan(WORD_MAX);
  });

  it('instructs the model to preserve template structure (headings + PROJECTS)', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    expect(p).toContain('heading');
    expect(p).toContain('projects');
    expect(p).toContain('verbatim');
  });
});
