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
import { BULLET_CHARS, PROJECT_BULLET_CHARS } from './rubric';
import { BULLET_BUDGET, COURSEWORK_SLOTS, RESUME_ROLES, stripPlanMarkup } from './template';

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
 * The plan is generated in two stages, so the shape is defined in two halves.
 *
 * Stage A is the OUTLINE — where each keyword will live, which courses to show,
 * and what the skills rows are called. It is cheap, it is the part worth a
 * human's judgement, and the owner approves it before a word of prose exists.
 * Stage B writes only the bullets, against an outline that is already settled,
 * and is the only stage retried — so an approved outline is never silently
 * rewritten by a retry.
 *
 * Bounds here are deliberately GENEROUS. Exactness lives in the checkers, because
 * a schema rejection throws away a whole attempt and hands the model a useless
 * error ("expected 4, got 5"), while a repair costs nothing.
 */
const outlineShape = {
  /** Selected and ordered from the profile's pool. Never invented. */
  coursework: z.array(planText(120)).max(8).default([]),
  skills: z.array(skillRowSchema).min(1).max(8),
  /** Where each keyword is meant to land. In stage A this is the whole point. */
  placements: z.array(placementSchema).default([]),
} as const;

const bulletsShape = {
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
} as const;

/** Tolerated so a chatty model doesn't fail `.strict()` over a note. */
const comment = { _comment: z.string().optional() } as const;

// `.strict()` on purpose, on all three. The bug this design exists to fix
// included an invented `\section{Certifications}`; as an unknown key that is now
// a loud parse failure with a precise retry message, rather than something
// silently ignored and then attempted again in prose.
export const resumeOutlineSchema = z.object({ ...outlineShape, ...comment }).strict();
export const bulletsPlanSchema = z.object({ ...bulletsShape, ...comment }).strict();
export const resumePlanSchema = z.object({ ...outlineShape, ...bulletsShape, ...comment }).strict();

export type ResumeOutline = z.infer<typeof resumeOutlineSchema>;
export type BulletsPlan = z.infer<typeof bulletsPlanSchema>;
export type ResumePlan = z.infer<typeof resumePlanSchema>;

/** First balanced-looking JSON object in the response, fences and prose tolerated. */
function firstJsonObject(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in resume-plan output');
  return match[0];
}

/**
 * Parse a raw stage-A response into an outline.
 *
 * Throws on anything unparseable — there is no partial outline worth keeping,
 * and the caller re-prompts with the error.
 */
export function parseResumeOutline(raw: string): ResumeOutline {
  return resumeOutlineSchema.parse(JSON.parse(firstJsonObject(raw)));
}

/** Parse a raw stage-B response into the bullets half of a plan. */
export function parseBulletsPlan(raw: string): BulletsPlan {
  return bulletsPlanSchema.parse(JSON.parse(firstJsonObject(raw)));
}

/**
 * Join an APPROVED outline to freshly written bullets.
 *
 * The outline wins every field it owns. Stage B is asked for prose and nothing
 * else, so a model that answers with a coursework line as well has that part
 * ignored rather than quietly overriding what the owner signed off on.
 */
export function mergeOutline(outline: ResumeOutline, bullets: BulletsPlan): ResumePlan {
  return {
    coursework: outline.coursework,
    skills: outline.skills,
    placements: outline.placements,
    roles: bullets.roles,
    project: bullets.project,
  };
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
 * Printed length of a bullet: what the reader sees, not what the model sent.
 * Markup is stripped because the renderer strips it too — a bullet padded to the
 * band with `\textbf{}` wrappers is a short bullet, and the band is a proxy for
 * how much of the line the words fill.
 */
function bulletLength(text: string): number {
  return stripPlanMarkup(text).length;
}

/**
 * Repair what can be repaired, report what cannot.
 *
 * The split matters: a coursework entry outside the pool can simply be dropped,
 * so re-prompting for it would spend an API call on something arithmetic could
 * fix. A role missing all its bullets cannot be invented, so that one has to go
 * back to the model.
 */
/**
 * How a checker reports. Three verbs, because the difference between them is the
 * whole design: `repair` already fixed it, `retry` needs another generation, and
 * `note` is worth reading but worth nothing to re-prompt on.
 */
interface Reporter {
  repair: (rule: string, message: string) => void;
  retry: (rule: string, message: string) => void;
  note: (rule: string, message: string) => void;
}

function reporter(issues: PlanIssue[], repairs: string[]): Reporter {
  return {
    repair: (rule, message) => {
      issues.push({ rule, severity: 'warn', retryable: false, message });
      repairs.push(message);
    },
    retry: (rule, message) => issues.push({ rule, severity: 'error', retryable: true, message }),
    note: (rule, message) => issues.push({ rule, severity: 'warn', retryable: false, message }),
  };
}

/**
 * Coursework: canonicalize to the pool, top up, never retry.
 *
 * An entry outside the pool can simply be dropped, so re-prompting for it would
 * spend an API call on something arithmetic could fix.
 */
function checkCoursework(raw: readonly string[], ctx: PlanContext, r: Reporter): string[] {
  const poolByNormal = new Map(ctx.coursePool.map((c) => [normalizeCourse(c), c]));
  const coursework: string[] = [];
  for (const entry of raw) {
    const canonical = poolByNormal.get(normalizeCourse(entry));
    if (!canonical) {
      r.repair('coursework-off-pool', `Dropped "${entry}" — not in the coursework pool.`);
      continue;
    }
    if (!coursework.includes(canonical)) coursework.push(canonical);
  }
  if (coursework.length > COURSEWORK_SLOTS.max) {
    r.repair(
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
    if (raw.length < COURSEWORK_SLOTS.min) {
      r.repair('coursework-count', `Topped the coursework line up to ${coursework.length}.`);
    }
  }
  return coursework;
}

/** Skills: every item defensible, labels unique, row count inside the layout. */
function checkSkills(
  rows: ResumePlan['skills'],
  ctx: PlanContext,
  r: Reporter,
): ResumePlan['skills'] {
  const skills: ResumePlan['skills'] = [];
  const seenLabels = new Set<string>();
  for (const row of rows) {
    const label = row.label.trim();
    const key = label.toLowerCase();
    if (seenLabels.has(key)) {
      r.repair('skills-duplicate-label', `Dropped a second "${label}" row.`);
      continue;
    }
    const items = row.items.filter((item) => {
      // An empty master list means "we don't know your skills yet", not "you
      // have none" — flagging everything would make a fresh corpus unusable.
      if (ctx.masterSkills.length === 0) return true;
      if (skillSupported(ctx.masterSkills, item)) return true;
      r.repair(
        'skills-unsupported',
        `Dropped "${item}" from ${label} — not in your master skills.`,
      );
      return false;
    });
    if (items.length === 0) {
      r.repair('skills-empty-row', `Dropped the "${label}" row — nothing in it was supported.`);
      continue;
    }
    seenLabels.add(key);
    skills.push({ label, items });
  }
  if (skills.length > SKILL_ROW_RANGE.max) {
    r.repair(
      'skills-row-count',
      `Kept the first ${SKILL_ROW_RANGE.max} of ${skills.length} skills rows.`,
    );
    skills.length = SKILL_ROW_RANGE.max;
  } else if (skills.length < SKILL_ROW_RANGE.min) {
    r.retry(
      'skills-row-count',
      `Only ${skills.length} skills rows; the layout wants ${SKILL_ROW_RANGE.min}-${SKILL_ROW_RANGE.max}.`,
    );
  }
  return skills;
}

/**
 * Placements: a slot that actually exists, and an intended home for every
 * must-have keyword.
 *
 * This is stage A's real gate. It checks INTENT, not the document — the bullets
 * do not exist yet — so a keyword whose slot is `none` fails here even though
 * nothing is written wrong. Catching it now is the point of the checkpoint: it
 * costs one cheap outline call instead of a full generation the owner then has
 * to reject.
 */
function checkPlacements(
  placements: readonly Placement[],
  skills: ResumePlan['skills'],
  ctx: PlanContext,
  r: Reporter,
): Placement[] {
  const rolesById = new Map<string, (typeof RESUME_ROLES)[number]>(
    RESUME_ROLES.map((role) => [role.id, role]),
  );
  const labels = new Set(skills.map((row) => row.label.toLowerCase()));
  const kept: Placement[] = [];

  for (const placement of placements) {
    const slot = placement.slot;
    if (slot.kind === 'role') {
      const role = rolesById.get(slot.roleId.trim().toLowerCase());
      if (!role) {
        r.repair(
          'placement-unknown-role',
          `Dropped the plan for "${placement.keyword}" — no role "${slot.roleId}".`,
        );
        continue;
      }
      // Clamped rather than dropped: "the last bullet of this job" is still the
      // intent the model expressed, and dropping it would lose the keyword.
      const last = role.bullets - 1;
      if (slot.bulletIndex > last) {
        r.repair(
          'placement-out-of-range',
          `Moved "${placement.keyword}" to ${role.id} bullet ${last + 1}; there is no bullet ${slot.bulletIndex + 1}.`,
        );
        kept.push({ ...placement, slot: { ...slot, roleId: role.id, bulletIndex: last } });
        continue;
      }
      kept.push({ ...placement, slot: { ...slot, roleId: role.id } });
      continue;
    }
    if (slot.kind === 'project' && slot.bulletIndex >= BULLET_BUDGET.projects) {
      const last = BULLET_BUDGET.projects - 1;
      r.repair(
        'placement-out-of-range',
        `Moved "${placement.keyword}" to project bullet ${last + 1}; there is no bullet ${slot.bulletIndex + 1}.`,
      );
      kept.push({ ...placement, slot: { ...slot, bulletIndex: last } });
      continue;
    }
    if (slot.kind === 'skills' && !labels.has(slot.label.trim().toLowerCase())) {
      r.repair(
        'placement-unknown-row',
        `Dropped the plan for "${placement.keyword}" — no skills row "${slot.label}".`,
      );
      continue;
    }
    kept.push(placement);
  }

  // `none` is an honest answer, not a home. A must-have keyword parked there has
  // nowhere to land, which is exactly what the owner needs to see before prose.
  const planned = new Set(
    kept.filter((p) => p.slot.kind !== 'none').map((p) => p.keyword.trim().toLowerCase()),
  );
  const unplanned = ctx.mustHaveKeywords.filter((k) => !planned.has(k.trim().toLowerCase()));
  if (unplanned.length > 0) {
    r.retry(
      'keyword-unplanned',
      `No home planned for: ${unplanned.join(', ')}. Give each one a bullet or a skills row.`,
    );
  }
  return kept;
}

export interface OutlineCheck {
  /** The repaired outline. Always approvable. */
  outline: ResumeOutline;
  issues: PlanIssue[];
  repairs: string[];
}

/**
 * Check a stage-A outline: the coursework selection, the skills rows, and the
 * keyword→slot map. No bullets exist yet, so nothing here measures prose.
 */
export function checkResumeOutline(outline: ResumeOutline, ctx: PlanContext): OutlineCheck {
  const issues: PlanIssue[] = [];
  const repairs: string[] = [];
  const r = reporter(issues, repairs);

  const coursework = checkCoursework(outline.coursework, ctx, r);
  const skills = checkSkills(outline.skills, ctx, r);
  const placements = checkPlacements(outline.placements, skills, ctx, r);

  return { outline: { coursework, skills, placements }, issues, repairs };
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
  const r = reporter(issues, repairs);

  // The outline half is normally already canonical — it came back through an
  // approved outline — so these are cheap no-ops that keep this function correct
  // on a plan from anywhere. Placements are deliberately NOT re-checked here:
  // stage A gated the intent, and the gate below reads what actually happened.
  const coursework = checkCoursework(plan.coursework, ctx, r);
  const skills = checkSkills(plan.skills, ctx, r);

  // --- roles: budget-exact, keyed by slug ----------------------------------
  const known = new Set<string>(RESUME_ROLES.map((role) => role.id));
  const byRole = new Map<string, string[]>();
  for (const entry of plan.roles) {
    const id = entry.roleId.trim().toLowerCase();
    if (!known.has(id)) {
      r.repair('role-unknown', `Dropped bullets for unknown role "${entry.roleId}".`);
      continue;
    }
    // A duplicated slug means the model wrote the role twice; keep the first.
    if (byRole.has(id)) {
      r.repair('role-duplicate', `Ignored a second set of bullets for "${id}".`);
      continue;
    }
    byRole.set(id, entry.bullets);
  }

  const roles: ResumePlan['roles'] = [];
  for (const role of RESUME_ROLES) {
    const bullets = byRole.get(role.id);
    if (!bullets || bullets.length === 0) {
      r.retry('role-missing', `No bullets for ${role.employer} (roleId "${role.id}").`);
      roles.push({ roleId: role.id, bullets: [] });
      continue;
    }
    if (bullets.length > role.bullets) {
      // Models write strongest-first, so the tail is the right thing to cut —
      // and the rubric already says to cut the weakest, not shorten them.
      r.repair(
        'role-bullet-count',
        `Trimmed ${role.id} from ${bullets.length} to ${role.bullets} bullets.`,
      );
    } else if (bullets.length < role.bullets) {
      r.retry(
        'role-bullet-count',
        `${role.id} has ${bullets.length} bullets; the layout holds ${role.bullets}.`,
      );
    }
    roles.push({ roleId: role.id, bullets: bullets.slice(0, role.bullets) });
  }

  // --- project -------------------------------------------------------------
  const projectBudget = BULLET_BUDGET.projects;
  if (plan.project.bullets.length > projectBudget) {
    r.repair('project-bullet-count', `Trimmed the project to ${projectBudget} bullets.`);
  } else if (plan.project.bullets.length < projectBudget) {
    r.retry(
      'project-bullet-count',
      `The project has ${plan.project.bullets.length} bullets; the layout holds ${projectBudget}.`,
    );
  }
  const project = {
    stack: plan.project.stack,
    bullets: plan.project.bullets.slice(0, projectBudget),
  };

  const checked: ResumePlan = { coursework, roles, project, skills, placements: plan.placements };

  // --- footprint: two full lines, never a third -----------------------------
  //
  // Asymmetric on purpose. Over the band the bullet wraps to a third line and
  // the page count is decided for us, so only the model can fix it — retry. Under
  // the band the bullet just reads thin, and it still fits, so it is reported and
  // not retried: a retry costs an API call, and the loop keeps the best attempt
  // anyway, so re-prompting over a short bullet risks losing a good one.
  const measured = [
    ...checked.roles.flatMap((role) =>
      role.bullets.map((text, i) => ({
        where: `${role.roleId} bullet ${i + 1}`,
        text,
        band: BULLET_CHARS,
      })),
    ),
    // The project's own floor is lower: the owner's real project bullets are
    // shorter than the job ones, and a project entry is not held to the same
    // footprint as a job.
    ...checked.project.bullets.map((text, i) => ({
      where: `project bullet ${i + 1}`,
      text,
      band: PROJECT_BULLET_CHARS,
    })),
  ];
  for (const m of measured) {
    const len = bulletLength(m.text);
    if (len > m.band.max) {
      r.retry(
        'bullet-too-long',
        `${m.where} is ${len} characters; ${m.band.max} is two full lines. Cut words, do not cut the achievement.`,
      );
    } else if (len < m.band.min) {
      r.note(
        'bullet-too-short',
        `${m.where} is ${len} characters; ${m.band.min}-${m.band.max} fills the second line. Add substance, not filler.`,
      );
    }
  }

  // --- keywords: every corpus-backed must-have has to actually land ---------
  //
  // The old check was a warning on a coverage RATIO, which a résumé could pass
  // while dropping the one keyword that mattered. Read off the plan's structure
  // instead (see `buildPlanCoverage`), and gate on it — safe only because
  // `mustHaveKeywords` arrives pre-filtered to what the corpus can defend.
  const unplaced = buildPlanCoverage(checked, ctx.mustHaveKeywords)
    .filter((p) => p.slots.length === 0)
    .map((p) => p.keyword);
  if (unplaced.length > 0) {
    r.retry(
      'keyword-missing',
      `Never placed: ${unplaced.join(', ')}. Work each one into a bullet where the experience is real, or into a skills row.`,
    );
  }

  return { plan: checked, issues, repairs };
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
