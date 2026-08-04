/**
 * Resume tailoring generators. Both self-check output against the quality linter
 * and re-prompt on failures; the network call is behind an injected ChatClient
 * (fakes-first). Two flows:
 *
 * 1. Legacy job×base (`selectTailoringInputs` + `tailorResume`): bounded by the
 *    truthful inventory — only coverable keywords (job ∩ master) and the user's
 *    real bullets are sent, and true gaps are reported, never faked.
 * 2. Corpus Studio (`tailorFromCorpus`): aggressive-but-coherent — synthesizes
 *    from retrieved real bullets + the candidate profile and may invent strong,
 *    plausible detail (fixed facts — employers/titles/dates/degree — excepted).
 */
import type { ChatClient } from '@/server/enrich/types';
import { computeFit, resumeSkillsFromBullets, type BulletLike, type FitResult } from './fit';
import { formatProfileForPrompt, type ResumeProfileFacts } from './profile';
import { lintResume, type LintReport } from './quality';
import { RESUME_RUBRIC_PROMPT } from './rubric';

export interface TailorBullet extends BulletLike {
  text: string;
}

export interface TailorJob {
  title: string;
  company: string;
  techKeywords: string[];
  softKeywords: string[];
}

export interface TailorInputs {
  /** Keywords the user can truthfully surface (job ∩ master). */
  coverableKeywords: string[];
  /** Job keywords the user lacks — reported, never sent to the model. */
  trueGaps: string[];
  /** Real bullets relevant to this job, scoped to the resume's role. */
  relevantBullets: TailorBullet[];
  /** The fit computation these inputs were derived from (as-is vs. achievable). */
  fit: FitResult;
}

/** Max bullets handed to the model — enough context without bloating the prompt. */
const MAX_RELEVANT_BULLETS = 15;

/**
 * Choose the truthful keywords to weave in and the real bullets to draw from.
 * Pure — no LLM.
 */
export function selectTailoringInputs(
  job: TailorJob,
  masterSkills: string[],
  bullets: TailorBullet[],
  resumeRoleFamily: BulletLike['roleFamily'],
): TailorInputs {
  const jobKeywords = [...job.techKeywords, ...job.softKeywords];
  const resumeSkills = resumeSkillsFromBullets(bullets, resumeRoleFamily);
  const fit = computeFit({ jobKeywords, resumeSkills, masterSkills });

  // Coverable = already-matched plus truthfully-addable; never the true gaps.
  const coverableKeywords = [...fit.matched, ...fit.missingAddable];
  const coverableSet = new Set(coverableKeywords);

  const inRole = (b: TailorBullet) =>
    resumeRoleFamily === null || b.roleFamily === null || b.roleFamily === resumeRoleFamily;

  const relevantBullets = bullets
    .filter(inRole)
    .filter((b) => b.skills.some((s) => coverableSet.has(s.trim().toLowerCase())))
    .slice(0, MAX_RELEVANT_BULLETS);

  return { coverableKeywords, trueGaps: fit.missingGap, relevantBullets, fit };
}

export function buildTailorMessages(
  baseResumeLatex: string,
  job: TailorJob,
  inputs: TailorInputs,
  priorViolations: string[] = [],
): { system: string; user: string } {
  const system = [
    RESUME_RUBRIC_PROMPT,
    '',
    'You are given a base resume in LaTeX. Rewrite it, tailored to the job, and respond with ONLY the full LaTeX document — no prose, no code fences.',
    'Only use skills from the "coverable keywords" list and accomplishments from the provided bullets. Do not invent skills, employers, or metrics.',
  ].join('\n');

  const bulletLines = inputs.relevantBullets.map((b) => `- ${b.text}`).join('\n') || '(none)';
  const user = [
    `Job: ${job.title} at ${job.company}`,
    `Coverable keywords (weave in naturally, no stuffing): ${inputs.coverableKeywords.join(', ') || '(none)'}`,
    '',
    'Relevant real accomplishments to draw from:',
    bulletLines,
    '',
    'Base resume (LaTeX):',
    baseResumeLatex,
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

export interface TailorReport {
  coverableKeywords: string[];
  trueGaps: string[];
  /** True-gap keywords that appear in the output anyway — verify these are real. */
  unexpectedGaps: string[];
  attempts: number;
  lint: LintReport;
}

export interface TailorResult {
  latex: string;
  report: TailorReport;
}

/** Strip accidental ```/```latex fences the model may add. */
function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:latex)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True-gap keywords (whole-word) that leaked into the generated resume. */
function findUnexpectedGaps(latex: string, trueGaps: string[]): string[] {
  const hay = latex.toLowerCase();
  return trueGaps.filter((g) =>
    new RegExp(`(?<![a-z0-9])${escapeRegExp(g.toLowerCase())}(?![a-z0-9])`).test(hay),
  );
}

function errorCount(lint: LintReport): number {
  return lint.violations.filter((v) => v.severity === 'error').length;
}

/**
 * Generate a tailored resume, re-prompting with linter violations until it
 * passes or `maxAttempts` is reached. Returns the attempt with the fewest
 * linter errors (not necessarily the last) plus its report.
 */
export async function tailorResume(
  baseResumeLatex: string,
  job: TailorJob,
  inputs: TailorInputs,
  chat: ChatClient,
  opts: { maxAttempts?: number } = {},
): Promise<TailorResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  let violations: string[] = [];
  let best: { latex: string; lint: LintReport } | undefined;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    const latex = stripFences(
      await chat.complete(buildTailorMessages(baseResumeLatex, job, inputs, violations)),
    );
    const lint = lintResume(latex, {
      jdKeywords: inputs.coverableKeywords,
      base: baseResumeLatex,
    });
    if (!best || errorCount(lint) < errorCount(best.lint)) best = { latex, lint };
    if (lint.ok) break;
    violations = lint.violations.filter((v) => v.severity === 'error').map((v) => v.message);
  }

  // best is always set: the loop runs at least once (maxAttempts >= 1).
  const chosen = best as { latex: string; lint: LintReport };
  return {
    latex: chosen.latex,
    report: {
      coverableKeywords: inputs.coverableKeywords,
      trueGaps: inputs.trueGaps,
      unexpectedGaps: findUnexpectedGaps(chosen.latex, inputs.trueGaps),
      attempts,
      lint: chosen.lint,
    },
  };
}

// ---------------------------------------------------------------------------
// Corpus tailoring — the Studio flow (aggressive-but-coherent, from uploads)
// ---------------------------------------------------------------------------

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
  /** Tech + soft keywords the user ticked to include (lowercased). */
  selectedKeywords: string[];
  /** Retrieved real bullets to synthesize from (not copy verbatim). */
  bullets: CorpusSourceBullet[];
  /** Fixed candidate facts + preferred real metrics/stack. */
  profile: ResumeProfileFacts;
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
    'Use the LaTeX document below as the exact format (packages, header, section style, one page). Keep the',
    'header/identity and the employers, titles, dates, and education anchors; rewrite the EXPERIENCE, PROJECTS,',
    'and TECHNICAL SKILLS content for this job. Respond with ONLY the full LaTeX document — no prose, no code fences.',
  ].join('\n');

  const bulletLines =
    inputs.bullets
      .map((b) => `- ${b.text}${b.company ? ` [${b.company}]` : ''}`)
      .join('\n') || '(no prior bullets — synthesize from the profile + stack notes)';

  const user = [
    formatProfileForPrompt(inputs.profile),
    '',
    `TARGET JOB: ${job.title} at ${job.company}`,
    `KEYWORDS TO WORK IN (spread naturally, no stuffing): ${inputs.selectedKeywords.join(', ') || '(none)'}`,
    '',
    'REAL BULLETS FROM PAST RESUMES (raw material — synthesize and strengthen, do not copy verbatim):',
    bulletLines,
    '',
    'FORMAT TEMPLATE (LaTeX):',
    baseTemplate,
    ...(priorViolations.length > 0
      ? ['', 'Fix these issues from your previous attempt:', ...priorViolations.map((v) => `- ${v}`)]
      : []),
  ].join('\n');

  return { system, user };
}

export interface CorpusTailorReport {
  selectedKeywords: string[];
  attempts: number;
  lint: LintReport;
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
    report: { selectedKeywords: inputs.selectedKeywords, attempts, lint: chosen.lint },
  };
}
