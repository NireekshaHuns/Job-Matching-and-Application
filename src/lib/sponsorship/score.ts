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
  /** Recency-weighted count of H1B filings / approvals. */
  sponsorCount: number;
  /** USCIS approval rate, 0–1, or null when unknown. */
  approvalRate: number | null;
  /** Most recent filing year, or null when unknown. */
  lastFiledYear: number | null;
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

/** A recent filing counts toward "heavy history" only if within this window. */
const RECENT_YEARS = 3;
/** Filing count at/above which recent history alone justifies `High`. */
const HEAVY_SPONSOR_COUNT = 50;

/**
 * Explicit disqualifiers. These are complete negative statements, so matching
 * any one means the employer will not sponsor for this role. Checked first.
 */
const DISQUALIFIER_PATTERNS: RegExp[] = [
  /\bno\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\b(?:do(?:es)?|will|would|can|could)\s*n[o']?t\s+(?:be\s+able\s+to\s+)?(?:offer\s+(?:visa\s+|h-?1b\s+)?sponsorship|sponsor)\b/i,
  /\b(?:unable|not\s+able)\s+to\s+(?:offer\s+(?:visa\s+)?sponsorship|sponsor)\b/i,
  /\bwithout\s+(?:visa\s+|the\s+need\s+for\s+)?sponsorship\b/i,
  /\bnot\s+(?:offer|provide|providing|offering)\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\bmust\s+be\s+(?:a\s+)?(?:u\.?\s?s\.?|united\s+states)\s+citizen/i,
  /\b(?:u\.?\s?s\.?|united\s+states)\s+citizenship\s+(?:is\s+)?required\b/i,
  /\bcitizens?\s+or\s+(?:lawful\s+)?permanent\s+residents?\b/i,
  /\bgreen\s+card\s+(?:holder|required)\b/i,
  /\bauthoriz(?:ed|ation)\s+to\s+work\b[^.]{0,40}\bwithout\s+sponsorship\b/i,
];

/**
 * Explicit positive offers. Kept tied to visa/sponsorship wording so a phrase
 * like "we sponsor local meetups" doesn't count. Only checked after the
 * disqualifiers, so a negated form ("does not offer sponsorship") never reaches
 * here.
 */
const OFFER_PATTERNS: RegExp[] = [
  /\b(?:visa\s+|h-?1b\s+)?sponsorship\s+(?:is\s+)?available\b/i,
  // "will sponsor" only counts when its object is a person or a visa, so
  // "will sponsor community meetups" doesn't read as a visa offer.
  /\bwill\s+sponsor\b[^.]{0,40}\b(?:visa|h-?1b|candidate|applicant|employee|individual|work\s+authoriz|green\s+card|permanent\s+resid|you)/i,
  /\b(?:offer|offers|offering|provide|provides|providing)\s+(?:visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\bopen\s+to\s+sponsor(?:ing|ship)?\b/i,
  /\bwe\s+sponsor\s+(?:work\s+)?visas?\b/i,
  /\bsponsor\s+(?:your\s+)?(?:work\s+)?visa\b/i,
  /\bh-?1b\s+sponsorship\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Assign an H1B possibility tier to a job. Always returns a tier — unknown
 * sponsorship is tiered `Low`, never dropped.
 */
export function scoreSponsorship(input: ScoreInput, opts?: { currentYear?: number }): SponsorScore {
  const jd = input.jdText ?? '';
  const currentYear = opts?.currentYear ?? new Date().getUTCFullYear();

  if (matchesAny(jd, DISQUALIFIER_PATTERNS)) {
    return {
      tier: 'Excluded',
      reason: 'JD explicitly excludes sponsorship (no sponsorship / citizenship required).',
    };
  }

  if (matchesAny(jd, OFFER_PATTERNS)) {
    return { tier: 'High', reason: 'JD explicitly offers visa sponsorship.' };
  }

  const { history } = input;
  if (history && history.sponsorCount > 0) {
    const recent =
      history.lastFiledYear != null && history.lastFiledYear >= currentYear - RECENT_YEARS;

    if (history.sponsorCount >= HEAVY_SPONSOR_COUNT && recent) {
      return {
        tier: 'High',
        reason: `Heavy H1B history: ${history.sponsorCount} filings (last ${history.lastFiledYear}).`,
      };
    }

    const yearNote = history.lastFiledYear ? `, last ${history.lastFiledYear}` : '';
    return {
      tier: 'Medium',
      reason: `Sponsored before (${history.sponsorCount} filings${yearNote}); JD silent.`,
    };
  }

  return { tier: 'Low', reason: 'JD silent and no sponsorship history.' };
}
