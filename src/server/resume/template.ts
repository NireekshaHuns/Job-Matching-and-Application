/**
 * The owner's own one-page LaTeX résumé, as the format every generation must
 * follow: 11pt article, sourcesanspro, `titlesec` section headings with a rule
 * under them, tight margins, no page numbers, and the section order
 * EDUCATION → EXPERIENCE → PROJECTS → TECHNICAL SKILLS.
 *
 * The tailoring model is handed this document and rewrites only the bullet
 * bodies, the project line and the skills values. Everything else — preamble,
 * header, employers, titles, dates, degree — is a fixed anchor.
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
const PREAMBLE = [
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
 */
const EXPERIENCE = [
  {
    title: 'Software Engineer',
    employer: 'Riskcast Solutions',
    location: 'New York, US',
    dates: 'Jul 2025 -- Jan 2026',
    bullets: 4,
  },
  {
    title: 'Software Engineer',
    employer: 'London Stock Exchange Group (LSEG)',
    location: 'Bangalore, India',
    dates: 'Jan 2022 -- Aug 2024',
    bullets: 5,
  },
] as const;

/** Bullets in the owner's own résumé, per section — the one-page budget. */
export const BULLET_BUDGET = {
  experience: EXPERIENCE.map((e) => e.bullets),
  projects: 2,
} as const;

/** Total bullets a one-page résumé in this template holds. */
export const TOTAL_BULLET_BUDGET =
  BULLET_BUDGET.experience.reduce((a, b) => a + b, 0) + BULLET_BUDGET.projects;

/** The six labelled skill rows, in the owner's order. */
export const SKILL_CATEGORIES = [
  'Languages',
  'Web \\& Mobile',
  'Distributed \\& Backend',
  'AI \\& Information Retrieval',
  'Data \\& Storage',
  'Cloud, Security \\& DevOps',
] as const;

function placeholderItems(count: number): string[] {
  return Array.from(
    { length: count },
    () => '    \\item Placeholder accomplishment bullet tailored to the target job',
  );
}

function experienceBlock(): string[] {
  const out: string[] = [];
  for (const [i, role] of EXPERIENCE.entries()) {
    out.push(
      `\\textbf{${role.title}} \\hfill ${role.dates} \\\\`,
      `\\textit{${role.employer}} --- ${role.location}`,
      '\\begin{itemize}',
      ...placeholderItems(role.bullets),
      '\\end{itemize}',
    );
    if (i < EXPERIENCE.length - 1) out.push('', '\\vspace{2pt}', '');
  }
  return out;
}

function educationBlock(p: ResumeProfileFacts): string[] {
  const grad = latexEscape((p.gradDate ?? 'Dec 2026').trim());
  const lines = [
    '\\section*{EDUCATION}',
    '',
    `\\textbf{Master of Science in Computer Software Engineering Systems} \\hfill ${grad} \\\\`,
    'Northeastern University --- Boston, MA\\\\',
    '\\textbf{Coursework:} Data Structures \\& Algorithms, Web Development and Design, Distributed Systems, Database Design',
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

/**
 * The full, compilable template. EXPERIENCE / PROJECTS / TECHNICAL SKILLS bodies
 * carry placeholders the tailoring model replaces per JD; the header, employers,
 * dates and education are anchors it must preserve verbatim.
 */
export function buildDefaultTemplate(p: ResumeProfileFacts): string {
  const projectUrl = p.githubUrl ? sanitizeUrl(p.githubUrl) : '';
  const projectTitle = projectUrl
    ? `\\textbf{\\href{${projectUrl}}{Project Name}}`
    : '\\textbf{Project Name}';

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
    ...educationBlock(p),
    '',
    '\\vspace{2pt}',
    '',
    '\\section*{EXPERIENCE}',
    '',
    ...experienceBlock(),
    '',
    '\\section*{PROJECTS}',
    '',
    `${projectTitle} \\textbar\\ `,
    '\\textit{Tech stack relevant to the target job}',
    '\\begin{itemize}',
    ...placeholderItems(BULLET_BUDGET.projects),
    '\\end{itemize}',
    '',
    '\\vspace{2pt}',
    '',
    '\\section*{TECHNICAL SKILLS}',
    // `\\` separates the rows; the LAST row must not have one, or LaTeX raises
    // "There's no line here to end" against \end{document}.
    ...SKILL_CATEGORIES.map(
      (label, i) =>
        `\\textbf{${label}:} Relevant items for the target job${
          i < SKILL_CATEGORIES.length - 1 ? '\\\\' : ''
        }`,
    ),
    '',
    '\\end{document}',
    '',
  ].join('\n');
}
