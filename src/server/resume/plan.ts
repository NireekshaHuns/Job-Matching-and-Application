/**
 * The shape a generated résumé is allowed to take.
 *
 * The tailoring model returns one of these — never LaTeX. Everything it could
 * previously get wrong by rewriting the document (a different preamble, an
 * invented Certifications section, a fabricated degree, employers in the wrong
 * order) has no field here to express, so those failures stop being things the
 * linter has to catch after the fact.
 *
 * Pure: schema, parsing, and the deterministic repairs. `render.ts` turns a
 * checked plan into the document; `tailor.ts` owns the LLM loop.
 */
import { z } from 'zod';
import { containsKeyword } from './quality';
import { COURSEWORK_SLOTS, RESUME_ROLES } from './template';

/** A model-supplied string: prose, sanitized and escaped at render time. */
const planText = (max: number) => z.string().trim().min(1).max(max);

export const skillRowSchema = z.object({
  /** Model-chosen, mirroring the posting's own category language. */
  label: planText(40),
  items: z.array(planText(60)).min(1).max(12),
});

export const placementSlotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('role'),
    roleId: z.string().trim().min(1),
    bulletIndex: z.number().int().min(0).max(20),
  }),
  z.object({ kind: z.literal('project'), bulletIndex: z.number().int().min(0).max(20) }),
  z.object({ kind: z.literal('skills'), label: z.string().trim().min(1) }),
  z.object({ kind: z.literal('coursework') }),
  z.object({ kind: z.literal('none'), reason: z.string().trim().max(200).default('') }),
]);

export type PlacementSlot = z.infer<typeof placementSlotSchema>;

export const placementSchema = z.object({
  keyword: z.string().trim().min(1),
  slot: placementSlotSchema,
});

export type Placement = z.infer<typeof placementSchema>;

/**
 * Bounds here are deliberately GENEROUS. Exactness lives in `checkResumePlan`,
 * because a schema rejection throws away a whole attempt and hands the model a
 * useless error ("expected 4, got 5"), while a repair costs nothing.
 */
export const resumePlanSchema = z
  .object({
    /** Selected and ordered from the profile's pool. Never invented. */
    coursework: z.array(planText(120)).max(8).default([]),
    roles: z
      .array(
        z.object({
          roleId: z.string().trim().min(1),
          bullets: z.array(planText(400)).min(1).max(9),
        }),
      )
      .min(1),
    project: z.object({
      /** The italic stack line after the project name. */
      stack: planText(160),
      bullets: z.array(planText(400)).min(1).max(4),
    }),
    skills: z.array(skillRowSchema).min(1).max(8),
    /** The model's intent, kept only to make a retry message specific. */
    placements: z.array(placementSchema).default([]),
    /** Tolerated so a chatty model doesn't fail `.strict()` over a note. */
    _comment: z.string().optional(),
  })
  // `.strict()` on purpose. The bug this design exists to fix included an
  // invented `\section{Certifications}`; as an unknown key that is now a loud
  // parse failure with a precise retry message, rather than something silently
  // ignored and then attempted again in prose.
  .strict();

export type ResumePlan = z.infer<typeof resumePlanSchema>;

/** First balanced-looking JSON object in the response, fences and prose tolerated. */
function firstJsonObject(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in resume-plan output');
  return match[0];
}

/**
 * Parse a raw model response into a plan.
 *
 * Throws on anything unparseable — unlike the keyword analysis, there is no
 * partial plan worth keeping, and the caller re-prompts with the error.
 */
export function parseResumePlan(raw: string): ResumePlan {
  return resumePlanSchema.parse(JSON.parse(firstJsonObject(raw)));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PlanIssue {
  rule: string;
  severity: 'error' | 'warn';
  /**
   * True when only a fresh generation can fix it. False means it was repaired
   * in place and is reported for transparency, not re-prompted on.
   */
  retryable: boolean;
  message: string;
}

export interface PlanCheck {
  /** The repaired plan. Always renderable. */
  plan: ResumePlan;
  issues: PlanIssue[];
  /** Human-readable list of what was silently fixed. */
  repairs: string[];
}

export interface PlanContext {
  /** The profile's real coursework pool. */
  coursePool: readonly string[];
  /** The truthful skill superset a skills row may draw on. */
  masterSkills: readonly string[];
  /**
   * Keywords that MUST land in the document, already filtered to the ones the
   * corpus can back. Gating on unsupported keywords would re-prompt the model
   * to claim a skill it cannot defend — see `rubric.ts`'s OR-requirement rule.
   */
  mustHaveKeywords: readonly string[];
}

/** Skills-row rows that fit the one-page layout. */
export const SKILL_ROW_RANGE = { min: 4, max: 6 } as const;

function normalizeCourse(s: string): string {
  return s
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
}

/**
 * Loose containment, matching `coverage.ts`: master skills are stored as the
 * owner typed them, so "Apache Kafka" should still vouch for "Kafka".
 */
function skillSupported(known: readonly string[], item: string): boolean {
  const n = item.trim().toLowerCase();
  if (!n) return false;
  return known.some((k) => k === n || k.includes(n) || n.includes(k));
}

/**
 * Repair what can be repaired, report what cannot.
 *
 * The split matters: a coursework entry outside the pool can simply be dropped,
 * so re-prompting for it would spend an API call on something arithmetic could
 * fix. A role missing all its bullets cannot be invented, so that one has to go
 * back to the model.
 */
export function checkResumePlan(plan: ResumePlan, ctx: PlanContext): PlanCheck {
  const issues: PlanIssue[] = [];
  const repairs: string[] = [];

  const repair = (rule: string, message: string) => {
    issues.push({ rule, severity: 'warn', retryable: false, message });
    repairs.push(message);
  };
  const retry = (rule: string, message: string) =>
    issues.push({ rule, severity: 'error', retryable: true, message });

  // --- coursework: canonicalize to the pool, top up, never retry ------------
  const poolByNormal = new Map(ctx.coursePool.map((c) => [normalizeCourse(c), c]));
  const coursework: string[] = [];
  for (const raw of plan.coursework) {
    const canonical = poolByNormal.get(normalizeCourse(raw));
    if (!canonical) {
      repair('coursework-off-pool', `Dropped "${raw}" — not in the coursework pool.`);
      continue;
    }
    if (!coursework.includes(canonical)) coursework.push(canonical);
  }
  if (coursework.length > COURSEWORK_SLOTS.max) {
    repair(
      'coursework-count',
      `Kept the first ${COURSEWORK_SLOTS.max} of ${coursework.length} courses.`,
    );
    coursework.length = COURSEWORK_SLOTS.max;
  }
  if (coursework.length < COURSEWORK_SLOTS.min) {
    // Deterministic top-up in pool order, so the line is never short or empty.
    for (const c of ctx.coursePool) {
      if (coursework.length >= COURSEWORK_SLOTS.min) break;
      if (!coursework.includes(c)) coursework.push(c);
    }
    if (plan.coursework.length < COURSEWORK_SLOTS.min) {
      repair('coursework-count', `Topped the coursework line up to ${coursework.length}.`);
    }
  }

  // --- roles: budget-exact, keyed by slug ----------------------------------
  const known = new Set<string>(RESUME_ROLES.map((r) => r.id));
  const byRole = new Map<string, string[]>();
  for (const entry of plan.roles) {
    const id = entry.roleId.trim().toLowerCase();
    if (!known.has(id)) {
      repair('role-unknown', `Dropped bullets for unknown role "${entry.roleId}".`);
      continue;
    }
    // A duplicated slug means the model wrote the role twice; keep the first.
    if (byRole.has(id)) {
      repair('role-duplicate', `Ignored a second set of bullets for "${id}".`);
      continue;
    }
    byRole.set(id, entry.bullets);
  }

  const roles: ResumePlan['roles'] = [];
  for (const role of RESUME_ROLES) {
    const bullets = byRole.get(role.id);
    if (!bullets || bullets.length === 0) {
      retry('role-missing', `No bullets for ${role.employer} (roleId "${role.id}").`);
      roles.push({ roleId: role.id, bullets: [] });
      continue;
    }
    if (bullets.length > role.bullets) {
      // Models write strongest-first, so the tail is the right thing to cut —
      // and the rubric already says to cut the weakest, not shorten them.
      repair(
        'role-bullet-count',
        `Trimmed ${role.id} from ${bullets.length} to ${role.bullets} bullets.`,
      );
    } else if (bullets.length < role.bullets) {
      retry(
        'role-bullet-count',
        `${role.id} has ${bullets.length} bullets; the layout holds ${role.bullets}.`,
      );
    }
    roles.push({ roleId: role.id, bullets: bullets.slice(0, role.bullets) });
  }

  // --- project -------------------------------------------------------------
  const projectBudget = 2;
  if (plan.project.bullets.length > projectBudget) {
    repair('project-bullet-count', `Trimmed the project to ${projectBudget} bullets.`);
  } else if (plan.project.bullets.length < projectBudget) {
    retry(
      'project-bullet-count',
      `The project has ${plan.project.bullets.length} bullets; the layout holds ${projectBudget}.`,
    );
  }
  const project = {
    stack: plan.project.stack,
    bullets: plan.project.bullets.slice(0, projectBudget),
  };

  // --- skills: every item must be defensible -------------------------------
  const skills: ResumePlan['skills'] = [];
  const seenLabels = new Set<string>();
  for (const row of plan.skills) {
    const label = row.label.trim();
    const key = label.toLowerCase();
    if (seenLabels.has(key)) {
      repair('skills-duplicate-label', `Dropped a second "${label}" row.`);
      continue;
    }
    const items = row.items.filter((item) => {
      // An empty master list means "we don't know your skills yet", not "you
      // have none" — flagging everything would make a fresh corpus unusable.
      if (ctx.masterSkills.length === 0) return true;
      if (skillSupported(ctx.masterSkills, item)) return true;
      repair('skills-unsupported', `Dropped "${item}" from ${label} — not in your master skills.`);
      return false;
    });
    if (items.length === 0) {
      repair('skills-empty-row', `Dropped the "${label}" row — nothing in it was supported.`);
      continue;
    }
    seenLabels.add(key);
    skills.push({ label, items });
  }
  if (skills.length > SKILL_ROW_RANGE.max) {
    repair(
      'skills-row-count',
      `Kept the first ${SKILL_ROW_RANGE.max} of ${skills.length} skills rows.`,
    );
    skills.length = SKILL_ROW_RANGE.max;
  } else if (skills.length < SKILL_ROW_RANGE.min) {
    retry(
      'skills-row-count',
      `Only ${skills.length} skills rows; the layout wants ${SKILL_ROW_RANGE.min}-${SKILL_ROW_RANGE.max}.`,
    );
  }

  return {
    plan: { coursework, roles, project, skills, placements: plan.placements },
    issues,
    repairs,
  };
}

// ---------------------------------------------------------------------------
// Coverage, read off the plan's structure
// ---------------------------------------------------------------------------

export interface PlanPlacement {
  keyword: string;
  /** Every slot the keyword actually appears in. Empty when it never landed. */
  slots: PlacementSlot[];
}

/** A slot rendered for a human: "LSEG bullet 3", "skills: Networking & Linux". */
export function describeSlot(slot: PlacementSlot): string {
  switch (slot.kind) {
    case 'role': {
      const role = RESUME_ROLES.find((r) => r.id === slot.roleId);
      return `${role?.employer ?? slot.roleId} bullet ${slot.bulletIndex + 1}`;
    }
    case 'project':
      return `project bullet ${slot.bulletIndex + 1}`;
    case 'skills':
      return `skills: ${slot.label}`;
    case 'coursework':
      return 'coursework';
    case 'none':
      return slot.reason || 'not placed';
  }
}

/**
 * Where each keyword genuinely ended up, walked out of the plan rather than
 * taken from `plan.placements`.
 *
 * The model's own placement list is what it intended; this is what it did. The
 * distinction is the same one `coverage.ts` makes, and for the same reason — a
 * model asked to grade itself reports success. Reading the structure also gives
 * the exact bullet rather than "EXPERIENCE".
 */
export function buildPlanCoverage(plan: ResumePlan, keywords: readonly string[]): PlanPlacement[] {
  const haystacks: { slot: PlacementSlot; text: string }[] = [];

  for (const role of plan.roles) {
    role.bullets.forEach((text, bulletIndex) =>
      haystacks.push({ slot: { kind: 'role', roleId: role.roleId, bulletIndex }, text }),
    );
  }
  plan.project.bullets.forEach((text, bulletIndex) =>
    haystacks.push({ slot: { kind: 'project', bulletIndex }, text }),
  );
  // The project's stack line is deliberately NOT a haystack: a keyword that
  // appears only there is listed, not demonstrated, which is the same call
  // `coverage.ts` makes about the skills section.
  for (const row of plan.skills) {
    haystacks.push({ slot: { kind: 'skills', label: row.label }, text: row.items.join(', ') });
  }
  haystacks.push({ slot: { kind: 'coursework' }, text: plan.coursework.join(', ') });

  const out: PlanPlacement[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    const slots = haystacks
      .filter((h) => containsKeyword(h.text.toLowerCase(), needle))
      .map((h) => h.slot);
    out.push({ keyword, slots });
  }
  return out;
}
