/**
 * Measure classifier quality against the labeled dataset using the REAL model.
 *
 * Usage: pnpm eval:classify
 * Prints per-field and overall accuracy so classifier changes are measured, not
 * vibes. Uses the SAME client the pipeline uses, so pointing
 * OPENAI_CLASSIFY_BASE_URL/_API_KEY/_MODEL at another provider measures that
 * provider — which is the point before swapping models for a bulk run.
 */
import 'dotenv/config';
import { buildEnrichmentClients } from '@/server/enrich/clients';
import { classifyPosting } from '@/server/enrich/steps/classify';
import { evaluateClassifier } from '@/server/enrich/evals/evaluate';

async function main() {
  const clients = await buildEnrichmentClients();
  if (!clients) {
    console.error('No LLM key set — need OPENAI_API_KEY, or OPENAI_CLASSIFY_BASE_URL +');
    console.error('OPENAI_CLASSIFY_API_KEY to measure another provider (check .env).');
    process.exit(1);
  }
  const started = Date.now();

  const result = await evaluateClassifier((posting) => classifyPosting(posting, clients.chat));

  const seconds = (Date.now() - started) / 1000;
  console.log(`Model:    ${process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-4o-mini'}`);
  console.log(`Endpoint: ${process.env.OPENAI_CLASSIFY_BASE_URL || 'api.openai.com (default)'}`);
  // Latency is a real constraint: enrichment classifies sequentially, so a
  // model that is 10x slower turns a 3-hour backfill into a 25-hour one.
  console.log(
    `Time:     ${seconds.toFixed(1)}s (${(seconds / result.total).toFixed(1)}s per call)`,
  );
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
