import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { DEFAULT_PROFILE_FACTS } from './profile';
import { WORD_MIN } from './rubric';
import {
  buildCorpusTailorMessages,
  CORPUS_INVENTION_STANCE,
  tailorFromCorpus,
  type CorpusTailorInputs,
} from './tailor';

const job = { title: 'Backend Engineer', company: 'Stripe' };
const inputs: CorpusTailorInputs = {
  selectedKeywords: ['kafka', 'high concurrency'],
  bullets: [{ text: 'Scaled a payments pipeline to 500k events/day', company: 'LSEG' }],
  profile: DEFAULT_PROFILE_FACTS,
};
const TEMPLATE = '\\documentclass{article}\\begin{document}FORMAT\\end{document}';

describe('buildCorpusTailorMessages', () => {
  it('carries the invention stance, keywords, bullets, profile, and template', () => {
    const { system, user } = buildCorpusTailorMessages(job, inputs, TEMPLATE);
    expect(system).toContain(CORPUS_INVENTION_STANCE);
    expect(system.toLowerCase()).toContain('only the full latex');
    expect(user).toContain('Backend Engineer at Stripe');
    expect(user).toContain('kafka');
    expect(user).toContain('Scaled a payments pipeline');
    expect(user).toContain('Nireeksha Huns');
    expect(user).toContain('FORMAT');
  });

  it('appends prior violations when re-prompting', () => {
    const { user } = buildCorpusTailorMessages(job, inputs, TEMPLATE, ['too long']);
    expect(user).toContain('too long');
  });
});

describe('tailorFromCorpus', () => {
  it('strips fences and returns a report with attempts + selected keywords', async () => {
    const chat: ChatClient = {
      complete: async () => '```latex\n\\documentclass{article}...\n```',
    };
    const result = await tailorFromCorpus(TEMPLATE, job, inputs, chat, { maxAttempts: 1 });
    expect(result.latex.startsWith('```')).toBe(false);
    expect(result.report.attempts).toBe(1);
    expect(result.report.selectedKeywords).toEqual(['kafka', 'high concurrency']);
  });

  it('stops early once the linter passes', async () => {
    const complete = vi.fn(async () => GOOD_RESUME);
    await tailorFromCorpus(
      TEMPLATE,
      job,
      { ...inputs, selectedKeywords: [] },
      { complete },
      {
        maxAttempts: 3,
      },
    );
    // A clean résumé should not need a second attempt.
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

// A résumé that satisfies the linter: inside the word band, at or under the
// one-page bullet ceiling, strong-verb bullets, a metric in most, consistent
// (no) end punctuation, varied lead verbs.
const filler = Array.from({ length: WORD_MIN }, (_, i) => `word${i}`).join(' ');
const GOOD_RESUME = `\\documentclass{article}
\\begin{document}
${filler}
\\begin{itemize}
\\item Shipped a Kafka pipeline handling 500k events per day
\\item Reduced p99 latency by 40 percent across 3 services
\\item Automated deploys cutting release time by 2 hours
\\end{itemize}
\\end{document}`;
