/**
 * Per-board fetch outcomes for a single connector run.
 *
 * WHY THIS EXISTS. ATS tokens churn by roughly 20-40% a year, and a board that
 * starts returning 404 was previously swallowed by a bare `console.warn`: the
 * run still reported success, the board silently contributed zero postings, and
 * nothing anywhere said so. With 159 Greenhouse boards, a handful going dead is
 * invisible in the numbers but is exactly the kind of quiet decay that makes the
 * board look like it stopped finding jobs.
 *
 * A connector records failures here and the ingestion step reports the counts.
 */

/** How many failure strings to keep — enough to act on, not enough to bloat a step result. */
const MAX_REPORTED = 10;

export interface FetchReport {
  /** Boards (or pages) this connector tried to fetch. */
  attempted: number;
  /** How many came back non-OK. */
  failed: number;
  /** The first `MAX_REPORTED` failures, as `board -> HTTP 404`. */
  failures: string[];
}

export function emptyReport(): FetchReport {
  return { attempted: 0, failed: 0, failures: [] };
}

export function recordAttempt(report: FetchReport): void {
  report.attempted++;
}

/** Record a board that returned non-OK. Keeps only the first few messages. */
export function recordFailure(report: FetchReport, board: string, detail: string): void {
  report.failed++;
  if (report.failures.length < MAX_REPORTED) report.failures.push(`${board} -> ${detail}`);
}
