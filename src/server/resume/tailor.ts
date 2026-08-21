/**
 * Corpus résumé tailoring generator (the Studio flow). Synthesizes an
 * aggressive-but-coherent one-page résumé from retrieved real bullets + the
 * candidate profile — inventing strong, plausible detail while never touching
 * fixed facts (employers/titles/dates/degree).
 *
 * The model returns a PLAN, never a document: `plan.ts` owns the shape and the
 * repair-vs-retry split, `render.ts` turns the checked plan into the only LaTeX
 * this codebase emits, and this module owns the loop between them. Asking for
 * LaTeX is what let a generation come back with its own preamble, a fabricated
 * degree and an invented Certifications section; those are now unrepresentable
 * rather than lint-checked. The network call stays behind an injected
 * ChatClient (fakes-first).
 */
import type { ChatClient } from '@/server/enrich/types';
import { formatProfileForPrompt, type ResumeProfileFacts } from './profile';
import {
  buildDefencePoints,
  buildKeywordCoverage,
  type DefencePoint,
  type KeywordPlacement,
} from './coverage';
import {
  checkResumePlan,
  parseResumePlan,
  SKILL_ROW_RANGE,
  type PlanContext,
  type PlanIssue,
  type ResumePlan,
} from './plan';
import { lintResume, type LintReport } from './quality';
import { renderResumePlan } from './render';
import { BULLET_CHARS, OWNER_TAILORING_METHOD, RESUME_RUBRIC_PROMPT } from './rubric';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES } from './template';

/** The target for a corpus generation — a pasted JD, not a stored job row. */
export interface CorpusTailorJob {
  title: string;
  company: string;
}

/** A real bullet retrieved from the corpus, handed to the model as raw material. */
export interface CorpusSourceBullet {
  text: string;
  company: string | null;
}

export interface CorpusTailorInputs {
  /**
   * Keywords the user ticked AND the corpus backs, highest priority first. The
   * résumé may claim these outright.
   */
  selectedKeywords: string[];
  /**
   * Keywords the user ticked despite the corpus having no evidence for them.
   * The résumé must gesture at the adjacent experience it really has, in the
   * posting's own umbrella wording, and never claim the technology itself.
   */
  adjacentKeywords?: string[];
  /** Retrieved real bullets to synthesize from (not copy verbatim). */
  bullets: CorpusSourceBullet[];
  /** Fixed candidate facts + preferred real metrics/stack. */
  profile: ResumeProfileFacts;
  /**
   * The user's truthful skill superset. Used only to flag, after generation,
   * any technology the résumé now claims that this list does not support.
   */
  masterSkills?: string[];
}

/**
 * The invention stance for the corpus flow (the legacy path forbids invention;
 * this one allows it, within hard coherence limits). Kept separate from
 * `RESUME_RUBRIC_PROMPT` so the shared rubric stays stance-neutral.
 */
export const CORPUS_INVENTION_STANCE = [
  'Generate the strongest possible resume for THIS job. You may aggressively rephrase, merge, sharpen,',
  'and invent accomplishments and metrics that make the candidate a top applicant — as long as everything',
  'stays realistic, internally consistent, and defensible in an interview: no absurd or self-contradicting',
  'numbers, and consistent with the role, seniority, timeline, and confirmed stack below. Prefer the',
  "candidate's real, verified metrics where given; invent only to fill gaps, and keep invented numbers",
  'plausible and non-uniform (avoid suspiciously round or repeated figures). Never fabricate employers, job',
  'titles, dates, or degrees — those are fixed facts. The result must be strong AND sensible, never rubbishy.',
].join('\n');

/**
 * The instruction for keywords the posting asks for and the corpus cannot back.
 *
 * Named honestly to the model rather than quietly dropped, because the useful
 * move is not silence: it is to surface the genuinely adjacent experience under
 * the posting's own umbrella term. Claiming the tool itself is the one outcome
 * that must not happen — see the OR-requirement rule in the method above.
 */
function adjacentBlock(adjacent: readonly string[]): string[] {
  return [
    '',
    'ADJACENT ONLY — the posting asks for these and NOTHING in the material below supports them:',
    ...adjacent.map((k) => `- ${k}`),
    'Do NOT name these technologies and do NOT claim the candidate has used them. Instead surface the',
    "genuinely adjacent experience the material DOES support, in the posting's own umbrella wording",
    '(for "Kubernetes" with no Kubernetes bullet: the container orchestration and deployment automation',
    'they really did). The concept must be real and defensible in an interview; the tool must not be',
    'claimed. A keyword you cannot defend in an interview is worse than a missing one.',
  ];
}

/**
 * The JSON contract, written FROM the layout rather than alongside it.
 *
 * Every count here is read out of `template.ts`, so the slots the model is
 * asked to fill and the slots the renderer offers cannot drift apart — the
 * failure mode a hand-written prompt has by construction.
 */
export function buildPlanContract(): string {
  const roleLines = RESUME_ROLES.map(
    (r) =>
      `    { "roleId": "${r.id}", "bullets": [ exactly ${r.bullets} strings ] }   // ${r.title}, ${r.employer}`,
  );
  return [
    'RESPOND WITH ONE JSON OBJECT AND NOTHING ELSE — no LaTeX, no prose, no code fences.',
    '',
    'You are filling the fixed slots of an existing one-page document, not writing a document. The',
    'preamble, the header, the education block, the employers, the titles, the dates and the section',
    'order are already set and have no field below. Exactly four things are yours: the coursework',
    'selection, the bullets, the project stack line, and the skills rows.',
    '',
    'SHAPE (any other key is a hard failure):',
    '{',
    `  "coursework": [ ${COURSEWORK_SLOTS.min}-${COURSEWORK_SLOTS.max} courses, copied verbatim from the pool, most relevant to this job first ],`,
    '  "roles": [',
    roleLines.join('\n'),
    '  ],',
    `  "project": { "stack": "comma-separated technologies", "bullets": [ exactly ${BULLET_BUDGET.projects} strings ] },`,
    `  "skills": [ ${SKILL_ROW_RANGE.min}-${SKILL_ROW_RANGE.max} rows of { "label": "...", "items": ["...", "..."] } ],`,
    '  "placements": [ { "keyword": "...", "slot": <slot> } ]',
    '}',
    '',
    'A <slot> is exactly one of:',
    '  {"kind":"role","roleId":"<one of the ids above>","bulletIndex":<0-based>}',
    '  {"kind":"project","bulletIndex":<0-based>}',
    '  {"kind":"skills","label":"<one of your row labels>"}',
    '  {"kind":"coursework"}',
    '  {"kind":"none","reason":"<why this keyword could not be placed honestly>"}',
    '',
    'HARD RULES:',
    `- Bullet length: ${BULLET_CHARS.min}-${BULLET_CHARS.max} characters of plain text each. That is two full lines in this layout;`,
    '  shorter leaves a half-empty line, longer wraps to a third and pushes the résumé onto page two.',
    '- Plain text only inside every string. No LaTeX commands, no markdown, no bold — the renderer',
    '  handles all formatting, and any markup you write is stripped before it is measured.',
    '- Bullet counts are exact, not minimums. Cut the weakest bullet rather than shortening them all.',
    "- Skills row labels mirror the POSTING's own category language; the items must come from the",
    "  candidate's real skills listed below.",
    '- Every keyword in the priority list must be genuinely present in a bullet or a skills row.',
    '  Record where you put each one in "placements" — including the ones you could not place.',
  ].join('\n');
}

/** The skills the résumé may claim, as a closed set the checker also enforces. */
function masterSkillBlock(masterSkills: readonly string[]): string[] {
  if (masterSkills.length === 0) return [];
  return [
    '',
    'SKILLS YOU MAY LIST (the candidate\'s real skills — every item in "skills" must come from here;',
    'anything else is dropped before the document is built):',
    masterSkills.join(', '),
  ];
}

export function buildPlanTailorMessages(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  priorIssues: string[] = [],
): { system: string; user: string } {
  const system = [
    RESUME_RUBRIC_PROMPT,
    '',
    CORPUS_INVENTION_STANCE,
    '',
    // Layered rather than merged, at the owner's request. The two sections
    // overlap and occasionally give different specifics (word counts, bullet
    // counts), so the precedence is stated outright — a model handed two rule
    // sets without a tie-breaker picks arbitrarily.
    OWNER_TAILORING_METHOD,
    '',
    buildPlanContract(),
  ].join('\n');

  const bulletLines =
    inputs.bullets.map((b) => `- ${b.text}${b.company ? ` [${b.company}]` : ''}`).join('\n') ||
    '(no prior bullets — synthesize from the profile + stack notes)';

  const adjacent = inputs.adjacentKeywords ?? [];

  const user = [
    formatProfileForPrompt(inputs.profile),
    ...masterSkillBlock(inputs.masterSkills ?? []),
    '',
    `TARGET JOB: ${job.title} at ${job.company}`,
    'KEYWORDS TO WORK IN, IN PRIORITY ORDER (highest first — if they cannot all fit naturally, drop',
    `from the END, never from the front; spread them, no stuffing): ${inputs.selectedKeywords.join(', ') || '(none)'}`,
    ...(adjacent.length > 0 ? adjacentBlock(adjacent) : []),
    '',
    'REAL BULLETS FROM PAST RESUMES (raw material — synthesize and strengthen, do not copy verbatim):',
    bulletLines,
    ...(priorIssues.length > 0
      ? ['', 'Fix these problems with your previous attempt:', ...priorIssues.map((v) => `- ${v}`)]
      : []),
  ].join('\n');

  return { system, user };
}

export interface CorpusTailorReport {
  selectedKeywords: string[];
  /** Ticked without corpus evidence — reported as honest gaps, never gated on. */
  adjacentKeywords: string[];
  /**
   * Both lists, for the report panels. A single stable array rather than one
   * the client concatenates: `TailoringReport` memoizes on this prop, and a
   * fresh array every render re-reads the whole document on every keystroke.
   */
  reportKeywords: string[];
  attempts: number;
  /** Everything the plan check found, repairs included, for the report panel. */
  planIssues: PlanIssue[];
  /** What was silently fixed on the way to a renderable plan. */
  repairs: string[];
  lint: LintReport;
  /** Where each selected keyword actually landed in the generated document. */
  coverage: KeywordPlacement[];
  /** Claims to check before submitting — see `buildDefencePoints`. */
  defence: DefencePoint[];
  /**
   * Echoed back so the Studio can recompute both panels from the LaTeX as the
   * user edits it. A report frozen at generation time starts lying the moment a
   * keyword is removed or a number corrected.
   */
  masterSkills: string[];
}

export interface CorpusTailorResult {
  latex: string;
  /** The checked plan the LaTeX was rendered from. */
  plan: ResumePlan;
  report: CorpusTailorReport;
}

/**
 * Generate a résumé from the corpus.
 *
 * Asks for a plan, checks it, and re-prompts ONLY on the issues a fresh
 * generation can fix — a dropped off-pool course or a trimmed extra bullet is
 * repaired in place, so those never cost an API call. Keeps the attempt with the
 * fewest retryable issues, because attempt three is not automatically better
 * than attempt one.
 */
export async function tailorFromCorpus(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  chat: ChatClient,
  opts: { maxAttempts?: number } = {},
): Promise<CorpusTailorResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const adjacent = inputs.adjacentKeywords ?? [];
  const masterSkills = inputs.masterSkills ?? [];
  const reportable = [...inputs.selectedKeywords, ...adjacent];

  const planCtx: PlanContext = {
    coursePool: inputs.profile.coursework,
    masterSkills,
    // Only the corpus-backed list gates. Requiring the adjacent-only keywords
    // would re-prompt the model to claim exactly what we just told it it cannot
    // defend — they are reported, never required.
    mustHaveKeywords: inputs.selectedKeywords,
  };

  let priorIssues: string[] = [];
  let best: { check: ReturnType<typeof checkResumePlan>; retryable: number } | undefined;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    const raw = await chat.complete(buildPlanTailorMessages(job, inputs, priorIssues));
    let parsed: ResumePlan;
    try {
      parsed = parseResumePlan(raw);
    } catch (err) {
      // Unparseable output leaves nothing to keep or repair, and the parser's
      // own message ("Unrecognized key: certifications") is the most useful
      // thing we can hand back.
      priorIssues = [err instanceof Error ? err.message : String(err)];
      continue;
    }
    const check = checkResumePlan(parsed, planCtx);
    const retryable = check.issues.filter((issue) => issue.retryable);
    if (!best || retryable.length < best.retryable) best = { check, retryable: retryable.length };
    if (retryable.length === 0) break;
    priorIssues = retryable.map((issue) => issue.message);
  }

  // Every attempt failed to parse. There is no plan to render, so this is a real
  // failure — the caller falls back to the untailored template.
  if (!best) {
    throw new Error(
      `Resume plan generation failed after ${attempts} attempt(s): ${priorIssues.join('; ')}`,
    );
  }

  const latex = renderResumePlan(inputs.profile, best.check.plan);
  return {
    latex,
    plan: best.check.plan,
    report: {
      selectedKeywords: inputs.selectedKeywords,
      adjacentKeywords: adjacent,
      reportKeywords: reportable,
      attempts,
      planIssues: best.check.issues,
      repairs: best.check.repairs,
      // The linter now runs on a document this codebase authored, so structural
      // rules cannot fail. It stays for what the plan cannot see: word count,
      // bystander verbs, missing metrics, buzzwords.
      lint: lintResume(latex, {
        jdKeywords: inputs.selectedKeywords,
        minKeywordCoverage: 0.7,
      }),
      // Read off the document we are actually returning, not the one the model
      // says it wrote. Both panels see the adjacent keywords too: coverage so
      // you can tell what became of them, and defence so that if the model
      // claimed one anyway it gets flagged before you send it.
      coverage: buildKeywordCoverage(latex, reportable),
      defence: buildDefencePoints(latex, masterSkills, reportable),
      masterSkills,
    },
  };
}
