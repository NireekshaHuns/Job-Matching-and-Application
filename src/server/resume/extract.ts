/**
 * Draft a master inventory from a resume's text using the LLM. This produces a
 * DRAFT for the user to review — it never loads into the DB. Output is validated
 * and normalized through `parseInventory`, so the truthfulness invariant (bullet
 * tags ⊆ skills) still holds; the network call is behind an injected ChatClient.
 */
import { roleFamilyEnum } from '@/server/db/schema';
import type { ChatClient } from '@/server/enrich/types';
import { parseInventory, type Inventory } from './inventory';

const ROLE_FAMILIES: readonly string[] = roleFamilyEnum.enumValues;

export function buildExtractPrompt(resumeText: string): {
  system: string;
  user: string;
} {
  const system = [
    'Extract a structured skills + accomplishment inventory from a resume. Respond with ONLY a JSON object, no prose.',
    'Truthfulness: include ONLY skills, technologies, and accomplishments actually present in the resume. Never invent.',
    'Shape: { "skills": [{ "skill": string, "kind": "technical" | "soft" }], "bullets": [{ "text": string, "skills": string[], "roleFamily"?: string, "company"?: string }] }',
    '- kind: "technical" for languages/tools/frameworks; "soft" for competencies.',
    `- roleFamily (optional): one of ${ROLE_FAMILIES.join(', ')}.`,
    '- Each bullet is an accomplishment from the resume (keep any metric). skills[] lists the skills that bullet demonstrates; every tag MUST also appear in the top-level skills[].',
    '- Extract concrete skills, not section headers or fluff.',
  ].join('\n');
  return { system, user: `Resume:\n${resumeText}` };
}

interface RawSkill {
  skill?: unknown;
  kind?: unknown;
}
interface RawBullet {
  text?: unknown;
  skills?: unknown;
  roleFamily?: unknown;
  company?: unknown;
}

function firstJsonObject(raw: string): { skills?: RawSkill[]; bullets?: RawBullet[] } {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object found in extractor output');
  return JSON.parse(m[0]);
}

/**
 * Draft an inventory from resume text. Sanitizes odd LLM output (bad enum
 * values are coerced/dropped) and reconciles bullet tags into skills — those
 * tags come from the resume, so they're truthful — then validates.
 */
export async function extractInventory(resumeText: string, chat: ChatClient): Promise<Inventory> {
  const raw = firstJsonObject(await chat.complete(buildExtractPrompt(resumeText)));

  const skills = (raw.skills ?? []).flatMap((s) => {
    const skill = typeof s.skill === 'string' ? s.skill : '';
    if (!skill) return [];
    return [{ skill, kind: s.kind === 'soft' ? ('soft' as const) : ('technical' as const) }];
  });

  const bullets = (raw.bullets ?? []).flatMap((b) => {
    const text = typeof b.text === 'string' ? b.text : '';
    if (!text) return [];
    const tags = Array.isArray(b.skills)
      ? b.skills.filter((t): t is string => typeof t === 'string')
      : [];
    const roleFamily =
      typeof b.roleFamily === 'string' && ROLE_FAMILIES.includes(b.roleFamily)
        ? b.roleFamily
        : undefined;
    const company = typeof b.company === 'string' ? b.company : undefined;
    return [{ text, skills: tags, roleFamily, company }];
  });

  // Reconcile: every bullet tag must be a known skill (add missing as technical).
  const known = new Set(skills.map((s) => s.skill.trim().toLowerCase()));
  for (const b of bullets) {
    for (const tag of b.skills) {
      const norm = tag.trim().toLowerCase();
      if (norm && !known.has(norm)) {
        known.add(norm);
        skills.push({ skill: norm, kind: 'technical' });
      }
    }
  }

  return parseInventory({ skills, bullets, baseResumes: [] });
}
