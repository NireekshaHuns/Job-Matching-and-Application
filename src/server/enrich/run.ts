/**
 * DB glue for enrichment: load the dedup set, sponsor history, and confirmed
 * aliases; build the resolver; run the orchestrator; insert the rows; and
 * persist any newly discovered company→sponsor aliases. `db` is injected
 * (type-only import of `DB`) so this never loads the env-bound client and can be
 * driven from a script or the Inngest function.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { companyAliases, jobs, sponsors, type NewJob } from '@/server/db/schema';
import type { SponsorHistory } from '@/lib/sponsorship';
import type { RawPosting } from '@/server/ingest/types';
import { enrichPostings, type EnrichResult } from './enrich';
import { buildSponsorResolver, type DiscoveredAlias } from './steps/resolver';
import type { ChatClient, Embedder } from './types';

/** All fingerprints already in `jobs` — the cross-run dedup / cost gate. */
export async function loadExistingFingerprints(db: DB): Promise<Set<string>> {
  const rows = await db.select({ fingerprint: jobs.fingerprint }).from(jobs);
  return new Set(rows.map((r) => r.fingerprint));
}

export interface SponsorState {
  /** Government history keyed by normalized sponsor name. */
  historyByKey: Map<string, SponsorHistory>;
  /** Normalized sponsor name → `sponsors.id` (for writing alias FKs). */
  idByKey: Map<string, number>;
}

/** Load the whole `sponsors` table into in-memory maps for resolution. */
export async function loadSponsorState(db: DB): Promise<SponsorState> {
  const rows = await db
    .select({
      id: sponsors.id,
      key: sponsors.companyNameNormalized,
      sponsorCount: sponsors.sponsorCount,
      approvalRate: sponsors.approvalRate,
      lastFiledYear: sponsors.lastFiledYear,
      newEmploymentApprovals: sponsors.newEmploymentApprovals,
      newEmploymentLastYear: sponsors.newEmploymentLastYear,
    })
    .from(sponsors);

  const historyByKey = new Map<string, SponsorHistory>();
  const idByKey = new Map<string, number>();
  for (const r of rows) {
    historyByKey.set(r.key, {
      sponsorCount: r.sponsorCount,
      approvalRate: r.approvalRate,
      lastFiledYear: r.lastFiledYear,
      newEmploymentApprovals: r.newEmploymentApprovals,
      newEmploymentLastYear: r.newEmploymentLastYear,
    });
    idByKey.set(r.key, r.id);
  }
  return { historyByKey, idByKey };
}

/**
 * User-confirmed aliases: normalized raw name → sponsor key (null = confirmed
 * "no match"). These override any recomputed resolution during enrichment.
 */
export async function loadConfirmedAliases(
  db: DB,
  idByKey: Map<string, number>,
): Promise<Map<string, string | null>> {
  const keyById = new Map<number, string>();
  for (const [key, id] of idByKey) keyById.set(id, key);

  const rows = await db
    .select({
      rawNameNormalized: companyAliases.rawNameNormalized,
      sponsorId: companyAliases.sponsorId,
    })
    .from(companyAliases)
    .where(eq(companyAliases.confirmed, true));

  const out = new Map<string, string | null>();
  for (const r of rows) {
    out.set(r.rawNameNormalized, r.sponsorId != null ? (keyById.get(r.sponsorId) ?? null) : null);
  }
  return out;
}

/** Rows per insert — small because each row carries a 1536-float embedding. */
const CHUNK_SIZE = 200;

/**
 * Insert enriched rows, ignoring any fingerprint that raced in meanwhile.
 * Returns the number of rows ACTUALLY inserted (via RETURNING), so a race that
 * drops a row is reflected honestly rather than counted as written.
 */
export async function insertJobs(db: DB, rows: NewJob[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const returned = await db
      .insert(jobs)
      .values(chunk)
      .onConflictDoNothing({ target: jobs.fingerprint })
      .returning({ fingerprint: jobs.fingerprint });
    inserted += returned.length;
  }
  return inserted;
}

/**
 * Upsert auto-discovered aliases (never `confirmed`). A user-confirmed row is
 * left untouched (`setWhere confirmed = false`), so corrections are sticky.
 */
export async function upsertDiscoveredAliases(
  db: DB,
  discovered: Iterable<DiscoveredAlias>,
  idByKey: Map<string, number>,
): Promise<number> {
  const values = [...discovered].map((d) => ({
    rawName: d.rawName,
    rawNameNormalized: d.rawNameNormalized,
    sponsorId: idByKey.get(d.sponsorKey) ?? null,
    matchConfidence: d.confidence,
    matchMethod: d.method,
    confirmed: false,
  }));

  let written = 0;
  for (let i = 0; i < values.length; i += CHUNK_SIZE) {
    const chunk = values.slice(i, i + CHUNK_SIZE);
    await db
      .insert(companyAliases)
      .values(chunk)
      .onConflictDoUpdate({
        target: companyAliases.rawNameNormalized,
        set: {
          rawName: sql`excluded.raw_name`,
          sponsorId: sql`excluded.sponsor_id`,
          matchConfidence: sql`excluded.match_confidence`,
          matchMethod: sql`excluded.match_method`,
          updatedAt: sql`now()`,
        },
        setWhere: eq(companyAliases.confirmed, false),
      });
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

/** End-to-end: load state, enrich new postings, insert, persist aliases. */
export async function runEnrichment(
  args: RunEnrichmentArgs,
): Promise<EnrichResult & { inserted: number; aliasesWritten: number }> {
  const [existing, sponsorState] = await Promise.all([
    loadExistingFingerprints(args.db),
    loadSponsorState(args.db),
  ]);
  const confirmedAliases = await loadConfirmedAliases(args.db, sponsorState.idByKey);

  const { resolve, discovered } = buildSponsorResolver({
    historyByKey: sponsorState.historyByKey,
    confirmedAliases,
  });

  const result = await enrichPostings(args.postings, existing, {
    chat: args.chat,
    embedder: args.embedder,
    resolve,
  });
  const inserted = await insertJobs(args.db, result.rows);
  const aliasesWritten = await upsertDiscoveredAliases(
    args.db,
    discovered.values(),
    sponsorState.idByKey,
  );
  return { ...result, inserted, aliasesWritten };
}
