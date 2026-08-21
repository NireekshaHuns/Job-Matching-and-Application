import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { DEFAULT_PROFILE_FACTS } from './profile';
import { BULLET_CHARS } from './rubric';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES } from './template';
import {
  buildPlanTailorMessages,
  CORPUS_INVENTION_STANCE,
  tailorFromCorpus,
  type CorpusTailorInputs,
} from './tailor';

const job = { title: 'Backend Engineer', company: 'Stripe' };
const inputs: CorpusTailorInputs = {
  selectedKeywords: ['kafka', 'high concurrency'],
  bullets: [{ text: 'Scaled a payments pipeline to 500k events/day', company: 'LSEG' }],
  profile: DEFAULT_PROFILE_FACTS,
  masterSkills: ['kafka', 'java', 'python', 'high concurrency'],
};

/** A bullet of in-band length, so fixtures don't trip the footprint rule. */
function bullet(text: string): string {
  let out = text;
  while (out.length < BULLET_CHARS.min) {
    out += ' across every region, with tracing, backpressure and idempotent retries throughout';
  }
  return out.slice(0, BULLET_CHARS.max);
}

/** The plan a well-behaved model returns, as raw JSON. */
function planJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    coursework: DEFAULT_PROFILE_FACTS.coursework.slice(0, COURSEWORK_SLOTS.max),
    roles: RESUME_ROLES.map((role) => ({
      roleId: role.id,
      bullets: Array.from({ length: role.bullets }, (_, i) =>
        bullet(`Engineered Kafka service ${i} under high concurrency cutting p99 latency by 40%`),
      ),
    })),
    project: {
      stack: 'Next.js, TypeScript, tRPC, PostgreSQL',
      bullets: Array.from({ length: BULLET_BUDGET.projects }, (_, i) =>
        bullet(`Shipped ranking pipeline ${i} serving 9,900 postings with pgvector retrieval`),
      ),
    },
    skills: [
      { label: 'Languages', items: ['java', 'python'] },
      { label: 'Streaming', items: ['kafka'] },
      { label: 'Backend', items: ['high concurrency'] },
      { label: 'Data', items: ['python'] },
    ],
    placements: [],
    ...over,
  });
}

describe('buildPlanTailorMessages', () => {
  it('asks for a plan, not a document, and states the layout it must fill', () => {
    const { system } = buildPlanTailorMessages(job, inputs);
    expect(system).toContain(CORPUS_INVENTION_STANCE);
    expect(system).toContain('ONE JSON OBJECT AND NOTHING ELSE');
    // The old prompt asked for "ONLY the full LaTeX document" — the whole point
    // of #190 is that no prompt asks for a document any more.
    expect(system.toLowerCase()).not.toContain('full latex');
    for (const role of RESUME_ROLES) {
      expect(system).toContain(`"roleId": "${role.id}"`);
      expect(system).toContain(`exactly ${role.bullets} strings`);
    }
    expect(system).toContain(`${BULLET_CHARS.min}-${BULLET_CHARS.max} characters`);
  });

  it('carries the job, the keywords, the raw bullets and the fixed facts', () => {
    const { user } = buildPlanTailorMessages(job, inputs);
    expect(user).toContain('Backend Engineer at Stripe');
    expect(user).toContain('kafka');
    expect(user).toContain('IN PRIORITY ORDER');
    expect(user).toContain('Scaled a payments pipeline');
    expect(user).toContain('Nireeksha Huns');
    // The coursework pool the model must select from, never invent around.
    expect(user).toContain('COURSEWORK POOL');
  });

  it('closes the skills set, because the checker drops anything outside it', () => {
    const { user } = buildPlanTailorMessages(job, inputs);
    expect(user).toContain('SKILLS YOU MAY LIST');
    expect(user).toContain('high concurrency');

    const noSkills = buildPlanTailorMessages(job, { ...inputs, masterSkills: [] });
    expect(noSkills.user).not.toContain('SKILLS YOU MAY LIST');
  });

  it('hands back the problems with the previous attempt', () => {
    const { user } = buildPlanTailorMessages(job, inputs, ['lseg bullet 2 is 268 characters']);
    expect(user).toContain('lseg bullet 2 is 268 characters');
  });

  it('keeps the tailoring method and its precedence rule', () => {
    const { system } = buildPlanTailorMessages(job, inputs);
    expect(system).toContain('METHOD — follow these five steps');
    expect(system).toContain('Bucket A');
    expect(system).toContain('which are hard and not negotiable');
  });
});

describe('adjacent-only keywords', () => {
  it('tells the model to gesture at them rather than claim them', () => {
    const { user } = buildPlanTailorMessages(job, { ...inputs, adjacentKeywords: ['kubernetes'] });
    expect(user).toContain('ADJACENT ONLY');
    expect(user).toContain('kubernetes');
    expect(user).toContain('Do NOT name these technologies');
  });

  it('says nothing when there are none', () => {
    expect(buildPlanTailorMessages(job, inputs).user).not.toContain('ADJACENT ONLY');
  });

  it('never gates on them, but still reports them', async () => {
    // Gating on a keyword we just told the model not to claim would re-prompt it
    // to claim it. It belongs in the report, never in the retry signal.
    const complete = vi.fn(async () => planJson());
    const result = await tailorFromCorpus(
      job,
      { ...inputs, selectedKeywords: ['kafka'], adjacentKeywords: ['bgp'] },
      { complete },
      { maxAttempts: 3 },
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.report.planIssues.map((i) => i.rule)).not.toContain('keyword-missing');
    expect(result.report.adjacentKeywords).toEqual(['bgp']);
    expect(result.report.coverage.map((c) => c.keyword)).toContain('bgp');
    expect(result.report.reportKeywords).toEqual(['kafka', 'bgp']);
  });
});

describe('tailorFromCorpus', () => {
  it('renders the document itself from the returned plan', async () => {
    const result = await tailorFromCorpus(
      job,
      inputs,
      { complete: async () => planJson() },
      {
        maxAttempts: 1,
      },
    );
    expect(result.report.attempts).toBe(1);
    expect(result.report.selectedKeywords).toEqual(['kafka', 'high concurrency']);
    // The fixed skeleton, which no model output can influence.
    expect(result.latex).toContain('\\documentclass[11pt]{article}');
    expect(result.latex).toContain(RESUME_ROLES[0].employer);
    expect(result.latex).toContain('\\section*{TECHNICAL SKILLS}');
    // The plan's own words, once each.
    expect(result.latex).toContain('Engineered Kafka service 0');
    expect(result.plan.roles).toHaveLength(RESUME_ROLES.length);
  });

  it('stops at the first clean plan', async () => {
    const complete = vi.fn(async () => planJson());
    await tailorFromCorpus(job, inputs, { complete }, { maxAttempts: 3 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('re-prompts with the parse error when the model ignores the shape', async () => {
    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce('{"certifications":["AWS SAA"]}')
      .mockResolvedValueOnce(planJson());
    const result = await tailorFromCorpus(job, inputs, { complete }, { maxAttempts: 3 });
    expect(result.report.attempts).toBe(2);
    // The parser's own complaint is what the model is shown.
    const retryPrompt = complete.mock.calls[1][0].user;
    expect(retryPrompt).toContain('Fix these problems with your previous attempt');
    expect(retryPrompt.toLowerCase()).toContain('certifications');
  });

  it('re-prompts on what only the model can fix, and keeps the better attempt', async () => {
    // First attempt: LSEG missing entirely and a bullet over the footprint.
    const broken = JSON.parse(planJson()) as {
      roles: { roleId: string; bullets: string[] }[];
    };
    broken.roles = [{ roleId: RESUME_ROLES[0].id, bullets: [...broken.roles[0].bullets] }];
    broken.roles[0].bullets[0] = 'x'.repeat(BULLET_CHARS.max + 40);

    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce(JSON.stringify(broken))
      .mockResolvedValueOnce(planJson());
    const result = await tailorFromCorpus(job, inputs, { complete }, { maxAttempts: 3 });

    const retryPrompt = complete.mock.calls[1][0].user;
    expect(retryPrompt).toContain(RESUME_ROLES[1].employer);
    expect(retryPrompt).toContain('two full lines');
    // The second, clean attempt is the one that comes back.
    expect(result.report.attempts).toBe(2);
    expect(result.report.planIssues.filter((i) => i.retryable)).toEqual([]);
    expect(result.latex).not.toContain('xxxxx');
  });

  it('keeps the least-bad attempt when none of them come out clean', async () => {
    const missingRole = JSON.parse(planJson()) as { roles: unknown[] };
    missingRole.roles = [missingRole.roles[0]];
    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify(missingRole))
      .mockResolvedValueOnce('still not json');
    const result = await tailorFromCorpus(job, inputs, { complete }, { maxAttempts: 3 });

    expect(result.report.attempts).toBe(3);
    expect(result.report.planIssues.some((i) => i.rule === 'role-missing')).toBe(true);
    // Still renderable: the role with no bullets is simply an empty section.
    expect(result.latex).toContain(RESUME_ROLES[1].employer);
  });

  it('fails loudly when nothing parses, so the caller can fall back', async () => {
    await expect(
      tailorFromCorpus(job, inputs, { complete: async () => 'I cannot help.' }, { maxAttempts: 2 }),
    ).rejects.toThrow(/failed after 2 attempt/);
  });

  it('reports the repairs it made without re-prompting for them', async () => {
    const offPool = JSON.parse(planJson()) as { coursework: string[] };
    offPool.coursework = ['Advanced Machine Learning', ...offPool.coursework.slice(0, 3)];
    const complete = vi.fn(async () => JSON.stringify(offPool));
    const result = await tailorFromCorpus(job, inputs, { complete }, { maxAttempts: 3 });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.report.repairs.join(' ')).toContain('Advanced Machine Learning');
    expect(result.latex).not.toContain('Advanced Machine Learning');
  });

  it('cannot be talked into emitting markup the renderer did not author', async () => {
    const sneaky = JSON.parse(planJson()) as { roles: { bullets: string[] }[] };
    sneaky.roles[0].bullets[0] = `\\usepackage{xcolor}\\definecolor{x}{RGB}{1,2,3}${bullet('Engineered a Kafka consumer')}`;
    const result = await tailorFromCorpus(
      job,
      inputs,
      { complete: async () => JSON.stringify(sneaky) },
      { maxAttempts: 1 },
    );
    expect(result.latex).not.toContain('xcolor');
    expect(result.latex).not.toContain('definecolor');
    // The bullet arrives as words and nothing else: no command survives into the
    // one place model text is allowed to appear.
    const item = result.latex.split('\n').find((l) => l.includes('Engineered a Kafka consumer'));
    expect(item).toMatch(/^\s*\\item [^\\]+$/);
  });
});
