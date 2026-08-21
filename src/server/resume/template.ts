/**
 * The owner's own one-page LaTeX résumé, as the format every generation must
 * follow: 11pt article, sourcesanspro, `titlesec` section headings with a rule
 * under them, tight margins, no page numbers, and the section order
 * EDUCATION → EXPERIENCE → PROJECTS → TECHNICAL SKILLS.
 *
 * This module holds only what is FIXED: the preamble, the header, the education
 * block, the role anchors and the one-page budgets. Turning a generated plan
 * into a document lives in `render.ts`, which is the single function allowed to
 * emit résumé LaTeX — so preamble drift, invented sections, reordered employers
 * and fabricated degrees are not violations to be linted for, they are things
 * the model has no field to express.
 *
 * Pure: the header and education lines are built from the candidate profile,
 * no DB or LLM here.
 */
import type { ResumeProfileFacts } from './profile';

/**
 * Rewrite typographic dashes as their LaTeX ligatures.
 *
 * The WASM engine is 8-bit pdfTeX and renders a literal U+2014 as "â€”". `---`
 * and `--` produce the same glyphs with no encoding assumptions, so any dash
 * that reaches the document — from this file or from profile fields the owner
 * typed — is normalized first.
 */
export function normalizeDashes(s: string): string {
  return s.replace(/—/g, '---').replace(/–/g, '--');
}

/** Escape the handful of LaTeX specials that turn up in header/contact fields. */
export function latexEscape(s: string): string {
  return normalizeDashes(s).replace(/([\\{}$&#_%~^])/g, (m) =>
    m === '\\'
      ? '\\textbackslash{}'
      : m === '~'
        ? '\\textasciitilde{}'
        : m === '^'
          ? '\\textasciicircum{}'
          : `\\${m}`,
  );
}

/**
 * Reduce a model-supplied string to the words a reader will actually see.
 *
 * Keeps the words inside the common emphasis commands, drops every other command
 * WITH its argument (dropping the command alone leaves the argument as prose, so
 * `\usepackage{xcolor} Built services` would render as the literal words "xcolor
 * Built services"), then collapses whitespace.
 *
 * Lives here, one level below both users, because the renderer escapes this text
 * to emit it while the plan checker measures it against the footprint band — and
 * a second definition of "what the reader sees" would let the band drift away
 * from the document it is supposed to describe.
 */
export function stripPlanMarkup(s: string): string {
  return s
    .replace(/\\(?:textbf|textit|emph|underline|texttt|textsc)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitize a URL for `\href{...}`: strip braces/backslashes/whitespace that would
 * break LaTeX. Query strings (& = ? #) are kept — they're fine inside `\href`.
 */
export function sanitizeUrl(url: string): string {
  return url.trim().replace(/[{}\\\s]/g, '');
}

/** A hyperlinked contact chip, or a plain one when there's no URL. */
function chip(url: string | null, label: string | null): string | null {
  if (!label || !label.trim()) return null;
  const text = latexEscape(label.trim());
  const safeUrl = url ? sanitizeUrl(url) : '';
  if (!safeUrl) return text;
  return `\\href{${safeUrl}}{${text}}`;
}

/** Strip the scheme so the contact line reads "linkedin.com/in/x", not the URL. */
function displayUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * Centered header: name over a single contact line separated by `\textbar\`.
 * Contacts that are missing from the profile are omitted rather than rendered
 * as empty separators.
 */
export function buildHeader(p: ResumeProfileFacts): string {
  const name = latexEscape((p.name ?? 'Your Name').trim().toUpperCase());
  const contacts = [
    chip(p.email ? `mailto:${p.email}` : null, p.email),
    chip(null, p.phone),
    p.linkedinUrl ? chip(p.linkedinUrl, displayUrl(p.linkedinUrl)) : null,
    p.githubUrl ? chip(p.githubUrl, displayUrl(p.githubUrl)) : null,
  ].filter((c): c is string => c !== null);

  return [
    '\\begin{center}',
    `    {\\LARGE \\textbf{${name}}} \\\\`,
    '    \\vspace{2pt}',
    contacts.length > 0 ? `    {\\small ${contacts.join(' \\textbar\\ ')}}` : '    {\\small }',
    '\\end{center}',
  ].join('\n');
}

/**
 * Preamble, verbatim from the owner's résumé. `titlesec` draws the rule under
 * each heading; the hyphenation penalties and `\emergencystretch` keep bullets
 * from breaking words across lines.
 */
export const PREAMBLE = [
  '\\documentclass[11pt]{article}',
  '',
  '\\usepackage[top=0.5in, bottom=0.5in, left=0.6in, right=0.6in]{geometry}',
  '\\usepackage{enumitem}',
  '\\usepackage{titlesec}',
  '\\usepackage[hidelinks]{hyperref}',
  '\\usepackage{sourcesanspro}',
  '\\usepackage{setspace}',
  '\\usepackage{ragged2e}',
  '\\usepackage{microtype}',
  '\\setlength{\\emergencystretch}{2em}',
  '',
  '\\renewcommand{\\familydefault}{\\sfdefault}',
  '\\setlength{\\parindent}{0pt}',
  '\\pagenumbering{gobble}',
  '',
  '\\setstretch{1.15}',
  '',
  '\\titleformat{\\section}',
  '  {\\bfseries\\large}',
  '  {}',
  '  {0pt}',
  '  {}',
  '  [\\vspace{-10pt}\\rule{\\linewidth}{0.5pt}\\vspace{-10pt}]',
  '',
  '\\titlespacing{\\section}{0pt}{6pt}{6pt}',
  '',
  '\\setlist[itemize]{',
  '  leftmargin=*,',
  '  itemsep=2pt,',
  '  topsep=0pt,',
  '  parsep=0pt,',
  '  partopsep=0pt',
  '}',
  '',
  '\\hyphenpenalty=10000',
  '\\exhyphenpenalty=10000',
].join('\n');

/**
 * Fixed employment history. Employers, titles, dates and locations are facts the
 * model must not touch; only the bullets underneath are rewritten per job.
 *
 * Each role carries a stable `id`, and that slug — not an array index, not the
 * employer name — is how a generated plan addresses its bullets. An index
 * invites an off-by-one that silently files Riskcast's bullets under LSEG while
 * the JSON still looks correct; the employer name invites paraphrase ("LSEG",
 * "London Stock Exchange Group") and therefore a fuzzy matcher, which is the
 * same failure with more code. An unrecognised slug is unambiguously an error.
 */
export const RESUME_ROLES = [
  {
    id: 'riskcast',
    title: 'Software Engineer',
    employer: 'Riskcast Solutions',
    location: 'New York, US',
    dates: 'Jul 2025 -- Jan 2026',
    bullets: 4,
  },
  {
    id: 'lseg',
    title: 'Software Engineer',
    employer: 'London Stock Exchange Group (LSEG)',
    location: 'Bangalore, India',
    dates: 'Jan 2022 -- Aug 2024',
    // Four, not five. Measured with `pnpm verify:latex`: ten bullets of the
    // owner's real length fit on one page at up to 220 characters each, and
    // ELEVEN spill onto a second page even at 158. The old budget of five was
    // only ever compile-checked against 58-character placeholders, which fit
    // on one line and hid the problem. This also matches the owner's own
    // résumé, which has four bullets here.
    bullets: 4,
  },
] as const;

export type RoleId = (typeof RESUME_ROLES)[number]['id'];

/** Bullets in the owner's own résumé, per section — the one-page budget. */
export const BULLET_BUDGET = {
  experience: RESUME_ROLES.map((e) => e.bullets),
  projects: 2,
} as const;

/**
 * How many courses the EDUCATION block holds. A property of the layout (one
 * line) rather than of the owner's data, so it lives here and not in the DB.
 */
export const COURSEWORK_SLOTS = { min: 3, max: 4 } as const;

/** Total bullets a one-page résumé in this template holds. */
export const TOTAL_BULLET_BUDGET =
  BULLET_BUDGET.experience.reduce((a, b) => a + b, 0) + BULLET_BUDGET.projects;

/**
 * The six labelled skill rows, in the owner's order — the fallback when nothing
 * has mirrored the posting's own category language yet.
 *
 * PLAIN TEXT, not pre-escaped LaTeX: the renderer escapes every label it is
 * given, so an `&` stored as `\&` here would come out as `\textbackslash{}\&`.
 */
export const SKILL_CATEGORIES = [
  'Languages',
  'Web & Mobile',
  'Distributed & Backend',
  'AI & Information Retrieval',
  'Data & Storage',
  'Cloud, Security & DevOps',
] as const;

/**
 * The EDUCATION block. Degree, institution and certification are fixed facts;
 * the coursework line is the one thing that changes per job, and it may only
 * ever contain courses the profile's pool already lists.
 */
export function buildEducationBlock(
  p: ResumeProfileFacts,
  coursework: readonly string[],
): string[] {
  const grad = latexEscape((p.gradDate ?? 'Dec 2026').trim());
  const courses = coursework.map((c) => latexEscape(c)).join(', ');
  const lines = [
    '\\section*{EDUCATION}',
    '',
    `\\textbf{Master of Science in Computer Software Engineering Systems} \\hfill ${grad} \\\\`,
    'Northeastern University --- Boston, MA\\\\',
    `\\textbf{Coursework:} ${courses}`,
  ];
  if (p.certText?.trim()) {
    const cert = latexEscape(p.certText.trim());
    lines.push(
      `\\\\\n\\textbf{Certification:} ${
        p.certUrl ? `{\\href{${sanitizeUrl(p.certUrl)}}{${cert}}}` : cert
      }`,
    );
  }
  return lines;
}
