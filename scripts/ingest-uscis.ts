/**
 * Ingest USCIS H-1B Employer Data Hub CSV file(s) into the `sponsors` table.
 *
 * Usage:
 *   pnpm ingest:uscis <path-to-csv> [more-csvs...]
 *
 * Download the yearly CSVs from
 * https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub
 * (Data Hub Files), then point this script at them. Uses relative imports and
 * builds its own db client so it can run under `tsx` without `@/` alias setup.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { aggregateSponsors, loadSponsors, parseUscisCsv } from '../src/lib/sponsorship/ingest';
import * as schema from '../src/server/db/schema';

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: pnpm ingest:uscis <csv> [csv...]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const records = files.flatMap((f) => parseUscisCsv(readFileSync(f, 'utf8')));
  const aggregates = aggregateSponsors(records);
  const written = await loadSponsors(db, aggregates);

  console.log(
    `Parsed ${records.length} rows -> ${aggregates.length} employers -> upserted ${written}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
