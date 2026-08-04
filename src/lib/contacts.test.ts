import { describe, expect, it } from 'vitest';
import { categorizePerson } from './contacts';

describe('categorizePerson', () => {
  it('classifies recruiters (talent/sourcing/HR)', () => {
    expect(categorizePerson('Technical Recruiter')).toBe('recruiter');
    expect(categorizePerson('Talent Acquisition Partner')).toBe('recruiter');
    expect(categorizePerson('Sourcer')).toBe('recruiter');
    // Recruiter wins over manager when both appear.
    expect(categorizePerson('Recruiting Manager')).toBe('recruiter');
  });

  it('classifies hiring managers / leaders', () => {
    expect(categorizePerson('Engineering Manager')).toBe('manager');
    expect(categorizePerson('Director of Engineering')).toBe('manager');
    expect(categorizePerson('Head of Platform')).toBe('manager');
    expect(categorizePerson('VP, Engineering')).toBe('manager');
  });

  it('everything else is other', () => {
    expect(categorizePerson('Software Engineer')).toBe('other');
    expect(categorizePerson('Staff Engineer')).toBe('other');
    expect(categorizePerson(null)).toBe('other');
    expect(categorizePerson('')).toBe('other');
  });
});
