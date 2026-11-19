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
//   `files` is the path (absolute, or relative to the plan file) of a predicted-files list: one repo-relative
//   path per line, `/` alone for the whole repository; blank lines and lines starting with `#` are ignored.
//   A path covers itself and everything under it, with or without a trailing `/`. A list with no path is an
//   error: predict `/` when nothing narrower is known. `worktree` is optional; without it a running ticket
//   holds only its prediction. A running ticket with a worktree needs a base: its own `base`, else the plan's.
//
// A running ticket holds its predicted paths plus what its worktree changed since it branched from its base:
// `git diff --name-only --no-renames <merge-base of base and HEAD>` (committed, staged and unstaged) and the
// untracked files git does not ignore. Two paths overlap when one covers the other. Candidates are taken in
// order: one starts when none of its paths overlaps a path held by a running ticket or by a candidate started
// before it in the same output; otherwise it waits.
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
//   `paths` are the waiting candidate's own predicted paths that overlap the holder. Paths are sorted;
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
export const overlaps = (a, b) => a === '' || b === '' || a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);

const display = (p) => (p === '' ? '/' : p);
const uniqueSorted = (xs) => [...new Set(xs)].sort();

export function parseList(text, where) {
  const paths = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normalize);
  if (!paths.length) throw new UsageError(`${where}: no path; predict "/" when nothing narrower is known`);
  return uniqueSorted(paths);
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
 * plan: { base, running: [{ id, files: [paths], worktree?, base? }], candidates: [{ id, files: [paths] }] }
 * with `files` already parsed by parseList. git(cwd, args) returns stdout.
 */
export function overlapPlan({ base = null, running = [], candidates = [] }, git) {
  const held = [];
  const runningOut = running.map((r) => {
    const own = r.base ?? base;
    const actual = r.worktree ? changedFiles(git, r.worktree, own) : [];
    held.push({ id: r.id, paths: uniqueSorted([...r.files, ...actual]) });
    return {
      id: r.id,
      base: own,
      predicted: r.files.map(display),
      actual,
      unpredicted: actual.filter((a) => !r.files.some((p) => overlaps(p, a))),
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
