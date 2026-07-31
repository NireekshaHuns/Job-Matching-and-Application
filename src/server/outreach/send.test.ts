import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import type { MailSender } from '@/server/outlook/types';
import { sendOutreachEmail } from './send';

/**
 * Minimal fake DB: `select(...).from(...).where(...).limit(...)` resolves to
 * `rows`, and `insert(...).values(...)` resolves (or rejects when `insertError`
 * is set, to exercise the best-effort touch log).
 */
function fakeDb(rows: { id: number; email: string | null }[], insertError?: Error) {
  const values = vi.fn(async () => {
    if (insertError) throw insertError;
    return undefined;
  });
  const insert = vi.fn(() => ({ values }));
  const limit = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  return { db: { select, insert } as unknown as DB, insert, values };
}

function fakeSender(sendError?: Error) {
  const sendMail = vi.fn<MailSender['sendMail']>(async () => {
    if (sendError) throw sendError;
  });
  return { sender: { sendMail } as MailSender, sendMail };
}

const base = { contactId: 1, subject: 'Hi', body: 'Hello' };

describe('sendOutreachEmail', () => {
  it('returns not_found and never sends when the contact is missing', async () => {
    const { db } = fakeDb([]);
    const { sender, sendMail } = fakeSender();
    expect(await sendOutreachEmail({ db, sender, ...base })).toEqual({ status: 'not_found' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns no_email and never sends when the contact has no address', async () => {
    const { db } = fakeDb([{ id: 1, email: null }]);
    const { sender, sendMail } = fakeSender();
    expect(await sendOutreachEmail({ db, sender, ...base })).toEqual({ status: 'no_email' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends to the contact address and logs an email touch', async () => {
    const { db, insert, values } = fakeDb([{ id: 1, email: 'jane@acme.com' }]);
    const { sender, sendMail } = fakeSender();
    expect(await sendOutreachEmail({ db, sender, ...base })).toEqual({ status: 'sent' });
    expect(sendMail).toHaveBeenCalledWith({ to: 'jane@acme.com', subject: 'Hi', body: 'Hello' });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ contactId: 1, channel: 'email' });
  });

  it('propagates a send failure and does NOT log a touch', async () => {
    const { db, insert } = fakeDb([{ id: 1, email: 'jane@acme.com' }]);
    const { sender } = fakeSender(new Error('graph 400'));
    await expect(sendOutreachEmail({ db, sender, ...base })).rejects.toThrow('graph 400');
    expect(insert).not.toHaveBeenCalled();
  });

  it('still reports sent when the touch-log insert fails after a successful send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = fakeDb([{ id: 1, email: 'jane@acme.com' }], new Error('neon blip'));
    const { sender, sendMail } = fakeSender();
    expect(await sendOutreachEmail({ db, sender, ...base })).toEqual({ status: 'sent' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
