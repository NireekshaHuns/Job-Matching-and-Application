/**
 * The only function in the codebase that produces résumé LaTeX.
 *
 * It iterates the FIXED skeleton in `template.ts` and reads the plan only for
 * the slots that skeleton offers. Nothing a model returns can add a package,
 * rename a section, reorder employers, or change a degree, because the renderer
 * never asks the plan about any of those things — it asks the plan for bullet
 * text and skills values, and that is all it can be told.
 *
 * `buildDefaultTemplate` lives here too, as a plan with placeholder bullets, so
 * the no-API-key path and the compile check exercise this exact code rather than
 * a parallel implementation that can drift away from it.
 *
 * Pure: no DB, no LLM, no I/O.
 */
import type { ResumePlan } from './plan';
import type { ResumeProfileFacts } from './profile';
import {
  BULLET_BUDGET,
  buildEducationBlock,
  buildHeader,
  COURSEWORK_SLOTS,
  latexEscape,
  PREAMBLE,
  RESUME_ROLES,
  SKILL_CATEGORIES,
  sanitizeUrl,
  stripPlanMarkup,
} from './template';

/**
 * Turn a model-supplied string into safe body text.
 *
 * Strip LaTeX first, keeping the words inside the common emphasis commands, then
 * escape. The order matters: escaping `\textbf{Kafka}` without stripping yields
 * the visible garbage `\textbackslash{}textbf\{Kafka\}`, while stripping first
 * yields `Kafka`.
 *
 * There is deliberately NO allowlist for inline markup. An allowlist means a
 * brace-balancing mini-parser over model output, which is exactly the kind of
 * code path a `\usepackage{xcolor}` eventually slips through — and the whole
 * premise here is that no path emits markup the renderer did not author. Bold
 * inside a bullet is not a fidelity requirement: the owner's real bullets are
 * plain, and the renderer already bolds titles, employers and labels itself.
 *
 * Escaping also fixes a live rendering bug for free. `latexEscape` runs
 * `normalizeDashes`, and model prose is full of em dashes that the 8-bit WASM
 * pdfTeX would otherwise render as "â€”".
 */
export function sanitizePlanText(s: string): string {
  return latexEscape(stripPlanMarkup(s));
}

/**
 * An `itemize` with no items is a LaTeX error, not an empty list — and repairs
 * can legitimately empty a role — so the block is omitted rather than emitted
 * empty.
 */
function itemize(bullets: readonly string[]): string[] {
  if (bullets.length === 0) return [];
  return [
    '\\begin{itemize}',
    ...bullets.map((b) => `    \\item ${sanitizePlanText(b)}`),
    '\\end{itemize}',
  ];
}

function experienceBlock(plan: ResumePlan): string[] {
  const byRole = new Map(plan.roles.map((r) => [r.roleId.trim().toLowerCase(), r.bullets]));
  const out: string[] = [];

  // RESUME_ROLES is the iteration order, never the plan. This is the mechanism
  // that makes reordered or duplicated `roles` entries unable to reorder the
  // document, rather than something the linter has to notice afterwards.
  for (const [i, role] of RESUME_ROLES.entries()) {
    const bullets = (byRole.get(role.id) ?? []).slice(0, role.bullets);
    out.push(
      `\\textbf{${role.title}} \\hfill ${role.dates} \\\\`,
      `\\textit{${role.employer}} --- ${role.location}`,
      ...itemize(bullets),
    );
    if (i < RESUME_ROLES.length - 1) out.push('', '\\vspace{2pt}', '');
  }
  return out;
}

function projectBlock(p: ResumeProfileFacts, plan: ResumePlan): string[] {
  const name = latexEscape((p.projectName ?? 'Project').trim());
  const url = p.projectUrl ? sanitizeUrl(p.projectUrl) : '';
  const title = url ? `\\textbf{\\href{${url}}{${name}}}` : `\\textbf{${name}}`;

  return [
    '\\section*{PROJECTS}',
    '',
    `${title} \\textbar\\ `,
    `\\textit{${sanitizePlanText(plan.project.stack)}}`,
    ...itemize(plan.project.bullets.slice(0, BULLET_BUDGET.projects)),
  ];
}

function skillsBlock(plan: ResumePlan): string[] {
  if (plan.skills.length === 0) return [];
  return [
    '\\section*{TECHNICAL SKILLS}',
    // `\\` separates the rows; the LAST row must not have one, or LaTeX raises
    // "There's no line here to end" against \end{document}.
    ...plan.skills.map((row, i) => {
      const label = latexEscape(row.label);
      const items = row.items.map((item) => latexEscape(item)).join(', ');
      return `\\textbf{${label}:} ${items}${i < plan.skills.length - 1 ? '\\\\' : ''}`;
    }),
  ];
}

/** Compose a checked plan into the owner's template. */
export function renderResumePlan(p: ResumeProfileFacts, plan: ResumePlan): string {
  return [
    PREAMBLE,
    '',
    '\\begin{document}',
    '',
    buildHeader(p),
    '',
    '\\vspace{-4pt}',
    '',
    '',
    ...buildEducationBlock(p, plan.coursework),
    '',
    '\\vspace{2pt}',
    '',
    '\\section*{EXPERIENCE}',
    '',
    ...experienceBlock(plan),
    '',
    ...projectBlock(p, plan),
    '',
    '\\vspace{2pt}',
    '',
    ...skillsBlock(plan),
    '',
    '\\end{document}',
    '',
  ].join('\n');
}

const PLACEHOLDER_BULLET = 'Placeholder accomplishment bullet tailored to the target job';

/**
 * The plan behind the untailored template: real coursework in pool order, the
 * owner's default skill rows, and placeholder bullets.
 *
 * `masterSkills` fills the rows when the corpus has anything in it, so the
 * fallback document still shows something true rather than the same sentence six
 * times.
 */
export function placeholderPlan(
  p: ResumeProfileFacts,
  masterSkills: readonly string[] = [],
): ResumePlan {
  // Only as many rows as there is something true to put in them. Padding the
  // remainder with "Relevant items for the target job" made a corpus of three
  // skills look like a half-finished document.
  const rowCount =
    masterSkills.length === 0
      ? SKILL_CATEGORIES.length
      : Math.min(SKILL_CATEGORIES.length, masterSkills.length);
  const perRow = Math.ceil(masterSkills.length / rowCount);
  return {
    coursework: p.coursework.slice(0, COURSEWORK_SLOTS.max),
    roles: RESUME_ROLES.map((role) => ({
      roleId: role.id,
      bullets: Array.from({ length: role.bullets }, () => PLACEHOLDER_BULLET),
    })),
    project: {
      stack: 'Tech stack relevant to the target job',
      bullets: Array.from({ length: BULLET_BUDGET.projects }, () => PLACEHOLDER_BULLET),
    },
    skills: SKILL_CATEGORIES.slice(0, rowCount).map((label, i) => {
      const slice = masterSkills.slice(i * perRow, (i + 1) * perRow);
      return {
        label,
        items: slice.length > 0 ? [...slice] : ['Relevant items for the target job'],
      };
    }),
    placements: [],
  };
}

/**
 * The untailored one-page document.
 *
 * Kept under its original name — `scripts/verify-latex-compile.ts` and the
 * template tests import it — and now defined as "a plan, rendered", which is
 * both the thesis of this module and the reason the fallback path can never
 * diverge from the real one.
 */
export function buildDefaultTemplate(
  p: ResumeProfileFacts,
  masterSkills: readonly string[] = [],
): string {
  return renderResumePlan(p, placeholderPlan(p, masterSkills));
}
