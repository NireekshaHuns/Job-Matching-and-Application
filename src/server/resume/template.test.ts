import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_FACTS } from './profile';
import {
  BULLET_BUDGET,
  SKILL_CATEGORIES,
  TOTAL_BULLET_BUDGET,
  buildDefaultTemplate,
  buildHeader,
  latexEscape,
  normalizeDashes,
  sanitizeUrl,
} from './template';

describe('latexEscape', () => {
  it('escapes LaTeX specials', () => {
    expect(latexEscape('A & B_% #C')).toBe('A \\& B\\_\\% \\#C');
    expect(latexEscape('100%')).toBe('100\\%');
  });
});

describe('normalizeDashes', () => {
  it('converts typographic dashes to LaTeX ligatures', () => {
    // The 8-bit WASM pdfTeX renders a literal U+2014 as "â€”".
    expect(normalizeDashes('Boston — MA')).toBe('Boston --- MA');
    expect(normalizeDashes('2026–2029')).toBe('2026--2029');
    expect(normalizeDashes('plain - hyphen')).toBe('plain - hyphen');
  });

  it('is applied to any escaped text, so profile fields are covered too', () => {
    expect(latexEscape('AWS Architect – Associate')).toBe('AWS Architect -- Associate');
  });
});

describe('sanitizeUrl', () => {
  it('strips braces, backslashes, and whitespace but keeps query chars', () => {
    expect(sanitizeUrl(' https://x.io/a?b=1&c=2#z ')).toBe('https://x.io/a?b=1&c=2#z');
    expect(sanitizeUrl('https://x.io/{evil}\\bad')).toBe('https://x.io/evilbad');
  });
});

describe('buildHeader', () => {
  it('uppercases the name and hyperlinks the email, omitting blank contacts', () => {
    const header = buildHeader({
      ...DEFAULT_PROFILE_FACTS,
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      phone: null,
      linkedinUrl: null,
      githubUrl: null,
    });
    expect(header).toContain('ADA LOVELACE');
    expect(header).toContain('\\href{mailto:ada@x.io}');
    expect(header).not.toContain('linkedin');
    // A single contact means no separator at all.
    expect(header).not.toContain('\\textbar');
  });

  it('separates contacts with \\textbar and shows links without their scheme', () => {
    const header = buildHeader({
      ...DEFAULT_PROFILE_FACTS,
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      phone: '(510)-392-7822',
      linkedinUrl: 'https://www.linkedin.com/in/ada/',
      githubUrl: 'https://github.com/ada',
    });
    expect(header).toContain('(510)-392-7822');
    // Displayed without scheme or trailing slash, but still linked to the full URL.
    expect(header).toContain('\\href{https://www.linkedin.com/in/ada/}{www.linkedin.com/in/ada}');
    expect(header).toContain('\\href{https://github.com/ada}{github.com/ada}');
    expect(header.match(/\\textbar/g)).toHaveLength(3);
  });

  it('escapes a name containing LaTeX specials', () => {
    expect(buildHeader({ ...DEFAULT_PROFILE_FACTS, name: 'A & B' })).toContain('A \\& B');
  });
});

describe('buildDefaultTemplate', () => {
  const tex = buildDefaultTemplate(DEFAULT_PROFILE_FACTS);

  it('uses the owner’s preamble', () => {
    expect(tex).toContain('\\documentclass[11pt]{article}');
    for (const pkg of [
      'sourcesanspro',
      'titlesec',
      'ragged2e',
      'microtype',
      'enumitem',
      'setspace',
    ]) {
      expect(tex).toContain(`{${pkg}}`);
    }
    expect(tex).toContain('\\hyphenpenalty=10000');
    expect(tex).toContain('\\pagenumbering{gobble}');
    // The rule under each heading comes from titlesec, not a custom macro.
    expect(tex).toContain('\\rule{\\linewidth}{0.5pt}');
    expect(tex).not.toContain('\\resumesection');
  });

  it('keeps the section order EDUCATION → EXPERIENCE → PROJECTS → TECHNICAL SKILLS', () => {
    const order = [...tex.matchAll(/\\section\*\{([A-Z ]+)\}/g)].map((m) => m[1]);
    expect(order).toEqual(['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'TECHNICAL SKILLS']);
  });

  it('anchors the education, employers and dates', () => {
    expect(tex).toContain('Master of Science in Computer Software Engineering Systems');
    expect(tex).toContain('Northeastern University');
    expect(tex).toContain('\\textbf{Coursework:}');
    expect(tex).toContain('Riskcast Solutions');
    expect(tex).toContain('Jul 2025 -- Jan 2026');
    expect(tex).toContain('London Stock Exchange Group (LSEG)');
    expect(tex).toContain('Jan 2022 -- Aug 2024');
  });

  it('lays out the six labelled skill rows without a trailing line break', () => {
    for (const label of SKILL_CATEGORIES) expect(tex).toContain(`\\textbf{${label}:}`);
    // A `\\` on the final row would make LaTeX fail with "There's no line here
    // to end" at \end{document}.
    expect(tex).not.toMatch(/\\\\\s*\n\s*\n?\\end\{document\}/);
  });

  it('ships exactly the one-page bullet budget', () => {
    const bullets = tex.match(/\\item /g) ?? [];
    expect(TOTAL_BULLET_BUDGET).toBe(11);
    expect(bullets).toHaveLength(TOTAL_BULLET_BUDGET);
    expect(BULLET_BUDGET.experience).toEqual([4, 5]);
    expect(BULLET_BUDGET.projects).toBe(2);
  });

  it('includes the certification only when the profile has one', () => {
    expect(buildDefaultTemplate(DEFAULT_PROFILE_FACTS)).toContain('\\textbf{Certification:}');
    expect(buildDefaultTemplate({ ...DEFAULT_PROFILE_FACTS, certText: null })).not.toContain(
      '\\textbf{Certification:}',
    );
  });

  it('escapes a name containing LaTeX specials', () => {
    expect(buildDefaultTemplate({ ...DEFAULT_PROFILE_FACTS, name: 'A & B' })).toContain('A \\& B');
  });
});
