/**
 * In-browser LaTeX → PDF compile via the self-hosted SwiftLaTeX pdfTeX WASM
 * engine (assets in `public/swiftlatex/`). Runs entirely client-side (no server
 * LaTeX engine needed on Vercel). Missing TeX packages are fetched from
 * SwiftLaTeX's TeXLive CDN at compile time, so a template using an uncommon
 * package can fail — callers must handle `LatexCompileError` and fall back to
 * download / Open in Overleaf.
 */

interface PdfTeXEngineInstance {
  loadEngine(): Promise<void>;
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
    return engine;
  })();
  try {
    return await enginePromise;
  } catch (e) {
    enginePromise = null; // allow a retry on next call
    throw e;
  }
}

/**
 * Compile a LaTeX document to PDF bytes. Serializes on the shared engine, so
 * callers should not invoke it concurrently (the Studio disables its button
 * while a compile is in flight). Throws `LatexCompileError` on a failed build.
 */
export async function compileLatexToPdf(latex: string): Promise<Uint8Array> {
  const engine = await getEngine();
  engine.writeMemFSFile('main.tex', latex);
  engine.setEngineMainFile('main.tex');
  const result = await engine.compileLaTeX();
  if (!result.pdf || result.status !== 0) {
    throw new LatexCompileError('LaTeX failed to compile.', result.log ?? '');
  }
  return result.pdf;
}
