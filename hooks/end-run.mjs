#!/usr/bin/env node
// End a run that stopped without reaching its handoff (a crash, a closed terminal): change the first line of its
// ledger from `<!-- sorry-matt:run active -->` to `<!-- sorry-matt:run ended -->`, so the plugin's hooks stop
// counting its spawns, blocking at its limit and pointing compacted sessions at it. Ledgers are defined in
// skills/have-it-all-done/ASKING.md section 7.
//   node hooks/end-run.mjs <ledger>
// Run it from inside the run's repository (any worktree); a relative <ledger> is resolved against the current
// directory. The ledger must be a `.md` file directly in that repository's <git common dir>/sorry-matt/runs/, and
// its first line (a BOM aside) must be exactly the active marker. Otherwise nothing is written, the reason goes to
// stderr and the exit code is 1. Wrong arguments exit with 2.
// Only the first line changes: the BOM, the line ending and everything after it are kept, and the counters file
// next to the ledger is left alone. It changes run state only, so it asks for no confirmation; the budget hook's
// deny names this command for a run that is no longer running. A run that is still running ends itself at its
// last step instead (ASKING.md section 7).
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './budget.mjs';
import { ACTIVE, commonDir } from './runs.mjs';

export const ENDED = '<!-- sorry-matt:run ended -->';

const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
};

/**
 * End the run whose ledger is `ledger`, or explain why not.
 * @returns {{ ok: true, ledger: string } | { ok: false, reason: string }}
 */
export function endRun(ledger, { cwd = process.cwd(), git = spawnSync } = {}) {
  const common = commonDir(cwd, git);
  if (!common) {
    return { ok: false, reason: `${cwd} is not inside a git repository, so there is no shared directory to look for runs in; run this from the run's repository` };
  }
  const runs = join(common, 'sorry-matt', 'runs');
  const path = real(resolve(cwd, ledger));
  if (!path) return { ok: false, reason: `${ledger} does not exist` };
  if (!statSync(path).isFile() || !/\.md$/i.test(path) || dirname(path) !== real(runs)) {
    return { ok: false, reason: `${path} is not a run ledger of this repository: ledgers are the .md files directly in ${runs}; nothing was changed` };
  }
  const text = readFileSync(path, 'utf8');
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const body = text.slice(bom.length);
  const eol = /\r?\n/.exec(body);
  const first = eol ? body.slice(0, eol.index) : body;
  if (!ACTIVE.test(first.trim())) {
    const seen = first.trim().length > 80 ? `${first.trim().slice(0, 80)}…` : first.trim();
    return { ok: false, reason: `the first line of ${path} is not \`<!-- sorry-matt:run active -->\` (it is ${JSON.stringify(seen)}), so the run is not in progress as far as the hooks can tell; nothing was changed` };
  }
  writeAtomic(path, bom + ENDED + (eol ? body.slice(eol.index) : ''));
  return { ok: true, ledger: path };
}

/** The command line: { code, out, err }. */
export function main(argv, deps = {}) {
  if (argv.length !== 1 || !argv[0]) {
    return { code: 2, out: '', err: 'end-run: give exactly one argument, the path of the run ledger\nusage: node hooks/end-run.mjs <ledger>\n' };
  }
  try {
    const result = endRun(argv[0], deps);
    if (!result.ok) return { code: 1, out: '', err: `end-run: ${result.reason}\n` };
    return { code: 0, out: `ended: ${result.ledger}\n`, err: '' };
  } catch (error) {
    return { code: 1, out: '', err: `end-run: ${error.message}\n` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
