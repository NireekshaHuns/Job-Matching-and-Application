/**
 * Visa-timeline nudges (spec §5.5) — derive time-sensitive reminders from the
 * user's OPT / STEM-OPT end dates plus the fixed annual ~March H-1B cap
 * registration cycle.
 *
 * Pure and deterministic: `now` is injected. These are CALENDAR reminders only
 * — no wage-level or lottery-odds modeling (out of scope, spec §4). All dates
 * are handled at UTC midnight so a nudge never flickers with the server tz.
 */

export type NudgeLevel = 'info' | 'warning' | 'urgent';

export interface VisaNudge {
  /** Stable key for rendering. */
  id: string;
  level: NudgeLevel;
  title: string;
  detail: string;
  /** Whole days until the relevant date (negative = past); omitted for season windows. */
  daysUntil?: number;
}

export interface VisaProfileDates {
  optEndDate: string | null;
  stemOptEndDate: string | null;
}

/** Within this many days of an end date → a warning; within the info window → info. */
export const WARN_DAYS = 90;
export const INFO_DAYS = 180;
/** Show the "cap season approaching" info nudge within this many days of March 1. */
export const CAP_APPROACH_DAYS = 60;
/** H-1B electronic registration opens ~early March (0-indexed month = 2). */
const CAP_MONTH = 2;

/** ms at UTC midnight for a Date or a `YYYY-MM-DD` string. */
function utcMidnight(value: Date | string): number {
  const d = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `now` to `target` (negative when `target` is in the past). */
function daysUntil(target: Date | string, now: Date): number {
  return Math.round((utcMidnight(target) - utcMidnight(now)) / 86_400_000);
}

/** Build the OPT / STEM-OPT nudge for one end date, or null if not time-sensitive. */
function endDateNudge(
  kind: 'OPT' | 'STEM-OPT',
  dateStr: string | null,
  now: Date,
): VisaNudge | null {
  if (!dateStr) return null;
  const days = daysUntil(dateStr, now);
  const id = `${kind.toLowerCase()}-end`;
  const nextStep =
    kind === 'OPT'
      ? 'file the STEM-OPT extension (if eligible) or line up H-1B sponsorship'
      : 'ensure an H-1B cap registration / other status is in motion';

  if (days < 0) {
    return {
      id,
      level: 'urgent',
      title: `${kind} ended ${Math.abs(days)} days ago`,
      detail: `Your ${kind} end date (${dateStr}) has passed — confirm your current work authorization.`,
      daysUntil: days,
    };
  }
  if (days <= WARN_DAYS) {
    return {
      id,
      level: 'warning',
      title: `${kind} ends in ${days} days`,
      detail: `${kind} ends ${dateStr} — ${nextStep}.`,
      daysUntil: days,
    };
  }
  if (days <= INFO_DAYS) {
    return {
      id,
      level: 'info',
      title: `${kind} ends in ${days} days`,
      detail: `${kind} ends ${dateStr}. Start planning ${nextStep}.`,
      daysUntil: days,
    };
  }
  return null;
}

/** The annual H-1B cap-registration reminder (calendar-based, approximate). */
function capCycleNudge(now: Date): VisaNudge | null {
  const month = now.getUTCMonth();
  // Registration is typically open during March.
  if (month === CAP_MONTH) {
    return {
      id: 'h1b-cap-open',
      level: 'warning',
      title: 'H-1B cap registration is typically open now (~March)',
      detail:
        'The electronic registration window is usually early–mid March. Confirm a sponsoring employer submits your registration before it closes.',
    };
  }
  // Approaching: only meaningful in the weeks before March 1.
  const target = new Date(Date.UTC(now.getUTCFullYear(), CAP_MONTH, 1));
  const days = daysUntil(target, now);
  if (days >= 0 && days <= CAP_APPROACH_DAYS) {
    return {
      id: 'h1b-cap-approaching',
      level: 'info',
      title: `H-1B cap registration (~March) is ${days} days away`,
      detail:
        'The annual registration window opens ~early March. Line up an employer willing to register you.',
      daysUntil: days,
    };
  }
  return null;
}

/**
 * All active visa nudges, most-urgent first (urgent → warning → info), then by
 * soonest date. Returns [] when nothing is time-sensitive.
 */
export function computeVisaNudges(profile: VisaProfileDates, now: Date = new Date()): VisaNudge[] {
  const nudges = [
    endDateNudge('OPT', profile.optEndDate, now),
    endDateNudge('STEM-OPT', profile.stemOptEndDate, now),
    capCycleNudge(now),
  ].filter((n): n is VisaNudge => n !== null);

  const order: Record<NudgeLevel, number> = { urgent: 0, warning: 1, info: 2 };
  return nudges.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    return (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity);
  });
}
