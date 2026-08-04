'use client';

/**
 * Split view: editable LaTeX on the left, a live in-browser compiled PDF on the
 * right (SwiftLaTeX WASM). Compiling happens client-side; if the engine or a
 * package can't load, the panel shows the error and the always-available
 * fallbacks (Download .tex, Open in Overleaf) so the flow never dead-ends.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { compileLatexToPdf, LatexCompileError } from '@/lib/latex/wasm-compile';

const btnCls =
  'rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-surface-2 disabled:opacity-50';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** POST the LaTeX to Overleaf, opening it in a new project (real compile + preview). */
function openInOverleaf(latex: string) {
  const form = document.createElement('form');
  form.action = 'https://www.overleaf.com/docs';
  form.method = 'POST';
  form.target = '_blank';
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'encoded_snip';
  field.value = encodeURIComponent(latex);
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export function ResumeSplit({
  latex,
  onLatexChange,
  filename,
  onSave,
  saving,
  saved,
}: {
  latex: string;
  onLatexChange: (next: string) => void;
  filename: string;
  onSave?: () => void;
  saving?: boolean;
  saved?: boolean;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<string | null>(null);

  const compile = useCallback(async () => {
    setCompiling(true);
    setError(null);
    try {
      const bytes = await compileLatexToPdf(latex);
      // Copy into a fresh ArrayBuffer so the Blob owns standalone bytes.
      const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPdfUrl(url);
    } catch (e) {
      const log = e instanceof LatexCompileError ? e.log : '';
      setError(
        `${(e as Error).message}${log ? `\n\n${log.slice(-1200)}` : ''}` ||
          'Could not compile in the browser.',
      );
    } finally {
      setCompiling(false);
    }
  }, [latex]);

  // Compile once when a new résumé arrives (the parent remounts via `key` on
  // each generation); edits after that recompile via the button. Deferred with
  // a timeout so we don't call setState synchronously inside the effect body.
  useEffect(() => {
    const t = setTimeout(() => void compile(), 0);
    return () => {
      clearTimeout(t);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
    // Mount-only on purpose — new generations remount via the `key` prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable — download still works.
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnCls}
          onClick={() => void compile()}
          disabled={compiling}
        >
          {compiling ? 'Compiling…' : 'Recompile'}
        </button>
        <button type="button" className={btnCls} onClick={copy}>
          {copied ? 'Copied' : 'Copy .tex'}
        </button>
        <button
          type="button"
          className={btnCls}
          onClick={() =>
            downloadBlob(`${filename}.tex`, new Blob([latex], { type: 'application/x-tex' }))
          }
        >
          Download .tex
        </button>
        <button
          type="button"
          className={btnCls}
          disabled={!pdfUrl}
          onClick={async () => {
            if (!pdfUrl) return;
            const blob = await (await fetch(pdfUrl)).blob();
            downloadBlob(`${filename}.pdf`, blob);
          }}
        >
          Download PDF
        </button>
        <button type="button" className={btnCls} onClick={() => openInOverleaf(latex)}>
          Open in Overleaf ↗
        </button>
        {onSave && (
          <button
            type="button"
            className={`${btnCls} border-brand text-brand`}
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : saved ? 'Saved to corpus ✓' : 'Save to corpus'}
          </button>
        )}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <textarea
          aria-label="Résumé LaTeX source"
          className="border-border bg-surface text-fg h-[70vh] w-full resize-none rounded-md border p-2 font-mono text-xs"
          value={latex}
          onChange={(e) => onLatexChange(e.target.value)}
          spellCheck={false}
        />
        <div className="border-border bg-surface-2 h-[70vh] w-full overflow-hidden rounded-md border">
          {error ? (
            <div className="flex h-full flex-col gap-2 overflow-auto p-3">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                In-browser preview couldn&rsquo;t compile this résumé.
              </p>
              <p className="text-muted text-xs">
                Use <strong>Open in Overleaf</strong> or <strong>Download .tex</strong> to compile
                it there — the LaTeX itself is fine, the browser engine just couldn&rsquo;t fetch a
                package/font.
              </p>
              <pre className="text-faint text-[10px] leading-tight break-words whitespace-pre-wrap">
                {error}
              </pre>
            </div>
          ) : pdfUrl ? (
            <iframe title="Compiled résumé PDF" src={pdfUrl} className="h-full w-full" />
          ) : (
            <div className="text-muted flex h-full items-center justify-center text-sm">
              {compiling ? 'Compiling PDF…' : 'No preview yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
