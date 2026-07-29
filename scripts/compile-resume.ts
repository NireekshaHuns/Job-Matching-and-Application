/**
 * Compile a LaTeX resume to PDF with whatever engine is installed.
 *
 * Usage: pnpm resume:pdf <path.tex>
 * Requires a LaTeX engine (tectonic recommended: `brew install tectonic`).
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { compileToPdf } from '@/server/resume/compile';
import { realCompileDeps } from '@/server/resume/latex-runner';

async function main() {
  const tex = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!tex) {
    console.error('usage: pnpm resume:pdf <path.tex>');
    process.exit(1);
  }
  if (!existsSync(tex)) {
    console.error(`File not found: ${tex}`);
    process.exit(1);
  }
  const pdf = await compileToPdf(tex, realCompileDeps);
  console.log(`Compiled ${tex} -> ${pdf}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
