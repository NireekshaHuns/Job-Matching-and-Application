/**
 * Discover ATS board tokens from posting apply-URLs. SimplifyJobs listings link
 * to employer ATS boards, so we can harvest Greenhouse/Lever/Ashby tokens (with
 * the company name) to auto-seed the direct-JD connectors. Pure.
 */
import type { AshbyBoard } from './connectors/ashby';
import type { GreenhouseBoard } from './connectors/greenhouse';
import type { LeverBoard } from './connectors/lever';

const GREENHOUSE_RE = /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i;
const LEVER_RE = /jobs\.lever\.co\/([a-z0-9-]+)/i;
const ASHBY_RE = /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i;

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
  const greenhouse = new Map<string, string>();
  const lever = new Map<string, string>();
  const ashby = new Map<string, string>();

  const add = (map: Map<string, string>, token: string | undefined, company: string) => {
    if (!token) return;
    const key = token.toLowerCase();
    if (!map.has(key) && company.trim()) map.set(key, company.trim());
  };

  for (const p of postings) {
    const url = p.url ?? '';
    add(greenhouse, GREENHOUSE_RE.exec(url)?.[1], p.company);
    add(lever, LEVER_RE.exec(url)?.[1], p.company);
    add(ashby, ASHBY_RE.exec(url)?.[1], p.company);
  }

  return {
    greenhouse: [...greenhouse].map(([token, company]) => ({ token, company })),
    lever: [...lever].map(([token, company]) => ({ token, company })),
    ashby: [...ashby].map(([board, company]) => ({ board, company })),
  };
}
