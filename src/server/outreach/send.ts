/**
 * Send a reviewed outreach draft to a saved contact. Extracted from the tRPC
 * router (like `runOutlookReconcile`) so it's unit-testable with a fake `db` and
 * an injected `MailSender` — no dynamic Graph import, no env. The router keeps
 * the env/creds check and builds the real `graphMailSender`.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/server/db';
import { contacts, outreachLog } from '@/server/db/schema';
import type { MailSender } from '@/server/outlook/types';

export interface SendOutreachEmailArgs {
  db: DB;
  sender: MailSender;
  contactId: number;
  subject: string;
  body: string;
}

/** `sent` on success; the other statuses map to client errors in the router. */
export type SendOutreachEmailResult = { status: 'sent' | 'not_found' | 'no_email' };

export async function sendOutreachEmail(args: SendOutreachEmailArgs): Promise<SendOutreachEmailResult> {
  const [contact] = await args.db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, args.contactId))
    .limit(1);
  if (!contact) return { status: 'not_found' };
  if (!contact.email) return { status: 'no_email' };

  // The email actually goes out here; if this rejects, so does the mutation.
  await args.sender.sendMail({ to: contact.email, subject: args.subject, body: args.body });

  // The touch log is best-effort bookkeeping — NOT the source of truth for
  // "was this sent." If it fails after a successful send we must not report an
  // error, or the user would retry and send a duplicate email.
  try {
    await args.db.insert(outreachLog).values({ contactId: contact.id, channel: 'email' });
  } catch (err) {
    console.warn('sendOutreachEmail: touch log failed after a successful send', err);
  }

  return { status: 'sent' };
}
