// node --test scripts/integrate.test.mjs
// Drives integrate.mjs through main() against real temp repositories (with a bare `origin` where a push is
// checked) and real state files written by state.mjs's own main. Expected values come from git itself (rev-parse,
// log, the remote's refs) and from frontier.mjs's reading of a Local Markdown ticket, not from integrate.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { parseTicket } from '../src/skills/get-to-work/scripts/frontier.mjs';

const NOW = '2026-03-10T12:00:00Z';
const LINE = 'run-1/line-a';
const SNAP = 'a'.repeat(64);

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-integrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A repo on main with one commit, optionally pushed to a bare origin, and an initialized state. */
function setup(t, { origin = true, profile } = {}) {
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
  st('init', '--run', 'run-1');
  if (profile) st('profile', ...Object.entries(profile).flatMap(([k, v]) => [`--${k}`, String(v)]));
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const integrate = (...argv) => {
    const r = main([argv[0], statePath, ...argv.slice(1), '--now', NOW], { cwd: repo });
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
  assert.equal(out.worktree.toLowerCase().replace(/\\/g, '/'), repo.toLowerCase().replace(/\\/g, '/'));
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
