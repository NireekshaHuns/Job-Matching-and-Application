/**
 * Verify that the résumé template really compiles in the browser, using ONLY
 * the committed TeX Live subset in `public/texlive/` — no network.
 *
 * This is the one part of the Studio that unit tests cannot reach: the linter
 * checks the LaTeX as text, but whether pdfTeX accepts it, and whether the
 * result is one page, can only be answered by running the engine. A template
 * change that does not build should fail here rather than in front of the user.
 *
 * Fails if the compile errors, if the PDF is missing, or if it runs to more
 * than one page.
 *
 * Usage: pnpm verify:latex
 * Requires: Playwright's chromium (`pnpm exec playwright install chromium`).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_PROFILE_FACTS } from '@/server/resume/profile';
import { buildDefaultTemplate } from '@/server/resume/template';

const PORT = 4478;
const PUBLIC_DIR = join(resolve(process.cwd()), 'public');

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8',
};

const HARNESS = (latex: string) => `<!doctype html>
<meta charset="utf-8">
<body>
<script src="/swiftlatex/PdfTeXEngine.js"></script>
<script>
window.__done = false;
(async () => {
  try {
    const engine = new PdfTeXEngine();
    await engine.loadEngine();
    engine.setTexliveEndpoint('/texlive/');
    engine.writeMemFSFile('main.tex', ${JSON.stringify(latex)});
    engine.setEngineMainFile('main.tex');
    const r = await engine.compileLaTeX();
    window.__result = {
      status: r.status,
      pdf: r.pdf ? Array.from(r.pdf.slice(0, 2000)) : null,
      bytes: r.pdf ? r.pdf.length : 0,
      log: r.log,
    };
  } catch (e) {
    window.__result = { status: -1, pdf: null, bytes: 0, log: String(e) };
  } finally {
    window.__done = true;
  }
})();
</script>
</body>`;

/** Page count straight from the PDF's /Type /Pages node. */
function pageCount(head: number[], log: string): number | null {
  // pdfTeX states it plainly in the log; trust that before parsing bytes.
  const m = /Output written on \S+ \((\d+) pages?,/.exec(log);
  if (m) return Number(m[1]);
  const text = Buffer.from(head).toString('latin1');
  const c = /\/Count\s+(\d+)/.exec(text);
  return c ? Number(c[1]) : null;
}

async function main() {
  if (!existsSync(join(PUBLIC_DIR, 'texlive', 'pdftex'))) {
    console.error('public/texlive/pdftex is missing — run `pnpm texlive:serve` to build it.');
    process.exit(1);
  }
  const latex = buildDefaultTemplate(DEFAULT_PROFILE_FACTS);

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;
      if (path === '/') {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(HARNESS(latex));
        return;
      }
      // Static only, and only from public/ — no traversal, no network.
      if (!/^\/(?:swiftlatex|texlive)\/[\w./@+-]+$/.test(path) || path.includes('..')) {
        res.writeHead(404).end();
        return;
      }
      const file = join(PUBLIC_DIR, path);
      if (!existsSync(file)) {
        // 301 is how the engine records "this file does not exist".
        res.writeHead(301).end();
        return;
      }
      const ext = path.slice(path.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, {
      timeout: 300_000,
    });
    const result = await page.evaluate(
      () =>
        (
          window as unknown as {
            __result: { status: number; pdf: number[] | null; bytes: number; log: string };
          }
        ).__result,
    );

    if (result.status !== 0 || !result.pdf) {
      console.error('LaTeX compile FAILED (status ' + result.status + ')');
      console.error(String(result.log).slice(-3000));
      process.exit(1);
    }
    const pages = pageCount(result.pdf, result.log);
    console.log(`Compiled: ${result.bytes} bytes, ${pages ?? '?'} page(s).`);
    if (pages !== 1) {
      console.error(`Résumé must be ONE page; this build is ${pages ?? 'an unknown number of'}.`);
      process.exit(1);
    }
    console.log('OK — template compiles to a one-page PDF from the committed TeX subset.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
