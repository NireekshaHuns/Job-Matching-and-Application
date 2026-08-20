import { describe, expect, it } from 'vitest';
import {
  decideMeteredRun,
  MONTHLY_REQUEST_BUDGET,
  recordMeteredRun,
  usageDate,
  usageMonth,
} from './metering';

const NOW = new Date('2026-08-19T14:00:00Z');

describe('decideMeteredRun', () => {
  it('runs a source that has never run', () => {
    expect(decideMeteredRun(null, NOW).run).toBe(true);
  });

  it('runs once a day, not once an hour', () => {
    // The whole point: 720 hourly runs a month against a ~200-request plan
    // would exhaust it inside a day, silently, since an exhausted plan 429s.
    const ranToday = { month: '2026-08', requestsUsed: 12, lastRunDate: '2026-08-19' };
    const decision = decideMeteredRun(ranToday, NOW);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain('already fetched today');
  });

  it('runs again the next day', () => {
    const ranYesterday = { month: '2026-08', requestsUsed: 12, lastRunDate: '2026-08-18' };
    expect(decideMeteredRun(ranYesterday, NOW).run).toBe(true);
  });

  it('paces spend across the month instead of front-loading it', () => {
    // A flat once-a-day rule does not fit the budget: at up to 12 requests a
    // run, 180 buys 15 days and the source goes dark until the 1st. Worse, the
    // 14-day staleness reconcile would then auto-close every job from it.
    const aheadOfPace = { month: '2026-08', requestsUsed: 150, lastRunDate: '2026-08-18' };
    const decision = decideMeteredRun(aheadOfPace, NOW);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain('ahead of pace');
  });

  it('runs when spend is behind the pace for the day', () => {
    // Day 19 of 31 allows ~110 of 180; 60 used is comfortably behind.
    const behind = { month: '2026-08', requestsUsed: 60, lastRunDate: '2026-08-18' };
    expect(decideMeteredRun(behind, NOW).run).toBe(true);
  });

  it('still has budget left at the end of the month', () => {
    // The pacing exists so the source is never dark for weeks: on the last day,
    // spend at pace is still under budget.
    const lastDay = new Date('2026-08-31T12:00:00Z');
    const atPace = { month: '2026-08', requestsUsed: 170, lastRunDate: '2026-08-30' };
    expect(decideMeteredRun(atPace, lastDay).run).toBe(true);
  });

  it('lets a user-triggered refresh through on a day the cron already ran', () => {
    // The hourly cron claims the daily slot at 00:00 UTC — the evening before,
    // in US terms — so without this the "Find new jobs" button would never reach
    // the one source covering Indeed/Glassdoor/ZipRecruiter.
    const ranToday = { month: '2026-08', requestsUsed: 12, lastRunDate: '2026-08-19' };
    expect(decideMeteredRun(ranToday, NOW, { ignoreDailyLimit: true }).run).toBe(true);
  });

  it('does not let a manual refresh escape the budget', () => {
    const spent = { month: '2026-08', requestsUsed: 200, lastRunDate: '2026-08-19' };
    expect(decideMeteredRun(spent, NOW, { ignoreDailyLimit: true }).run).toBe(false);
  });

  it('stops once the month is spent', () => {
    const spent = {
      month: '2026-08',
      requestsUsed: MONTHLY_REQUEST_BUDGET,
      lastRunDate: '2026-08-10',
    };
    const decision = decideMeteredRun(spent, NOW);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain('monthly budget spent');
  });

  it('treats last month as no spend at all', () => {
    // The budget is per calendar month, so a new month needs no reset job.
    const lastMonth = { month: '2026-07', requestsUsed: 999, lastRunDate: '2026-07-31' };
    expect(decideMeteredRun(lastMonth, NOW).run).toBe(true);
  });

  it('checks the budget before the daily rule', () => {
    // An exhausted month must stay shut even on a day it has not run.
    const spent = { month: '2026-08', requestsUsed: 500, lastRunDate: '2026-08-01' };
    expect(decideMeteredRun(spent, NOW).reason).toContain('monthly budget');
  });
});

describe('recordMeteredRun', () => {
  it('accumulates within a month', () => {
    const before = { month: '2026-08', requestsUsed: 24, lastRunDate: '2026-08-18' };
    expect(recordMeteredRun(before, 12, NOW)).toEqual({
      month: '2026-08',
      requestsUsed: 36,
      lastRunDate: '2026-08-19',
    });
  });

  it('starts from zero in a new month', () => {
    const lastMonth = { month: '2026-07', requestsUsed: 170, lastRunDate: '2026-07-31' };
    expect(recordMeteredRun(lastMonth, 12, NOW).requestsUsed).toBe(12);
  });

  it('records a run that spent nothing, so the daily rule still applies', () => {
    // A fetch that returned early still counts as today's attempt; otherwise a
    // failing source would be retried every hour for the rest of the day.
    expect(recordMeteredRun(null, 0, NOW)).toEqual({
      month: '2026-08',
      requestsUsed: 0,
      lastRunDate: '2026-08-19',
    });
  });
});

describe('usage keys', () => {
  it('are UTC, so a run near midnight cannot double-count', () => {
    const lateUtc = new Date('2026-08-31T23:30:00Z');
    expect(usageMonth(lateUtc)).toBe('2026-08');
    expect(usageDate(lateUtc)).toBe('2026-08-31');
  });
});
