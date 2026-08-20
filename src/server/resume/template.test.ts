import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_FACTS } from './profile';
import {
  buildEducationBlock,
  buildHeader,
  latexEscape,
  normalizeDashes,
  RESUME_ROLES,
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

describe('RESUME_ROLES', () => {
  it('gives every role a stable slug', () => {
    // The slug is how a generated plan addresses its bullets. Renaming one
    // silently reassigns bullets to the wrong employer, so it is pinned here.
    expect(RESUME_ROLES.map((r) => r.id)).toEqual(['riskcast', 'lseg']);
    expect(new Set(RESUME_ROLES.map((r) => r.id)).size).toBe(RESUME_ROLES.length);
  });

  it('keeps the employers, dates and per-role bullet budgets fixed', () => {
    expect(RESUME_ROLES.map((r) => [r.employer, r.dates, r.bullets])).toEqual([
      ['Riskcast Solutions', 'Jul 2025 -- Jan 2026', 4],
      ['London Stock Exchange Group (LSEG)', 'Jan 2022 -- Aug 2024', 5],
    ]);
  });
});

describe('buildEducationBlock', () => {
  it('renders only the coursework it is handed, escaped', () => {
    const block = buildEducationBlock(DEFAULT_PROFILE_FACTS, [
      'Distributed Systems',
      'Data Structures & Algorithms',
    ]).join('\n');
    expect(block).toContain(
      '\\textbf{Coursework:} Distributed Systems, Data Structures \\& Algorithms',
    );
    // The degree and institution are not parameterized at all.
    expect(block).toContain('Master of Science in Computer Software Engineering Systems');
    expect(block).toContain('Northeastern University');
  });

  it('keeps the coursework line present but empty when nothing is selected', () => {
    const block = buildEducationBlock(DEFAULT_PROFILE_FACTS, []).join('\n');
    expect(block).toContain('\\textbf{Coursework:}');
  });
});
