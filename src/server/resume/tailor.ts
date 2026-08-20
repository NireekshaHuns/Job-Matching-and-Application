/**
 * Corpus résumé tailoring generator (the Studio flow). Synthesizes an
 * aggressive-but-coherent one-page LaTeX résumé from retrieved real bullets +
 * the candidate profile — inventing strong, plausible detail while never
 * touching fixed facts (employers/titles/dates/degree). Self-checks the output
 * against the quality linter and re-prompts on failures. The network call is
 * behind an injected ChatClient (fakes-first).
 */
import type { ChatClient } from '@/server/enrich/types';
import { formatProfileForPrompt, type ResumeProfileFacts } from './profile';
import {
  buildDefencePoints,
  buildKeywordCoverage,
  type DefencePoint,
  type KeywordPlacement,
} from './coverage';
import { lintResume, type LintReport } from './quality';
import { OWNER_TAILORING_METHOD, RESUME_RUBRIC_PROMPT } from './rubric';

/** Strip accidental ```/```latex fences the model may add. */
function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:latex)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function errorCount(lint: LintReport): number {
  return lint.violations.filter((v) => v.severity === 'error').length;
}

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

export function buildCorpusTailorMessages(
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  baseTemplate: string,
  priorViolations: string[] = [],
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
    'Use the LaTeX document below as the exact format (packages, header, section style, one page). Keep the',
    'header/identity and the employers, titles, dates, and education anchors; rewrite the EXPERIENCE, PROJECTS,',
    'and TECHNICAL SKILLS content for this job. Respond with ONLY the full LaTeX document — no prose, no code fences.',
  ].join('\n');

  const bulletLines =
    inputs.bullets.map((b) => `- ${b.text}${b.company ? ` [${b.company}]` : ''}`).join('\n') ||
    '(no prior bullets — synthesize from the profile + stack notes)';

  const adjacent = inputs.adjacentKeywords ?? [];

  const user = [
    formatProfileForPrompt(inputs.profile),
    '',
    `TARGET JOB: ${job.title} at ${job.company}`,
    'KEYWORDS TO WORK IN, IN PRIORITY ORDER (highest first — if they cannot all fit naturally, drop',
    `from the END, never from the front; spread them, no stuffing): ${inputs.selectedKeywords.join(', ') || '(none)'}`,
    ...(adjacent.length > 0 ? adjacentBlock(adjacent) : []),
    '',
    'REAL BULLETS FROM PAST RESUMES (raw material — synthesize and strengthen, do not copy verbatim):',
    bulletLines,
    '',
    'FORMAT TEMPLATE (LaTeX):',
    baseTemplate,
    ...(priorViolations.length > 0
      ? [
          '',
          'Fix these issues from your previous attempt:',
          ...priorViolations.map((v) => `- ${v}`),
        ]
      : []),
  ].join('\n');

  return { system, user };
}

export interface CorpusTailorReport {
  selectedKeywords: string[];
  /** Ticked without corpus evidence — reported as honest gaps, never gated on. */
  adjacentKeywords: string[];
  attempts: number;
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
  report: CorpusTailorReport;
}

/**
 * Generate a résumé from the corpus, re-prompting with linter errors until it
 * passes or `maxAttempts` is reached. Free-form (no template-lock contract), so
 * the linter checks quality + keyword coverage only. Returns the attempt with
 * the fewest linter errors.
 */
export async function tailorFromCorpus(
  baseTemplate: string,
  job: CorpusTailorJob,
  inputs: CorpusTailorInputs,
  chat: ChatClient,
  opts: { maxAttempts?: number } = {},
): Promise<CorpusTailorResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const adjacent = inputs.adjacentKeywords ?? [];
  // The coverage check must NOT see the adjacent-only keywords: a low ratio
  // re-prompts the model to work them in, which is precisely what we just told
  // it not to do. They are reported, never gated on.
  const reportable = [...inputs.selectedKeywords, ...adjacent];
  let violations: string[] = [];
  let best: { latex: string; lint: LintReport } | undefined;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    const latex = stripFences(
      await chat.complete(buildCorpusTailorMessages(job, inputs, baseTemplate, violations)),
    );
    const lint = lintResume(latex, {
      jdKeywords: inputs.selectedKeywords,
      minKeywordCoverage: 0.7,
    });
    if (!best || errorCount(lint) < errorCount(best.lint)) best = { latex, lint };
    if (lint.ok) break;
    violations = lint.violations.filter((v) => v.severity === 'error').map((v) => v.message);
  }

  const chosen = best as { latex: string; lint: LintReport };
  return {
    latex: chosen.latex,
    report: {
      selectedKeywords: inputs.selectedKeywords,
      adjacentKeywords: adjacent,
      attempts,
      lint: chosen.lint,
      // Read off the document we are actually returning, not the one the model
      // says it wrote. Both panels see the adjacent keywords too: coverage so
      // you can tell what became of them, and defence so that if the model
      // claimed one anyway it gets flagged before you send it.
      coverage: buildKeywordCoverage(chosen.latex, reportable),
      defence: buildDefencePoints(chosen.latex, inputs.masterSkills ?? [], reportable),
      masterSkills: inputs.masterSkills ?? [],
    },
  };
}
