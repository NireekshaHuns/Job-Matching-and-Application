import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/server/db';
import type { Context } from '@/server/trpc/context';
import { createCaller } from '@/server/trpc/root';
import { addContactInput, logTouchInput, sendEmailInput } from './outreach';

/** Queued row-lists per `.select()` call (see resumes.test.ts for the pattern). */
function fakeDb(results: unknown[][]): DB {
  let call = 0;
  const chain = () => {
    const rows = results[call++] ?? [];
    const thenable = {
      from: () => thenable,
      where: () => thenable,
      limit: () => Promise.resolve(rows),
      then: (res: (v: unknown) => unknown) => res(rows),
    };
    return thenable;
  };
  return { select: chain } as unknown as DB;
}
function caller(results: unknown[][]) {
  return createCaller({ db: fakeDb(results) } as Context);
}

describe('addContactInput', () => {
  it('requires a jobId and a name', () => {
    expect(() => addContactInput.parse({ jobId: 1 })).toThrow();
    expect(() => addContactInput.parse({ name: 'Jane' })).toThrow();
    expect(addContactInput.parse({ jobId: 1, name: 'Jane' })).toMatchObject({ name: 'Jane' });
  });

  it('validates the linkedin URL when provided', () => {
    expect(() =>
      addContactInput.parse({ jobId: 1, name: 'Jane', linkedinUrl: 'not-a-url' }),
    ).toThrow();
    expect(
      addContactInput.parse({ jobId: 1, name: 'Jane', linkedinUrl: 'https://linkedin.com/in/jane' })
        .linkedinUrl,
    ).toBe('https://linkedin.com/in/jane');
  });

  it('validates the email when provided', () => {
    expect(() => addContactInput.parse({ jobId: 1, name: 'Jane', email: 'nope' })).toThrow();
    expect(addContactInput.parse({ jobId: 1, name: 'Jane', email: 'jane@acme.com' }).email).toBe(
      'jane@acme.com',
    );
  });
});

describe('sendEmailInput', () => {
  it('requires a contactId, non-empty subject, and non-empty body', () => {
    expect(() => sendEmailInput.parse({ contactId: 1, subject: '', body: 'hi' })).toThrow();
    expect(() => sendEmailInput.parse({ contactId: 1, subject: 'hi', body: '' })).toThrow();
    expect(() => sendEmailInput.parse({ subject: 'hi', body: 'there' })).toThrow();
    expect(sendEmailInput.parse({ contactId: 1, subject: 'hi', body: 'there' })).toEqual({
      contactId: 1,
      subject: 'hi',
      body: 'there',
    });
  });
});

describe('logTouchInput', () => {
  it('defaults the channel to linkedin and validates the enum', () => {
    expect(logTouchInput.parse({ contactId: 1 }).channel).toBe('linkedin');
    expect(logTouchInput.parse({ contactId: 1, channel: 'email' }).channel).toBe('email');
    expect(() => logTouchInput.parse({ contactId: 1, channel: 'carrier-pigeon' })).toThrow();
  });
});

describe('outreach.draftEmail (fit-aware, template path)', () => {
  // Force the deterministic template so we can assert the fit line without an LLM.
  afterEach(() => vi.unstubAllEnvs());
  const noKey = () => vi.stubEnv('OPENAI_API_KEY', '');

  it('drafts without a fit line when no jobId is given', async () => {
    noKey();
    const res = await caller([]).outreach.draftEmail({ company: 'Ramp' });
    expect(res.source).toBe('template');
    expect(res.body.toLowerCase()).not.toContain('strong fit');
  });

  it('drafts without a fit line when the job is not found', async () => {
    noKey();
    // First select (the job lookup) returns no rows -> loadFitSkills bails out.
    const res = await caller([[]]).outreach.draftEmail({ company: 'Ramp', jobId: 999 });
    expect(res.source).toBe('template');
    expect(res.body.toLowerCase()).not.toContain('strong fit');
  });

  it('weaves in the sender skills that match the job', async () => {
    noKey();
    const res = await caller([
      [{ techKeywords: ['go', 'kafka'], softKeywords: [] }], // job
      [{ skill: 'go' }, { skill: 'kafka' }], // master skills
      [{ skills: ['go'], roleFamily: 'backend' }], // bullets
    ]).outreach.draftEmail({ company: 'Ramp', jobId: 1 });

    expect(res.source).toBe('template');
    expect(res.body.toLowerCase()).toContain('strong fit');
    expect(res.body).toContain('go, kafka'); // only truthful matched/addable skills
  });
});
