import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import {
  buildTailorMessages,
  selectTailoringInputs,
  tailorResume,
  type TailorBullet,
  type TailorInputs,
  type TailorJob,
} from './tailor';

// A lint-passing LaTeX resume: \item bullets with strong verbs, metrics,
// consistent periods, and enough words to hit the 475–600 target.
const ITEMS = [
  '\\item Shipped a payments API that cut p99 latency by 40% for active users.',
  '\\item Led a data migration that reduced infrastructure cost by 30% across teams.',
  '\\item Spearheaded a rewrite that improved request throughput by 3x for the platform.',
  '\\item Refactored the auth service, cutting error rates by 25% within two weeks.',
  '\\item Automated deployments that improved release frequency by 50% for platform teams.',
  '\\item Migrated services to Kubernetes, reducing production incidents by 60% overall.',
  '\\item Designed a caching layer that boosted cache hit rate to 95% in production.',
  '\\item Owned the billing pipeline, improving invoice accuracy by 20% for customers.',
];
function goodLatex(n = 46): string {
  const body = Array.from({ length: n }, (_, i) => ITEMS[i % ITEMS.length]).join('\n');
  return `\\begin{document}\n${body}\n\\end{document}`;
}

/** A lint-passing résumé WITH the fixed section set, for template-contract tests. */
function sectionedLatex(n = 44): string {
  const body = Array.from({ length: n }, (_, i) => ITEMS[i % ITEMS.length]).join('\n');
  return [
    '\\begin{document}',
    '\\begin{center}\\textbf{JANE DOE} | jane@example.com\\end{center}',
    '\\section*{EXPERIENCE}',
    body,
    '\\section*{PROJECTS}',
    '\\item Built a Kanban tracker that ranked postings for 1,000 users.',
    '\\end{document}',
  ].join('\n');
}

function makeChat(responses: string[]) {
  const calls: Array<{ system: string; user: string }> = [];
  let i = 0;
  const client: ChatClient = {
    complete: async (m) => {
      calls.push(m);
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
  return { calls, client };
}

const job: TailorJob = {
  title: 'Backend Engineer',
  company: 'Acme',
  techKeywords: ['go', 'kafka', 'rust'],
  softKeywords: ['leadership'],
};
const bullets: TailorBullet[] = [
  { text: 'Shipped a Go service.', skills: ['go'], roleFamily: 'backend' },
  { text: 'Built a Kafka pipeline.', skills: ['kafka'], roleFamily: 'backend' },
  { text: 'Designed a React UI.', skills: ['react'], roleFamily: 'frontend' },
];
const masterSkills = ['go', 'kafka', 'leadership', 'react'];

describe('selectTailoringInputs', () => {
  it('covers only truthful keywords and reports true gaps', () => {
    const inputs = selectTailoringInputs(job, masterSkills, bullets, 'backend');
    // rust is not in master -> true gap, never coverable.
    expect(inputs.coverableKeywords.sort()).toEqual(['go', 'kafka', 'leadership']);
    expect(inputs.trueGaps).toEqual(['rust']);
  });

  it('selects role-relevant bullets that hit coverable keywords', () => {
    const inputs = selectTailoringInputs(job, masterSkills, bullets, 'backend');
    const texts = inputs.relevantBullets.map((b) => b.text);
    expect(texts).toContain('Shipped a Go service.');
    expect(texts).toContain('Built a Kafka pipeline.');
    expect(texts).not.toContain('Designed a React UI.'); // frontend role excluded
  });
});

describe('buildTailorMessages', () => {
  it('includes coverable keywords but never the true gaps', () => {
    const inputs: TailorInputs = {
      coverableKeywords: ['go', 'kafka'],
      trueGaps: ['rust'],
      relevantBullets: [],
    };
    const { user } = buildTailorMessages('\\documentclass{article}', job, inputs);
    expect(user).toContain('go, kafka');
    expect(user).not.toContain('rust');
  });
});

describe('tailorResume', () => {
  const inputs: TailorInputs = {
    coverableKeywords: ['go', 'kafka'],
    trueGaps: ['rust'],
    relevantBullets: bullets.slice(0, 2),
  };

  it('returns a passing resume on the first attempt', async () => {
    const chat = makeChat([goodLatex()]);
    const { latex, report } = await tailorResume('base', job, inputs, chat.client);
    expect(report.attempts).toBe(1);
    expect(report.lint.ok).toBe(true);
    expect(latex).toContain('\\begin{document}');
  });

  it('re-prompts with violations when the first attempt fails the linter', async () => {
    const bad = '\\item Helped with backend stuff.'; // weak verb + far too short
    const chat = makeChat([bad, goodLatex()]);
    const { report } = await tailorResume('base', job, inputs, chat.client, { maxAttempts: 3 });
    expect(report.attempts).toBe(2);
    expect(report.lint.ok).toBe(true);
    // Second prompt fed back the violations to fix.
    expect(chat.calls[1].user).toContain('Fix these issues');
  });

  it('strips ```latex fences from the model output', async () => {
    const chat = makeChat(['```latex\n' + goodLatex() + '\n```']);
    const { latex } = await tailorResume('base', job, inputs, chat.client);
    expect(latex.startsWith('```')).toBe(false);
    expect(latex).toContain('\\begin{document}');
  });

  it('gives up after maxAttempts and returns the best attempt with its report', async () => {
    const chat = makeChat(['\\item Helped out.']); // always bad
    const { report } = await tailorResume('base', job, inputs, chat.client, { maxAttempts: 2 });
    expect(report.attempts).toBe(2);
    expect(report.lint.ok).toBe(false);
  });

  it('does not re-prompt for warn-only output (breaks on attempt 1)', async () => {
    // Passes structurally (ok:true) but has a buzzword warning.
    const warnOnly = goodLatex().replace(
      '\\end{document}',
      '\\item Shipped features as a hardworking team player by 10%.\n\\end{document}',
    );
    const chat = makeChat([warnOnly]);
    const { report } = await tailorResume('base', job, inputs, chat.client, { maxAttempts: 3 });
    expect(report.attempts).toBe(1);
    expect(report.lint.ok).toBe(true);
  });

  it('re-prompts when the model breaks the locked template, then accepts a compliant fix', async () => {
    const base = sectionedLatex();
    // First attempt renames the locked PROJECTS heading -> section-structure error.
    const broken = base.replace('\\section*{PROJECTS}', '\\section*{SIDE PROJECTS}');
    const chat = makeChat([broken, base]);
    const { report } = await tailorResume(base, job, inputs, chat.client, { maxAttempts: 3 });
    expect(report.attempts).toBe(2);
    expect(report.lint.ok).toBe(true);
    expect(chat.calls[1].user).toContain('Fix these issues');
  });

  it('accepts a first attempt that respects the locked template', async () => {
    const base = sectionedLatex();
    const chat = makeChat([base]);
    const { report } = await tailorResume(base, job, inputs, chat.client);
    expect(report.attempts).toBe(1);
    expect(report.lint.ok).toBe(true);
  });

  it('flags a true-gap keyword that leaks into the output', async () => {
    const gapInputs: TailorInputs = {
      coverableKeywords: ['go', 'kafka'],
      trueGaps: ['rust'],
      relevantBullets: [],
    };
    // The base resume legitimately mentions rust; it survives into the output.
    const withRust = goodLatex().replace(
      '\\end{document}',
      '\\item Built a Rust service that cut latency by 20%.\n\\end{document}',
    );
    const chat = makeChat([withRust]);
    const { report } = await tailorResume('base', job, gapInputs, chat.client);
    expect(report.unexpectedGaps).toEqual(['rust']);
  });
});
