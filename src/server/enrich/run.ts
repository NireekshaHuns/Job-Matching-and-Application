/**
 * DB glue for enrichment: load the dedup set + sponsor lookup, run the
 * orchestrator, and insert the resulting rows. `db` is injected (type-only
 * import of `DB`) so this never loads the env-bound client and can be driven
 * from a script or the Inngest function.
 */
import type { DB } from '@/server/db';
import { jobs, sponsors, type NewJob } from '@/server/db/schema';
import type { SponsorHistory } from '@/lib/sponsorship';
import type { RawPosting } from '@/server/ingest/types';
import { enrichPostings, type EnrichResult } from './enrich';
import type { ChatClient, Embedder, SponsorLookup } from './types';

/** All fingerprints already in `jobs` — the cross-run dedup / cost gate. */
export async function loadExistingFingerprints(db: DB): Promise<Set<string>> {
  const rows = await db.select({ fingerprint: jobs.fingerprint }).from(jobs);
  return new Set(rows.map((r) => r.fingerprint));
}

/** Build an in-memory sponsor lookup from the whole `sponsors` table. */
export async function loadSponsorLookup(db: DB): Promise<SponsorLookup> {
  const rows = await db
    .select({
      key: sponsors.companyNameNormalized,
      sponsorCount: sponsors.sponsorCount,
      approvalRate: sponsors.approvalRate,
      lastFiledYear: sponsors.lastFiledYear,
    })
    .from(sponsors);
  const map = new Map<string, SponsorHistory>();
  for (const r of rows) {
    map.set(r.key, {
      sponsorCount: r.sponsorCount,
      approvalRate: r.approvalRate,
      lastFiledYear: r.lastFiledYear,
    });
  }
  return (key) => map.get(key) ?? null;
}

/** Rows per insert — small because each row carries a 1536-float embedding. */
const CHUNK_SIZE = 200;

/** Insert enriched rows, ignoring any fingerprint that raced in meanwhile. */
export async function insertJobs(db: DB, rows: NewJob[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await db.insert(jobs).values(chunk).onConflictDoNothing({ target: jobs.fingerprint });
    written += chunk.length;
  }
  return written;
}

export interface RunEnrichmentArgs {
  db: DB;
  postings: RawPosting[];
  chat: ChatClient;
  embedder: Embedder;
}

/** End-to-end: load state, enrich new postings, insert. */
export async function runEnrichment(
  args: RunEnrichmentArgs,
): Promise<EnrichResult & { inserted: number }> {
  const [existing, lookup] = await Promise.all([
    loadExistingFingerprints(args.db),
    loadSponsorLookup(args.db),
  ]);
  const result = await enrichPostings(args.postings, existing, {
    chat: args.chat,
    embedder: args.embedder,
    lookup,
  });
  const inserted = await insertJobs(args.db, result.rows);
  return { ...result, inserted };
}
