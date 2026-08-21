import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { DEFAULT_PROFILE_FACTS } from './profile';
import { BULLET_CHARS } from './rubric';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES } from './template';
import type { ResumeOutline } from './plan';
import {
  buildBulletsMessages,
  buildOutlineMessages,
  CORPUS_INVENTION_STANCE,
  outlineFromCorpus,
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

const SKILL_ROWS = [
  { label: 'Languages', items: ['java', 'python'] },
  { label: 'Streaming', items: ['kafka'] },
  { label: 'Backend', items: ['high concurrency'] },
  { label: 'Data', items: ['python'] },
];

/** The stage-A answer a well-behaved model returns, as raw JSON. */
function outlineJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    coursework: DEFAULT_PROFILE_FACTS.coursework.slice(0, COURSEWORK_SLOTS.max),
    skills: SKILL_ROWS,
    placements: [
      { keyword: 'kafka', slot: { kind: 'role', roleId: RESUME_ROLES[0].id, bulletIndex: 0 } },
      { keyword: 'high concurrency', slot: { kind: 'skills', label: 'Backend' } },
    ],
    ...over,
  });
}

/** The outline stage B is handed — already approved, already canonical. */
const APPROVED: ResumeOutline = JSON.parse(outlineJson()) as ResumeOutline;

/** The stage-B answer: prose, and nothing the outline already decided. */
function bulletsJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
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
    ...over,
  });
}

describe('buildOutlineMessages (stage A)', () => {
  it('asks for the decisions and forbids prose', () => {
    const { system } = buildOutlineMessages(job, inputs);
    expect(system).toContain(CORPUS_INVENTION_STANCE);
    expect(system).toContain('THIS IS THE PLANNING STAGE');
    expect(system).toContain('ONE JSON OBJECT AND NOTHING ELSE');
    expect(system).toContain('Do NOT write bullet prose here');
    // The old prompt asked for "ONLY the full LaTeX document" — the whole point
    // of #190 is that no prompt asks for a document any more.
    expect(system.toLowerCase()).not.toContain('full latex');
    // The slots that exist, so a placement cannot point at a bullet that does not.
    for (const role of RESUME_ROLES) {
      expect(system).toContain(
        `"${role.id}" (${role.title}, ${role.employer}): bullets 1-${role.bullets}`,
      );
    }
  });

  it('carries the job, the keywords, the raw bullets and the fixed facts', () => {
    const { user } = buildOutlineMessages(job, inputs);
    expect(user).toContain('Backend Engineer at Stripe');
    expect(user).toContain('kafka');
    expect(user).toContain('IN PRIORITY ORDER');
    expect(user).toContain('Scaled a payments pipeline');
    expect(user).toContain('Nireeksha Huns');
    // The coursework pool the model must select from, never invent around.
    expect(user).toContain('COURSEWORK POOL');
  });

  it('closes the skills set, because the checker drops anything outside it', () => {
    const { user } = buildOutlineMessages(job, inputs);
    expect(user).toContain('SKILLS YOU MAY LIST');
    expect(user).toContain('high concurrency');

    const noSkills = buildOutlineMessages(job, { ...inputs, masterSkills: [] });
    expect(noSkills.user).not.toContain('SKILLS YOU MAY LIST');
  });

  it('keeps the tailoring method and its precedence rule', () => {
    const { system } = buildOutlineMessages(job, inputs);
    expect(system).toContain('METHOD — follow these five steps');
    expect(system).toContain('Bucket A');
    expect(system).toContain('which are hard and not negotiable');
  });
});

describe('buildBulletsMessages (stage B)', () => {
  it('states the footprint band and the exact bullet counts', () => {
    const { system } = buildBulletsMessages(job, inputs, APPROVED);
    expect(system).toContain('THIS IS THE WRITING STAGE');
    for (const role of RESUME_ROLES) {
      expect(system).toContain(`"roleId": "${role.id}"`);
      expect(system).toContain(`exactly ${role.bullets} strings`);
    }
    expect(system).toContain(`${BULLET_CHARS.min}-${BULLET_CHARS.max} characters`);
  });

  it('restates the approved outline as settled, with each keyword its home', () => {
    const { user } = buildBulletsMessages(job, inputs, APPROVED);
    expect(user).toContain('APPROVED OUTLINE — decided already, not open for revision');
    expect(user).toContain(`kafka → ${RESUME_ROLES[0].employer} bullet 1`);
    expect(user).toContain('high concurrency → skills: Backend');
    expect(user).toContain(APPROVED.coursework[0]);
  });

  it('hands back the problems with the previous attempt', () => {
    const { user } = buildBulletsMessages(job, inputs, APPROVED, [
      'lseg bullet 2 is 268 characters',
    ]);
    expect(user).toContain('lseg bullet 2 is 268 characters');
  });
});

describe('adjacent-only keywords', () => {
  it('tells the model to gesture at them rather than claim them', () => {
    const { user } = buildOutlineMessages(job, { ...inputs, adjacentKeywords: ['kubernetes'] });
    expect(user).toContain('ADJACENT ONLY');
    expect(user).toContain('kubernetes');
    expect(user).toContain('Do NOT name these technologies');
  });

  it('says nothing when there are none', () => {
    expect(buildOutlineMessages(job, inputs).user).not.toContain('ADJACENT ONLY');
  });

  it('never gates on them, in either stage, but still reports them', async () => {
    // Gating on a keyword we just told the model not to claim would re-prompt it
    // to claim it. It belongs in the report, never in the retry signal.
    const adjacentInputs = {
      ...inputs,
      selectedKeywords: ['kafka'],
      adjacentKeywords: ['bgp'],
    };
    const planning = vi.fn(async () => outlineJson());
    const outline = await outlineFromCorpus(
      job,
      adjacentInputs,
      { complete: planning },
      {
        maxAttempts: 3,
      },
    );
    expect(planning).toHaveBeenCalledTimes(1);
    expect(outline.issues.map((i) => i.rule)).not.toContain('keyword-unplanned');

    const writing = vi.fn(async () => bulletsJson());
    const result = await tailorFromCorpus(job, adjacentInputs, outline.outline, {
      complete: writing,
    });
    expect(result.report.planIssues.map((i) => i.rule)).not.toContain('keyword-missing');
    expect(result.report.adjacentKeywords).toEqual(['bgp']);
    expect(result.report.coverage.map((c) => c.keyword)).toContain('bgp');
    expect(result.report.reportKeywords).toEqual(['kafka', 'bgp']);
  });
});

describe('outlineFromCorpus (stage A)', () => {
  it('returns a checked outline the owner can approve', async () => {
    const complete = vi.fn(async () => outlineJson());
    const result = await outlineFromCorpus(job, inputs, { complete }, { maxAttempts: 2 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.outline.placements.map((p) => p.keyword)).toEqual(['kafka', 'high concurrency']);
  });

  it('re-prompts when a corpus-backed keyword has nowhere to go', async () => {
    const homeless = outlineJson({ placements: [] });
    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce(homeless)
      .mockResolvedValueOnce(outlineJson());
    const result = await outlineFromCorpus(job, inputs, { complete }, { maxAttempts: 2 });

    const retryPrompt = complete.mock.calls[1][0].user;
    expect(retryPrompt).toContain('No home planned for: kafka, high concurrency');
    expect(result.attempts).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it('reports what it repaired without spending an attempt on it', async () => {
    const offPool = outlineJson({
      coursework: ['Advanced Machine Learning', ...DEFAULT_PROFILE_FACTS.coursework.slice(0, 3)],
    });
    const complete = vi.fn(async () => offPool);
    const result = await outlineFromCorpus(job, inputs, { complete }, { maxAttempts: 2 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.repairs.join(' ')).toContain('Advanced Machine Learning');
    expect(result.outline.coursework).not.toContain('Advanced Machine Learning');
  });

  it('fails loudly when nothing parses', async () => {
    await expect(
      outlineFromCorpus(
        job,
        inputs,
        { complete: async () => 'I cannot help.' },
        { maxAttempts: 2 },
      ),
    ).rejects.toThrow(/failed after 2 attempt/);
  });
});

describe('tailorFromCorpus (stage B)', () => {
  it('renders the document itself from the approved outline plus new bullets', async () => {
    const result = await tailorFromCorpus(
      job,
      inputs,
      APPROVED,
      { complete: async () => bulletsJson() },
      { maxAttempts: 1 },
    );
    expect(result.report.attempts).toBe(1);
    expect(result.report.selectedKeywords).toEqual(['kafka', 'high concurrency']);
    // The fixed skeleton, which no model output can influence.
    expect(result.latex).toContain('\\documentclass[11pt]{article}');
    expect(result.latex).toContain(RESUME_ROLES[0].employer);
    expect(result.latex).toContain('\\section*{TECHNICAL SKILLS}');
    // The plan's own words, and the outline's own decisions.
    expect(result.latex).toContain('Engineered Kafka service 0');
    expect(result.latex).toContain(APPROVED.coursework[0]);
    expect(result.plan.skills).toEqual(APPROVED.skills);
  });

  it('cannot be talked out of the approved outline by a chatty model', async () => {
    // Stage B answering with its own coursework is a parse failure, not a silent
    // override — the whole value of approving an outline is that it holds.
    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce(bulletsJson({ coursework: ['Advanced Machine Learning'] }))
      .mockResolvedValueOnce(bulletsJson());
    const result = await tailorFromCorpus(job, inputs, APPROVED, { complete }, { maxAttempts: 2 });
    expect(result.report.attempts).toBe(2);
    expect(result.plan.coursework).toEqual(APPROVED.coursework);
    expect(complete.mock.calls[1][0].user).toContain(
      'Fix these problems with your previous attempt',
    );
  });

  it('re-prompts on what only the model can fix, and keeps the better attempt', async () => {
    // First attempt: LSEG missing entirely and a bullet over the footprint.
    const broken = JSON.parse(bulletsJson()) as { roles: { roleId: string; bullets: string[] }[] };
    broken.roles = [{ roleId: RESUME_ROLES[0].id, bullets: [...broken.roles[0].bullets] }];
    broken.roles[0].bullets[0] = 'x'.repeat(BULLET_CHARS.max + 40);

    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce(JSON.stringify(broken))
      .mockResolvedValueOnce(bulletsJson());
    const result = await tailorFromCorpus(job, inputs, APPROVED, { complete }, { maxAttempts: 3 });

    const retryPrompt = complete.mock.calls[1][0].user;
    expect(retryPrompt).toContain(RESUME_ROLES[1].employer);
    expect(retryPrompt).toContain('two full lines');
    expect(result.report.attempts).toBe(2);
    expect(result.report.planIssues.filter((i) => i.retryable)).toEqual([]);
    expect(result.latex).not.toContain('xxxxx');
  });

  it('keeps the least-bad attempt when none of them come out clean', async () => {
    const missingRole = JSON.parse(bulletsJson()) as { roles: unknown[] };
    missingRole.roles = [missingRole.roles[0]];
    const complete = vi
      .fn<ChatClient['complete']>()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify(missingRole))
      .mockResolvedValueOnce('still not json');
    const result = await tailorFromCorpus(job, inputs, APPROVED, { complete }, { maxAttempts: 3 });

    expect(result.report.attempts).toBe(3);
    expect(result.report.planIssues.some((i) => i.rule === 'role-missing')).toBe(true);
    // Still renderable: the role with no bullets is simply an empty section.
    expect(result.latex).toContain(RESUME_ROLES[1].employer);
  });

  it('fails loudly when nothing parses, so the caller can fall back', async () => {
    await expect(
      tailorFromCorpus(
        job,
        inputs,
        APPROVED,
        { complete: async () => 'I cannot help.' },
        { maxAttempts: 2 },
      ),
    ).rejects.toThrow(/failed after 2 attempt/);
  });

  it('cannot be talked into emitting markup the renderer did not author', async () => {
    const sneaky = JSON.parse(bulletsJson()) as { roles: { bullets: string[] }[] };
    sneaky.roles[0].bullets[0] = `\\usepackage{xcolor}\\definecolor{x}{RGB}{1,2,3}${bullet('Engineered a Kafka consumer')}`;
    const result = await tailorFromCorpus(
      job,
      inputs,
      APPROVED,
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
