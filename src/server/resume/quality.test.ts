import { describe, expect, it } from 'vitest';
import { lintResume } from './quality';

/** 12-word bullets: strong verb start, a metric, trailing period. */
const GOOD_BULLETS = [
  '- Shipped a payments API that cut p99 latency by 40% for users.',
  '- Led a migration that reduced infra cost by 30% across 12 services.',
  '- Automated deployments that improved release speed by 50% for two platform teams.',
];

/** Repeat good bullets to land within the 475–600 word target. */
function goodResume(n = 42): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(GOOD_BULLETS[i % GOOD_BULLETS.length]);
  return lines.join('\n');
}

describe('lintResume', () => {
  it('passes a well-formed resume', () => {
    const report = lintResume(goodResume());
    expect(report.ok).toBe(true);
    expect(report.wordCount).toBeGreaterThanOrEqual(475);
    expect(report.wordCount).toBeLessThanOrEqual(600);
    expect(report.bulletCount).toBe(42);
  });

  it('flags a resume that is too short', () => {
    const report = lintResume('- Shipped an API that cut latency by 40% for users.');
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.rule === 'word-count')).toBe(true);
  });

  it('flags bystander verbs as errors', () => {
    const report = lintResume(
      goodResume() + '\n- Helped with the backend and assisted the team daily.',
    );
    expect(report.violations.some((v) => v.rule === 'weak-verb')).toBe(true);
    expect(report.ok).toBe(false);
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

  it('handles LaTeX \\item bullets', () => {
    const report = lintResume(
      '\\item Shipped a \\textbf{payments} API that cut p99 latency by 40\\% for users.',
    );
    expect(report.bulletCount).toBe(1);
  });
});
