/**
 * Detect "we received your application" emails and match them to a pending
 * application. All pure — no I/O — so it's fully offline-testable; the real
 * Graph mail client is injected at the edge (Outlook-2).
 *
 * A message counts as a confirmation when it comes from a known ATS domain OR
 * its subject/body carries a confirmation phrase. Matching a confirmation to an
 * application reuses the sponsorship company normalizer so "Stripe, Inc." and
 * "Stripe" line up.
 */
import { normalizeCompanyName } from '@/lib/sponsorship';
import type { OutlookMessage } from './types';

/**
 * Sender domains used by the major ATS platforms to send application
 * confirmations. A message from one of these is treated as a confirmation on
 * the sender alone, since the body wording varies per employer template.
 */
// Parent domains only — `isAtsSender` matches these and any subdomain, so
// listing e.g. `hire.lever.co` alongside `lever.co` would be redundant.
export const ATS_CONFIRMATION_DOMAINS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'icims.com',
  'workable.com',
  'jobvite.com',
  'taleo.net',
  'successfactors.com',
] as const;

/**
 * Confirmation wording for non-ATS senders (employer's own mail server). Kept
 * conservative: each phrase asserts *receipt*, so a single hit can flip status.
 * "your application to" is deliberately excluded — it appears in rejections and
 * status updates just as often ("your application to X was not selected").
 */
export const CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'we received your application',
  "we've received your application",
  'we have received your application',
  'your application has been received',
  'application was submitted',
  'successfully submitted your application',
] as const;

/** Lowercased registrable-ish domain of an email address (part after the `@`). */
export function senderDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1
    ? ''
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** True when the sender's domain is (or is a subdomain of) a known ATS domain. */
export function isAtsSender(msg: OutlookMessage): boolean {
  const domain = senderDomain(msg.from.address);
  if (!domain) return false;
  return ATS_CONFIRMATION_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** True when the subject or body preview contains a confirmation phrase. */
export function hasConfirmationPhrase(msg: OutlookMessage): boolean {
  const haystack = `${msg.subject} ${msg.bodyPreview}`.toLowerCase();
  return CONFIRMATION_PHRASES.some((p) => haystack.includes(p));
}

/** A message is an application confirmation if it's from an ATS or reads like one. */
export function isApplicationConfirmation(msg: OutlookMessage): boolean {
  return isAtsSender(msg) || hasConfirmationPhrase(msg);
}

/** The subset of an application row the matcher/reconciler needs. */
export interface PendingApplication {
  id: number;
  company: string;
  /** Non-null once confirmed — such rows are skipped (idempotent reconcile). */
  confirmationEmailId: string | null;
}

/** One reconcile result: a pending application matched to a confirming email. */
export interface ConfirmationUpdate {
  applicationId: number;
  confirmedAt: string;
  confirmationEmailId: string;
}

/**
 * Normalize the match text to the company-key token space. Only the sender
 * display name and subject are used — NOT the body: a body snippet often name-
 * drops unrelated companies (footers, "roles you might like"), which would
 * mis-attribute the confirmation. `HOME DEPOT` etc. survive as whole-token runs.
 */
function normalizedHaystack(msg: OutlookMessage): string {
  return ` ${normalizeCompanyName(`${msg.from.name} ${msg.subject}`)} `;
}

/** Shortest brand token we'll match on alone, to avoid generic hits ("labs", "inc"). */
const MIN_BRAND_TOKEN = 4;

/** Whole-token (contiguous) substring test against the space-padded haystack. */
function keyAppears(key: string, haystack: string): boolean {
  return key !== '' && haystack.includes(` ${key} `);
}

/**
 * Match a confirmation email to exactly one pending application by company
 * name, or return null. Designed to never guess: a wrong confirmation is silent
 * and (since reconcile claims each app once) unrecoverable, whereas a missed one
 * is retried next run. So we ABSTAIN on ambiguity.
 *
 *  1. Full-key matches (the whole normalized company name appears): pick the
 *     longest such key — "Apple Bank" beats a bare "Apple" — and abstain if two
 *     different keys tie for longest.
 *  2. Only if there is NO full-key match, fall back to the leading brand token
 *     (≥4 chars, so 3-letter names like IBM match on full key only). Abstain
 *     unless exactly one app matches — "American Express" vs "American Airlines"
 *     both carry brand "AMERICAN", so a bare-brand email confirms neither.
 */
export function matchConfirmationToApplication(
  msg: OutlookMessage,
  apps: PendingApplication[],
): PendingApplication | null {
  const haystack = normalizedHaystack(msg);
  const candidates = apps
    .filter((a) => !a.confirmationEmailId)
    .map((app) => ({ app, key: normalizeCompanyName(app.company) }))
    .filter((c) => c.key !== '');

  const full = candidates.filter((c) => keyAppears(c.key, haystack));
  if (full.length > 0) {
    full.sort((a, b) => b.key.length - a.key.length);
    if (full.length > 1 && full[0].key.length === full[1].key.length) return null; // tie → abstain
    return full[0].app;
  }

  const brand = candidates.filter((c) => {
    const token = c.key.split(' ')[0];
    return token.length >= MIN_BRAND_TOKEN && keyAppears(token, haystack);
  });
  return brand.length === 1 ? brand[0].app : null;
}

/**
 * Reconcile a batch of messages against pending applications. Produces one
 * update per newly-confirmed application. Idempotent: emails already recorded
 * on an application are skipped, and each application is claimed at most once
 * per run — the EARLIEST matching confirmation wins, so `confirmedAt` reflects
 * when the application was actually confirmed.
 *
 * Messages are sorted oldest-first internally, so this holds regardless of the
 * order the mail client returned them (the client's ordering only affects which
 * messages are fetched under its page cap, not which email confirms an app).
 *
 * The caller (Outlook-2 adapter) must persist each update conditionally
 * (`WHERE confirmation_email_id IS NULL`) or in a single transaction so
 * concurrent runs can't double-write; the DB also has a partial unique index on
 * `confirmation_email_id` as a backstop.
 */
export function reconcileConfirmations(
  messages: OutlookMessage[],
  apps: PendingApplication[],
): ConfirmationUpdate[] {
  const usedEmailIds = new Set(
    apps.map((a) => a.confirmationEmailId).filter((id): id is string => id !== null),
  );
  const claimed = new Set<number>();
  const updates: ConfirmationUpdate[] = [];

  // Oldest-first: Graph receivedAt is always UTC ISO 8601, so a lexicographic
  // sort is chronological. Ensures the earliest confirmation claims the app.
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const msg of ordered) {
    if (usedEmailIds.has(msg.id)) continue;
    if (!isApplicationConfirmation(msg)) continue;
    const available = apps.filter((a) => !claimed.has(a.id));
    const match = matchConfirmationToApplication(msg, available);
    if (!match) continue;
    claimed.add(match.id);
    updates.push({
      applicationId: match.id,
      confirmedAt: msg.receivedAt,
      confirmationEmailId: msg.id,
    });
  }

  return updates;
}
