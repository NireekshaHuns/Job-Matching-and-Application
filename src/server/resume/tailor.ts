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
import { lintResume, type LintReport } from './quality';
import { RESUME_RUBRIC_PROMPT } from './rubric';

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
    inputs.bullets.map((b) => `- ${b.text}${b.company ? ` [${b.company}]` : ''}`).join('\n') ||
    '(no prior bullets — synthesize from the profile + stack notes)';

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
