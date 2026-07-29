/**
 * Load a master-inventory JSON file into the DB (REPLACE semantics — wipes and
 * rewrites master_skills, resume_bullets, and base resumes).
 *
 * Usage: pnpm inventory:load <file.json> --yes
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
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('-'));
  const confirmed = args.includes('--yes') || args.includes('-y');

  if (!file) {
    console.error('usage: pnpm inventory:load <file.json> --yes');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }

  const inventory = parseInventory(JSON.parse(readFileSync(file, 'utf8')));
  const host = new URL(process.env.DATABASE_URL).host;

  if (!confirmed) {
    console.error(
      `This REPLACES master_skills, resume_bullets, and base resumes on ${host} ` +
        `with ${inventory.skills.length} skills, ${inventory.bullets.length} bullets, ` +
        `${inventory.baseResumes.length} base resumes.\nRe-run with --yes to proceed.`,
    );
    process.exit(1);
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const counts = await loadInventory(db, inventory);

  console.log(
    `Loaded ${counts.skills} skills, ${counts.bullets} bullets, ${counts.baseResumes} base resumes.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
