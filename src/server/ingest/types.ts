/**
 * Common ingestion types. Every job source implements `JobConnector` and emits
 * the shared `RawPosting` shape, so downstream enrichment is source-agnostic.
 *
 * A connector only fetches, normalizes, and dedups — it never classifies,
 * scores, or filters by sponsorship / employment type (that is enrichment).
 * See the `add-job-source` skill.
 */

/** A single normalized posting, ready to be deduped and enriched. */
export interface RawPosting {
  /** Connector id that produced this posting (e.g. `greenhouse`, `github:simplify-newgrad`). */
  source: string;
  /** Per-source external posting id, when the feed exposes one; null otherwise. */
  sourceJobId?: string | null;
  company: string;
  title: string;
  location: string | null;
  url: string;
  /** Plain-text job description; may be empty for sources that don't include one. */
  jdText: string;
  /** When the source says it was posted/updated, or null if unknown. Full precision. */
  postedAt: Date | null;
  /** company + title + location, normalized — dedup key across sources. */
  fingerprint: string;
  /** The original source payload, kept for debugging / later enrichment. */
  raw: unknown;
}

/** Minimal fetch signature so connectors can be given a fixture client in tests. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface JobConnector {
  /** Unique source id. */
  readonly source: string;
  /** Pull new postings and map each to the normalized `RawPosting` shape. */
  fetch(): Promise<RawPosting[]>;
}
