import { describe, expect, it } from 'vitest';
import { meetsMaxYears, parseRequiredYears } from './experience';

describe('parseRequiredYears', () => {
  it('reads the common phrasings', () => {
    expect(parseRequiredYears('5+ years of experience building APIs')).toBe(5);
    expect(parseRequiredYears('At least 2 years of professional experience.')).toBe(2);
    expect(parseRequiredYears('Minimum of three years of relevant experience')).toBe(3);
    expect(parseRequiredYears('7 yrs experience with distributed systems')).toBe(7);
  });

  it('takes the bottom of a stated range', () => {
    // One year of experience qualifies you to apply for a 1-3 year role.
    expect(parseRequiredYears('1-3 years of professional experience required')).toBe(1);
    expect(parseRequiredYears('three to five years of experience')).toBe(3);
    expect(parseRequiredYears('2–4 years of experience in backend development')).toBe(2);
  });

  it('takes the lowest figure when a posting states several', () => {
    // The larger figures are sub-requirements on one technology; reading them
    // would hide a role whose real bar is the smaller number.
    const jd = '5+ years of engineering experience. 2+ years of experience with Kubernetes.';
    expect(parseRequiredYears(jd)).toBe(2);
  });

  it('does not hang on a long whitespace run', () => {
    // The years pattern has three `\\s*` runs separated by optional groups, so an
    // un-normalized run that never reaches "years" split cubically — 96 seconds
    // for one posting, inside a durable step that would then retry.
    const started = Date.now();
    expect(parseRequiredYears(`5${' '.repeat(8000)}`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ignores the company talking about itself', () => {
    expect(parseRequiredYears('Founded 10 years ago, we build tools.')).toBeNull();
    expect(parseRequiredYears('CRD has grown 135% over the last 5 years of operation.')).toBeNull();
    // Real posting: this gave a *Quantitative Developer Intern* a 30-year bar.
    expect(
      parseRequiredYears(
        'Building on more than 30 years of investing experience, Point72 seeks to deliver returns.',
      ),
    ).toBeNull();
    // "ago" can only FOLLOW the figure, so a guard tested against the preceding
    // text never ran. These read as 12- and 10-year requirements.
    expect(
      parseRequiredYears('Our company was founded 12 years ago. Experience the difference.'),
    ).toBeNull();
    expect(
      parseRequiredYears('Founded 10 years ago, we bring deep experience to every client.'),
    ).toBeNull();
    expect(parseRequiredYears('Join a team with 15 years of combined experience.')).toBeNull();
  });

  it('still counts a real requirement alongside a company blurb', () => {
    expect(
      parseRequiredYears(
        'Our 100 years of experience speak for us. 7+ years of experience required.',
      ),
    ).toBe(7);
  });

  it('needs the figure to be about experience at all', () => {
    expect(parseRequiredYears('The contract runs for 3 years.')).toBeNull();
    expect(parseRequiredYears('We have offices in 5 countries.')).toBeNull();
    expect(parseRequiredYears('401(k) matching and 4 weeks of vacation')).toBeNull();
  });

  it('floors a decimal instead of reading its tail as a separate figure', () => {
    // The "5" of "3.5" must never become a 5-year requirement.
    expect(parseRequiredYears('3.5 years of experience')).toBe(3);
    expect(parseRequiredYears('Over 1.5 years of experience with Go')).toBe(1);
  });

  it('returns null when the posting says nothing', () => {
    expect(parseRequiredYears(null)).toBeNull();
    expect(parseRequiredYears(undefined)).toBeNull();
    expect(parseRequiredYears('')).toBeNull();
    expect(parseRequiredYears('We are looking for a great engineer.')).toBeNull();
  });

  it('accepts a stated zero', () => {
    expect(parseRequiredYears('0-2 years of experience; new grads welcome')).toBe(0);
  });

  it('reads a requirement written before the noun', () => {
    expect(parseRequiredYears('Experience: 4+ years in software development')).toBe(4);
  });
});

describe('meetsMaxYears', () => {
  it('keeps postings that state no requirement', () => {
    // About a third say nothing, and silence is not the same as seniority.
    expect(meetsMaxYears(null, 3)).toBe(true);
  });

  it('is inclusive at the ceiling', () => {
    expect(meetsMaxYears(3, 3)).toBe(true);
    expect(meetsMaxYears(4, 3)).toBe(false);
  });

  it('keeps everything when no ceiling is set', () => {
    expect(meetsMaxYears(15, 0)).toBe(true);
  });
});
