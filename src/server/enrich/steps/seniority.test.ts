import { describe, expect, it } from 'vitest';
import { resolveSeniority, titleSignalsSenior } from './seniority';

describe('titleSignalsSenior', () => {
  it('detects explicit senior / staff / principal levels', () => {
    for (const title of [
      'Senior Software Engineer',
      'Sr. Forward Deployed Engineer',
      'Sr Software Engineer, Backend',
      'Staff Software Engineer - Unistore',
      'Sr. Staff Fullstack Engineer',
      'Principal Software Engineer',
      'Distinguished Engineer',
    ]) {
      expect(titleSignalsSenior(title), title).toBe(true);
    }
  });

  it('detects lead and management titles', () => {
    for (const title of [
      'Technical Lead, Payments',
      'Lead Engineer',
      'Engineering Manager - Transformation',
      'Director of Engineering',
      'Head of Platform',
      'VP, Engineering',
      'Chief Architect',
      'Solutions Architect',
    ]) {
      expect(titleSignalsSenior(title), title).toBe(true);
    }
  });

  it('detects level suffixes from III upward, but not I or II', () => {
    expect(titleSignalsSenior('Software Engineer III')).toBe(true);
    expect(titleSignalsSenior('Software Engineer IV')).toBe(true);
    expect(titleSignalsSenior('Software Engineer L6')).toBe(true);
    // Early-career levels stay visible.
    expect(titleSignalsSenior('Software Engineer II')).toBe(false);
    expect(titleSignalsSenior('Software Engineer I')).toBe(false);
    expect(titleSignalsSenior('Software Engineer L3')).toBe(false);
  });

  it('does not fire on unlevelled titles — the rows this module exists to unhide', () => {
    for (const title of [
      'Software Engineer',
      'Software Engineer - Ads Product',
      'Full Stack Engineer',
      'Software Development Engineer',
      'Web Developer',
      'Backend Engineer, Payments',
      'New Grad Software Engineer',
      'Artificial Intelligence Software Engineer - Development Infrastructure',
    ]) {
      expect(titleSignalsSenior(title), title).toBe(false);
    }
  });

  it('matches on word boundaries, so "Leading"/"Leadership" do not count as "Lead"', () => {
    expect(titleSignalsSenior('Leading Edge Systems Engineer')).toBe(false);
    expect(titleSignalsSenior('Engineer, Leadership Tools')).toBe(false);
    expect(titleSignalsSenior('Engineer, Lead Generation Platform')).toBe(true); // "Lead" is a word here
  });

  it('handles missing input', () => {
    expect(titleSignalsSenior(null)).toBe(false);
    expect(titleSignalsSenior(undefined)).toBe(false);
    expect(titleSignalsSenior('   ')).toBe(false);
  });
});

describe('resolveSeniority', () => {
  it('rescues an unlevelled title the model graded senior', () => {
    expect(resolveSeniority('Software Engineer', 'other')).toBe('mid');
    expect(resolveSeniority('Full Stack Engineer', 'other')).toBe('mid');
  });

  it('leaves a genuinely senior title alone', () => {
    expect(resolveSeniority('Senior Software Engineer', 'other')).toBe('other');
    expect(resolveSeniority('Staff Software Engineer', 'other')).toBe('other');
    expect(resolveSeniority('Engineering Manager', 'other')).toBe('other');
  });

  it('never promotes: entry and mid pass through untouched', () => {
    // Even when the title screams senior, the model's non-`other` call wins —
    // "New Grad Software Engineer II" is entry-level whatever the numeral says.
    expect(resolveSeniority('Senior Software Engineer', 'entry')).toBe('entry');
    expect(resolveSeniority('Staff Engineer', 'mid')).toBe('mid');
    expect(resolveSeniority('Software Engineer', 'entry')).toBe('entry');
    expect(resolveSeniority('Software Engineer', 'mid')).toBe('mid');
  });

  it('treats a missing title as unlevelled', () => {
    expect(resolveSeniority(null, 'other')).toBe('mid');
  });
});
