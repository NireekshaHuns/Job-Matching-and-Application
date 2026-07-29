/**
 * Resume tailoring generator. Produces a tailored LaTeX resume for a specific
 * job from a base resume + the truthful inventory, then self-checks it against
 * the Inc 1 quality linter, re-prompting on failures.
 *
 * Truthfulness: we never *ask* the model to introduce a job keyword the user
 * lacks — the prompt only carries coverable keywords (job ∩ master) and the
 * user's real bullets. The base resume and bullets are the user's own content,
 * so anything they carry is truthful by construction. As a backstop, the report
 * flags any true-gap keyword that nonetheless appears in the output, for review.
 * The network call is behind an injected ChatClient (fakes-first).
 */
import type { ChatClient } from '@/server/enrich/types';
import { computeFit, resumeSkillsFromBullets, type BulletLike } from './fit';
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

  return { coverableKeywords, trueGaps: fit.missingGap, relevantBullets };
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
    const lint = lintResume(latex, { jdKeywords: inputs.coverableKeywords });
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
