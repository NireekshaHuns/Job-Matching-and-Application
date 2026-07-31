import { describe, expect, it } from 'vitest';
import {
  buildApplicationUpdate,
  createApplicationInput,
  updateApplicationInput,
} from './applications';

describe('createApplicationInput', () => {
  it('requires a jobId and defaults status to applied', () => {
    expect(createApplicationInput.parse({ jobId: 5 })).toMatchObject({
      jobId: 5,
      status: 'applied',
    });
  });

  it('rejects a missing jobId and a bad status', () => {
    expect(() => createApplicationInput.parse({})).toThrow();
    expect(() => createApplicationInput.parse({ jobId: 5, status: 'ghosted' })).toThrow();
  });
});

describe('updateApplicationInput', () => {
  it('allows clearing snapshot/label with null and leaving them out', () => {
    expect(updateApplicationInput.parse({ id: 1, resumeSnapshot: null }).resumeSnapshot).toBeNull();
    expect(updateApplicationInput.parse({ id: 1, status: 'offer' }).status).toBe('offer');
    expect(updateApplicationInput.parse({ id: 1 })).toEqual({ id: 1 });
  });
});

describe('buildApplicationUpdate', () => {
  it('omits fields left undefined (no-op update)', () => {
    expect(buildApplicationUpdate({ id: 1 })).toEqual({});
  });

  it('clears a field set to null and updates provided ones', () => {
    expect(buildApplicationUpdate({ id: 1, resumeLabel: null })).toEqual({ resumeLabel: null });
    expect(buildApplicationUpdate({ id: 1, status: 'offer', resumeSnapshot: 'x' })).toEqual({
      status: 'offer',
      resumeSnapshot: 'x',
    });
  });

  it('sets the filing type when provided', () => {
    expect(buildApplicationUpdate({ id: 1, filingType: 'consular' })).toEqual({
      filingType: 'consular',
    });
    // Leaving it out is a no-op (not forced back to a default).
    expect(buildApplicationUpdate({ id: 1 })).toEqual({});
  });
});
