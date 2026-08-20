/**
 * The two things you want back alongside a tailored résumé: where each JD
 * keyword ended up, and which claims you would have to defend in an interview.
 *
 * Both are computed from the generated document rather than asked of the model.
 * A model asked to grade its own output will tell you it covered everything —
 * and the interesting cases here are exactly the ones it has an incentive to
 * gloss over. Reading the LaTeX costs nothing and cannot flatter itself.
 */
import {
  containsKeyword,
  extractBullets,
  extractSections,
  METRIC_RE,
  stripForMatch,
  stripLatex,
} from './quality';

export type KeywordStatus = 'in' | 'weak' | 'missing';

export interface KeywordPlacement {
  keyword: string;
  status: KeywordStatus;
  /**
   * Sections the keyword appears in, as written ("EXPERIENCE", "TECHNICAL
   * SKILLS"). Empty when missing.
   */
  where: string[];
}

/** Sections that only *list* a keyword rather than evidencing it. */
const LISTING_SECTION = /skill|technolog|tool|competenc/i;

/**
 * Where each JD keyword landed.
 *
 *  - `in`      — it appears somewhere that demonstrates it (a bullet, a project).
 *  - `weak`    — it appears ONLY in a skills list. Present for the keyword
 *                scanner, unevidenced for a human reader, which is exactly the
 *                distinction a coverage check is for.
 *  - `missing` — not in the document at all.
 */
export function buildKeywordCoverage(latex: string, keywords: string[]): KeywordPlacement[] {
  const { header, sections } = extractSections(latex);
  // `stripForMatch` and `containsKeyword`, not a third matching scheme: the
  // linter already solved both halves of this. A plain `includes` reported "go"
  // as evidenced because a bullet said "MongoDB", and `stripLatex` ate the
  // symbols that make "c#" and "ci/cd" findable at all.
  const readable = sections.map((s) => ({
    title: stripLatex(s.title) || s.title,
    key: s.key,
    text: stripForMatch(s.body).toLowerCase(),
  }));
  // A document with no \section would otherwise report every keyword missing
  // while `buildDefencePoints`, reading the same text, sees them all.
  if (readable.length === 0) {
    readable.push({ title: 'Résumé', key: 'resume', text: stripForMatch(header).toLowerCase() });
  }

  const seen = new Set<string>();
  const out: KeywordPlacement[] = [];

  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);

    const hits = readable.filter((s) => containsKeyword(s.text, needle));
    if (hits.length === 0) {
      out.push({ keyword, status: 'missing', where: [] });
      continue;
    }
    const evidenced = hits.some((s) => !LISTING_SECTION.test(s.key));
    out.push({
      keyword,
      status: evidenced ? 'in' : 'weak',
      where: hits.map((s) => s.title),
    });
  }
  return out;
}

export interface DefencePoint {
  /** The bullet or skills line the claim sits in. */
  claim: string;
  /** Why it is worth checking before you submit. */
  why: string;
}

/**
 * A figure worth being able to explain.
 *
 * Defined by the quantity, not by the noun after it: an earlier version listed
 * units (users, requests, rows) and quietly missed "300 analysts". Either a
 * number carrying a magnitude marker, or any number of two digits or more.
 *
 * The lookbehind keeps it off tokens that merely contain digits — the 95 of
 * "p95" is part of a name, not a claim.
 */
const METRIC = new RegExp(`${METRIC_RE.source}|(?<![\\w.])\\d{2,}(?![\\w.])`, 'i');

/**
 * Claims to verify before submitting.
 *
 * Two kinds, both mechanical:
 *  - a technology named in the document that is NOT in your master skill list,
 *    which is the fastest way a tailored résumé becomes indefensible;
 *  - a bullet carrying a number, since the generator is allowed to invent
 *    plausible metrics and you are the only one who knows which are real.
 */
export function buildDefencePoints(
  latex: string,
  masterSkills: string[],
  jdKeywords: string[],
): DefencePoint[] {
  const known = new Set(masterSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const text = stripForMatch(latex).toLowerCase();
  const out: DefencePoint[] = [];

  // An empty master list means "we don't know your skills", not "you have none".
  // Without this guard every keyword in the document gets flagged, which is the
  // live state until a résumé has been ingested into the corpus.
  if (known.size > 0) {
    for (const keyword of jdKeywords) {
      const n = keyword.trim().toLowerCase();
      // Loose both ways: master skills come from the DB unnormalized, so
      // "Apache Kafka" should still cover "kafka" and "Java 17" cover "java".
      const supported = [...known].some((k) => k === n || k.includes(n) || n.includes(k));
      if (!n || supported || !containsKeyword(text, n)) continue;
      out.push({
        claim: keyword,
        why: 'On the résumé but not in your master skills — be ready to speak to it, or cut it.',
      });
    }
  }

  // `extractBullets` already returns stripped, trimmed content.
  for (const bullet of extractBullets(latex)) {
    if (!METRIC.test(bullet)) continue;
    out.push({ claim: bullet, why: 'Carries a number — confirm it is one you can stand behind.' });
  }

  return out;
}
