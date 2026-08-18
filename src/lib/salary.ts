/**
 * Parse the free-text pay range the classifier lifts out of a JD
 * (`jobs.salary_text`) into annualized USD bounds.
 *
 * WHY THIS EXISTS. `salary_text` is a display string copied from the posting —
 * "$110,000–$164,000", "$143k–$191k", "$60,000 - $80,000 per year". Useful to
 * read, useless to filter on. The board's "Min pay" filter needs a number, so
 * enrichment parses each posting ONCE into `salary_min_usd` / `salary_max_usd`
 * and the query filters on the column. Parsing is deterministic and free, so
 * existing rows are backfilled rather than re-classified (see the cost-control
 * invariant in CLAUDE.md).
 *
 * DELIBERATELY CONSERVATIVE. Anything ambiguous returns null, and null means
 * "unknown pay", which the board KEEPS. A parse that guesses wrong hides a real
 * job for good; a parse that gives up only leaves a job unfiltered.
 */

/** Full-time hours per year, for annualizing an hourly rate. */
const HOURS_PER_YEAR = 2080;

/**
 * Currencies we refuse to read as USD. A bare "$" is treated as USD, but a
 * qualified one ("C$", "A$", "CA$") is not — those are the ones that would
 * otherwise sail through as dollars at roughly the wrong exchange rate.
 */
const NON_USD =
  /[€£¥₹₩₪]|\b(?:EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|SGD|HKD|SEK|NOK|DKK|PLN|BRL|MXN|ZAR|CNY|RMB|KRW|ILS|AED)\b|(?:^|[^A-Za-z])(?:C|A|CA|AU|NZ|HK|S|R|NT)\$/i;

/**
 * A money token: optional "$", digits with optional thousands separators and
 * cents, optional "k"/"m" magnitude suffix. Captured so the caller can tell a
 * dollar-marked number from a bare one.
 *
 * The suffix must not be followed by another letter, or the "m" of
 * "$2,000 monthly housing stipend" reads as a magnitude and turns $2,000 into
 * $2 billion. Real data; it cost us that posting.
 */
const TOKEN = /(\$\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*([kKmM])(?![A-Za-z]))?/g;

export interface SalaryRange {
  /** Bottom of the stated range, annualized USD. Equal to `maxUsd` for a single figure. */
  minUsd: number;
  /** Top of the stated range, annualized USD — what the "Min pay" filter compares against. */
  maxUsd: number;
}

/** Rate period stated by the text; annual when nothing says otherwise. */
type Period = 'year' | 'hour' | 'month' | 'week' | 'day';

function detectPeriod(text: string): Period {
  if (/(?:\/|\bper\s+|\ban\s+)(?:hr|hour)\b|\bhourly\b/i.test(text)) return 'hour';
  if (/(?:\/|\bper\s+|\ba\s+)(?:mo|month)\b|\bmonthly\b/i.test(text)) return 'month';
  if (/(?:\/|\bper\s+|\ba\s+)(?:wk|week)\b|\bweekly\b/i.test(text)) return 'week';
  if (/(?:\/|\bper\s+|\ba\s+)day\b|\bdaily\b/i.test(text)) return 'day';
  return 'year';
}

function annualize(amount: number, period: Period): number {
  switch (period) {
    case 'hour':
      return amount * HOURS_PER_YEAR;
    case 'day':
      return amount * 260;
    case 'week':
      return amount * 52;
    case 'month':
      return amount * 12;
    case 'year':
      return amount;
  }
}

/**
 * An unsuffixed figure this small cannot be an annual salary, so it is a rate
 * the text failed to label — "$70–$90" is $70/hour, not $70/year. Annualizing
 * it as hourly is the only reading that isn't nonsense.
 */
const RATE_CEILING = 2_000;

/**
 * Sanity band for the final annual figure; outside it, we don't trust the parse.
 * The floor sits just below full-time federal minimum wage ($7.25 × 2080 ≈
 * $15,080), so a stray "$5" that annualizes to $10,400 is rejected as noise
 * rather than recorded as somebody's salary.
 */
const MIN_ANNUAL = 15_000;
const MAX_ANNUAL = 10_000_000;

/**
 * Read annualized USD bounds out of a pay string, or null when the text states
 * no usable USD figure (empty, non-USD, equity-only, unparseable).
 */
export function parseSalaryRange(text: string | null | undefined): SalaryRange | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || NON_USD.test(trimmed)) return null;

  const period = detectPeriod(trimmed);

  interface Token {
    value: number;
    /** Whether the figure carried a "$" — used to ignore stray numbers. */
    marked: boolean;
    /** Whether a magnitude suffix ("k"/"m") set the scale explicitly. */
    scaled: boolean;
  }
  const tokens: Token[] = [];

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(trimmed); m !== null; m = TOKEN.exec(trimmed)) {
    const [, dollar, digits, suffix] = m;
    // Skip percentages ("+ 0.5% equity") and year-like mentions ("2026 bonus"),
    // neither of which is pay.
    const after = trimmed.slice(m.index + m[0].length);
    if (/^\s*%/.test(after)) continue;

    let value = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (suffix === 'k' || suffix === 'K') value *= 1_000;
    else if (suffix === 'm' || suffix === 'M') value *= 1_000_000;

    tokens.push({ value, marked: Boolean(dollar), scaled: Boolean(suffix) });
  }

  // When any figure is dollar-marked, the unmarked ones are context ("2 years
  // experience"), not pay — with the exception of the tail of a range written
  // "$120,000 - 165,000", which the marked-only set already covers well enough.
  const marked = tokens.filter((t) => t.marked);
  const usable = marked.length > 0 ? marked : tokens;
  if (usable.length === 0) return null;

  const annual = usable.map((t) => {
    // An unsuffixed sub-$2k figure in a range the text never labelled is an
    // unlabelled hourly rate; a "$150k" figure is never reinterpreted.
    const effective: Period =
      period === 'year' && !t.scaled && t.value < RATE_CEILING ? 'hour' : period;
    return Math.round(annualize(t.value, effective));
  });

  const minUsd = Math.min(...annual);
  const maxUsd = Math.max(...annual);
  if (maxUsd < MIN_ANNUAL || maxUsd > MAX_ANNUAL) return null;

  return { minUsd, maxUsd };
}

/**
 * The "Min pay" predicate, as a pure function — the SQL in the jobs router
 * mirrors it exactly.
 *
 * Two deliberate choices, both leaning toward showing the job:
 *  - A posting that states no pay (`maxUsd` null) always passes. Most postings
 *    are silent; hiding them would cut the board to a fraction of itself, and
 *    "never discard unknown" is the same rule sponsorship tiering follows.
 *  - The comparison is against the TOP of the stated range, so
 *    "$90,000 - $155,000" survives a $100k minimum. The question is whether the
 *    job could pay enough, not whether it's guaranteed to.
 */
export function meetsMinSalary(maxUsd: number | null | undefined, minimum: number): boolean {
  if (minimum <= 0) return true;
  if (maxUsd == null) return true;
  return maxUsd >= minimum;
}
