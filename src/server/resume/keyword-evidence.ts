/**
 * How well the corpus backs each keyword the posting asks for.
 *
 * This is the check that decides what the résumé may claim outright and what it
 * may only gesture at. It replaces a boolean ("is this string in master_skills")
 * with a grade, because the interesting cases sit between yes and no: a skill
 * you listed but never evidenced in a bullet, and a bullet that proves the
 * concept under a different name, are two different situations and should not
 * look the same in a review UI.
 *
 * Deterministic and offline. The extraction step already spent a model call
 * working out which phrases mean the same thing, so grading those aliases with
 * the matcher the linter and the coverage report already share is free, and —
 * unlike asking a model whether it is qualified — cannot flatter itself.
 *
 * Pure: callers pass plain rows, no DB here.
 */
import type { RoleFamily } from '@/server/enrich/types';
import { bulletMatchesRole } from './bullets';
import type { JdKeyword } from './jd-keywords';
import { keywordMatcher, stripForMatch } from './quality';

export type EvidenceGrade = 'strong' | 'moderate' | 'weak' | 'missing';

export interface KeywordEvidence {
  grade: EvidenceGrade;
  /** Points from the rule table in `gradeKeyword`, kept so the UI can explain itself. */
  score: number;
  /** What actually matched: the keyword, or the alias that stood in for it. */
  matchedTerm: string | null;
  /** True when only an alias matched — the posting's words, your words. */
  viaAlias: boolean;
  /** How many corpus bullets support it. */
  bulletCount: number;
  /** A short quote from the best supporting bullet. Null when nothing matched. */
  sample: string | null;
}

export interface GradedKeyword extends JdKeyword {
  evidence: KeywordEvidence;
}

export interface EvidenceBullet {
  id: number;
  text: string;
  /** The bullet's jsonb skill tags. */
  skills: string[];
  roleFamily: RoleFamily | null;
}

export interface EvidenceCorpus {
  /** `master_skills.skill` values. */
  masterSkills: readonly string[];
  bullets: readonly EvidenceBullet[];
  /** Restrict to bullets a résumé of this family can draw on; null sees all. */
  roleFamily?: RoleFamily | null;
}

interface IndexedBullet {
  id: number;
  /** Skill tags and bullet text, pre-stripped and lowercased for matching. */
  hay: string;
  /** The original text, for `sample`. */
  text: string;
}

export interface EvidenceIndex {
  /** Master skills, pre-stripped and lowercased. */
  skills: readonly string[];
  bullets: readonly IndexedBullet[];
}

const SAMPLE_MAX = 120;

function prep(s: string): string {
  return stripForMatch(s).toLowerCase();
}

/**
 * Pre-strip the corpus once.
 *
 * Grading is keywords × (1 + aliases) × bullets, and `stripForMatch` is the
 * expensive part of each comparison — stripping inside the loop re-does the same
 * text tens of thousands of times for a normal corpus.
 */
export function buildEvidenceIndex(corpus: EvidenceCorpus): EvidenceIndex {
  const roleFamily = corpus.roleFamily ?? null;
  const bullets: IndexedBullet[] = [];

  for (const b of corpus.bullets) {
    if (!bulletMatchesRole(b.roleFamily, roleFamily)) continue;
    const text = b.text.trim();
    if (!text) continue;
    bullets.push({ id: b.id, text, hay: prep([...b.skills, text].join(' ')) });
  }

  return {
    skills: corpus.masterSkills.map((s) => prep(s)).filter(Boolean),
    bullets,
  };
}

/**
 * Whether the master-skill list vouches for a term.
 *
 * One-directional on purpose: a master skill of "apache kafka" covers a keyword
 * of "kafka", but a master skill of "go" must NOT cover "golang" — and testing
 * containment the other way round is how "go" ends up matching "mongodb".
 */
function skillSupports(skills: readonly string[], needle: string): boolean {
  const matcher = keywordMatcher(needle);
  return skills.some((skill) => matcher.test(skill));
}

/** The bullets a term appears in, by index position. */
function bulletHits(bullets: readonly IndexedBullet[], needle: string): IndexedBullet[] {
  const matcher = keywordMatcher(needle);
  return bullets.filter((b) => matcher.test(b.hay));
}

function truncate(s: string): string {
  return s.length <= SAMPLE_MAX ? s : `${s.slice(0, SAMPLE_MAX - 1).trimEnd()}…`;
}

/**
 * Grade one keyword against the index.
 *
 * Points:
 *   +2  the keyword itself is in your master skills
 *   +1  else an alias is
 *   +2  the keyword appears in a corpus bullet   (+1 more at two or more bullets)
 *   +1  a single alias appears in a single bullet
 *   +2  instead, when several aliases hit bullets or one alias hits several
 *
 * That last upgrade is what separates "he does this under a different name" from
 * "one word happened to appear". A posting asking for "cloud network
 * infrastructure" against a bullet reading "AWS VPCs, networking and security
 * controls for cloud infrastructure" has several independent echoes and should
 * grade as real evidence; a lone incidental alias should not.
 *
 * 3+ → strong · 2 → moderate · 1 → weak · 0 → missing.
 */
export function gradeKeyword(
  keyword: Pick<JdKeyword, 'term' | 'aliases'>,
  index: EvidenceIndex,
): KeywordEvidence {
  const term = keyword.term.trim().toLowerCase();
  if (!term) {
    return {
      grade: 'missing',
      score: 0,
      matchedTerm: null,
      viaAlias: false,
      bulletCount: 0,
      sample: null,
    };
  }

  let score = 0;
  /** What the master-skill list vouched for: the term, an alias, or nothing. */
  let skillMatch: string | null = null;
  /** What the bullets proved. */
  let bulletMatch: string | null = null;

  // --- master skills -------------------------------------------------------
  if (skillSupports(index.skills, term)) {
    score += 2;
    skillMatch = term;
  } else {
    const alias = keyword.aliases.find((a) => skillSupports(index.skills, a));
    if (alias) {
      score += 1;
      skillMatch = alias;
    }
  }

  // --- bullets -------------------------------------------------------------
  const directHits = bulletHits(index.bullets, term);
  let hits = directHits;

  if (directHits.length > 0) {
    score += directHits.length >= 2 ? 3 : 2;
    bulletMatch = term;
  } else {
    const aliasHits = new Map<number, IndexedBullet>();
    const aliasesThatHit: string[] = [];
    for (const alias of keyword.aliases) {
      const found = bulletHits(index.bullets, alias);
      if (found.length === 0) continue;
      aliasesThatHit.push(alias);
      // Keyed by bullet id, so two aliases hitting the same bullet is one
      // bullet's worth of evidence, not two.
      for (const b of found) aliasHits.set(b.id, b);
    }
    if (aliasesThatHit.length > 0) {
      score += aliasesThatHit.length >= 2 || aliasHits.size >= 2 ? 2 : 1;
      hits = [...aliasHits.values()];
      bulletMatch = aliasesThatHit[0];
    }
  }

  // If the keyword itself matched anywhere, that is the story: the candidate
  // really does claim this thing, and "via <alias>" would be wrong even when
  // only an alias reached a bullet. Otherwise prefer the alias that produced the
  // quote over one that merely sat in the skill list — `matchedTerm` is printed
  // next to `sample`, so the two have to describe the same evidence.
  const matchedTerm =
    skillMatch === term || bulletMatch === term ? term : (bulletMatch ?? skillMatch);

  const grade: EvidenceGrade =
    score >= 3 ? 'strong' : score === 2 ? 'moderate' : score === 1 ? 'weak' : 'missing';

  return {
    grade,
    score,
    matchedTerm,
    viaAlias: matchedTerm !== null && matchedTerm !== term,
    bulletCount: hits.length,
    sample: hits.length > 0 ? truncate(hits[0].text) : null,
  };
}

/** Grade every keyword, building the index once. */
export function gradeKeywords(
  keywords: readonly JdKeyword[],
  corpus: EvidenceCorpus,
): GradedKeyword[] {
  const index = buildEvidenceIndex(corpus);
  return keywords.map((k) => ({ ...k, evidence: gradeKeyword(k, index) }));
}

/** Tally for the picker header, so the caps and the gaps are both visible. */
export function countByGrade(keywords: readonly GradedKeyword[]): Record<EvidenceGrade, number> {
  const out: Record<EvidenceGrade, number> = { strong: 0, moderate: 0, weak: 0, missing: 0 };
  for (const k of keywords) out[k.evidence.grade]++;
  return out;
}
