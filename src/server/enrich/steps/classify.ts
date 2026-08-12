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
  softKeywords: z.array(z.string()).default([]),
  salary: z.string().nullish(),
});

export const CLASSIFY_SYSTEM_PROMPT = [
  'You classify software-engineering job postings. Respond with ONLY a JSON object, no prose.',
  'Fields:',
  `- employmentType: one of ${employmentTypeEnum.enumValues.join(', ')} (contract/staffing/C2C/1099 => "contract", direct-hire => "full_time").`,
  `- roleFamily: one of ${roleFamilyEnum.enumValues.join(', ')}. Use "software" for a general software-engineering role with no specific specialty (e.g. a plain "Software Engineer"); use "other" ONLY for genuinely non-software roles.`,
  `- seniority: one of ${seniorityEnum.enumValues.join(', ')} ("entry" = new-grad/junior, "mid" = a few years, senior/staff/principal/lead/manager => "other"). A title that states NO level (a plain "Software Engineer") is "mid" — never "other" — unless the description clearly demands many years of experience.`,
  '- skills: array of concrete technical keywords — technologies/tools/languages named (e.g. ["go", "kafka", "react"]). Exclude generic basics. Empty array if none.',
  '- softKeywords: array of soft skills/competencies the posting emphasizes (e.g. ["ownership", "cross-functional collaboration", "mentorship"]). Exclude basic expectations. Empty array if none.',
  '- salary: the pay range EXACTLY as stated in the posting, normalized for display (e.g. "$150k–$180k", "$70–$90/hr"). Use null if the posting does not state pay. NEVER guess or invent a number.',
].join('\n');

/**
 * How much of the job description to send.
 *
 * Everything this step extracts — employment type, role family, seniority, the
 * named technologies — is established near the top of a posting. The tail is
 * benefits, EEO statements and legal boilerplate, and JDs routinely run past
 * 15,000 characters. Since input tokens dominate the cost of a bulk ingest,
 * this cap is the single largest saving available and forfeits nothing the
 * classifier uses.
 */
export const MAX_JD_CHARS = 6000;

/** Cut to the cap on a paragraph or sentence boundary where one is close by. */
export function truncateJd(jdText: string, max: number = MAX_JD_CHARS): string {
  if (jdText.length <= max) return jdText;
  const head = jdText.slice(0, max);
  // Prefer the last paragraph break in the final 20%, else the last sentence
  // end, so the model never sees a word cut in half.
  const floor = Math.floor(max * 0.8);
  const para = head.lastIndexOf('\n\n');
  const stop = para >= floor ? para : head.lastIndexOf('. ');
  return (stop >= floor ? head.slice(0, stop) : head).trimEnd();
}

export function buildClassifyMessages(posting: RawPosting): {
  system: string;
  user: string;
} {
  const jd = truncateJd(posting.jdText ?? '');
  const user = [
    `Title: ${posting.title}`,
    `Company: ${posting.company}`,
    jd ? `Description:\n${jd}` : 'Description: (none provided)',
  ].join('\n');
  return { system: CLASSIFY_SYSTEM_PROMPT, user };
}

/** Keep keyword lists bounded; deduped first, so this is UNIQUE keywords. */
const MAX_KEYWORDS = 30;

/** Normalize a keyword list: trim, lowercase, drop empties, dedupe, cap length. */
function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  for (const k of keywords) {
    const v = k.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen].slice(0, MAX_KEYWORDS);
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
  const salary = parsed.salary?.trim();
  return {
    ...parsed,
    skills: normalizeKeywords(parsed.skills),
    softKeywords: normalizeKeywords(parsed.softKeywords),
    salary: salary ? salary : null,
  };
}

export async function classifyPosting(
  posting: RawPosting,
  chat: ChatClient,
): Promise<Classification> {
  const raw = await chat.complete(buildClassifyMessages(posting));
  return parseClassification(raw);
}
