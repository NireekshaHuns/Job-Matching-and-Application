/**
 * Discover ATS board tokens from SimplifyJobs listings and write
 * src/server/ingest/discovered-boards.json, which buildConnectors merges under
 * the hand seeds — so direct-JD pulls (Greenhouse/Lever/Ashby) scale to real
 * companies automatically. The output is COMMITTED; see registry.ts.
 *
 * Usage: pnpm ats:discover   (no DB or keys needed)
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { simplifyNewGradConnector } from '@/server/ingest/connectors/simplify';
import { extractAtsBoards } from '@/server/ingest/discover';

async function main() {
  // Scan EVERY category: this only reads apply URLs, and a company posting a
  // Hardware or Quant role has a board that carries its software roles too.
  // Ingestion still filters (see isSoftwareCategory).
  const postings = await simplifyNewGradConnector({ allCategories: true }).fetch();
  const boards = extractAtsBoards(postings.map((p) => ({ url: p.url, company: p.company })));

  // Written into src/ and COMMITTED: a git-ignored file at the repo root never
  // reaches production, which is how the deployed board ended up running on the
  // hand seeds alone.
  const out = 'src/server/ingest/discovered-boards.json';
  writeFileSync(out, `${JSON.stringify(boards, null, 2)}\n`);
  console.log(
    `Discovered ${boards.greenhouse.length} Greenhouse, ${boards.lever.length} Lever, ` +
      `${boards.ashby.length} Ashby boards -> ${out}. Commit it to ship the widened net.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
