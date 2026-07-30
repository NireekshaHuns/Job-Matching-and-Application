/**
 * Compliant outreach deep-links. We NEVER scrape LinkedIn (ToS) — instead we
 * build a prefilled people-search URL the user clicks and acts on in their own
 * logged-in session. Pure: no network, no stored PII.
 */

/** Role keyword presets for common outreach targets. */
export const ROLE_PRESETS = {
  recruiters: ['recruiter', 'technical recruiter', 'talent acquisition'],
  managers: ['engineering manager', 'hiring manager'],
  hr: ['human resources', 'people operations', 'hr business partner'],
} as const;

/** Quote a phrase, stripping embedded double-quotes so the expression can't break. */
function phrase(s: string): string {
  return `"${s.replace(/"/g, '')}"`;
}

function booleanKeywords(company: string, roles: readonly string[]): string {
  const roleClause = roles.map(phrase).join(' OR ');
  return `(${roleClause}) AND ${phrase(company)}`;
}

/**
 * LinkedIn people search (user must be logged in). Keyword-only = ID-free and
 * robust; best-effort — LinkedIn may not honor Boolean operators perfectly.
 */
export function linkedinPeopleSearch(company: string, roles: readonly string[]): string {
  const kw = encodeURIComponent(booleanKeywords(company, roles));
  return `https://www.linkedin.com/search/results/people/?keywords=${kw}&origin=FACETED_SEARCH`;
}

/** Google X-ray over public LinkedIn profiles (no login needed). */
export function googleXray(company: string, roles: readonly string[]): string {
  const roleClause = roles.map(phrase).join(' OR ');
  const q = encodeURIComponent(`site:linkedin.com/in (${roleClause}) ${phrase(company)}`);
  return `https://www.google.com/search?q=${q}`;
}

export interface OutreachLink {
  label: string;
  url: string;
}

/** The set of deep-links offered for a company. */
export function outreachLinks(company: string): OutreachLink[] {
  return [
    { label: 'Recruiters (LinkedIn)', url: linkedinPeopleSearch(company, ROLE_PRESETS.recruiters) },
    {
      label: 'Eng managers (LinkedIn)',
      url: linkedinPeopleSearch(company, ROLE_PRESETS.managers),
    },
    { label: 'HR / people (LinkedIn)', url: linkedinPeopleSearch(company, ROLE_PRESETS.hr) },
    {
      label: 'Google x-ray',
      url: googleXray(company, [...ROLE_PRESETS.managers, ...ROLE_PRESETS.recruiters]),
    },
  ];
}
