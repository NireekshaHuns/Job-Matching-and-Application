import { describe, expect, it } from 'vitest';
import { setProfileInput } from './profile';

describe('setProfileInput', () => {
  it('accepts YYYY-MM-DD dates or null', () => {
    expect(setProfileInput.parse({ optEndDate: '2027-05-01', stemOptEndDate: null })).toEqual({
      optEndDate: '2027-05-01',
      stemOptEndDate: null,
    });
  });

  it('rejects malformed dates and missing keys', () => {
    expect(() =>
      setProfileInput.parse({ optEndDate: '05/01/2027', stemOptEndDate: null }),
    ).toThrow();
    expect(() => setProfileInput.parse({ optEndDate: '2027-05-01' })).toThrow();
  });
});
