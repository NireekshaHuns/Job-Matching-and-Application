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
  budget: number = MONTHLY_REQUEST_BUDGET,
): MeteredDecision {
  const month = usageMonth(now);
  const today = usageDate(now);

  // A row from a previous month is spent budget that no longer applies.
  const current = usage && usage.month === month ? usage : null;

  if (current && current.requestsUsed >= budget) {
    return {
      run: false,
      reason: `monthly budget spent (${current.requestsUsed}/${budget} requests in ${month})`,
    };
  }
  if (current?.lastRunDate === today) {
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
