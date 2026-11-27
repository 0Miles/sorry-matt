#!/usr/bin/env node
// verify: get-to-work's local verification of one SHA of an integration branch. It reads the "Full checks" of the
// project command contract (`docs/agents/commands.md`) from the tree of that SHA, runs them in the integration
// worktree, saves their output, and appends the per-SHA local verification record to the run state through
// state.mjs. A SHA that already has a record is never run again: its record is printed as it is. This header is
// the single source of truth for how a local verification runs and what it records.
// No dependencies: runs on a bare Node 20+ with git.
//
// Usage
//   node verify.mjs <state> <integration branch> --worktree <integration worktree>
//                   --reason no-origin|ci-not-covering|no-verdict
//                   [--sha <full sha>] [--self-found <commands.txt>] [--shell <shell>] [--timeout <minutes>]
//                   [--now <UTC>]
//
//   <state>      the run's `<run>.state.json` (see state.mjs); the branch must be one of its integration branches.
//   --worktree   the integration worktree; git and the checks run here.
//   --reason     why this SHA is verified locally, one of state.mjs's three:
//                  no-origin        the repository has no `origin`;
//                  ci-not-covering  the line is settled as CI not covering the integration branch;
//                  no-verdict       CI gave this SHA no verdict (query failed, or still no run on a second read).
//   --sha        the SHA to verify, full 40 or 64 digits; default `git rev-parse <integration branch>` in the
//                worktree, the branch's latest SHA.
//   --self-found the checks the host found itself from the manifest and the CI settings, after this script exited
//                4: one command per line, blank lines and `#` comments skipped. The contract is then not read and
//                the source is `self-found`.
//   --shell      the shell each check runs in, passed to Node's spawn as `shell` (e.g. `bash`); default the
//                platform's (`/bin/sh`, or `cmd.exe` on Windows).
//   --timeout    the time limit of each check, a positive whole number of minutes; default 30. tick.mjs passes the
//                ledger's `budget: timeout-verify <minutes>` (ASKING.md section 7, field 9).
//
// Steps, in this order
//   1. The SHA already has a record on this branch: print it (`reused: true`) and stop. Nothing runs, whatever
//      the worktree looks like.
//   2. The worktree is not at the SHA — HEAD is another commit, or tracked files differ from it (a merge or a
//      conflict in progress) — : exit 5. Nothing is verified this time; the line keeps its last result, and a
//      later dispatch point verifies the SHA it finds then.
//   3. The checks: with --self-found, that file's commands. Otherwise the contract in the tree of the SHA
//      (`git show <sha>:docs/agents/commands.md`), section `## Full checks` up to the next `#`/`##` heading:
//        - every line of a fenced code block in it whose info string is empty or a shell (bash, sh, shell,
//          console, zsh, powershell, pwsh, cmd, bat), blank lines and `#` comments skipped, a leading `$ `
//          dropped, a line ending in `\` joined with the next;
//        - with no such block, every line that is a single inline code span, a list bullet allowed.
//      No usable contract — no file (`missing`), no `## Full checks` (`no-section`), the field is `none`
//      (`none`), or it names no command (`no-commands`) — exits 4: the host finds the checks itself from the
//      manifest and the CI settings and runs this script again with --self-found. `none` never means "nothing to
//      check, record green".
//   4. The checks run one by one, in order, in the worktree, like CI's steps: the first that exits non-zero (or is
//      killed by a signal) makes the result red and the rest are skipped; all exiting 0 is green. stdout and
//      stderr of every check go to the log, `<state dir>/<run>/verify/<line-slug>-<sha>.log` (<line-slug> is the
//      branch without its `<run>/` prefix, `/` turned into `-`), overwritten when it exists; each check is headed
//      `$ <command>` and followed by `exit <code>`. A red log is the failure output RED-LIGHT.md step 3 reads.
//      Each check has two bounds (#215): it runs longer than --timeout (`limit`), or its log has not grown for 10
//      minutes (`idle`: no output on stdout or stderr). Either kills the check's whole process tree — on Windows
//      `taskkill /PID <pid> /T /F`, elsewhere its process group (the check runs detached, then
//      `process.kill(-pid, 'SIGKILL')`) — and its part of the log ends with `timeout <kind>`, not `exit <code>`.
//      A timeout is neither green nor red: the rest are skipped, nothing is recorded (step 5 is not reached, so the
//      SHA can be verified again later), and the script exits 6. Each check is watched by a child `node` process,
//      so verify.mjs itself stays synchronous: the child starts the check with the log as its stdout and stderr,
//      polls the log's size, and kills the tree.
//   5. The record `{ sha, result, reason, at }` is appended to the line's `local` through state.mjs's update (its
//      lock). Another process that recorded the SHA meanwhile wins: its record is printed with `reused: true`.
//
// Output (stdout, JSON, format "sorry-matt/verify@1"; fields are only ever added, never renamed)
//   exit 0, a result:
//   { "format": "sorry-matt/verify@1", "branch", "sha",
//     "result": "green" | "red", "reason": "<reason of the record>",
//     "reused": true | false,                     // true: the SHA had a record; nothing ran
//     "line": "local: <branch> <sha> <green|red> <reason>",   // the record as a ledger line, as state.mjs renders it
//     "source": "commands.md" | "self-found" | null,          // null when reused
//     "log": "<log path>" | null,                 // null when reused
//     "checks": [{ "command", "exit": <code> | null, "signal": <name> | null }] | null,   // ran, in order; null
//                                                 // when reused
//     "skipped": [<command>] | null,              // not run after the first failure; null when reused
//     "revision": <state revision after the write> | null }   // null when reused
//   exit 4, no usable contract:  { "format", "branch", "sha", "verdict": "self-find",
//                                  "why": "missing" | "no-section" | "none" | "no-commands" }
//   exit 5, worktree not at SHA: { "format", "branch", "sha", "verdict": "not-at-sha", "head": "<worktree HEAD>",
//                                  "dirty": true | false }
//   exit 6, a check timed out:   { "format", "branch", "sha", "verdict": "timeout", "check": "<command>",
//                                  "kind": "limit" | "idle", "log": "<log path>",
//                                  "checks": [{ "command", "exit", "signal" }, …] }   // ran, in order; the last is
//                                  // the one that timed out: { "command", "exit": null, "signal": null,
//                                  // "timeout": "limit" | "idle" }
//
// Exit codes: 0 a result (green or red; red is a result, not a failure of this script); 1 the state, git, the
// worktree, the log or a check's shell could not be read, run or written; 2 bad arguments or an empty --self-found
// file; 3 refused: the branch is not an integration branch of the run; 4 no usable contract (above); 5 the worktree
// is not at the SHA (above); 6 a check timed out (above). On 1, 2 and 3 nothing is written to stdout; on every code
// but 0 the state is unchanged.
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { UsageError, failure, run, runIfEntry } from './cli.mjs';
import { Refusal, load, update } from './state.mjs';

export const FORMAT = 'sorry-matt/verify@1';
const REASONS = ['no-origin', 'ci-not-covering', 'no-verdict'];
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHELL_INFO = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh', 'powershell', 'pwsh', 'cmd', 'bat']);
const CONTRACT = 'docs/agents/commands.md';
const SPEC = { worktree: 'one', reason: 'one', sha: 'one', 'self-found': 'one', shell: 'one', timeout: 'one', now: 'one' };
const TIMEOUT_DEFAULT = 30; // minutes: ASKING.md section 7's `budget: timeout-verify` default
const IDLE_MS = 10 * 60_000; // a check whose log has not grown this long is killed

/** Thrown inside the state update when the SHA got a record meanwhile: abandons the write. */
class Recorded extends Error {
  constructor(record) {
    super('recorded meanwhile');
    this.record = record;
  }
}

const formatTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const localLine = (branch, r) => `local: ${branch} ${r.sha} ${r.result} ${r.reason}`;

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in SPEC)) throw new UsageError(`unknown flag ${a}`);
    if (name in flags) throw new UsageError(`${a} is given twice`);
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    flags[name] = argv[(i += 1)];
  }
  return { flags, rest };
}

/** Lines of commands: blank lines and `#` comments skipped, `$ ` dropped, a trailing `\` joined with the next. */
function commandLines(lines) {
  const out = [];
  let pending = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!pending && (!line || line.startsWith('#'))) continue;
    const text = pending ? `${pending} ${line}` : line.replace(/^\$\s+/, '');
    if (text.endsWith('\\')) {
      pending = text.slice(0, -1).trimEnd();
      continue;
    }
    pending = '';
    if (text) out.push(text);
  }
  if (pending) out.push(pending);
  return out;
}

/** The "Full checks" commands of a contract's text, or { why } when it has none to use. */
export function fullChecks(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Full checks\s*$/.test(l));
  if (start < 0) return { why: 'no-section' };
  // One pass from the heading to the next `#`/`##` heading outside a fence; a `#` line inside a fence is a comment.
  const fenced = [];
  const outside = [];
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i += 1) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
    if (!open) {
      outside.push(lines[i]);
      continue;
    }
    const fence = open[1];
    const closes = (l) => {
      const t = l.trim();
      return t.length >= fence.length && t === fence[0].repeat(t.length);
    };
    const block = [];
    for (i += 1; i < lines.length && !closes(lines[i]); i += 1) block.push(lines[i]);
    if (SHELL_INFO.has(open[2].toLowerCase())) fenced.push(...block);
  }
  const commands = fenced.length
    ? commandLines(fenced)
    : outside.map((l) => l.match(/^\s*(?:[-*+]|\d+\.)?\s*`([^`]+)`\s*$/)).filter(Boolean).map((m) => m[1].trim()).filter((c) => c.toLowerCase() !== 'none');
  if (commands.length) return { commands };
  const none = outside.some((l) => l.replace(/^\s*(?:[-*+]|\d+\.)?\s*/, '').replace(/[`.。]/g, '').trim().toLowerCase() === 'none');
  return { why: none ? 'none' : 'no-commands' };
}

const git = (worktree, ...args) => run('git', args, worktree).trim();

/** The contract's text at `sha`, or null when the tree has no such file. */
function contractAt(worktree, sha) {
  try {
    run('git', ['cat-file', '-e', `${sha}:${CONTRACT}`], worktree);
  } catch {
    return null;
  }
  return run('git', ['show', `${sha}:${CONTRACT}`], worktree);
}

function slugOf(run, branch) {
  const tail = branch.startsWith(`${run}/`) ? branch.slice(run.length + 1) : branch;
  return tail.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '_');
}

// The watcher of one check. It runs in a child `node -e`, never in this module: its source is sent as text, so it
// is CommonJS and uses nothing from outside itself. fd 3 is the log. It starts the check with the log as stdout and
// stderr, kills the check's process tree when it outlives `limitMs` or the log stops growing for `idleMs`, and
// prints one JSON line: { status, signal } | { timeout: 'limit' | 'idle' } | { error }.
function watch({ command, cwd, shell, limitMs, idleMs }) {
  const { spawn, spawnSync } = require('node:child_process');
  const { fstatSync } = require('node:fs');
  const win = process.platform === 'win32';
  let ended = false;
  const done = (body) => {
    if (ended) return;
    ended = true;
    process.stdout.write(`${JSON.stringify(body)}\n`, () => process.exit(0));
  };
  let timeout = null;
  // detached on POSIX: the check leads its own process group, so one kill reaches every process it started
  const child = spawn(command, { cwd, shell, stdio: ['ignore', 3, 3], windowsHide: true, detached: !win });
  const kill = (kind) => {
    if (timeout || child.pid === undefined) return;
    timeout = kind;
    if (win) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
    try {
      child.kill('SIGKILL');
    } catch {}
  };
  let size = fstatSync(3).size;
  let grew = Date.now();
  setTimeout(() => kill('limit'), limitMs);
  setInterval(() => {
    const now = fstatSync(3).size;
    if (now !== size) {
      size = now;
      grew = Date.now();
    } else if (Date.now() - grew >= idleMs) kill('idle');
  }, Math.max(10, Math.min(1000, Math.floor(idleMs / 10))));
  child.on('error', (e) => done({ error: e.message }));
  child.on('exit', (status, signal) => done(timeout ? { timeout } : { status, signal }));
}

function runChecks(commands, { worktree, shell, log, limitMs, idleMs }) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'w');
  const checks = [];
  try {
    for (const command of commands) {
      writeSync(fd, `$ ${command}\n`);
      const opts = { command, cwd: worktree, shell: shell ?? true, limitMs, idleMs };
      // the log is the watcher's fd 3, one file description with this fd: their writes share one offset
      const w = spawnSync(process.execPath, ['-e', `(${watch.toString()})(${JSON.stringify(opts)})`], {
        stdio: ['ignore', 'pipe', 'pipe', fd],
        encoding: 'utf8',
        windowsHide: true,
      });
      if (w.error) throw new Error(`could not watch ${JSON.stringify(command)} (${w.error.message})`);
      let r;
      try {
        r = JSON.parse(w.stdout.trim().split('\n').at(-1));
      } catch {
        throw new Error(`the watcher of ${JSON.stringify(command)} gave no result (exit ${w.status ?? w.signal}): ${w.stderr.trim()}`);
      }
      if (r.error) throw new Error(`could not run ${JSON.stringify(command)} (${r.error})`);
      if (r.timeout) {
        writeSync(fd, `timeout ${r.timeout}\n`);
        checks.push({ command, exit: null, signal: null, timeout: r.timeout });
        break;
      }
      writeSync(fd, `exit ${r.status ?? r.signal}\n`);
      checks.push({ command, exit: r.status, signal: r.signal ?? null });
      if (r.status !== 0) break;
    }
  } finally {
    closeSync(fd);
  }
  return checks;
}

const reusedOutput = (branch, r) => ({
  branch,
  sha: r.sha,
  result: r.result,
  reason: r.reason,
  reused: true,
  line: localLine(branch, r),
  source: null,
  log: null,
  checks: null,
  skipped: null,
  revision: null,
});

const json = (code, body) => ({ code, out: `${JSON.stringify({ format: FORMAT, ...body }, null, 2)}\n`, err: '' });

export function defaultDeps() {
  // minuteMs and idleMs are the check bounds' units: tests shorten them, the CLI never does
  return { read: (p) => readFileSync(p, 'utf8'), clock: () => Date.now(), minuteMs: 60_000, idleMs: IDLE_MS };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const { flags, rest } = parseArgs(argv);
    if (rest.length !== 2) throw new UsageError('expected <state> <integration branch>');
    const [statePath, branch] = [resolve(rest[0]), rest[1]];
    if (flags.worktree === undefined) throw new UsageError('--worktree <integration worktree> is required');
    if (!REASONS.includes(flags.reason)) throw new UsageError(`--reason: expected one of ${REASONS.join(', ')}, got ${JSON.stringify(flags.reason)}`);
    if (flags.sha !== undefined && !FULL_SHA.test(flags.sha)) throw new UsageError(`--sha: expected a full 40- or 64-digit lowercase hex SHA, got ${JSON.stringify(flags.sha)}`);
    if (flags.now !== undefined && !(TIME.test(flags.now) && !Number.isNaN(Date.parse(flags.now)))) {
      throw new UsageError(`--now: expected a UTC time like 2026-01-31T23:59:59Z, got ${JSON.stringify(flags.now)}`);
    }
    if (flags.timeout !== undefined && !/^[1-9]\d*$/.test(flags.timeout)) {
      throw new UsageError(`--timeout: expected a positive whole number of minutes, got ${JSON.stringify(flags.timeout)}`);
    }
    const limitMs = Number(flags.timeout ?? TIMEOUT_DEFAULT) * (deps.minuteMs ?? 60_000);
    const idleMs = deps.idleMs ?? IDLE_MS;
    let selfFound;
    if (flags['self-found'] !== undefined) {
      selfFound = commandLines(deps.read(flags['self-found']).replace(/^﻿/, '').split(/\r?\n/));
      if (!selfFound.length) throw new UsageError(`--self-found ${flags['self-found']}: names no command`);
    }
    const worktree = resolve(flags.worktree);
    const now = flags.now ?? formatTime(Math.floor(deps.clock() / 1000) * 1000);

    const state = load(statePath);
    if (!(branch in state.lines)) throw new Refusal(`${branch} is not an integration branch of this run (create it with state.mjs line or add)`);
    const sha = flags.sha ?? git(worktree, 'rev-parse', '--verify', `${branch}^{commit}`);
    if (!FULL_SHA.test(sha)) throw new Error(`git rev-parse ${branch} gave ${JSON.stringify(sha)}, not a full SHA`);

    // 1. one record per SHA: never run again
    const seen = state.lines[branch].local.find((r) => r.sha === sha);
    if (seen) return json(0, reusedOutput(branch, seen));

    // 2. the worktree must be at the SHA
    const head = git(worktree, 'rev-parse', 'HEAD');
    const dirty = git(worktree, 'status', '--porcelain', '--untracked-files=no') !== '';
    if (head !== sha || dirty) return json(5, { branch, sha, verdict: 'not-at-sha', head, dirty });

    // 3. the checks
    let commands = selfFound;
    const source = selfFound ? 'self-found' : 'commands.md';
    if (!commands) {
      const text = contractAt(worktree, sha);
      const found = text === null ? { why: 'missing' } : fullChecks(text);
      if (!found.commands) return json(4, { branch, sha, verdict: 'self-find', why: found.why });
      commands = found.commands;
    }

    // 4. run them
    const log = join(dirname(statePath), state.run, 'verify', `${slugOf(state.run, branch)}-${sha}.log`);
    const checks = runChecks(commands, { worktree, shell: flags.shell, log, limitMs, idleMs });
    // a timeout is neither green nor red: nothing is recorded, so the SHA can be verified again
    const late = checks.at(-1).timeout;
    if (late) return json(6, { branch, sha, verdict: 'timeout', check: checks.at(-1).command, kind: late, log, checks });
    const result = checks.every((c) => c.exit === 0) ? 'green' : 'red';

    // 5. the record; a record another process wrote meanwhile wins, and nothing is written
    let written;
    try {
      written = update(statePath, now, (s) => {
        const l = s.lines[branch];
        if (!l) throw new Refusal(`${branch} is no longer an integration branch of this run`);
        const other = l.local.find((r) => r.sha === sha);
        if (other) throw new Recorded(other);
        const record = { sha, result, reason: flags.reason, at: now };
        l.local.push(record);
        return { record };
      });
    } catch (e) {
      if (e instanceof Recorded) return json(0, reusedOutput(branch, e.record));
      throw e;
    }
    const r = written.record;
    return json(0, {
      branch,
      sha,
      result: r.result,
      reason: r.reason,
      reused: false,
      line: localLine(branch, r),
      source,
      log,
      checks,
      skipped: commands.slice(checks.length),
      revision: written.revision,
    });
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, out: '', err: `verify: refused: ${e.message}\n` };
    return failure('verify', e);
  }
}

runIfEntry(import.meta.url, main);
