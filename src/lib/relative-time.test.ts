import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime } from './relative-time';

const NOW = new Date('2026-08-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('formatRelativeTime', () => {
  it('returns null for a missing or unparseable date', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime('', NOW)).toBeNull();
    expect(formatRelativeTime('not a date', NOW)).toBeNull();
  });

  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(formatRelativeTime(ago(20 * MINUTE), NOW)).toBe('20m ago');
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(formatRelativeTime(ago(5 * HOUR), NOW)).toBe('5h ago');
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3d ago');
  });

  it('switches unit exactly at each boundary', () => {
    expect(formatRelativeTime(ago(HOUR - 1), NOW)).toBe('59m ago');
    expect(formatRelativeTime(ago(DAY - 1), NOW)).toBe('23h ago');
    expect(formatRelativeTime(ago(WEEK - 1), NOW)).toBe('6d ago');
    expect(formatRelativeTime(ago(WEEK), NOW)).toBe('1w ago');
  });

  it('caps at "over 2mo ago" once weeks stop being useful', () => {
    expect(formatRelativeTime(ago(8 * WEEK), NOW)).toBe('8w ago');
    expect(formatRelativeTime(ago(9 * WEEK), NOW)).toBe('over 2mo ago');
    expect(formatRelativeTime(ago(52 * WEEK), NOW)).toBe('over 2mo ago');
  });

  it('clamps a future timestamp to "just now" rather than counting up', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 3 * MINUTE), NOW)).toBe('just now');
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(formatRelativeTime('2026-08-12T07:00:00.000Z', NOW)).toBe('5h ago');
  });
});

describe('formatAbsoluteTime', () => {
  it('returns null when the date is missing or invalid', () => {
    expect(formatAbsoluteTime(null)).toBeNull();
    expect(formatAbsoluteTime('nope')).toBeNull();
  });

  it('renders a human timestamp for the tooltip', () => {
    // Locale-dependent formatting, so assert it produced something date-like
    // rather than pinning an exact string.
    const out = formatAbsoluteTime('2026-08-12T07:00:00.000Z');
    expect(out).toBeTruthy();
    expect(out).toMatch(/2026/);
  });
});
