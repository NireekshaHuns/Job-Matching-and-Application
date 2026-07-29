/**
 * Real I/O adapter for `compileToPdf` — checks command existence and runs the
 * LaTeX engine. Isolated here so `compile.ts` stays pure and testable.
 */
import { spawnSync } from 'node:child_process';
import type { CompileDeps } from './compile';

const WHICH = process.platform === 'win32' ? 'where' : 'which';

/**
 * Combine engine stdout + stderr and keep the tail. pdflatex/latexmk write
 * their error report to stdout (not stderr), so capturing only stderr would
 * lose the diagnostic on failure.
 */
export function tailOutput(stdout: string, stderr: string, maxLines = 40): string {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trimEnd();
  const lines = combined.split('\n');
  return lines.length > maxLines ? lines.slice(-maxLines).join('\n') : combined;
}

export const realCompileDeps: CompileDeps = {
  has(cmd) {
    return spawnSync(WHICH, [cmd], { stdio: 'ignore' }).status === 0;
  },
  async run(cmd, args) {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    if (res.error) return { ok: false, stderr: res.error.message };
    return { ok: res.status === 0, stderr: tailOutput(res.stdout ?? '', res.stderr ?? '') };
  },
};
