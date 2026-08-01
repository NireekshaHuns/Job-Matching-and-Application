import { describe, expect, it } from 'vitest';
import { looksLikeSwe } from './swe-title';

describe('looksLikeSwe', () => {
  it('keeps clear software roles', () => {
    for (const title of [
      'Software Engineer',
      'Senior Backend Developer',
      'Full Stack Engineer',
      'Front-End Engineer',
      'Staff ML Engineer',
      'Machine Learning Engineer, New Grad',
      'Site Reliability Engineer',
      'SRE II',
      'DevOps Engineer',
      'SDE II',
      'SDET',
      'Data Scientist',
      'Applied Scientist',
      'Member of Technical Staff',
      'Embedded Firmware Engineer',
      'iOS Developer',
      'Senior Golang Engineer',
      'Python Developer',
      'Security Engineer',
      'Data Engineer',
    ]) {
      expect(looksLikeSwe(title), title).toBe(true);
    }
  });

  it('keeps generic "engineer" titles (broad net for tech companies)', () => {
    expect(looksLikeSwe('Engineer II')).toBe(true);
    expect(looksLikeSwe('Engineering Intern')).toBe(true);
  });

  it('drops clear non-software roles', () => {
    for (const title of [
      'Junior Optical Technician',
      'SABR Analytics Conference Attendee',
      'Digital Production Coordinator',
      'Registered Nurse',
      'Account Executive',
      'Sales Engineer',
      'Enterprise Sales Representative',
      'Marketing Manager',
      'Product Manager',
      'Technical Program Manager',
      'Mechanical Engineer',
      'Electrical Engineer',
      'Recruiter',
      'Content Writer',
      'Graphic Designer',
      'Staff Accountant',
    ]) {
      expect(looksLikeSwe(title), title).toBe(false);
    }
  });

  it('drops titles with no software signal at all, and handles empty input', () => {
    expect(looksLikeSwe('Data Labeler')).toBe(false);
    expect(looksLikeSwe('Quantitative Analyst')).toBe(false);
    expect(looksLikeSwe('')).toBe(false);
    expect(looksLikeSwe(null)).toBe(false);
    expect(looksLikeSwe(undefined)).toBe(false);
  });
});
