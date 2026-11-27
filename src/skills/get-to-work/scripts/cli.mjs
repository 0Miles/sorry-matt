// cli: the command-line plumbing get-to-work's scripts share. Not a command itself. No dependencies.
import { realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A bad invocation: exit code 2 and a pointer to the script's header. */
export class UsageError extends Error {}

/**
 * JSON.parse for a file the host wrote. Windows PowerShell 5.1 starts the files it writes with `>` or
 * `Out-File -Encoding utf8` with a UTF-8 BOM, which JSON.parse rejects; one leading BOM is dropped first.
 */
export const parseJson = (text) => JSON.parse(String(text).replace(/^\uFEFF/, ''));

/**
 * Run a command and return its stdout; throws with `status`, `stdout` and `stderr` on a non-zero exit. `env`, when
 * given, is added to the environment of that one call. `{ both: true }` returns { stdout, stderr } instead, for a
 * command that names on stderr what it did while exiting 0 (#219: `gh stack sync`'s divergence).
 */
export function run(cmd, args, cwd, env, { both = false } = {}) {
  const opts = { cwd, env: env && { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] };
  if (!both) return execFileSync(cmd, args, opts);
  const r = spawnSync(cmd, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${r.stderr}`), { status: r.status, stdout: r.stdout, stderr: r.stderr });
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

/** The `gh` seam integrate.mjs and freeze.mjs share (#219): `run('gh', …)`, env and `{ both }` as there. */
export const gh = (args, cwd, env, opts) => run('gh', args, cwd, env, opts);

/**
 * The trackers a run can record (#188): GitHub Issues and Local Markdown. The one list every script reads (#228):
 * state.mjs re-exports it, acceptance.mjs, brief.mjs, freeze.mjs, frontier.mjs and tick.mjs check against it.
 */
export const TRACKERS = Object.freeze(['github', 'local']);

// A Windows 8.3 short name (C:\Users\RUNNER~1) and its long name are one directory, but path.relative compares
// text; so do symlinked spellings elsewhere. Relativize only canonical paths: `p` against `base`, through the real
// path of its nearest existing ancestor: a file not on disk yet (or a deleted directory) still gets the long
// spelling of the directories above it.
const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(real(parent), basename(p));
  }
};
export const canonical = (base, p = '.') => real(resolve(base, p));

/** The { code, out, err } a script's main returns for an error: 2 for a UsageError, else 1. */
export function failure(name, e) {
  const usage = e instanceof UsageError;
  const detail = (e.stderr && String(e.stderr).trim()) || e.message;
  return { code: usage ? 2 : 1, out: '', err: `${name}: ${detail}\n${usage ? `usage: see the header of ${name}.mjs\n` : ''}` };
}

/** Run `main` on the process's arguments when the module at `url` is the entry point. */
export function runIfEntry(url, main) {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(url)) return;
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
