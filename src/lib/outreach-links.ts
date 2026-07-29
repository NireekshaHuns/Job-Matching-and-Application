/**
 * Compliant outreach deep-links. We NEVER scrape LinkedIn (ToS) — instead we
 * build a prefilled people-search URL the user clicks and acts on in their own
 * logged-in session. Pure: no network, no stored PII.
 */

/** Role keyword presets for common outreach targets. */
export const ROLE_PRESETS = {
  recruiters: ['recruiter', 'technical recruiter', 'talent acquisition'],
  managers: ['engineering manager', 'hiring manager'],
} as const;

function booleanKeywords(company: string, roles: readonly string[]): string {
  const roleClause = roles.map((r) => `"${r}"`).join(' OR ');
  return `(${roleClause}) AND "${company}"`;
}

/** LinkedIn people search (user must be logged in). Keyword-only = ID-free/robust. */
export function linkedinPeopleSearch(company: string, roles: readonly string[]): string {
  const kw = encodeURIComponent(booleanKeywords(company, roles));
  return `https://www.linkedin.com/search/results/people/?keywords=${kw}&origin=FACETED_SEARCH`;
}

/** Google X-ray over public LinkedIn profiles (no login needed). */
export function googleXray(company: string, roles: readonly string[]): string {
  const roleClause = roles.map((r) => `"${r}"`).join(' OR ');
  const q = encodeURIComponent(`site:linkedin.com/in (${roleClause}) "${company}"`);
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
    {
      label: 'Google x-ray',
      url: googleXray(company, [...ROLE_PRESETS.recruiters, ...ROLE_PRESETS.managers]),
    },
  ];
}
