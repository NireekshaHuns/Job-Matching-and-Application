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

  it('keeps software roles that never say "software"', () => {
    // All real titles from a live fetch of enterprise Workday boards, where 270
    // of 1,373 titles were being dropped. A drop here is unrecoverable: the
    // posting never reaches the DB, so it can never be re-examined.
    const titles = [
      'Data Architect, Charles River Development, Vice President',
      'Solution Architect, VP II',
      'Principal UI Architect, AVP',
      'API Technical Lead, VP',
      'Application Development / Maintenance, AVP',
      'Java Development Associate',
      'Systems Analyst, Officer',
      'Technology Analyst',
      'Applications Analyst',
      'Technology Consultant, Senior Associate',
      'Quality Assurance, Officer',
      'Manager, CI/CD Infrastructure - Open Source Accelerated Computing',
      'Database Administrator',
      'Python Engineer, Trading Systems',
      'React Developer',
    ];
    for (const title of titles) expect(looksLikeSwe(title), title).toBe(true);
  });

  it('still drops the non-software roles those boards are full of', () => {
    const titles = [
      'Named Account Executive, Federal Civilian',
      'Customer Success Manager, Senior Manager - FinTech',
      'Business Development Manager, Ecosystem GTM',
      'Channel Development Manager',
      'Sales Development Specialist - Nordics',
      'Product Manager - Analytics, AI Private Markets',
      'Executive Communications & Presentation Designer - Manager',
      'Senior UI/UX Designer, AVP',
      'Private Equity Senior Analyst',
      'Business Analyst - Server Framework, hybrid, Officer',
    ];
    for (const title of titles) expect(looksLikeSwe(title), title).toBe(false);
  });

  it('does not let a widened pattern rescue a non-software compound', () => {
    // "architect" is now a positive signal, and positives normally win — which
    // is why these are checked ahead of everything else.
    expect(looksLikeSwe('Landscape Architect')).toBe(false);
    expect(looksLikeSwe('Naval Architect, Senior')).toBe(false);
    expect(looksLikeSwe('Interior Architect')).toBe(false);
    expect(looksLikeSwe('Data Entry Clerk')).toBe(false);
  });
});
