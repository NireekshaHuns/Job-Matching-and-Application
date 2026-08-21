import { describe, expect, it } from 'vitest';
import {
  buildPlanCoverage,
  checkResumeOutline,
  checkResumePlan,
  describeSlot,
  mergeOutline,
  parseBulletsPlan,
  parseResumeOutline,
  SKILL_ROW_RANGE,
  type PlanContext,
  type ResumeOutline,
  type ResumePlan,
} from './plan';
import { BULLET_CHARS, PROJECT_BULLET_CHARS } from './rubric';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES } from './template';

/** The owner's pool, in the shape Settings stores it (mixed "&" and "and"). */
const POOL = [
  'Data Structures & Algorithms',
  'Web Development & Design',
  'Distributed Systems',
  'Database Design',
  'Cloud Computing',
];

/** Master skills are stored lowercase, as `coverage.ts` reads them. */
const MASTER = ['python', 'java', 'typescript', 'kafka', 'postgresql', 'react', 'aws', 'docker'];

function context(over: Partial<PlanContext> = {}): PlanContext {
  return { coursePool: POOL, masterSkills: MASTER, mustHaveKeywords: [], ...over };
}

/**
 * A bullet of exactly `len` VISIBLE characters that reads like a real one.
 * Lengths are taken from the bands rather than written as literals, so the
 * fixtures follow the calibration instead of silently falling outside it.
 */
function bulletOf(len: number, seed = 'Engineered'): string {
  let out = `${seed} a distributed ingestion service, cutting p99 latency by 40% for active users by replacing synchronous calls with an event-driven queue, backpressure and idempotent retries`;
  while (out.length < len) out += ' across every region we operate in, with tracing and headroom';
  return out.slice(0, len);
}

const MID = Math.round((BULLET_CHARS.min + BULLET_CHARS.max) / 2);
const PROJECT_MID = Math.round((PROJECT_BULLET_CHARS.min + PROJECT_BULLET_CHARS.max) / 2);
const VERBS = ['Engineered', 'Shipped', 'Scaled', 'Automated', 'Migrated'];

/** A plan that passes every check, so each test perturbs exactly one thing. */
function validPlan(over: Partial<ResumePlan> = {}): ResumePlan {
  return {
    coursework: POOL.slice(0, COURSEWORK_SLOTS.max),
    roles: RESUME_ROLES.map((role) => ({
      roleId: role.id,
      bullets: Array.from({ length: role.bullets }, (_, i) =>
        bulletOf(MID, VERBS[i % VERBS.length]),
      ),
    })),
    project: {
      stack: 'Next.js, TypeScript, tRPC, PostgreSQL',
      bullets: Array.from({ length: BULLET_BUDGET.projects }, (_, i) =>
        bulletOf(PROJECT_MID, VERBS[i % VERBS.length]),
      ),
    },
    skills: Array.from({ length: SKILL_ROW_RANGE.min }, (_, i) => ({
      label: `Category ${i + 1}`,
      items: ['python', 'java'],
    })),
    placements: [],
    ...over,
  };
}

const rules = (check: ReturnType<typeof checkResumePlan>) => check.issues.map((i) => i.rule);
const errors = (check: ReturnType<typeof checkResumePlan>) =>
  check.issues.filter((i) => i.severity === 'error');

/** A valid outline: the stage-A half of the fixture above. */
function validOutline(over: Partial<ResumeOutline> = {}): ResumeOutline {
  const plan = validPlan();
  return { coursework: plan.coursework, skills: plan.skills, placements: [], ...over };
}

describe('parseResumeOutline', () => {
  const minimal = { skills: [{ label: 'Languages', items: ['Python'] }] };

  it('finds the outline inside fences and chatter', () => {
    const outline = parseResumeOutline(
      `Sure! Here is the plan:\n\`\`\`json\n${JSON.stringify(minimal)}\n\`\`\`\nHope that helps.`,
    );
    // Absent optional fields become empty, so the checker never sees undefined.
    expect(outline.coursework).toEqual([]);
    expect(outline.placements).toEqual([]);
  });

  it('throws when there is no JSON object at all', () => {
    expect(() => parseResumeOutline('I cannot help with that.')).toThrow(/No JSON object/);
  });

  it('rejects a key the outline has no slot for', () => {
    // The exact failure this design exists to prevent: an invented section is a
    // loud parse error rather than a field that is quietly ignored.
    expect(() =>
      parseResumeOutline(JSON.stringify({ ...minimal, certifications: ['AWS SAA'] })),
    ).toThrow();
  });

  it('rejects bullet prose, which belongs to the next stage', () => {
    const withBullets = {
      ...minimal,
      roles: [{ roleId: 'riskcast', bullets: ['Shipped a thing'] }],
    };
    expect(() => parseResumeOutline(JSON.stringify(withBullets))).toThrow();
  });
});

describe('parseBulletsPlan', () => {
  const minimal = {
    roles: RESUME_ROLES.map((r) => ({ roleId: r.id, bullets: ['Shipped a thing.'] })),
    project: { stack: 'Next.js', bullets: ['Built a thing.'] },
  };

  it('parses the prose half', () => {
    expect(parseBulletsPlan(JSON.stringify(minimal)).roles).toHaveLength(RESUME_ROLES.length);
  });

  it('rejects an attempt to re-decide the outline', () => {
    // Stage B is handed an approved outline; a coursework line coming back from
    // it is either noise or a silent override, and neither is welcome.
    const withCoursework = { ...minimal, coursework: ['Distributed Systems'] };
    expect(() => parseBulletsPlan(JSON.stringify(withCoursework))).toThrow();
  });

  it('rejects a plan with no roles', () => {
    expect(() => parseBulletsPlan(JSON.stringify({ ...minimal, roles: [] }))).toThrow();
  });
});

describe('mergeOutline', () => {
  it('lets the approved outline win every field it owns', () => {
    const outline = validOutline({ coursework: [POOL[1]] });
    const bullets = parseBulletsPlan(
      JSON.stringify({
        roles: [{ roleId: RESUME_ROLES[0].id, bullets: ['Shipped a thing.'] }],
        project: { stack: 'Next.js', bullets: ['Built a thing.'] },
      }),
    );
    const merged = mergeOutline(outline, bullets);
    expect(merged.coursework).toEqual([POOL[1]]);
    expect(merged.skills).toEqual(outline.skills);
    expect(merged.roles).toEqual(bullets.roles);
  });
});

describe('checkResumeOutline', () => {
  const home = (keyword: string, slot: ResumeOutline['placements'][number]['slot']) => ({
    keyword,
    slot,
  });

  it('passes an outline that gives every must-have keyword a home', () => {
    const check = checkResumeOutline(
      validOutline({
        placements: [home('kafka', { kind: 'role', roleId: RESUME_ROLES[0].id, bulletIndex: 0 })],
      }),
      context({ mustHaveKeywords: ['kafka'] }),
    );
    expect(check.issues).toEqual([]);
  });

  it('re-prompts when a must-have keyword has no planned home', () => {
    // The point of the checkpoint: this costs one cheap outline call instead of
    // a whole generation the owner then has to reject.
    const check = checkResumeOutline(
      validOutline({ placements: [home('kafka', { kind: 'none', reason: 'no evidence' })] }),
      context({ mustHaveKeywords: ['kafka', 'redis'] }),
    );
    const issue = check.issues.find((i) => i.rule === 'keyword-unplanned');
    expect(issue?.retryable).toBe(true);
    expect(issue?.message).toContain('kafka');
    expect(issue?.message).toContain('redis');
  });

  it('drops a placement pointing at a role or row that does not exist', () => {
    const check = checkResumeOutline(
      validOutline({
        placements: [
          home('kafka', { kind: 'role', roleId: 'google', bulletIndex: 0 }),
          home('redis', { kind: 'skills', label: 'Imaginary Row' }),
        ],
      }),
      context(),
    );
    expect(check.issues.map((i) => i.rule)).toContain('placement-unknown-role');
    expect(check.issues.map((i) => i.rule)).toContain('placement-unknown-row');
    expect(check.outline.placements).toEqual([]);
  });

  it('clamps a bullet index past the end rather than losing the keyword', () => {
    const check = checkResumeOutline(
      validOutline({
        placements: [
          home('kafka', { kind: 'role', roleId: RESUME_ROLES[0].id, bulletIndex: 8 }),
          home('redis', { kind: 'project', bulletIndex: 7 }),
        ],
      }),
      context({ mustHaveKeywords: ['kafka', 'redis'] }),
    );
    expect(check.outline.placements[0].slot).toEqual({
      kind: 'role',
      roleId: RESUME_ROLES[0].id,
      bulletIndex: RESUME_ROLES[0].bullets - 1,
    });
    expect(check.outline.placements[1].slot).toEqual({
      kind: 'project',
      bulletIndex: BULLET_BUDGET.projects - 1,
    });
    // Clamped, so both keywords still count as planned.
    expect(check.issues.map((i) => i.rule)).not.toContain('keyword-unplanned');
    expect(check.repairs).toHaveLength(2);
  });

  it('repairs the coursework and skills halves the same way a full plan does', () => {
    const check = checkResumeOutline(
      validOutline({
        coursework: ['Advanced Machine Learning'],
        skills: [{ label: 'Languages', items: ['python', 'rust'] }, ...validPlan().skills.slice(1)],
      }),
      context(),
    );
    expect(check.issues.map((i) => i.rule)).toContain('coursework-off-pool');
    expect(check.issues.map((i) => i.rule)).toContain('skills-unsupported');
    expect(check.outline.coursework).toHaveLength(COURSEWORK_SLOTS.min);
  });
});

describe('checkResumePlan — clean plan', () => {
  it('passes an in-band plan untouched', () => {
    const check = checkResumePlan(validPlan(), context());
    expect(check.issues).toEqual([]);
    expect(check.repairs).toEqual([]);
    expect(check.plan.roles.map((r) => [r.roleId, r.bullets.length])).toEqual(
      RESUME_ROLES.map((r) => [r.id, r.bullets]),
    );
  });
});

describe('checkResumePlan — coursework', () => {
  it('canonicalizes to the pool wording, "and" and case included', () => {
    const check = checkResumePlan(
      validPlan({ coursework: ['data structures and algorithms', 'DISTRIBUTED SYSTEMS'] }),
      context(),
    );
    expect(check.plan.coursework.slice(0, 2)).toEqual([
      'Data Structures & Algorithms',
      'Distributed Systems',
    ]);
  });

  it('drops an invented course instead of re-prompting for it', () => {
    const check = checkResumePlan(
      validPlan({ coursework: [...POOL.slice(0, 3), 'Advanced Machine Learning'] }),
      context(),
    );
    expect(rules(check)).toContain('coursework-off-pool');
    expect(check.plan.coursework).not.toContain('Advanced Machine Learning');
    expect(errors(check)).toEqual([]);
    expect(check.repairs).toHaveLength(1);
  });

  it('tops a short line up in pool order and trims a long one', () => {
    const short = checkResumePlan(validPlan({ coursework: [POOL[0]] }), context());
    expect(short.plan.coursework).toHaveLength(COURSEWORK_SLOTS.min);
    expect(short.plan.coursework[0]).toBe(POOL[0]);
    expect(rules(short)).toContain('coursework-count');

    const long = checkResumePlan(validPlan({ coursework: POOL }), context());
    expect(long.plan.coursework).toHaveLength(COURSEWORK_SLOTS.max);
    expect(rules(long)).toContain('coursework-count');
  });

  it('de-duplicates a course the model listed twice', () => {
    const check = checkResumePlan(
      validPlan({ coursework: [POOL[0], POOL[0], POOL[1]] }),
      context(),
    );
    expect(check.plan.coursework.filter((c) => c === POOL[0])).toHaveLength(1);
  });
});

describe('checkResumePlan — roles', () => {
  it('drops an unknown slug and re-prompts for the role it left empty', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      { ...plan, roles: [plan.roles[0], { roleId: 'google', bullets: [bulletOf(MID)] }] },
      context(),
    );
    expect(rules(check)).toContain('role-unknown');
    const missing = errors(check).filter((i) => i.rule === 'role-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].retryable).toBe(true);
    expect(missing[0].message).toContain(RESUME_ROLES[1].employer);
  });

  it('keeps the first of two entries for the same role', () => {
    const plan = validPlan();
    const second = { roleId: RESUME_ROLES[0].id, bullets: [bulletOf(MID, 'Rewrote')] };
    const check = checkResumePlan({ ...plan, roles: [...plan.roles, second] }, context());
    expect(rules(check)).toContain('role-duplicate');
    expect(check.plan.roles[0].bullets).toEqual(plan.roles[0].bullets);
  });

  it('matches a slug the model capitalized or padded', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      { ...plan, roles: plan.roles.map((r) => ({ ...r, roleId: ` ${r.roleId.toUpperCase()} ` })) },
      context(),
    );
    expect(check.issues).toEqual([]);
  });

  it('trims extra bullets from the tail rather than asking again', () => {
    const plan = validPlan();
    const extra = [...plan.roles[0].bullets, bulletOf(MID, 'Owned')];
    const check = checkResumePlan(
      { ...plan, roles: [{ roleId: RESUME_ROLES[0].id, bullets: extra }, plan.roles[1]] },
      context(),
    );
    expect(rules(check)).toContain('role-bullet-count');
    expect(errors(check)).toEqual([]);
    expect(check.plan.roles[0].bullets).toEqual(plan.roles[0].bullets);
  });

  it('re-prompts when a role is short of the layout budget', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        roles: [
          { roleId: RESUME_ROLES[0].id, bullets: plan.roles[0].bullets.slice(0, 2) },
          plan.roles[1],
        ],
      },
      context(),
    );
    const issue = errors(check).find((i) => i.rule === 'role-bullet-count');
    expect(issue?.retryable).toBe(true);
    expect(issue?.message).toContain(`holds ${RESUME_ROLES[0].bullets}`);
  });
});

describe('checkResumePlan — project and skills', () => {
  it('trims an over-long project and re-prompts a short one', () => {
    const plan = validPlan();
    const over = checkResumePlan(
      { ...plan, project: { ...plan.project, bullets: [...plan.project.bullets, bulletOf(180)] } },
      context(),
    );
    expect(rules(over)).toContain('project-bullet-count');
    expect(errors(over)).toEqual([]);
    expect(over.plan.project.bullets).toHaveLength(BULLET_BUDGET.projects);

    const under = checkResumePlan(
      { ...plan, project: { ...plan.project, bullets: [plan.project.bullets[0]] } },
      context(),
    );
    expect(errors(under).map((i) => i.rule)).toContain('project-bullet-count');
  });

  it('drops a skill the master list cannot defend', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        skills: [{ label: 'Languages', items: ['python', 'rust'] }, ...plan.skills.slice(1)],
      },
      context(),
    );
    expect(rules(check)).toContain('skills-unsupported');
    expect(check.plan.skills[0].items).toEqual(['python']);
  });

  it('vouches for a skill the master list only contains loosely', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        skills: [{ label: 'Streaming', items: ['Apache Kafka'] }, ...plan.skills.slice(1)],
      },
      context(),
    );
    expect(rules(check)).not.toContain('skills-unsupported');
  });

  it('trusts every item when the corpus has no master skills yet', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      { ...plan, skills: [{ label: 'Anything', items: ['cobol'] }, ...plan.skills.slice(1)] },
      context({ masterSkills: [] }),
    );
    expect(rules(check)).not.toContain('skills-unsupported');
  });

  it('drops a row left empty by unsupported items, and a repeated label', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        skills: [
          ...plan.skills,
          { label: 'Ghosts', items: ['rust', 'elixir'] },
          { label: 'category 1', items: ['aws'] },
        ],
      },
      context(),
    );
    expect(rules(check)).toContain('skills-empty-row');
    expect(rules(check)).toContain('skills-duplicate-label');
    expect(check.plan.skills).toHaveLength(SKILL_ROW_RANGE.min);
  });

  it('keeps the layout row count: trims above the max, re-prompts below the min', () => {
    const plan = validPlan();
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `Row ${i + 1}`, items: ['python'] }));

    const over = checkResumePlan({ ...plan, skills: rows(SKILL_ROW_RANGE.max + 2) }, context());
    expect(over.plan.skills).toHaveLength(SKILL_ROW_RANGE.max);
    expect(errors(over)).toEqual([]);

    const under = checkResumePlan({ ...plan, skills: rows(SKILL_ROW_RANGE.min - 1) }, context());
    expect(errors(under).map((i) => i.rule)).toContain('skills-row-count');
  });
});

describe('checkResumePlan — bullet footprint', () => {
  it('re-prompts on a bullet that would wrap to a third line', () => {
    const plan = validPlan();
    const tooLong = bulletOf(BULLET_CHARS.max + 30);
    const check = checkResumePlan(
      {
        ...plan,
        roles: [
          { roleId: RESUME_ROLES[0].id, bullets: [tooLong, ...plan.roles[0].bullets.slice(1)] },
          plan.roles[1],
        ],
      },
      context(),
    );
    const issue = errors(check).find((i) => i.rule === 'bullet-too-long');
    expect(issue?.retryable).toBe(true);
    expect(issue?.message).toContain(`${RESUME_ROLES[0].id} bullet 1`);
    expect(issue?.message).toContain(String(BULLET_CHARS.max + 30));
  });

  it('reports a thin bullet without spending a retry on it', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        roles: [
          {
            roleId: RESUME_ROLES[0].id,
            bullets: [bulletOf(90), ...plan.roles[0].bullets.slice(1)],
          },
          plan.roles[1],
        ],
      },
      context(),
    );
    const issue = check.issues.find((i) => i.rule === 'bullet-too-short');
    expect(issue?.severity).toBe('warn');
    expect(issue?.retryable).toBe(false);
    // Not a repair: nothing was changed, so it does not belong in that list.
    expect(check.repairs).toEqual([]);
    expect(errors(check)).toEqual([]);
  });

  it('measures what the reader sees, not the markup the model sent', () => {
    // Raw length inside the band, but only because of commands the renderer
    // strips anyway — the words themselves are 40 characters short of it.
    const padded = `\\textbf{${bulletOf(BULLET_CHARS.min - 40)}}\\hspace{4pt}\\vspace{2pt}\\raggedright{}`;
    expect(padded.length).toBeGreaterThan(BULLET_CHARS.min);
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        roles: [
          { roleId: RESUME_ROLES[0].id, bullets: [padded, ...plan.roles[0].bullets.slice(1)] },
          plan.roles[1],
        ],
      },
      context(),
    );
    expect(rules(check)).toContain('bullet-too-short');
    expect(rules(check)).not.toContain('bullet-too-long');
  });

  it('holds the project to its own lower floor', () => {
    const short = bulletOf(PROJECT_BULLET_CHARS.min + 5);
    expect(short.length).toBeLessThan(BULLET_CHARS.min);
    const plan = validPlan();
    const check = checkResumePlan(
      { ...plan, project: { ...plan.project, bullets: [short, plan.project.bullets[1]] } },
      context(),
    );
    expect(rules(check)).not.toContain('bullet-too-short');
  });
});

describe('checkResumePlan — must-have keywords', () => {
  const withKeyword = (text: string) => {
    const plan = validPlan();
    return {
      ...plan,
      roles: [
        { roleId: RESUME_ROLES[0].id, bullets: [text, ...plan.roles[0].bullets.slice(1)] },
        plan.roles[1],
      ],
    };
  };

  it('passes when the keyword is demonstrated in a bullet', () => {
    const bullet = `Engineered a Kafka pipeline${bulletOf(MID - 27).slice(10)}`;
    const check = checkResumePlan(withKeyword(bullet), context({ mustHaveKeywords: ['kafka'] }));
    expect(rules(check)).not.toContain('keyword-missing');
  });

  it('re-prompts for a corpus-backed keyword that never landed', () => {
    const check = checkResumePlan(
      validPlan(),
      context({ mustHaveKeywords: ['kafka', 'kubernetes'] }),
    );
    const issue = errors(check).find((i) => i.rule === 'keyword-missing');
    expect(issue?.retryable).toBe(true);
    expect(issue?.message).toContain('kafka');
    expect(issue?.message).toContain('kubernetes');
  });

  it('accepts a keyword that landed only in a skills row', () => {
    const plan = validPlan();
    const check = checkResumePlan(
      {
        ...plan,
        skills: [{ label: 'Streaming', items: ['kafka'] }, ...plan.skills.slice(1)],
      },
      context({ mustHaveKeywords: ['kafka'] }),
    );
    expect(rules(check)).not.toContain('keyword-missing');
  });

  it('does not credit a keyword found inside a longer word', () => {
    const check = checkResumePlan(
      withKeyword(`Engineered a category service${bulletOf(MID - 29).slice(10)}`),
      context({ mustHaveKeywords: ['go'] }),
    );
    expect(rules(check)).toContain('keyword-missing');
  });
});

describe('buildPlanCoverage', () => {
  it('reports every slot a keyword genuinely reached', () => {
    const plan = validPlan({
      coursework: ['Distributed Systems'],
      skills: [{ label: 'Streaming', items: ['kafka'] }],
    });
    const withKafka = {
      ...plan,
      roles: [
        { roleId: RESUME_ROLES[0].id, bullets: ['Engineered a Kafka pipeline for payouts.'] },
        plan.roles[1],
      ],
    };
    const [kafka, systems] = buildPlanCoverage(withKafka, ['Kafka', 'distributed systems']);
    expect(kafka.slots).toEqual([
      { kind: 'role', roleId: RESUME_ROLES[0].id, bulletIndex: 0 },
      { kind: 'skills', label: 'Streaming' },
    ]);
    expect(systems.slots).toEqual([{ kind: 'coursework' }]);
  });

  it('does not count the project stack line as a demonstration', () => {
    const plan = validPlan({ project: { stack: 'Inngest, pgvector', bullets: [bulletOf(150)] } });
    const [only] = buildPlanCoverage(plan, ['pgvector']);
    expect(only.slots).toEqual([]);
  });

  it('reports a keyword once, however often it was asked for', () => {
    const coverage = buildPlanCoverage(validPlan(), ['python', 'PYTHON', ' python ', '']);
    expect(coverage.map((c) => c.keyword)).toEqual(['python']);
  });
});

describe('describeSlot', () => {
  it('names each slot the way a human would read it', () => {
    expect(describeSlot({ kind: 'role', roleId: RESUME_ROLES[0].id, bulletIndex: 2 })).toBe(
      `${RESUME_ROLES[0].employer} bullet 3`,
    );
    expect(describeSlot({ kind: 'role', roleId: 'unknown', bulletIndex: 0 })).toBe(
      'unknown bullet 1',
    );
    expect(describeSlot({ kind: 'project', bulletIndex: 1 })).toBe('project bullet 2');
    expect(describeSlot({ kind: 'skills', label: 'Networking' })).toBe('skills: Networking');
    expect(describeSlot({ kind: 'coursework' })).toBe('coursework');
    expect(describeSlot({ kind: 'none', reason: 'no real evidence' })).toBe('no real evidence');
    expect(describeSlot({ kind: 'none', reason: '' })).toBe('not placed');
  });
});
