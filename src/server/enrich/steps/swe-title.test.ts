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

  it('lets a software signal win over a disqualifier (lenient, never false-drops)', () => {
    // "embedded"/"software" beat the "hardware engineer"/"sales engineer" denylist.
    expect(looksLikeSwe('Embedded Hardware Engineer')).toBe(true);
    expect(looksLikeSwe('Software Sales Engineer')).toBe(true);
    // ...but the plain disqualified forms (no software signal) still drop.
    expect(looksLikeSwe('Hardware Engineer')).toBe(false);
    expect(looksLikeSwe('Sales Engineer')).toBe(false);
  });

  it('keeps new-grad SWE titles (the board is new-grad focused)', () => {
    for (const title of [
      'Software Engineer, New Grad 2026',
      'Software Development Engineer I',
      'University Grad - Software Engineer',
      'Associate Software Engineer',
    ]) {
      expect(looksLikeSwe(title), title).toBe(true);
    }
  });

  it('keeps software-adjacent roles whose titles never say "engineer"', () => {
    for (const title of [
      'Technical Product Manager',
      'Tech Product Manager',
      'Technical Program Manager',
      'TPM, Platform',
      'Product Manager, Developer Tools',
      'Software Analyst',
      'Systems Analyst',
      'Solutions Architect',
      'Cloud Architect',
      'Solutions Engineer',
      'Developer Advocate',
      'Tech Lead',
      'Engineering Manager',
      'Director of Engineering',
      'Database Administrator',
      'Research Scientist',
    ]) {
      expect(looksLikeSwe(title), title).toBe(true);
    }
  });

  it('keeps the abbreviations that read as noise but are real SWE titles', () => {
    for (const title of ['FDE', 'Forward Deployed Engineer', 'SRE II', 'MLOps Engineer', 'SDET']) {
      expect(looksLikeSwe(title), title).toBe(true);
    }
  });

  it('still drops an UNQUALIFIED product/program/project manager', () => {
    // The technical-PM patterns require a qualifier precisely so this stays out:
    // a bare "Product Manager" is usually a business role.
    for (const title of ['Product Manager', 'Program Manager', 'Project Manager', 'Scrum Master']) {
      expect(looksLikeSwe(title), title).toBe(false);
    }
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
      // 'Technical Program Manager' was here. Deliberate policy change: the
      // filter is now lenient toward software-ADJACENT titles, so a technical
      // PM/TPM is kept and only the unqualified "Product Manager" is dropped.
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
