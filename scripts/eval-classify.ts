/**
 * Measure classifier quality against the labeled dataset using the REAL model.
 *
 * Usage: pnpm eval:classify
 * Requires OPENAI_API_KEY. Prints per-field and overall accuracy so classifier
 * changes are measured, not vibes.
 */
import 'dotenv/config';
import OpenAI from 'openai';
import { classifyPosting } from '@/server/enrich/steps/classify';
import { openaiChat } from '@/server/enrich/openai';
import { evaluateClassifier } from '@/server/enrich/evals/evaluate';

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set (check .env).');
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = openaiChat(openai, process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini');

  const result = await evaluateClassifier((posting) => classifyPosting(posting, chat));

  console.log(`Examples: ${result.total}`);
  console.log(`Employment type: ${result.employmentTypeCorrect}/${result.total}`);
  console.log(`Role family:     ${result.roleFamilyCorrect}/${result.total}`);
  console.log(`Seniority:       ${result.seniorityCorrect}/${result.total}`);
  console.log(`Overall (all 3): ${(result.accuracy * 100).toFixed(0)}%`);
  if (result.misses.length) console.log(`Misses: ${result.misses.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
