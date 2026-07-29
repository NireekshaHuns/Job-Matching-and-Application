/**
 * Shared Outlook types. The mail source is expressed as a small injected
 * interface so the confirmation logic is unit-testable with fakes; the real
 * Microsoft Graph adapter (Outlook-2) plugs in only at runtime.
 */

/** A single mail message, normalized to just the fields the detector needs. */
export interface OutlookMessage {
  /** Graph message id — stable, used to dedupe reconcile runs. */
  id: string;
  /** `address` must be the bare email (e.g. `no-reply@x.io`), not `Name <addr>`. */
  from: { name: string; address: string };
  subject: string;
  /** Plain-text snippet Graph returns as `bodyPreview`. */
  bodyPreview: string;
  /** ISO 8601 received timestamp. */
  receivedAt: string;
}

/** Reads recent messages from a mailbox. Implemented for real via Graph later. */
export interface MailClient {
  listMessages(opts: { sinceIso: string }): Promise<OutlookMessage[]>;
}
