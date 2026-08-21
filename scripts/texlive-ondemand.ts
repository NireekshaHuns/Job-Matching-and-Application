/**
 * Dev-only TeX Live "on demand" server, used to build the committed subset in
 * `public/texlive/pdftex/`.
 *
 * WHY THIS EXISTS
 * The SwiftLaTeX pdfTeX WASM engine ships no TeX tree at all — it fetches every
 * `.cls`, `.sty`, font metric and map file at compile time from
 * `texlive2.swiftlatex.com`, which is dead (DNS resolves to Cloudflare, every
 * request times out). Rather than depend on someone else's box, we host the
 * handful of files our template actually needs.
 *
 * HOW IT WORKS
 * Run this, point a browser at `/harness.html`, and it compiles the real résumé
 * template. Every file the engine asks for is served from `public/texlive/pdftex/`
 * if present; on a miss the server resolves the filename to a TeX Live package
 * via `texlive.tlpdb`, downloads that package from CTAN, extracts the file, and
 * writes it into the cache so the next run is offline. When the compile
 * succeeds, the cache IS the subset — commit it.
 *
 * Misses are logged, so the summary at the end tells you exactly what was added
 * and what genuinely does not exist (pdfTeX probes for plenty of optional files
 * and handles a 404 fine).
 *
 * Requires: network access and a `tar` that can read .tar.xz (bsdtar/GNU tar).
 * Usage: pnpm texlive:serve  → open http://localhost:4477/harness.html
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_PROFILE_FACTS } from '@/server/resume/profile';
import { buildDefaultTemplate } from '@/server/resume/render';

const execFileAsync = promisify(execFile);

const PORT = 4477;
const ROOT = resolve(process.cwd());
const CACHE_DIR = join(ROOT, 'public', 'texlive', 'pdftex');
const SWIFTLATEX_DIR = join(ROOT, 'public', 'swiftlatex');
/** TeX Live vintage to fetch from — see MIRRORS below for why it is pinned. */
const TL_YEAR = '2019';
/**
 * Packages are unpacked here, not into the committed tree. A single package can
 * carry hundreds of files (sourcesans alone is tens of MB of font data) and we
 * only want the ones pdfTeX actually asks for to end up in the repo.
 */
const STAGE_DIR = join(tmpdir(), `texlive-stage-${TL_YEAR}`);

/**
 * TeX Live **2019**, not current CTAN.
 *
 * The engine loads a prebuilt LaTeX format (see public/texlive/pdftex/10), and
 * that format was built by SwiftLaTeX's own Texlive-Ondemand server, whose
 * Dockerfile is `FROM ubuntu:20.04` + `texlive-full` — i.e. TeX Live 2019 with
 * the Feb-2020 kernel the format reports. Class and package files MUST come
 * from the same vintage: current CTAN fails outright, and even TL2020-final
 * mismatches the format badly enough to error inside size11.clo. Being frozen,
 * the historic snapshot is also reproducible — a rebuild years from now fetches
 * exactly the same bytes.
 *
 * Named mirrors rather than the `mirror.ctan.org` redirector: that lands on a
 * different host each time and some serve an incomplete TLS chain, which Node
 * rejects (UNABLE_TO_VERIFY_LEAF_SIGNATURE) even where curl accepts it.
 */
const MIRRORS = [
  `https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/${TL_YEAR}/tlnet-final`,
  `https://ftp.tu-chemnitz.de/pub/tug/historic/systems/texlive/${TL_YEAR}/tlnet-final`,
];
const TLPDB_PATH = '/tlpkg/texlive.tlpdb.xz';
const ARCHIVE_PATH = (pkg: string) => `/archive/${pkg}.tar.xz`;

/** GET a CTAN path, falling through the mirror list on failure. */
async function fetchFromCtan(path: string): Promise<ArrayBuffer> {
  const errors: string[] = [];
  for (const base of MIRRORS) {
    try {
      const res = await fetch(base + path);
      if (res.ok) return await res.arrayBuffer();
      errors.push(`${base}: HTTP ${res.status}`);
    } catch (e) {
      errors.push(`${base}: ${(e as Error).message}`);
    }
  }
  throw new Error(`all mirrors failed for ${path} — ${errors.join('; ')}`);
}

/** filename → TeX Live package that ships it (built once from the tlpdb). */
let fileIndex: Map<string, string> | null = null;
const added: string[] = [];
const missing: string[] = [];
/** Packages already extracted this run — one download serves many files. */
const extracted = new Set<string>();

async function buildFileIndex(): Promise<Map<string, string>> {
  if (fileIndex) return fileIndex;
  const cached = join(tmpdir(), `texlive-${TL_YEAR}.tlpdb`);
  let text: string;
  if (existsSync(cached)) {
    text = await readFile(cached, 'utf8');
  } else {
    console.log(`Downloading the TeX Live ${TL_YEAR} package database (once)…`);
    const xz = join(tmpdir(), `texlive-${TL_YEAR}.tlpdb.xz`);
    await writeFile(xz, Buffer.from(await fetchFromCtan(TLPDB_PATH)));
    await execFileAsync('xz', ['-df', xz]);
    text = await readFile(cached, 'utf8');
  }

  const index = new Map<string, string>();
  let pkg: string | null = null;
  let inRunfiles = false;
  for (const line of text.split('\n')) {
    const name = /^name (\S+)/.exec(line);
    if (name) {
      pkg = name[1];
      inRunfiles = false;
      continue;
    }
    if (/^\w+files? /.test(line)) {
      inRunfiles = line.startsWith('runfiles ');
      continue;
    }
    if (!line.startsWith(' ')) {
      inRunfiles = false;
      continue;
    }
    if (!inRunfiles || !pkg) continue;
    const base = line.trim().split(' ')[0].split('/').pop();
    // First package to claim a basename wins; TeX Live resolves by kpathsea
    // order and duplicates are rare among the packages we need.
    if (base && !index.has(base)) index.set(base, pkg);
  }
  fileIndex = index;
  console.log(`Indexed ${index.size} TeX Live runfiles.`);
  return index;
}

/** Download `pkg` from CTAN and copy every runfile in it into the cache. */
async function extractPackage(pkg: string): Promise<void> {
  if (extracted.has(pkg)) return;
  extracted.add(pkg);

  const archive = await fetchFromCtan(ARCHIVE_PATH(pkg));
  const work = join(tmpdir(), `tl-${pkg}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const tarball = join(work, `${pkg}.tar.xz`);
  await writeFile(tarball, Buffer.from(archive));
  await execFileAsync('tar', ['-xJf', tarball, '-C', work]);

  // The engine asks for bare filenames, so the tree is flattened into one dir.
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (!full.includes('/tlpkg/') && !full.endsWith('.tar.xz')) {
        await writeFile(join(STAGE_DIR, entry.name), await readFile(full));
      }
    }
  };
  await walk(work);
  await rm(work, { recursive: true, force: true });
}

/**
 * The version segment in `pdftex/{n}/{name}` is kpathsea's format code, and for
 * font lookups the engine sends a bare name (`pdftex/3/cmr10`) rather than a
 * filename. Mapping code → extension is what keeps us from answering a request
 * for the metrics of cmr10 with its Type 1 outline.
 */
const EXT_BY_FORMAT: Record<string, string[]> = {
  '1': ['.pk'],
  '3': ['.tfm'],
  '4': ['.afm'],
  '8': ['.cnf'],
  '10': ['.fmt'],
  '11': ['.map'],
  '31': ['.pfb', '.pfa'],
  '32': ['.vf'],
  // 26 = tex: everything the document \inputs or \usepackages. These arrive
  // with their extension already attached, so no candidate is needed.
  '26': [],
};

/**
 * The engine writes each download to `TEXCACHEROOT + '/' + fileid`, taking
 * `fileid` from a response header. Miss it out and every file lands on
 * `/tex/null`, overwriting the previous one mid-read — which shows up as
 * baffling "Extra \else" / undefined-control-sequence errors rather than as a
 * missing file. The id only has to be unique and path-safe.
 */
function texHeaders(version: string, filename: string): Record<string, string> {
  return {
    'content-type': 'application/octet-stream',
    fileid: `${version}_${filename}`.replace(/[^\w.@+-]/g, '_'),
    // Same-origin in the app, but the dev harness and any future cross-origin
    // use need the header to be readable.
    'access-control-expose-headers': 'fileid',
  };
}

/**
 * The engine only remembers "this file does not exist" for a **301**; any other
 * non-200 is treated as a transient error and re-requested on the next lookup.
 * pdfTeX probes for a lot of optional files, so answering misses with 301 keeps
 * a compile from repeating the same doomed request over and over.
 */
const MISSING_STATUS = 301;

/** Candidate filenames for a request, most specific first. */
function candidates(name: string, format: string): string[] {
  if (/\.[A-Za-z0-9]+$/.test(name)) return [name];
  const exts = EXT_BY_FORMAT[format];
  if (exts && exts.length > 0) return exts.map((e) => name + e);
  // Unknown format code and no extension — try the common font types rather
  // than give up, but keep metrics ahead of outlines.
  return ['.tfm', '.vf', '.pfb', '.map', '.enc', '.tex'].map((e) => name + e);
}

/** Bytes for `filename` from the staging tree, fetching its package on a miss. */
async function resolveFile(filename: string): Promise<Buffer | null> {
  const staged = join(STAGE_DIR, filename);
  if (existsSync(staged)) return readFile(staged);

  const index = await buildFileIndex();
  const pkg = index.get(filename);
  if (!pkg) {
    missing.push(filename);
    return null;
  }
  try {
    await extractPackage(pkg);
  } catch (e) {
    console.warn(`  ✗ ${filename} (${pkg}): ${(e as Error).message}`);
    missing.push(filename);
    return null;
  }
  if (!existsSync(staged)) {
    missing.push(filename);
    return null;
  }
  added.push(`${filename} (${pkg})`);
  console.log(`  + ${filename} ← ${pkg}`);
  return readFile(staged);
}

const HARNESS = (latex: string) => `<!doctype html>
<meta charset="utf-8">
<title>TeX Live subset builder</title>
<body style="font:14px ui-monospace,monospace;padding:1rem">
<h1 style="font-size:15px">Compiling the résumé template…</h1>
<pre id="out">booting engine…</pre>
<script src="/swiftlatex/PdfTeXEngine.js"></script>
<script>
const out = document.getElementById('out');
const log = (m) => { out.textContent += '\\n' + m; };
window.__done = false;

/**
 * Build the precompiled LaTeX format and hand the bytes back to the server.
 * The shim's compileFormat() only offers the result as an object URL, so talk
 * to the worker directly to get at the buffer.
 */
async function buildFormat(engine) {
  const worker = engine.latexWorker;
  const bytes = await new Promise((resolve, reject) => {
    worker.onmessage = (ev) => {
      const d = ev.data;
      if (d.cmd !== 'compile') return;
      d.result === 'ok' ? resolve(d.pdf) : reject(new Error(d.log || 'format build failed'));
    };
    worker.postMessage({ cmd: 'compileformat' });
  });
  worker.onmessage = () => {};
  await fetch('/save-format?path=10%2Fswiftlatexpdftex.fmt', {
    method: 'POST',
    body: new Blob([bytes]),
  });
  return bytes.byteLength;
}

(async () => {
  try {
    const engine = new PdfTeXEngine();
    await engine.loadEngine();
    engine.setTexliveEndpoint('http://localhost:${PORT}/texlive/');

    if (new URLSearchParams(location.search).has('format')) {
      log('building format…');
      log('format built: ' + (await buildFormat(engine)) + ' bytes');
    }

    engine.writeMemFSFile('main.tex', ${JSON.stringify(latex)});
    engine.setEngineMainFile('main.tex');
    const r = await engine.compileLaTeX();
    log('status=' + r.status + ' pdf=' + (r.pdf ? r.pdf.length + ' bytes' : 'none'));
    log(r.log.slice(-4000));
    window.__result = { status: r.status, bytes: r.pdf ? r.pdf.length : 0, log: r.log };
  } catch (e) {
    log('ERROR ' + e.message);
    window.__result = { status: -1, bytes: 0, log: String(e) };
  } finally {
    window.__done = true;
  }
})();
</script>
</body>`;

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(STAGE_DIR, { recursive: true });
  const latex = buildDefaultTemplate(DEFAULT_PROFILE_FACTS);

  const server = createServer((req, res) => {
    // Any throw in here must not take the server down mid-discovery.
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      const path = url.pathname;

      if (path === '/harness.html' || path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(HARNESS(latex));
        return;
      }

      if (path.startsWith('/swiftlatex/')) {
        const name = path.slice('/swiftlatex/'.length);
        // Serve only the three engine assets; no traversal.
        if (!/^[\w.-]+$/.test(name) || !existsSync(join(SWIFTLATEX_DIR, name))) {
          res.writeHead(404).end();
          return;
        }
        const type = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        res.writeHead(200, { 'content-type': type });
        res.end(await readFile(join(SWIFTLATEX_DIR, name)));
        return;
      }

      // The precompiled LaTeX format, which is not a TeX Live file at all —
      // the engine builds it once and then expects it back at a versioned path.
      if (req.method === 'POST' && path === '/save-format') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const target = url.searchParams.get('path') ?? '';
        if (!/^[\w.@+-]+\/[\w.@+-]+$/.test(target)) {
          res.writeHead(400).end();
          return;
        }
        const dest = join(CACHE_DIR, target);
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, Buffer.concat(chunks));
        console.log(`  + ${target} (format, ${Buffer.concat(chunks).length} bytes)`);
        res.writeHead(200).end();
        return;
      }

      // The engine requests `{endpoint}pdftex/{key}`. The key carries a cache
      // version directory ("26/geometry.sty", "10/swiftlatexpdftex.fmt") and
      // may use a `pk/` prefix for bitmap fonts. Only the basename identifies
      // the file, so everything is stored flat under CACHE_DIR/<version>/.
      const tex = /^\/texlive\/pdftex\/(.+)$/.exec(path);
      if (tex) {
        const key = tex[1];
        if (!/^(?:[\w.@+-]+\/)*[\w.@+-]+$/.test(key)) {
          res.writeHead(404).end();
          return;
        }
        const version = key.includes('/') ? key.slice(0, key.indexOf('/')) : '';
        const filename = key.slice(key.lastIndexOf('/') + 1);

        // The precompiled format is a build artefact, not a TeX Live file:
        // serve it if we've built it, 404 otherwise so the engine builds one.
        const cached = join(CACHE_DIR, version, filename);
        if (existsSync(cached)) {
          res.writeHead(200, texHeaders(version, filename));
          res.end(await readFile(cached));
          return;
        }
        if (filename.endsWith('.fmt')) {
          res.writeHead(MISSING_STATUS).end();
          return;
        }

        let bytes: Buffer | null = null;
        for (const candidate of candidates(filename, version)) {
          bytes = await resolveFile(candidate);
          if (bytes) break;
        }
        if (!bytes) {
          res.writeHead(MISSING_STATUS).end();
          return;
        }
        // Store under the version and name the engine asked for, so the
        // committed tree mirrors the request paths exactly.
        if (version) {
          await mkdir(join(CACHE_DIR, version), { recursive: true });
          await writeFile(cached, bytes);
        }
        res.writeHead(200, texHeaders(version, filename));
        res.end(bytes);
        return;
      }

      res.writeHead(404).end();
    })().catch((e: unknown) => {
      console.warn(`  ! ${req.url}: ${(e as Error).message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.listen(PORT, () => {
    console.log(`TeX Live on-demand server: http://localhost:${PORT}/harness.html`);
    console.log(`Cache: ${CACHE_DIR}`);
  });

  const report = () => {
    console.log(`\n${added.length} file(s) added this run.`);
    if (missing.length > 0) {
      console.log(`${missing.length} not found (fine if the compile still succeeded):`);
      console.log('  ' + [...new Set(missing)].join(', '));
    }
  };
  process.on('SIGINT', () => {
    report();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
