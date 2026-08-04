/**
 * Classify a person by their job title so outreach can target ~5 recruiters and
 * ~5 hiring managers. Pure and deterministic. Recruiter is checked first so a
 * "recruiting manager" is treated as a recruiter, not a hiring manager.
 */
export type ContactKind = 'recruiter' | 'manager' | 'other';

const RECRUITER_HINTS = [
  'recruit',
  'talent',
  'sourcer',
  'sourcing',
  'staffing',
  'people ops',
  'people operations',
  'human resources',
  ' hr ',
  'acquisition',
];

const MANAGER_HINTS = [
  'manager',
  'director',
  'head of',
  'vp',
  'vice president',
  'chief',
  'cto',
  'lead engineer',
  'engineering lead',
  'eng lead',
  'team lead',
];

export function categorizePerson(title: string | null | undefined): ContactKind {
  const t = ` ${(title ?? '').toLowerCase()} `;
  if (RECRUITER_HINTS.some((h) => t.includes(h))) return 'recruiter';
  if (MANAGER_HINTS.some((h) => t.includes(h))) return 'manager';
  return 'other';
}
