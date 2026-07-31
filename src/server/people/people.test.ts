import { describe, expect, it, vi } from 'vitest';
import { apolloProvider, mapApollo } from './apollo';
import { buildPeopleProviders, findPeople } from './index';
import { hunterProvider, mapHunter } from './hunter';
import type { PeopleProvider, PersonResult } from './types';

const HUNTER_BODY = {
  data: {
    emails: [
      {
        value: 'jane@acme.com',
        first_name: 'Jane',
        last_name: 'Doe',
        position: 'Technical Recruiter',
        confidence: 92,
      },
      { value: '', first_name: 'No', last_name: 'Email' }, // skipped (no email)
    ],
  },
};

const APOLLO_BODY = {
  people: [
    { name: 'Sam Lin', title: 'Engineering Manager', email: 'sam@acme.com' },
    {
      first_name: 'Locked',
      last_name: 'Person',
      title: 'Recruiter',
      email: 'email_not_unlocked@domain.com',
    },
    { title: 'No Name' }, // skipped (no name)
  ],
};

describe('mapHunter', () => {
  it('maps emails with names/positions/confidence and skips entries with no email', () => {
    const rows = mapHunter(HUNTER_BODY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: 'Jane Doe',
      title: 'Technical Recruiter',
      email: 'jane@acme.com',
      emailConfidence: 92,
      source: 'hunter',
    });
  });
});

describe('mapApollo', () => {
  it('maps people and nulls a locked/placeholder email', () => {
    const rows = mapApollo(APOLLO_BODY);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Sam Lin', email: 'sam@acme.com', source: 'apollo' });
    // Placeholder "not unlocked" email is not surfaced as a real address.
    expect(rows[1]).toMatchObject({ name: 'Locked Person', email: null });
  });
});

describe('hunterProvider', () => {
  it('queries by domain when given and returns [] on a non-OK response', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(HUNTER_BODY), { status: 200 }),
    );
    const rows = await hunterProvider('k', fetcher).find({ company: 'Acme', domain: 'acme.com' });
    expect(rows).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toContain('domain=acme.com');

    const bad = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('', { status: 429 }),
    );
    expect(await hunterProvider('k', bad).find({ company: 'Acme' })).toEqual([]);
    // Falls back to company= when no domain is given.
    expect(bad.mock.calls[0][0]).toContain('company=Acme');
  });
});

describe('apolloProvider', () => {
  it('POSTs with the X-Api-Key header and returns [] on a non-OK response', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(APOLLO_BODY), { status: 200 }),
    );
    const rows = await apolloProvider('k', fetcher).find({ company: 'Acme', roles: ['recruiter'] });
    expect(rows).toHaveLength(2);
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('k');

    const bad = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('', { status: 401 }),
    );
    expect(await apolloProvider('k', bad).find({ company: 'Acme' })).toEqual([]);
  });
});

describe('buildPeopleProviders', () => {
  it('enables only providers whose key is set', () => {
    expect(buildPeopleProviders({}).map((p) => p.source)).toEqual([]);
    expect(buildPeopleProviders({ hunterKey: 'h' }).map((p) => p.source)).toEqual(['hunter']);
    expect(buildPeopleProviders({ hunterKey: 'h', apolloKey: 'a' }).map((p) => p.source)).toEqual([
      'hunter',
      'apollo',
    ]);
  });
});

describe('findPeople', () => {
  const person = (over: Partial<PersonResult>): PersonResult => ({
    name: 'X',
    title: null,
    email: null,
    emailConfidence: null,
    source: 't',
    ...over,
  });
  const provider = (rows: PersonResult[]): PeopleProvider => ({
    source: 'p',
    find: async () => rows,
  });

  it('merges providers, dedups by email preferring the richer entry, sorts email-first', async () => {
    const a = provider([
      person({ name: 'Jane', email: 'jane@acme.com', emailConfidence: 80, source: 'apollo' }),
      person({ name: 'NoEmail', title: 'Eng' }),
    ]);
    const b = provider([
      // Same email as Jane but higher confidence -> should win.
      person({ name: 'Jane', email: 'JANE@acme.com', emailConfidence: 95, source: 'hunter' }),
    ]);

    const rows = await findPeople([a, b], { company: 'Acme' });
    expect(rows).toHaveLength(2);
    // Email-bearing, higher-confidence Jane first.
    expect(rows[0]).toMatchObject({ email: 'JANE@acme.com', emailConfidence: 95 });
    expect(rows[1].name).toBe('NoEmail');
  });
});
