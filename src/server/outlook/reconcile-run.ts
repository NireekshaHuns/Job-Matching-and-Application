/**
 * DB glue for Outlook confirmation reconcile: load unconfirmed applications,
 * fetch recent mail via the injected `MailClient`, match confirmations, and
 * flip the matched applications — conditionally, so a concurrent run can't
 * double-write. `db` and `mail` are injected (type-only `DB` import) so this
 * never loads the env-bound client and can be driven from a script or Inngest.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { applications, jobs } from '@/server/db/schema';
import {
  reconcileConfirmations,
  type ConfirmationUpdate,
  type PendingApplication,
} from './confirm';
import type { MailClient } from './types';

const DAY_MS = 86_400_000;
const DEFAULT_MAX_LOOKBACK_DAYS = 60;

/**
 * Oldest received-date to ask Graph for: the earliest pending application, but
 * never further back than `maxLookbackDays` (a first run shouldn't scan the
 * whole mailbox). With no pending apps, the window is just the lookback. Pure.
 */
export function reconcileSinceIso(
  appliedAtMs: number[],
  nowMs: number,
  maxLookbackDays: number = DEFAULT_MAX_LOOKBACK_DAYS,
): string {
  const floorMs = nowMs - maxLookbackDays * DAY_MS;
  const earliest = appliedAtMs.length ? Math.min(...appliedAtMs) : floorMs;
  return new Date(Math.max(floorMs, Math.min(earliest, nowMs))).toISOString();
}

export interface PendingApplicationRow extends PendingApplication {
  appliedAtMs: number;
}

/** Unconfirmed applications joined to their company, for matching. */
export async function loadPendingApplications(db: DB): Promise<PendingApplicationRow[]> {
  const rows = await db
    .select({
      id: applications.id,
      company: jobs.company,
      confirmationEmailId: applications.confirmationEmailId,
      appliedAt: applications.appliedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(isNull(applications.confirmedAt))
    .orderBy(desc(applications.appliedAt));

  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    confirmationEmailId: r.confirmationEmailId,
    appliedAtMs: r.appliedAt.getTime(),
  }));
}

export interface RunOutlookReconcileArgs {
  db: DB;
  mail: MailClient;
  now?: Date;
  maxLookbackDays?: number;
}

export interface ReconcileStats {
  pending: number;
  messages: number;
  confirmed: number;
}

/** End-to-end: load pending, fetch mail, match, write confirmations. */
export async function runOutlookReconcile(args: RunOutlookReconcileArgs): Promise<ReconcileStats> {
  const now = args.now ?? new Date();
  const pending = await loadPendingApplications(args.db);
  const sinceIso = reconcileSinceIso(
    pending.map((p) => p.appliedAtMs),
    now.getTime(),
    args.maxLookbackDays,
  );

  const messages = await args.mail.listMessages({ sinceIso });
  const updates = reconcileConfirmations(messages, pending);
  const confirmed = await writeConfirmations(args.db, updates);

  return { pending: pending.length, messages: messages.length, confirmed };
}

/**
 * Persist confirmations atomically. Each UPDATE guards on
 * `confirmation_email_id IS NULL` so a concurrent run — or the same email seen
 * twice — can never overwrite a confirmation (neon-http `db.batch` runs the lot
 * in one transaction). Returns the number of updates issued. NOTE: `confirmedAt`
 * and `confirmationEmailId` must always be set together — `loadPendingApplications`
 * reads on the former while the guard keys on the latter.
 */
export async function writeConfirmations(db: DB, updates: ConfirmationUpdate[]): Promise<number> {
  if (updates.length === 0) return 0; // db.batch requires a non-empty tuple
  const writes = updates.map((u) =>
    db
      .update(applications)
      .set({
        confirmedAt: new Date(u.confirmedAt),
        confirmationEmailId: u.confirmationEmailId,
        source: 'outlook',
      })
      .where(and(eq(applications.id, u.applicationId), isNull(applications.confirmationEmailId))),
  );
  const [first, ...rest] = writes; // provably non-empty here → no cast needed
  await db.batch([first, ...rest]);
  return updates.length;
}
