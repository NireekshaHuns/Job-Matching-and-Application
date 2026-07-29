import { describe, expect, it } from 'vitest';
import {
  hasConfirmationPhrase,
  isApplicationConfirmation,
  isAtsSender,
  matchConfirmationToApplication,
  reconcileConfirmations,
  senderDomain,
  type PendingApplication,
} from './confirm';
import type { OutlookMessage } from './types';

function msg(overrides: Partial<OutlookMessage> = {}): OutlookMessage {
  return {
    id: 'm1',
    from: { name: 'Greenhouse', address: 'no-reply@greenhouse-mail.io' },
    subject: 'Thank you for applying to Stripe',
    bodyPreview: 'We received your application and will be in touch.',
    receivedAt: '2026-07-20T10:00:00Z',
    ...overrides,
  };
}

describe('senderDomain', () => {
  it('extracts the lowercased domain', () => {
    expect(senderDomain('No-Reply@Greenhouse-Mail.IO')).toBe('greenhouse-mail.io');
    expect(senderDomain('garbage')).toBe('');
  });
});

describe('isAtsSender', () => {
  it('matches exact and subdomain ATS domains', () => {
    expect(isAtsSender(msg({ from: { name: 'x', address: 'a@greenhouse-mail.io' } }))).toBe(true);
    expect(isAtsSender(msg({ from: { name: 'x', address: 'a@mail.lever.co' } }))).toBe(true);
    expect(isAtsSender(msg({ from: { name: 'x', address: 'a@notion.so' } }))).toBe(false);
  });

  it('does not match a lookalike suffix', () => {
    expect(isAtsSender(msg({ from: { name: 'x', address: 'a@notgreenhouse.io' } }))).toBe(false);
    expect(isAtsSender(msg({ from: { name: 'x', address: 'a@evil-lever.co' } }))).toBe(false);
  });
});

describe('hasConfirmationPhrase', () => {
  it('matches phrases in the subject or body', () => {
    expect(hasConfirmationPhrase(msg({ subject: 'Application received', bodyPreview: '' }))).toBe(
      true,
    );
    expect(hasConfirmationPhrase(msg({ subject: 'Hi', bodyPreview: 'Thanks for applying!' }))).toBe(
      true,
    );
    expect(hasConfirmationPhrase(msg({ subject: 'Weekly newsletter', bodyPreview: 'deals' }))).toBe(
      false,
    );
  });
});

describe('isApplicationConfirmation', () => {
  it('is true for an ATS sender even with unrelated wording', () => {
    expect(
      isApplicationConfirmation(
        msg({ subject: 'Update', bodyPreview: 'next steps in your process' }),
      ),
    ).toBe(true);
  });

  it('is true for a confirmation phrase from a non-ATS sender', () => {
    expect(
      isApplicationConfirmation(
        msg({
          from: { name: 'Acme Careers', address: 'jobs@acme.com' },
          subject: 'Thank you for applying to Acme',
          bodyPreview: '',
        }),
      ),
    ).toBe(true);
  });

  it('is false for an unrelated email', () => {
    expect(
      isApplicationConfirmation(
        msg({
          from: { name: 'LinkedIn', address: 'news@linkedin.com' },
          subject: 'Jobs you may like',
          bodyPreview: 'browse openings',
        }),
      ),
    ).toBe(false);
  });
});

describe('matchConfirmationToApplication', () => {
  const apps: PendingApplication[] = [
    { id: 1, company: 'Stripe, Inc.', confirmationEmailId: null },
    { id: 2, company: 'Notion Labs', confirmationEmailId: null },
  ];

  it('matches on the company in the subject (normalizing legal suffixes)', () => {
    expect(matchConfirmationToApplication(msg(), apps)?.id).toBe(1);
  });

  it('matches on the sender display name', () => {
    const m = msg({
      from: { name: 'Notion', address: 'no-reply@greenhouse-mail.io' },
      subject: 'Your application',
      bodyPreview: 'thanks',
    });
    expect(matchConfirmationToApplication(m, apps)?.id).toBe(2);
  });

  it('returns null when no application company appears', () => {
    const m = msg({ subject: 'Thank you for applying to Datadog', bodyPreview: '' });
    expect(matchConfirmationToApplication(m, apps)).toBeNull();
  });

  it('skips an already-confirmed application', () => {
    const confirmed: PendingApplication[] = [
      { id: 1, company: 'Stripe', confirmationEmailId: 'old-email' },
    ];
    expect(matchConfirmationToApplication(msg(), confirmed)).toBeNull();
  });
});

describe('reconcileConfirmations', () => {
  const apps: PendingApplication[] = [
    { id: 1, company: 'Stripe', confirmationEmailId: null },
    { id: 2, company: 'Notion', confirmationEmailId: null },
  ];

  it('produces one update per newly-confirmed application', () => {
    const messages = [
      msg({ id: 'e1', subject: 'Thank you for applying to Stripe' }),
      msg({
        id: 'e2',
        from: { name: 'Notion', address: 'no-reply@greenhouse-mail.io' },
        subject: 'Application received',
      }),
      msg({
        id: 'e3',
        from: { name: 'x', address: 'n@linkedin.com' },
        subject: 'jobs',
        bodyPreview: '',
      }),
    ];
    expect(reconcileConfirmations(messages, apps)).toEqual([
      { applicationId: 1, confirmedAt: '2026-07-20T10:00:00Z', confirmationEmailId: 'e1' },
      { applicationId: 2, confirmedAt: '2026-07-20T10:00:00Z', confirmationEmailId: 'e2' },
    ]);
  });

  it('claims each application at most once (first confirmation wins)', () => {
    const messages = [
      msg({
        id: 'e1',
        subject: 'Thank you for applying to Stripe',
        receivedAt: '2026-07-19T00:00:00Z',
      }),
      msg({
        id: 'e2',
        subject: 'Thank you for applying to Stripe',
        receivedAt: '2026-07-20T00:00:00Z',
      }),
    ];
    const updates = reconcileConfirmations(messages, apps);
    expect(updates).toHaveLength(1);
    expect(updates[0].confirmationEmailId).toBe('e1');
  });

  it('is idempotent: skips emails already recorded on an application', () => {
    const already: PendingApplication[] = [{ id: 1, company: 'Stripe', confirmationEmailId: 'e1' }];
    const messages = [msg({ id: 'e1', subject: 'Thank you for applying to Stripe' })];
    expect(reconcileConfirmations(messages, already)).toEqual([]);
  });
});
