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
 * than one page. Two cases are checked: the plain template, and a WORST-LEGAL
 * plan — every bullet filled to the top of the footprint band, the coursework
 * line full, six full skills rows. The second is the one that matters: proving
 * the preamble compiles says nothing about whether eleven genuine two-line
 * bullets fit, and "the worst output the renderer can legally produce is still
 * one page" is the invariant actually worth having.
 *
 * `--measure` instead prints the layout measurements the bullet-footprint band
 * in `rubric.ts` is calibrated from: `\linewidth` inside an itemize, and the
 * average glyph width of technical prose at 11pt.
 *
 * Usage: pnpm verify:latex [--measure]
 * Requires: Playwright's chromium (`pnpm exec playwright install chromium`).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_PROFILE_FACTS } from '@/server/resume/profile';
import { buildDefaultTemplate, renderResumePlan } from '@/server/resume/render';
import { BULLET_CHARS } from '@/server/resume/rubric';
import {
  COURSEWORK_SLOTS,
  PREAMBLE,
  RESUME_ROLES,
  SKILL_CATEGORIES,
} from '@/server/resume/template';

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

/** Prose of a known length, so `\settowidth` yields an average glyph width. */
const PROBE_LINES = [
  'Engineered event-driven distributed systems processing daily financial events through Kafka',
  'Built low-latency Java microservices with Spring Boot on AWS for the screening platform',
  'Deployed and operated services across AWS VPCs on Linux, configuring networking controls',
  'Mentored engineers and established testing standards with quality gates that cut defects',
];

/** A document that reports layout measurements through the compile log. */
function buildProbe(): string {
  return [
    PREAMBLE,
    '\\begin{document}',
    '\\newlength{\\probe}',
    '\\begin{itemize}',
    '\\item \\typeout{CALIB LINEWIDTH=\\the\\linewidth}',
    '\\end{itemize}',
    ...PROBE_LINES.map(
      (line) =>
        `\\settowidth{\\probe}{${line}}\\typeout{CALIB W=\\the\\probe CHARS=${line.length}}`,
    ),
    '\\end{document}',
    '',
  ].join('\n');
}

/**
 * A plan that fills every slot to the largest size the validator will pass:
 * bullets at the top of the footprint band, the coursework line full, and six
 * skills rows each filled to roughly a full line.
 */
function buildMaxFill(): string {
  const pad = (seed: string, len: number) => {
    let out = seed;
    const filler = ' engineering throughput reliability observability latency partitioning';
    while (out.length < len) out += filler;
    return out.slice(0, len).trimEnd();
  };
  const bullet = (i: number) =>
    pad(
      `Engineered distributed service number ${i} cutting latency by 40 percent for`,
      BULLET_CHARS.max,
    );

  return renderResumePlan(DEFAULT_PROFILE_FACTS, {
    coursework: DEFAULT_PROFILE_FACTS.coursework.slice(0, COURSEWORK_SLOTS.max),
    roles: RESUME_ROLES.map((r) => ({
      roleId: r.id,
      bullets: Array.from({ length: r.bullets }, (_, i) => bullet(i)),
    })),
    project: {
      stack: pad('Next.js, TypeScript, tRPC, PostgreSQL, pgvector, Inngest,', 120),
      bullets: [bullet(1), bullet(2)],
    },
    skills: SKILL_CATEGORIES.map((label) => ({
      label,
      items: [pad('Distributed Systems, System Design, Concurrency,', 70)],
    })),
    placements: [],
  });
}

/** Print the calibration numbers behind `BULLET_CHARS` and exit. */
function reportMeasurements(log: string): void {
  const linewidth = /CALIB LINEWIDTH=([\d.]+)pt/.exec(log);
  const widths = [...log.matchAll(/CALIB W=([\d.]+)pt\s*CHARS=(\d+)/g)].map((m) => ({
    pt: Number(m[1]),
    chars: Number(m[2]),
  }));
  if (!linewidth || widths.length === 0) {
    console.error('No CALIB output found in the log. Tail of log:');
    console.error(String(log).slice(-2500));
    process.exit(1);
  }
  const totalPt = widths.reduce((a, w) => a + w.pt, 0);
  const totalChars = widths.reduce((a, w) => a + w.chars, 0);
  const avgCharPt = totalPt / totalChars;
  const linewidthPt = Number(linewidth[1]);
  const charsPerLine = Math.floor(linewidthPt / avgCharPt);
  const spread = Math.max(...widths.map((w) => Math.abs(w.pt - w.chars * avgCharPt) / w.pt)) * 100;

  console.log(`linewidth      ${linewidthPt.toFixed(2)}pt (inside itemize)`);
  console.log(`avg glyph      ${avgCharPt.toFixed(3)}pt over ${totalChars} chars`);
  console.log(`chars / line   ${charsPerLine}`);
  console.log(`two full lines ${Math.round(1.6 * charsPerLine)}-${2 * charsPerLine} chars`);
  console.log(`worst spread   ${spread.toFixed(1)}% (char count vs measured width)`);
  console.log(`\ncurrent BULLET_CHARS: ${JSON.stringify(BULLET_CHARS)}`);
}

async function main() {
  if (!existsSync(join(PUBLIC_DIR, 'texlive', 'pdftex'))) {
    console.error('public/texlive/pdftex is missing — run `pnpm texlive:serve` to build it.');
    process.exit(1);
  }
  const measure = process.argv.includes('--measure');
  const cases: { name: string; latex: string }[] = measure
    ? [{ name: 'measurement probe', latex: buildProbe() }]
    : [
        { name: 'default template', latex: buildDefaultTemplate(DEFAULT_PROFILE_FACTS) },
        { name: 'worst legal plan', latex: buildMaxFill() },
      ];
  let latex = cases[0].latex;

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
    for (const testCase of cases) {
      latex = testCase.latex;
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
      await page.close();

      if (result.status !== 0 || !result.pdf) {
        console.error(`LaTeX compile FAILED for ${testCase.name} (status ${result.status})`);
        console.error(String(result.log).slice(-3000));
        process.exit(1);
      }
      if (measure) {
        reportMeasurements(result.log);
        return;
      }
      const pages = pageCount(result.pdf, result.log);
      console.log(`${testCase.name}: ${result.bytes} bytes, ${pages ?? '?'} page(s).`);
      if (pages !== 1) {
        console.error(
          `Résumé must be ONE page; "${testCase.name}" is ${pages ?? 'an unknown number of'}.`,
        );
        process.exit(1);
      }
    }
    console.log('OK — every case compiles to a one-page PDF from the committed TeX subset.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
