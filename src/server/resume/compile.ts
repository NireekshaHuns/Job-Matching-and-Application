/**
 * Compile a tailored LaTeX resume to PDF using whatever LaTeX engine is
 * installed. Engine selection and argv building are pure; the two side effects
 * (does a command exist? run it) are injected so this is unit-testable without
 * a LaTeX toolchain. No engine is bundled — it's a system dependency.
 */
import { basename, dirname, join } from 'node:path';

export interface LatexEngine {
  name: string;
  /** Build the argv to compile `texPath`, writing output into `outDir`. */
  buildArgs(texPath: string, outDir: string): string[];
}

/** Preference order: tectonic (self-contained) > latexmk > pdflatex. */
export const ENGINES: LatexEngine[] = [
  {
    name: 'tectonic',
    buildArgs: (tex, out) => ['--outdir', out, '--chatter', 'minimal', tex],
  },
  {
    name: 'latexmk',
    buildArgs: (tex, out) => ['-pdf', '-interaction=nonstopmode', `-outdir=${out}`, tex],
  },
  {
    // Last resort: single-pass only, so cross-references/TOC may be stale.
    // Fine for a one-page resume; tectonic/latexmk auto-rerun.
    name: 'pdflatex',
    buildArgs: (tex, out) => ['-interaction=nonstopmode', `-output-directory=${out}`, tex],
  },
];

/** First engine whose command exists, or null. */
export function resolveEngine(has: (cmd: string) => boolean): LatexEngine | null {
  return ENGINES.find((e) => has(e.name)) ?? null;
}

export interface RunResult {
  ok: boolean;
  stderr: string;
}

export interface CompileDeps {
  has: (cmd: string) => boolean;
  run: (cmd: string, args: string[]) => Promise<RunResult>;
}

const INSTALL_HINT =
  'No LaTeX engine found (tried tectonic, latexmk, pdflatex). Install tectonic ' +
  '(`brew install tectonic`) or compile the .tex on Overleaf.';

/** Compile `texPath` to a sibling PDF. Returns the PDF path. */
export async function compileToPdf(texPath: string, deps: CompileDeps): Promise<string> {
  if (!/\.tex$/i.test(texPath)) {
    throw new Error(`Expected a .tex file, got: ${texPath}`);
  }
  const engine = resolveEngine(deps.has);
  if (!engine) throw new Error(INSTALL_HINT);

  const outDir = dirname(texPath);
  const result = await deps.run(engine.name, engine.buildArgs(texPath, outDir));
  if (!result.ok) {
    throw new Error(`${engine.name} failed to compile ${texPath}:\n${result.stderr}`);
  }

  return join(outDir, basename(texPath).replace(/\.tex$/i, '.pdf'));
}
