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

const inventorySchema = z.object({
  skills: z.array(skillSchema).default([]),
  bullets: z.array(bulletSchema).default([]),
  baseResumes: z.array(baseResumeSchema).default([]),
});

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
    if (skill) skillMap.set(skill, { skill, kind: s.kind });
  }

  return {
    skills: [...skillMap.values()],
    bullets: parsed.bullets.map((b) => ({
      text: b.text.trim(),
      skills: normalizeTags(b.skills),
      roleFamily: b.roleFamily ?? null,
      company: b.company?.trim() || null,
    })),
    baseResumes: parsed.baseResumes.map((r) => ({
      label: r.label.trim(),
      roleFamily: r.roleFamily ?? null,
      content: r.content,
    })),
  };
}
