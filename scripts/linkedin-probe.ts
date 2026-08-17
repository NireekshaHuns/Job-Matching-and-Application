/**
 * Probe the LinkedIn guest-jobs endpoints once and report what came back.
 *
 * WHY THIS EXISTS. The connector parses undocumented HTML, so its fixture tests
 * can only prove the parser matches the fixtures — never that the fixtures still
 * match LinkedIn. This script is the step that checks reality: it issues the
 * exact URLs and headers the connector uses (imported, not re-declared) and
 * prints what parsed out.
 *
 * It is also the honest answer to being rate-limited: a 429 here means the
 * connector will collect nothing from this network, and you should leave
 * LINKEDIN_GUEST_ENABLED off rather than wonder why ingestion is empty.
 *
 * Usage:
 *   pnpm linkedin:probe                          # first seeded search
 *   pnpm linkedin:probe "backend engineer"       # custom keywords
 *   pnpm linkedin:probe --write-fixtures         # re-record the test fixtures
 *
 * Makes at most two requests. No DB or API keys needed.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import {
  buildDetailUrl,
  buildSearchUrl,
  GUEST_HEADERS,
  parseJobDetail,
  parseSearchCards,
} from '@/server/ingest/connectors/linkedin';
import { LINKEDIN_SEARCHES } from '@/server/ingest/registry';

const FIXTURE_DIR = 'src/server/ingest/connectors/__fixtures__';

async function get(url: string, label: string): Promise<string | null> {
  const res = await fetch(url, { headers: GUEST_HEADERS });
  console.log(`${label}: HTTP ${res.status}`);
  const body = await res.text();

  if (res.status === 429 || res.status === 403 || res.status === 999) {
    console.error(
      `\nBLOCKED. LinkedIn is throttling or challenging this network (${body.length} bytes, ` +
        `no job data). The connector treats this the same way: it stops immediately.\n` +
        `Leave LINKEDIN_GUEST_ENABLED unset here — it would ingest nothing.`,
    );
    return null;
  }
  if (!res.ok) {
    console.error(`Unexpected status; body starts: ${body.slice(0, 200)}`);
    return null;
  }
  return body;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write-fixtures');
  const keywords = args.find((a) => !a.startsWith('--')) ?? LINKEDIN_SEARCHES[0].keywords;
  const location = LINKEDIN_SEARCHES[0].location;

  const searchHtml = await get(buildSearchUrl({ keywords, location }, 0), `search "${keywords}"`);
  if (!searchHtml) process.exit(1);

  const cards = parseSearchCards(searchHtml);
  console.log(`\nParsed ${cards.length} cards from ${searchHtml.length} bytes.`);
  if (cards.length === 0) {
    console.error(
      'NO CARDS PARSED. Either this is a challenge page or the card selectors have ' +
        'changed — compare the body against the fixture before trusting the connector.',
    );
    process.exit(1);
  }
  for (const card of cards.slice(0, 5)) {
    console.log(
      `  ${card.jobId}  ${card.title} — ${card.company} (${card.location ?? 'n/a'})` +
        `${card.postedAt ? ` [${card.postedAt.toISOString().slice(0, 10)}]` : ''}`,
    );
  }

  // One detail fetch, to confirm the JD selectors too.
  const first = cards[0];
  const detailHtml = await get(buildDetailUrl(first.jobId), `\ndetail ${first.jobId}`);
  if (detailHtml) {
    const { jdText, criteria } = parseJobDetail(detailHtml);
    console.log(`Parsed ${jdText.length} chars of JD; criteria: ${JSON.stringify(criteria)}`);
    console.log(`JD starts: ${jdText.slice(0, 200).replace(/\n/g, ' ')}…`);
    if (jdText.length === 0) console.error('NO JD PARSED — the detail selectors have changed.');
  }

  if (write) {
    writeFileSync(`${FIXTURE_DIR}/linkedin-search.html`, searchHtml);
    if (detailHtml) writeFileSync(`${FIXTURE_DIR}/linkedin-job-detail.html`, detailHtml);
    console.log(
      `\nWrote fixtures to ${FIXTURE_DIR}/. These are now REAL captures — ` +
        `re-run the tests, update the expected titles/companies, and drop the ` +
        `"synthetic" caveat from the fixture headers.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
