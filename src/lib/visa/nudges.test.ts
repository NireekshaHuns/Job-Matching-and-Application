import { describe, expect, it } from 'vitest';
import { computeVisaNudges, type VisaProfileDates } from './nudges';

const NONE: VisaProfileDates = { optEndDate: null, stemOptEndDate: null };
/** A day well outside the cap window (mid-July) so date nudges are tested in isolation. */
const JULY = new Date('2026-07-15T12:00:00Z');

function ids(profile: VisaProfileDates, now = JULY) {
  return computeVisaNudges(profile, now).map((n) => n.id);
}

describe('computeVisaNudges — OPT / STEM-OPT', () => {
  it('returns nothing when no dates are set (outside cap season)', () => {
    expect(computeVisaNudges(NONE, JULY)).toEqual([]);
  });

  it('warns when OPT ends within 90 days', () => {
    const [n] = computeVisaNudges({ optEndDate: '2026-08-30', stemOptEndDate: null }, JULY);
    expect(n.id).toBe('opt-end');
    expect(n.level).toBe('warning');
    expect(n.daysUntil).toBe(46);
  });

  it('is info (not warning) when OPT ends within the 90–180 day window', () => {
    const [n] = computeVisaNudges({ optEndDate: '2026-12-01', stemOptEndDate: null }, JULY);
    expect(n.level).toBe('info');
  });

  it('is silent when an end date is beyond the info window', () => {
    expect(ids({ optEndDate: '2027-06-01', stemOptEndDate: null })).toEqual([]);
  });

  it('treats the exact 90-day and 180-day boundaries inclusively', () => {
    // From 2026-07-15: +90d = 2026-10-13 (warning), +180d = 2027-01-11 (info).
    const at90 = computeVisaNudges({ optEndDate: '2026-10-13', stemOptEndDate: null }, JULY)[0];
    expect(at90.daysUntil).toBe(90);
    expect(at90.level).toBe('warning');
    const at180 = computeVisaNudges({ optEndDate: '2027-01-11', stemOptEndDate: null }, JULY)[0];
    expect(at180.daysUntil).toBe(180);
    expect(at180.level).toBe('info');
  });

  it('handles a leap-day "now" without off-by-one', () => {
    const leap = new Date('2028-02-29T12:00:00Z');
    const [n] = computeVisaNudges({ optEndDate: '2028-03-30', stemOptEndDate: null }, leap);
    expect(n.daysUntil).toBe(30);
    expect(n.level).toBe('warning');
  });

  it('flags an expired OPT as urgent with a negative daysUntil', () => {
    const [n] = computeVisaNudges({ optEndDate: '2026-06-01', stemOptEndDate: null }, JULY);
    expect(n.level).toBe('urgent');
    expect(n.daysUntil).toBeLessThan(0);
  });

  it('orders urgent before warning before info', () => {
    const nudges = computeVisaNudges(
      { optEndDate: '2026-06-01' /* expired -> urgent */, stemOptEndDate: '2026-08-01' /* warn */ },
      JULY,
    );
    expect(nudges.map((n) => n.level)).toEqual(['urgent', 'warning']);
  });
});

describe('computeVisaNudges — H-1B cap cycle', () => {
  it('warns during March (registration typically open)', () => {
    const march = new Date('2026-03-10T12:00:00Z');
    const cap = computeVisaNudges(NONE, march);
    expect(cap.map((n) => n.id)).toContain('h1b-cap-open');
    expect(cap[0].level).toBe('warning');
  });

  it('gives an approaching info nudge within ~60 days before March', () => {
    const jan = new Date('2026-01-20T12:00:00Z'); // ~40 days before Mar 1
    const [n] = computeVisaNudges(NONE, jan);
    expect(n.id).toBe('h1b-cap-approaching');
    expect(n.level).toBe('info');
    expect(n.daysUntil).toBeGreaterThan(0);
  });

  it('is silent about the cap cycle in the off-season (e.g. July)', () => {
    expect(ids(NONE, JULY)).not.toContain('h1b-cap-approaching');
    expect(ids(NONE, JULY)).not.toContain('h1b-cap-open');
  });

  it('fires the approaching nudge at exactly 60 days out, silent at 61', () => {
    // 2025-12-31 → 2026-03-01 is 60 days; 2025-12-30 is 61 (rolls to next March).
    expect(ids(NONE, new Date('2025-12-31T12:00:00Z'))).toContain('h1b-cap-approaching');
    expect(ids(NONE, new Date('2025-12-30T12:00:00Z'))).not.toContain('h1b-cap-approaching');
  });
});
