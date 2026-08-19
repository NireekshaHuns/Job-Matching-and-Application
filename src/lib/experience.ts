/**
 * Pull the years of experience a posting requires out of its description.
 *
 * WHY THIS EXISTS. The board is scoped to roles a new-ish grad can actually get,
 * and `seniority` (entry | mid | other) is too coarse for that — it is inferred
 * from the TITLE, so a plain "Software Engineer" that demands eight years reads
 * exactly like one that demands none. About 30% of active postings state a
 * number in the description; this reads it so the board can filter on it.
 *
 * DELIBERATELY LENIENT, in two ways:
 *
 *  - A posting that states nothing returns null, which the board KEEPS. Same
 *    rule as sponsorship and pay: never discard unknown.
 *  - Where a description states several figures ("5+ years of engineering
 *    experience... 2+ years with Kubernetes"), the LOWEST wins. The extra
 *    figures are usually sub-requirements on one technology, and reading the
 *    largest would hide roles whose real bar is the smaller number.
 */

/** Spelled-out counts that show up in requirement lines. */
const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
};

/** A count, spelled or numeric, with an optional decimal ("3.5 years"). */
const NUMBER = `\\d{1,2}(?:\\.\\d)?|${Object.keys(WORD_NUMBERS).join('|')}`;

/**
 * A count followed by a years unit, optionally as a range ("1-3 years",
 * "three to five years"). The leading boundary excludes a decimal tail, so the
 * "5" of "3.5" is never read as its own figure.
 */
const YEARS = new RegExp(
  `(?:^|[^\\w.])(${NUMBER})\\s*(?:\\+|plus)?\\s*(?:(?:-|–|—|to|through)\\s*(?:${NUMBER})\\s*)?\\+?\\s*(?:years?|yrs?)\\b`,
  'gi',
);

/**
 * How far after the figure we still accept an "experience" mention. Long enough
 * for "5 years of hands-on professional software engineering experience",
 * short enough that the next bullet's wording can't be borrowed.
 */
const CONTEXT_CHARS = 90;

/**
 * Phrasings BEFORE the figure that mean the years belong to the company, not the
 * candidate — "grown 135% over the last 5 years".
 */
const NOT_A_REQUIREMENT_BEFORE = /\b(?:last|past|next|over the|for the|founded)\s*$/i;

/**
 * The same, AFTER the figure. "ago" can only ever follow it, so testing it
 * against the preceding text — as this once did — made the guard unreachable:
 * "Our company was founded 12 years ago. Experience the difference." read as a
 * 12-year requirement and hid a new-grad posting.
 */
const NOT_A_REQUIREMENT_AFTER = /^\s*(?:ago\b|of\s+combined\b)/i;

/**
 * A believable requirement. No software posting asks for more than this, so a
 * bigger figure is the company talking about itself — "Building on more than 30
 * years of investing experience, Point72 seeks…" is the exact line that gave a
 * *Quantitative Developer Intern* posting a 30-year requirement. The figure is
 * skipped; any other figure in the posting still counts.
 */
const MAX_YEARS = 20;

function toNumber(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower];
  const n = Number(lower);
  // Floored: "3.5 years of experience" is a 3-year bar for filtering purposes.
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Years of experience the posting asks for, or null when it never says.
 *
 * The figure is the BOTTOM of whatever it states: "1-3 years" is 1, because one
 * year of experience qualifies you to apply.
 */
export function parseRequiredYears(jdText: string | null | undefined): number | null {
  if (!jdText) return null;

  // Collapse whitespace FIRST, for two independent reasons. The obvious one is
  // that the context windows below are raw character counts, and a run of blank
  // lines could otherwise swallow the whole window and hide a real requirement.
  // The serious one is that `YEARS` has three `\s*` runs separated by optional
  // groups: against a long unbroken whitespace run that never reaches "years",
  // the match splits cubically. Measured on the raw form, a figure followed by
  // 8,000 spaces took 96 seconds — and Lever and Ashby hand us their
  // `descriptionPlain` verbatim, uncapped, inside a durable step that would then
  // retry. Normalized, the same input is instant.
  const text = jdText.replace(/\s+/g, ' ');

  let lowest: number | null = null;
  YEARS.lastIndex = 0;
  for (let m = YEARS.exec(text); m !== null; m = YEARS.exec(text)) {
    const value = toNumber(m[1]);
    if (value == null || value > MAX_YEARS) continue;

    const end = m.index + m[0].length;
    const before = text.slice(Math.max(0, m.index - 24), m.index + m[0].indexOf(m[1]));
    const after = text.slice(end, end + CONTEXT_CHARS);

    // The employer talking about its own history, on either side of the figure.
    if (NOT_A_REQUIREMENT_BEFORE.test(before)) continue;
    if (NOT_A_REQUIREMENT_AFTER.test(after)) continue;

    // The figure only counts as a requirement if experience is being discussed.
    if (!/\bexperience|\bexp\b|\bbackground\b/i.test(`${before} ${after}`)) continue;

    if (lowest == null || value < lowest) lowest = value;
  }

  return lowest;
}

/**
 * The board's experience predicate, as a pure function — the SQL in the jobs
 * router mirrors it exactly.
 *
 * A posting that states no requirement always passes. About a third say nothing,
 * and "didn't mention it" is not the same as "wants a decade" — the same
 * never-discard-unknown rule sponsorship and pay follow.
 */
export function meetsMaxYears(required: number | null | undefined, maximum: number): boolean {
  if (maximum <= 0) return true;
  if (required == null) return true;
  return required <= maximum;
}
