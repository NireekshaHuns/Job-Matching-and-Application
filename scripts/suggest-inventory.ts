/**
 * Suggest inventory skills to add: the broad SWE catalog + keywords from your
 * target jobs, minus what you already have. Writes a candidate list to prune.
 *
 * Usage: pnpm inventory:suggest
 * Requires DATABASE_URL. Output: inventory.suggested.json — delete anything you
 * haven't genuinely used, then merge the rest into inventory.json's skills[].
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/server/db/schema';
import { jobs, masterSkills } from '@/server/db/schema';
import { SKILL_CATALOG } from '@/server/resume/skill-catalog';
import { suggestSkills } from '@/server/resume/suggest';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (check .env).');
    process.exit(1);
  }
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const [existingRows, jobRows] = await Promise.all([
    db.select({ skill: masterSkills.skill }).from(masterSkills),
    db.select({ tech: jobs.techKeywords, soft: jobs.softKeywords }).from(jobs),
  ]);

  const suggestions = suggestSkills({
    catalog: SKILL_CATALOG,
    jobTechKeywords: jobRows.flatMap((r) => r.tech),
    jobSoftKeywords: jobRows.flatMap((r) => r.soft),
    existing: existingRows.map((r) => r.skill),
  });

  const out = 'inventory.suggested.json';
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        _comment:
          "Delete any skill you have NOT genuinely used, then merge the rest into inventory.json's skills[]. Keep only what's truthful.",
        skills: suggestions,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Wrote ${suggestions.length} candidate skills -> ${out}. Prune to what you've actually done, then merge into inventory.json and run: pnpm inventory:load inventory.json --yes`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
