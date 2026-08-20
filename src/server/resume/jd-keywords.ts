/**
 * The keyword map a résumé has to hit for one posting.
 *
 * The model does the reading comprehension — what the posting says, where it
 * says it, what counts as the same thing said differently, and which
 * requirements are either/or. It assigns no numbers: importance and repetition
 * are computed here, from the section the keyword came from and from the
 * posting itself.
 *
 * That split is the point. A model asked for a 1–10 score returns 7s and 8s and
 * reshuffles them between runs on the same posting, so the sort order — the one
 * thing the reviewer acts on — stops being reproducible. A computed score is
 * stable, explainable ("a 3 because it is under 'nice to have' and appears
 * once"), and testable without an API call.
 *
 * Prompt building and parsing are pure; the network call is behind an injected
 * `ChatClient`.
 */
import { z } from 'zod';
import type { ChatClient } from '@/server/enrich/types';
import { keywordMatcher, stripForMatch } from './quality';

/** Bucket A / Bucket B, in the same vocabulary as the DB `skill_kind` enum. */
export type KeywordBucket = 'technical' | 'soft';

/**
 * Where the posting put the keyword. This is the load-bearing field: it sets
 * the weight, so `bonus` vs `required` is the difference between "nice if you
 * have it" and "the thing they screen on".
 */
export const JD_SECTIONS = [
  'required',
  'preferred',
  'responsibilities',
  'bonus',
  'education',
  'unspecified',
] as const;
export type JdSection = (typeof JD_SECTIONS)[number];

export interface JdKeyword {
  /** The posting's own wording, lowercased. The join key everywhere downstream. */
  term: string;
  bucket: KeywordBucket;
  section: JdSection;
  /** Semantic equivalents, lowercased. Credit for saying the same thing differently. */
  aliases: string[];
  /** `null` unless this term is one alternative in an either/or requirement. */
  orGroupId: string | null;
  /** Occurrences of the term (or an alias) in the posting — counted, not asked for. */
  repetitions: number;
  /** 1–10, computed. Never model-assigned. */
  importance: number;
}

export interface JdOrGroup {
  /** Stable within one analysis: `or-1`, `or-2`, … */
  id: string;
  /** The requirement as the posting words it, e.g. "Python, Java, or Golang". */
  label: string;
  /** Member terms in posting order. Always ≥ 2 — a one-member choice is not a choice. */
  members: string[];
}

export interface JdKeywordAnalysis {
  /** Sorted by importance desc, then repetitions desc, then term asc. */
  keywords: JdKeyword[];
  orGroups: JdOrGroup[];
  /** How many extracted keywords the caps discarded, so the caps aren't silent. */
  dropped: number;
}

export const JD_KEYWORD_SYSTEM_PROMPT = [
  'You are an ATS analyst. You read one job posting and return the keyword map a resume must hit.',
  'Respond with ONLY a JSON object, no prose, no code fences.',
  '',
  'SHAPE:',
  '{',
  '  "keywords": [',
  '    {',
  '      "term": string,',
  '      "bucket": "technical" | "soft",',
  '      "section": "required" | "preferred" | "responsibilities" | "bonus" | "education",',
  '      "aliases": string[],',
  '      "orGroup": string | null',
  '    }',
  '  ],',
  '  "orGroups": [ { "label": string, "members": string[] } ]',
  '}',
  '',
  'MINE TWO PLACES. Most postings hide half their keywords in prose, so read the WHOLE posting.',
  '1. The explicit lists — "Qualifications", "Requirements", "Required", "Minimum", "Preferred",',
  '   "Nice to have", "Skills", and any skill-tag block.',
  '2. The responsibilities / "what you will do" prose. The action phrases in there ARE keywords, and',
  '   they are the ones every other applicant misses. Take them close to as written: "design, develop',
  '   and test", "improve performance and reliability", "build features from start to finish",',
  '   "well-architected solutions", "cross-functional partners", "system reliability", "user feedback",',
  '   "improve engineering productivity".',
  'Extract 30-60 keywords when the posting supports it. UNDER-extracting is the usual failure: if a',
  'sentence in the responsibilities section names a system, a quality attribute, a scale, or a way of',
  'working, it contains a keyword. Work through the posting paragraph by paragraph, not just its lists.',
  '',
  'BUCKETS:',
  '- "technical" — tools, languages, platforms, AND engineering or domain concepts. Both of these are',
  '  technical: (a) python, aws vpc, kubernetes, postgres, grpc; (b) system design, distributed systems,',
  '  concurrency, event-driven architecture, ci/cd, data structures and algorithms, information',
  '  retrieval, performance and reliability, observability, security. A concept is technical even when',
  '  it is not a product name.',
  '- "soft" — behavioural and judgement language: leadership, mentoring, cross-functional',
  '  collaboration, ownership, entrepreneurial, fast-paced, curiosity, communication, analytical,',
  '  interpersonal, bias for action.',
  '',
  'SECTIONS — where the posting puts it. This is the most important field, because it decides how',
  'heavily the keyword is weighted later. Be strict:',
  '- "required" — under required / minimum / basic qualifications, or phrased as a must ("X years of",',
  '  "experience with", "proficiency in", "must have").',
  '- "preferred" — under preferred / desired / strongly preferred qualifications.',
  '- "bonus" — under "nice to have", "bonus", "a plus", "even better if", "ideally". Technologies here',
  '  are NOT core requirements and must be marked "bonus" however impressive they look. Mislabelling a',
  '  bonus technology as required is the single most damaging error you can make in this task.',
  '- "responsibilities" — mined from the responsibilities / what-you-will-do / day-to-day prose.',
  '- "education" — degree, field of study, coursework, certifications.',
  '',
  'ALIASES — semantic equivalents, 0-3 per keyword, so a resume that says the same thing in different',
  'words still gets credit. Give other names for the same thing, the concrete technology that',
  'implements a concept, and the umbrella concept a technology sits under. Examples:',
  '  "source control" -> ["git", "version control"]',
  '  "cloud network infrastructure" -> ["aws vpc", "cloud networking", "network security controls"]',
  '  "scalable and reliable network solutions" -> ["scalability", "throughput", "high availability"]',
  '  "relational databases" -> ["postgres", "mysql", "sql"]',
  'An alias must be something that genuinely PROVES the keyword, not something merely adjacent to it.',
  'If in doubt, leave it out — a wrong alias manufactures evidence that does not exist.',
  '',
  'OR-GROUPS — when the posting satisfies one requirement with any of several alternatives ("Python,',
  'Java, or Golang", "AWS, GCP or Azure", "one of Kafka, Kinesis or Pub/Sub"), emit ONE orGroups entry',
  'whose "label" is the requirement as the posting words it and whose "members" are the exact terms,',
  'and set each member keyword\'s "orGroup" to that same label string. Only genuine alternatives — do',
  'NOT group items that are merely listed together with commas or "and" and all expected.',
  '',
  'RULES:',
  '- "term": the posting\'s own wording, lowercased, stripped of articles and filler ("experience with',
  '  Kubernetes" -> "kubernetes"; "strong communication skills" -> "communication"). Keep multi-word',
  '  concepts intact ("event-driven architecture", "performance and reliability").',
  '- One entry per distinct keyword. No duplicates and no near-duplicates ("distributed system" and',
  '  "distributed systems" are one keyword).',
  '- Do NOT invent keywords the posting does not support.',
  '- Do NOT rank, score, weight, or order anything. Importance is computed afterwards from the section',
  '  and from the posting itself. Any number you add is discarded.',
  '- Skip everything that is not a resume keyword: company boilerplate and mission, benefits and perks,',
  '  compensation, visa and EEO language, application logistics, office locations, team socials.',
  '- Skip bare basics every software engineer is assumed to have ("programming", "computers", "problem',
  '  solving" on its own) unless the posting itself makes one a named requirement.',
].join('\n');

export function buildJdKeywordMessages(input: { jdText: string; jobTitle?: string }): {
  system: string;
  user: string;
} {
  const title = input.jobTitle?.trim() || '(not given)';
  return {
    system: JD_KEYWORD_SYSTEM_PROMPT,
    user: `Job title: ${title}\n\nJob posting:\n${input.jdText}`,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Per-field `.catch()` rather than a strict parse: an unrecognized `section`
 * string should degrade to `unspecified`, not throw away a paid call's entire
 * output. Only "no JSON object at all" throws, matching the previous behaviour.
 */
const rawKeywordSchema = z.object({
  term: z.string().catch(''),
  bucket: z.enum(['technical', 'soft']).catch('technical'),
  section: z.enum(JD_SECTIONS).catch('unspecified'),
  aliases: z.array(z.string()).catch([]),
  orGroup: z.string().nullish().catch(null),
});

const rawOrGroupSchema = z.object({
  label: z.string().catch(''),
  members: z.array(z.string()).catch([]),
});

const analysisSchema = z.object({
  keywords: z.array(rawKeywordSchema).catch([]),
  orGroups: z.array(rawOrGroupSchema).catch([]),
  // Legacy `{tech, soft}` shape — see `upgradeLegacyShape`.
  tech: z.array(z.string()).catch([]),
  soft: z.array(z.string()).catch([]),
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Per-bucket ceilings. Bucket B is small by design: there are only so many
 * behavioural signals in a posting, and a long soft list is noise in a tick UI.
 */
const MAX_TECHNICAL = 45;
const MAX_SOFT = 15;

/**
 * Per-section ceilings, so a posting with a huge "nice to have" list cannot
 * crowd out its own core requirements. Sections absent here are uncapped —
 * `responsibilities` deliberately so, since prose mining is the whole point.
 */
const SECTION_CAPS: Partial<Record<JdSection, number>> = { bonus: 6, education: 3 };

const MAX_ALIASES = 4;
const MAX_TERM_LEN = 60;
const MAX_OR_GROUPS = 8;

/**
 * Benefits / EEO / logistics noise that survives a careless extraction. The
 * prompt already forbids it; this is the cheap deterministic backstop, and it
 * is why "book clubs" never has to be out-ranked — it never appears.
 */
// The `s?` matters: `\bbook club\b` does not match "book clubs", which is how
// a posting actually words it.
const NOISE_RE =
  /\b(401k|equity|pto|vacation|health insurance|dental|vision|happy hours?|book clubs?|snacks?|ping.?pong|equal opportunit|eeo|salary range|relocation|referral bonus|paid leave|parental leave)\b/i;

// ---------------------------------------------------------------------------
// Importance
// ---------------------------------------------------------------------------

/**
 * Base weight by where the posting put the keyword. The ladder is the whole
 * point: a bonus technology cannot out-rank a core requirement however often it
 * appears, because 2 + 3 < 8. That is what puts TCP/IP and AWS VPC above
 * BGP/VXLAN/OVS on a cloud-network posting without anyone's opinion.
 */
const SECTION_BASE: Record<JdSection, number> = {
  required: 8,
  preferred: 6,
  responsibilities: 5,
  unspecified: 4,
  education: 3,
  bonus: 2,
};

/** A term named in the job title is what the role IS, not one of its skills. */
const TITLE_BONUS = 2;

function repetitionBonus(repetitions: number): number {
  if (repetitions >= 4) return 3;
  if (repetitions === 3) return 2;
  if (repetitions === 2) return 1;
  return 0;
}

export function keywordImportance(input: {
  section: JdSection;
  repetitions: number;
  inTitle: boolean;
}): number {
  const raw =
    SECTION_BASE[input.section] +
    repetitionBonus(input.repetitions) +
    (input.inTitle ? TITLE_BONUS : 0);
  return Math.min(10, Math.max(1, raw));
}

/**
 * Occurrences of the term or any alias in the posting. Boundary-aware, so "go"
 * is not found inside "MongoDB" — the same matcher the linter and the coverage
 * report use, rather than a third scheme that could disagree with them.
 */
export function countRepetitions(
  haystack: string,
  term: string,
  aliases: readonly string[],
): number {
  let total = 0;
  for (const needle of [term, ...aliases]) {
    if (!needle) continue;
    total += haystack.match(keywordMatcher(needle, { global: true }))?.length ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A usable keyword: non-empty, not absurdly long, carries an alphanumeric, not noise. */
function isUsableTerm(term: string): boolean {
  return (
    term.length > 0 && term.length <= MAX_TERM_LEN && /[a-z0-9]/.test(term) && !NOISE_RE.test(term)
  );
}

function normalizeAliases(aliases: readonly string[], term: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([term]);
  for (const alias of aliases) {
    const a = normalizeTerm(alias);
    if (!isUsableTerm(a) || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

type RawKeyword = z.infer<typeof rawKeywordSchema>;

/**
 * A model that has seen far more of the old two-array shape than of this one
 * will sometimes fall back to it, especially on short postings. Upgrade rather
 * than return nothing from a call that has already been paid for.
 */
function upgradeLegacyShape(parsed: z.infer<typeof analysisSchema>): RawKeyword[] {
  const upgrade = (terms: string[], bucket: KeywordBucket): RawKeyword[] =>
    terms.map((term) => ({
      term,
      bucket,
      section: 'unspecified' as const,
      aliases: [],
      orGroup: null,
    }));
  return [...upgrade(parsed.tech, 'technical'), ...upgrade(parsed.soft, 'soft')];
}

interface Deduped {
  term: string;
  bucket: KeywordBucket;
  section: JdSection;
  aliases: string[];
  orGroupLabel: string | null;
}

function dedupe(raw: readonly RawKeyword[]): Deduped[] {
  const byTerm = new Map<string, Deduped>();

  for (const item of raw) {
    const term = normalizeTerm(item.term);
    if (!isUsableTerm(term)) continue;
    const aliases = normalizeAliases(item.aliases, term);
    const orGroupLabel = item.orGroup?.trim() || null;
    const existing = byTerm.get(term);

    if (!existing) {
      byTerm.set(term, { term, bucket: item.bucket, section: item.section, aliases, orGroupLabel });
      continue;
    }
    // A keyword can't be both buckets — technical wins, so the tick UI is clean
    // and a concept never shows up twice under two headings.
    if (item.bucket === 'technical') existing.bucket = 'technical';
    // The stronger claim wins: a term listed under both "required" and the
    // responsibilities prose is a requirement that also describes the day job.
    if (SECTION_BASE[item.section] > SECTION_BASE[existing.section])
      existing.section = item.section;
    existing.aliases = normalizeAliases([...existing.aliases, ...aliases], term);
    existing.orGroupLabel ??= orGroupLabel;
  }

  return [...byTerm.values()];
}

/**
 * Apply the section then bucket ceilings to an already-sorted list, so what
 * survives is the most important rather than whatever the model emitted first.
 */
function applyCaps(sorted: readonly JdKeyword[]): { kept: JdKeyword[]; dropped: number } {
  const kept: JdKeyword[] = [];
  const perSection = new Map<JdSection, number>();
  const perBucket = new Map<KeywordBucket, number>();
  const bucketCap = { technical: MAX_TECHNICAL, soft: MAX_SOFT } as const;

  for (const kw of sorted) {
    const sectionCap = SECTION_CAPS[kw.section];
    const sectionUsed = perSection.get(kw.section) ?? 0;
    if (sectionCap !== undefined && sectionUsed >= sectionCap) continue;
    const bucketUsed = perBucket.get(kw.bucket) ?? 0;
    if (bucketUsed >= bucketCap[kw.bucket]) continue;

    perSection.set(kw.section, sectionUsed + 1);
    perBucket.set(kw.bucket, bucketUsed + 1);
    kept.push(kw);
  }

  return { kept, dropped: sorted.length - kept.length };
}

/**
 * Rebuild the OR-groups against the keywords that actually survived, assigning
 * ids in first-appearance order. A group reduced to one member is dropped and
 * its member's `orGroupId` cleared: a single alternative is not a choice, and a
 * dangling id would render as an empty box.
 */
function buildOrGroups(
  keywords: JdKeyword[],
  rawGroups: readonly z.infer<typeof rawOrGroupSchema>[],
): JdOrGroup[] {
  const byTerm = new Map(keywords.map((k) => [k.term, k]));
  const out: JdOrGroup[] = [];

  for (const raw of rawGroups) {
    const label = raw.label.trim();
    if (!label || out.length >= MAX_OR_GROUPS) continue;

    const members: string[] = [];
    for (const member of raw.members) {
      const term = normalizeTerm(member);
      if (byTerm.has(term) && !members.includes(term)) members.push(term);
    }
    if (members.length < 2) continue;

    const id = `or-${out.length + 1}`;
    out.push({ id, label, members });
    for (const term of members) {
      const kw = byTerm.get(term);
      if (kw) kw.orGroupId = id;
    }
  }

  // Anything the model tagged with a group label that did not survive above.
  for (const kw of keywords) {
    if (kw.orGroupId !== null && !out.some((g) => g.id === kw.orGroupId)) kw.orGroupId = null;
  }
  return out;
}

/**
 * Parse the model's raw JSON into a normalized, bounded, weighted analysis.
 *
 * `jdText` is required because repetition counts and the title boost are
 * computed here rather than requested from the model. Pure.
 */
export function parseJdKeywordAnalysis(
  raw: string,
  ctx: { jdText: string; jobTitle?: string },
): JdKeywordAnalysis {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in JD-keyword output');
  const parsed = analysisSchema.parse(JSON.parse(match[0]));

  const rawKeywords = parsed.keywords.length > 0 ? parsed.keywords : upgradeLegacyShape(parsed);
  const deduped = dedupe(rawKeywords);

  const haystack = stripForMatch(ctx.jdText).toLowerCase();
  const title = stripForMatch(ctx.jobTitle ?? '').toLowerCase();

  const weighted: JdKeyword[] = deduped.map((k) => {
    const repetitions = countRepetitions(haystack, k.term, k.aliases);
    const inTitle =
      title.length > 0 &&
      [k.term, ...k.aliases].some((needle) => keywordMatcher(needle).test(title));
    return {
      term: k.term,
      bucket: k.bucket,
      section: k.section,
      aliases: k.aliases,
      // Set by `buildOrGroups` once we know which groups survived the caps.
      orGroupId: k.orGroupLabel === null ? null : 'pending',
      repetitions,
      importance: keywordImportance({ section: k.section, repetitions, inTitle }),
    };
  });

  // A total order, so the same model response always yields the same output.
  weighted.sort(
    (a, b) =>
      b.importance - a.importance || b.repetitions - a.repetitions || a.term.localeCompare(b.term),
  );

  const { kept, dropped } = applyCaps(weighted);
  const orGroups = buildOrGroups(kept, parsed.orGroups);
  return { keywords: kept, orGroups, dropped };
}

export async function extractJdKeywords(
  input: { jdText: string; jobTitle?: string },
  chat: ChatClient,
): Promise<JdKeywordAnalysis> {
  const raw = await chat.complete(buildJdKeywordMessages(input));
  return parseJdKeywordAnalysis(raw, input);
}
