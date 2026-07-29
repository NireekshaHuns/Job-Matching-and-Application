import { describe, expect, it } from 'vitest';
import { addContactInput, logTouchInput } from './outreach';

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
});

describe('logTouchInput', () => {
  it('defaults the channel to linkedin and validates the enum', () => {
    expect(logTouchInput.parse({ contactId: 1 }).channel).toBe('linkedin');
    expect(logTouchInput.parse({ contactId: 1, channel: 'email' }).channel).toBe('email');
    expect(() => logTouchInput.parse({ contactId: 1, channel: 'carrier-pigeon' })).toThrow();
  });
});
