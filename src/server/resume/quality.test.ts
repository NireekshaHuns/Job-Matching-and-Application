import { describe, expect, it } from 'vitest';
import { extractSections, lintResume } from './quality';
import { MAX_BULLETS, WORD_MAX, WORD_MIN } from './rubric';

/** A minimal one-page-style LaTeX résumé with the user's fixed section set. */
const BASE_RESUME = String.raw`\begin{document}
\begin{center}\textbf{JANE DOE} | jane@example.com | New York, NY\end{center}
\section*{EDUCATION}
\textbf{MS Computer Science} \hfill Aug 2026
\section*{EXPERIENCE}
\textbf{Software Engineer}
\begin{itemize}
\item Shipped a payments API that cut p99 latency by 40\% for active users.
\end{itemize}
\section*{PROJECTS}
\textbf{Job Board} | Next.js, tRPC
\begin{itemize}
\item Built a Kanban tracker that ranked postings for 1,000 users.
\end{itemize}
\section*{TECHNICAL SKILLS}
Java, Python, TypeScript
\end{document}`;

/** Tailor only the editable regions (an EXPERIENCE bullet + the SKILLS list). */
const TAILORED_OK = BASE_RESUME.replace(
  'Java, Python, TypeScript',
  'Go, Kafka, PostgreSQL',
).replace('cut p99 latency by 40\\% for active users', 'boosted throughput by 3x for active users');

/**
 * Distinct, realistic bullets with varied strong verbs (incl. ones NOT in the
 * allowlist, e.g. Spearheaded/Refactored/Owned), each with a metric + period.
 *
 * Deliberately full-length, the way real résumé bullets read. An earlier version
 * of this fixture used 44 one-line bullets to reach the word target, which no
 * longer represents anything that fits on a page — bullet count, not word count,
 * is what pushes a résumé onto page two.
 */
const GOOD_BULLETS = [
  '- Shipped a payments API used across three product lines, cutting p99 latency by 40% for active users while holding error budgets steady through a staged rollout.',
  '- Led a data migration off a legacy warehouse, reducing infrastructure cost by 30% across teams and shortening the nightly batch window from six hours to under two.',
  '- Spearheaded a service rewrite that improved request throughput by 3x for the platform, replacing synchronous calls with an event-driven queue and backpressure handling.',
  '- Refactored the auth service into stateless workers, cutting error rates by 25% within two weeks and removing the shared session store that caused weekly incidents.',
  '- Automated deployments with a templated pipeline, improving release frequency by 50% for platform teams and eliminating the manual approval step for routine changes.',
  '- Migrated 40 services to Kubernetes with health checks and autoscaling, reducing production incidents by 60% overall and halving mean time to recovery.',
  '- Designed a read-through caching layer for the catalogue, boosting cache hit rate to 95% in production and cutting database read load by roughly two thirds.',
  '- Owned the billing pipeline end to end, improving invoice accuracy by 20% for customers by reconciling usage events against a ledger before each monthly close.',
  '- Instrumented the checkout flow with distributed tracing, surfacing a serialization bug that had inflated tail latency by 300 ms on 15% of requests.',
  '- Rebuilt the search index with incremental updates, dropping content freshness lag from 45 minutes to under 90 seconds for 2 million documents.',
  '- Hardened the public API with per-tenant rate limiting and schema validation, blocking 100,000 malformed requests a day without a single false positive.',
  '- Mentored three engineers through their first on-call rotations, cutting escalations to senior staff by 45% over two quarters with runbooks and paired debugging.',
];

/**
 * The non-bullet text every résumé carries — header, education, role headings,
 * project line and the skills rows. Roughly 150 words, which is what separates
 * the bullet text from the real document total.
 */
const SCAFFOLD = [
  'JANE DOE | jane@example.com | (555) 010-1234 | linkedin.com/in/janedoe | github.com/janedoe',
  'EDUCATION',
  'Master of Science in Computer Software Engineering Systems, December 2026',
  'Northeastern University, Boston, MA',
  'Coursework: Data Structures and Algorithms, Web Development and Design, Distributed Systems, Database Design',
  'Certification: AWS Certified Solutions Architect, valid 2026 to 2029',
  'EXPERIENCE',
  'Software Engineer, Riskcast Solutions, New York, July 2025 to January 2026',
  'Software Engineer, London Stock Exchange Group, Bangalore, January 2022 to August 2024',
  'PROJECTS',
  'Job Matching and Application Platform: Next.js, TypeScript, tRPC, PostgreSQL, Inngest',
  'TECHNICAL SKILLS',
  'Languages: Python, Java, TypeScript, JavaScript, SQL',
  'Web and Mobile: React, Next.js, React Native, Node.js, REST APIs, GraphQL, accessible interfaces',
  'Distributed and Backend: microservices, Kafka, event-driven and parallel systems, multithreading, system design',
  'AI and Information Retrieval: language models, LangChain, retrieval augmented generation, embeddings, vector search',
  'Data and Storage: PostgreSQL, Redis, OpenSearch, MongoDB, message queues',
  'Cloud, Security and DevOps: AWS, Linux, Docker, Kubernetes, Terraform, continuous delivery, Grafana',
].join('\n');

/**
 * A whole résumé of `n` full-length bullets plus the usual scaffolding. The
 * default is the one-page bullet budget itself, so the fixture stays a passing
 * résumé as the measured budget moves — it was pinned at 12 and started failing
 * the moment the budget was recalibrated down to what actually fits.
 */
function goodResume(n = MAX_BULLETS): string {
  const lines: string[] = [SCAFFOLD];
  for (let i = 0; i < n; i++) lines.push(GOOD_BULLETS[i % GOOD_BULLETS.length]);
  return lines.join('\n');
}

describe('lintResume', () => {
  it('passes a well-formed resume with varied (incl. unlisted) strong verbs', () => {
    const report = lintResume(goodResume());
    expect(report.ok).toBe(true);
    expect(report.wordCount).toBeGreaterThanOrEqual(WORD_MIN);
    expect(report.wordCount).toBeLessThanOrEqual(WORD_MAX);
    expect(report.bulletCount).toBe(MAX_BULLETS);
  });

  it('flags a resume with too many bullets to fit one page', () => {
    // Inside the word band but well over the bullet budget — the exact shape
    // that used to slip through and render as two pages.
    const report = lintResume(goodResume(MAX_BULLETS + 4));
    expect(report.violations.some((v) => v.rule === 'bullet-count')).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('accepts a resume at exactly the bullet ceiling', () => {
    const report = lintResume(goodResume(MAX_BULLETS));
    expect(report.violations.some((v) => v.rule === 'bullet-count')).toBe(false);
  });

  it('flags a resume that is too short', () => {
    const report = lintResume('- Shipped an API that cut latency by 40% for users.');
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.rule === 'word-count')).toBe(true);
  });

  it('flags bystander verbs as errors (single word and phrase)', () => {
    const helped = lintResume(
      goodResume() + '\n- Helped with the backend and assisted the team daily.',
    );
    expect(helped.violations.some((v) => v.rule === 'weak-verb')).toBe(true);
    expect(helped.ok).toBe(false);

    const workedOn = lintResume('- Worked on the backend service for the platform team.');
    expect(workedOn.violations.some((v) => v.rule === 'weak-verb')).toBe(true);
  });

  it('does not flag an unlisted-but-strong verb as weak', () => {
    const report = lintResume('- Spearheaded a rewrite that cut latency by 40% for active users.');
    expect(report.violations.some((v) => v.rule === 'weak-verb')).toBe(false);
  });

  it('does not count a bare year as a metric', () => {
    const report = lintResume(
      [
        '- Graduated in 2024 from a university program.',
        '- Founded a club in 2021 with peers.',
      ].join('\n'),
    );
    // No real metrics -> metrics warn fires (years did not count).
    expect(report.violations.some((v) => v.rule === 'metrics')).toBe(true);
  });

  it('warns when few bullets have metrics (homework-style bullets)', () => {
    const homework = [
      '- Built a to-do app using React and a REST API.',
      '- Created a calculator that adds and subtracts numbers.',
      '- Implemented a login page with a username and password.',
    ].join('\n');
    const report = lintResume(homework);
    expect(report.violations.some((v) => v.rule === 'metrics')).toBe(true);
  });

  it('flags inconsistent bullet punctuation', () => {
    const mixed = [
      '- Shipped a payments API that cut p99 latency by 40% for users.',
      '- Led a migration that reduced infra cost by 30% across services',
    ].join('\n');
    const report = lintResume(mixed);
    expect(report.violations.some((v) => v.rule === 'punctuation')).toBe(true);
  });

  it('warns on buzzwords', () => {
    const report = lintResume(
      goodResume() + '\n- Shipped features as a hardworking team player with synergy.',
    );
    expect(report.violations.some((v) => v.rule === 'buzzword')).toBe(true);
  });

  it('reports JD keyword coverage and missing keywords', () => {
    const text = '- Shipped a Go service using Kafka that cut latency by 40% today.';
    const report = lintResume(text, {
      jdKeywords: ['go', 'kafka', 'terraform'],
      minKeywordCoverage: 0.8,
    });
    expect(report.keywordCoverage?.matched).toEqual(['go', 'kafka']);
    expect(report.keywordCoverage?.missing).toEqual(['terraform']);
    expect(report.violations.some((v) => v.rule === 'keyword-coverage')).toBe(true);
  });

  it('handles LaTeX \\item bullets and still detects the metric', () => {
    const report = lintResume(
      '\\item Shipped a \\textbf{payments} API that cut p99 latency by 40\\% for users.',
    );
    expect(report.bulletCount).toBe(1);
    // 40% survived the LaTeX stripping, so no metrics warning.
    expect(report.violations.some((v) => v.rule === 'metrics')).toBe(false);
  });

  it('does not flag "dynamic" (a technical adjective) as a buzzword', () => {
    const report = lintResume('- Built a dynamic form renderer that cut load time by 30%.');
    expect(report.violations.some((v) => v.rule === 'buzzword')).toBe(false);
  });

  it('detects bullets written with a custom LaTeX item macro', () => {
    // Jake Gutierrez template style — must still catch a bystander verb.
    const report = lintResume('\\resumeItem{Helped with the backend for the team.}');
    expect(report.bulletCount).toBe(1);
    expect(report.violations.some((v) => v.rule === 'weak-verb')).toBe(true);
  });

  it('warns when substantial text has no detectable bullets', () => {
    const prose = `${'word '.repeat(120)}`;
    const report = lintResume(prose);
    expect(report.violations.some((v) => v.rule === 'no-bullets')).toBe(true);
  });

  it('matches regex-special keywords (c++, c#, .net, ci/cd) without throwing', () => {
    const report = lintResume('- Built systems in C++ and C# on .NET with CI/CD by 30%.', {
      jdKeywords: ['c++', 'c#', '.net', 'ci/cd'],
    });
    expect(report.keywordCoverage?.matched.sort()).toEqual(['.net', 'c#', 'c++', 'ci/cd']);
  });

  describe('template contract (base provided)', () => {
    const structuralRules = ['section-structure', 'header-changed', 'locked-section'];
    const hasRule = (r: ReturnType<typeof lintResume>, rule: string) =>
      r.violations.some((v) => v.rule === rule);

    it('does not run structural checks when no base is provided', () => {
      const report = lintResume(TAILORED_OK);
      for (const rule of structuralRules) expect(hasRule(report, rule)).toBe(false);
    });

    it('accepts changes confined to editable sections', () => {
      const report = lintResume(TAILORED_OK, { base: BASE_RESUME });
      for (const rule of structuralRules) expect(hasRule(report, rule)).toBe(false);
    });

    it('flags edits to a locked section (PROJECTS)', () => {
      const tampered = TAILORED_OK.replace(
        'ranked postings for 1,000 users',
        'ranked postings for 5,000 users',
      );
      const report = lintResume(tampered, { base: BASE_RESUME });
      expect(hasRule(report, 'locked-section')).toBe(true);
      expect(report.ok).toBe(false);
    });

    it('flags a changed header (name/contact)', () => {
      const tampered = TAILORED_OK.replace('JANE DOE', 'JANE Q. DOE');
      const report = lintResume(tampered, { base: BASE_RESUME });
      expect(hasRule(report, 'header-changed')).toBe(true);
    });

    it('flags added/removed/renamed section headings', () => {
      const renamed = TAILORED_OK.replace('TECHNICAL SKILLS', 'SKILLS');
      const report = lintResume(renamed, { base: BASE_RESUME });
      expect(hasRule(report, 'section-structure')).toBe(true);
    });

    it('locks additional sections via lockedSections (extends, not replaces)', () => {
      const changedSkills = TAILORED_OK.replace('Go, Kafka, PostgreSQL', 'Rust');
      const report = lintResume(changedSkills, {
        base: BASE_RESUME,
        lockedSections: ['technical skills'],
      });
      expect(hasRule(report, 'locked-section')).toBe(true);
    });

    it('always keeps PROJECTS locked even when lockedSections omits it', () => {
      const tampered = TAILORED_OK.replace(
        'ranked postings for 1,000 users',
        'ranked postings for 9,000 users',
      );
      const report = lintResume(tampered, {
        base: BASE_RESUME,
        lockedSections: ['technical skills'], // note: no 'projects'
      });
      expect(hasRule(report, 'locked-section')).toBe(true);
    });

    it('flags reordered headings even when the set is identical', () => {
      const a = '\\section*{A}\nx\n\\section*{B}\ny';
      const reordered = '\\section*{B}\ny\n\\section*{A}\nx';
      const report = lintResume(reordered, { base: a });
      expect(hasRule(report, 'section-structure')).toBe(true);
    });

    it('warns and skips lock checks when the base has no sections', () => {
      const report = lintResume('- Shipped an API that cut latency by 40% for users.', {
        base: 'plain base resume, no section headings',
      });
      expect(hasRule(report, 'template-structure')).toBe(true);
      for (const rule of structuralRules) expect(hasRule(report, rule)).toBe(false);
    });
  });

  describe('extractSections', () => {
    it('splits header and section blocks', () => {
      const { header, sections } = extractSections(BASE_RESUME);
      expect(header).toContain('JANE DOE');
      expect(sections.map((s) => s.title)).toEqual([
        'EDUCATION',
        'EXPERIENCE',
        'PROJECTS',
        'TECHNICAL SKILLS',
      ]);
      expect(sections[2].body).toContain('Job Board');
    });

    it('returns the whole text as header when there are no sections', () => {
      const { header, sections } = extractSections('- just a bullet, no sections');
      expect(sections).toEqual([]);
      expect(header).toContain('just a bullet');
    });

    it('handles headings with nested braces', () => {
      const tex = String.raw`\section*{\textbf{Technical Skills}} Java, Python`;
      const { sections } = extractSections(tex);
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBe(String.raw`\textbf{Technical Skills}`);
      expect(sections[0].body.trim()).toBe('Java, Python');
    });

    it('ignores commented-out section headings', () => {
      const tex = ['\\section*{EDUCATION}', 'MS CS', '% \\section*{OLD}', 'more'].join('\n');
      const { sections } = extractSections(tex);
      expect(sections.map((s) => s.title)).toEqual(['EDUCATION']);
    });
  });
});
