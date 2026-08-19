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

/**
 * Fetch one board, turning any failure into a recorded outcome instead of a
 * thrown error.
 *
 * A connector walks a list of boards, and until this existed only non-OK
 * *responses* were survivable — a thrown network error took the whole run down
 * with it. Not hypothetical: a single `ECONNRESET` on 1 of 159 Greenhouse
 * boards aborted an entire refill, discarding the boards already fetched.
 * Transient TLS resets are ordinary at this fan-out, and one bad board must
 * cost exactly one board.
 *
 * Returns null when the board could not be read, having recorded why.
 */
export async function fetchBoard(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  board: string,
  report: FetchReport,
  init?: RequestInit,
): Promise<Response | null> {
  recordAttempt(report);
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    // Network-level: DNS failure, TLS reset, timeout. There is no response.
    recordFailure(report, board, (err as Error).message || 'network error');
    return null;
  }
  if (!res.ok) {
    recordFailure(report, board, `HTTP ${res.status}`);
    return null;
  }
  return res;
}
