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
 * job for good; a parse that gives up only leaves a job unfiltered. Every
 * judgement call below is settled in that direction.
 */

/** Full-time hours per year, for annualizing an hourly rate. */
const HOURS_PER_YEAR = 2080;
/** Working days per year, for annualizing a day rate. */
const DAYS_PER_YEAR = 260;
/** Weeks and months, for the same reason. */
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;

/**
 * Currencies we refuse to read as USD. A bare "$" is treated as USD, but a
 * qualified one ("C$", "A$", "CA$") is not — those are the ones that would
 * otherwise sail through as dollars at roughly the wrong exchange rate.
 */
const NON_USD =
  /[€£¥₹₩₪]|\b(?:EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|SGD|HKD|SEK|NOK|DKK|PLN|BRL|MXN|ZAR|CNY|RMB|KRW|ILS|AED)\b|(?:^|[^A-Za-z])(?:C|A|CA|AU|NZ|HK|S|R|NT)\$/i;

/**
 * A money token: optional "$", digits with optional thousands separators and
 * cents, optional "k"/"m" magnitude suffix.
 *
 * The suffix must not be followed by another letter, or the "m" of
 * "$2,000 monthly housing stipend" reads as a magnitude and turns $2,000 into
 * $2 billion. Real data; it cost us that posting.
 */
const TOKEN = /(\$\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*([kKmM])(?![A-Za-z]))?/g;

/**
 * What may sit between the two ends of one range. Anything else — a comma, "+",
 * "/hr", the word "base" — means the next figure is a SEPARATE amount (a bonus,
 * a stipend, an unrelated number) rather than the top of this range.
 */
const RANGE_SEPARATOR = /^\s*(?:[-–—~]|to|through)\s*$/i;

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
      return amount * DAYS_PER_YEAR;
    case 'week':
      return amount * WEEKS_PER_YEAR;
    case 'month':
      return amount * MONTHS_PER_YEAR;
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

interface Token {
  value: number;
  /** Whether the figure carried a "$". */
  marked: boolean;
  /** Whether a magnitude suffix ("k"/"m") set the scale explicitly. */
  scaled: boolean;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const [whole, dollar, digits, suffix] = m;
    const start = m.index ?? 0;
    // Skip percentages ("+ 0.5% equity"), which are equity, not pay.
    if (/^\s*%/.test(text.slice(start + whole.length))) continue;

    let value = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    switch (suffix?.toLowerCase()) {
      case 'k':
        value *= 1_000;
        break;
      case 'm':
        value *= 1_000_000;
        break;
    }

    tokens.push({
      value,
      marked: Boolean(dollar),
      scaled: Boolean(suffix),
      start,
      end: start + whole.length,
    });
  }
  return tokens;
}

/**
 * The figures that make up the pay range, and nothing else.
 *
 * Anchored on the first dollar-marked figure (or the first figure at all when
 * none is marked), then extended across range separators only. Two things fall
 * out of that, both of which the previous "every marked token" reading got
 * wrong:
 *
 *  - "$120,000 - 165,000" keeps BOTH ends. Postings routinely write the "$"
 *    once, and reading only marked figures capped that job at $120,000 — which
 *    hid it at the $150k threshold, permanently, since enrichment never
 *    re-runs on an existing job. Exactly the failure this module exists to avoid.
 *  - "$150,000 base + $20,000 bonus" stops at the base. A signing bonus is not
 *    the bottom of the salary range.
 */
function payExpression(tokens: Token[], text: string): Token[] {
  const anchor = tokens.findIndex((t) => t.marked);
  const first = anchor === -1 ? 0 : anchor;
  const expression = [tokens[first]];

  for (let i = first; i + 1 < tokens.length; i++) {
    const gap = text.slice(tokens[i].end, tokens[i + 1].start).replace(/\$/g, '');
    if (!RANGE_SEPARATOR.test(gap)) break;
    expression.push(tokens[i + 1]);
  }
  return expression;
}

/**
 * Is this text talking about money at all? Without a "$" somewhere we need
 * another signal — "USD", a k/m suffix, or a stated period — or a bare number
 * gets read as pay. "401(k) match" is the case that matters: 401 annualizes as
 * an hourly rate to $834,080 and fabricates a salary for a posting that states
 * none. Deliberately does NOT count the word "salary", which is exactly what
 * a posting says when it is about to not give you a number.
 */
function statesMoney(text: string, tokens: Token[]): boolean {
  if (tokens.some((t) => t.marked || t.scaled)) return true;
  if (/\bUSD\b/i.test(text)) return true;
  if (detectPeriod(text) !== 'year') return true;
  return /\bper\s+(?:year|annum)\b|\bannually\b/i.test(text);
}

/**
 * Read annualized USD bounds out of a pay string, or null when the text states
 * no usable USD figure (empty, non-USD, equity-only, unparseable).
 */
export function parseSalaryRange(text: string | null | undefined): SalaryRange | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || NON_USD.test(trimmed)) return null;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0 || !statesMoney(trimmed, tokens)) return null;

  const expression = payExpression(tokens, trimmed);
  const period = detectPeriod(trimmed);

  // Decided ONCE for the whole range, not per figure: reading "$1,500 - $2,500"
  // as $3.12M–$2,500 (one end hourly, the other annual) is worse than not
  // reading it at all, and the mixed result then fails the band check below —
  // which is the conservative outcome this module wants.
  const unlabelledRate =
    period === 'year' && expression.every((t) => !t.scaled && t.value < RATE_CEILING);
  const effective: Period = unlabelledRate ? 'hour' : period;

  const annual = expression.map((t) => Math.round(annualize(t.value, effective)));
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
