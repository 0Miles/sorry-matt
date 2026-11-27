// node --test scripts/gates.test.mjs
// Drives `state.mjs check <state> <gate>` through state.mjs's main(), against real state files and real git
// repositories (an integration branch in its own worktree, ticket branches merged with --no-ff, a bare `origin`) in a
// temp dir. Each assertion of gates.mjs has a passing case (it is in `checked` and not in `failures` on a good world)
// and a failing case that breaks only that assertion. The state is built with state.mjs's own commands; a case that
// no command can produce (the gate is the redundant check behind a guard) edits the file the way a hand edit would.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultDeps, main } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadline } from '../src/skills/get-to-work/scripts/deadline.mjs';

const SCRIPT = fileURLToPath(new URL('../src/skills/get-to-work/scripts/state.mjs', import.meta.url));
const NOW = '2026-03-10T12:00:00Z';
const STOP = '2026-03-10T12:30:00Z';
const LATER = '2026-03-10T13:00:00Z';
const LINE = 'run-1/line-a';
const SNAP = 'a'.repeat(64);

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// One repository (and one bare origin holding its main) built once and copied into each world: a git call costs tens
// of milliseconds on Windows, and every world starts from the same base commit.
let template = null;
after(() => template && rmSync(template.dir, { recursive: true, force: true }));
function base() {
  if (template) return template;
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-gates-template-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(repo, 'docs', 'agents'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'agents', 'commands.md'), '# Commands\n');
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const origin = join(dir, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(repo, 'push', '-q', origin, 'main');
  template = { dir, repo, origin };
  return template;
}

/**
 * A repository with `main` (holding docs/agents/commands.md), with `origin: true` a bare `origin`, a state file, and
 * helpers. `ok(...)` runs a state command and expects exit 0; `check(gate, ...)` runs a gate and returns
 * { code, json, err }, asserting the state file is byte-for-byte unchanged.
 */
function world(t, { origin = false, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-gates-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  cpSync(base().repo, repo, { recursive: true });
  if (origin) {
    const bare = join(dir, 'origin.git');
    cpSync(base().origin, bare, { recursive: true });
    git(repo, 'remote', 'add', 'origin', bare);
  }
  const path = join(dir, 'run-1.state.json');
  const deps = { ...defaultDeps(), env };
  const ok = (name, ...args) => {
    const argv = [name, path, ...args];
    if (!args.includes('--now')) argv.push('--now', NOW);
    const r = main(argv, deps);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  const check = (gate, ...args) => {
    const before = readFileSync(path, 'utf8');
    const r = main(['check', path, gate, '--repo', repo, ...args], deps);
    assert.equal(readFileSync(path, 'utf8'), before, 'a gate never writes the state');
    return { code: r.code, json: r.out ? JSON.parse(r.out) : null, err: r.err };
  };
  /** Edits the state file directly, for a state no command can produce. */
  const edit = (fn) => {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    fn(s);
    writeFileSync(path, JSON.stringify(s, null, 2));
  };
  const file = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };
  ok('init', '--run', 'run-1');
  return { dir, repo, path, ok, check, edit, file, git: (...a) => git(repo, ...a) };
}

/** The integration branch LINE cut from main, checked out in its worktree `<dir>/int`, recorded with its tip. */
function line(w, branch = LINE) {
  const wt = join(w.dir, branch.replace(/\W/g, '-'));
  w.git('branch', branch, 'main');
  w.git('worktree', 'add', '-q', wt, branch);
  w.ok('line', branch, '--tip', git(wt, 'rev-parse', 'HEAD'));
  return wt;
}

/** A commit on the branch checked out in worktree `wt`. */
function commit(wt, name, body = `${name}\n`) {
  writeFileSync(join(wt, name), body);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', name);
  return git(wt, 'rev-parse', 'HEAD');
}

const branchOf = (id) => `run-1/t${id.slice(1)}`;

/**
 * Ticket `id` brought to `stage` on LINE (whose worktree is `lineWt`), along the strict path, with real git: a ticket
 * branch in its own worktree with one commit, merged with `git merge --no-ff --no-edit` at integrating. Past
 * integrating, `pushed` and `cleaned` say whether close-out steps 6 and 7 ran (both default to true).
 */
function ticket(w, lineWt, id, stage, { pushed = true, cleaned = true } = {}) {
  const branch = branchOf(id);
  const wt = join(w.dir, `wt-${id.slice(1)}`);
  w.ok('add', id, '--line', LINE);
  w.ok('set', id, '--snapshot', SNAP, '--branch', branch);
  w.git('branch', branch, LINE);
  w.git('worktree', 'add', '-q', wt, branch);
  commit(wt, `${id.slice(1)}.txt`);
  const path = ['candidate', 'implementing', 'in-review', 'queued', 'integrating', 'delivered'];
  for (const next of path.slice(1, path.indexOf(stage) + 1)) {
    if (next === 'queued') w.ok('review', id, '--mode', 'initial', '--verdict', 'pass');
    w.ok('stage', next, id);
    if (next === 'integrating') {
      git(lineWt, 'merge', '--no-ff', '--no-edit', branch);
      w.ok('merge', id, git(lineWt, 'rev-parse', 'HEAD'));
    }
  }
  if (stage === 'delivered') {
    if (pushed && w.git('remote').includes('origin')) w.git('push', '-q', 'origin', LINE);
    if (cleaned) {
      w.git('worktree', 'remove', wt);
      w.git('branch', '-D', branch);
    }
  }
  return { branch, wt };
}

/** A recorded assignment with an agent id for ticket `id`, whose worktree is `wt`. */
function assign(w, id, wt, { agent = true } = {}) {
  const out = deadline(['record', '--worktree', wt, '--limit', '30', '--now', NOW]);
  assert.equal(out.code, 0, out.err);
  w.ok('assign', id, '--record', w.file(`rec-${id.slice(1)}.json`, out.out), '--type', 'general-purpose', '--worktree', wt);
  if (agent) w.ok('agent', id, '--id', `agent-${id.slice(1)}`);
}

/** The gate passed and applied every assertion in `ids`. */
function passes(r, ids) {
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.failures, []);
  for (const id of ids) assert.ok(r.json.checked.includes(id), `${id} was not applied`);
}

/** The gate failed (exit 4) on assertion `id` and on nothing else, with a message matching `re`. */
function failsOnly(r, id, re) {
  assert.equal(r.code, 4, `expected a failed gate, got ${r.code}: ${r.err}`);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.failures.length > 0);
  for (const f of r.json.failures) assert.equal(f.assertion, id, `unexpected failure ${f.assertion}: ${f.message}`);
  assert.match(r.json.failures.map((f) => f.message).join('\n'), re);
  assert.match(r.err, new RegExp(`^state: check ${r.json.gate}: ${id}: `, 'm'));
}

// ---- arguments -----------------------------------------------------------------------------------------------------

test('check: bad gates and arguments exit 2, an unknown ticket or branch exits 3, both before any assertion', (t) => {
  const w = world(t, { origin: false });
  line(w);
  w.ok('add', '#1', '--line', LINE);
  assert.equal(w.check('nope').code, 2);
  assert.equal(w.check('freeze').code, 2, 'freeze needs --base');
  assert.equal(w.check('merged').code, 2, 'merged needs a ticket');
  assert.equal(w.check('dispatch', '#1').code, 2, 'dispatch takes no targets');
  assert.equal(w.check('ledger').code, 2, 'ledger needs --ledger');
  assert.equal(w.check('ci', '--base', 'main').code, 2, '--base goes with freeze');
  assert.equal(w.check('review', '#1', '#1').code, 2);
  assert.equal(w.check('merged', '#9').code, 3);
  assert.equal(w.check('ci', 'run-1/nope').code, 3);
});

test('check through the real CLI: exit 4 with the failures on stdout and one stderr line each', (t) => {
  const w = world(t, { origin: false });
  line(w);
  const r = spawnSync(process.execPath, [SCRIPT, 'check', w.path, 'freeze', '--base', 'main', '--repo', w.repo], { encoding: 'utf8' });
  assert.equal(r.status, 4, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.command, 'check');
  assert.deepEqual(out.failures.map((f) => f.assertion), ['tickets']);
  assert.match(r.stderr, /^state: check freeze: tickets: state: no tickets/m);
});

// ---- freeze --------------------------------------------------------------------------------------------------------

function frozen(t, opts) {
  const w = world(t, opts);
  const wt = line(w);
  w.ok('add', '#1', '#2', '--line', LINE);
  return { w, wt };
}

test('freeze passes: tickets at candidate, the branch cut from the base in a worktree with commands.md', (t) => {
  const { w } = frozen(t);
  passes(w.check('freeze', '--base', 'main'), ['tickets', 'not-dispatched', 'line-branch', 'line-base', 'line-worktree', 'commands-contract']);
});

test('freeze fails on tickets: no frozen ticket set', (t) => {
  const w = world(t);
  line(w);
  failsOnly(w.check('freeze', '--base', 'main'), 'tickets', /no tickets/);
});

test('freeze fails on not-dispatched: a ticket already left candidate', (t) => {
  const { w } = frozen(t);
  w.ok('set', '#1', '--snapshot', SNAP);
  w.ok('stage', 'implementing', '#1');
  failsOnly(w.check('freeze', '--base', 'main'), 'not-dispatched', /#1.*implementing|implementing/);
});

test('freeze fails on line-branch: an integration branch in the state has no local branch', (t) => {
  const { w } = frozen(t);
  w.ok('line', 'run-1/line-b');
  const r = w.check('freeze', '--base', 'main');
  failsOnly(r, 'line-branch', /no local branch/);
  assert.equal(r.json.failures[0].subject, 'run-1/line-b');
});

test('freeze fails on line-base: the branch was not cut from the base tip', (t) => {
  const { w } = frozen(t);
  const other = join(w.dir, 'main-wt');
  w.git('worktree', 'add', '-q', '--detach', other, 'main');
  const moved = commit(other, 'later.txt');
  failsOnly(w.check('freeze', '--base', moved), 'line-base', /was not cut from/);
  failsOnly(w.check('freeze', '--base', 'nope'), 'line-base', /not a commit/);
});

test('freeze fails on line-worktree: the integration branch is not checked out anywhere', (t) => {
  const { w, wt } = frozen(t);
  w.git('worktree', 'remove', wt);
  failsOnly(w.check('freeze', '--base', 'main'), 'line-worktree', /not checked out/);
});

test('freeze fails on commands-contract: the branch tip has no docs/agents/commands.md', (t) => {
  const { w, wt } = frozen(t);
  git(wt, 'rm', '-q', 'docs/agents/commands.md');
  git(wt, 'commit', '-q', '-m', 'drop the contract');
  failsOnly(w.check('freeze', '--base', 'main'), 'commands-contract', /commands\.md/);
});

// ---- ci ------------------------------------------------------------------------------------------------------------

const verdict = (w, sha, v = 'green') =>
  w.file(`verdict-${sha.slice(0, 7)}.json`, JSON.stringify({ format: 'sorry-matt/ci@1', command: 'verdict', branch: LINE, sha, verdict: v, reason: null }));

test('ci passes when the verdict recorded is for the local tip', (t) => {
  const w = world(t, { origin: true });
  const wt = line(w);
  w.git('push', '-q', 'origin', LINE);
  w.ok('ci', LINE, '--from', verdict(w, git(wt, 'rev-parse', 'HEAD')));
  const r = w.check('ci');
  passes(r, ['ci-latest', 'local-record']);
  passes(w.check('ci', LINE), ['ci-latest']);
});

test('ci fails on ci-latest: the tip moved after the verdict, or nothing was read', (t) => {
  const w = world(t, { origin: true });
  const wt = line(w);
  w.git('push', '-q', 'origin', LINE);
  failsOnly(w.check('ci'), 'ci-latest', /no CI verdict recorded/);
  w.ok('ci', LINE, '--from', verdict(w, git(wt, 'rev-parse', 'HEAD')));
  commit(wt, 'next.txt');
  failsOnly(w.check('ci'), 'ci-latest', /the latest is for/);
  w.git('remote', 'set-url', 'origin', join(w.dir, 'missing.git'));
  failsOnly(w.check('ci'), 'ci-latest', /could not read origin/);
});

test('ci passes on a line origin does not have yet: it is first pushed at its first integration, not read before', (t) => {
  const w = world(t, { origin: true });
  line(w);
  w.ok('add', '#1', '--line', LINE);
  passes(w.check('ci'), ['ci-latest']);
});

test('ci under profile ci: skip does not ask for a verdict', (t) => {
  const w = world(t, { origin: true });
  line(w);
  w.git('push', '-q', 'origin', LINE);
  w.ok('profile', '--ci', 'skip');
  const r = w.check('ci');
  assert.equal(r.code, 0, r.err);
});

test('ci passes on local verification with a per-SHA record for the tip; without origin or once settled', (t) => {
  const w = world(t, { origin: false });
  const wt = line(w);
  w.ok('local', LINE, git(wt, 'rev-parse', 'HEAD'), 'green', 'no-origin');
  passes(w.check('ci'), ['local-record']);
});

test('ci fails on local-record: a line on local verification has no record for its tip', (t) => {
  const w = world(t, { origin: false });
  const wt = line(w);
  w.ok('local', LINE, git(wt, 'rev-parse', 'HEAD'), 'green', 'no-origin');
  commit(wt, 'next.txt');
  failsOnly(w.check('ci'), 'local-record', /no local verification record/);
  // settled as CI not covering it, with an origin: local verification too
  const v = world(t, { origin: true });
  const vwt = line(v);
  v.edit((s) => {
    s.lines[LINE].ciNotCovering = { sha: git(vwt, 'rev-parse', 'HEAD'), at: NOW };
  });
  failsOnly(v.check('ci'), 'local-record', /no local verification record/);
});

// ---- dispatch ------------------------------------------------------------------------------------------------------

test('dispatch passes: tickets in flight have a snapshot and an assignment with an agent id', (t) => {
  const w = world(t);
  const lwt = line(w);
  const { wt } = ticket(w, lwt, '#1', 'implementing');
  assign(w, '#1', wt);
  ticket(w, lwt, '#2', 'integrating');
  passes(w.check('dispatch'), ['snapshot', 'assignment', 'one-integrating']);
});

test('dispatch fails on snapshot: a ticket in flight has no acceptance snapshot', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'queued');
  w.edit((s) => {
    s.tickets['#1'].snapshotSha256 = null;
  });
  failsOnly(w.check('dispatch'), 'snapshot', /snapshot/);
});

test('dispatch fails on assignment: no assignment, or one without its agent id', (t) => {
  const w = world(t);
  const lwt = line(w);
  const { wt } = ticket(w, lwt, '#1', 'implementing');
  failsOnly(w.check('dispatch'), 'assignment', /no assignment in flight/);
  assign(w, '#1', wt, { agent: false });
  failsOnly(w.check('dispatch'), 'assignment', /no agent id/);
});

test('dispatch fails on one-integrating: two tickets of one line integrate at once', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  ticket(w, lwt, '#2', 'queued');
  w.edit((s) => {
    s.tickets['#2'].stage = 'integrating';
  });
  failsOnly(w.check('dispatch'), 'one-integrating', /2 tickets are integrating at once \(#1, #2\)/);
});

// ---- review --------------------------------------------------------------------------------------------------------

/** #1 through two fix rounds, each with its recheck, to queued. */
function twoRounds(w, lwt) {
  ticket(w, lwt, '#1', 'in-review');
  w.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1');
  w.ok('stage', 'fixing', '#1');
  w.ok('stage', 'in-review', '#1');
  w.ok('review', '#1', '--mode', 'recheck', '--verdict', 'fix', '--findings', 'F1');
  w.ok('stage', 'fixing', '#1');
  w.ok('stage', 'in-review', '#1');
  w.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass');
  w.ok('stage', 'queued', '#1');
}

test('review passes: one initial review, one recheck per fix round, a pass before queued', (t) => {
  const w = world(t);
  const lwt = line(w);
  twoRounds(w, lwt);
  ticket(w, lwt, '#2', 'delivered');
  // #3 is back in in-review awaiting its recheck: the round is not finished, nothing is missing yet
  ticket(w, lwt, '#3', 'in-review');
  w.ok('review', '#3', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1');
  w.ok('stage', 'fixing', '#3');
  w.ok('stage', 'in-review', '#3');
  passes(w.check('review'), ['one-initial', 'recheck-per-fix', 'fix-rounds', 'queued-review']);
  passes(w.check('review', '#1'), ['one-initial']);
});

test('review fails on one-initial: a second initial review since the ticket entered implementing', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'queued');
  w.edit((s) => {
    const first = s.tickets['#1'].reviews[0];
    s.tickets['#1'].reviews.unshift({ ...first });
  });
  failsOnly(w.check('review'), 'one-initial', /2 initial reviews/);
});

test('review: a stuck before reviewing is not a review; a send back and a new implementation start the count again', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'in-review');
  w.ok('review', '#1', '--mode', 'initial', '--verdict', 'stuck');
  w.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  w.ok('stage', 'queued', '#1');
  w.ok('stage', 'integrating', '#1');
  w.ok('stage', 'candidate', '#1');
  w.ok('stage', 'implementing', '#1');
  w.ok('stage', 'in-review', '#1');
  w.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  w.ok('stage', 'queued', '#1');
  passes(w.check('review'), ['one-initial']);
});

test('review fails on recheck-per-fix: a finished fix round without its recheck', (t) => {
  const w = world(t);
  const lwt = line(w);
  twoRounds(w, lwt);
  w.edit((s) => {
    s.tickets['#1'].reviews.splice(1, 1);
  });
  failsOnly(w.check('review'), 'recheck-per-fix', /1 rechecks for 2 finished fix round/);
});

test('review under profile recheck: false does not apply recheck-per-fix', (t) => {
  const w = world(t);
  w.ok('profile', '--recheck', 'false');
  const lwt = line(w);
  ticket(w, lwt, '#1', 'in-review');
  w.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1');
  w.ok('stage', 'fixing', '#1');
  w.ok('report', '#1', '--fixed', 'F1');
  w.ok('stage', 'queued', '#1');
  const r = w.check('review');
  passes(r, ['one-initial', 'queued-review']);
  assert.ok(!r.json.checked.includes('recheck-per-fix'));
});

test('review fails on fix-rounds: more rounds than the profile allows', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered');
  w.edit((s) => {
    s.tickets['#1'].fixRounds = 3;
  });
  failsOnly(w.check('review'), 'fix-rounds', /3 fix rounds; the profile allows 2/);
});

test('review fails on queued-review: the passing review was not a full one under review: full', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'queued');
  w.edit((s) => {
    s.tickets['#1'].reviews[0].kind = 'minimal';
  });
  failsOnly(w.check('review'), 'queued-review', /needs a prove-it review/);
});

// ---- merged --------------------------------------------------------------------------------------------------------

test('merged passes: one --no-ff merge with the default message, on the line, recorded as its tip', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  passes(w.check('merged', '#1'), ['stage', 'branch-recorded', 'one-merge', 'no-ff', 'on-line', 'not-rewritten', 'tip-recorded', 'one-integrating']);
});

test('merged: a red-light fix merge of a -ci branch is not counted as the ticket merge', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered');
  const ci = join(w.dir, 'ci-wt');
  w.git('worktree', 'add', '-q', '-b', 'run-1/01-x-ci', ci, LINE);
  commit(ci, 'fix.txt');
  git(lwt, 'merge', '--no-ff', '--no-edit', 'run-1/01-x-ci');
  w.ok('merge', '#1', git(lwt, 'rev-parse', 'HEAD'));
  passes(w.check('merged', '#1'), ['one-merge', 'no-ff']);
});

test('merged fails on stage: the ticket is not integrating or delivered', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  w.edit((s) => {
    s.tickets['#1'].stage = 'queued';
  });
  failsOnly(w.check('merged', '#1'), 'stage', /is queued/);
});

test('merged fails on branch-recorded: no ticket branch recorded', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  w.edit((s) => {
    s.tickets['#1'].branch = null;
  });
  failsOnly(w.check('merged', '#1'), 'branch-recorded', /set --branch/);
});

test('merged fails on one-merge: the ticket branch was merged twice', (t) => {
  const w = world(t);
  const lwt = line(w);
  const { wt, branch } = ticket(w, lwt, '#1', 'integrating');
  commit(wt, 'more.txt');
  git(lwt, 'merge', '--no-ff', '--no-edit', branch);
  w.ok('merge', '#1', git(lwt, 'rev-parse', 'HEAD'));
  failsOnly(w.check('merged', '#1'), 'one-merge', /2 recorded merge SHAs/);
});

test('merged fails on no-ff: a recorded SHA is a plain commit', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  w.ok('merge', '#1', commit(lwt, 'plain.txt'));
  failsOnly(w.check('merged', '#1'), 'no-ff', /has 1 parent\(s\)[\s\S]*not git's default/);
});

test('merged fails on no-ff: a merge commit whose message is not git\'s default', (t) => {
  const w = world(t);
  const lwt = line(w);
  const { branch } = ticket(w, lwt, '#1', 'integrating');
  git(lwt, 'commit', '-q', '--amend', '-m', `merge ${branch}`);
  w.edit((s) => {
    const sha = git(lwt, 'rev-parse', 'HEAD');
    s.tickets['#1'].merges = [{ sha, at: NOW }];
    s.lines[LINE].tip = sha;
  });
  const r = w.check('merged', '#1');
  assert.equal(r.code, 4);
  assert.deepEqual([...new Set(r.json.failures.map((f) => f.assertion))].sort(), ['no-ff', 'one-merge']);
  assert.match(r.json.failures.find((f) => f.assertion === 'no-ff').message, /not git's default/);
});

test('merged fails on on-line: the recorded merge is no longer on the integration branch', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  git(lwt, 'reset', '-q', '--hard', 'HEAD~1');
  w.ok('line', LINE, '--tip', git(lwt, 'rev-parse', 'HEAD'));
  failsOnly(w.check('merged', '#1'), 'on-line', /is not on run-1\/line-a/);
});

test('merged fails on not-rewritten: the ticket branch moved after its merge', (t) => {
  const w = world(t);
  const lwt = line(w);
  const { wt } = ticket(w, lwt, '#1', 'integrating');
  commit(wt, 'after.txt');
  failsOnly(w.check('merged', '#1'), 'not-rewritten', /changed after the merge/);
});

test('merged fails on tip-recorded: the line moved and the state was not told', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  commit(lwt, 'delivery.txt');
  failsOnly(w.check('merged', '#1'), 'tip-recorded', /record it with line --tip/);
});

// ---- integrated ----------------------------------------------------------------------------------------------------

test('integrated passes: delivered, pushed, ticket branch and worktree removed', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered');
  passes(w.check('integrated', '#1'), ['stage', 'branch-recorded', 'one-merge', 'no-ff', 'on-line', 'tip-recorded', 'pushed', 'cleaned']);
  // no origin: nothing to push
  const v = world(t, { origin: false });
  ticket(v, line(v), '#1', 'delivered');
  passes(v.check('integrated', '#1'), ['pushed']);
});

test('integrated fails on stage: the merge is in but the ticket is not delivered', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  const { wt, branch } = ticket(w, lwt, '#1', 'integrating');
  w.git('push', '-q', 'origin', LINE);
  w.git('worktree', 'remove', wt);
  w.git('branch', '-D', branch);
  failsOnly(w.check('integrated', '#1'), 'stage', /is integrating, not delivered/);
});

test('integrated fails on pushed: origin is behind the local integration branch, or unreadable', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered', { pushed: false });
  failsOnly(w.check('integrated', '#1'), 'pushed', /origin has no run-1\/line-a/);
  w.git('push', '-q', 'origin', LINE);
  w.ok('line', LINE, '--tip', commit(lwt, 'delivery.txt'));
  failsOnly(w.check('integrated', '#1'), 'pushed', /origin is at [0-9a-f]{40}, the local branch at/);
  w.git('remote', 'set-url', 'origin', join(w.dir, 'missing.git'));
  failsOnly(w.check('integrated', '#1'), 'pushed', /could not read origin/);
});

test('integrated fails on cleaned: the ticket branch and its worktree are still there', (t) => {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered', { cleaned: false });
  failsOnly(w.check('integrated', '#1'), 'cleaned', /still exists[\s\S]*worktree is still there/);
  // the branch gone, its recorded worktree left behind on a detached HEAD
  const v = world(t, { origin: true });
  const vl = line(v);
  const { wt: vwt, branch } = ticket(v, vl, '#1', 'implementing');
  assign(v, '#1', vwt);
  v.ok('release', '#1');
  v.ok('stage', 'in-review', '#1');
  v.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  v.ok('stage', 'queued', '#1');
  v.ok('stage', 'integrating', '#1');
  git(vl, 'merge', '--no-ff', '--no-edit', branch);
  v.ok('merge', '#1', git(vl, 'rev-parse', 'HEAD'));
  v.ok('stage', 'delivered', '#1');
  v.git('push', '-q', 'origin', LINE);
  git(vwt, 'checkout', '-q', '--detach');
  v.git('branch', '-D', branch);
  failsOnly(v.check('integrated', '#1'), 'cleaned', /worktree is still there/);
});

test('integrated passes cleaned when the recorded worktree is the integration worktree a merge agent worked in', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  const { wt, branch } = ticket(w, lwt, '#1', 'queued', { cleaned: false });
  w.ok('stage', 'integrating', '#1');
  assign(w, '#1', lwt); // the merge agent's assignment: its worktree is the line's
  w.ok('release', '#1');
  git(lwt, 'merge', '--no-ff', '--no-edit', branch);
  w.ok('merge', '#1', git(lwt, 'rev-parse', 'HEAD'));
  w.ok('stage', 'delivered', '#1');
  w.git('push', '-q', 'origin', LINE);
  w.git('worktree', 'remove', wt);
  w.git('branch', '-D', branch);
  passes(w.check('integrated', '#1'), ['cleaned']);
});

// ---- wake-end ------------------------------------------------------------------------------------------------------

test('wake-end passes: every line pushed, agents in flight named, a fallback wake-up recorded', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  w.git('push', '-q', 'origin', LINE);
  passes(w.check('wake-end'), ['pushed', 'assignment', 'fallback-wake']);
  const { wt } = ticket(w, lwt, '#1', 'implementing');
  assign(w, '#1', wt);
  w.ok('usage', '--sleep-task', 'task-1');
  passes(w.check('wake-end'), ['fallback-wake']);
});

test('wake-end fails on fallback-wake: an agent is in flight and no background sleep is recorded', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  w.git('push', '-q', 'origin', LINE);
  const { wt } = ticket(w, lwt, '#1', 'implementing');
  assign(w, '#1', wt);
  failsOnly(w.check('wake-end'), 'fallback-wake', /agents are in flight \(#1\)/);
});

test("#144: wake-end fails on fallback-wake while a line's ci-fix agent is in flight with no background sleep", (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  w.git('push', '-q', 'origin', LINE);
  w.ok('add', '#1', '--line', LINE);
  const out = deadline(['record', '--worktree', lwt, '--limit', '20', '--now', NOW]);
  assert.equal(out.code, 0, out.err);
  w.ok('assign', '--line', LINE, '--record', w.file('rec-line.json', out.out), '--type', 'general-purpose', '--worktree', lwt);
  w.ok('agent', '--line', LINE, '--id', 'c1');
  failsOnly(w.check('wake-end'), 'fallback-wake', new RegExp(`agents are in flight \\(${LINE}\\)`));
  w.ok('usage', '--sleep-task', 'task-1');
  passes(w.check('wake-end'), ['fallback-wake']);
});

test('wake-end fails on pushed: a line with a merge was never pushed', (t) => {
  const w = world(t, { origin: true });
  const lwt = line(w);
  ticket(w, lwt, '#1', 'integrating');
  failsOnly(w.check('wake-end'), 'pushed', /origin has no/);
});

test('wake-end passes on a line never pushed and never merged into: its first push comes with its first integration', (t) => {
  const w = world(t, { origin: true });
  line(w);
  w.ok('add', '#1', '--line', LINE);
  passes(w.check('wake-end'), ['pushed']);
});

// ---- stopped -------------------------------------------------------------------------------------------------------

/** #1 delivered, #2 and #3 frozen but never dispatched; the run stopped on spawns at STOP. */
function stoppedRun(t) {
  const w = world(t);
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered');
  w.ok('add', '#2', '#3', '--line', LINE);
  w.edit((s) => {
    s.stop = { at: STOP, stoppedBy: ['spawns'], usage: { rounds: 3, spawns: 200, hours: 1 }, note: null };
  });
  return w;
}

test('stopped passes: the stop is recorded and the undispatched tickets await a ruling naming the limit', (t) => {
  const w = stoppedRun(t);
  w.ok('stage', 'awaiting-ruling', '#2', '#3', '--reason', 'stopped at the spawns limit (200 of 200)', '--now', LATER);
  passes(w.check('stopped'), ['stop-recorded', 'no-dispatch-after-stop', 'undispatched-set-aside', 'stop-reason']);
});

test('stopped fails on stop-recorded: the run has no stop', (t) => {
  const w = world(t);
  line(w);
  failsOnly(w.check('stopped'), 'stop-recorded', /no stop is recorded/);
});

test('stopped fails on no-dispatch-after-stop: a ticket was dispatched after the stop', (t) => {
  const w = stoppedRun(t);
  w.ok('stage', 'awaiting-ruling', '#3', '--reason', 'spawns limit', '--now', LATER);
  w.ok('set', '#2', '--snapshot', SNAP);
  w.ok('stage', 'implementing', '#2', '--now', LATER);
  failsOnly(w.check('stopped'), 'no-dispatch-after-stop', /entered implementing at 2026-03-10T13:00:00Z, after the stop/);
});

test('stopped fails on undispatched-set-aside: a frozen ticket is still a candidate', (t) => {
  const w = stoppedRun(t);
  w.ok('stage', 'awaiting-ruling', '#3', '--reason', 'spawns limit', '--now', LATER);
  failsOnly(w.check('stopped'), 'undispatched-set-aside', /#2|candidate/);
});

test('stopped fails on stop-reason: the ruling reason does not say which limit stopped the run', (t) => {
  const w = stoppedRun(t);
  w.ok('stage', 'awaiting-ruling', '#2', '#3', '--reason', 'out of budget', '--now', LATER);
  failsOnly(w.check('stopped'), 'stop-reason', /does not name the limit that stopped the run \(spawns\)/);
});

// ---- finish --------------------------------------------------------------------------------------------------------

/** #1 delivered on LINE, #2 stuck with a reason, #3 awaiting a ruling; the base synced and CI green on the tip. */
function finished(t, opts) {
  const w = world(t, { origin: true, ...opts });
  const lwt = line(w);
  ticket(w, lwt, '#1', 'delivered');
  w.ok('add', '#2', '#3', '--line', LINE);
  w.ok('stage', 'stuck', '#2', '--reason', 'acceptance unclear');
  w.ok('stage', 'awaiting-ruling', '#3', '--reason', 'needs a design ruling');
  w.ok('line', LINE, '--base', w.git('rev-parse', 'main'), '--synced', 'yes');
  return { w, lwt };
}

test('finish passes: every ticket at an end state, the base synced, a final verdict for the tip, pushed, cleaned', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  passes(w.check('finish'), ['end-state', 'end-reason', 'delivered-merge', 'base-sync', 'full-verification', 'tip-recorded', 'pushed', 'cleaned']);
  // a red final verdict is a result too: the line is left to a person, with the failure said
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD'), 'red'));
  passes(w.check('finish'), ['full-verification']);
  // local verification instead of CI
  const v = finished(t, { origin: false });
  v.w.ok('local', LINE, git(v.lwt, 'rev-parse', 'HEAD'), 'green', 'no-origin');
  passes(v.w.check('finish'), ['full-verification']);
});

test('finish fails on end-state: a ticket is still in flight', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  w.ok('add', '#4', '--line', LINE);
  failsOnly(w.check('finish'), 'end-state', /#4|is candidate/);
});

test('finish fails on end-reason: a stuck ticket says nothing about why', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  w.ok('add', '#4', '--line', LINE);
  w.ok('stage', 'stuck', '#4');
  failsOnly(w.check('finish'), 'end-reason', /is stuck with no reason/);
});

test('finish fails on delivered-merge: a delivered ticket has no merge SHA', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  w.edit((s) => {
    s.tickets['#1'].merges = [];
  });
  failsOnly(w.check('finish'), 'delivered-merge', /delivered with no merge SHA/);
});

test('finish fails on base-sync: no base sync recorded, or a synced base that is not on the tip', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  w.edit((s) => {
    s.lines[LINE].base = null;
  });
  failsOnly(w.check('finish'), 'base-sync', /no base sync recorded/);
  const other = join(w.dir, 'main-wt');
  w.git('worktree', 'add', '-q', '--detach', other, 'main');
  w.ok('line', LINE, '--base', commit(other, 'upstream.txt'), '--synced', 'yes');
  failsOnly(w.check('finish'), 'base-sync', /which is not on its tip/);
  w.ok('line', LINE, '--base', git(other, 'rev-parse', 'HEAD'), '--synced', 'no');
  passes(w.check('finish'), ['base-sync']);
});

test('finish fails on full-verification: the verdict is for an older SHA, or still running', (t) => {
  const { w, lwt } = finished(t);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD')));
  w.ok('line', LINE, '--tip', commit(lwt, 'simplify.txt'));
  w.git('push', '-q', 'origin', LINE);
  failsOnly(w.check('finish'), 'full-verification', /no final CI verdict or local verification/);
  w.ok('ci', LINE, '--from', verdict(w, git(lwt, 'rev-parse', 'HEAD'), 'running'));
  failsOnly(w.check('finish'), 'full-verification', /no final CI verdict/);
});

// ---- ledger --------------------------------------------------------------------------------------------------------

function ledgerText(rule, { marker = '<!-- sorry-matt:run active -->', session = 'sess-1', drop = [], empty = [], budget = null } = {}) {
  const body = {
    1: 'Dispatch the next tickets.',
    2: '- scope: #1 #2',
    3: '- lights: green',
    4: '- base = origin/main abc1234',
    5: 'none',
    6: '| # | Decision |\n| --- | --- |',
    7: 'none',
    8: '| ticket | stage |\n| --- | --- |',
    9: (budget ??
      ['budget: spawns 200', 'budget: rounds 40', 'budget: hours 12', 'budget: no-progress 3', 'budget: timeout-implement 30', '- `budget: timeout-fix 20`', 'budget: timeout-expand 15', 'budget: timeout-merge 15', 'budget: timeout-review 60']
    ).join('\n') + (session ? `\nsession: ${session}` : ''),
    10: `rule: ${rule}`,
  };
  const parts = [marker, '# Run ledger: run-1', ''];
  for (let n = 1; n <= 10; n += 1) {
    if (drop.includes(n)) continue;
    parts.push(`## ${n}. Field ${n}`, empty.includes(n) ? '' : body[n], '');
  }
  return parts.join('\n');
}

function ledgerWorld(t, env = { CLAUDE_CODE_SESSION_ID: 'sess-1' }) {
  const w = world(t, { origin: false, env });
  const rule = w.file('SKILL.md', '# rules\n');
  const check = (text, ...args) => w.check('ledger', '--ledger', w.file('run-1.md', text), ...args);
  return { w, rule, check };
}

test('ledger passes: the marker, ten fields with content, nine budget lines, this session, absolute rule files', (t) => {
  const { rule, check } = ledgerWorld(t);
  passes(check(ledgerText(rule)), ['marker', 'fields', 'budget-limits', 'stage-limits', 'session', 'rule-files']);
  passes(check(`﻿${ledgerText(rule)}`), ['marker']);
  passes(check(ledgerText(rule, { marker: '<!-- sorry-matt:run ended -->' }), '--ended'), ['marker']);
  // no session id to compare with: the session line is not required
  const v = ledgerWorld(t, {});
  passes(v.check(ledgerText(v.rule, { session: null })), ['session']);
});

test('ledger fails on marker: a blank line before it, or the wrong state', (t) => {
  const { rule, check } = ledgerWorld(t);
  failsOnly(check(`\n${ledgerText(rule)}`), 'marker', /the first line is ""/);
  failsOnly(check(ledgerText(rule), '--ended'), 'marker', /run ended/);
  failsOnly(check(ledgerText(rule, { marker: '<!-- sorry-matt:run ended -->' })), 'marker', /run active/);
});

test('ledger fails on fields: a field missing, empty, or out of order', (t) => {
  const { rule, check } = ledgerWorld(t);
  failsOnly(check(ledgerText(rule, { drop: [7] })), 'fields', /field 7: is missing|is missing/);
  failsOnly(check(ledgerText(rule, { empty: [5] })), 'fields', /is empty; write its content, or none/);
  const swapped = ledgerText(rule).replace('## 2. Field 2', '## 3. Field X').replace('## 3. Field 3', '## 2. Field Y');
  failsOnly(check(swapped), 'fields', /out of order/);
});

test('ledger fails on budget-limits: a limit line is missing', (t) => {
  const { rule, check } = ledgerWorld(t);
  const budget = ['budget: spawns 200', 'budget: rounds 40', 'budget: no-progress 3', 'budget: timeout-implement 30', 'budget: timeout-fix 20', 'budget: timeout-expand 15', 'budget: timeout-merge 15', 'budget: timeout-review 60'];
  failsOnly(check(ledgerText(rule, { budget })), 'budget-limits', /no budget: hours/);
});

test('ledger fails on stage-limits: a stage time limit line is missing', (t) => {
  const { rule, check } = ledgerWorld(t);
  const budget = ['budget: spawns 200', 'budget: rounds 40', 'budget: hours 12', 'budget: no-progress 3', 'budget: timeout-implement 30', 'budget: timeout-fix 20', 'budget: timeout-expand 15', 'budget: timeout-review 60'];
  failsOnly(check(ledgerText(rule, { budget })), 'stage-limits', /no budget: timeout-merge/);
  // #143: the review host agent's time limit is a stage time limit too
  const noReview = ['budget: spawns 200', 'budget: rounds 40', 'budget: hours 12', 'budget: no-progress 3', 'budget: timeout-implement 30', 'budget: timeout-fix 20', 'budget: timeout-expand 15', 'budget: timeout-merge 15'];
  failsOnly(check(ledgerText(rule, { budget: noReview })), 'stage-limits', /no budget: timeout-review/);
});

test('#215: stage-limits does not require budget: timeout-verify; a ledger with it passes too', (t) => {
  const { rule, check } = ledgerWorld(t);
  const five = ['budget: spawns 200', 'budget: rounds 40', 'budget: hours 12', 'budget: no-progress 3', 'budget: timeout-implement 30', 'budget: timeout-fix 20', 'budget: timeout-expand 15', 'budget: timeout-merge 15', 'budget: timeout-review 60'];
  passes(check(ledgerText(rule, { budget: five })), ['budget-limits', 'stage-limits']);
  passes(check(ledgerText(rule, { budget: [...five, '- `budget: timeout-verify 30`'] })), ['budget-limits', 'stage-limits']);
});

test('ledger fails on session: the session line is another session, or missing while one is known', (t) => {
  const { rule, check } = ledgerWorld(t);
  failsOnly(check(ledgerText(rule, { session: 'sess-old' })), 'session', /session: sess-old, but this session is sess-1/);
  failsOnly(check(ledgerText(rule, { session: null })), 'session', /no session: line/);
});

test('ledger fails on rule-files: no rule line, a relative path, or a file that is not there', (t) => {
  const { w, rule, check } = ledgerWorld(t);
  failsOnly(check(ledgerText(rule).replace(/^rule: .*$/m, 'none')), 'rule-files', /no rule: <absolute path> line/);
  failsOnly(check(ledgerText('skills/get-to-work/SKILL.md')), 'rule-files', /is not an absolute path/);
  failsOnly(check(ledgerText(join(w.dir, 'gone.md'))), 'rule-files', /is not a file/);
});

test('ledger: an unreadable ledger fails the marker assertion', (t) => {
  const { w } = ledgerWorld(t);
  failsOnly(w.check('ledger', '--ledger', join(w.dir, 'nope.md')), 'marker', /could not read the ledger/);
});

// ---- #196: delivered-merge under integrate: ticket-pr --------------------------------------------------------------

test('#196: finish delivered-merge under ticket-pr passes on a merge SHA or a left-for-human record, and fails with neither', (t) => {
  const w = world(t);
  w.edit((s) => {
    s.tracker = 'github';
  });
  w.ok('profile', '--integrate', 'ticket-pr');
  w.ok('add', '#1', '--line', LINE);
  w.ok('set', '#1', '--snapshot', SNAP, '--branch', branchOf('#1'));
  for (const next of ['implementing', 'in-review', 'queued', 'integrating', 'awaiting-ci', 'awaiting-merge']) {
    if (next === 'queued') w.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
    w.ok('stage', next, '#1');
  }
  w.ok('set', '#1', '--left-for-human', 'PR 11 is ready; a person merges it');
  w.ok('stage', 'delivered', '#1');

  const record = w.check('finish');
  assert.ok(record.json.checked.includes('delivered-merge'), 'delivered-merge was applied');
  assert.ok(!record.json.failures.some((f) => f.assertion === 'delivered-merge'), `a left-for-human record passes: ${JSON.stringify(record.json.failures)}`);

  // a merge SHA passes too (the record cleared away)
  w.edit((s) => {
    s.tickets['#1'].leftForHuman = null;
    s.tickets['#1'].merges = [{ sha: '3'.repeat(40), at: NOW }];
  });
  const sha = w.check('finish');
  assert.ok(!sha.json.failures.some((f) => f.assertion === 'delivered-merge'), 'a merge SHA passes');

  // neither: the assertion fails and names both
  w.edit((s) => {
    s.tickets['#1'].merges = [];
  });
  const neither = w.check('finish');
  const fails = neither.json.failures.filter((f) => f.assertion === 'delivered-merge');
  assert.equal(fails.length, 1);
  assert.match(fails[0].message, /no merge SHA and no left-for-human record/);
});

// ---- #200: the finish under integrate: ticket-pr -------------------------------------------------------------------

test('#200: finish under ticket-pr asserts pr-recorded and no line checks; a branch left for a person is not required gone', (t) => {
  const w = world(t);
  w.edit((s) => {
    s.tracker = 'github';
  });
  w.ok('profile', '--integrate', 'ticket-pr');
  w.ok('add', '#1', '--line', LINE);
  w.ok('set', '#1', '--snapshot', SNAP, '--branch', branchOf('#1'));
  for (const next of ['implementing', 'in-review', 'queued', 'integrating', 'awaiting-ci', 'awaiting-merge']) {
    if (next === 'queued') w.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
    w.ok('stage', next, '#1');
  }
  w.ok('set', '#1', '--left-for-human', 'PR 11 is ready; a person merges it');
  w.ok('stage', 'delivered', '#1');
  const noPr = w.check('finish');
  assert.ok(noPr.json.checked.includes('pr-recorded'));
  for (const a of ['base-sync', 'full-verification', 'tip-recorded', 'pushed']) assert.ok(!noPr.json.checked.includes(a), `${a} is not asserted under ticket-pr`);
  assert.deepEqual(noPr.json.failures.map((f) => f.assertion), ['pr-recorded']);
  w.ok('set', '#1', '--pr', '11');
  const ok = w.check('finish');
  assert.deepEqual(ok.json.failures, [], 'a ready PR left for a person, its branch still there, passes');
});
