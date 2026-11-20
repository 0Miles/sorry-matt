// node --test scripts/worktree.test.mjs
// Real git repositories and real worktrees in temp dirs. Expected values come from how each fixture is built (which
// commit the branch points at, which files were written) and from git itself (`git worktree list`, `git status`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, defaultDeps, dirKey } from '../src/skills/prove-it/scripts/worktree.mjs';
import { shortPath } from './lib.mjs';

const SCRIPT = fileURLToPath(new URL('../src/skills/prove-it/scripts/worktree.mjs', import.meta.url));

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'review-wt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();

const put = (dir, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

// A repo on main with a `ticket` branch one commit ahead; the main worktree stays on main.
function repo(t) {
  const root = tempDir(t);
  const dir = join(root, 'repo');
  mkdirSync(dir);
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false'); // the worktrees the script checks out read the repo's config
  put(dir, { '.gitignore': 'node_modules/\n', 'a.js': 'a\n', 'package-lock.json': '{"v":1}\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('branch', 'ticket');
  return { root, dir, git, review: join(root, 'review-72') };
}

// Commits `files` on the ticket branch without touching the main worktree; returns the new tip.
function commitOnTicket(r, files) {
  const scratch = join(r.root, `impl-${Math.random().toString(36).slice(2)}`);
  r.git('worktree', 'add', '-q', scratch, 'ticket');
  put(scratch, files);
  const g = gitIn(scratch);
  g('add', '-A');
  g('commit', '-q', '-m', 'change');
  const tip = g('rev-parse', 'HEAD');
  r.git('worktree', 'remove', '--force', scratch);
  return tip;
}

const run = (r, ...argv) => {
  const out = main(argv, defaultDeps(r.dir));
  assert.equal(out.code, 0, out.err);
  return JSON.parse(out.out);
};
const registered = (r) => r.git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

test('open creates a detached worktree at the tip of the ref, and asks for an install', (t) => {
  const r = repo(t);
  const tip = commitOnTicket(r, { 'a.js': 'a2\n' });
  const out = run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(out.format, 'sorry-matt/review-worktree@1');
  assert.equal(out.action, 'created');
  assert.equal(out.head, tip);
  assert.equal(out.previous, null);
  assert.equal(out.install, true);
  assert.equal(readFileSync(join(r.review, 'a.js'), 'utf8'), 'a2\n');
  assert.equal(gitIn(r.review)('rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD'); // detached
  assert.equal(registered(r), 2);
});

test('open on a clean review worktree reuses it: it moves to the new tip and keeps installed dependencies', (t) => {
  const r = repo(t);
  const first = commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  put(r.review, { 'node_modules/dep/index.js': 'dep\n' }); // ignored: an installed dependency
  const second = commitOnTicket(r, { 'a.js': 'a3\n' });
  const out = run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(out.action, 'reused');
  assert.equal(out.previous, first);
  assert.equal(out.head, second);
  assert.deepEqual(out.lockfileChanged, []);
  assert.equal(out.install, false);
  assert.equal(readFileSync(join(r.review, 'a.js'), 'utf8'), 'a3\n');
  assert.ok(existsSync(join(r.review, 'node_modules/dep/index.js')));
  assert.equal(registered(r), 2); // created once
});

test('a reused worktree whose lockfile changed asks for an install', (t) => {
  const r = repo(t);
  commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  commitOnTicket(r, { 'package-lock.json': '{"v":2}\n', 'sub/yarn.lock': 'x\n' });
  const out = run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(out.action, 'reused');
  assert.deepEqual(out.lockfileChanged.sort(), ['package-lock.json', 'sub/yarn.lock']);
  assert.equal(out.install, true);
});

test('status reports restored "no" with the dirty lines; open then rebuilds the worktree from scratch', (t) => {
  const r = repo(t);
  const tip = commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(run(r, 'status', '--path', r.review).restored, 'yes');
  put(r.review, { 'a.js': 'mutated\n', 'left-behind.txt': 'x\n', 'node_modules/dep/index.js': 'dep\n' });
  const status = run(r, 'status', '--path', r.review);
  assert.equal(status.exists, true);
  assert.equal(status.clean, false);
  assert.equal(status.restored, 'no');
  assert.deepEqual(status.dirty.sort(), [' M a.js', '?? left-behind.txt']);
  const out = run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(out.action, 'rebuilt');
  assert.deepEqual(out.dirty.sort(), [' M a.js', '?? left-behind.txt']);
  assert.equal(out.head, tip);
  assert.equal(out.install, true);
  assert.equal(readFileSync(join(r.review, 'a.js'), 'utf8'), 'a2\n');
  assert.equal(existsSync(join(r.review, 'left-behind.txt')), false);
  assert.equal(existsSync(join(r.review, 'node_modules')), false);
  assert.equal(run(r, 'status', '--path', r.review).restored, 'yes');
});

test('close removes the worktree; a second close and a status afterwards find none', (t) => {
  const r = repo(t);
  commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  put(r.review, { 'a.js': 'dirty\n' });
  assert.equal(run(r, 'close', '--path', r.review).action, 'removed');
  assert.equal(existsSync(r.review), false);
  assert.equal(registered(r), 1);
  assert.equal(run(r, 'close', '--path', r.review).action, 'absent');
  const status = run(r, 'status', '--path', r.review);
  assert.equal(status.exists, false);
  assert.equal(status.restored, 'n/a');
});

test('a registration whose directory was deleted is pruned and the worktree created again', (t) => {
  const r = repo(t);
  commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  rmSync(r.review, { recursive: true, force: true });
  assert.equal(run(r, 'status', '--path', r.review).restored, 'n/a');
  const out = run(r, 'open', '--path', r.review, '--ref', 'ticket');
  assert.equal(out.action, 'created');
  assert.equal(registered(r), 2);
});

test('a deleted review worktree named by its Windows 8.3 short name is the registered one: pruned and created again', (t) => {
  const r = repo(t);
  const short = shortPath(r.root);
  if (!short) return t.skip('no 8.3 short path here (not Windows, or 8.3 names disabled)');
  commitOnTicket(r, { 'a.js': 'a2\n' });
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  rmSync(r.review, { recursive: true, force: true });
  const alias = join(short, 'review-72');
  assert.equal(dirKey(alias), dirKey(r.review), 'one key for a missing directory under either spelling');
  assert.equal(run(r, 'status', '--path', alias).restored, 'n/a');
  assert.equal(run(r, 'open', '--path', alias, '--ref', 'ticket').action, 'created');
  assert.equal(registered(r), 2);
  assert.equal(run(r, 'close', '--path', r.review).action, 'removed');
});

test('the main worktree, a foreign directory and an unknown ref are refused, and nothing is touched', (t) => {
  const r = repo(t);
  const mainWt = main(['close', '--path', r.dir], defaultDeps(r.dir));
  assert.equal(mainWt.code, 2);
  assert.match(mainWt.err, /main worktree/);
  assert.ok(existsSync(join(r.dir, 'a.js')));

  const foreign = join(r.root, 'not-a-worktree');
  put(foreign, { 'keep.txt': 'keep\n' });
  const opened = main(['open', '--path', foreign, '--ref', 'ticket'], defaultDeps(r.dir));
  assert.equal(opened.code, 1);
  assert.match(opened.err, /not a worktree/);
  assert.equal(readFileSync(join(foreign, 'keep.txt'), 'utf8'), 'keep\n');
  assert.equal(main(['close', '--path', foreign], defaultDeps(r.dir)).code, 0); // absent: not ours to remove
  assert.ok(existsSync(join(foreign, 'keep.txt')));

  const unknown = main(['open', '--path', r.review, '--ref', 'no-such-branch'], defaultDeps(r.dir));
  assert.equal(unknown.code, 1);
  assert.equal(existsSync(r.review), false);

  assert.equal(main(['open', '--path', r.review], defaultDeps(r.dir)).code, 2);
  assert.equal(main(['status', '--path', r.review, '--ref', 'ticket'], defaultDeps(r.dir)).code, 2);
  assert.equal(main(['prune'], defaultDeps(r.dir)).code, 2);
});

test('a worktree with a branch checked out is refused by open, status and close, dirty or clean, and kept as it is', (t) => {
  const r = repo(t);
  const impl = join(r.root, 'impl');
  r.git('worktree', 'add', '-q', impl, 'ticket'); // an implementer's ticket worktree
  put(impl, { 'uncommitted.txt': 'work in progress\n', 'a.js': 'edited\n' });
  for (const argv of [
    ['open', '--path', impl, '--ref', 'ticket'],
    ['open', '--path', impl, '--ref', 'HEAD'],
    ['status', '--path', impl],
    ['close', '--path', impl],
  ]) {
    const out = main(argv, defaultDeps(r.dir));
    assert.equal(out.code, 2, argv.join(' '));
    assert.match(out.err, /refs\/heads\/ticket checked out/);
  }
  assert.equal(readFileSync(join(impl, 'uncommitted.txt'), 'utf8'), 'work in progress\n');
  assert.equal(readFileSync(join(impl, 'a.js'), 'utf8'), 'edited\n');
  assert.equal(gitIn(impl)('rev-parse', '--abbrev-ref', 'HEAD'), 'ticket');

  const clean = join(r.root, 'integration');
  r.git('worktree', 'add', '-q', '-b', 'line', clean, 'main'); // a clean integration worktree
  assert.equal(main(['close', '--path', clean], defaultDeps(r.dir)).code, 2);
  assert.ok(existsSync(join(clean, 'a.js')));
  assert.equal(registered(r), 3);
});

test('the worktree the command runs in is refused, even a detached one', (t) => {
  const r = repo(t);
  run(r, 'open', '--path', r.review, '--ref', 'ticket');
  const inside = main(['close', '--path', '.'], defaultDeps(r.review));
  assert.equal(inside.code, 2);
  assert.match(inside.err, /runs in/);
  assert.equal(main(['open', '--path', r.review, '--ref', 'ticket'], defaultDeps(r.review)).code, 2);
  assert.ok(existsSync(join(r.review, 'a.js')));
  assert.equal(registered(r), 2);
});

test('the command line prints the same JSON and exit code', (t) => {
  const r = repo(t);
  commitOnTicket(r, { 'a.js': 'a2\n' });
  const res = spawnSync(process.execPath, [SCRIPT, 'open', '--path', r.review, '--ref', 'ticket'], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).action, 'created');
  const bad = spawnSync(process.execPath, [SCRIPT, 'open'], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
