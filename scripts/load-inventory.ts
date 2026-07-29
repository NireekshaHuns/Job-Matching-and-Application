/**
 * Load a master-inventory JSON file into the DB (replace semantics).
 *
 * Usage: pnpm inventory:load <file.json>   (e.g. inventory.json)
 * Requires DATABASE_URL. See inventory.example.json for the format.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/server/db/schema';
import { parseInventory } from '@/server/resume/inventory';
import { loadInventory } from '@/server/resume/inventory-load';

async function main() {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('usage: pnpm inventory:load <file.json>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const inventory = parseInventory(JSON.parse(readFileSync(file, 'utf8')));
  const counts = await loadInventory(db, inventory);

  console.log(
    `Loaded ${counts.skills} skills, ${counts.bullets} bullets, ${counts.baseResumes} base resumes.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
