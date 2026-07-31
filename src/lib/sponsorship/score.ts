/**
 * Sponsorship tiering — the H1B possibility score for a job.
 *
 * Implements the CLAUDE.md domain rule: never discard unknown sponsorship,
 * always assign a tier. Only explicit disqualifiers in the JD produce
 * `Excluded`; an explicit offer or heavy recent government history produces
 * `High`; prior history with a silent JD is `Medium`; a silent JD with little
 * or no history is `Low`.
 *
 * Pure and deterministic — no DB or network. Government history is passed in;
 * ingestion of DOL/USCIS data is handled elsewhere.
 */
import { sponsorTierEnum } from '@/server/db/schema';

export type SponsorTier = (typeof sponsorTierEnum.enumValues)[number];

/** Per-employer government sponsorship history, already aggregated. */
export interface SponsorHistory {
  /** Aggregate H1B approval count, initial + continuing (blended lifetime total). */
  sponsorCount: number;
  /** USCIS approval rate, 0–1, or null when unknown. */
  approvalRate: number | null;
  /** Most recent filing year, or null when unknown. */
  lastFiledYear: number | null;
  /** Lifetime "New Employment" (initial) approvals — genuine new-hire sponsorship. */
  newEmploymentApprovals: number;
  /** Most recent fiscal year with any New Employment approvals; null when none. */
  newEmploymentLastYear: number | null;
}

export interface ScoreInput {
  jdText: string;
  /** null when the employer has no match in the sponsor data. */
  history: SponsorHistory | null;
}

export interface SponsorScore {
  tier: SponsorTier;
  /** Short human-readable "why", shown on the job card. */
  reason: string;
}

/** Filings no older than this many years before "now" count as recent. */
const RECENT_YEARS = 3;
/**
 * New-employment (initial) approvals at/above which recent history alone
 * justifies `High`. Keyed off new-employment, not the blended count, so a
 * transfer/continuation-heavy body shop can't reach `High` on history.
 */
const HEAVY_NEW_EMPLOYMENT = 25;

/**
 * "This employer won't sponsor" phrasings. The negated forms use a windowed
 * `[^.]{0,N}` gap so an adverb between the negator and the verb still matches
 * ("do not currently offer sponsorship"), and the gap never crosses a sentence
 * boundary (periods are excluded), so a negation in a different sentence can't
 * poison a real offer.
 */
const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  /\bno\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\b(?:cannot|can'?t|will\s+not|won'?t|do(?:es)?\s+not|don'?t|are\s+not|is\s+not|unable\s+to|not\s+able\s+to|not\s+eligible\s+for)\b[^.]{0,30}\bsponsor(?:ship|ing)?\b/i,
  /\bsponsorship\b[^.]{0,25}\bnot\s+(?:available|offered|provided|possible|an\s+option)\b/i,
  /\bwithout\s+(?:visa\s+|the\s+need\s+for\s+|requiring\s+)?(?:current\s+or\s+future\s+)?sponsorship\b/i,
  /\bauthoriz(?:ed|ation)\s+to\s+work\b[^.]{0,60}\bwithout\b[^.]{0,25}\bsponsorship\b/i,
];

/**
 * "Must be a citizen / permanent resident" phrasings. The permanent-resident
 * one requires a restriction cue ("only", "must be", ...) so inclusive EEO
 * boilerplate ("we welcome citizens or permanent residents and visa holders")
 * is not wrongly excluded.
 */
const CITIZENSHIP_PATTERNS: RegExp[] = [
  /\bmust\s+be\s+(?:a\s+)?(?:u\.?\s?s\.?|united\s+states)\s+citizen/i,
  /\b(?:u\.?\s?s\.?|united\s+states)\s+citizenship\s+(?:is\s+)?required\b/i,
  /\bgreen\s+card\s+(?:holder|required)\b/i,
  /\b(?:only|must\s+be|limited\s+to|restricted\s+to|open\s+only\s+to|requires?)\b[^.]{0,40}\bpermanent\s+residents?\b/i,
];

/**
 * Explicit positive offers. Kept tied to visa/sponsorship wording, and only
 * checked after the disqualifiers so a negated form never reaches here.
 */
const OFFER_PATTERNS: RegExp[] = [
  /\b(?:visa\s+|h-?1b\s+)?sponsorship\s+(?:is\s+)?available\b/i,
  // "will sponsor" only counts when its object is a person or a visa, so
  // "will sponsor community meetups" doesn't read as a visa offer.
  /\bwill\s+sponsor\b[^.]{0,40}\b(?:visa|h-?1b|candidate|applicant|employee|individual|work\s+authoriz|green\s+card|permanent\s+resid|you)/i,
  /\b(?:offer|offers|offering|provide|provides|providing)\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\bopen\s+to\s+(?:providing\s+)?(?:visa\s+)?sponsor(?:ing|ship)\b/i,
  /\bwe\s+sponsor\s+(?:work\s+)?visas?\b/i,
  /\bsponsor\s+(?:your\s+)?(?:work\s+)?visa\b/i,
  /\bh-?1b\s+sponsorship\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Assign an H1B possibility tier to a job. Always returns a tier — unknown
 * sponsorship is tiered `Low`, never dropped. Disqualifiers are checked before
 * offers so an explicit refusal can never be read as an offer.
 */
export function scoreSponsorship(input: ScoreInput, opts?: { currentYear?: number }): SponsorScore {
  const jd = input.jdText;
  const currentYear = opts?.currentYear ?? new Date().getUTCFullYear();

  if (matchesAny(jd, NO_SPONSORSHIP_PATTERNS)) {
    return { tier: 'Excluded', reason: 'JD states it does not offer sponsorship.' };
  }
  if (matchesAny(jd, CITIZENSHIP_PATTERNS)) {
    return {
      tier: 'Excluded',
      reason: 'JD requires US citizenship or permanent residency.',
    };
  }

  if (matchesAny(jd, OFFER_PATTERNS)) {
    return { tier: 'High', reason: 'JD explicitly offers visa sponsorship.' };
  }

  const { history } = input;
  if (history) {
    const newRecent =
      history.newEmploymentLastYear != null &&
      history.newEmploymentLastYear >= currentYear - RECENT_YEARS;

    // Heavy, recent new-hire sponsorship justifies High on history alone.
    if (history.newEmploymentApprovals >= HEAVY_NEW_EMPLOYMENT && newRecent) {
      return {
        tier: 'High',
        reason: `Heavy recent new-hire sponsorship: ${history.newEmploymentApprovals} New Employment approvals (last ${history.newEmploymentLastYear}).`,
      };
    }

    // Any new-employment history (even older) beats transfer-only history.
    if (history.newEmploymentApprovals > 0) {
      const yearNote = history.newEmploymentLastYear
        ? `, last ${history.newEmploymentLastYear}`
        : '';
      return {
        tier: 'Medium',
        reason: `Sponsored new hires before (${history.newEmploymentApprovals} New Employment approvals${yearNote}); JD silent.`,
      };
    }

    // Matched an employer with approvals, but only transfers/continuations.
    if (history.sponsorCount > 0) {
      return {
        tier: 'Medium',
        reason: 'H1B history is transfers/continuations only; JD silent.',
      };
    }

    // Matched a USCIS employer but no approvals on record (e.g. denials only).
    return { tier: 'Low', reason: 'Matched a USCIS employer with no approvals on record.' };
  }

  return { tier: 'Low', reason: 'JD silent and no sponsorship history.' };
}
