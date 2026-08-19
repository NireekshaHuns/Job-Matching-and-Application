/**
 * DB glue for enrichment: load the dedup set, sponsor history, and confirmed
 * aliases; build the resolver; run the orchestrator; insert the rows; and
 * persist any newly discovered company→sponsor aliases. `db` is injected
 * (type-only import of `DB`) so this never loads the env-bound client and can be
 * driven from a script or the Inngest function.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { companyAliases, jobs, sponsors, type NewJob } from '@/server/db/schema';
import type { SponsorHistory } from '@/lib/sponsorship';
import type { RawPosting } from '@/server/ingest/types';
import { enrichPostings, type EnrichResult } from './enrich';
import { buildSponsorResolver, type DiscoveredAlias } from './steps/resolver';
import { looksLikeSwe } from './steps/swe-title';
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
      // Written since the USCIS ingest landed but never read until the
      // latest-year tier rule needed it.
      newEmploymentRecentYears: sponsors.newEmploymentRecentYears,
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
      newEmploymentRecentYears: r.newEmploymentRecentYears,
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

/**
 * A job unseen in any feed for this many days is marked closed. A grace window
 * (rather than closing the instant a posting is absent from one fetch) keeps a
 * transient empty response or a single-source hiccup from closing live jobs, and
 * sidesteps per-source bookkeeping under cross-source dedup.
 */
export const STALE_DAYS = 14;

/** The cutoff before which an unrefreshed job is considered stale. Pure/testable. */
export function staleThreshold(now: Date, days: number = STALE_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export interface ReconcileStats {
  refreshed: number;
  closed: number;
}

/** Fingerprints are short strings, so batch the reconcile IN-lists larger than job inserts. */
const RECONCILE_CHUNK_SIZE = 1000;

/**
 * Freshness reconcile: refresh `last_seen_at` (and reopen) for every posting
 * still present in a feed this run, then close any active job not seen since the
 * stale cutoff. `seen` is the set of fingerprints fetched this run (pre-dedup).
 *
 * Safety valve: if nothing was fetched at all this run (every connector failed
 * or returned empty), there's no staleness signal — skip the close pass so a
 * total outage can't mass-close a still-live board.
 */
export async function reconcileFreshness(
  db: DB,
  seen: Iterable<string>,
  now: Date = new Date(),
): Promise<ReconcileStats> {
  const fingerprints = [...new Set(seen)];
  if (fingerprints.length === 0) return { refreshed: 0, closed: 0 };

  let refreshed = 0;
  for (let i = 0; i < fingerprints.length; i += RECONCILE_CHUNK_SIZE) {
    const chunk = fingerprints.slice(i, i + RECONCILE_CHUNK_SIZE);
    const returned = await db
      .update(jobs)
      .set({ lastSeenAt: now, status: 'active', closedAt: null })
      .where(inArray(jobs.fingerprint, chunk))
      .returning({ id: jobs.id });
    refreshed += returned.length;
  }

  const closedRows = await db
    .update(jobs)
    .set({ status: 'closed', closedAt: now })
    .where(and(eq(jobs.status, 'active'), lt(jobs.lastSeenAt, staleThreshold(now))))
    .returning({ id: jobs.id });

  return { refreshed, closed: closedRows.length };
}

export interface RunEnrichmentArgs {
  db: DB;
  postings: RawPosting[];
  chat: ChatClient;
  /** Omit to skip JD embedding (the default in production) — see steps/embed.ts. */
  embedder?: Embedder;
  /**
   * Run the freshness reconcile at the end. Off when the caller is enriching
   * one source at a time: reconcile closes anything not in `postings`, so a
   * per-source call would close every OTHER source's jobs. Those callers run
   * `reconcileFreshness` once at the end with every fingerprint they saw.
   */
  reconcile?: boolean;
  /**
   * Cap on how many NEW postings to enrich in this call; the rest are left for
   * a later run and reported as `deferred`. Enrichment is the slow, paid part
   * (one LLM classify + one embed each), and on a serverless host the whole
   * call has to fit inside one function invocation.
   */
  maxNew?: number;
  /**
   * Fill in `jdText` for the postings that survived the cap, for sources that
   * charge a request per description. Runs AFTER selection on purpose — see
   * `JobConnector.hydrate`. Best-effort: a failure here leaves the JD empty
   * rather than losing the posting.
   */
  hydrate?: (postings: RawPosting[]) => Promise<RawPosting[]>;
  /** Insert completed rows every N postings; 0 disables progressive flushing. */
  flushEvery?: number;
  /** Called after each flush with the running insert total (for CLI progress). */
  onProgress?: (inserted: number) => void;
}

/**
 * Rows to accumulate before writing. Small enough that a crash loses little,
 * large enough that inserts stay batched.
 */
const DEFAULT_FLUSH_EVERY = 100;

/**
 * Split a fetch into "enrich now" and "leave for next run".
 *
 * Postings we already hold cost nothing (`enrichPostings` skips them), so only
 * genuinely new ones count against `maxNew`. When nothing needs deferring the
 * full list is passed straight through, so the uncapped path is unchanged.
 * Pure.
 *
 * THE CAP MUST COUNT ONLY WHAT WILL ACTUALLY BE ENRICHED. `enrichPostings` drops
 * non-software titles AFTER this split, and a dropped posting is never inserted,
 * so it never joins `existing` and is still "fresh" on the next run. Counting
 * those against the cap therefore burned the window on the same rows forever:
 * a source whose feed is 20% software advanced ~20 rows per run out of a
 * 100-row budget, and the remaining 80 slots re-scanned the identical head of
 * the list every time. Measured on the live board, that is why "Find new jobs"
 * returned a handful of postings against feeds holding thousands.
 *
 * `isCandidate` mirrors that later filter so the budget is spent on real work.
 * It defaults to "everything counts", for tests and any future caller handing in
 * an already-filtered list. (`runEnrichment` always passes the real predicate,
 * and an uncapped call returns above before the predicate is ever consulted.)
 */
export function planEnrichmentBatch(
  postings: RawPosting[],
  existing: ReadonlySet<string>,
  maxNew?: number,
  isCandidate: (posting: RawPosting) => boolean = () => true,
): { toEnrich: RawPosting[]; deferred: number } {
  const cap = maxNew ?? Infinity;
  if (cap === Infinity) return { toEnrich: postings, deferred: 0 };

  const fresh = postings.filter((p) => !existing.has(p.fingerprint) && isCandidate(p));
  const deferred = Math.max(0, fresh.length - cap);
  return { toEnrich: deferred > 0 ? fresh.slice(0, cap) : postings, deferred };
}

/** End-to-end: load state, enrich new postings, insert, persist aliases, reconcile freshness. */
export async function runEnrichment(args: RunEnrichmentArgs): Promise<
  EnrichResult & {
    inserted: number;
    aliasesWritten: number;
    reconcile: ReconcileStats;
    /** New postings left un-enriched because `maxNew` was reached. */
    deferred: number;
  }
> {
  const [existing, sponsorState] = await Promise.all([
    loadExistingFingerprints(args.db),
    loadSponsorState(args.db),
  ]);
  const confirmedAliases = await loadConfirmedAliases(args.db, sponsorState.idByKey);

  const { resolve, discovered } = buildSponsorResolver({
    historyByKey: sponsorState.historyByKey,
    confirmedAliases,
  });

  // Same predicate `enrichPostings` applies, so the cap is spent on postings
  // that can actually become rows.
  const { toEnrich, deferred } = planEnrichmentBatch(args.postings, existing, args.maxNew, (p) =>
    looksLikeSwe(p.title),
  );

  // Buy descriptions only for what we just selected. A source that charges per
  // JD must not spend that budget on the head of the feed while the cap has
  // already moved past it — an enriched job is never re-analyzed, so a missing
  // JD permanently mis-tiers its sponsorship.
  const selected = args.hydrate ? await args.hydrate(toEnrich) : toEnrich;

  // Persist as we go. A long backfill that only writes at the very end loses
  // everything to one rate-limit or network blip; flushing keeps completed
  // (already paid for) work safe and lets a re-run skip it via the dedup.
  let inserted = 0;
  const result = await enrichPostings(
    selected,
    existing,
    { chat: args.chat, embedder: args.embedder, resolve },
    {
      batchSize: args.flushEvery ?? DEFAULT_FLUSH_EVERY,
      onBatch: async (rows) => {
        inserted += await insertJobs(args.db, rows);
        args.onProgress?.(inserted);
      },
    },
  );
  inserted += await insertJobs(args.db, result.rows);
  const aliasesWritten = await upsertDiscoveredAliases(
    args.db,
    discovered.values(),
    sponsorState.idByKey,
  );
  // Reconcile against every fingerprint seen this run (pre-dedup), so a job
  // present in any feed is kept fresh and only truly-dropped jobs go stale.
  // Note this uses the FULL posting list, not the capped slice — a posting we
  // deferred is still evidence that the job is live.
  const reconcile =
    args.reconcile === false
      ? { refreshed: 0, closed: 0 }
      : await reconcileFreshness(
          args.db,
          args.postings.map((p) => p.fingerprint),
        );
  return { ...result, inserted, aliasesWritten, reconcile, deferred };
}
