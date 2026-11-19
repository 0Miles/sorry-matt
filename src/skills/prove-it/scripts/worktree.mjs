#!/usr/bin/env node
// worktree: the review worktree of one ticket for prove-it — opened once, shared by the initial review and every
// recheck, removed when the verdict is final. No dependencies: runs on a bare Node 20+. Run it inside the repository
// (any of its worktrees); `--path` is the review worktree, e.g. <scratchpad>/review-<ticket>.
//
// Usage
//   node worktree.mjs open --path <dir> --ref <ticket branch>
//   node worktree.mjs status --path <dir>
//   node worktree.mjs close --path <dir>
//
// open    Puts a detached review worktree at the tip of --ref.
//           created  no worktree of this repository is registered at --path: `git worktree add --detach`. A
//                    registration whose directory is gone is pruned first.
//           reused   one is registered there and `git status --porcelain` in it is empty: `git checkout --detach` to
//                    the tip of --ref. Installed dependencies (ignored files) stay. `lockfileChanged` lists the
//                    lockfiles (LOCKFILES, matched by file name) that differ between its previous HEAD and the tip.
//           rebuilt  one is registered there but its status is not empty (`dirty` lists the porcelain lines): it is
//                    removed with `git worktree remove --force` and added again.
//         `install` is true when the dependencies must be restored from the lockfile: created, rebuilt, or a lockfile
//         changed. A directory at --path that is not a registered worktree is never touched: exit 1.
// status  Whether the review worktree is clean. `restored` is the value prove-it writes on its review block:
//         "yes" when `git status --porcelain` is empty, "no" when it is not (`dirty` lists the lines), "n/a" when no
//         worktree of this repository is registered at --path.
// close   Removes the review worktree (`git worktree remove --force`, then `git worktree prune`): `removed`, or
//         `absent` when none is registered at --path. Removing it twice is not an error.
// Every command refuses, touching nothing, the main worktree, the worktree it runs in, and any worktree at --path that
// is not detached (a branch checked out: an implementer's, the integration or the host's worktree). A review worktree
// is always detached.
//
// Output (stdout, JSON; fields are only ever added, never renamed)
//   open:   { "format": "sorry-matt/review-worktree@1", "command": "open", "path", "action": "created" | "reused" |
//             "rebuilt", "head": "<sha>", "previous": "<sha>" | null, "dirty": [lines], "lockfileChanged": [paths],
//             "install": true | false }
//   status: { "format", "command": "status", "path", "exists": true | false, "clean": true | false | null,
//             "dirty": [lines], "restored": "yes" | "no" | "n/a" }
//   close:  { "format", "command": "close", "path", "action": "removed" | "absent" }
//
// Exit codes: 0 done, 1 git failed (not a repository, a ref that does not resolve, a removal git refused) or --path
// is a directory that is not a registered worktree, 2 usage (a missing or unknown argument, --path names a worktree
// that every command refuses).
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'sorry-matt/review-worktree@1';
export const LOCKFILES = [
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'pdm.lock', 'Gemfile.lock', 'composer.lock',
  'packages.lock.json', 'mix.lock', 'pubspec.lock', 'Podfile.lock', 'gradle.lockfile', 'flake.lock',
];

class UsageError extends Error {}

// One key per directory: real path when it exists, forward slashes, no trailing slash, case-insensitive on Windows.
export function dirKey(p, platform = process.platform) {
  let full = resolve(p);
  try {
    full = realpathSync.native(full);
  } catch {
    // not on disk: compare the resolved text
  }
  const k = full.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? k.toLowerCase() : k;
}

// `git worktree list --porcelain` -> [{ path, branch, detached, prunable }]; the first entry is the main worktree.
// `branch` is the checked-out ref (refs/heads/...) or null; `detached` is true only for a detached HEAD.
export function parseWorktrees(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const last = out[out.length - 1];
    if (line.startsWith('worktree ')) {
      out.push({ path: line.slice('worktree '.length), branch: null, detached: false, prunable: false });
    } else if (!last) continue;
    else if (line.startsWith('branch ')) last.branch = line.slice('branch '.length);
    else if (line === 'detached') last.detached = true;
    else if (line.startsWith('prunable')) last.prunable = true;
  }
  return out;
}

export const statusLines = (text) => text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');

export const changedLockfiles = (nameOnly) =>
  statusLines(nameOnly).filter((p) => LOCKFILES.includes(basename(p)));

export function defaultDeps(cwd = process.cwd()) {
  return {
    cwd,
    exists: (p) => existsSync(p),
    git: (args, dir = cwd) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['open', 'status', 'close'].includes(command)) throw new UsageError('first argument must be "open", "status" or "close"');
  const allowed = command === 'open' ? ['path', 'ref'] : ['path'];
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : null;
    if (!name || !allowed.includes(name)) throw new UsageError(`unknown argument ${rest[i]}`);
    if (i + 1 >= rest.length) throw new UsageError(`${rest[i]} needs a value`);
    if (name in args) throw new UsageError(`${rest[i]} given twice`);
    args[name] = rest[++i];
  }
  for (const name of allowed) if (!args[name]) throw new UsageError(`${command} needs --${name}`);
  return args;
}

// The registered worktree at `path`, or null. Refuses (usage error, nothing touched) anything that is not a review
// worktree: the main worktree, the worktree this command runs in, and any worktree with a branch checked out (an
// implementer's ticket worktree, the integration worktree, the host's own). A review worktree is always detached.
function locate(deps, path) {
  const list = parseWorktrees(deps.git(['worktree', 'list', '--porcelain']));
  const key = dirKey(resolve(deps.cwd, path));
  if (list.length && dirKey(list[0].path) === key) throw new UsageError(`${path} is the main worktree`);
  const own = deps.git(['rev-parse', '--show-toplevel']).trim();
  if (own && dirKey(own) === key) throw new UsageError(`${path} is the worktree this command runs in`);
  const found = list.slice(1).find((w) => dirKey(w.path) === key) || null;
  if (found && !found.detached) {
    throw new UsageError(`${path} has ${found.branch ?? 'a branch'} checked out; a review worktree is always detached`);
  }
  return found;
}

const status = (deps, dir) => statusLines(deps.git(['status', '--porcelain', '--untracked-files=all'], dir));

function add(deps, dir, ref) {
  deps.git(['worktree', 'add', '--detach', '--quiet', dir, ref]);
  return deps.git(['rev-parse', 'HEAD'], dir).trim();
}

function remove(deps, dir) {
  deps.git(['worktree', 'remove', '--force', dir]);
  deps.git(['worktree', 'prune']);
}

export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    const dir = resolve(deps.cwd, args.path);
    const found = locate(deps, args.path);
    const live = found && !found.prunable && deps.exists(dir);
    let report;
    if (args.command === 'open') {
      try {
        deps.git(['rev-parse', '--verify', '--quiet', `${args.ref}^{commit}`]);
      } catch (e) {
        throw Object.assign(new Error(`cannot resolve ${args.ref} to a commit`), { stderr: e.stderr });
      }
      report = { action: 'created', head: null, previous: null, dirty: [], lockfileChanged: [] };
      if (found && !live) deps.git(['worktree', 'prune']);
      if (live) {
        const dirty = status(deps, dir);
        if (dirty.length) {
          remove(deps, dir);
          report = { ...report, action: 'rebuilt', dirty };
          report.head = add(deps, dir, args.ref);
        } else {
          const previous = deps.git(['rev-parse', 'HEAD'], dir).trim();
          deps.git(['checkout', '--detach', '--quiet', args.ref], dir);
          const head = deps.git(['rev-parse', 'HEAD'], dir).trim();
          const changed = previous === head ? '' : deps.git(['diff', '--name-only', '--no-renames', previous, head], dir);
          report = { ...report, action: 'reused', head, previous, lockfileChanged: changedLockfiles(changed) };
        }
      } else if (deps.exists(dir)) {
        throw new Error(`${args.path} exists and is not a worktree of this repository; remove it or choose another path`);
      } else {
        report.head = add(deps, dir, args.ref);
      }
      report.install = report.action !== 'reused' || report.lockfileChanged.length > 0;
    } else if (args.command === 'status') {
      const dirty = live ? status(deps, dir) : [];
      report = live
        ? { exists: true, clean: dirty.length === 0, dirty, restored: dirty.length === 0 ? 'yes' : 'no' }
        : { exists: false, clean: null, dirty: [], restored: 'n/a' };
    } else {
      if (found) {
        if (live) remove(deps, dir);
        else deps.git(['worktree', 'prune']);
      }
      report = { action: found ? 'removed' : 'absent' };
    }
    const out = { format: FORMAT, command: args.command, path: args.path, ...report };
    return { code: 0, out: `${JSON.stringify(out, null, 2)}\n`, err: '' };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `worktree: ${detail}\n${usage ? 'usage: see the header of worktree.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
