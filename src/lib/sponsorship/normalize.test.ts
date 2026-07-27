import { describe, expect, it } from 'vitest';
import { companyKeysMatch, normalizeCompanyName } from './normalize';

describe('normalizeCompanyName', () => {
  it('returns empty string for nullish/empty input', () => {
    expect(normalizeCompanyName(null)).toBe('');
    expect(normalizeCompanyName(undefined)).toBe('');
    expect(normalizeCompanyName('')).toBe('');
    expect(normalizeCompanyName('   ')).toBe('');
  });

  it.each([
    ['Google', 'GOOGLE'],
    ['Google, Inc.', 'GOOGLE'],
    ['GOOGLE LLC', 'GOOGLE'],
    ['Google Inc', 'GOOGLE'],
    ['The Home Depot', 'HOME DEPOT'],
    ['Johnson & Johnson', 'JOHNSON AND JOHNSON'],
    ['  Stripe   Payments  ', 'STRIPE PAYMENTS'],
    ['Meta Platforms, Inc.', 'META PLATFORMS'],
    ['Acme Corp.', 'ACME'],
    ['Acme Corporation', 'ACME'],
    ['Palantir Technologies Inc.', 'PALANTIR TECHNOLOGIES'],
  ])('normalizes %j -> %j', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it('drops DBA / FKA clauses', () => {
    expect(normalizeCompanyName('Widgets LLC DBA WidgetCo')).toBe('WIDGETS');
    expect(normalizeCompanyName('Old Name Inc FKA New Name')).toBe('OLD NAME');
  });

  it('does not clip suffix letters that are part of a real word', () => {
    // "CO" is a suffix token but a substring of CISCO — must not be stripped.
    expect(normalizeCompanyName('Cisco Systems Inc')).toBe('CISCO SYSTEMS');
    // "US" is only stripped as a trailing token, not mid-name.
    expect(normalizeCompanyName('US Foods')).toBe('US FOODS');
  });

  it('never reduces a name to nothing even if it is only a suffix word', () => {
    expect(normalizeCompanyName('Limited')).toBe('LIMITED');
  });
});

describe('companyKeysMatch', () => {
  it('matches names that normalize equally', () => {
    expect(companyKeysMatch('Google, Inc.', 'GOOGLE LLC')).toBe(true);
    expect(companyKeysMatch('The Home Depot', 'Home Depot Inc')).toBe(true);
  });

  it('does not match different companies', () => {
    expect(companyKeysMatch('Google', 'Meta')).toBe(false);
  });

  it('never matches on empty keys', () => {
    expect(companyKeysMatch('', '')).toBe(false);
    expect(companyKeysMatch(null, undefined)).toBe(false);
  });
});
