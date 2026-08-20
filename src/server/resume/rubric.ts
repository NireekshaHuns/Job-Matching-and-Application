/**
 * The resume-quality rubric (from the user's own research). Single source of
 * truth for BOTH the tailoring LLM prompt and the deterministic linter
 * (`quality.ts`), so what we ask for and what we check stay in sync.
 */

/**
 * Target resume length in words.
 *
 * Calibrated against the owner's actual one-page résumé in this template, which
 * is **442 words across 11 bullets**. The previous 475–600 range was measured on
 * a different layout and pushed generation onto a second page: the linter was
 * reporting a 640-word, 16-bullet draft as too SHORT of the minimum. The band is
 * centred on the real document with room to breathe either side.
 */
export const WORD_MIN = 380;
export const WORD_MAX = 500;

/**
 * Hard bullet ceiling for one page. Word count alone does not control page
 * count — bullets do, because each one costs a `\item` plus its own leading and
 * almost always wraps to 2–3 lines. 13 leaves a little slack over the owner's
 * 11 without spilling over.
 */
export const MAX_BULLETS = 13;

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
  `- ONE PAGE, without exception. Keep the bullet count at or below ${MAX_BULLETS} across the whole document — that is what decides whether it fits. Cut the weakest bullets rather than shrinking any of them into a fragment.`,
  '- Keep the exact section order, headings, employers, titles, dates and education of the template you are given; rewrite only the bullet text, the project line and the skills values.',
  '- Full, even bullets — no stray half-line bullets, no wasted whitespace.',
  '- Bold the important anchors (organization names). Work entries: job title first, then employer.',
  '- Consistent end punctuation across every bullet (all end with a period, or none do).',
  '- Clean, tight layout with no distracting clutter.',
  '',
  `Banned (fluff / cliches — never use): ${BUZZWORDS.join(', ')}. No buzzwords, no cliches, no incorrect pronouns.`,
  `Length: ${WORD_MIN}–${WORD_MAX} words and at most ${MAX_BULLETS} bullets, on a single page. Return the complete LaTeX document.`,
].join('\n');

/**
 * The owner's own tailoring brief, appended after `RESUME_RUBRIC_PROMPT`.
 *
 * LAYERED, NOT MERGED, at the owner's request — the shared rubric above stays
 * as it is, and this section states the method they want followed. The two
 * overlap (both care about strong verbs, metrics, one page), and where they give
 * different specifics this section wins; `buildCorpusTailorMessages` says so
 * explicitly, so the model has a tie-breaker instead of a contradiction.
 *
 * Kept verbatim in the owner's wording rather than paraphrased: it encodes
 * judgement about what actually gets a résumé read, and a summary would lose
 * exactly the parts that make it useful (mining prose for keywords, proving soft
 * skills through context rather than naming them, exploiting OR-requirements
 * instead of padding).
 */
export const OWNER_TAILORING_METHOD = [
  'METHOD — follow these five steps. Where they give a different specific than the rules above, these win — EXCEPT the length, bullet-count, bystander-verb and punctuation limits above, which are hard and not negotiable. Blowing the word limit fails the document.',
  '',
  'Step 1 — Extract the keywords from the job description.',
  'Read the ENTIRE posting and pull keywords from two places, because most postings hide half their keywords in prose:',
  '- The explicit lists: "Qualifications", "Required", "Preferred", "Skills", and any skill-tag block.',
  '- The responsibilities / "what you\'ll do" prose, which is full of action phrases that are also keywords: design, develop and test; improve performance and reliability; build features from start to finish; well-architected solutions; cross-functional partners; system reliability; user feedback; improve engineering productivity. Mine these too and treat them as keywords to place.',
  '',
  'Sort everything into two buckets:',
  '- Bucket A — hard/technical: tools, languages, platforms, and engineering or domain concepts (Python, AWS, React, SQL, Postgres; system design, distributed systems, concurrency, event-driven architecture, CI/CD, data structures and algorithms, information retrieval, performance and reliability, security).',
  '- Bucket B — soft/signal: the behavioural and judgement language (leadership, mentoring, collaboration, cross-functional, accomplish shared goals, problem-solving, analytical, interpersonal, ownership, entrepreneurial, fast-paced, curiosity, communication).',
  '',
  'GOLDEN RULE for Bucket B: show these through the context of a bullet, never state them literally. Never write "excellent quantitative and interpersonal skills", "entrepreneurial mindset", "strong leader", or "well-architected solutions" as a phrase. Prove them instead.',
  "Mirror the JD's exact wording where it is natural, and note anything the posting repeats — repeated words are priorities.",
  '',
  'Step 2 — Map every keyword to a specific home, before writing a single bullet. This is the ATS step.',
  '- Give each important keyword a concrete placement: which role, and ideally which bullet.',
  '- Read the lean of the role and lead accordingly. If the languages and responsibilities are all backend/systems, lead with backend bullets and cut frontend. If it is a web/UI role, lead with the interface work. Drop whole dimensions the JD never asks for rather than forcing them in.',
  '- Exploit OR-requirements. Never add a skill you do not have. If the JD says "Python, Java, or Golang", having Python and Java already satisfies it — do NOT add Golang, C++, Cassandra just because they appear. A keyword you cannot defend in an interview is worse than a missing one. A listed keyword with no real evidence is simply left out.',
  '- Balance the roles so one is not lopsided, and note if a key JD requirement has no home anywhere.',
  '',
  'Step 3 — Write the bullets.',
  '- Google XYZ: "Accomplished X, as measured by Y, by doing Z." Every bullet gets a result, a real number where one exists, and the how.',
  '- Fuller two-line footprint: each bullet should fill about two full lines. Do not let a bullet trail off with a near-empty second line, and do not spill onto a third. Add substance to fill; do not pad with filler.',
  '- Open with strong ownership verbs: Built, Led, Architected, Engineered, Shipped, Scaled, Reduced, Automated, Delivered, Mentored, Secured, Migrated, Owned, Established, Drove.',
  '- Never use bystander verbs: "Designed" as a standalone opener, "helped", "assisted with", "worked on", "contributed to", "responsible for". Take credit as the builder.',
  '- Show hard concepts in the bullets, not only in the skills list. If the JD wants system design or CS fundamentals, demonstrate them — "applying system design and caching fundamentals to cut latency", "building distributed, event-driven pipelines applying concurrency fundamentals".',
  '- Show Bucket B through context: leadership → "Led development of…", "Mentored 3 engineers and led code-review standards adopted team-wide"; collaboration → "partnering with cross-functional product and QA teams to deliver…"; quantitative → "profiling query performance", "analyzing throughput metrics to tune…"; interpersonal → "gathering requirements from product and design partners"; entrepreneurial → owned features end to end at an early-stage startup (shown, never the word); fast-paced → "in a fast-paced startup"; well-architected → "re-architected into…", clean well-structured services, continuous refactoring.',
  '- One coherent stack per role. Never put competing tools in one bullet — two rival frontend frameworks together looks fake. Pick the frontend and backend that tell one clean story.',
  '- Vary the verbs and the tool names across bullets. Repeat a core tool at most once per role.',
  '- Metrics must be plausible and specific — did it change speed, reliability, cost, scale, or reach, and by how much, for how many people? Whether you may supply a figure that is not in the source material is set by the stance above; do not contradict it here.',
  '- Be sensible — do not keyword-stuff.',
  '',
  'Step 4 — Build the skills section by mirroring the JD.',
  '- Match the JD\'s own category language. If it names a category, create a skills line with that exact label and fill it with genuine, relevant items: "CS Fundamentals" → Data Structures & Algorithms, System Design, Object-Oriented Design, Concurrency, Distributed Systems. A domain emphasis (finance, healthcare) → a Domain line. AI-leaning → an AI & Tools line. Cloud-leaning → a Cloud & DevOps line.',
  "- Lead each line with the JD's must-haves first, then supporting items.",
  '- Only list skills with real evidence somewhere (a bullet, a project, a cert). Unsupported skills read as manufactured and invite questions you cannot answer.',
  '- Skip the basics every candidate in the field is assumed to have.',
  '- Reorder or rename lines per role so the section looks purpose-built for this JD, not generic.',
  '',
  'Step 5 — Projects and other sections.',
  '- Any project should read like real, outcome-driven engineering with metrics and users, not a class assignment.',
  '- You may REORDER an existing coursework/certs line to surface what this JD values (algorithms and systems courses first for a fundamentals-heavy role), but never add, remove or reword a course, certification, degree or institution. Education is a fixed fact, like employers and dates.',
  '',
  'Formatting: job title first, then employer; bold employer names and key terms. Consistent end-of-line punctuation. One page, no wasted whitespace, no objective/summary block unless asked. Preserve all existing hyperlinks. Keep the same clean font and template as the current résumé.',
].join('\n');
