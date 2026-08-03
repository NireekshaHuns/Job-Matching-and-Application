/**
 * The resume-quality rubric (from the user's own research). Single source of
 * truth for BOTH the tailoring LLM prompt and the deterministic linter
 * (`quality.ts`), so what we ask for and what we check stay in sync.
 */

/** Target resume length in words. */
export const WORD_MIN = 475;
export const WORD_MAX = 600;

/** Fraction of bullets that should contain a concrete metric. */
export const MIN_METRIC_RATIO = 0.5;

/** Builder-voice verbs bullets should start with (non-exhaustive allowlist). */
export const STRONG_VERBS = [
  'shipped',
  'led',
  'built',
  'improved',
  'automated',
  'delivered',
  'headed',
  'boosted',
  'established',
  'centralized',
  'augmented',
  'examined',
  'fortified',
  'designed',
  'architected',
  'implemented',
  'launched',
  'reduced',
  'increased',
  'cut',
  'scaled',
  'migrated',
  'optimized',
  'drove',
  'owned',
  'created',
  'developed',
  'engineered',
  'transmitted',
  'trained',
  'streamlined',
];

/** Bystander verbs that undersell ownership — bullets must not start with these. */
export const WEAK_VERBS = [
  'assisted',
  'helped',
  'worked on',
  'responsible for',
  'participated',
  'contributed to',
  'involved in',
  'tasked with',
  'aided',
  'supported',
];

/**
 * Fluff/cliches that should never appear. ("dynamic" is deliberately excluded —
 * it's a common technical adjective: dynamic programming, dynamic imports.)
 */
export const BUZZWORDS = [
  'synergy',
  'team player',
  'hardworking',
  'hard worker',
  'go-getter',
  'detail-oriented',
  'results-driven',
  'self-starter',
  'think outside the box',
  'go-to person',
  'rockstar',
  'ninja',
  'passionate',
];

/** The system prompt the tailoring LLM must follow (Inc 4 uses this). */
export const RESUME_RUBRIC_PROMPT = [
  'You tailor a software-engineering resume for a specific job. Follow these rules strictly.',
  '',
  'Truthfulness (non-negotiable): only use skills and accomplishments from the provided master',
  'inventory. Never invent skills, employers, or metrics. If the JD wants something the',
  'candidate lacks, leave it out — do not fabricate.',
  '',
  'Bullets:',
  '- Use the Google XYZ formula: "Accomplished X as measured by Y by doing Z", aligned to the JD.',
  `- Start every bullet with a strong builder verb (e.g. ${STRONG_VERBS.slice(0, 10).join(', ')}).`,
  `- Never start with a bystander verb: ${WEAK_VERBS.join(', ')}. Take credit.`,
  '- Include real, specific metrics (latency, throughput, users, %, time saved).',
  '- Bullets must read like real engineering work, not homework assignments. Keep them full.',
  '',
  'Keywords:',
  '- Weave the JD’s technical and soft keywords naturally throughout — never keyword-stuff.',
  '- Omit basic software-engineer expectations; only surface differentiating keywords.',
  '- Drop skills and content the JD does not need. Do not send a generic resume.',
  '',
  'Structure (preserve the template exactly):',
  '- Keep every section heading and the header block (name, contact) verbatim — same set, same order.',
  '- Keep the PROJECTS section verbatim — never alter its wording, order, or metrics.',
  '- Tailor ONLY: EXPERIENCE bullets, the TECHNICAL SKILLS list, and which coursework/certifications to surface.',
  '- Return the complete LaTeX document on a single page.',
  '',
  `Banned words (fluff/cliches): ${BUZZWORDS.join(', ')}.`,
  '',
  `Form: ${WORD_MIN}–${WORD_MAX} words; Arial/Calibri; consistent end punctuation across bullets;`,
  'bold organization names; list work experience as title first, then employer; tight layout',
  'with no wasted whitespace; no buzzwords, cliches, or incorrect pronouns.',
].join('\n');
