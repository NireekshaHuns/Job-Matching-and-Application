/**
 * People-finder types (spec §5.6). Providers infer work emails from a company
 * domain via compliant APIs (Apollo/Hunter) — never LinkedIn scraping. External
 * I/O is behind an injectable `Fetcher` so adapters are unit-testable offline.
 */

/** A person surfaced by a provider. Third-party PII — treated as sensitive. */
export interface PersonResult {
  name: string;
  title: string | null;
  email: string | null;
  /** 0–100 email confidence when the provider gives one; null otherwise. */
  emailConfidence: number | null;
  /** Provider id that produced this row (e.g. `hunter`, `apollo`). */
  source: string;
}

export interface PeopleQuery {
  company: string;
  /** Optional company domain; providers can also resolve it from the name. */
  domain?: string | null;
  /** Optional title keywords to bias the search (recruiter, engineering manager, …). */
  roles?: string[];
}

/** Minimal fetch signature so providers can be given a fixture client in tests. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface PeopleProvider {
  readonly source: string;
  find(query: PeopleQuery): Promise<PersonResult[]>;
}
