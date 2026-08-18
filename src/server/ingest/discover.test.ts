import { describe, expect, it } from 'vitest';
import { extractAtsBoards } from './discover';

describe('extractAtsBoards', () => {
  it('extracts Greenhouse, Lever, and Ashby tokens with the company', () => {
    const boards = extractAtsBoards([
      { url: 'https://boards.greenhouse.io/stripe/jobs/123', company: 'Stripe' },
      { url: 'https://job-boards.greenhouse.io/databricks/jobs/9', company: 'Databricks' },
      { url: 'https://jobs.lever.co/netflix/abc-1', company: 'Netflix' },
      { url: 'https://jobs.ashbyhq.com/ramp?gh=1', company: 'Ramp' },
      { url: 'https://example.com/careers/1', company: 'Ignored' },
    ]);
    expect(boards.greenhouse).toEqual([
      { token: 'stripe', company: 'Stripe' },
      { token: 'databricks', company: 'Databricks' },
    ]);
    expect(boards.lever).toEqual([{ token: 'netflix', company: 'Netflix' }]);
    expect(boards.ashby).toEqual([{ board: 'ramp', company: 'Ramp' }]);
  });

  it('dedupes by token (first company wins) and ignores blank companies', () => {
    const boards = extractAtsBoards([
      { url: 'https://boards.greenhouse.io/stripe/jobs/1', company: 'Stripe' },
      { url: 'https://boards.greenhouse.io/stripe/jobs/2', company: 'Stripe Inc' },
      { url: 'https://jobs.lever.co/plaid/x', company: '  ' },
    ]);
    expect(boards.greenhouse).toEqual([{ token: 'stripe', company: 'Stripe' }]);
    expect(boards.lever).toEqual([]);
  });

  it('reads the real token from Greenhouse embed apply URLs (not the literal "embed")', () => {
    const boards = extractAtsBoards([
      { url: 'https://boards.greenhouse.io/embed/job_app?for=stripe&token=42', company: 'Stripe' },
      { url: 'https://boards.greenhouse.io/embed/job_app?gh_jid=7&for=figure', company: 'Figure' },
    ]);
    expect(boards.greenhouse).toEqual([
      { token: 'stripe', company: 'Stripe' },
      { token: 'figure', company: 'Figure' },
    ]);
  });

  it('does not match an ATS host embedded in another URL', () => {
    const boards = extractAtsBoards([
      { url: 'https://evil.com/?u=boards.greenhouse.io/attacker/jobs/1', company: 'Evil' },
      { url: 'https://track.example.com/r?to=jobs.lever.co/attacker', company: 'Evil' },
    ]);
    expect(boards.greenhouse).toEqual([]);
    expect(boards.lever).toEqual([]);
  });

  it('keeps dotted Lever/Ashby slugs intact', () => {
    const boards = extractAtsBoards([
      { url: 'https://jobs.ashbyhq.com/openai.com/some-job', company: 'OpenAI' },
      { url: 'https://jobs.lever.co/acme.io/role-1', company: 'Acme' },
    ]);
    expect(boards.ashby).toEqual([{ board: 'openai.com', company: 'OpenAI' }]);
    expect(boards.lever).toEqual([{ token: 'acme.io', company: 'Acme' }]);
  });

  it('preserves the original token case (Greenhouse API paths are case-sensitive)', () => {
    const boards = extractAtsBoards([
      { url: 'https://boards.greenhouse.io/Stripe/jobs/1', company: 'Stripe' },
      { url: 'https://boards.greenhouse.io/stripe/jobs/2', company: 'Stripe Dupe' },
    ]);
    // Deduped case-insensitively (one entry) but the first token's case is kept.
    expect(boards.greenhouse).toEqual([{ token: 'Stripe', company: 'Stripe' }]);
  });

  it('reads the three coordinates a Workday board needs', () => {
    // Every Workday apply-URL used to be discarded, which is how a live State
    // Street requisition stayed invisible while an older one for the same role
    // came through the Simplify repo.
    const { workday } = extractAtsBoards([
      {
        url: 'https://statestreet.wd1.myworkdayjobs.com/Global/job/Burlington-Massachusetts/Software-Engineer--CRD--New-Graduate_R-792647',
        company: 'State Street',
      },
    ]);
    expect(workday).toEqual([
      {
        host: 'statestreet.wd1.myworkdayjobs.com',
        tenant: 'statestreet',
        site: 'Global',
        company: 'State Street',
      },
    ]);
  });

  it('skips the locale segment some Workday URLs carry', () => {
    const { workday } = extractAtsBoards([
      {
        url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Engineer_JR123',
        company: 'NVIDIA',
      },
    ]);
    expect(workday[0]).toMatchObject({ tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' });
  });

  it('ignores a Workday URL with no career-site segment', () => {
    // The CXS path needs the site and it cannot be guessed.
    const { workday } = extractAtsBoards([
      { url: 'https://acme.wd1.myworkdayjobs.com/job/Boston/Engineer_R-1', company: 'Acme' },
    ]);
    expect(workday).toEqual([]);
  });

  it('keeps two career sites published by one tenant', () => {
    const { workday } = extractAtsBoards([
      { url: 'https://acme.wd1.myworkdayjobs.com/External/job/Boston/A_R-1', company: 'Acme' },
      { url: 'https://acme.wd1.myworkdayjobs.com/Campus/job/Boston/B_R-2', company: 'Acme' },
    ]);
    expect(workday.map((b) => b.site)).toEqual(['External', 'Campus']);
  });

  it('does not read a Workday host out of a redirect parameter', () => {
    const { workday } = extractAtsBoards([
      { url: 'https://evil.example/?u=acme.wd1.myworkdayjobs.com/External/job/x', company: 'Evil' },
    ]);
    expect(workday).toEqual([]);
  });
});
