import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_FACTS, formatProfileForPrompt, withProfileDefaults } from './profile';

describe('withProfileDefaults', () => {
  it('falls back to seed defaults for null/empty fields', () => {
    const merged = withProfileDefaults({ name: '', phone: null });
    expect(merged.name).toBe(DEFAULT_PROFILE_FACTS.name);
    expect(merged.gradDate).toBe(DEFAULT_PROFILE_FACTS.gradDate);
  });

  it('keeps provided values', () => {
    const merged = withProfileDefaults({ name: 'Ada Lovelace', phone: '+1 555 0100' });
    expect(merged.name).toBe('Ada Lovelace');
    expect(merged.phone).toBe('+1 555 0100');
  });

  it('handles a null row', () => {
    expect(withProfileDefaults(null)).toEqual(DEFAULT_PROFILE_FACTS);
  });
});

describe('formatProfileForPrompt', () => {
  it('includes fixed facts and the real-metrics section', () => {
    const out = formatProfileForPrompt(DEFAULT_PROFILE_FACTS);
    expect(out).toContain('Nireeksha Huns');
    expect(out.toLowerCase()).toContain('verified metrics');
    expect(out.toLowerCase()).toContain('fixed facts');
  });

  it('omits blank contact fields', () => {
    const out = formatProfileForPrompt(
      withProfileDefaults({ phone: null, linkedinUrl: null, githubUrl: null }),
    );
    expect(out).not.toContain('Phone:');
  });
});
