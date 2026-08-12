/**
 * Shared enrichment types. External services (OpenAI, sponsor resolution) are
 * expressed as small interfaces so steps can be unit-tested with fakes and the
 * real adapters (`openai.ts`) plugged in only at runtime.
 */
import { employmentTypeEnum, roleFamilyEnum, seniorityEnum } from '@/server/db/schema';

export type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
export type RoleFamily = (typeof roleFamilyEnum.enumValues)[number];
export type Seniority = (typeof seniorityEnum.enumValues)[number];

/** What the LLM classify step extracts from a posting. */
export interface Classification {
  employmentType: EmploymentType;
  roleFamily: RoleFamily;
  seniority: Seniority;
  /**
   * Technical keywords — concrete technologies/tools named in the posting
   * (deduped, lowercased). Persisted as `jobs.tech_keywords`; the basis for
   * resume keyword matching.
   */
  skills: string[];
  /**
   * Soft keywords — competencies the posting emphasizes (e.g. "ownership",
   * "cross-functional collaboration"), excluding basic expectations. Persisted
   * as `jobs.soft_keywords`.
   */
  softKeywords: string[];
  /**
   * Best-effort pay range stated in the JD, normalized for display (e.g.
   * "$150k–$180k", "$60/hr"), or null when the JD doesn't state one. Persisted
   * as `jobs.salary_text`. Never invented — only surfaced when the JD says it.
   */
  salary?: string | null;
}

/** Minimal chat interface — returns the model's raw text (expected JSON). */
export interface ChatClient {
  complete(input: { system: string; user: string }): Promise<string>;
}

/** Minimal embedding interface — text in, vector out. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
  /**
   * Embed several texts in one round trip. Optional: implementations that
   * cannot batch simply omit it and callers fall back to `embed` in a loop.
   * Returns one entry per input, in order, with `null` where a vector could not
   * be produced — a missing embedding degrades retrieval, it is not an error.
   */
  embedMany?(texts: string[]): Promise<(number[] | null)[]>;
}
