/**
 * Discover ATS board tokens from posting apply-URLs. SimplifyJobs listings link
 * to employer ATS boards, so we can harvest Greenhouse/Lever/Ashby tokens (with
 * the company name) to auto-seed the direct-JD connectors. Pure.
 */
import type { AshbyBoard } from './connectors/ashby';
import type { GreenhouseBoard } from './connectors/greenhouse';
import type { LeverBoard } from './connectors/lever';

// Host is anchored to a boundary (start, `//`, or a subdomain dot) so a token
// only matches a real ATS host — not one embedded in a redirect/tracking query
// like `https://evil.com/?u=boards.greenhouse.io/x`.
const HOST = String.raw`(?:^|\/\/|\.)`;
// Greenhouse path after the host, up to the query string.
const GREENHOUSE_PATH_RE = new RegExp(
  `${HOST}(?:boards|job-boards)\\.greenhouse\\.io\\/([^?\\s]*)`,
  'i',
);
// Embed apply URLs (`.../embed/job_app?for=<token>`) carry the real token in the
// `for=` param; the path segment is the literal `embed`, which must be ignored.
const GREENHOUSE_FOR_RE = /[?&]for=([a-z0-9_-]+)/i;
// Lever/Ashby slugs can contain a dot (e.g. `openai.com`), so keep `.` in the class.
const LEVER_RE = new RegExp(`${HOST}jobs\\.lever\\.co\\/([a-z0-9._-]+)`, 'i');
const ASHBY_RE = new RegExp(`${HOST}jobs\\.ashbyhq\\.com\\/([a-z0-9._-]+)`, 'i');

/** Greenhouse board token from an apply URL, handling both path and `embed` shapes. */
function greenhouseToken(url: string): string | undefined {
  const path = GREENHOUSE_PATH_RE.exec(url)?.[1];
  if (path === undefined) return undefined;
  if (/^embed(?:\/|$)/i.test(path)) return GREENHOUSE_FOR_RE.exec(url)?.[1];
  return /^([a-z0-9_-]+)/i.exec(path)?.[1];
}

export interface DiscoveredBoards {
  greenhouse: GreenhouseBoard[];
  lever: LeverBoard[];
  ashby: AshbyBoard[];
}

export interface DiscoverablePosting {
  url: string;
  company: string;
}

/** Extract deduped ATS boards from postings' apply URLs (first company wins). */
export function extractAtsBoards(postings: DiscoverablePosting[]): DiscoveredBoards {
  // Key by lowercased token (case-insensitive dedupe) but keep the original-case
  // token in the value: Greenhouse tokens are case-sensitive in the API path, so
  // we must not lowercase what we emit.
  type Entry = { token: string; company: string };
  const greenhouse = new Map<string, Entry>();
  const lever = new Map<string, Entry>();
  const ashby = new Map<string, Entry>();

  const add = (map: Map<string, Entry>, token: string | undefined, company: string) => {
    if (!token) return;
    const key = token.toLowerCase();
    if (!map.has(key) && company.trim()) map.set(key, { token, company: company.trim() });
  };

  for (const p of postings) {
    const url = p.url ?? '';
    add(greenhouse, greenhouseToken(url), p.company);
    add(lever, LEVER_RE.exec(url)?.[1], p.company);
    add(ashby, ASHBY_RE.exec(url)?.[1], p.company);
  }

  return {
    greenhouse: [...greenhouse.values()].map(({ token, company }) => ({ token, company })),
    lever: [...lever.values()].map(({ token, company }) => ({ token, company })),
    ashby: [...ashby.values()].map(({ token, company }) => ({ board: token, company })),
  };
}
