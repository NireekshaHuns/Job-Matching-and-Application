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
export const ATS_CONFIRMATION_DOMAINS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'us.greenhouse-mail.io',
  'lever.co',
  'hire.lever.co',
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

/** Confirmation wording for non-ATS senders (employer's own mail server). */
export const CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'we received your application',
  'we have received your application',
  'your application has been received',
  'your application to',
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
 * Normalize free text to the same token space as company keys so a key like
 * "HOME DEPOT" can be found as a whole-token run inside it.
 */
function normalizedHaystack(msg: OutlookMessage): string {
  const domainLabel = senderDomain(msg.from.address).split('.')[0] ?? '';
  const text = `${msg.from.name} ${msg.subject} ${msg.bodyPreview} ${domainLabel}`;
  return ` ${normalizeCompanyName(text)} `;
}

/** Shortest brand token we'll match on alone, to avoid generic hits ("labs", "inc"). */
const MIN_BRAND_TOKEN = 4;

/**
 * True when a company key appears in the haystack: either the full key (best),
 * or its leading brand token as a whole word. Emails often carry the brand only
 * ("Notion") while we store a fuller name ("Notion Labs"), so the brand-token
 * fallback catches those; the length floor keeps generic tokens from matching.
 */
function companyAppearsIn(key: string, haystack: string): boolean {
  if (!key) return false;
  if (haystack.includes(` ${key} `)) return true;
  const brand = key.split(' ')[0];
  return brand.length >= MIN_BRAND_TOKEN && haystack.includes(` ${brand} `);
}

/**
 * Match a confirmation email to one of the given applications by company name
 * (appearing in the sender name, subject, body, or domain label). Returns the
 * first unconfirmed match, or null.
 */
export function matchConfirmationToApplication(
  msg: OutlookMessage,
  apps: PendingApplication[],
): PendingApplication | null {
  const haystack = normalizedHaystack(msg);
  for (const app of apps) {
    if (app.confirmationEmailId) continue;
    if (companyAppearsIn(normalizeCompanyName(app.company), haystack)) return app;
  }
  return null;
}

/**
 * Reconcile a batch of messages against pending applications. Produces one
 * update per newly-confirmed application. Idempotent: emails already recorded
 * on an application are skipped, and each application is claimed at most once
 * per run (first matching confirmation wins).
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

  for (const msg of messages) {
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
