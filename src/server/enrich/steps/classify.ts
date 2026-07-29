/**
 * Classify step: ask the LLM to extract employment type, role family, seniority,
 * and skills from a posting, then validate the result against the schema enums.
 *
 * Prompt building and parsing are pure and unit-tested; the network call is
 * behind an injected `ChatClient`.
 */
import { z } from 'zod';
import { employmentTypeEnum, roleFamilyEnum, seniorityEnum } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import type { ChatClient, Classification } from '../types';

const classificationSchema = z.object({
  employmentType: z.enum(employmentTypeEnum.enumValues),
  roleFamily: z.enum(roleFamilyEnum.enumValues),
  seniority: z.enum(seniorityEnum.enumValues),
  skills: z.array(z.string()).default([]),
});

export const CLASSIFY_SYSTEM_PROMPT = [
  'You classify software-engineering job postings. Respond with ONLY a JSON object, no prose.',
  'Fields:',
  `- employmentType: one of ${employmentTypeEnum.enumValues.join(', ')} (contract/staffing/C2C/1099 => "contract", direct-hire => "full_time").`,
  `- roleFamily: one of ${roleFamilyEnum.enumValues.join(', ')}.`,
  `- seniority: one of ${seniorityEnum.enumValues.join(', ')} ("entry" = new-grad/junior, "mid" = a few years, everything senior/staff/lead/manager => "other").`,
  '- skills: array of concrete technologies/skills named in the posting (e.g. ["go", "kafka", "react"]). Empty array if none.',
].join('\n');

export function buildClassifyMessages(posting: RawPosting): {
  system: string;
  user: string;
} {
  const user = [
    `Title: ${posting.title}`,
    `Company: ${posting.company}`,
    posting.jdText ? `Description:\n${posting.jdText}` : 'Description: (none provided)',
  ].join('\n');
  return { system: CLASSIFY_SYSTEM_PROMPT, user };
}

/** Keep skills bounded; deduped first, so this is 30 UNIQUE skills. */
const MAX_SKILLS = 30;

/** Normalize skills: trim, lowercase, drop empties, dedupe, cap length. */
function normalizeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  for (const s of skills) {
    const v = s.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen].slice(0, MAX_SKILLS);
}

/**
 * Parse and validate the model's raw JSON output into a `Classification`.
 * Extracts the first {...} block so leading prose or ```json fences (from
 * non-strict models) don't break JSON.parse. The real adapter forces a strict
 * JSON object, so this is defensive.
 */
export function parseClassification(raw: string): Classification {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in classifier output');
  const parsed = classificationSchema.parse(JSON.parse(match[0]));
  return { ...parsed, skills: normalizeSkills(parsed.skills) };
}

export async function classifyPosting(
  posting: RawPosting,
  chat: ChatClient,
): Promise<Classification> {
  const raw = await chat.complete(buildClassifyMessages(posting));
  return parseClassification(raw);
}
