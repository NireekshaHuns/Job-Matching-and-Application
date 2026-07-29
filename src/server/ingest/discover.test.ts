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
});
