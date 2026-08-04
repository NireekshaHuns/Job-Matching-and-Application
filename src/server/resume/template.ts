/**
 * Default one-page LaTeX résumé skeleton (11pt, sourcesanspro / pdfLaTeX, sans
 * default, tight margins, no page numbers). The corpus tailoring engine hands
 * this to the model as the format to fill — so generation works even before the
 * owner authors a base résumé. Header is built from the candidate profile; the
 * body sections carry placeholder content the model replaces per JD. Pure.
 */
import type { ResumeProfileFacts } from './profile';

/** Escape the handful of LaTeX specials that turn up in header/contact fields. */
export function latexEscape(s: string): string {
  return s.replace(/([\\{}$&#_%~^])/g, (m) =>
    m === '\\' ? '\\textbackslash{}' : m === '~' ? '\\textasciitilde{}' : m === '^' ? '\\textasciicircum{}' : `\\${m}`,
  );
}

/** A hyperlinked contact chip, or a plain one when there's no URL. */
function chip(url: string | null, label: string | null): string | null {
  if (!label || !label.trim()) return null;
  const text = latexEscape(label.trim());
  if (!url || !url.trim()) return text;
  // URLs go into \href verbatim (no escaping) so query strings survive.
  return `\\href{${url.trim()}}{${text}}`;
}

/** Build the centered header (name + contact line) from the profile. */
export function buildHeader(p: ResumeProfileFacts): string {
  const name = latexEscape((p.name ?? 'Your Name').trim());
  const contacts = [
    chip(p.email ? `mailto:${p.email}` : null, p.email),
    chip(null, p.phone),
    chip(p.linkedinUrl, 'LinkedIn'),
    chip(p.githubUrl, 'GitHub'),
  ]
    .filter((c): c is string => c !== null)
    .join(' \\;|\\; ');

  return [
    '\\begin{center}',
    `  {\\LARGE \\textbf{${name}}}\\\\[3pt]`,
    contacts ? `  {\\small ${contacts}}` : '  {\\small }',
    '\\end{center}',
  ].join('\n');
}

const PREAMBLE = [
  '\\documentclass[11pt]{article}',
  '\\usepackage[T1]{fontenc}',
  '\\usepackage[default]{sourcesanspro}',
  '\\renewcommand{\\familydefault}{\\sfdefault}',
  '\\usepackage[top=0.5in,bottom=0.5in,left=0.6in,right=0.6in]{geometry}',
  '\\usepackage{setspace}',
  '\\usepackage{enumitem}',
  '\\usepackage[hidelinks]{hyperref}',
  '\\setstretch{1.15}',
  '\\pagenumbering{gobble}',
  '\\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=2pt,parsep=0pt}',
  // Bold section title with a rule under it — the required "header + hrule" look.
  '\\newcommand{\\resumesection}[1]{\\vspace{5pt}\\noindent{\\large\\textbf{#1}}\\vspace{1pt}\\hrule\\vspace{4pt}}',
].join('\n');

/**
 * Full, compilable default template. The EXPERIENCE / PROJECTS / SKILLS bodies
 * are placeholders the tailoring model rewrites for the target JD; the two real
 * employers + dates + the education line are kept as fixed anchors.
 */
export function buildDefaultTemplate(p: ResumeProfileFacts): string {
  const grad = latexEscape((p.gradDate ?? 'December 2026').trim());
  const cert = p.certText
    ? `\\resumesection{Certifications}\n${
        p.certUrl
          ? `\\href{${p.certUrl.trim()}}{${latexEscape(p.certText.trim())}}`
          : latexEscape(p.certText.trim())
      }`
    : '';

  return [
    PREAMBLE,
    '\\begin{document}',
    buildHeader(p),
    '',
    '\\resumesection{Experience}',
    '\\textbf{Software Engineer}, \\textit{Riskcast Solutions} — New York \\hfill Jul 2025 -- Jan 2026',
    '\\begin{itemize}',
    '  \\item Placeholder accomplishment bullet tailored to the target job',
    '  \\item Placeholder accomplishment bullet tailored to the target job',
    '\\end{itemize}',
    '\\textbf{Software Engineer}, \\textit{London Stock Exchange Group} — Bangalore \\hfill Jan 2022 -- Aug 2024',
    '\\begin{itemize}',
    '  \\item Placeholder accomplishment bullet tailored to the target job',
    '  \\item Placeholder accomplishment bullet tailored to the target job',
    '\\end{itemize}',
    '',
    '\\resumesection{Projects}',
    '\\begin{itemize}',
    '  \\item Placeholder project bullet tailored to the target job',
    '\\end{itemize}',
    '',
    '\\resumesection{Technical Skills}',
    'Languages, frameworks, and tools relevant to the target job',
    '',
    ...(cert ? [cert, ''] : []),
    '\\resumesection{Education}',
    `Northeastern University — MS, Computer Software Engineering Systems \\hfill ${grad}`,
    '\\end{document}',
    '',
  ].join('\n');
}
