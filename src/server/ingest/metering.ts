/**
 * Spending rules for metered job sources.
 *
 * The aggregator (JSearch) is the only source that costs money per request:
 * roughly 200 requests a month on the free plan, and one run can spend 12. That
 * was survivable while ingestion only ran when the owner clicked a button. On an
 * hourly schedule it is not — 720 runs a month would exhaust the quota before
 * the first day was out, and the failure mode is silent, since an exhausted plan
 * answers 429 and the connector simply stops early.
 *
 * So a metered source runs at most once per calendar day, and stops entirely
 * once the month's budget is nearly gone. Pure: the caller supplies the recorded
 * usage and persists whatever comes back.
 */

/**
 * Requests we allow ourselves per calendar month, against a 200-request plan.
 * The gap is deliberate headroom — a run that overshoots its own per-run cap
 * must not be able to push us past the real limit.
 */
export const MONTHLY_REQUEST_BUDGET = 180;

/** Usage recorded for one calendar month. */
export interface MeteredUsage {
  /** `YYYY-MM`, so a new month starts a fresh budget with no reset job. */
  month: string;
  requestsUsed: number;
  /** ISO date (`YYYY-MM-DD`) of the last run, or null if it has never run. */
  lastRunDate: string | null;
}

/** `YYYY-MM` for a date, in UTC so a run near midnight can't double-count. */
export function usageMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` for a date, in UTC. */
export function usageDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface MeteredDecision {
  run: boolean;
  /** Why not, for the run summary. Empty when running. */
  reason: string;
}

/** Days in the calendar month `now` falls in, UTC. */
function daysInMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * How much of the month's budget is fair to have spent by now.
 *
 * A flat "once a day" rule does NOT fit the budget: at up to 12 requests a run,
 * 180 requests buys 15 days and the source then goes dark until the 1st. That is
 * worse than it sounds — `reconcileFreshness` closes any job unseen for 14 days,
 * so a two-week gap would auto-close every aggregator job and re-ingest it from
 * scratch next month, paying to classify jobs already held.
 *
 * Pacing against the day of the month spreads the same budget across all of it.
 */
function allowanceByNow(now: Date, budget: number): number {
  return (budget * now.getUTCDate()) / daysInMonth(now);
}

export interface MeteredOptions {
  budget?: number;
  /**
   * Let a run through even if one already happened today. Set for user-triggered
   * refreshes: the hourly cron claims the daily slot at 00:00 UTC — the evening
   * before, in US terms — so without this the "Find new jobs" button would never
   * reach the one source covering Indeed/Glassdoor/ZipRecruiter. The budget and
   * the pacing still apply.
   */
  ignoreDailyLimit?: boolean;
}

/**
 * Should a metered source fetch on this run?
 *
 * `null` usage means it has never run, which is a yes. A usage row from an
 * earlier month is also a yes: the budget is per calendar month, so a stale row
 * carries no spend into the new one.
 */
export function decideMeteredRun(
  usage: MeteredUsage | null,
  now: Date,
  opts: MeteredOptions = {},
): MeteredDecision {
  const budget = opts.budget ?? MONTHLY_REQUEST_BUDGET;
  const month = usageMonth(now);
  const today = usageDate(now);

  // A row from a previous month is spent budget that no longer applies.
  const current = usage && usage.month === month ? usage : null;
  const used = current?.requestsUsed ?? 0;

  if (used >= budget) {
    return { run: false, reason: `monthly budget spent (${used}/${budget} requests in ${month})` };
  }

  const allowance = allowanceByNow(now, budget);
  if (used >= allowance) {
    return {
      run: false,
      reason: `ahead of pace (${used} used, ${allowance.toFixed(0)} allowed by day ${now.getUTCDate()})`,
    };
  }

  if (!opts.ignoreDailyLimit && current?.lastRunDate === today) {
    return { run: false, reason: `already fetched today (${today})` };
  }
  return { run: true, reason: '' };
}

/** Usage after a run that spent `requests`. */
export function recordMeteredRun(
  usage: MeteredUsage | null,
  requests: number,
  now: Date,
): MeteredUsage {
  const month = usageMonth(now);
  const carried = usage && usage.month === month ? usage.requestsUsed : 0;
  return { month, requestsUsed: carried + requests, lastRunDate: usageDate(now) };
}
