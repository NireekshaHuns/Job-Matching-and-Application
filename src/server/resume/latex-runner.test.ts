import { describe, expect, it, vi } from 'vitest';

const spawnSync = vi.fn();
vi.mock('node:child_process', () => {
  const fn = (...a: unknown[]) => spawnSync(...a);
  return { spawnSync: fn, default: { spawnSync: fn } };
});

const { realCompileDeps, tailOutput } = await import('./latex-runner');

describe('tailOutput', () => {
  it('merges stdout and stderr', () => {
    expect(tailOutput('out line', 'err line')).toBe('out line\nerr line');
  });

  it('keeps only the last N lines', () => {
    const many = Array.from({ length: 50 }, (_, i) => `L${i}`).join('\n');
    const out = tailOutput(many, '', 10);
    expect(out.split('\n')).toHaveLength(10);
    expect(out.startsWith('L40')).toBe(true);
  });
});

describe('realCompileDeps.has', () => {
  it('is true when the command is found', () => {
    spawnSync.mockReturnValueOnce({ status: 0 });
    expect(realCompileDeps.has('tectonic')).toBe(true);
  });
  it('is false when not found', () => {
    spawnSync.mockReturnValueOnce({ status: 1 });
    expect(realCompileDeps.has('tectonic')).toBe(false);
  });
});

describe('realCompileDeps.run', () => {
  it('captures the diagnostic from stdout on failure (pdflatex behavior)', async () => {
    spawnSync.mockReturnValueOnce({
      status: 1,
      stdout: '! Undefined control sequence.',
      stderr: '',
    });
    const res = await realCompileDeps.run('pdflatex', ['a.tex']);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('Undefined control sequence');
  });

  it('reports a spawn error (e.g. ENOENT)', async () => {
    spawnSync.mockReturnValueOnce({ error: new Error('spawn ENOENT') });
    const res = await realCompileDeps.run('tectonic', []);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('ENOENT');
  });
});
