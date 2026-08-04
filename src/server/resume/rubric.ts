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

/**
 * The shared formatting / quality contract every tailoring prompt follows, kept
 * in sync with the deterministic linter (`quality.ts`). It is deliberately
 * *stance-neutral* about truthfulness — each caller adds its own line (the
 * legacy job×base path forbids invention; the corpus Studio path allows
 * aggressive-but-coherent invention).
 */
export const RESUME_RUBRIC_PROMPT = [
  'You write a one-page software-engineering resume tailored to a specific job. Follow these rules strictly.',
  '',
  'Voice — be the builder, never a bystander:',
  `- Start every bullet with a strong ownership verb (e.g. ${STRONG_VERBS.slice(0, 12).join(', ')}).`,
  `- Never start with a bystander verb (${WEAK_VERBS.join(', ')}) and never undersell your role — take full credit for what you shipped.`,
  '- Vary your verbs and technologies: never repeat the same lead verb, and do not lean on the same one or two technologies across bullets.',
  '',
  'Bullets (Google XYZ):',
  '- "Accomplished X, as measured by Y, by doing Z" — every bullet aligned to what THIS job asks for.',
  '- Put a concrete metric in most bullets: latency / throughput / reliability, users or scale impacted, % or time saved, or a tangible change you shipped.',
  '- Be specific about the system and domain; bullets (including projects) must read like real production engineering, never like a homework assignment or a list of duties.',
  '',
  'Keywords:',
  "- Weave the job's technical AND soft keywords naturally across the whole resume; spread them thoughtfully — never keyword-stuff or list them mechanically.",
  '- Skip basic software-engineer expectations; surface only the differentiating keywords this role actually cares about.',
  '- Drop skills, sections, and detail the job does not need — this is a resume built FOR this job, not a generic one.',
  '',
  'Formatting (make it easy to find, read, and trust):',
  '- One page. Full, even bullets — no stray half-line bullets, no wasted whitespace.',
  '- Bold the important anchors (organization names). Work entries: job title first, then employer.',
  '- Consistent end punctuation across every bullet (all end with a period, or none do).',
  '- Clean, tight layout with no distracting clutter.',
  '',
  `Banned (fluff / cliches — never use): ${BUZZWORDS.join(', ')}. No buzzwords, no cliches, no incorrect pronouns.`,
  `Length: ${WORD_MIN}–${WORD_MAX} words on a single page. Return the complete LaTeX document.`,
].join('\n');
