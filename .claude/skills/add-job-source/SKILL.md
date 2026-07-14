---
name: add-job-source
description: Add a new job ingestion connector (ATS feed, GitHub repo, or aggregator API). Use when adding or modifying a source that writes into raw_jobs. Covers the common connector interface, the dedup fingerprint, and fixture-based tests.
---

# Add a job source

New connectors implement one common interface, normalize to a shared shape, dedup
by fingerprint, and land rows in `raw_jobs`. Never scrape LinkedIn/Indeed/Glassdoor
directly — those only via the aggregator API. Prefer public ATS endpoints and public
GitHub repos.

## Steps

1. **Create the connector** under `src/server/ingest/connectors/<source>.ts`. Implement
   the common `JobConnector` interface (`src/server/ingest/types.ts`):
   - `source`: unique string id (e.g. `greenhouse`, `lever`, `ashby`, `jsearch`, `github:<repo>`).
   - `fetch(): Promise<RawPosting[]>` — pull new postings and map each to the normalized
     `RawPosting` shape (company, title, location, url, jd_text, posted_date, raw source blob).
   - Keep network I/O behind a small injectable client so tests can pass a fixture.

2. **Fingerprint** every posting with the shared helper — `fingerprint = normalizedCompany`
   joined with `normalizedTitle` and `location`. Dedup is by `fingerprint`; the same job from
   two sources must collapse to one `raw_jobs` row. Do NOT invent a per-source fingerprint.

3. **Register** the connector in the connector registry so the Inngest ingestion cron
   (Epic 2) fans out to it.

4. **Fixture test** (Vitest): drop a captured API/HTML response in `__fixtures__/` next to the
   connector and assert the connector maps it to the expected normalized postings and
   fingerprints. Cover pagination and an empty response. No live network in tests.

5. Run `pnpm lint && pnpm typecheck && pnpm test <path>` before committing.

## Invariants

- Normalize once, at ingest; enrichment (classify/embed) runs later and once per new job.
- A connector never classifies, scores, or filters — it only fetches + normalizes + dedups.
- Employment-type and sponsorship decisions happen in enrichment, not the connector.
