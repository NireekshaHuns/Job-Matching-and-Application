/**
 * The master-inventory file format + a pure parser/validator. This is the
 * truthful source the tailoring engine is bounded by: a superset of skills, a
 * bank of real accomplishment bullets, and base resumes (LaTeX) per role family.
 */
import { z } from 'zod';
import { roleFamilyEnum, skillKindEnum } from '@/server/db/schema';
import type { RoleFamily } from '@/server/enrich/types';

const skillSchema = z.object({
  skill: z.string().min(1),
  kind: z.enum(skillKindEnum.enumValues),
});

const bulletSchema = z.object({
  text: z.string().min(1),
  skills: z.array(z.string()).default([]),
  roleFamily: z.enum(roleFamilyEnum.enumValues).optional(),
  company: z.string().optional(),
});

const baseResumeSchema = z.object({
  label: z.string().min(1),
  roleFamily: z.enum(roleFamilyEnum.enumValues).optional(),
  content: z.string().min(1),
});

const inventorySchema = z
  .object({
    // Whitelisted so `.strict()` below still allows a template comment.
    _comment: z.string().optional(),
    skills: z.array(skillSchema).default([]),
    bullets: z.array(bulletSchema).default([]),
    baseResumes: z.array(baseResumeSchema).default([]),
  })
  // Strict so a misspelled section (e.g. "bulets") fails loudly instead of
  // silently loading nothing.
  .strict();

export interface InventorySkill {
  skill: string;
  kind: (typeof skillKindEnum.enumValues)[number];
}
export interface InventoryBullet {
  text: string;
  skills: string[];
  roleFamily: RoleFamily | null;
  company: string | null;
}
export interface InventoryBaseResume {
  label: string;
  roleFamily: RoleFamily | null;
  content: string;
}
export interface Inventory {
  skills: InventorySkill[];
  bullets: InventoryBullet[];
  baseResumes: InventoryBaseResume[];
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * Validate and normalize a raw (already JSON-parsed) inventory. Skills are
 * lowercased and de-duplicated (last kind wins) so they match JD keywords.
 */
export function parseInventory(raw: unknown): Inventory {
  const parsed = inventorySchema.parse(raw);

  const skillMap = new Map<string, InventorySkill>();
  for (const s of parsed.skills) {
    const skill = s.skill.trim().toLowerCase();
    // Last kind wins if a skill is listed twice.
    if (skill) skillMap.set(skill, { skill, kind: s.kind });
  }

  const bullets = parsed.bullets.map((b) => ({
    text: b.text.trim(),
    skills: normalizeTags(b.skills),
    roleFamily: b.roleFamily ?? null,
    company: b.company?.trim() || null,
  }));

  // Truthfulness invariant: every bullet tag must be a known master skill, so
  // tailoring can never surface a keyword the user hasn't declared.
  const unknown = new Set<string>();
  for (const b of bullets) {
    for (const tag of b.skills) if (!skillMap.has(tag)) unknown.add(tag);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Bullet tags not in master skills: ${[...unknown].join(', ')}. ` +
        'Add them to skills[] or remove the tag.',
    );
  }

  return {
    skills: [...skillMap.values()],
    bullets,
    baseResumes: parsed.baseResumes.map((r) => ({
      label: r.label.trim(),
      roleFamily: r.roleFamily ?? null,
      // content is intentionally not trimmed — leading LaTeX whitespace matters.
      content: r.content,
    })),
  };
}
