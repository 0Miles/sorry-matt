#!/usr/bin/env node
// overlap: which frontier tickets of one repository can start now without touching the files held by its tickets
// in flight, on any line. No dependencies: runs on a bare Node 20+.
//
// Usage
//   node overlap.mjs <plan.json>
//
// plan.json, written by the host for one repository, all its lines together:
//   {
//     "base":       "<integration branch>",   // optional default for running tickets without their own
//     "running":    [{ "id": "#12", "files": "<predicted-files list>", "worktree": "<ticket worktree>",
//                      "base": "<that ticket's line integration branch>" }],
//     "candidates": [{ "id": "#13", "files": "<predicted-files list>" }]     // in dispatch order
//   }
//   `files` is the path (absolute, or relative to the plan file) of a predicted-files list: one entry per line,
//   blank lines and lines starting with `#` ignored. An entry is a repo-relative path, `/` alone for the whole
//   repository, optionally followed by a symbol inside that file: `path#symbol`, the symbol a function, a block
//   or a markdown heading; a nested one is written from the outermost, `path#outer#inner`. Spaces around each
//   `#` are trimmed; a path itself cannot contain `#`, and `/` takes no symbol. A path covers itself and
//   everything under it, with or without a trailing `/`. A list with no entry is an error: predict `/` when
//   nothing narrower is known. `worktree` is optional; without it a running ticket holds only its prediction.
//   A running ticket with a worktree needs a base: its own `base`, else the plan's.
//
// A running ticket holds its predicted entries plus what its worktree changed since it branched from its base:
// `git diff --name-only --no-renames <merge-base of base and HEAD>` (committed, staged and unstaged) and the
// untracked files git does not ignore. Git sees files, not symbols: a changed file the ticket predicted by
// symbol is held as those symbols only. Two entries overlap when one path covers the other, except two entries
// on the same path that both name a symbol: those overlap only when one symbol chain starts with the other (the
// same symbol, or a symbol and one nested in it). An entry without a symbol is the whole file, on either side.
// Candidates are taken in order: one starts when none of its entries overlaps one held by a running ticket or
// by a candidate started before it in the same output; otherwise it waits.
//
// Output (stdout, JSON, format "sorry-matt/overlap@1"; fields are only ever added, never renamed)
//   {
//     "format":  "sorry-matt/overlap@1",
//     "base":    "<base>" | null,
//     "running": [{ "id": "#12", "base": "<its base>" | null, "predicted": ["src/a"],
//                   "actual": ["docs/y.md", "src/a/x.md"],
//                   "unpredicted": ["docs/y.md"] }],     // actual paths no predicted path covers
//     "start":   ["#13"],
//     "wait":    [{ "id": "#14", "overlaps": [{ "with": "#12", "paths": ["src/a/x.md"] }] }]
//   }
//   `predicted` and `paths` are entries as a list writes them (`path#symbol` when they name one); `unpredicted`
//   compares paths only. `paths` are the waiting candidate's own predicted entries that overlap the holder.
//   Paths are sorted;
//   `start` and `wait` keep the candidates' order.
//
// Exit codes: 0 output written; 1 a list or a worktree could not be read; 2 bad arguments or plan.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { UsageError, parseJson, failure, runIfEntry } from './cli.mjs';

export const FORMAT = 'sorry-matt/overlap@1';

/** A repo-relative path in canonical form; '' is the whole repository. */
export function normalize(path) {
  let p = String(path).trim().replace(/\\/g, '/');
  if (p === '/' || p === '.' || p === './') return '';
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) {
    throw new UsageError(`${path}: paths are repo-relative; "/" alone is the whole repository`);
  }
  p = p.replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/$/, '');
  if (p.split('/').includes('..')) throw new UsageError(`${path}: ".." is not allowed`);
  return p;
}

/** Whether one path covers the other. */
export const pathsOverlap = (a, b) => a === '' || b === '' || a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);

/**
 * The `path#symbol` syntax alone: { path: the text before the first `#`, as written; symbol: the chain, each trimmed }.
 * No check: parseEntry adds them. prove-it's tier.mjs reads its sensitive-path entries with it (#152).
 */
export function splitEntry(text) {
  const [path, ...rest] = String(text).split('#');
  return { path, symbol: rest.map((s) => s.trim()) };
}

/** A predicted-files entry: { path, symbol }, the symbol chain from the outermost; [] is the whole path. */
export function parseEntry(text) {
  const { path, symbol } = splitEntry(text);
  const entry = { path: normalize(path), symbol };
  if (entry.symbol.some((s) => !s)) throw new UsageError(`${text}: empty symbol; write path#symbol, a nested one path#outer#inner`);
  if (entry.symbol.length && entry.path === '') throw new UsageError(`${text}: the whole repository has no symbol`);
  return entry;
}

/** A path as git reports it: the whole file, even when its name contains `#`. */
export const whole = (path) => ({ path, symbol: [] });

/** An entry as a list writes it: `/` for the whole repository, `path#symbol` when it names one. */
export const display = (e) => (e.path === '' ? '/' : e.path) + e.symbol.map((s) => `#${s}`).join('');

/** Whether two entries overlap: their paths do, unless both name a symbol of one path and neither chain starts with the other. */
export function overlaps(a, b) {
  if (!pathsOverlap(a.path, b.path)) return false;
  if (a.path !== b.path || !a.symbol.length || !b.symbol.length) return true;
  return a.symbol.every((s, i) => i >= b.symbol.length || s === b.symbol[i]);
}

const uniqueSorted = (xs) => [...new Set(xs)].sort();

/** The entries of a predicted-files list, unique and sorted as written. */
export function parseList(text, where) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    const e = parseEntry(line);
    entries.set(display(e), e);
  }
  if (!entries.size) throw new UsageError(`${where}: no path; predict "/" when nothing narrower is known`);
  return [...entries.keys()].sort().map((k) => entries.get(k));
}

function changedFiles(git, worktree, base) {
  const z = (out) => out.split('\0').filter(Boolean);
  const mergeBase = git(worktree, ['merge-base', base, 'HEAD']).trim();
  return uniqueSorted([
    ...z(git(worktree, ['diff', '--name-only', '--no-renames', '-z', mergeBase])),
    ...z(git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ]);
}

/**
 * plan: { base, running: [{ id, files: [entries], worktree?, base? }], candidates: [{ id, files: [entries] }] }
 * with `files` already parsed by parseList. git(cwd, args) returns stdout.
 */
export function overlapPlan({ base = null, running = [], candidates = [] }, git) {
  const held = [];
  const runningOut = running.map((r) => {
    const own = r.base ?? base;
    const actual = r.worktree ? changedFiles(git, r.worktree, own) : [];
    const bySymbol = (a) => r.files.some((p) => p.symbol.length && p.path === a);
    held.push({ id: r.id, paths: [...r.files, ...actual.filter((a) => !bySymbol(a)).map(whole)] });
    return {
      id: r.id,
      base: own,
      predicted: r.files.map(display),
      actual,
      unpredicted: actual.filter((a) => !r.files.some((p) => pathsOverlap(p.path, a))),
    };
  });
  const start = [];
  const wait = [];
  for (const c of candidates) {
    const hits = held
      .map((h) => ({ with: h.id, paths: c.files.filter((p) => h.paths.some((q) => overlaps(p, q))).map(display) }))
      .filter((h) => h.paths.length);
    if (hits.length) {
      wait.push({ id: c.id, overlaps: hits });
    } else {
      start.push(c.id);
      held.push({ id: c.id, paths: c.files });
    }
  }
  return { format: FORMAT, base, running: runningOut, start, wait };
}

function readPlan(path, read) {
  let plan;
  try {
    plan = parseJson(read(path));
  } catch (e) {
    if (e instanceof SyntaxError) throw new UsageError(`${path}: not JSON (${e.message})`);
    throw e;
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new UsageError(`${path}: the plan is not an object`);
  const running = plan.running ?? [];
  const candidates = plan.candidates ?? [];
  if (!Array.isArray(running) || !Array.isArray(candidates)) {
    throw new UsageError(`${path}: running and candidates must be arrays`);
  }
  const seen = new Set();
  const entry = (e, i, kind) => {
    if (!e || typeof e.id !== 'string' || !e.id) throw new UsageError(`${path}: ${kind}[${i}] has no id`);
    if (seen.has(e.id)) throw new UsageError(`${path}: ${e.id} is listed twice`);
    seen.add(e.id);
    if (typeof e.files !== 'string' || !e.files) throw new UsageError(`${path}: ${e.id} has no files list`);
    for (const key of ['worktree', 'base']) {
      if (e[key] !== undefined && (kind !== 'running' || typeof e[key] !== 'string' || !e[key])) {
        throw new UsageError(`${path}: ${e.id}: ${key} is a non-empty string, and only running tickets have one`);
      }
    }
    const list = resolve(dirname(path), e.files);
    return {
      id: e.id,
      files: parseList(read(list), list),
      ...(e.worktree ? { worktree: e.worktree } : {}),
      ...(e.base ? { base: e.base } : {}),
    };
  };
  const out = {
    base: plan.base ?? null,
    running: running.map((e, i) => entry(e, i, 'running')),
    candidates: candidates.map((e, i) => entry(e, i, 'candidates')),
  };
  if (out.base !== null && (typeof out.base !== 'string' || !out.base)) throw new UsageError(`${path}: base is a non-empty string`);
  for (const r of out.running) {
    if (r.worktree && !(r.base ?? out.base)) throw new UsageError(`${path}: ${r.id} has a worktree but no base`);
  }
  return out;
}

export function defaultDeps() {
  return {
    read: (p) => readFileSync(p, 'utf8'),
    git: (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    if (argv.length !== 1 || argv[0].startsWith('-')) throw new UsageError('expected exactly one plan file');
    const result = overlapPlan(readPlan(resolve(argv[0]), deps.read), deps.git);
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('overlap', e);
  }
}

runIfEntry(import.meta.url, main);
