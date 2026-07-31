/**
 * People-finder orchestration: build the enabled providers from configured API
 * keys (feature no-ops when none are set), fan out a query, and merge/dedup the
 * results. Providers are injected so this is unit-testable without the network.
 */
import { apolloProvider } from './apollo';
import { hunterProvider } from './hunter';
import type { Fetcher, PeopleProvider, PeopleQuery, PersonResult } from './types';

export type { PeopleProvider, PeopleQuery, PersonResult } from './types';
export { mapHunter } from './hunter';
export { mapApollo } from './apollo';

export interface PeopleKeys {
  hunterKey?: string;
  apolloKey?: string;
}

/** Providers for which an API key is present. Empty ⇒ the feature is disabled. */
export function buildPeopleProviders(
  keys: PeopleKeys,
  fetcher: Fetcher = globalThis.fetch,
): PeopleProvider[] {
  const providers: PeopleProvider[] = [];
  if (keys.hunterKey) providers.push(hunterProvider(keys.hunterKey, fetcher));
  if (keys.apolloKey) providers.push(apolloProvider(keys.apolloKey, fetcher));
  return providers;
}

/** Stable dedup key: the email if present, else name + title. */
function dedupKey(p: PersonResult): string {
  return p.email ? `e:${p.email.toLowerCase()}` : `n:${p.name.toLowerCase()}|${p.title ?? ''}`;
}

/**
 * Run all providers and merge results. On a duplicate person, prefer the entry
 * that has an email, then the higher confidence. Sorted: has-email first, then
 * by confidence desc, then name — the most actionable contacts on top.
 */
export async function findPeople(
  providers: PeopleProvider[],
  query: PeopleQuery,
): Promise<PersonResult[]> {
  const settled = await Promise.all(providers.map((p) => p.find(query)));

  const byKey = new Map<string, PersonResult>();
  for (const person of settled.flat()) {
    const key = dedupKey(person);
    const existing = byKey.get(key);
    if (!existing || preferOver(person, existing)) byKey.set(key, person);
  }

  return [...byKey.values()].sort((a, b) => {
    const ae = a.email ? 0 : 1;
    const be = b.email ? 0 : 1;
    if (ae !== be) return ae - be;
    const ac = a.emailConfidence ?? -1;
    const bc = b.emailConfidence ?? -1;
    if (ac !== bc) return bc - ac;
    return a.name.localeCompare(b.name);
  });
}

/** Prefer a candidate that adds an email, or a higher confidence. */
function preferOver(candidate: PersonResult, existing: PersonResult): boolean {
  if (Boolean(candidate.email) !== Boolean(existing.email)) return Boolean(candidate.email);
  return (candidate.emailConfidence ?? -1) > (existing.emailConfidence ?? -1);
}
