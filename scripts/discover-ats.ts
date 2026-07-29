/**
 * Discover ATS board tokens from SimplifyJobs listings and write ats-boards.json
 * (git-ignored), which buildConnectors merges over the hand seeds — so direct-JD
 * pulls (Greenhouse/Lever/Ashby) scale to real companies automatically.
 *
 * Usage: pnpm ats:discover   (no DB or keys needed)
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { simplifyNewGradConnector } from '@/server/ingest/connectors/simplify';
import { extractAtsBoards } from '@/server/ingest/discover';

async function main() {
  const postings = await simplifyNewGradConnector().fetch();
  const boards = extractAtsBoards(postings.map((p) => ({ url: p.url, company: p.company })));

  writeFileSync('ats-boards.json', `${JSON.stringify(boards, null, 2)}\n`);
  console.log(
    `Discovered ${boards.greenhouse.length} Greenhouse, ${boards.lever.length} Lever, ` +
      `${boards.ashby.length} Ashby boards -> ats-boards.json (merged by buildConnectors).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
