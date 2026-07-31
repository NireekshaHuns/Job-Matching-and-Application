/**
 * Apollo.io provider — people search API
 * (`api.apollo.io/v1/mixed_people/search`, `X-Api-Key` header). Searches by
 * organization name/domain and optional title keywords. Apollo often withholds
 * the real email until it's "unlocked" (returns a placeholder); those are mapped
 * to a null email rather than surfaced as real.
 */
import type { Fetcher, PeopleProvider, PeopleQuery, PersonResult } from './types';

const SOURCE = 'apollo';
const API = 'https://api.apollo.io/v1/mixed_people/search';
const PER_PAGE = 25;

interface ApolloPerson {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
}
interface ApolloResponse {
  people?: ApolloPerson[];
}

/** A locked/placeholder Apollo email carries no real value. */
function realEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  if (!e || !e.includes('@')) return null;
  if (e.includes('not_unlocked') || e.includes('email_not_found') || e.startsWith('email_')) {
    return null;
  }
  return e;
}

/** Pure: map an Apollo response body to `PersonResult`s (skips entries with no name). */
export function mapApollo(body: ApolloResponse): PersonResult[] {
  const out: PersonResult[] = [];
  for (const p of body.people ?? []) {
    const name =
      p.name?.trim() ||
      [p.first_name, p.last_name]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(' ');
    if (!name) continue;
    out.push({
      name,
      title: p.title?.trim() || null,
      email: realEmail(p.email),
      emailConfidence: null, // Apollo doesn't return a confidence score.
      source: SOURCE,
    });
  }
  return out;
}

export function apolloProvider(
  apiKey: string,
  fetcher: Fetcher = globalThis.fetch,
): PeopleProvider {
  return {
    source: SOURCE,
    async find(query: PeopleQuery): Promise<PersonResult[]> {
      const body: Record<string, unknown> = {
        page: 1,
        per_page: PER_PAGE,
        organization_names: [query.company],
      };
      if (query.domain?.trim()) body.q_organization_domains = query.domain.trim();
      if (query.roles?.length) body.person_titles = query.roles;

      try {
        const res = await fetcher(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.warn(`[apollo] people search -> HTTP ${res.status}`);
          return [];
        }
        return mapApollo((await res.json()) as ApolloResponse);
      } catch (err) {
        console.warn(`[apollo] people search failed: ${String(err)}`);
        return [];
      }
    },
  };
}
