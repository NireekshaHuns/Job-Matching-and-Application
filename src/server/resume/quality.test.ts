import { describe, expect, it } from 'vitest';
import { lintResume } from './quality';

/**
 * Distinct, realistic bullets with varied strong verbs (incl. ones NOT in the
 * allowlist, e.g. Spearheaded/Refactored/Owned), each with a metric + period.
 */
const GOOD_BULLETS = [
  '- Shipped a payments API that cut p99 latency by 40% for active users.',
  '- Led a data migration that reduced infrastructure cost by 30% across teams.',
  '- Spearheaded a rewrite that improved request throughput by 3x for the platform.',
  '- Refactored the auth service, cutting error rates by 25% within two weeks.',
  '- Automated deployments that improved release frequency by 50% for platform teams.',
  '- Migrated services to Kubernetes, reducing production incidents by 60% overall.',
  '- Designed a caching layer that boosted cache hit rate to 95% in production.',
  '- Owned the billing pipeline, improving invoice accuracy by 20% for customers.',
];

/** Cycle distinct bullets to land within the 475–600 word target. */
function goodResume(n = 44): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(GOOD_BULLETS[i % GOOD_BULLETS.length]);
  return lines.join('\n');
}

describe('lintResume', () => {
  it('passes a well-formed resume with varied (incl. unlisted) strong verbs', () => {
    const report = lintResume(goodResume());
    expect(report.ok).toBe(true);
    expect(report.wordCount).toBeGreaterThanOrEqual(475);
    expect(report.wordCount).toBeLessThanOrEqual(600);
    expect(report.bulletCount).toBe(44);
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
});
