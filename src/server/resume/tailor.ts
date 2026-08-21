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
  checkResumeOutline,
  checkResumePlan,
  describeSlot,
  mergeOutline,
  parseBulletsPlan,
  parseResumeOutline,
  SKILL_ROW_RANGE,
  type BulletsPlan,
  type PlanContext,
  type PlanIssue,
  type ResumeOutline,
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

/** Shared preamble: the fixed facts, the target, the keywords, the raw material. */
function buildSharedContext(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  priorIssues: string[],
): string[] {
  const bulletLines =
    inputs.bullets.map((b) => `- ${b.text}${b.company ? ` [${b.company}]` : ''}`).join('\n') ||
    '(no prior bullets — synthesize from the profile + stack notes)';
  const adjacent = inputs.adjacentKeywords ?? [];

  return [
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
  ];
}

/** The slot vocabulary, shared by the contract and the approved-outline echo. */
function slotForms(): string[] {
  return [
    'A <slot> is exactly one of:',
    `  {"kind":"role","roleId":"<${RESUME_ROLES.map((r) => r.id).join('" | "')}>","bulletIndex":<0-based>}`,
    `  {"kind":"project","bulletIndex":<0-${BULLET_BUDGET.projects - 1}>}`,
    '  {"kind":"skills","label":"<one of your row labels>"}',
    '  {"kind":"coursework"}',
    '  {"kind":"none","reason":"<why this keyword cannot be placed honestly>"}',
  ];
}

/**
 * Stage A's contract: the decisions, and deliberately not a word of prose.
 *
 * Counts come out of `template.ts`, so what the model is asked for and what the
 * renderer offers cannot drift apart — the failure mode a hand-written prompt
 * has by construction.
 */
export function buildOutlineContract(): string {
  const roleSlots = RESUME_ROLES.map(
    (r) => `  - "${r.id}" (${r.title}, ${r.employer}): bullets 1-${r.bullets}`,
  );
  return [
    'THIS IS THE PLANNING STAGE. You decide WHERE things go; someone approves it; only then does',
    'anyone write bullets. Do NOT write bullet prose here — it will be thrown away.',
    '',
    'RESPOND WITH ONE JSON OBJECT AND NOTHING ELSE — no LaTeX, no prose, no code fences.',
    '',
    'SHAPE (any other key is a hard failure):',
    '{',
    `  "coursework": [ ${COURSEWORK_SLOTS.min}-${COURSEWORK_SLOTS.max} courses, copied verbatim from the pool, most relevant to this job first ],`,
    `  "skills": [ ${SKILL_ROW_RANGE.min}-${SKILL_ROW_RANGE.max} rows of { "label": "...", "items": ["...", "..."] } ],`,
    '  "placements": [ { "keyword": "...", "slot": <slot> } ]',
    '}',
    '',
    ...slotForms(),
    '',
    'The bullet slots that exist (these are all of them — the layout is fixed):',
    ...roleSlots,
    `  - project: bullets 1-${BULLET_BUDGET.projects}`,
    '',
    'HARD RULES:',
    '- EVERY keyword in the priority list needs a placement. Use {"kind":"none"} only when the material',
    '  genuinely cannot support it, and say why — an honest "none" is better than a claim you cannot defend.',
    '- Spread the keywords. Piling six into one bullet is stuffing, and one bullet cannot carry them.',
    "- Skills row labels mirror the POSTING's own category language; the items must come from the",
    "  candidate's real skills listed below.",
    '- Plain text only inside every string. No LaTeX, no markdown.',
  ].join('\n');
}

/** Stage B's contract: prose for slots that are already decided. */
export function buildBulletsContract(): string {
  const roleLines = RESUME_ROLES.map(
    (r) =>
      `    { "roleId": "${r.id}", "bullets": [ exactly ${r.bullets} strings ] },   // ${r.title}, ${r.employer}`,
  );
  return [
    'THIS IS THE WRITING STAGE. The outline below is APPROVED and settled: the coursework line, the',
    'skills rows and the home of every keyword are decided. Write the bullets that honour it.',
    '',
    'RESPOND WITH ONE JSON OBJECT AND NOTHING ELSE — no LaTeX, no prose, no code fences.',
    '',
    'SHAPE (any other key is a hard failure — the coursework and skills are NOT yours to send back):',
    '{',
    '  "roles": [',
    roleLines.join('\n'),
    '  ],',
    `  "project": { "stack": "comma-separated technologies", "bullets": [ exactly ${BULLET_BUDGET.projects} strings ] }`,
    '}',
    '',
    'HARD RULES:',
    `- Bullet length: ${BULLET_CHARS.min}-${BULLET_CHARS.max} characters of plain text each. That is two full lines in this layout;`,
    '  shorter leaves a half-empty line, longer wraps to a third and pushes the résumé onto page two.',
    '- Plain text only inside every string. No LaTeX commands, no markdown, no bold — the renderer',
    '  handles all formatting, and any markup you write is stripped before it is measured.',
    '- Bullet counts are exact, not minimums. Cut the weakest bullet rather than shortening them all.',
    '- Every keyword assigned to a bullet below must genuinely appear in THAT bullet.',
  ].join('\n');
}

/** The approved outline, restated as the constraints stage B has to honour. */
function approvedOutlineBlock(outline: ResumeOutline): string[] {
  const placements = outline.placements.map((p) => `  - ${p.keyword} → ${describeSlot(p.slot)}`);
  return [
    '',
    'APPROVED OUTLINE — decided already, not open for revision:',
    `Coursework (already rendered, do not send it back): ${outline.coursework.join(', ') || '(none)'}`,
    'Skills rows (already rendered, do not send them back):',
    ...outline.skills.map((row) => `  - ${row.label}: ${row.items.join(', ')}`),
    ...(placements.length > 0
      ? ['Keyword homes — put each one in the slot it was given:', ...placements]
      : []),
  ];
}

/** The shared system prompt: rubric, stance, method, then the stage's contract. */
function systemPrompt(contract: string): string {
  return [
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
    contract,
  ].join('\n');
}

export function buildOutlineMessages(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  priorIssues: string[] = [],
): { system: string; user: string } {
  return {
    system: systemPrompt(buildOutlineContract()),
    user: buildSharedContext(job, inputs, priorIssues).join('\n'),
  };
}

export function buildBulletsMessages(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  outline: ResumeOutline,
  priorIssues: string[] = [],
): { system: string; user: string } {
  const shared = buildSharedContext(job, inputs, []);
  return {
    system: systemPrompt(buildBulletsContract()),
    user: [
      ...shared,
      ...approvedOutlineBlock(outline),
      ...(priorIssues.length > 0
        ? [
            '',
            'Fix these problems with your previous attempt:',
            ...priorIssues.map((v) => `- ${v}`),
          ]
        : []),
    ].join('\n'),
  };
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

/** A stage-A outline plus what the checker made of it. */
export interface OutlineResult {
  /** Repaired and approvable. The owner may still edit it before stage B. */
  outline: ResumeOutline;
  issues: PlanIssue[];
  repairs: string[];
  attempts: number;
}

/**
 * A shared loop for both stages: ask, parse, check, re-prompt on the issues only
 * a fresh generation can fix, and keep the least-bad attempt.
 *
 * Attempt three is not automatically better than attempt one, which is why the
 * best is tracked rather than the last. A parse failure keeps nothing — there is
 * no partial answer to repair — and hands the parser's own message back.
 */
async function generate<T, C extends { issues: PlanIssue[] }>(
  chat: ChatClient,
  maxAttempts: number,
  ask: (priorIssues: string[]) => { system: string; user: string },
  parse: (raw: string) => T,
  check: (parsed: T) => C,
): Promise<{ checked: C; attempts: number }> {
  let priorIssues: string[] = [];
  let best: { checked: C; retryable: number } | undefined;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    const raw = await chat.complete(ask(priorIssues));
    let parsed: T;
    try {
      parsed = parse(raw);
    } catch (err) {
      priorIssues = [err instanceof Error ? err.message : String(err)];
      continue;
    }
    const checked = check(parsed);
    const retryable = checked.issues.filter((issue) => issue.retryable);
    if (!best || retryable.length < best.retryable) {
      best = { checked, retryable: retryable.length };
    }
    if (retryable.length === 0) break;
    priorIssues = retryable.map((issue) => issue.message);
  }

  if (!best) {
    throw new Error(
      `Resume generation failed after ${attempts} attempt(s): ${priorIssues.join('; ')}`,
    );
  }
  return { checked: best.checked, attempts };
}

/** The plan context both stages check against, derived from the same inputs. */
function planContext(inputs: CorpusTailorInputs): PlanContext {
  return {
    coursePool: inputs.profile.coursework,
    masterSkills: inputs.masterSkills ?? [],
    // Only the corpus-backed list gates. Requiring the adjacent-only keywords
    // would re-prompt the model to claim exactly what we just told it it cannot
    // defend — they are reported, never required.
    mustHaveKeywords: inputs.selectedKeywords,
  };
}

/**
 * STAGE A — the outline the owner approves: which courses to show, what the
 * skills rows are called, and where each keyword is going to live.
 *
 * Cheap on purpose. This is the decision worth a human's judgement, and finding
 * out here that a keyword has no honest home costs one small call instead of a
 * full generation the owner then has to throw away.
 */
export async function outlineFromCorpus(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  chat: ChatClient,
  opts: { maxAttempts?: number } = {},
): Promise<OutlineResult> {
  const ctx = planContext(inputs);
  const run = await generate(
    chat,
    Math.max(1, opts.maxAttempts ?? 2),
    (priorIssues) => buildOutlineMessages(job, inputs, priorIssues),
    parseResumeOutline,
    (parsed) => checkResumeOutline(parsed, ctx),
  );
  return {
    outline: run.checked.outline,
    issues: run.checked.issues,
    repairs: run.checked.repairs,
    attempts: run.attempts,
  };
}

/**
 * STAGE B — write the bullets for an APPROVED outline, then render.
 *
 * The outline is not re-derived and not re-negotiated: it is merged in as-is, so
 * a retry can only rewrite prose. That is the guarantee the checkpoint buys —
 * approving an outline means the résumé that comes back is built on that outline
 * and not on a fresh idea the third attempt had.
 */
export async function tailorFromCorpus(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  outline: ResumeOutline,
  chat: ChatClient,
  opts: { maxAttempts?: number } = {},
): Promise<CorpusTailorResult> {
  const adjacent = inputs.adjacentKeywords ?? [];
  const masterSkills = inputs.masterSkills ?? [];
  const reportable = [...inputs.selectedKeywords, ...adjacent];
  const ctx = planContext(inputs);

  const run = await generate(
    chat,
    Math.max(1, opts.maxAttempts ?? 3),
    (priorIssues) => buildBulletsMessages(job, inputs, outline, priorIssues),
    parseBulletsPlan,
    (parsed: BulletsPlan) => checkResumePlan(mergeOutline(outline, parsed), ctx),
  );
  const checked = run.checked;
  const latex = renderResumePlan(inputs.profile, checked.plan);

  return {
    latex,
    plan: checked.plan,
    report: {
      selectedKeywords: inputs.selectedKeywords,
      adjacentKeywords: adjacent,
      reportKeywords: reportable,
      attempts: run.attempts,
      planIssues: checked.issues,
      repairs: checked.repairs,
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
