/**
 * Resume tailoring generator. Produces a tailored LaTeX resume for a specific
 * job from a base resume + the truthful inventory, then self-checks it against
 * the Inc 1 quality linter, re-prompting on failures.
 *
 * Truthfulness is bounded structurally: the model is only ever given the
 * coverable keywords (job keywords the user actually has) and the user's real
 * bullets. True gaps are surfaced in the report, never sent to the model to
 * "cover". The network call is behind an injected ChatClient (fakes-first).
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

/**
 * Generate a tailored resume, re-prompting with linter violations until it
 * passes or `maxAttempts` is reached. Returns the best attempt with its report.
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
  let latex = '';
  let lint: LintReport | undefined;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    latex = stripFences(
      await chat.complete(buildTailorMessages(baseResumeLatex, job, inputs, violations)),
    );
    lint = lintResume(latex, { jdKeywords: inputs.coverableKeywords });
    if (lint.ok) break;
    violations = lint.violations.filter((v) => v.severity === 'error').map((v) => v.message);
  }

  return {
    latex,
    report: {
      coverableKeywords: inputs.coverableKeywords,
      trueGaps: inputs.trueGaps,
      attempts,
      // Non-null: the loop runs at least once (maxAttempts >= 1).
      lint: lint as LintReport,
    },
  };
}
