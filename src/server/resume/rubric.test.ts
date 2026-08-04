import { describe, expect, it } from 'vitest';
import { BUZZWORDS, RESUME_RUBRIC_PROMPT, WEAK_VERBS, WORD_MAX, WORD_MIN } from './rubric';

describe('RESUME_RUBRIC_PROMPT', () => {
  it('encodes the core formatting/quality rules', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    expect(p).toContain('xyz');
    expect(p).toContain('keyword-stuff');
    expect(p).toContain('one page');
    expect(p).toContain(`${WORD_MIN}`);
    expect(p).toContain(`${WORD_MAX}`);
  });

  it('is stance-neutral on truthfulness (each caller sets its own stance)', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    // The shared rubric must not force "never invent" — the corpus flow allows
    // aggressive-but-coherent invention; the legacy path adds its own ban.
    expect(p).not.toContain('never invent');
  });

  it('tells the model exactly what the linter penalizes (no drift)', () => {
    const p = RESUME_RUBRIC_PROMPT.toLowerCase();
    for (const weak of WEAK_VERBS) expect(p).toContain(weak);
    for (const buzz of BUZZWORDS) expect(p).toContain(buzz);
  });

  it('has a sane word target', () => {
    expect(WORD_MIN).toBeLessThan(WORD_MAX);
  });
});
