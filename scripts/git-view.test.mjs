// node --test scripts/git-view.test.mjs
// tick.mjs's gitView, what one `next` reads of git (#160): one git process gives the refs, the worktrees and the
// origin; it answers what `git rev-parse`, `git worktree list` and `git remote get-url` answer. The expected values
// come from those git commands run here, not from gitView's own query.
import { noAutoGc } from './git-env.mjs'; // first: the git processes below skip automatic maintenance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gitView, defaultDeps } from '../src/skills/get-to-work/scripts/tick.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
/** The worktrees `git worktree list --porcelain` names, path → { branch, prunable }. */
const listed = (repo) =>
  Object.fromEntries(
    git(repo, 'worktree', 'list', '--porcelain')
      .split(/\n\s*\n/)
      .map((block) => {
        const lines = block.split('\n');
        const branch = lines.find((l) => l.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? null;
        return [lines[0].slice('worktree '.length), { branch, prunable: lines.some((l) => l.startsWith('prunable')) }];
      }),
  );

/** A repo with one commit on main, a bare origin it is pushed to, and branch `line` checked out in a linked worktree. */
function repoWorld(t, { push = true, origin = true } = {}) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-gitview-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const bare = join(dir, 'origin.git');
  const wt = join(dir, 'wt');
  git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
  noAutoGc(bare);
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  if (origin) git(repo, 'remote', 'add', 'origin', bare);
  if (origin && push) git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'worktree', 'add', '-q', '-b', 'line', wt, 'main');
  writeFileSync(join(wt, 'b.txt'), 'b\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'on the line');
  return { dir, repo, bare, wt };
}

/** tick.mjs's own deps, with every git call it makes counted. */
function counted() {
  const deps = defaultDeps();
  const calls = [];
  return { calls, deps: { ...deps, git: (cwd, args, env) => (calls.push(args.join(' ')), deps.git(cwd, args, env)) } };
}

test('#160: one git process answers the refs, the origin refs, the worktrees and whether there is an origin', (t) => {
  const w = repoWorld(t);
  const { calls, deps } = counted();
  const g = gitView(w.repo, deps);
  assert.equal(g.ref('main'), git(w.repo, 'rev-parse', 'main'));
  assert.equal(g.ref('line'), git(w.wt, 'rev-parse', 'HEAD'));
  assert.notEqual(g.ref('line'), g.ref('main'));
  assert.equal(g.remote('main'), git(w.bare, 'rev-parse', 'main'));
  assert.equal(g.remote('line'), null, 'line was never pushed');
  assert.equal(g.ref('nope'), null);
  assert.equal(g.ref(null), null);
  assert.equal(g.hasOrigin, true);
  const trees = listed(w.repo);
  const byBranch = (b) => Object.entries(trees).find(([, x]) => x.branch === b)[0];
  assert.equal(g.wtOf('line'), byBranch('line'));
  assert.equal(g.wtOf('main'), byBranch('main'));
  assert.equal(g.wtOf('nope'), null);
  assert.equal(calls.length, 1, calls.join('\n'));
});

test('#160: a worktree whose directory is gone, which git worktree list calls prunable, is no worktree', (t) => {
  const w = repoWorld(t);
  rmSync(w.wt, { recursive: true, force: true });
  const gone = Object.values(listed(w.repo)).find((x) => x.branch === 'line');
  assert.equal(gone.prunable, true, 'git itself calls it prunable');
  const g = gitView(w.repo, counted().deps);
  assert.equal(g.wtOf('line'), null);
  assert.equal(g.ref('line') !== null, true, 'the branch is still there');
});

test('#160: a bare repository is no worktree of its branch', (t) => {
  const w = repoWorld(t);
  const g = gitView(w.bare, counted().deps);
  assert.equal(g.ref('main'), git(w.bare, 'rev-parse', 'main'));
  assert.equal(g.wtOf('main'), null);
});

test('#160: an origin that was never fetched is an origin, as git remote get-url says; no origin is none', (t) => {
  const fresh = repoWorld(t, { push: false });
  assert.equal(git(fresh.repo, 'for-each-ref', 'refs/remotes'), '', 'no remote-tracking refs');
  const a = counted();
  const g = gitView(fresh.repo, a.deps);
  assert.equal(g.hasOrigin, true);
  assert.equal(g.remote('main'), null);
  assert.equal(a.calls.length, 2, a.calls.join('\n'));

  const none = repoWorld(t, { origin: false });
  const b = counted();
  const h = gitView(none.repo, b.deps);
  assert.equal(h.hasOrigin, false);
  assert.equal(h.remote('main'), null);
  assert.equal(h.ref('main'), git(none.repo, 'rev-parse', 'main'));
});

test('#160: an origin ref that names an annotated tag is the commit the tag points at, as rev-parse ^{commit} peels it', (t) => {
  const w = repoWorld(t);
  git(w.repo, 'tag', '-a', '-m', 'v1', 'v1', 'main');
  // git refuses a non-commit under refs/heads, not under refs/remotes
  git(w.repo, 'update-ref', 'refs/remotes/origin/tagged', git(w.repo, 'rev-parse', 'v1'));
  assert.notEqual(git(w.repo, 'rev-parse', 'refs/remotes/origin/tagged'), git(w.repo, 'rev-parse', 'main'), 'the ref names the tag object');
  const g = gitView(w.repo, counted().deps);
  assert.equal(g.remote('tagged'), git(w.repo, 'rev-parse', 'main'));
});

test('#160: a directory that is no git repository is refused', (t) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-gitview-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => gitView(dir, { ...defaultDeps(), git: (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...ENV, GIT_CEILING_DIRECTORIES: dirname(dir) } }) }), /is not a git working tree/);
});
