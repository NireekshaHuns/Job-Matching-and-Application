/**
 * Hunter.io provider — domain-search API
 * (`api.hunter.io/v2/domain-search`). Accepts a `domain` or, when we only have a
 * name, a `company` (Hunter resolves the domain). Returns emails with names,
 * positions, and a 0–100 confidence.
 */
import type { Fetcher, PeopleProvider, PeopleQuery, PersonResult } from './types';

const SOURCE = 'hunter';
const API = 'https://api.hunter.io/v2/domain-search';
const LIMIT = 25;

interface HunterEmail {
  value?: string;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  confidence?: number | null;
}
interface HunterResponse {
  data?: { emails?: HunterEmail[] };
}

/** Pure: map a Hunter response body to `PersonResult`s (skips entries with no email). */
export function mapHunter(body: HunterResponse): PersonResult[] {
  const out: PersonResult[] = [];
  for (const e of body.data?.emails ?? []) {
    const email = e.value?.trim();
    if (!email) continue;
    const name = [e.first_name, e.last_name]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(' ');
    out.push({
      name: name || email,
      title: e.position?.trim() || null,
      email,
      emailConfidence: typeof e.confidence === 'number' ? e.confidence : null,
      source: SOURCE,
    });
  }
  return out;
}

export function hunterProvider(
  apiKey: string,
  fetcher: Fetcher = globalThis.fetch,
): PeopleProvider {
  return {
    source: SOURCE,
    async find(query: PeopleQuery): Promise<PersonResult[]> {
      const params = new URLSearchParams({ api_key: apiKey, limit: String(LIMIT) });
      if (query.domain?.trim()) params.set('domain', query.domain.trim());
      else params.set('company', query.company);

      try {
        const res = await fetcher(`${API}?${params.toString()}`);
        if (!res.ok) {
          console.warn(`[hunter] domain-search -> HTTP ${res.status}`);
          return [];
        }
        return mapHunter((await res.json()) as HunterResponse);
      } catch (err) {
        console.warn(`[hunter] domain-search failed: ${String(err)}`);
        return [];
      }
    },
  };
}
