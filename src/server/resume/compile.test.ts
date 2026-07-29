import { describe, expect, it, vi } from 'vitest';
import { compileToPdf, resolveEngine, type CompileDeps } from './compile';

const hasAll = () => true;
const hasNone = () => false;
const okRun = vi.fn(async () => ({ ok: true, stderr: '' }));

describe('resolveEngine', () => {
  it('prefers tectonic, then latexmk, then pdflatex', () => {
    expect(resolveEngine(hasAll)?.name).toBe('tectonic');
    expect(resolveEngine((c) => c !== 'tectonic')?.name).toBe('latexmk');
    expect(resolveEngine((c) => c === 'pdflatex')?.name).toBe('pdflatex');
  });

  it('returns null when no engine is installed', () => {
    expect(resolveEngine(hasNone)).toBeNull();
  });

  it('builds sensible argv for each engine', () => {
    const tectonic = resolveEngine(hasAll)!;
    expect(tectonic.buildArgs('a.tex', 'out')).toEqual([
      '--outdir',
      'out',
      '--chatter',
      'minimal',
      'a.tex',
    ]);
    const pdflatex = resolveEngine((c) => c === 'pdflatex')!;
    expect(pdflatex.buildArgs('a.tex', 'out')).toContain('-output-directory=out');
  });
});

describe('compileToPdf', () => {
  it('runs the resolved engine and returns the sibling PDF path', async () => {
    const run = vi.fn(async () => ({ ok: true, stderr: '' }));
    const deps: CompileDeps = { has: hasAll, run };
    const pdf = await compileToPdf('tailored/acme-5.tex', deps);
    expect(pdf).toBe('tailored/acme-5.pdf');
    expect(run).toHaveBeenCalledWith('tectonic', expect.arrayContaining(['tailored/acme-5.tex']));
  });

  it('throws a clear install hint when no engine is present', async () => {
    await expect(compileToPdf('x.tex', { has: hasNone, run: okRun })).rejects.toThrow(
      /No LaTeX engine found/,
    );
  });

  it('throws with the engine output when compilation fails', async () => {
    const run = vi.fn(async () => ({ ok: false, stderr: 'Undefined control sequence' }));
    await expect(compileToPdf('x.tex', { has: hasAll, run })).rejects.toThrow(
      /Undefined control sequence/,
    );
  });
});
