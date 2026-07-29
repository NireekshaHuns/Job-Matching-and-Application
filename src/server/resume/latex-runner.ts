/**
 * Real I/O adapter for `compileToPdf` — checks command existence and runs the
 * LaTeX engine. Isolated here so `compile.ts` stays pure and testable.
 */
import { spawnSync } from 'node:child_process';
import type { CompileDeps } from './compile';

export const realCompileDeps: CompileDeps = {
  has(cmd) {
    return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
  },
  async run(cmd, args) {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    return {
      ok: res.status === 0,
      stderr: `${res.stderr ?? ''}${res.error ? res.error.message : ''}`,
    };
  },
};
