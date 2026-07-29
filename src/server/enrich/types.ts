/**
 * Shared enrichment types. External services (OpenAI, sponsor lookup) are
 * expressed as small interfaces so steps can be unit-tested with fakes and the
 * real adapters (`openai.ts`) plugged in only at runtime.
 */
import { employmentTypeEnum, roleFamilyEnum, seniorityEnum } from '@/server/db/schema';
import type { SponsorHistory } from '@/lib/sponsorship';

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
}

/** Minimal chat interface — returns the model's raw text (expected JSON). */
export interface ChatClient {
  complete(input: { system: string; user: string }): Promise<string>;
}

/** Minimal embedding interface — text in, vector out. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** Look up aggregated government sponsor history by normalized company name. */
export type SponsorLookup = (companyNameNormalized: string) => SponsorHistory | null;
