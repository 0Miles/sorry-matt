#!/usr/bin/env node
// deadline: the time-limit and progress arithmetic of get-to-work's pipeline — the assignment record, the deadline
// scan with its fallback wake-up, and the progress and limit check at a dispatch point. It computes; it stops no
// agent, writes no ledger and calls no tracker: the host copies the output into the ledger and does what follows.
// No dependencies: runs on a bare Node 20+ with git on PATH.
//
// Usage
//   node deadline.mjs record --worktree <worktree> --limit <minutes> [--now <UTC>]
//   node deadline.mjs record --expansions '<ticket>=<n>' [--expansions '<ticket>=<n>' …] --limit <minutes> [--now <UTC>]
//   Quote each <ticket>=<n>: a shell reads an unquoted `#12=0` as the start of a comment.
//   node deadline.mjs scan <plan.json> [--now <UTC>]
//   node deadline.mjs progress <plan.json>
//
// Times are UTC, written `YYYY-MM-DDTHH:MM:SSZ` (no milliseconds); two of them compare as strings. `--now` (or the
// scan plan's `now`; the flag wins) fixes the current time; without it the system clock is read.
//
// The progress fingerprint of a worktree is { head, tree }: `git rev-parse HEAD`, and the tree `git write-tree`
// gives after `git add -A` in a temporary copy of the index — the whole working tree, untracked files included,
// ignored files not. The real index and the working tree are not touched; the temporary index is deleted. An
// expansion agent works in no worktree: its fingerprint is { expansions: { "<ticket>": <n> } }, the `expansions`
// count of each ticket it covers, which the host reads with acceptance.mjs and passes in.
//
// record — one assignment
//   Output (stdout, JSON, format "sorry-matt/deadline@1"; fields are only ever added, never renamed)
//   { "format": "sorry-matt/deadline@1", "command": "record",
//     "assigned": "<UTC>", "limit": <minutes>, "deadline": "<assigned + limit>", "extended": "no",
//     "fingerprint": { "head": "<sha>", "tree": "<sha>" } | { "expansions": { "#12": 0 } } }
//
// scan — every agent in flight, at one wake-up
//   plan.json, written by the host from the assignment records:
//   { "now": "<UTC>",                                   // optional
//     "agents": [
//       { "id": "<agent id>", "assigned": "<UTC>", "limit": <minutes>, "deadline": "<UTC>", "extended": "no" | "yes",
//         "fingerprint": { "head": "…", "tree": "…" }, "worktree": "<the worktree it works in>" },
//       { "id": "<expansion agent id>", "assigned": "…", "limit": 15, "deadline": "…", "extended": "no",
//         "fingerprint": { "expansions": { "#12": 0 } }, "expansions": { "#12": 1 } }     // the counts now
//     ] }
//   An agent is overdue when its deadline is earlier than now; equal is not overdue. For an overdue agent the
//   fingerprint is recomputed (or, for an expansion agent, taken from `expansions`): progress is a different head
//   or a different tree, or any ticket's count above its recorded one. Overdue, not yet extended, with progress →
//   "extend": the new deadline is now + the same limit, extended becomes "yes". Overdue otherwise → "stop"; once
//   extended, progress is not judged again. When the fingerprint of an overdue agent cannot be computed (its
//   worktree is gone, git refuses the working tree, a file is locked), only that agent is affected: its entry has
//   no action and carries the error, and the scan still exits 0 with every other agent judged.
//   Output
//   { "format": "sorry-matt/deadline@1", "command": "scan", "now": "<UTC>",
//     "agents": [{ "id": "…", "overdue": true | false,
//                  "action": "extend" | "stop" | null,            // null: not overdue, or `error` is set
//                  "deadline": "<the deadline after this scan>", "extended": "no" | "yes",
//                  "fingerprint": { "assigned": {…}, "current": {…} | null } | null,   // null: not overdue;
//                                                                 // current null: it could not be computed
//                  "error": "<why the fingerprint could not be computed>" | null }],
//     "fallback": { "deadline": "<UTC>", "seconds": <n>, "scheduleWakeup": <n clamped to 60–3600> } | null }
//   `fallback` is the earliest deadline among the agents still in flight after the scan — those not overdue and
//   those just extended, at their new deadline; stopped ones are out, and so are those with an `error`, which the
//   host settles in the same wake-up (scan again, then stop) — minus now. null when none is left.
//
// progress — one dispatch point, after the host updated the usage
//   plan.json:
//   { "previous":   { "tips": { "<integration branch>": "<sha>" }, "terminal": ["#3"] } | null,
//     "tips":       { "<integration branch>": "<tip sha now>" },       // every line
//     "terminal":   ["#3", "#4"],                                      // tickets at an end state now
//     "noProgress": <consecutive no-progress count so far>,
//     "usage":      { "rounds": <dispatch points so far>, "spawns": <n>, "hours": <elapsed, waiting time removed> },
//     "limits":     { "rounds": <n>, "spawns": <n>, "hours": <n>, "no-progress": <n> } }
//   `previous` is the snapshot the last dispatch point's output gave; null at the first one. Nothing changed (the
//   same tips, and the same set of terminal tickets in any order) → the count goes up by one; anything changed →
//   0; no previous snapshot → 0. A limit is reached when the usage is greater than or equal to it; `no-progress`
//   is checked against the count just computed.
//   Output
//   { "format": "sorry-matt/deadline@1", "command": "progress",
//     "progressed": true | false | null,                               // null: no previous snapshot
//     "noProgress": <n>, "snapshot": { "tips": {…}, "terminal": [sorted] },
//     "stop": true | false, "stoppedBy": ["rounds", "spawns", "hours", "no-progress"],   // those reached, this order
//     "rounds": <usage.rounds + 1 when not stopped, usage.rounds when stopped> }
//
// Exit codes: 0 output written; 1 a plan file, or `record`'s worktree, could not be read; 2 bad arguments or plan.
// On 1 or 2 nothing is written to stdout and no agent has been judged.
import { readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { UsageError, failure, runIfEntry } from './cli.mjs';

export const FORMAT = 'sorry-matt/deadline@1';
const LIMITS = ['rounds', 'spawns', 'hours', 'no-progress'];

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const formatTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
function parseTime(text, where) {
  const ms = typeof text === 'string' && TIME.test(text) ? Date.parse(text) : NaN;
  if (Number.isNaN(ms)) throw new UsageError(`${where}: expected a UTC time like 2026-01-31T23:59:59Z, got ${JSON.stringify(text)}`);
  return ms;
}
const currentTime = (given, clock) => (given === undefined ? Math.floor(clock() / 1000) * 1000 : parseTime(given, 'now'));

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCount = (x) => Number.isInteger(x) && x >= 0;
function minutes(x, where) {
  if (!Number.isInteger(x) || x <= 0) throw new UsageError(`${where}: the limit is a whole number of minutes above 0`);
  return x;
}

/** { head, tree } of a worktree; the real index and the working tree are left alone. */
export function fingerprint(worktree, git) {
  const head = git(worktree, ['rev-parse', 'HEAD']).trim();
  const gitPath = (name) => git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', name]).trim();
  const index = gitPath('index');
  const temp = gitPath(`sorry-matt-fingerprint.${process.pid}.index`);
  try {
    if (existsSync(index)) copyFileSync(index, temp);
    git(worktree, ['add', '-A'], { GIT_INDEX_FILE: temp });
    return { head, tree: git(worktree, ['write-tree'], { GIT_INDEX_FILE: temp }).trim() };
  } finally {
    rmSync(temp, { force: true });
    rmSync(`${temp}.lock`, { force: true });
  }
}

function counts(map, where) {
  if (!isObject(map) || !Object.keys(map).length) throw new UsageError(`${where}: expected { "<ticket>": <expansions count> }`);
  for (const [ticket, n] of Object.entries(map)) {
    if (!isCount(n)) throw new UsageError(`${where}: ${ticket}: the expansions count is a whole number, 0 or more`);
  }
  return map;
}

function parseFlags(argv, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) throw new UsageError(`unknown flag ${a}`);
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    const value = argv[(i += 1)];
    if (spec[name] === 'many') (flags[name] ??= []).push(value);
    else if (name in flags) throw new UsageError(`${a} is given twice`);
    else flags[name] = value;
  }
  return { flags, rest };
}

function record(argv, deps) {
  const { flags, rest } = parseFlags(argv, { worktree: 'one', expansions: 'many', limit: 'one', now: 'one' });
  if (rest.length) throw new UsageError(`record takes flags only, got ${rest[0]}`);
  if ((flags.worktree === undefined) === (flags.expansions === undefined)) {
    throw new UsageError('record needs --worktree, or --expansions for an expansion agent, not both');
  }
  if (flags.limit === undefined || !/^\d+$/.test(flags.limit)) throw new UsageError('--limit: the limit is a whole number of minutes above 0');
  const limit = minutes(Number(flags.limit), '--limit');
  const now = currentTime(flags.now, deps.clock);
  let print;
  if (flags.worktree !== undefined) {
    print = fingerprint(resolve(flags.worktree), deps.git);
  } else {
    const map = {};
    for (const pair of flags.expansions) {
      const at = pair.lastIndexOf('=');
      const ticket = at > 0 ? pair.slice(0, at) : '';
      const n = at > 0 ? pair.slice(at + 1) : '';
      if (!ticket || !/^\d+$/.test(n)) throw new UsageError(`--expansions ${pair}: expected <ticket>=<count>`);
      if (ticket in map) throw new UsageError(`--expansions: ${ticket} is given twice`);
      map[ticket] = Number(n);
    }
    print = { expansions: map };
  }
  return {
    format: FORMAT,
    command: 'record',
    assigned: formatTime(now),
    limit,
    deadline: formatTime(now + limit * 60_000),
    extended: 'no',
    fingerprint: print,
  };
}

function readPlan(path, read) {
  let plan;
  try {
    plan = JSON.parse(read(path));
  } catch (e) {
    if (e instanceof SyntaxError) throw new UsageError(`${path}: not JSON (${e.message})`);
    throw e;
  }
  if (!isObject(plan)) throw new UsageError(`${path}: the plan is not an object`);
  return plan;
}

function onePlan(argv, command, spec) {
  const { flags, rest } = parseFlags(argv, spec);
  if (rest.length !== 1) throw new UsageError(`${command} expects exactly one plan file`);
  return { flags, path: resolve(rest[0]) };
}

function scan(argv, deps) {
  const { flags, path } = onePlan(argv, 'scan', { now: 'one' });
  const plan = readPlan(path, deps.read);
  const now = currentTime(flags.now ?? plan.now, deps.clock);
  if (!Array.isArray(plan.agents)) throw new UsageError(`${path}: agents must be an array`);
  const seen = new Set();
  const agents = plan.agents.map((a, i) => {
    if (!isObject(a) || typeof a.id !== 'string' || !a.id) throw new UsageError(`${path}: agents[${i}] has no id`);
    if (seen.has(a.id)) throw new UsageError(`${path}: ${a.id} is listed twice`);
    seen.add(a.id);
    const where = `${path}: ${a.id}`;
    parseTime(a.assigned, `${where}: assigned`);
    const deadline = parseTime(a.deadline, `${where}: deadline`);
    const limit = minutes(a.limit, where);
    if (a.extended !== 'no' && a.extended !== 'yes') throw new UsageError(`${where}: extended is "no" or "yes"`);
    const f = a.fingerprint;
    const expander = isObject(f) && 'expansions' in f;
    if (expander) {
      counts(f.expansions, `${where}: fingerprint.expansions`);
      counts(a.expansions, `${where}: expansions`);
      for (const ticket of Object.keys(f.expansions)) {
        if (!(ticket in a.expansions)) throw new UsageError(`${where}: expansions has no count for ${ticket}`);
      }
      if (a.worktree !== undefined) throw new UsageError(`${where}: an expansion agent has no worktree`);
    } else {
      if (!isObject(f) || typeof f.head !== 'string' || !f.head || typeof f.tree !== 'string' || !f.tree) {
        throw new UsageError(`${where}: fingerprint is { head, tree } or { expansions }`);
      }
      if (typeof a.worktree !== 'string' || !a.worktree) throw new UsageError(`${where}: has no worktree`);
    }
    return { ...a, deadline, limit, expander };
  });

  let earliest = null;
  const out = agents.map((a) => {
    const overdue = a.deadline < now;
    let action = null;
    let deadline = a.deadline;
    let extended = a.extended;
    let prints = null;
    let error = null;
    if (overdue) {
      const assigned = a.fingerprint;
      let current = null;
      try {
        current = a.expander ? { expansions: a.expansions } : fingerprint(resolve(a.worktree), deps.git);
      } catch (e) {
        error = (e.stderr && String(e.stderr).trim()) || e.message || String(e);
      }
      prints = { assigned, current };
      if (current !== null) {
        const progressed = a.expander
          ? Object.keys(assigned.expansions).some((t) => current.expansions[t] > assigned.expansions[t])
          : current.head !== assigned.head || current.tree !== assigned.tree;
        if (extended === 'no' && progressed) {
          action = 'extend';
          deadline = now + a.limit * 60_000;
          extended = 'yes';
        } else {
          action = 'stop';
        }
      }
    }
    if (action !== 'stop' && error === null && (earliest === null || deadline < earliest)) earliest = deadline;
    return { id: a.id, overdue, action, deadline: formatTime(deadline), extended, fingerprint: prints, error };
  });

  const seconds = earliest === null ? null : (earliest - now) / 1000;
  return {
    format: FORMAT,
    command: 'scan',
    now: formatTime(now),
    agents: out,
    fallback:
      earliest === null
        ? null
        : { deadline: formatTime(earliest), seconds, scheduleWakeup: Math.min(3600, Math.max(60, seconds)) },
  };
}

function snapshotOf(x, where) {
  if (!isObject(x) || !isObject(x.tips) || !Array.isArray(x.terminal)) {
    throw new UsageError(`${where}: expected { tips: { "<integration branch>": "<sha>" }, terminal: [ticket ids] }`);
  }
  for (const [branch, sha] of Object.entries(x.tips)) {
    if (typeof sha !== 'string' || !sha) throw new UsageError(`${where}: tips: ${branch} has no SHA`);
  }
  if (x.terminal.some((t) => typeof t !== 'string' || !t)) throw new UsageError(`${where}: terminal holds ticket ids`);
  const tips = Object.fromEntries(Object.entries(x.tips).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { tips, terminal: [...new Set(x.terminal)].sort() };
}

function progress(argv, deps) {
  const { path } = onePlan(argv, 'progress', {});
  const plan = readPlan(path, deps.read);
  const snapshot = snapshotOf(plan, path);
  const previous = plan.previous === null || plan.previous === undefined ? null : snapshotOf(plan.previous, `${path}: previous`);
  if (!isCount(plan.noProgress)) throw new UsageError(`${path}: noProgress is a whole number, 0 or more`);
  const number = (group, key, whole) => {
    const v = isObject(plan[group]) ? plan[group][key] : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (whole && !Number.isInteger(v))) {
      throw new UsageError(`${path}: ${group}.${key} is a ${whole ? 'whole ' : ''}number, 0 or more`);
    }
    return v;
  };
  const usage = { rounds: number('usage', 'rounds', true), spawns: number('usage', 'spawns', true), hours: number('usage', 'hours', false) };
  const limits = Object.fromEntries(LIMITS.map((k) => [k, number('limits', k, k !== 'hours')]));

  const progressed = previous === null ? null : JSON.stringify(previous) !== JSON.stringify(snapshot);
  const noProgress = progressed === false ? plan.noProgress + 1 : 0;
  const used = { ...usage, 'no-progress': noProgress };
  const stoppedBy = LIMITS.filter((k) => used[k] >= limits[k]);
  const stop = stoppedBy.length > 0;
  return {
    format: FORMAT,
    command: 'progress',
    progressed,
    noProgress,
    snapshot,
    stop,
    stoppedBy,
    rounds: stop ? usage.rounds : usage.rounds + 1,
  };
}

export function defaultDeps() {
  return {
    read: (p) => readFileSync(p, 'utf8'),
    git: (cwd, args, env = {}) =>
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      }),
    clock: () => Date.now(),
  };
}

const COMMANDS = { record, scan, progress };

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const command = COMMANDS[argv[0]];
    if (!command) throw new UsageError('expected record, scan or progress');
    return { code: 0, out: `${JSON.stringify(command(argv.slice(1), deps), null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('deadline', e);
  }
}

runIfEntry(import.meta.url, main);
