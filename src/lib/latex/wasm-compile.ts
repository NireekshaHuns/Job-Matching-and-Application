/**
 * In-browser LaTeX → PDF compile via the self-hosted SwiftLaTeX pdfTeX WASM
 * engine (assets in `public/swiftlatex/`). Runs entirely client-side (no server
 * LaTeX engine needed on Vercel).
 *
 * The TeX tree is self-hosted too, under `public/texlive/`. The engine ships no
 * TeX files at all and by default pulls every `.cls`, `.sty` and font from
 * `texlive2.swiftlatex.com`, which is dead — so nothing compiled. We now serve
 * a pinned TeX Live 2019 subset ourselves; see `scripts/texlive-ondemand.ts`
 * for how it is built.
 *
 * A document that reaches for a package outside that subset will still fail, so
 * callers must handle `LatexCompileError` and fall back to download / Open in
 * Overleaf.
 */

interface PdfTeXEngineInstance {
  loadEngine(): Promise<void>;
  setTexliveEndpoint(url: string): void;
  isReady(): boolean;
  writeMemFSFile(filename: string, srccode: string): void;
  setEngineMainFile(filename: string): void;
  compileLaTeX(): Promise<{ pdf?: Uint8Array; status: number; log: string }>;
  flushCache(): void;
  closeWorker(): void;
}

declare global {
  interface Window {
    PdfTeXEngine?: new () => PdfTeXEngineInstance;
  }
}

/** Thrown when compilation fails; `log` holds the pdfTeX output tail for display. */
export class LatexCompileError extends Error {
  readonly log: string;
  constructor(message: string, log: string) {
    super(message);
    this.name = 'LatexCompileError';
    this.log = log;
  }
}

const ENGINE_SCRIPT = '/swiftlatex/PdfTeXEngine.js';
/**
 * Our own TeX Live subset. Trailing slash matters — the engine appends
 * `pdftex/{format}/{name}` directly to it.
 */
const TEXLIVE_ENDPOINT = '/texlive/';

let scriptPromise: Promise<void> | null = null;
function loadScriptOnce(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('LaTeX engine can only load in the browser.'));
      return;
    }
    if (window.PdfTeXEngine) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = ENGINE_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null; // allow a retry
      reject(new Error('Failed to load the LaTeX engine script.'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

let enginePromise: Promise<PdfTeXEngineInstance> | null = null;
/** Load + boot the engine once and reuse it (keeps the TeXLive package cache warm). */
async function getEngine(): Promise<PdfTeXEngineInstance> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    await loadScriptOnce();
    const Ctor = window.PdfTeXEngine;
    if (!Ctor) throw new Error('LaTeX engine is unavailable.');
    const engine = new Ctor();
    await engine.loadEngine();
    // Must come after loadEngine (it needs the worker) and before any compile.
    engine.setTexliveEndpoint(TEXLIVE_ENDPOINT);
    return engine;
  })();
  try {
    return await enginePromise;
  } catch (e) {
    enginePromise = null; // allow a retry on next call
    throw e;
  }
}

async function runCompile(latex: string): Promise<Uint8Array> {
  const engine = await getEngine();
  engine.writeMemFSFile('main.tex', latex);
  engine.setEngineMainFile('main.tex');
  const result = await engine.compileLaTeX();
  if (!result.pdf || result.status !== 0) {
    throw new LatexCompileError('LaTeX failed to compile.', result.log ?? '');
  }
  return result.pdf;
}

// The engine has one shared MemFS; serialize compiles through a chained promise
// so overlapping calls can't interleave writes/reads on the same file.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Compile a LaTeX document to PDF bytes. Calls are serialized on the shared
 * engine (a later call waits for the current one). Throws `LatexCompileError`
 * on a failed build.
 */
export function compileLatexToPdf(latex: string): Promise<Uint8Array> {
  const run = queue.then(() => runCompile(latex));
  // Keep the chain alive regardless of this call's outcome.
  queue = run.catch(() => undefined);
  return run;
}
