import { describe, expect, it } from 'vitest';
import { RESUME_RUBRIC_PROMPT, WORD_MAX, WORD_MIN } from './rubric';

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

  it('has a sane word target', () => {
    expect(WORD_MIN).toBeLessThan(WORD_MAX);
  });
});
