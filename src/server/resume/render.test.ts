import { describe, expect, it } from 'vitest';
import type { ResumePlan } from './plan';
import { DEFAULT_PROFILE_FACTS } from './profile';
import { extractSections } from './quality';
import {
  buildDefaultTemplate,
  placeholderPlan,
  renderResumePlan,
  sanitizePlanText,
} from './render';
import {
  BULLET_BUDGET,
  latexEscape,
  RESUME_ROLES,
  SKILL_CATEGORIES,
  TOTAL_BULLET_BUDGET,
} from './template';

const profile = DEFAULT_PROFILE_FACTS;

function plan(over: Partial<ResumePlan> = {}): ResumePlan {
  return {
    coursework: ['Distributed Systems', 'Operating Systems', 'Cloud Computing'],
    roles: RESUME_ROLES.map((r) => ({
      roleId: r.id,
      bullets: Array.from({ length: r.bullets }, (_, i) => `Built ${r.id} thing number ${i + 1}`),
    })),
    project: {
      stack: 'Next.js, tRPC, PostgreSQL',
      bullets: ['Launched a multi-user platform', 'Automated ingestion from four feeds'],
    },
    skills: [
      { label: 'Languages', items: ['Java', 'Python'] },
      { label: 'CS Fundamentals', items: ['Distributed Systems', 'System Design'] },
    ],
    placements: [],
    ...over,
  };
}

const sectionTitles = (tex: string) => extractSections(tex).sections.map((s) => s.title);

describe('the fixed skeleton is not reachable from a plan', () => {
  // This is the bug report, encoded. A generation really did come back with a
  // fontawesome/tabularx preamble, a fabricated bachelor's degree, an invented
  // Certifications section and the employers in the wrong order. None of it can
  // be expressed now — these assertions prove there is no field for it.
  const hostile = plan({
    coursework: ['\\section{Certifications} Rocket Science'],
    roles: [
      { roleId: 'lseg', bullets: ['\\usepackage{fontawesome5} Engineered event-driven systems'] },
      {
        roleId: 'riskcast',
        bullets: ['\\newcommand{\\role}[4]{} Delivered backend services'],
      },
    ],
    project: {
      stack: '\\documentclass[11pt,letterpaper]{article}',
      bullets: [
        'Bachelor of Science in Computer Science',
        '\\section{Certifications} AWS Certified',
      ],
    },
    skills: [
      { label: '}\\usepackage{xcolor}{', items: ['\\hypersetup{colorlinks=true}'] },
      { label: 'Languages', items: ['Java'] },
    ],
  });
  const tex = renderResumePlan(profile, hostile);

  it('emits exactly the four sections, in order', () => {
    expect(sectionTitles(tex)).toEqual(['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'TECHNICAL SKILLS']);
  });

  it('emits only the owner’s preamble', () => {
    expect(tex).toContain('\\documentclass[11pt]{article}');
    expect(tex).toContain('\\usepackage{sourcesanspro}');
    const preamble = tex.slice(0, tex.indexOf('\\begin{document}'));
    for (const forbidden of [
      'fontawesome5',
      'tabularx',
      'xcolor',
      'colorlinks',
      '\\newcommand',
      'margin=0.5in',
      'letterpaper',
    ]) {
      expect(preamble).not.toContain(forbidden);
      // And nothing in the body can smuggle one back in as a command.
      expect(tex).not.toContain(`\\usepackage{${forbidden}}`);
    }
    // Exactly one documentclass, and it is ours.
    expect(tex.match(/\\documentclass/g)).toHaveLength(1);
    expect(tex.match(/\\begin\{document\}/g)).toHaveLength(1);
  });

  it('keeps the real degree, whatever a bullet claims', () => {
    const education = extractSections(tex).sections[0];
    expect(education.body).toContain('Master of Science in Computer Software Engineering Systems');
    // The hostile plan puts "Bachelor of Science in Computer Science" in a
    // project bullet. It may appear there as prose — the degree LINE is the
    // fixed fact, and nothing in a plan can reach it.
    expect(education.body).not.toContain('Bachelor of Science');
  });

  it('renders the employers in skeleton order however the plan is ordered', () => {
    // The plan puts LSEG first. The document must not.
    expect(tex.indexOf('Riskcast Solutions')).toBeLessThan(
      tex.indexOf('London Stock Exchange Group'),
    );
  });

  it('lets no plan string introduce a command', () => {
    const body = tex.slice(tex.indexOf('\\begin{document}'));
    expect(body).not.toContain('\\usepackage');
    expect(body).not.toContain('\\hypersetup');
    expect(body).not.toContain('\\section{Certifications}');
  });
});

describe('sanitizePlanText', () => {
  it('keeps the words inside emphasis commands and drops the command', () => {
    expect(sanitizePlanText('Shipped \\textbf{Kafka} pipelines')).toBe('Shipped Kafka pipelines');
    expect(sanitizePlanText('\\textit{Scaled} throughput')).toBe('Scaled throughput');
  });

  it('escapes LaTeX specials rather than emitting them', () => {
    expect(sanitizePlanText('Cut cost 40% for R&D')).toBe('Cut cost 40\\% for R\\&D');
    expect(sanitizePlanText('a_b #c $d')).toBe('a\\_b \\#c \\$d');
  });

  it('normalizes em dashes the 8-bit engine would mangle', () => {
    expect(sanitizePlanText('Owned features — end to end')).toBe('Owned features --- end to end');
  });

  it('strips an unknown command entirely instead of escaping it into garbage', () => {
    // `latexEscape` alone would produce "\textbackslash{}usepackage\{xcolor\}",
    // which is visible junk in the PDF rather than a silently ignored command.
    expect(sanitizePlanText('\\usepackage{xcolor} Built services')).toBe('Built services');
  });
});

describe('renderResumePlan', () => {
  it('truncates a role to its budget and never emits an empty itemize', () => {
    const tex = renderResumePlan(
      profile,
      plan({
        roles: [
          { roleId: 'riskcast', bullets: Array.from({ length: 9 }, (_, i) => `Bullet ${i}`) },
          { roleId: 'lseg', bullets: [] },
        ],
      }),
    );
    // \begin{itemize}\end{itemize} is a LaTeX error, not an empty list.
    expect(tex).not.toMatch(/\\begin\{itemize\}\s*\\end\{itemize\}/);
    const riskcastBlock = tex.slice(tex.indexOf('Riskcast'), tex.indexOf('London Stock'));
    expect(riskcastBlock.match(/\\item /g)).toHaveLength(4);
  });

  it('never puts a line break on the final skills row', () => {
    const tex = renderResumePlan(profile, plan());
    // A `\\` on the last row makes LaTeX fail with "There's no line here to end".
    expect(tex).not.toMatch(/\\\\\s*\n\s*\n?\\end\{document\}/);
    expect(tex).toContain('\\textbf{CS Fundamentals:} Distributed Systems, System Design');
  });

  it('escapes skills labels and items', () => {
    const tex = renderResumePlan(
      profile,
      plan({ skills: [{ label: 'Networking & Linux', items: ['TCP/IP', 'C#'] }] }),
    );
    expect(tex).toContain('\\textbf{Networking \\& Linux:} TCP/IP, C\\#');
  });

  it('renders the project name and link from the profile', () => {
    const tex = renderResumePlan(profile, plan());
    expect(tex).toContain('Job Matching \\& Application Platform');
    expect(tex).toContain('\\href{https://github.com/NireekshaHuns/Job-Matching-and-Application}');
    // The old hardcoded placeholder is gone.
    expect(tex).not.toContain('{Project Name}');
  });

  it('renders only the coursework the plan selected', () => {
    const tex = renderResumePlan(profile, plan({ coursework: ['Cloud Computing'] }));
    expect(tex).toContain('\\textbf{Coursework:} Cloud Computing');
    expect(tex).not.toContain('Operating Systems');
  });

  it('omits the skills section entirely when every row was dropped', () => {
    const tex = renderResumePlan(profile, plan({ skills: [] }));
    expect(sectionTitles(tex)).toEqual(['EDUCATION', 'EXPERIENCE', 'PROJECTS']);
  });
});

describe('buildDefaultTemplate', () => {
  const tex = buildDefaultTemplate(profile);

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
    expect(sectionTitles(tex)).toEqual(['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'TECHNICAL SKILLS']);
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
    // SKILL_CATEGORIES is plain text now; the renderer is what escapes it.
    for (const label of SKILL_CATEGORIES) {
      expect(tex).toContain(`\\textbf{${latexEscape(label)}:}`);
    }
    expect(tex).not.toMatch(/\\\\\s*\n\s*\n?\\end\{document\}/);
  });

  it('ships exactly the one-page bullet budget', () => {
    const bullets = tex.match(/\\item /g) ?? [];
    // Ten, verified by `pnpm verify:latex`: eleven two-line bullets run to a
    // second page whatever their length.
    expect(TOTAL_BULLET_BUDGET).toBe(10);
    expect(bullets).toHaveLength(TOTAL_BULLET_BUDGET);
    expect(BULLET_BUDGET.experience).toEqual([4, 4]);
    expect(BULLET_BUDGET.projects).toBe(2);
  });

  it('includes the certification only when the profile has one', () => {
    expect(tex).toContain('\\textbf{Certification:}');
    expect(buildDefaultTemplate({ ...profile, certText: null })).not.toContain(
      '\\textbf{Certification:}',
    );
  });

  it('escapes a name containing LaTeX specials', () => {
    expect(buildDefaultTemplate({ ...profile, name: 'A & B' })).toContain('A \\& B');
  });

  it('fills the skills rows from the corpus when it has anything in it', () => {
    const withSkills = buildDefaultTemplate(profile, ['java', 'kafka', 'react']);
    expect(withSkills).toContain('java');
    expect(withSkills).not.toContain('Relevant items for the target job');
  });
});

describe('placeholderPlan', () => {
  it('takes coursework from the pool, in pool order', () => {
    const p = placeholderPlan(profile);
    expect(p.coursework).toEqual(profile.coursework.slice(0, 4));
  });

  it('fills every role to its budget', () => {
    const p = placeholderPlan(profile);
    expect(p.roles.map((r) => [r.roleId, r.bullets.length])).toEqual([
      ['riskcast', 4],
      ['lseg', 4],
    ]);
  });
});
