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
import { readFileSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { openaiChat } from '@/server/enrich/openai';
import { extractInventory } from '@/server/resume/extract';
import { pdfToText } from '@/server/resume/pdf';

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('-'));
  const outIdx = args.findIndex((a) => a === '-o' || a === '--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : 'inventory.draft.json';

  if (!input) {
    console.error('usage: pnpm inventory:extract <resume.pdf|.txt> [-o out.json]');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set (check .env).');
    process.exit(1);
  }

  const resumeText = input.toLowerCase().endsWith('.pdf')
    ? await pdfToText(new Uint8Array(readFileSync(input)))
    : readFileSync(input, 'utf8');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');
  const inventory = await extractInventory(resumeText, chat);

  writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(
    `Drafted ${inventory.skills.length} skills and ${inventory.bullets.length} bullets -> ${out}.\n` +
      `Review it (trim/fix, add base-resume LaTeX), then: pnpm inventory:load ${out} --yes`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
