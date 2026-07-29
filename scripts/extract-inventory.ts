/**
 * Draft a master-inventory JSON from an existing resume (PDF or text) using the
 * LLM. Writes a DRAFT file for you to review — it does NOT load into the DB.
 *
 * Usage: pnpm inventory:extract <resume.pdf|.txt> [-o out.json]
 * Requires OPENAI_API_KEY. Default output: inventory.draft.json.
 *
 * Then: review the draft (trim, fix, add base-resume LaTeX), rename to
 * inventory.json, and run `pnpm inventory:load inventory.json --yes`.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { openaiChat } from '@/server/enrich/openai';
import { extractInventory } from '@/server/resume/extract';
import { pdfToText } from '@/server/resume/pdf';

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('-'));
  const outIdx = args.findIndex((a) => a === '-o' || a === '--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : 'inventory.draft.json';
  const force = args.includes('--force');

  if (!input || (outIdx >= 0 && !out)) {
    console.error('usage: pnpm inventory:extract <resume.pdf|.txt> [-o out.json] [--force]');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set (check .env).');
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }
  if (existsSync(out) && !force) {
    console.error(`${out} already exists — pass --force to overwrite, or -o <other>.`);
    process.exit(1);
  }

  const resumeText = input.toLowerCase().endsWith('.pdf')
    ? await pdfToText(new Uint8Array(readFileSync(input)))
    : readFileSync(input, 'utf8');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
  const { inventory, reconciledSkills } = await extractInventory(resumeText, chat);

  writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(
    `Drafted ${inventory.skills.length} skills and ${inventory.bullets.length} bullets -> ${out}.`,
  );
  if (reconciledSkills.length > 0) {
    console.log(
      `Auto-added ${reconciledSkills.length} skill(s) from bullet tags — review these: ${reconciledSkills.join(', ')}`,
    );
  }
  console.log(`Then: review it (add base-resume LaTeX) and run: pnpm inventory:load ${out} --yes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
