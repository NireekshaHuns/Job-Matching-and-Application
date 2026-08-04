/**
 * Extract the technical + soft keywords from a pasted job description so the
 * Studio can show them for review (tick which to include). Prompt building and
 * parsing are pure and unit-tested; the network call is behind an injected
 * `ChatClient`. Mirrors the classify step's JSON-mode + normalize pattern.
 */
import { z } from 'zod';
import type { ChatClient } from '@/server/enrich/types';

const schema = z.object({
  tech: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
});

export interface JdKeywords {
  /** Concrete technologies/tools/languages the JD names (deduped, lowercased). */
  tech: string[];
  /** Competencies the JD emphasizes (deduped, lowercased), excluding basics. */
  soft: string[];
}

export const JD_KEYWORDS_SYSTEM_PROMPT = [
  'You extract the keywords a resume should hit to pass ATS + a human screen for a job description.',
  'Respond with ONLY a JSON object, no prose.',
  'Fields:',
  '- tech: concrete technical keywords — languages, frameworks, tools, platforms, and named techniques',
  '  actually mentioned or clearly implied (e.g. ["react", "kafka", "high concurrency", "grpc"]).',
  '- soft: soft skills / competencies the JD emphasizes (e.g. ["ownership", "cross-functional collaboration",',
  '  "fast-paced", "mentorship"]).',
  'Rules: exclude generic basics every software engineer is assumed to have (e.g. "programming", "git",',
  '"problem solving" on its own). Prefer specific, differentiating phrases. No duplicates.',
].join('\n');

export function buildJdKeywordMessages(jdText: string): { system: string; user: string } {
  return { system: JD_KEYWORDS_SYSTEM_PROMPT, user: `Job description:\n${jdText}` };
}

/** Keep lists bounded and comparable to the corpus join key. */
const MAX_KEYWORDS = 40;

function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  for (const k of keywords) {
    const v = k.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen].slice(0, MAX_KEYWORDS);
}

/** Parse the model's raw JSON output into normalized keyword lists. */
export function parseJdKeywords(raw: string): JdKeywords {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in JD-keyword output');
  const parsed = schema.parse(JSON.parse(match[0]));
  const tech = normalizeKeywords(parsed.tech);
  const techSet = new Set(tech);
  // A keyword can't be both tech and soft — tech wins, so the tick UI is clean.
  const soft = normalizeKeywords(parsed.soft).filter((s) => !techSet.has(s));
  return { tech, soft };
}

export async function extractJdKeywords(jdText: string, chat: ChatClient): Promise<JdKeywords> {
  return parseJdKeywords(await chat.complete(buildJdKeywordMessages(jdText)));
}
