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

function firstJsonObject(raw: string): { skills?: unknown; bullets?: unknown } {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object found in extractor output.');
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    throw new Error(`Extractor output was not valid JSON: ${(e as Error).message}`);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ExtractResult {
  inventory: Inventory;
  /** Skills auto-added from bullet tags the model didn't list — review these. */
  reconciledSkills: string[];
}

/**
 * Draft an inventory from resume text. Defensively normalizes odd LLM output
 * (non-array fields, non-object elements, bad enums) and reconciles bullet tags
 * into skills — those tags come from the resume, so they're truthful — then
 * validates via `parseInventory`. Returns the reconciled skills so the CLI can
 * flag them for human review (the extractor, not the user, declared those).
 */
export async function extractInventory(
  resumeText: string,
  chat: ChatClient,
): Promise<ExtractResult> {
  const raw = firstJsonObject(await chat.complete(buildExtractPrompt(resumeText)));

  const skills = asArray(raw.skills).flatMap((s) => {
    if (!isObject(s) || typeof s.skill !== 'string' || !s.skill.trim()) return [];
    return [
      { skill: s.skill, kind: s.kind === 'soft' ? ('soft' as const) : ('technical' as const) },
    ];
  });

  const bullets = asArray(raw.bullets).flatMap((b) => {
    if (!isObject(b) || typeof b.text !== 'string' || !b.text.trim()) return [];
    const tags = asArray(b.skills).filter((t): t is string => typeof t === 'string');
    const roleFamily =
      typeof b.roleFamily === 'string' && ROLE_FAMILIES.includes(b.roleFamily)
        ? b.roleFamily
        : undefined;
    const company = typeof b.company === 'string' ? b.company : undefined;
    return [{ text: b.text, skills: tags, roleFamily, company }];
  });

  // Reconcile: every bullet tag must be a known skill (add missing as technical).
  const known = new Set(skills.map((s) => s.skill.trim().toLowerCase()));
  const reconciledSkills: string[] = [];
  for (const b of bullets) {
    for (const tag of b.skills) {
      const norm = tag.trim().toLowerCase();
      if (norm && !known.has(norm)) {
        known.add(norm);
        skills.push({ skill: norm, kind: 'technical' });
        reconciledSkills.push(norm);
      }
    }
  }

  return {
    inventory: parseInventory({ skills, bullets, baseResumes: [] }),
    reconciledSkills,
  };
}
