// node --test scripts/integrate.test.mjs
// Drives integrate.mjs through main() against real temp repositories (with a bare `origin` where a push is
// checked) and real state files written by state.mjs's own main. Expected values come from git itself (rev-parse,
// log, the remote's refs) and from frontier.mjs's reading of a Local Markdown ticket, not from integrate.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { parseTicket } from '../src/skills/get-to-work/scripts/frontier.mjs';
import { main as deadline } from '../src/skills/get-to-work/scripts/deadline.mjs';
import { shortPath } from './lib.mjs';

const NOW = '2026-03-10T12:00:00Z';
const LINE = 'run-1/line-a';
const SNAP = 'a'.repeat(64);

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-integrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A repo on main with one commit, optionally pushed to a bare origin, and an initialized state. */
function setup(t, { origin = true, profile, tracker, gh } = {}) {
  const dir = scratch(t);
  const repo = join(dir, 'repo');
  const statePath = join(dir, 'run-1.state.json');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (...args) => g(repo, ...args);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.md'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  let bare = null;
  if (origin) {
    bare = join(dir, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git('remote', 'add', 'origin', bare);
    git('push', '-q', 'origin', 'main');
  }
  const st = (...argv) => {
    const r = stateMain([argv[0], statePath, ...argv.slice(1), '--now', NOW]);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  st('init', '--run', 'run-1', ...(tracker ? ['--tracker', tracker] : []));
  if (profile) st('profile', ...Object.entries(profile).flatMap(([k, v]) => [`--${k}`, String(v)]));
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const integrate = (...argv) => {
    const r = main([argv[0], statePath, ...argv.slice(1), '--now', NOW], { cwd: repo, ...(gh ? { gh } : {}) });
    return { ...r, json: r.out ? JSON.parse(r.out) : null };
  };
  const ok = (...argv) => {
    const r = integrate(...argv);
    assert.equal(r.code, 0, r.err);
    return r.json;
  };
  /** Refused (exit 3) with a message matching `re`, nothing on stdout. */
  const refused = (re, ...argv) => {
    const r = integrate(...argv);
    assert.equal(r.code, 3, `expected a refusal, got ${r.code}: ${r.out}${r.err}`);
    assert.equal(r.out, '');
    assert.match(r.err, re);
  };
  /** Moves a ticket the legitimate way to queued: snapshot, implementing, in-review, a full pass. */
  const queue = (id) => {
    st('set', id, '--snapshot', SNAP);
    st('stage', 'implementing', id);
    st('stage', 'in-review', id);
    st('review', id, '--mode', 'initial', '--verdict', 'pass');
    st('stage', 'queued', id);
  };
  /** Commits `edits` ({ file: text }) in a worktree. */
  const work = (wt, edits, message) => {
    for (const [f, text] of Object.entries(edits)) writeFileSync(join(wt, f), text);
    g(wt, 'add', '-A');
    g(wt, 'commit', '-q', '-m', message);
    return g(wt, 'rev-parse', 'HEAD');
  };
  return { dir, repo, bare, statePath, g, git, st, state, integrate, ok, refused, queue, work };
}

/** setup() plus an aggregate-pr line with its worktree and ticket ids added on it. */
function withLine(t, ids, opts) {
  const env = setup(t, opts);
  const lineWt = join(env.dir, 'wt-line');
  env.ok('line-init', '--branch', LINE, '--worktree', lineWt);
  env.st('add', ...ids, '--line', LINE);
  return { ...env, lineWt };
}

test('line-init (aggregate-pr) creates the integration branch and worktree, records the tip, and is idempotent', (t) => {
  const { dir, git, ok, state, refused, g } = setup(t);
  const base = git('rev-parse', 'HEAD');
  const wt = join(dir, 'wt-line');
  const out = ok('line-init', '--branch', LINE, '--worktree', wt);
  assert.equal(out.format, 'sorry-matt/integrate@1');
  assert.equal(out.integrate, 'aggregate-pr');
  assert.deepEqual(out.created, { branch: true, worktree: true });
  assert.equal(out.tip, base);
  assert.equal(git('rev-parse', `refs/heads/${LINE}`), base);
  assert.equal(g(wt, 'symbolic-ref', '--short', 'HEAD'), LINE);
  assert.equal(state().lines[LINE].tip, base);

  const before = readFileSync(join(dir, 'run-1.state.json'), 'utf8');
  const again = ok('line-init', '--branch', LINE, '--worktree', wt);
  assert.deepEqual(again.created, { branch: false, worktree: false });
  assert.equal(readFileSync(join(dir, 'run-1.state.json'), 'utf8'), before, 'nothing to record on a rerun');

  refused(/already checked out at/, 'line-init', '--branch', LINE, '--worktree', join(dir, 'elsewhere'));
  refused(/aggregate-pr needs the line's own integration branch; main is the base branch/, 'line-init', '--branch', 'main', '--worktree', join(dir, 'wt-main'));
});

test('line-init (direct) uses the base branch where it is checked out and creates nothing', (t) => {
  const { dir, repo, git, ok, state, integrate, refused } = setup(t, { profile: { integrate: 'direct' } });
  const out = ok('line-init', '--branch', 'main');
  assert.equal(out.integrate, 'direct');
  assert.deepEqual(out.created, { branch: false, worktree: false });
  // git reports the long name; tmpdir() may give a Windows 8.3 short one (C:\Users\RUNNER~1): one directory.
  assert.equal(realpathSync.native(out.worktree), realpathSync.native(repo));
  assert.equal(state().lines.main.tip, git('rev-parse', 'HEAD'));
  assert.equal(integrate('line-init', '--branch', 'main', '--from', 'HEAD').code, 2);
  refused(/checked out at .*that is the line's worktree/, 'line-init', '--branch', 'main', '--worktree', join(dir, 'other'));
  refused(/base branch nope, which does not exist/, 'line-init', '--branch', 'nope', '--worktree', join(dir, 'other'));
});

test('ticket-init cuts the ticket branch from the line tip and records it', (t) => {
  const { dir, git, g, ok, state, refused, work, lineWt } = withLine(t, ['#1', '#2']);
  const tip = work(lineWt, { 'x.md': 'x\n' }, 'line-level commit');
  const wt = join(dir, 'wt-1');
  const out = ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  assert.equal(out.from, tip);
  assert.equal(out.head, tip);
  assert.deepEqual(out.created, { branch: true, worktree: true });
  assert.equal(git('rev-parse', 'refs/heads/run-1/01-a'), tip);
  assert.equal(g(wt, 'symbolic-ref', '--short', 'HEAD'), 'run-1/01-a');
  assert.equal(state().tickets['#1'].branch, 'run-1/01-a');

  const again = ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  assert.deepEqual(again.created, { branch: false, worktree: false });
  assert.equal(again.from, null);
  refused(/is not a ticket of this run/, 'ticket-init', '#9', '--branch', 'run-1/09-x', '--worktree', join(dir, 'wt-9'));
  refused(/is already the worktree of/, 'ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', lineWt);
});

test('merge: a normal integration merges --no-ff, records the SHA, delivers, pushes and cleans up; a rerun changes nothing', (t) => {
  const { dir, bare, git, g, ok, state, queue, work, lineWt } = withLine(t, ['#1']);
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  const before = git('rev-parse', `refs/heads/${LINE}`);
  const ticketTip = work(wt, { 'b.md': 'b\n' }, '#1: add b');
  queue('#1');

  const out = ok('merge', '#1', '--worktree', lineWt, '--push');
  const head = g(lineWt, 'rev-parse', 'HEAD');
  assert.equal(out.result, 'merged');
  assert.equal(out.found, 'merged');
  assert.equal(out.merge, head);
  assert.equal(out.tip, head);
  assert.equal(out.stage, 'delivered');
  assert.equal(out.delivery, 'none');
  assert.deepEqual(out.push, { status: 'pushed' });
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  // git: one --no-ff merge commit with git's default message, its parents the old tip and the ticket.
  assert.equal(g(lineWt, 'rev-parse', 'HEAD^1'), before);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD^2'), ticketTip);
  assert.equal(g(lineWt, 'log', '-1', '--format=%s'), `Merge branch 'run-1/01-a' into ${LINE}`);
  assert.equal(execFileSync('git', ['--git-dir', bare, 'rev-parse', `refs/heads/${LINE}`], { encoding: 'utf8' }).trim(), head);
  assert.equal(existsSync(wt), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/01-a'));
  // state: integrating then delivered, the merge SHA and the line tip.
  const s = state();
  assert.equal(s.tickets['#1'].stage, 'delivered');
  assert.deepEqual(s.tickets['#1'].merges.map((m) => m.sha), [head]);
  assert.deepEqual(s.tickets['#1'].history.slice(-2).map((h) => h.to), ['integrating', 'delivered']);
  assert.equal(s.lines[LINE].tip, head);

  const revision = s.revision;
  const again = ok('merge', '#1', '--worktree', lineWt, '--push');
  assert.equal(again.found, 'state');
  assert.equal(again.merge, head);
  assert.deepEqual(again.cleanup, { worktree: 'absent', branch: 'absent' });
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head, 'no second merge');
  assert.equal(state().revision, revision, 'nothing left to record');
});

test('merge: a conflict aborts, lists the files and leaves state, HEAD and the worktree as they were', (t) => {
  const { dir, g, ok, integrate, statePath, queue, work, state, lineWt } = withLine(t, ['#1', '#2']);
  const wt1 = join(dir, 'wt-1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1);
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  work(wt1, { 'a.md': 'one\ntwo\n' }, '#1: two');
  const tip2 = work(wt2, { 'a.md': 'one\nTHREE\n', 'c.md': 'c\n' }, '#2: three');
  queue('#1');
  queue('#2');
  ok('merge', '#1', '--worktree', lineWt);

  const head = g(lineWt, 'rev-parse', 'HEAD');
  const before = readFileSync(statePath, 'utf8');
  const r = integrate('merge', '#2', '--worktree', lineWt);
  assert.equal(r.code, 4, r.err);
  assert.equal(r.json.result, 'conflict');
  assert.deepEqual(r.json.files, ['a.md']);
  assert.equal(readFileSync(statePath, 'utf8'), before, 'state unchanged');
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);
  assert.equal(g(lineWt, 'status', '--porcelain'), '');
  assert.throws(() => g(lineWt, 'rev-parse', '--verify', '-q', 'MERGE_HEAD'));
  assert.equal(state().tickets['#2'].stage, 'queued');

  // A merge agent resolves it in the merge commit; the rerun finds that merge and finishes the rest.
  try {
    g(lineWt, 'merge', '--no-ff', '--no-edit', 'run-1/02-b');
  } catch {
    // the conflict, as expected
  }
  writeFileSync(join(lineWt, 'a.md'), 'one\ntwo\nTHREE\n');
  g(lineWt, 'add', 'a.md');
  g(lineWt, 'commit', '-q', '--no-edit');
  const resolved = g(lineWt, 'rev-parse', 'HEAD');
  const out = ok('merge', '#2', '--worktree', lineWt);
  assert.equal(out.found, 'git');
  assert.equal(out.merge, resolved);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), resolved);
  assert.equal(g(lineWt, 'rev-parse', `${resolved}^2`), tip2);
  assert.equal(state().tickets['#2'].stage, 'delivered');
  assert.deepEqual(state().tickets['#2'].merges.map((m) => m.sha), [resolved]);
});

test('merge: interrupted after the git merge, a rerun records it and does only the remaining steps', (t) => {
  const { dir, g, ok, queue, work, state, lineWt } = withLine(t, ['#1']);
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  work(wt, { 'b.md': 'b\n' }, '#1: add b');
  queue('#1');
  // The merge ran, then the process died before anything was recorded.
  g(lineWt, 'merge', '-q', '--no-ff', '--no-edit', 'run-1/01-a');
  const merged = g(lineWt, 'rev-parse', 'HEAD');
  const merges = () => g(lineWt, 'rev-list', '--merges', '--count', 'HEAD');
  assert.equal(merges(), '1');

  const out = ok('merge', '#1', '--worktree', lineWt);
  assert.equal(out.found, 'git');
  assert.equal(out.merge, merged);
  assert.equal(merges(), '1', 'not merged a second time');
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), merged);
  assert.equal(state().tickets['#1'].stage, 'delivered');
  assert.deepEqual(state().tickets['#1'].merges.map((m) => m.sha), [merged]);
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
});

test('merge: a cleanup that cannot finish keeps the earlier steps; the rerun only cleans up', (t) => {
  const { dir, g, ok, queue, work, state, refused, lineWt } = withLine(t, ['#1']);
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  work(wt, { 'b.md': 'b\n' }, '#1: add b');
  queue('#1');
  writeFileSync(join(wt, 'b.md'), 'dirty\n');

  refused(/merged and recorded, but its worktree .* could not be removed/, 'merge', '#1', '--worktree', lineWt);
  const merged = g(lineWt, 'rev-parse', 'HEAD');
  assert.equal(state().tickets['#1'].stage, 'delivered');
  assert.deepEqual(state().tickets['#1'].merges.map((m) => m.sha), [merged]);
  assert.equal(existsSync(wt), true);

  g(wt, 'checkout', '--', 'b.md');
  const out = ok('merge', '#1', '--worktree', lineWt);
  assert.equal(out.found, 'state');
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), merged);
});

const TICKET = [
  '# 01: Add b',
  '',
  '**Status:** ready-for-agent',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] b.md exists',
  '- [ ] it says b',
  '',
  '## Comments',
  '',
  '- [ ] a quoted box that is not a criterion',
  '',
  '## sorry-matt expansion',
  '',
  '<!-- sorry-matt:expansion -->',
  'by: expansion-agent',
  'run: run-1',
  'round: 1',
  '',
  'acceptance:',
  '- [ ] b.md ends with a newline',
  '',
].join('\n');

test('merge --local: the Local Markdown delivery commit ticks the criteria, sets Status and appends the completion record', (t) => {
  const { dir, g, ok, queue, work, state, refused, lineWt } = withLine(t, ['01-add-b.md'], { origin: false });
  const file = 'issues/01-add-b.md';
  mkdirSync(join(lineWt, 'issues'));
  work(lineWt, { [file]: TICKET }, 'expand 01');
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '01-add-b.md', '--branch', 'run-1/01-add-b', '--worktree', wt);
  const c1 = work(wt, { 'b.md': 'b\n' }, '01: add b');
  const c2 = work(wt, { 'b.md': 'b\nmore\n' }, '01: more b');
  queue('01-add-b.md');
  const head = g(lineWt, 'rev-parse', 'HEAD');

  refused(/needs the checks passed/, 'merge', '01-add-b.md', '--worktree', lineWt, '--local', file);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head, 'refused before merging');

  const out = ok('merge', '01-add-b.md', '--worktree', lineWt, '--local', file, '--checks', 'node --test (green)', '--push');
  assert.equal(out.delivery, 'committed');
  assert.deepEqual(out.push, { status: 'no-origin' });
  assert.equal(g(lineWt, 'log', '-1', '--format=%s'), '01-add-b.md: sorry-matt completion');
  assert.equal(g(lineWt, 'rev-parse', 'HEAD^'), out.merge);
  assert.equal(g(lineWt, 'diff', '--name-only', 'HEAD^', 'HEAD'), file, 'the delivery commit holds the ticket file only');
  assert.equal(out.tip, g(lineWt, 'rev-parse', 'HEAD'));
  assert.equal(state().lines[LINE].tip, out.tip);

  const text = g(lineWt, 'show', `HEAD:${file}`);
  const parsed = parseTicket(text);
  assert.equal(parsed.state, 'done');
  assert.equal(parsed.status, 'ready-for-human');
  assert.match(text, /- \[x\] b\.md exists/);
  assert.match(text, /- \[x\] b\.md ends with a newline/);
  assert.match(text, /- \[ \] a quoted box that is not a criterion/);
  const completion = text.slice(text.indexOf('## sorry-matt completion'));
  assert.ok(completion.includes(out.merge));
  assert.ok(completion.includes(LINE));
  assert.ok(completion.includes('node --test (green)'));
  for (const c of [c1, c2]) assert.ok(completion.includes(c.slice(0, 7)), `lists ${c}`);

  const tip = out.tip;
  const again = ok('merge', '01-add-b.md', '--worktree', lineWt, '--local', file, '--checks', 'node --test (green)');
  assert.equal(again.delivery, 'already');
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), tip, 'no second delivery commit');
});

test('merge --push under integrate: direct leaves the push to the protected base branch to the host', (t) => {
  const { dir, repo, bare, g, ok, st, queue, work } = setup(t, { profile: { integrate: 'direct' } });
  ok('line-init', '--branch', 'main');
  st('add', '#1', '--line', 'main');
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  const ticketTip = work(wt, { 'b.md': 'b\n' }, '#1: add b');
  queue('#1');
  const remoteBefore = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();

  const out = ok('merge', '#1', '--worktree', repo, '--push');
  assert.equal(out.push.status, 'host');
  assert.match(out.push.command, /push -u origin main$/);
  assert.equal(g(repo, 'rev-parse', 'HEAD'), out.merge, 'merged straight into main');
  assert.equal(g(repo, 'rev-parse', 'HEAD^2'), ticketTip);
  assert.equal(g(repo, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim(), remoteBefore, 'not pushed');
});

test('merge refuses what it cannot do, without touching anything', (t) => {
  const { dir, g, ok, st, queue, work, integrate, refused, lineWt, repo } = withLine(t, ['#1', '#2']);
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  work(wt, { 'b.md': 'b\n' }, '#1: add b');
  st('set', '#1', '--snapshot', SNAP);
  st('stage', 'implementing', '#1');
  refused(/#1 is implementing; merge takes a ticket that is queued/, 'merge', '#1', '--worktree', lineWt);
  st('stage', 'in-review', '#1');
  st('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  st('stage', 'queued', '#1');
  refused(/has main checked out, not #1's integration branch/, 'merge', '#1', '--worktree', repo);
  queue('#2');
  refused(/#2 has no ticket branch recorded/, 'merge', '#2', '--worktree', lineWt);
  // An empty ticket branch is already "contained" in the line, but nothing of it was merged.
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', join(dir, 'wt-2'));
  refused(/run-1\/02-b is already contained in .* but no merge of it is there/, 'merge', '#2', '--worktree', lineWt);
  writeFileSync(join(lineWt, 'a.md'), 'dirty\n');
  refused(/uncommitted changes; the merge needs a clean worktree/, 'merge', '#1', '--worktree', lineWt);
  g(lineWt, 'checkout', '--', 'a.md');
  assert.equal(integrate('merge', '#1').code, 2);
  assert.equal(integrate('merge', '#1', '--worktree', lineWt, '--checks', 'x').code, 2);
  assert.equal(integrate('frobnicate').code, 2);
});

test('ticket-init and merge refuse a branch that is not the ticket\'s own, touching nothing', (t) => {
  const { dir, git, g, ok, queue, work, statePath, refused, lineWt } = withLine(t, ['#1', '#2', '#3']);
  const wt1 = join(dir, 'wt-1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1);
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  work(wt1, { 'b.md': 'b\n' }, '#1: add b');
  work(wt2, { 'c.md': 'c\n' }, '#2: add c');
  queue('#1');
  queue('#2');
  queue('#3');
  const snapshot = () => ({
    state: readFileSync(statePath, 'utf8'),
    refs: git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
    worktrees: git('worktree', 'list', '--porcelain'),
    line: g(lineWt, 'rev-parse', 'HEAD'),
    status: g(lineWt, 'status', '--porcelain'),
  });
  const untouched = (re, ...argv) => {
    const before = snapshot();
    refused(re, ...argv);
    assert.deepEqual(snapshot(), before);
  };
  const m = (id, branch) => ['merge', id, '--worktree', lineWt, '--branch', branch];
  const ti = (id, branch) => ['ticket-init', id, '--branch', branch, '--worktree', join(dir, 'wt-new')];

  untouched(/#1's recorded ticket branch is run-1\/01-a, not run-1\/02-b/, ...m('#1', 'run-1/02-b'));
  untouched(/run-1\/02-b is #2's ticket branch/, ...m('#3', 'run-1/02-b'));
  untouched(/run-1\/line-a is an integration branch of this run/, ...m('#3', LINE));
  untouched(/main is a protected branch/, ...m('#3', 'main'));
  untouched(/#1's recorded ticket branch is run-1\/01-a, not run-1\/01-z/, ...ti('#1', 'run-1/01-z'));
  untouched(/run-1\/02-b is #2's ticket branch/, ...ti('#3', 'run-1/02-b'));
  untouched(/run-1\/line-a is an integration branch of this run/, ...ti('#3', LINE));
  untouched(/master is a protected branch/, ...ti('#3', 'master'));
  assert.equal(existsSync(join(dir, 'wt-new')), false);

  // A delivered ticket's rerun with the line as --branch must not remove the integration worktree.
  ok('merge', '#1', '--worktree', lineWt);
  untouched(/#1's recorded ticket branch is run-1\/01-a, not run-1\/line-a/, ...m('#1', LINE));
  assert.equal(existsSync(lineWt), true);
  assert.equal(existsSync(wt2), true);
});

// ---- red-light fix, revert, send back and stuck --------------------------------------------------------------------

/** Integrates one ticket the legitimate way: ticket-init, a commit, a full pass, merge. Returns the merge SHA. */
function integrateOne(env, id, branch, edits, mergeArgs = []) {
  const wt = join(env.dir, `wt-${branch.split('/').pop()}`);
  env.ok('ticket-init', id, '--branch', branch, '--worktree', wt);
  env.work(wt, edits, `${id}: work`);
  env.queue(id);
  return env.ok('merge', id, '--worktree', env.lineWt, ...mergeArgs).merge;
}

/** A ticket moved to implementing with a branch, a worktree and one commit. Returns { wt, tip }. */
function implementing(env, id, branch, edits) {
  const wt = join(env.dir, `wt-${branch.split('/').pop()}`);
  env.ok('ticket-init', id, '--branch', branch, '--worktree', wt);
  const tip = env.work(wt, edits, `${id}: work`);
  env.st('set', id, '--snapshot', SNAP);
  env.st('stage', 'implementing', id);
  return { wt, tip };
}

const remoteTip = (bare, ref) => execFileSync('git', ['--git-dir', bare, 'rev-parse', ref], { encoding: 'utf8' }).trim();

test('ci-init and merge --ci: the fix branch is cut from the line tip, merged and recorded on the delivered ticket; reruns change nothing', (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { dir, git, g, ok, st, state, integrate, refused, work, lineWt } = env;
  const m1 = integrateOne(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  refused(/#2 is candidate; a red-light fix is for a delivered ticket/, 'ci-init', '#2', '--worktree', join(dir, 'wt-x'));
  assert.equal(integrate('merge', '#1', '--worktree', lineWt, '--ci', '--branch', 'run-1/01-a').code, 2);

  const lineTip = g(lineWt, 'rev-parse', 'HEAD');
  const wtCi = join(dir, 'wt-ci');
  const init = ok('ci-init', '#1', '--worktree', wtCi);
  assert.equal(init.branch, 'run-1/01-a-ci');
  assert.equal(init.from, lineTip);
  assert.deepEqual(init.created, { branch: true, worktree: true });
  assert.equal(g(wtCi, 'symbolic-ref', '--short', 'HEAD'), 'run-1/01-a-ci');
  assert.deepEqual(ok('ci-init', '#1', '--worktree', wtCi).created, { branch: false, worktree: false });
  const fix = work(wtCi, { 'b.md': 'b fixed\n' }, '#1: fix CI');

  const out = ok('merge', '#1', '--worktree', lineWt, '--ci', '--push');
  const head = g(lineWt, 'rev-parse', 'HEAD');
  assert.equal(out.ci, true);
  assert.equal(out.found, 'merged');
  assert.equal(out.merge, head);
  assert.equal(out.stage, 'delivered');
  assert.equal(out.delivery, 'none');
  assert.deepEqual(out.push, { status: 'pushed' });
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(g(lineWt, 'rev-parse', 'HEAD^1'), lineTip);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD^2'), fix);
  assert.equal(g(lineWt, 'log', '-1', '--format=%s'), `Merge branch 'run-1/01-a-ci' into ${LINE}`);
  assert.equal(remoteTip(env.bare, `refs/heads/${LINE}`), head);
  assert.equal(existsSync(wtCi), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/01-a-ci'));
  assert.deepEqual(state().tickets['#1'].merges.map((m) => m.sha), [m1, head]);
  assert.equal(state().tickets['#1'].stage, 'delivered');
  assert.equal(state().lines[LINE].tip, head);

  const revision = state().revision;
  const again = ok('merge', '#1', '--worktree', lineWt, '--ci');
  assert.equal(again.found, 'state');
  assert.equal(again.merge, head);
  assert.deepEqual(again.cleanup, { worktree: 'absent', branch: 'absent' });
  assert.equal(state().revision, revision);

  // A second round, interrupted after the git merge: the rerun finds and records it.
  ok('ci-init', '#1', '--worktree', wtCi);
  work(wtCi, { 'b.md': 'b fixed twice\n' }, '#1: fix CI again');
  g(lineWt, 'merge', '-q', '--no-ff', '--no-edit', 'run-1/01-a-ci');
  const second = g(lineWt, 'rev-parse', 'HEAD');
  const rerun = ok('merge', '#1', '--worktree', lineWt, '--ci');
  assert.equal(rerun.found, 'git');
  assert.equal(rerun.merge, second);
  assert.equal(g(lineWt, 'rev-list', '--merges', '--count', 'HEAD'), '3', 'not merged a second time');
  assert.deepEqual(state().tickets['#1'].merges.map((m) => m.sha), [m1, head, second]);

  // The fix branch rule: never another ticket's branch.
  st('set', '#2', '--branch', 'run-1/01-a-ci');
  refused(/run-1\/01-a-ci is #2's branch/, 'ci-init', '#1', '--worktree', join(dir, 'wt-y'));
  assert.equal(existsSync(join(dir, 'wt-y')), false);
});

test('revert: every merge of the ticket is reverted newest first, dependents become stuck or awaiting a ruling, and reruns finish what is left', (t) => {
  const env = withLine(t, ['#1', '#2', '#3', '#4']);
  const { dir, git, g, ok, st, state, refused, work, lineWt } = env;
  const m1 = integrateOne(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  const m2 = integrateOne(env, '#2', 'run-1/02-b', { 'c.md': 'c\n' });
  ok('ci-init', '#1', '--worktree', join(dir, 'wt-ci'));
  work(join(dir, 'wt-ci'), { 'b.md': 'b fixed\n' }, '#1: fix CI');
  const m1ci = ok('merge', '#1', '--worktree', lineWt, '--ci').merge;
  const three = implementing(env, '#3', 'run-1/03-c', { 'd.md': 'd\n' });
  const four = implementing(env, '#4', 'run-1/04-d', { 'e.md': 'e\n' });
  const rec = join(dir, 'rec.json');
  writeFileSync(rec, deadline(['record', '--worktree', four.wt, '--limit', '30', '--now', NOW]).out);
  st('assign', '#4', '--record', rec, '--type', 'general-purpose', '--worktree', four.wt);
  st('agent', '#4', '--id', 'agent-4');
  const before = g(lineWt, 'rev-parse', 'HEAD');

  const deps = ['--dependent', '#2', '--dependent', '#3', '--dependent', '#4'];
  const out = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red: b.md', ...deps, '--push');
  const head = g(lineWt, 'rev-parse', 'HEAD');
  // git: two revert commits, the -ci merge first, each with git's default message naming the merge.
  assert.equal(g(lineWt, 'rev-parse', 'HEAD~2'), before);
  assert.match(g(lineWt, 'log', '-1', '--format=%B', 'HEAD~1'), new RegExp(`This reverts commit ${m1ci}`));
  assert.match(g(lineWt, 'log', '-1', '--format=%B', 'HEAD'), new RegExp(`This reverts commit ${m1}`));
  assert.deepEqual(out.reverts, [
    { merge: m1, revert: head, found: 'reverted' },
    { merge: m1ci, revert: g(lineWt, 'rev-parse', 'HEAD~1'), found: 'reverted' },
  ]);
  assert.equal(existsSync(join(lineWt, 'b.md')), false, '#1 is gone from the line');
  assert.equal(readFileSync(join(lineWt, 'c.md'), 'utf8'), 'c\n', "#2's merge stays");
  assert.equal(out.record, 'host');
  assert.equal(out.completion, 'none');
  assert.equal(out.stage, 'stuck');
  assert.equal(out.tip, head);
  assert.deepEqual(out.push, { status: 'pushed' });
  assert.equal(remoteTip(env.bare, `refs/heads/${LINE}`), head);
  // state: the ticket stuck with the reason and the reverts; #2 stuck, #3 and #4 awaiting a ruling, upstream named.
  const s = state();
  assert.equal(s.tickets['#1'].stage, 'stuck');
  assert.match(s.tickets['#1'].reason, /^CI red: b\.md; reverted /);
  assert.ok(s.tickets['#1'].reason.includes(`${m1} by ${head}`));
  assert.equal(s.tickets['#2'].stage, 'stuck');
  assert.match(s.tickets['#2'].reason, /^upstream reverted: #1 \(/);
  assert.deepEqual(s.tickets['#2'].merges.map((m) => m.sha), [m2]);
  assert.equal(s.tickets['#3'].stage, 'awaiting-ruling');
  assert.equal(s.tickets['#3'].reason, s.tickets['#2'].reason);
  assert.equal(s.tickets['#4'].stage, 'awaiting-ruling');
  assert.equal(s.lines[LINE].tip, head);
  // #3: its tip kept at upstream-reverted, its worktree and branch gone. #4: its agent is still in flight.
  const [d2, d3, d4] = out.dependents;
  assert.deepEqual([d2.treatment, d2.stage, d2.cleanup], ['integrated', 'stuck', null]);
  assert.equal(d3.treatment, 'in-flight');
  assert.deepEqual(d3.kept, { ref: 'refs/sorry-matt/run-1/03-c/upstream-reverted', sha: three.tip });
  assert.deepEqual(d3.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(git('rev-parse', 'refs/sorry-matt/run-1/03-c/upstream-reverted'), three.tip);
  assert.equal(existsSync(three.wt), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/03-c'));
  assert.deepEqual([d4.cleanup, d4.agent, d4.kept], ['agent-in-flight', 'agent-4', null]);
  assert.equal(git('rev-parse', 'refs/heads/run-1/04-d'), four.tip);
  assert.equal(existsSync(four.wt), true);

  // A rerun changes nothing while the agent is in flight.
  const revision = state().revision;
  const again = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red: b.md', ...deps);
  assert.deepEqual(again.reverts.map((r) => r.found), ['git', 'git']);
  assert.deepEqual(again.reverts.map((r) => r.revert), out.reverts.map((r) => r.revert));
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);
  assert.equal(state().revision, revision);
  assert.deepEqual(again.dependents[1].cleanup, { worktree: 'absent', branch: 'absent' });

  // The agent reports; released, the rerun keeps #4's tip and cleans up.
  st('release', '#4');
  const after = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red: b.md', ...deps);
  assert.deepEqual(after.dependents[2].kept, { ref: 'refs/sorry-matt/run-1/04-d/upstream-reverted', sha: four.tip });
  assert.deepEqual(after.dependents[2].cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(existsSync(four.wt), false);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);

  // A ticket stuck another way is not this command's.
  refused(/#2 is stuck, but none of its merges is reverted/, 'revert', '#2', '--worktree', lineWt, '--reason', 'x');
});

test('revert: interrupted after one git revert, or before the dependents, a rerun does only what is left', (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { dir, g, ok, state, work, lineWt } = env;
  const m1 = integrateOne(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  const m2 = integrateOne(env, '#2', 'run-1/02-b', { 'c.md': 'c\n' });
  ok('ci-init', '#1', '--worktree', join(dir, 'wt-ci'));
  work(join(dir, 'wt-ci'), { 'b.md': 'b fixed\n' }, '#1: fix CI');
  const m1ci = ok('merge', '#1', '--worktree', lineWt, '--ci').merge;
  // The newest merge was reverted, then the process died.
  g(lineWt, 'revert', '--no-edit', '-m', '1', m1ci);
  const first = g(lineWt, 'rev-parse', 'HEAD');

  const out = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red');
  assert.deepEqual(out.reverts.map((r) => [r.merge, r.found]), [[m1, 'reverted'], [m1ci, 'git']]);
  assert.equal(out.reverts[1].revert, first);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD~1'), first, 'one new revert commit');
  assert.equal(state().tickets['#1'].stage, 'stuck');
  assert.equal(state().tickets['#2'].stage, 'delivered');

  // Stopped before the dependents: the rerun with them finds the ticket stuck by its reverts and goes on.
  const head = g(lineWt, 'rev-parse', 'HEAD');
  const more = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red', '--dependent', '#2');
  assert.equal(more.dependents[0].stage, 'stuck');
  assert.equal(state().tickets['#2'].stage, 'stuck');
  assert.deepEqual(state().tickets['#2'].merges.map((m) => m.sha), [m2]);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);
});

test("revert: a conflict aborts and changes nothing; resolved with git's message, the rerun finishes", (t) => {
  const env = withLine(t, ['#1']);
  const { g, ok, state, integrate, statePath, work, lineWt } = env;
  const m1 = integrateOne(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  work(lineWt, { 'b.md': 'b\nline-level\n' }, 'line-level commit');
  const head = g(lineWt, 'rev-parse', 'HEAD');
  const before = readFileSync(statePath, 'utf8');

  const r = integrate('revert', '#1', '--worktree', lineWt, '--reason', 'CI red');
  assert.equal(r.code, 4, r.err);
  assert.equal(r.json.result, 'conflict');
  assert.equal(r.json.merge, m1);
  assert.deepEqual(r.json.files, ['b.md']);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);
  assert.equal(g(lineWt, 'status', '--porcelain'), '');
  assert.throws(() => g(lineWt, 'rev-parse', '--verify', '-q', 'REVERT_HEAD'));
  assert.equal(readFileSync(statePath, 'utf8'), before);

  try {
    g(lineWt, 'revert', '-m', '1', m1);
  } catch {
    // the conflict, as expected
  }
  g(lineWt, 'rm', '-q', 'b.md');
  g(lineWt, '-c', 'core.editor=true', 'revert', '--continue');
  const resolved = g(lineWt, 'rev-parse', 'HEAD');
  const out = ok('revert', '#1', '--worktree', lineWt, '--reason', 'CI red');
  assert.deepEqual(out.reverts, [{ merge: m1, revert: resolved, found: 'git' }]);
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), resolved);
  assert.equal(state().tickets['#1'].stage, 'stuck');
});

const TICKET2 = ['# 02: Add c', '', 'Status: ready-for-agent', '', '## Blocked by', '', '- 01-add-b.md', '', '## Acceptance criteria', '', '- [ ] c.md exists', ''].join('\n');

test('revert --local: the completion record is reverted, blockers are appended, and frontier reads both tickets as stuck', (t) => {
  const env = withLine(t, ['01-add-b.md', '02-add-c.md'], { origin: false });
  const { g, ok, state, refused, work, lineWt } = env;
  const f1 = 'issues/01-add-b.md';
  const f2 = 'issues/02-add-c.md';
  mkdirSync(join(lineWt, 'issues'));
  work(lineWt, { [f1]: TICKET, [f2]: TICKET2 }, 'tickets');
  const local = (f) => ['--local', f, '--checks', 'node --test (green)'];
  const m1 = integrateOne(env, '01-add-b.md', 'run-1/01-add-b', { 'b.md': 'b\n' }, local(f1));
  const completion = g(lineWt, 'rev-parse', 'HEAD');
  integrateOne(env, '02-add-c.md', 'run-1/02-add-c', { 'c.md': 'c\n' }, local(f2));
  assert.equal(parseTicket(g(lineWt, 'show', `HEAD:${f1}`)).state, 'done');

  refused(/02-add-c\.md is integrated: pass its ticket file/, 'revert', '01-add-b.md', '--worktree', lineWt, '--reason', 'CI red', '--local', f1, '--dependent', '02-add-c.md');
  const args = ['revert', '01-add-b.md', '--worktree', lineWt, '--reason', 'CI red', '--local', f1, '--dependent', `02-add-c.md=${f2}`];
  const out = ok(...args);
  assert.equal(out.completion, 'reverted');
  assert.equal(out.record, 'committed');
  assert.equal(out.dependents[0].record, 'committed');
  // Commits after the merge revert: the completion revert, then one blocker per ticket.
  assert.deepEqual(g(lineWt, 'log', '-3', '--format=%s').split(/\r?\n/), ['02-add-c.md: sorry-matt blocker', '01-add-b.md: sorry-matt blocker', 'Revert "01-add-b.md: sorry-matt completion"']);
  assert.match(g(lineWt, 'log', '-1', '--format=%B', 'HEAD~2'), new RegExp(`This reverts commit ${completion}`));
  const t1 = g(lineWt, 'show', `HEAD:${f1}`);
  const p1 = parseTicket(t1);
  assert.equal(p1.state, 'stuck');
  assert.equal(p1.status, 'ready-for-human');
  assert.doesNotMatch(t1, /sorry-matt completion/);
  const blocker1 = t1.slice(t1.indexOf('## sorry-matt blocker'));
  assert.ok(blocker1.includes('CI red') && blocker1.includes(m1) && blocker1.includes(out.reverts[0].revert));
  const t2 = g(lineWt, 'show', `HEAD:${f2}`);
  assert.equal(parseTicket(t2).state, 'stuck', 'a blocker after its completion');
  assert.ok(t2.slice(t2.indexOf('## sorry-matt blocker')).includes(m1));
  assert.equal(state().tickets['02-add-c.md'].stage, 'stuck');

  const head = g(lineWt, 'rev-parse', 'HEAD');
  const again = ok(...args);
  assert.equal(again.completion, 'reverted');
  assert.equal(again.record, 'already');
  assert.equal(again.dependents[0].record, 'already');
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), head);
});

test('send-back: the attempt is kept at sent-back-1, the ticket goes back to candidate, and its branch and worktree go', (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { dir, git, g, ok, st, state, integrate, refused, queue, work, lineWt } = env;
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  integrateOne(env, '#1', 'run-1/01-a', { 'a.md': 'one\ntwo\n' });
  const tip2 = work(wt2, { 'a.md': 'one\nTHREE\n', 'c.md': 'c\n' }, '#2: three');
  queue('#2');
  assert.equal(integrate('merge', '#2', '--worktree', lineWt).code, 4);
  const lineTip = g(lineWt, 'rev-parse', 'HEAD');

  const out = ok('send-back', '#2', '--conflicts', 'a.md', '--predicted', 'c.md');
  const ref = 'refs/sorry-matt/run-1/02-b/sent-back-1';
  assert.equal(out.ref, ref);
  assert.equal(out.sha, tip2);
  assert.equal(out.k, 1);
  assert.equal(out.lineTip, lineTip);
  assert.deepEqual(out.conflicts, ['a.md']);
  assert.deepEqual(out.touched, ['a.md', 'c.md']);
  assert.deepEqual(out.uncovered, ['a.md']);
  assert.deepEqual(out.predicted, ['c.md', 'a.md']);
  assert.equal(out.stage, 'candidate');
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(git('rev-parse', ref), tip2);
  assert.equal(existsSync(wt2), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/02-b'));
  const t2 = state().tickets['#2'];
  assert.equal(t2.sendBacks, 1);
  assert.deepEqual(t2.history.slice(-2).map((h) => h.to), ['integrating', 'candidate']);

  const revision = state().revision;
  const again = ok('send-back', '#2', '--conflicts', 'a.md');
  assert.deepEqual([again.ref, again.sha, again.k], [ref, tip2, 1]);
  assert.deepEqual(again.cleanup, { worktree: 'absent', branch: 'absent' });
  assert.equal(state().revision, revision);

  // Redispatched: the new attempt's branch is not the kept one, so a send-back rerun refuses to delete it.
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  refused(/already keeps .* but run-1\/02-b is at .*a new attempt/, 'send-back', '#2');
  assert.equal(existsSync(wt2), true);
  work(wt2, { 'c.md': 'c again\n' }, '#2: again');
  queue('#2');
  refused(/#2 was already sent back once; a second send back is not allowed, mark it stuck/, 'send-back', '#2');
  st('stage', 'integrating', '#2');
  refused(/already sent back once/, 'send-back', '#2');
});

test('send-back: interrupted after the ref or after the state, a rerun finishes the cleanup', (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { dir, git, ok, st, state, queue, work } = env;
  const wt1 = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1);
  const tip1 = work(wt1, { 'b.md': 'b\n' }, '#1: b');
  queue('#1');
  // After step 1: the ref is there, nothing else.
  git('update-ref', 'refs/sorry-matt/run-1/01-a/sent-back-1', tip1);
  const out = ok('send-back', '#1');
  assert.equal(out.sha, tip1);
  assert.equal(state().tickets['#1'].sendBacks, 1);
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });

  // After step 2: the ref and the state, but the worktree and branch still there.
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  const tip2 = work(wt2, { 'c.md': 'c\n' }, '#2: c');
  queue('#2');
  git('update-ref', 'refs/sorry-matt/run-1/02-b/sent-back-1', tip2);
  st('stage', 'integrating', '#2');
  st('stage', 'candidate', '#2');
  const rerun = ok('send-back', '#2');
  assert.equal(rerun.k, 1);
  assert.deepEqual(rerun.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(state().tickets['#2'].sendBacks, 1);
  assert.equal(git('rev-parse', 'refs/sorry-matt/run-1/02-b/sent-back-1'), tip2);
});

test('stuck --local: blocker commit, the attempt kept, worktrees removed, stuck; a cleanup that fails is finished by the rerun', (t) => {
  const env = withLine(t, ['01-add-b.md', '#9'], { origin: false });
  const { dir, git, g, ok, state, refused, work, lineWt } = env;
  const file = 'issues/01-add-b.md';
  mkdirSync(join(lineWt, 'issues'));
  work(lineWt, { [file]: TICKET }, 'ticket');
  const one = implementing(env, '01-add-b.md', 'run-1/01-add-b', { 'b.md': 'b\n' });
  const review = join(dir, 'review-01');
  git('worktree', 'add', '-q', '--detach', review, 'run-1/01-add-b');
  writeFileSync(join(review, 'b.md'), 'scratch\n');
  writeFileSync(join(one.wt, 'b.md'), 'uncommitted\n');

  refused(/a review worktree is always detached/, 'stuck', '01-add-b.md', '--reason', 'x', '--review-worktree', lineWt);
  const args = ['stuck', '01-add-b.md', '--reason', 'tests cannot pass', '--worktree', lineWt, '--local', file, '--attempts', 'two fix rounds', '--review-worktree', review];
  refused(/attempt is kept at refs\/sorry-matt\/run-1\/01-add-b\/stuck, but its worktree .* could not be removed/, ...args);
  const blockerCommit = g(lineWt, 'rev-parse', 'HEAD');
  assert.equal(g(lineWt, 'log', '-1', '--format=%s'), '01-add-b.md: sorry-matt blocker');
  assert.equal(git('rev-parse', 'refs/sorry-matt/run-1/01-add-b/stuck'), one.tip);
  assert.equal(state().tickets['01-add-b.md'].stage, 'implementing', 'not stuck until the cleanup is done');

  g(one.wt, 'checkout', '--', 'b.md');
  const out = ok(...args);
  assert.equal(out.record, 'already');
  assert.deepEqual(out.kept, { ref: 'refs/sorry-matt/run-1/01-add-b/stuck', sha: one.tip });
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(out.review, 'removed');
  assert.equal(out.stage, 'stuck');
  assert.deepEqual(out.push, { status: 'not-requested' });
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), blockerCommit, 'one blocker commit');
  assert.equal(existsSync(review), false);
  assert.equal(existsSync(one.wt), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/01-add-b'));
  const text = g(lineWt, 'show', `HEAD:${file}`);
  const parsed = parseTicket(text);
  assert.equal(parsed.state, 'stuck');
  assert.equal(parsed.status, 'ready-for-human');
  const blocker = text.slice(text.indexOf('## sorry-matt blocker'));
  for (const s of ['tests cannot pass', 'two fix rounds', 'refs/sorry-matt/run-1/01-add-b/stuck', LINE, 'Run: run-1']) assert.ok(blocker.includes(s), s);
  const st1 = state().tickets['01-add-b.md'];
  assert.equal(st1.stage, 'stuck');
  assert.equal(st1.reason, 'tests cannot pass');

  const revision = state().revision;
  const again = ok(...args);
  assert.deepEqual([again.record, again.review], ['already', 'absent']);
  assert.deepEqual(again.cleanup, { worktree: 'absent', branch: 'absent' });
  assert.equal(g(lineWt, 'rev-parse', 'HEAD'), blockerCommit);
  assert.equal(state().revision, revision);

  // GitHub: nothing is committed; a ticket with no branch has nothing to keep.
  const gh = ok('stuck', '#9', '--reason', 'out of scope');
  assert.deepEqual([gh.record, gh.kept, gh.cleanup], ['host', null, null]);
  assert.equal(state().tickets['#9'].stage, 'stuck');
});

test('stuck refuses a delivered ticket (revert marks it) and one awaiting a ruling; bad arguments exit 2', (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { st, refused, integrate } = env;
  integrateOne(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  refused(/#1 is delivered; a delivered ticket is marked stuck by revert/, 'stuck', '#1', '--reason', 'x');
  st('stage', 'awaiting-ruling', '#2');
  refused(/#2 is awaiting a ruling/, 'stuck', '#2', '--reason', 'x');
  assert.equal(integrate('stuck', '#2').code, 2);
  assert.equal(integrate('stuck', '#2', '--reason', 'x', '--local', 'f.md').code, 2);
  assert.equal(integrate('revert', '#1', '--worktree', env.lineWt).code, 2);
  assert.equal(integrate('revert', '#1', '--worktree', env.lineWt, '--reason', 'x', '--dependent', '#2=f.md').code, 2);
});

test("stuck --review-worktree removes only the ticket's own review worktree; another one is refused and left as it was", (t) => {
  const env = withLine(t, ['#1', '#2']);
  const { dir, git, g, ok, statePath, refused, lineWt } = env;
  const one = implementing(env, '#1', 'run-1/01-a', { 'b.md': 'b\n' });
  const two = implementing(env, '#2', 'run-1/02-b', { 'c.md': 'c\n' });
  const review1 = join(dir, 'review-1');
  const review2 = join(dir, 'review-2');
  const verify = join(dir, 'verify');
  git('worktree', 'add', '-q', '--detach', review1, one.tip);
  git('worktree', 'add', '-q', '--detach', review2, two.tip);
  git('worktree', 'add', '-q', '--detach', verify, g(lineWt, 'rev-parse', 'HEAD'));
  writeFileSync(join(review2, 'c.md'), 'review notes in progress\n');
  writeFileSync(join(verify, 'a.md'), 'verification scratch\n');
  const snapshot = () => ({
    state: readFileSync(statePath, 'utf8'),
    refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
    worktrees: git('worktree', 'list', '--porcelain'),
  });

  for (const other of [review2, verify]) {
    const before = snapshot();
    refused(/is not #1's review worktree: its HEAD .* is not one of #1's own commits/, 'stuck', '#1', '--reason', 'x', '--review-worktree', other);
    assert.deepEqual(snapshot(), before, 'nothing touched');
  }
  assert.equal(readFileSync(join(review2, 'c.md'), 'utf8'), 'review notes in progress\n');
  assert.equal(readFileSync(join(verify, 'a.md'), 'utf8'), 'verification scratch\n');
  assert.equal(existsSync(one.wt), true);

  const out = ok('stuck', '#1', '--reason', 'x', '--review-worktree', review1);
  assert.equal(out.review, 'removed');
  assert.equal(existsSync(review1), false);
  assert.equal(existsSync(review2), true);
  assert.equal(existsSync(two.wt), true);
});

test('an integrating ticket whose merge landed is not marked stuck by stuck; revert takes it and marks it stuck', (t) => {
  const env = withLine(t, ['#1']);
  const { dir, g, ok, state, refused, queue, work, lineWt } = env;
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  work(wt, { 'b.md': 'b\n' }, '#1: b');
  queue('#1');
  // The delivery step is refused after the merge is recorded: the ticket stays integrating with its merge.
  refused(/--local issues\/none\.md is not committed/, 'merge', '#1', '--worktree', lineWt, '--local', 'issues/none.md', '--checks', 'x');
  const merged = g(lineWt, 'rev-parse', 'HEAD');
  assert.equal(state().tickets['#1'].stage, 'integrating');
  assert.deepEqual(state().tickets['#1'].merges.map((m) => m.sha), [merged]);

  refused(/#1 has a merge on run-1\/line-a .*rerun merge to finish integrating it, or revert it/, 'stuck', '#1', '--reason', 'x');
  assert.equal(state().tickets['#1'].stage, 'integrating');
  assert.equal(existsSync(wt), true);

  const out = ok('revert', '#1', '--worktree', lineWt, '--reason', 'gave up');
  assert.deepEqual(out.reverts.map((r) => [r.merge, r.found]), [[merged, 'reverted']]);
  assert.equal(out.stage, 'stuck');
  assert.equal(existsSync(join(lineWt, 'b.md')), false);
  assert.match(state().tickets['#1'].reason, /^gave up; reverted /);
});

test('--local under a Windows 8.3 short name of the worktree: a file not on disk is inside it, refused as not committed', (t) => {
  const { dir, ok, state, refused, queue, work, lineWt } = withLine(t, ['#1']);
  const short = shortPath(lineWt);
  if (!short) return t.skip('no 8.3 short path here (not Windows, or 8.3 names disabled)');
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt);
  work(wt, { 'b.md': 'b\n' }, '#1: b');
  queue('#1');
  refused(/--local issues\/none\.md is not committed on run-1\/line-a/, 'merge', '#1', '--worktree', short, '--local', 'issues/none.md', '--checks', 'x');
  assert.equal(state().tickets['#1'].stage, 'integrating');
});

// ---- integrate: ticket-pr (#193) -----------------------------------------------------------------------------------

/** A recording `gh` stub: answers by the first two words of the call ("pr list", "stack add", …). */
function ghStub(answers = {}) {
  const calls = [];
  const fn = (args, cwd, env) => {
    calls.push({ args, cwd, env });
    const a = answers[args.slice(0, 2).join(' ')];
    return typeof a === 'function' ? a({ args, cwd, env }) : (a ?? '');
  };
  fn.calls = calls;
  fn.of = (first, second) => calls.filter((c) => c.args[0] === first && (second === undefined || c.args[1] === second));
  return fn;
}

/** setup() with tracker github, integrate: ticket-pr, the line recorded and `ids` added on it. */
function withPrLine(t, ids, gh = ghStub()) {
  const env = setup(t, { tracker: 'github', profile: { integrate: 'ticket-pr' }, gh });
  env.ok('line-init', '--branch', LINE);
  env.st('add', ...ids, '--line', LINE);
  return { ...env, gh };
}

const samePath = (a, b) => assert.equal(realpathSync.native(a), realpathSync.native(b));

test('line-init (ticket-pr) records the line, creates no branch and no worktree, and is idempotent', (t) => {
  const { dir, git, ok, state, integrate } = setup(t, { tracker: 'github', profile: { integrate: 'ticket-pr' } });
  const worktreeCount = () => git('worktree', 'list', '--porcelain').split('\n\n').filter(Boolean).length;
  const before = worktreeCount();
  const out = ok('line-init', '--branch', LINE);
  assert.equal(out.integrate, 'ticket-pr');
  assert.deepEqual(out.created, { branch: false, worktree: false });
  assert.equal(out.tip, null);
  assert.equal(out.worktree, null);
  assert.throws(() => git('rev-parse', '--verify', `refs/heads/${LINE}`), 'no integration branch is created');
  assert.equal(worktreeCount(), before, 'no line worktree is created');
  assert.equal(state().lines[LINE].tip, null);

  const file = readFileSync(join(dir, 'run-1.state.json'), 'utf8');
  const again = ok('line-init', '--branch', LINE);
  assert.deepEqual(again, out, 'a rerun gives the same output');
  assert.equal(readFileSync(join(dir, 'run-1.state.json'), 'utf8'), file, 'nothing to record on a rerun');
  assert.equal(worktreeCount(), before);

  assert.equal(integrate('line-init', '--branch', LINE, '--from', 'HEAD').code, 2);
  assert.equal(integrate('line-init', '--branch', LINE, '--worktree', join(dir, 'wt-line')).code, 2);
});

test('ticket-init (ticket-pr) cuts by the #188 fields: origin/<base>, the upstream branch, or a waiting refusal', (t) => {
  const gh = ghStub();
  const { dir, git, g, ok, st, state, refused, integrate, work } = withPrLine(t, ['#1', '#2', '#3', '#4'], gh);
  const base = git('rev-parse', 'origin/main');
  work(join(dir, 'repo'), { 'later.md': 'after the push\n' }, 'local main moved past origin/main');

  // stackParent null, waitingOn empty: cut from origin/<base>, not from the local base branch.
  const wt1 = join(dir, 'wt-1');
  assert.equal(integrate('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1).code, 2, '--base is required');
  const one = ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1, '--base', 'main');
  assert.deepEqual([one.from, one.head, one.created, one.stack], [base, base, { branch: true, worktree: true }, []]);
  assert.equal(git('rev-parse', 'refs/heads/run-1/01-a'), base);
  assert.equal(state().tickets['#1'].branch, 'run-1/01-a');
  assert.equal(gh.calls.length, 0, 'an unstacked ticket calls gh not at all');

  // stackParent set: cut from the upstream ticket branch; init + add join the upstream's stack, non-interactively.
  const upstreamTip = work(wt1, { 'one.md': 'one\n' }, '#1: first commit');
  st('set', '#2', '--stack-parent', '#1');
  const wt2 = join(dir, 'wt-2');
  const two = ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  assert.deepEqual([two.from, two.head, two.stack], [upstreamTip, upstreamTip, ['init run-1/01-a', 'add run-1/02-b']]);
  assert.equal(g(wt2, 'symbolic-ref', '--short', 'HEAD'), 'run-1/02-b');
  assert.deepEqual(gh.calls.map((c) => c.args), [['stack', 'init', 'run-1/01-a'], ['stack', 'add', 'run-1/02-b']]);
  for (const c of gh.calls) {
    assert.deepEqual(c.env, { GH_STACK_NO_UPDATE_NOTIFIER: '1' }, 'every gh stack call silences the update notifier');
    samePath(c.cwd, wt2);
  }
  const againTwo = ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  assert.deepEqual([againTwo.created, againTwo.from, againTwo.stack], [{ branch: false, worktree: false }, null, []]);
  assert.equal(gh.calls.length, 2, 'a rerun reuses the branch and calls gh stack again not at all');

  // An upstream that is stacked itself: the stack exists, so only `add` runs.
  st('set', '#3', '--stack-parent', '#2');
  const three = ok('ticket-init', '#3', '--branch', 'run-1/03-c', '--worktree', join(dir, 'wt-3'));
  assert.deepEqual(three.stack, ['add run-1/03-c']);
  assert.deepEqual(gh.calls.at(-1).args, ['stack', 'add', 'run-1/03-c']);

  // waitingOn not empty: refused with 3, and no branch is cut.
  st('set', '#4', '--waiting-on', '#1');
  refused(/#4 is waiting on #1 to merge/, 'ticket-init', '#4', '--branch', 'run-1/04-d', '--worktree', join(dir, 'wt-4'), '--base', 'main');
  assert.throws(() => git('rev-parse', '--verify', 'refs/heads/run-1/04-d'), 'no branch for a waiting ticket');
  assert.equal(state().tickets['#4'].branch, null);
});

test('pr-open (ticket-pr) pushes the branch, opens the draft PR with the body and Closes line, and records the number', (t) => {
  const gh = ghStub({
    'pr list': () => (gh.of('pr', 'create').length ? '[{"number":12}]' : '[]'),
    'pr create': 'https://github.com/o/r/pull/12\n',
  });
  const { dir, bare, git, ok, state, refused, work } = withPrLine(t, ['#1'], gh);
  const wt = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt, '--base', 'main');
  refused(/#9 is not a ticket of this run/, 'pr-open', '#9', '--title', 'x', '--base', 'main');
  work(wt, { 'one.md': 'one\n' }, '#1: add the thing');
  work(wt, { 'two.md': 'two\n' }, '#1: refine the thing');
  const head = git('rev-parse', 'refs/heads/run-1/01-a');

  const out = ok('pr-open', '#1', '--title', 'Add the thing', '--base', 'main');
  assert.deepEqual(out, { format: 'sorry-matt/integrate@1', command: 'pr-open', ticket: '#1', line: LINE, branch: 'run-1/01-a', stacked: false, pr: 12, created: true });
  assert.equal(execFileSync('git', ['-C', bare, 'rev-parse', 'refs/heads/run-1/01-a'], { encoding: 'utf8' }).trim(), head, 'the ticket branch is pushed');
  assert.equal(state().tickets['#1'].pr, 12);
  const create = gh.of('pr', 'create');
  assert.equal(create.length, 1);
  const args = create[0].args;
  for (const flag of ['--draft']) assert.ok(args.includes(flag), `gh pr create carries ${flag}`);
  assert.equal(args[args.indexOf('--base') + 1], 'main');
  assert.equal(args[args.indexOf('--head') + 1], 'run-1/01-a');
  const body = args[args.indexOf('--body') + 1].split('\n');
  assert.equal(body[0], 'Add the thing', 'the body starts with the ticket title');
  assert.deepEqual(body.filter((l) => l.startsWith('- ')), ['- #1: add the thing', '- #1: refine the thing'], 'the commit subjects, oldest first');
  assert.equal(body.at(-1), 'Closes #1', 'the final line closes the ticket');
  assert.equal(body.filter((l) => l.startsWith('Closes ')).length, 1, 'one Closes line only');

  // Idempotent: the open PR is reused, nothing new is opened, and the state is already recorded.
  const file = readFileSync(join(dir, 'run-1.state.json'), 'utf8');
  const again = ok('pr-open', '#1', '--title', 'Add the thing', '--base', 'main');
  assert.deepEqual([again.pr, again.created], [12, false]);
  assert.equal(gh.of('pr', 'create').length, 1, 'no second PR is created');
  assert.equal(readFileSync(join(dir, 'run-1.state.json'), 'utf8'), file, 'the recorded number is left as it is');
});

test('pr-open (ticket-pr) for a stacked ticket submits the stack, reads the number back, and writes the body', (t) => {
  const gh = ghStub({
    'pr list': () => (gh.of('stack', 'submit').length ? '[{"number":13}]' : '[]'),
  });
  const { dir, ok, st, state, work } = withPrLine(t, ['#1', '#2'], gh);
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', join(dir, 'wt-1'), '--base', 'main');
  work(join(dir, 'wt-1'), { 'one.md': 'one\n' }, '#1: upstream work');
  st('set', '#2', '--stack-parent', '#1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  work(wt2, { 'two.md': 'two\n' }, '#2: stacked work');

  const out = ok('pr-open', '#2', '--title', 'Stacked thing');
  assert.deepEqual([out.stacked, out.pr, out.created], [true, 13, true]);
  assert.equal(state().tickets['#2'].pr, 13);
  const submit = gh.of('stack', 'submit');
  assert.equal(submit.length, 1);
  assert.deepEqual(submit[0].args, ['stack', 'submit', '--auto']);
  assert.deepEqual(submit[0].env, { GH_STACK_NO_UPDATE_NOTIFIER: '1' });
  samePath(submit[0].cwd, wt2);
  const edit = gh.of('pr', 'edit');
  assert.equal(edit.length, 1);
  assert.equal(edit[0].args[2], '13');
  const body = edit[0].args[edit[0].args.indexOf('--body') + 1].split('\n');
  assert.equal(body[0], 'Stacked thing');
  assert.deepEqual(body.filter((l) => l.startsWith('- ')), ['- #2: stacked work'], 'only this layer\'s commits');
  assert.equal(body.at(-1), 'Closes #2');
});

test('pr-open (ticket-pr) for a bundle opens one PR on the lead with one Closes line per member, the lead first', (t) => {
  const gh = ghStub({
    'pr list': () => (gh.of('pr', 'create').length ? '[{"number":21}]' : '[]'),
    'pr create': 'https://github.com/o/r/pull/21\n',
  });
  const { dir, ok, st, state, refused, work } = withPrLine(t, ['#5', '#6'], gh);
  st('bundle', '#5', '#6');
  const wt = join(dir, 'wt-5');
  ok('ticket-init', '#5', '--branch', 'run-1/05-e', '--worktree', wt, '--base', 'main');
  work(wt, { 'five.md': 'five\n' }, '#5 #6: bundled work');

  const out = ok('pr-open', '#5', '--title', 'Bundle of five and six', '--base', 'main');
  assert.deepEqual([out.pr, out.created, out.branch], [21, true, 'run-1/05-e'], 'one PR, on the lead\'s branch');
  assert.equal(state().tickets['#5'].pr, 21, 'the number is recorded on the lead');
  const args = gh.of('pr', 'create')[0].args;
  const body = args[args.indexOf('--body') + 1].split('\n');
  assert.deepEqual(body.filter((l) => l.startsWith('Closes ')), ['Closes #5', 'Closes #6'], 'every member, the lead first');
  refused(/#6 .*lead|#6 is not a ticket/, 'pr-open', '#6', '--title', 'member', '--base', 'main');
});

test('pr-push (ticket-pr) pushes the same branch, gh stack push for a stacked ticket, and marks nothing host', (t) => {
  const gh = ghStub({
    'pr list': () => '[{"number":12}]',
  });
  const { dir, bare, git, ok, st, refused, work } = withPrLine(t, ['#1', '#2'], gh);
  const wt1 = join(dir, 'wt-1');
  ok('ticket-init', '#1', '--branch', 'run-1/01-a', '--worktree', wt1, '--base', 'main');
  work(wt1, { 'one.md': 'one\n' }, '#1: first commit');
  ok('pr-open', '#1', '--title', 'Add the thing', '--base', 'main');
  const fix = work(wt1, { 'one.md': 'one fixed\n' }, '#1: fix after review');

  const out = ok('pr-push', '#1');
  assert.deepEqual(out, { format: 'sorry-matt/integrate@1', command: 'pr-push', ticket: '#1', branch: 'run-1/01-a', stacked: false, pushed: 'git push', head: fix });
  assert.ok(!JSON.stringify(out).includes('host'), 'a ticket branch is not protected; no host marker');
  assert.equal(execFileSync('git', ['-C', bare, 'rev-parse', 'refs/heads/run-1/01-a'], { encoding: 'utf8' }).trim(), fix, 'the fix commit reaches the same branch');

  st('set', '#2', '--stack-parent', '#1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  work(wt2, { 'two.md': 'two\n' }, '#2: stacked work');
  const stacked = ok('pr-push', '#2');
  assert.deepEqual([stacked.stacked, stacked.pushed], [true, 'gh stack push']);
  const push = gh.of('stack', 'push');
  assert.equal(push.length, 1);
  assert.deepEqual(push[0].env, { GH_STACK_NO_UPDATE_NOTIFIER: '1' });
  samePath(push[0].cwd, wt2);
  refused(/#9 is not a ticket of this run/, 'pr-push', '#9');
});

test('pr-open and pr-push are refused outside integrate: ticket-pr', (t) => {
  const { refused } = withLine(t, ['#1']);
  refused(/pr-open is for integrate: ticket-pr; this run's integrate is aggregate-pr/, 'pr-open', '#1', '--title', 'x', '--base', 'main');
  refused(/pr-push is for integrate: ticket-pr/, 'pr-push', '#1');
  refused(/pr-merge is for integrate: ticket-pr/, 'pr-merge', '#1', '--base', 'main');
});

// ---- pr-merge (#194) -----------------------------------------------------------------------------------------------

/** withPrLine() plus one queued unstacked ticket `id` with a branch, one commit and its PR number recorded. */
function withQueuedPr(t, env, id, branch, pr) {
  const wt = join(env.dir, `wt-${branch.split('/').pop()}`);
  env.ok('ticket-init', id, '--branch', branch, '--worktree', wt, '--base', 'main');
  const tip = env.work(wt, { [`${branch.split('/').pop()}.md`]: 'work\n' }, `${id}: work`);
  env.st('set', id, '--pr', String(pr));
  env.queue(id);
  return { wt, tip };
}

test('pr-merge (ticket-pr) phase push: merges origin/<base>, pushes the branch, reports the head, and is idempotent', (t) => {
  const gh = ghStub();
  const env = withPrLine(t, ['#1'], gh);
  const { dir, repo, bare, git, g, ok, state, refused, integrate, work } = env;
  const one = withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  // The base moves on after the cut: the ticket branch must take it before CI.
  work(repo, { 'base2.md': 'the base moves on\n' }, 'base: second commit');
  git('push', '-q', 'origin', 'main');
  const baseSha = git('rev-parse', 'origin/main');

  assert.equal(integrate('pr-merge', '#1').code, 2, '--base is required for an unstacked ticket');
  const out = ok('pr-merge', '#1', '--base', 'main');
  const head = git('rev-parse', 'refs/heads/run-1/01-a');
  assert.deepEqual(out, {
    format: 'sorry-matt/integrate@1', command: 'pr-merge', phase: 'push', ticket: '#1', line: LINE,
    pr: 12, branch: 'run-1/01-a', stacked: false, result: 'pushed', synced: 'merged origin/main', head,
  });
  // git: one merge commit on the ticket branch, its parents the old tip and origin/main, pushed to origin.
  assert.equal(g(one.wt, 'rev-parse', 'HEAD^1'), one.tip);
  assert.equal(g(one.wt, 'rev-parse', 'HEAD^2'), baseSha);
  assert.equal(remoteTip(bare, 'refs/heads/run-1/01-a'), head);
  assert.equal(state().tickets['#1'].stage, 'integrating');
  assert.equal(gh.calls.length, 0, 'an unstacked push phase calls gh not at all');

  const revision = state().revision;
  const again = ok('pr-merge', '#1', '--base', 'main');
  assert.deepEqual([again.synced, again.head], ['already', head]);
  assert.equal(git('rev-parse', 'refs/heads/run-1/01-a'), head, 'no second merge');
  assert.equal(state().revision, revision, 'nothing left to record on a rerun');
  refused(/#9 is not a ticket of this run/, 'pr-merge', '#9', '--base', 'main');
});

test('pr-merge (ticket-pr) phase push: a conflict with the base aborts, exits 4 and leaves state, HEAD and the worktree as before', (t) => {
  const env = withPrLine(t, ['#1'], ghStub());
  const { repo, bare, git, g, ok, state, statePath, integrate, work } = env;
  const one = withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  work(one.wt, { 'a.md': 'one\nTWO\n' }, '#1: edit a');
  const tip = g(one.wt, 'rev-parse', 'HEAD');
  work(repo, { 'a.md': 'one\nTHREE\n' }, 'base: conflicting edit');
  git('push', '-q', 'origin', 'main');
  const before = readFileSync(statePath, 'utf8');

  const r = integrate('pr-merge', '#1', '--base', 'main');
  assert.equal(r.code, 4, r.err);
  assert.equal(r.json.result, 'conflict');
  assert.deepEqual(r.json.files, ['a.md']);
  assert.equal(readFileSync(statePath, 'utf8'), before, 'state unchanged');
  assert.equal(state().tickets['#1'].stage, 'queued');
  assert.equal(g(one.wt, 'rev-parse', 'HEAD'), tip);
  assert.equal(g(one.wt, 'status', '--porcelain'), '');
  assert.throws(() => g(one.wt, 'rev-parse', '--verify', '-q', 'MERGE_HEAD'));
  assert.throws(() => remoteTip(bare, 'refs/heads/run-1/01-a'), 'nothing was pushed');

  // The merge agent resolves it in the ticket worktree; the rerun finds the base taken and pushes.
  try {
    g(one.wt, 'merge', '--no-edit', 'origin/main');
  } catch {
    // the conflict, as expected
  }
  writeFileSync(join(one.wt, 'a.md'), 'one\nTWO\nTHREE\n');
  g(one.wt, 'add', 'a.md');
  g(one.wt, 'commit', '-q', '--no-edit');
  const resolved = g(one.wt, 'rev-parse', 'HEAD');
  const out = ok('pr-merge', '#1', '--base', 'main');
  assert.deepEqual([out.synced, out.head], ['already', resolved]);
  assert.equal(remoteTip(bare, 'refs/heads/run-1/01-a'), resolved);
  assert.equal(state().tickets['#1'].stage, 'integrating');
});

test('pr-merge (ticket-pr) phase push for a stacked ticket: gh stack sync then push; a divergence exits 5 and pushes nothing', (t) => {
  let diverged = true;
  const gh = ghStub({
    'stack sync': () => (diverged ? 'warning: run-1/02-b has diverged from origin/run-1/02-b\nsync aborted\n' : 'synced\n'),
  });
  const env = withPrLine(t, ['#1', '#2'], gh);
  const { dir, g, ok, st, state, statePath, integrate } = env;
  withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  st('set', '#2', '--stack-parent', '#1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  const tip2 = env.work(wt2, { 'two.md': 'two\n' }, '#2: stacked work');
  st('set', '#2', '--pr', '13');
  env.queue('#2');

  // The sync aborted on a divergence while exiting 0: read from its output, exit 5, not reported as success.
  const before = readFileSync(statePath, 'utf8');
  const r = integrate('pr-merge', '#2');
  assert.equal(r.code, 5, r.err);
  assert.equal(r.json.result, 'diverged');
  assert.deepEqual(r.json.divergence, ['warning: run-1/02-b has diverged from origin/run-1/02-b']);
  assert.equal(readFileSync(statePath, 'utf8'), before, 'state unchanged');
  assert.equal(state().tickets['#2'].stage, 'queued');
  assert.equal(gh.of('stack', 'push').length, 0, 'nothing is pushed on a divergence');

  diverged = false;
  const out = ok('pr-merge', '#2');
  assert.deepEqual([out.stacked, out.result, out.synced, out.head], [true, 'pushed', 'gh stack sync', tip2]);
  const sync = gh.of('stack', 'sync');
  const push = gh.of('stack', 'push');
  assert.deepEqual([sync.length, push.length], [2, 1]);
  for (const c of [...sync, ...push]) {
    assert.deepEqual(c.env, { GH_STACK_NO_UPDATE_NOTIFIER: '1' });
    samePath(c.cwd, wt2);
  }
  assert.equal(state().tickets['#2'].stage, 'integrating');
});

test('pr-merge --ready: gh pr ready, then merge-gate decides; merge or queue hands the command to the host, human sends nothing', (t) => {
  let graphql = '{"data":{"repository":{"mergeQueue":null}}}';
  const gh = ghStub({
    'repo view': '{"nameWithOwner":"o/r"}',
    'api graphql': () => graphql,
  });
  const env = withPrLine(t, ['#1', '#2'], gh);
  const { dir, ok, st, state, integrate } = env;
  withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  st('set', '#2', '--stack-parent', '#1');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', join(dir, 'wt-2'));
  st('set', '#2', '--pr', '13');
  env.queue('#2');

  assert.equal(integrate('pr-merge', '#1', '--ready').code, 2, '--ready needs --base for merge-gate');
  assert.equal(integrate('pr-merge', '#1', '--ready', '--merged').code, 2);
  const out = ok('pr-merge', '#1', '--ready', '--base', 'main');
  assert.equal(out.phase, 'ready');
  assert.equal(out.base, 'main');
  assert.deepEqual(out.gate, { decision: 'merge', reason: 'no-queue' });
  // #199: #2 is stacked on #1, so #1's PR is in a stack too: GitHub takes only gh stack merge for it
  assert.deepEqual(out.send, { status: 'host', command: 'gh stack merge 12 --yes --squash' }, 'the host sends the merge, never the script');
  assert.deepEqual(gh.of('pr', 'ready')[0].args, ['pr', 'ready', '12']);
  assert.equal(gh.of('api', 'graphql').length, 1, "merge-gate's merge-queue query went through the same gh seam");
  assert.equal(state().tickets['#1'].stage, 'integrating');

  const stacked = ok('pr-merge', '#2', '--ready', '--base', 'main');
  assert.deepEqual(stacked.send, { status: 'host', command: 'gh stack merge 13 --yes --squash' });
  assert.deepEqual(gh.of('pr', 'ready')[1].args, ['pr', 'ready', '13']);
  // with nothing live stacked on it, #1 is in no stack: plain gh pr merge
  st('stage', 'stuck', '#2', '--reason', 'gone');
  assert.deepEqual(ok('pr-merge', '#1', '--ready', '--base', 'main').send, { status: 'host', command: 'gh pr merge 12' });

  // A failed gate query decides human: nothing is sent, and the gate's reason is carried.
  graphql = 'not json at all';
  const human = ok('pr-merge', '#1', '--ready', '--base', 'main');
  assert.deepEqual(human.gate, { decision: 'human', reason: 'query-failed' });
  assert.deepEqual(human.send, { status: 'human' });
});

test('pr-merge --merged: refused until the PR is MERGED, then records the merge SHA, delivers and cleans up locally', (t) => {
  const msha = 'b'.repeat(40);
  let prState = 'OPEN';
  const gh = ghStub({
    'pr view': () => JSON.stringify({ mergeCommit: { oid: msha }, state: prState }),
  });
  const env = withPrLine(t, ['#1'], gh);
  const { git, ok, state, refused } = env;
  const one = withQueuedPr(t, env, '#1', 'run-1/01-a', 12);

  refused(/#1's pull request 12 is OPEN, not MERGED; the host sends the merge first/, 'pr-merge', '#1', '--merged');
  assert.equal(state().tickets['#1'].stage, 'queued');
  assert.equal(existsSync(one.wt), true, 'nothing is cleaned before the merge is confirmed');

  prState = 'MERGED';
  const out = ok('pr-merge', '#1', '--merged');
  assert.deepEqual([out.phase, out.merge, out.stage], ['merged', msha, 'delivered']);
  assert.deepEqual(out.cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.deepEqual(gh.of('pr', 'view')[0].args, ['pr', 'view', '12', '--json', 'mergeCommit,state']);
  assert.equal(existsSync(one.wt), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/01-a'));
  const s = state();
  assert.equal(s.tickets['#1'].stage, 'delivered');
  assert.deepEqual(s.tickets['#1'].merges.map((m) => m.sha), [msha]);

  const revision = state().revision;
  const again = ok('pr-merge', '#1', '--merged');
  assert.deepEqual(again.cleanup, { worktree: 'absent', branch: 'absent' });
  assert.equal(again.merge, msha);
  assert.equal(state().revision, revision, 'nothing left to record on a rerun');
});

test('pr-merge refuses a ticket that is not queued or integrating, or has no branch or PR recorded', (t) => {
  const env = withPrLine(t, ['#1', '#2'], ghStub());
  const { dir, ok, refused } = env;
  refused(/#1 is candidate; pr-merge takes a ticket that is queued or integrating/, 'pr-merge', '#1', '--base', 'main');
  env.queue('#1');
  refused(/#1 has no ticket branch recorded/, 'pr-merge', '#1', '--base', 'main');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', join(dir, 'wt-2'), '--base', 'main');
  env.queue('#2');
  refused(/#2 has no pull request recorded \(pr-open first\)/, 'pr-merge', '#2', '--base', 'main');
});

// ---- revert under integrate: ticket-pr (#197) ----------------------------------------------------------------------

/** withQueuedPr, then the PR merged on the base: the branch lands on origin's main and the merge SHA is recorded. */
function mergedPr(t, env, id, branch, pr) {
  const q = withQueuedPr(t, env, id, branch, pr);
  env.g(env.repo, 'push', '-q', 'origin', `refs/heads/${branch}:refs/heads/main`);
  env.git('fetch', '-q', 'origin');
  const msha = env.git('rev-parse', 'origin/main');
  env.st('stage', 'integrating', id);
  env.st('merge', id, msha);
  env.st('stage', 'delivered', id);
  return { ...q, msha };
}

test('revert (ticket-pr): reverts the merge on a revert branch, opens the revert PR against the base, never pushes the base, and is idempotent', (t) => {
  const gh = ghStub({
    'pr list': () => (gh.of('pr', 'create').length ? '[{"number":31}]' : '[]'),
    'pr create': 'https://github.com/o/r/pull/31\n',
  });
  const env = withPrLine(t, ['#1'], gh);
  const { dir, bare, state, ok, integrate } = env;
  const { msha } = mergedPr(t, env, '#1', 'run-1/01-a', 12);
  const inBare = (...args) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();
  const baseBefore = inBare('rev-parse', 'refs/heads/main');
  assert.equal(baseBefore, msha);

  const wt = join(dir, 'wt-revert');
  assert.equal(integrate('revert', '#1', '--worktree', wt, '--reason', 'base red').code, 2, '--base is required under ticket-pr');
  assert.equal(integrate('revert', '#1', '--worktree', wt, '--reason', 'base red', '--base', 'main', '--local', 'x.md').code, 2, '--local is refused');
  assert.equal(integrate('revert', '#1', '--worktree', wt, '--reason', 'base red', '--base', 'main', '--push').code, 2, '--push is refused');

  const out = ok('revert', '#1', '--worktree', wt, '--reason', `base CI red at ${msha}`, '--base', 'main');
  assert.deepEqual(
    [out.result, out.revertBranch, out.pr, out.prCreated, out.record, out.completion, out.stage],
    ['reverted', 'run-1/01-a-revert', 31, true, 'host', 'none', 'stuck'],
  );
  assert.equal(out.reverts.length, 1);
  assert.deepEqual([out.reverts[0].merge, out.reverts[0].found], [msha, 'reverted']);
  assert.equal(out.reverts[0].revert, out.head);
  assert.deepEqual(out.push, { status: 'revert-pr', branch: 'run-1/01-a-revert' });
  // the revert branch is on origin at the revert commit; the base branch itself was never pushed
  assert.equal(inBare('rev-parse', 'refs/heads/run-1/01-a-revert'), out.head);
  assert.equal(inBare('rev-parse', 'refs/heads/main'), baseBefore, 'the base branch is untouched');
  // the revert PR targets the base from the revert branch, and is not a draft (ruling 2: a mechanical revert, no review)
  const create = gh.of('pr', 'create');
  assert.equal(create.length, 1);
  const args = create[0].args;
  assert.equal(args[args.indexOf('--base') + 1], 'main');
  assert.equal(args[args.indexOf('--head') + 1], 'run-1/01-a-revert');
  assert.ok(!args.includes('--draft'), 'a mechanical revert is not reviewed: the PR opens ready');
  assert.equal(args[args.indexOf('--title') + 1], 'Revert #1');
  const s = state();
  assert.equal(s.tickets['#1'].stage, 'stuck');
  assert.match(s.tickets['#1'].reason, new RegExp(`^base CI red at ${msha}; reverted ${msha} by `));
  assert.equal(existsSync(join(wt, '01-a.md')), false, "the ticket's change is reverted at the revert head");

  // a rerun finds the revert, reuses the open PR and opens nothing new
  const again = ok('revert', '#1', '--worktree', wt, '--reason', `base CI red at ${msha}`, '--base', 'main');
  assert.deepEqual([again.prCreated, again.pr, again.reverts[0].found], [false, 31, 'git']);
  assert.equal(gh.of('pr', 'create').length, 1, 'no second PR is created');
});

test('revert (ticket-pr): an integrated dependent becomes stuck; in-flight and candidate ones await a ruling, the branch tip kept', (t) => {
  const gh = ghStub({
    'pr list': () => (gh.of('pr', 'create').length ? '[{"number":41}]' : '[]'),
    'pr create': 'https://github.com/o/r/pull/41\n',
  });
  const env = withPrLine(t, ['#1', '#2', '#3', '#4'], gh);
  const { dir, git, ok, st, state, integrate, work } = env;
  const { msha } = mergedPr(t, env, '#1', 'run-1/01-a', 12);
  mergedPr(t, env, '#2', 'run-1/02-b', 13); // integrated dependent: its merge stays, the ticket goes stuck
  const wt3 = join(dir, 'wt-3');
  ok('ticket-init', '#3', '--branch', 'run-1/03-c', '--worktree', wt3, '--base', 'main');
  const tip3 = work(wt3, { 'three.md': 'three\n' }, '#3: in flight');
  st('set', '#3', '--snapshot', 'a'.repeat(64));
  st('stage', 'implementing', '#3');

  assert.equal(integrate('revert', '#1', '--worktree', join(dir, 'wt-revert'), '--reason', 'base red', '--base', 'main', '--dependent', '#2=x.md').code, 2, 'a dependent ticket file goes with --local');

  const out = ok('revert', '#1', '--worktree', join(dir, 'wt-revert'), '--reason', 'base red', '--base', 'main', '--dependent', '#2', '--dependent', '#3', '--dependent', '#4');
  const rows = Object.fromEntries(out.dependents.map((r) => [r.ticket, r]));
  assert.deepEqual([rows['#2'].treatment, rows['#2'].stage], ['integrated', 'stuck']);
  assert.deepEqual([rows['#3'].treatment, rows['#3'].stage], ['in-flight', 'awaiting-ruling']);
  assert.deepEqual(rows['#3'].kept, { ref: 'refs/sorry-matt/run-1/03-c/upstream-reverted', sha: tip3 });
  assert.deepEqual(rows['#3'].cleanup, { worktree: 'removed', branch: 'deleted' });
  assert.equal(existsSync(wt3), false);
  assert.throws(() => git('rev-parse', '--verify', '-q', 'refs/heads/run-1/03-c'), 'the branch is deleted; the ref keeps its tip');
  assert.equal(git('rev-parse', 'refs/sorry-matt/run-1/03-c/upstream-reverted'), tip3);
  assert.deepEqual([rows['#4'].treatment, rows['#4'].stage, rows['#4'].kept], ['in-flight', 'awaiting-ruling', null]);
  const s = state();
  const upstream = new RegExp(`^upstream reverted: #1 \\(${out.reverts[0].revert}\\)$`);
  assert.match(s.tickets['#2'].reason, upstream);
  assert.match(s.tickets['#3'].reason, upstream);
  assert.match(s.tickets['#4'].reason, upstream);
  assert.deepEqual(s.tickets['#2'].merges.length, 1, "the integrated dependent's merge stays");
});

test('revert: --base outside integrate: ticket-pr is a usage error; under it a ticket with no merge is refused', (t) => {
  const aggregate = withLine(t, ['#1']);
  assert.equal(aggregate.integrate('revert', '#1', '--worktree', aggregate.lineWt, '--reason', 'x', '--base', 'main').code, 2);

  const env = withPrLine(t, ['#1'], ghStub());
  withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  env.refused(/#1 is queued; revert takes a delivered ticket/, 'revert', '#1', '--worktree', join(env.dir, 'wt-revert'), '--reason', 'x', '--base', 'main');
  env.st('stage', 'integrating', '#1');
  env.refused(/#1 has no merge recorded; there is nothing to revert/, 'revert', '#1', '--worktree', join(env.dir, 'wt-revert'), '--reason', 'x', '--base', 'main');
});

test('patch-id (ticket-pr, #199): the same own change gives the same id after a rebase onto another base; a changed one does not', (t) => {
  const gh = ghStub();
  const env = withPrLine(t, ['#1', '#2'], gh);
  const { dir, repo, git, ok, st, integrate, work } = env;
  const one = withQueuedPr(t, env, '#1', 'run-1/01-a', 12);
  st('set', '#2', '--stack-parent', '#1');
  const wt2 = join(dir, 'wt-2');
  ok('ticket-init', '#2', '--branch', 'run-1/02-b', '--worktree', wt2);
  work(wt2, { 'two.md': 'two\n' }, '#2: stacked work');
  assert.equal(integrate('patch-id', '#2').code, 2, '--from is required');
  const before = ok('patch-id', '#2', '--from', 'run-1/01-a');
  assert.match(before.patchId, /^[0-9a-f]{40}$/);
  assert.equal(before.base, one.tip, 'taken from the merge base with the upstream branch');
  // #1 lands on main (a merge commit), and #2 is rebased onto it: its own change is the same patch
  git('merge', '-q', '--no-ff', '-m', 'merge #1', 'run-1/01-a');
  git('push', '-q', 'origin', 'main');
  execFileSync('git', ['-C', wt2, 'fetch', '-q', 'origin'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt2, 'rebase', '-q', 'origin/main'], { stdio: 'ignore' });
  const after = ok('patch-id', '#2', '--from', 'origin/main');
  assert.equal(after.patchId, before.patchId, 'a clean rebase keeps the patch-id');
  assert.notEqual(after.head, before.head, 'though the SHA changed');
  work(wt2, { 'two.md': 'two, changed\n' }, '#2: changed');
  assert.notEqual(ok('patch-id', '#2', '--from', 'origin/main').patchId, before.patchId, 'a changed own change changes it');
  // outside ticket-pr the command is refused
  const other = setup(t, { tracker: 'github' });
  other.st('add', '#9', '--line', LINE);
  assert.equal(other.integrate('patch-id', '#9', '--from', 'main').code, 3);
});
