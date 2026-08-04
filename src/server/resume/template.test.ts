import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_FACTS } from './profile';
import { buildDefaultTemplate, buildHeader, latexEscape, sanitizeUrl } from './template';

describe('latexEscape', () => {
  it('escapes LaTeX specials', () => {
    expect(latexEscape('A & B_% #C')).toBe('A \\& B\\_\\% \\#C');
    expect(latexEscape('100%')).toBe('100\\%');
  });
});

describe('sanitizeUrl', () => {
  it('strips braces, backslashes, and whitespace but keeps query chars', () => {
    expect(sanitizeUrl(' https://x.io/a?b=1&c=2#z ')).toBe('https://x.io/a?b=1&c=2#z');
    expect(sanitizeUrl('https://x.io/{evil}\\bad')).toBe('https://x.io/evilbad');
  });
});

describe('buildHeader', () => {
  it('hyperlinks email and omits blank contacts', () => {
    const header = buildHeader({
      ...DEFAULT_PROFILE_FACTS,
      name: 'Ada Lovelace',
      email: 'ada@x.io',
      phone: null,
      linkedinUrl: null,
      githubUrl: null,
    });
    expect(header).toContain('Ada Lovelace');
    expect(header).toContain('\\href{mailto:ada@x.io}');
    expect(header).not.toContain('LinkedIn');
  });
});

describe('buildDefaultTemplate', () => {
  it('produces a compilable one-page skeleton with the required packages', () => {
    const tex = buildDefaultTemplate(DEFAULT_PROFILE_FACTS);
    expect(tex).toContain('\\documentclass[11pt]{article}');
    expect(tex).toContain('sourcesanspro');
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\end{document}');
    expect(tex).toContain('Nireeksha Huns');
    expect(tex).toContain('Experience');
  });

  it('escapes a name containing LaTeX specials', () => {
    const tex = buildDefaultTemplate({ ...DEFAULT_PROFILE_FACTS, name: 'A & B' });
    expect(tex).toContain('A \\& B');
  });
});
