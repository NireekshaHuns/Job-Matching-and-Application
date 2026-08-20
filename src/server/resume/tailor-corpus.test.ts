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

describe('adjacent-only keywords', () => {
  it('tells the model to gesture at them rather than claim them', () => {
    const { user } = buildCorpusTailorMessages(
      job,
      {
        ...inputs,
        adjacentKeywords: ['kubernetes'],
      },
      TEMPLATE,
    );
    expect(user).toContain('ADJACENT ONLY');
    expect(user).toContain('kubernetes');
    expect(user).toContain('Do NOT name these technologies');
  });

  it('says nothing when there are none', () => {
    const { user } = buildCorpusTailorMessages(job, inputs, TEMPLATE);
    expect(user).not.toContain('ADJACENT ONLY');
  });

  it('states that the keyword list is in priority order', () => {
    // The Studio hands them over sorted by importance, and the model is told to
    // drop from the end — so the ordering has to be claimed explicitly.
    const { user } = buildCorpusTailorMessages(job, inputs, TEMPLATE);
    expect(user).toContain('IN PRIORITY ORDER');
  });

  it("keeps them out of the linter's coverage check but inside the report", async () => {
    // Gating on a keyword we just told the model not to claim would re-prompt it
    // to claim it. It belongs in the report, never in the retry signal.
    const chat: ChatClient = { complete: async () => GOOD_RESUME };
    const result = await tailorFromCorpus(
      TEMPLATE,
      job,
      { ...inputs, selectedKeywords: ['kafka'], adjacentKeywords: ['bgp'] },
      chat,
      { maxAttempts: 1 },
    );
    const coverageMsg = result.report.lint.violations.find((v) => v.rule === 'keyword-coverage');
    expect(coverageMsg?.message ?? '').not.toContain('bgp');
    expect(result.report.adjacentKeywords).toEqual(['bgp']);
    expect(result.report.coverage.map((c) => c.keyword)).toContain('bgp');
  });
});

describe("the owner's tailoring method", () => {
  it('reaches the system prompt', () => {
    const { system } = buildCorpusTailorMessages(
      { title: 'Backend Engineer', company: 'Acme' },
      { selectedKeywords: ['go'], bullets: [], profile: DEFAULT_PROFILE_FACTS },
      '\\documentclass{article}',
    );
    expect(system).toContain('METHOD — follow these five steps');
    expect(system).toContain('Bucket A');
  });

  it('states that the hard limits still win', () => {
    // Without this the method pushes length upward ("two full lines", extra
    // skills lines) while claiming to outrank the rubric — and the linter's
    // word cap would fail every attempt, burning three LLM calls a generation
    // for a report that can never pass.
    const { system } = buildCorpusTailorMessages(
      { title: 'Backend Engineer', company: 'Acme' },
      { selectedKeywords: [], bullets: [], profile: DEFAULT_PROFILE_FACTS },
      '\\documentclass{article}',
    );
    expect(system).toContain('which are hard and not negotiable');
  });
});
