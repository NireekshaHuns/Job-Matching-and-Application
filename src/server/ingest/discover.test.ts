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
});
