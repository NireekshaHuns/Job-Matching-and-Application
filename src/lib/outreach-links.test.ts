import { describe, expect, it } from 'vitest';
import { googleXray, linkedinPeopleSearch, outreachLinks, ROLE_PRESETS } from './outreach-links';

describe('linkedinPeopleSearch', () => {
  it('builds a boolean, URL-encoded people-search link', () => {
    const url = linkedinPeopleSearch('Stripe', ROLE_PRESETS.recruiters);
    expect(url.startsWith('https://www.linkedin.com/search/results/people/?keywords=')).toBe(true);
    const kw = decodeURIComponent(new URL(url).searchParams.get('keywords') ?? '');
    expect(kw).toBe('("recruiter" OR "technical recruiter" OR "talent acquisition") AND "Stripe"');
  });
});

describe('googleXray', () => {
  it('scopes to public LinkedIn profiles with role + company', () => {
    const url = googleXray('Stripe', ROLE_PRESETS.managers);
    const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
    expect(q).toBe('site:linkedin.com/in ("engineering manager" OR "hiring manager") "Stripe"');
  });
});

describe('encoding edge cases', () => {
  it('encodes ampersands/spaces and strips embedded quotes', () => {
    const url = linkedinPeopleSearch('A & B "Inc"', ['recruiter']);
    const kw = decodeURIComponent(new URL(url).searchParams.get('keywords') ?? '');
    expect(kw).toBe('("recruiter") AND "A & B Inc"');
  });
});

describe('outreachLinks', () => {
  it('offers recruiter, manager, and x-ray links for a company', () => {
    const labels = outreachLinks('Acme').map((l) => l.label);
    expect(labels).toEqual(['Recruiters (LinkedIn)', 'Eng managers (LinkedIn)', 'Google x-ray']);
    expect(outreachLinks('Acme').every((l) => l.url.includes('Acme'))).toBe(true);
  });
});
