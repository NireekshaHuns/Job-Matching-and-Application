/**
 * Classify a person by their job title so outreach can target ~5 recruiters and
 * ~5 hiring managers for a SWE role. Pure and deterministic. Recruiter is checked
 * first so a "recruiting manager" is treated as a recruiter. Generic leadership
 * words (manager/director/vp/…) only count as a hiring manager in an engineering
 * context, so "Product Manager" / "Account Manager" / "VP of Sales" fall through
 * to "other" rather than being mistaken for SWE hiring managers.
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

/** Titles that are engineering hiring managers/leads regardless of extra context. */
const ENG_LEADER_TITLES = [
  'cto',
  'vp engineering',
  'vp of engineering',
  'head of engineering',
  'engineering lead',
  'eng lead',
  'lead engineer',
  'tech lead',
  'technical lead',
];

/** Generic leadership words — only a hiring manager when paired with an eng term. */
const LEADER_WORDS = ['manager', 'director', 'head of', 'vp', 'vice president', 'chief', 'lead'];

const ENG_TERMS = [
  'engineer',
  'engineering',
  'software',
  'swe',
  'platform',
  'infrastructure',
  'infra',
  'technical',
  'technology',
  'developer',
  'development',
  'devops',
  'sre',
  'backend',
  'frontend',
  'full stack',
  'fullstack',
  'mobile',
  'data',
  'machine learning',
];

export function categorizePerson(title: string | null | undefined): ContactKind {
  const t = ` ${(title ?? '').toLowerCase()} `;
  if (RECRUITER_HINTS.some((h) => t.includes(h))) return 'recruiter';
  if (ENG_LEADER_TITLES.some((h) => t.includes(h))) return 'manager';
  const isLeader = LEADER_WORDS.some((w) => t.includes(w));
  const isEng = ENG_TERMS.some((term) => t.includes(term));
  if (isLeader && isEng) return 'manager';
  return 'other';
}
