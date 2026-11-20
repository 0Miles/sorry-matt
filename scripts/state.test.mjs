// node --test scripts/state.test.mjs
// Drives state.mjs through main(), against real state files in a temp dir. Times are fixed with --now. The
// deadline.mjs and ci.mjs formats the state takes in come from deadline.mjs's own main where it can produce them,
// so the two scripts are checked against each other, not against a copy of the format written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadline } from '../src/skills/get-to-work/scripts/deadline.mjs';

const SCRIPT = fileURLToPath(new URL('../src/skills/get-to-work/scripts/state.mjs', import.meta.url));
const NOW = '2026-03-10T12:00:00Z';
const LINE = 'run-1/line-a';
const SNAP = 'a'.repeat(64);
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const READS = new Set(['show', 'resume']);

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fresh run: `cmd(...)` runs a command on its state file, `ok(...)` expects exit 0 and returns the JSON. */
function run(t, { init = true } = {}) {
  const dir = scratch(t);
  const path = join(dir, 'run-1.state.json');
  const cmd = (name, ...args) => {
    const argv = [name, path, ...args];
    if (!READS.has(name) && !args.includes('--now')) argv.push('--now', NOW);
    return main(argv);
  };
  const ok = (...a) => {
    const r = cmd(...a);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  const file = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
    return p;
  };
  const state = () => JSON.parse(readFileSync(path, 'utf8'));
  /** The command is refused (exit 3) with a message matching `re`, and the file is byte-for-byte unchanged. */
  const refused = (re, ...a) => {
    const before = readFileSync(path, 'utf8');
    const r = cmd(...a);
    assert.equal(r.code, 3, `expected a refusal, got ${r.code}: ${r.out}${r.err}`);
    assert.equal(r.out, '');
    assert.match(r.err, re);
    assert.equal(readFileSync(path, 'utf8'), before);
  };
  if (init) ok('init', '--run', 'run-1');
  return { dir, path, cmd, ok, file, state, refused };
}

/** A ticket brought to `stage` along the strict path (default profile). */
function at(r, id, stage) {
  r.ok('add', id, '--line', LINE);
  const path = ['candidate', 'implementing', 'in-review', 'queued', 'integrating', 'delivered'];
  r.ok('set', id, '--snapshot', SNAP);
  for (const next of path.slice(1, path.indexOf(stage) + 1)) {
    if (next === 'queued') r.ok('review', id, '--mode', 'initial', '--verdict', 'pass');
    if (next === 'delivered') r.ok('merge', id, SHA1);
    r.ok('stage', next, id);
  }
}

/** In in-review with a `fix` review listing F1 and F2, then in fixing. */
function fixing(r, id) {
  at(r, id, 'in-review');
  r.ok('review', id, '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1,F2');
  r.ok('stage', 'fixing', id);
}

const deadlineOut = (r, argv) => {
  const out = deadline(argv);
  assert.equal(out.code, 0, out.err);
  return out.out;
};

// ---- the strict path -----------------------------------------------------------------------------------------------

test('init creates an empty state; a second init is refused and show prints it', (t) => {
  const r = run(t);
  const s = r.ok('show');
  assert.equal(s.format, 'sorry-matt/state@1');
  assert.equal(s.run, 'run-1');
  assert.equal(s.revision, 0);
  assert.equal(s.profile, null);
  assert.deepEqual(s.tickets, {});
  r.refused(/already exists/, 'init', '--run', 'run-1');
});

test('a ticket goes the whole strict path with a fix round and a recheck', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass');
  r.ok('stage', 'queued', '#1');
  r.ok('stage', 'integrating', '#1');
  r.ok('merge', '#1', SHA1);
  const out = r.ok('stage', 'delivered', '#1');
  const t1 = out.tickets['#1'];
  assert.equal(t1.stage, 'delivered');
  assert.equal(t1.fixRounds, 1);
  assert.deepEqual(t1.merges.map((m) => m.sha), [SHA1]);
  assert.deepEqual(
    t1.history.map((h) => h.to),
    ['implementing', 'in-review', 'fixing', 'in-review', 'queued', 'integrating', 'delivered'],
  );
  const s = r.state();
  assert.equal(s.lines[LINE].tip, SHA1);
  assert.equal(s.usage.fixRounds, 1);
  assert.equal(s.usage.reviewRounds, 2);
  assert.equal(s.revision, 12, "one revision per write");
});

test('expansion goes out and back to candidate; a send back returns to candidate once', (t) => {
  const r = run(t);
  r.ok('add', '#1', '--line', LINE);
  r.ok('stage', 'expanding', '#1');
  r.ok('stage', 'candidate', '#1');
  r.ok('set', '#1', '--snapshot', SNAP);
  r.ok('stage', 'implementing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  r.ok('stage', 'queued', '#1');
  r.ok('stage', 'integrating', '#1');
  const back = r.ok('stage', 'candidate', '#1', '--reason', 'conflict in a.txt');
  assert.equal(back.tickets['#1'].sendBacks, 1);
  assert.equal(back.tickets['#1'].reason, 'conflict in a.txt');
  assert.equal(r.state().usage.sendBacks, 1);
  for (const s of ['implementing', 'in-review']) r.ok('stage', s, '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass');
  r.ok('stage', 'queued', '#1');
  r.ok('stage', 'integrating', '#1');
  r.refused(/already sent back once.*stuck/, 'stage', 'candidate', '#1');
  r.ok('stage', 'stuck', '#1', '--reason', 'second conflict');
});

test('a delivered ticket can go to stuck (revert, upstream reverted) and record a -ci merge', (t) => {
  const r = run(t);
  at(r, '#1', 'delivered');
  r.ok('merge', '#1', SHA2);
  const out = r.ok('stage', 'stuck', '#1', '--reason', 'upstream reverted abc1234');
  assert.deepEqual(out.tickets['#1'].merges.map((m) => m.sha), [SHA1, SHA2]);
  assert.equal(out.tickets['#1'].reason, 'upstream reverted abc1234');
});

// ---- refusals under the default profile --------------------------------------------------------------------------

test('queued is refused unless the latest review since entering in-review is a pass', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.refused(/queued needs a review recorded since it entered in-review; there is none/, 'stage', 'queued', '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  r.refused(/queued needs the latest review verdict to be pass; it is fix/, 'stage', 'queued', '#1');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  // the earlier review belongs to the previous visit: a recheck is needed
  r.refused(/there is none/, 'stage', 'queued', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'stuck');
  r.refused(/it is stuck/, 'stage', 'queued', '#1');
});

test('delivered is refused without a merge SHA', (t) => {
  const r = run(t);
  at(r, '#1', 'integrating');
  r.refused(/delivered needs a merge SHA; none is recorded/, 'stage', 'delivered', '#1');
});

test('an end state never returns to a stage in flight or to candidate', (t) => {
  const r = run(t);
  at(r, '#1', 'delivered');
  r.ok('add', '#2', '#3', '--line', LINE);
  r.ok('stage', 'stuck', '#2');
  r.ok('stage', 'awaiting-ruling', '#3');
  for (const [id, from] of [['#1', 'delivered'], ['#2', 'stuck'], ['#3', 'awaiting-ruling']]) {
    for (const to of ['candidate', 'implementing', 'in-review', 'fixing', 'queued', 'integrating']) {
      r.refused(new RegExp(`${from} is an end state; it never returns to ${to}`), 'stage', to, id);
    }
  }
  r.refused(/stuck is an end state/, 'stage', 'delivered', '#2');
});

test('implementing and fixing cannot skip in-review to queued or integrating', (t) => {
  const r = run(t);
  at(r, '#1', 'implementing');
  fixing(r, '#2');
  for (const id of ['#1', '#2']) {
    for (const to of ['queued', 'integrating']) r.refused(new RegExp(`${to} cannot skip in-review`), 'stage', to, id);
  }
});

test('a third fix round is refused, and fixing needs a fix verdict', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.refused(/fixing needs the latest review .* to be fix; it is missing/, 'stage', 'fixing', '#1');
  for (let round = 1; round <= 2; round++) {
    r.ok('review', '#1', '--mode', round === 1 ? 'initial' : 'recheck', '--verdict', 'fix');
    r.ok('stage', 'fixing', '#1');
    r.ok('stage', 'in-review', '#1');
  }
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'fix');
  r.refused(/2 of 2 fix rounds used; mark it stuck/, 'stage', 'fixing', '#1');
});

test('implementing needs the acceptance snapshot; other undefined edges are refused', (t) => {
  const r = run(t);
  r.ok('add', '#1', '--line', LINE);
  r.refused(/implementing needs the acceptance snapshot's sha256/, 'stage', 'implementing', '#1');
  r.refused(/there is no edge candidate → in-review/, 'stage', 'in-review', '#1');
  r.refused(/#1 is already candidate/, 'stage', 'candidate', '#1');
});

test('a command naming several tickets is all or nothing', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '--line', LINE);
  r.ok('set', '#1', '--snapshot', SNAP);
  r.refused(/#2: implementing needs/, 'stage', 'implementing', '#1', '#2');
  assert.equal(r.state().tickets['#1'].stage, 'candidate');
  r.refused(/#9 is not a ticket/, 'stage', 'stuck', '#1', '#9');
});

test('review and merge are recorded only in their stages', (t) => {
  const r = run(t);
  at(r, '#1', 'implementing');
  r.refused(/only in in-review; it is implementing/, 'review', '#1', '--mode', 'initial', '--verdict', 'pass');
  r.refused(/recorded in integrating .* it is implementing/, 'merge', '#1', SHA1);
});

// ---- the profile ---------------------------------------------------------------------------------------------------

test('the profile is written once; a rewrite, an unknown field and a bad value are refused', (t) => {
  const r = run(t);
  assert.deepEqual(r.ok('resume').profile, {
    review: 'full', fixRounds: 2, recheck: true, onUnfixed: 'stuck', expand: 'agent', integrate: 'aggregate-pr', ci: 'read', simplify: true,
  });
  const out = r.ok('profile', '--review', 'minimal', '--fixRounds', '1', '--recheck', 'false');
  assert.deepEqual(out.profile, {
    review: 'minimal', fixRounds: 1, recheck: false, onUnfixed: 'stuck', expand: 'agent', integrate: 'aggregate-pr', ci: 'read', simplify: true,
  });
  r.refused(/written once already/, 'profile', '--review', 'full');
  r.refused(/written once already/, 'profile');
  assert.equal(r.cmd('profile', '--budget', '999').code, 2);
  assert.equal(r.cmd('profile', '--fixRounds', '3').code, 2);
  assert.equal(r.ok('resume').profileWritten, true);
});

test('a first profile write is refused once a ticket has moved under the defaults', (t) => {
  // the repro: a ticket stuck on its fix rounds is not let through by a profile written afterwards
  const r = run(t);
  at(r, '#1', 'in-review');
  for (let round = 1; round <= 2; round++) {
    r.ok('review', '#1', '--mode', round === 1 ? 'initial' : 'recheck', '--verdict', 'fix');
    r.ok('stage', 'fixing', '#1');
    r.ok('stage', 'in-review', '#1');
  }
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'fix');
  r.refused(/queued needs the latest review verdict to be pass; it is fix/, 'stage', 'queued', '#1');
  r.refused(/written before the first ticket moves; #1 is already in-review/, 'profile', '--onUnfixed', 'file-issue', '--review', 'minimal');
  r.ok('set', '#1', '--unfixed-issue', '#200');
  r.refused(/queued needs the latest review verdict to be pass; it is fix/, 'stage', 'queued', '#1');
  assert.equal(r.state().profile, null);

  // tickets still at candidate (the freeze) do not stop it
  const fresh = run(t);
  fresh.ok('add', '#1', '#2', '--line', LINE);
  fresh.ok('set', '#1', '--snapshot', SNAP);
  fresh.ok('profile', '--recheck', 'false');

  // an imported ticket past candidate has no history, and still counts as moved
  const imported = run(t, { init: false });
  imported.ok('import', '--from', imported.file('seed.json', { run: 'run-1', tickets: { '#1': { line: LINE, stage: 'implementing', snapshotSha256: SNAP } } }));
  imported.refused(/#1 is already implementing/, 'profile', '--review', 'minimal');
});

test('a profile cannot carry confirmations or budget limits', (t) => {
  const r = run(t, { init: false });
  const seed = r.file('seed.json', { run: 'run-1', profile: { review: 'minimal', budget: { spawns: 999 } } });
  const out = r.cmd('import', '--from', seed);
  assert.equal(out.code, 2);
  assert.match(out.err, /budget, which is not a profile field.*confirmations and budget limits are not in a profile/);
  assert.equal(existsSync(r.path), false);
});

test('review minimal: a minimal review passes; no review still blocks; the default needs a full one', (t) => {
  const strict = run(t);
  at(strict, '#1', 'in-review');
  strict.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal');
  strict.refused(/needs a full review \(profile review: full\); the latest is minimal/, 'stage', 'queued', '#1');

  const r = run(t);
  r.ok('profile', '--review', 'minimal');
  at(r, '#1', 'in-review');
  r.refused(/queued needs a review recorded/, 'stage', 'queued', '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal');
  r.ok('stage', 'queued', '#1');
});

test('fixRounds 1: one fix round passes; a second is refused', (t) => {
  const r = run(t);
  r.ok('profile', '--fixRounds', '1');
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'fix');
  r.refused(/1 of 1 fix rounds used; mark it stuck/, 'stage', 'fixing', '#1');
});

test('recheck false: fixing → queued with a full per-finding report; without one it is still refused', (t) => {
  const r = run(t);
  r.ok('profile', '--recheck', 'false');
  fixing(r, '#1');
  r.refused(/needs the implementer's per-finding report for this fix round/, 'stage', 'queued', '#1');
  r.refused(/each finding of the fix review \(F1, F2\) exactly once; missing F2/, 'report', '#1', '--fixed', 'F1');
  r.refused(/not in the review F3/, 'report', '#1', '--fixed', 'F1,F2,F3');
  r.ok('report', '#1', '--fixed', 'F1,F2');
  const out = r.ok('stage', 'queued', '#1');
  assert.equal(out.tickets['#1'].stage, 'queued');
  // the relaxation is the profile's: under the default, the same report does not open the edge
  const strict = run(t);
  fixing(strict, '#1');
  strict.ok('report', '#1', '--fixed', 'F1,F2');
  strict.refused(/queued cannot skip in-review/, 'stage', 'queued', '#1');
});

test('recheck false: a report without finding ids in the review, or with unfixed findings under stuck, is refused', (t) => {
  const r = run(t);
  r.ok('profile', '--recheck', 'false');
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  r.ok('stage', 'fixing', '#1');
  r.refused(/recorded no finding ids/, 'report', '#1', '--fixed', 'F1');
  fixing(r, '#2');
  r.ok('report', '#2', '--fixed', 'F1', '--unfixed', 'F2');
  r.refused(/unfixed findings F2 needs profile onUnfixed: file-issue/, 'stage', 'queued', '#2');
});

test('onUnfixed file-issue: a fix verdict goes on with the issue recorded; without it, or with rounds left, refused', (t) => {
  const r = run(t);
  r.ok('profile', '--onUnfixed', 'file-issue', '--fixRounds', '0');
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  r.refused(/0 of 0 fix rounds used; mark it stuck, or file an issue and queue it/, 'stage', 'fixing', '#1');
  r.refused(/needs the issue filed for them recorded \(set --unfixed-issue/, 'stage', 'queued', '#1');
  r.ok('set', '#1', '--unfixed-issue', '#200');
  r.ok('stage', 'queued', '#1');

  const rounds = run(t);
  rounds.ok('profile', '--onUnfixed', 'file-issue');
  at(rounds, '#1', 'in-review');
  rounds.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  rounds.ok('set', '#1', '--unfixed-issue', '#200');
  rounds.refused(/0 of 2 fix rounds used; fix it first/, 'stage', 'queued', '#1');

  const strict = run(t);
  at(strict, '#1', 'in-review');
  strict.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix');
  strict.ok('set', '#1', '--unfixed-issue', '#200');
  strict.refused(/queued needs the latest review verdict to be pass; it is fix/, 'stage', 'queued', '#1');
});

test('onUnfixed file-issue with recheck false: unfixed findings in the report go on only with the issue', (t) => {
  const r = run(t);
  r.ok('profile', '--onUnfixed', 'file-issue', '--recheck', 'false');
  fixing(r, '#1');
  r.ok('report', '#1', '--fixed', 'F1', '--unfixed', 'F2');
  r.refused(/unfixed findings F2 needs the issue filed/, 'stage', 'queued', '#1');
  r.ok('set', '#1', '--unfixed-issue', '#201');
  r.ok('stage', 'queued', '#1');
});

test('expand skip: implementing with the snapshot passes; without it, or to expanding, refused', (t) => {
  const r = run(t);
  r.ok('profile', '--expand', 'skip');
  r.ok('add', '#1', '--line', LINE);
  r.refused(/expanding: this run's profile has expand: skip/, 'stage', 'expanding', '#1');
  r.refused(/implementing needs the acceptance snapshot's sha256/, 'stage', 'implementing', '#1');
  r.ok('set', '#1', '--snapshot', SNAP);
  r.ok('stage', 'implementing', '#1');
});

test('integrate direct, ci skip, simplify false: delivery still needs its merge SHA', (t) => {
  const r = run(t);
  const out = r.ok('profile', '--integrate', 'direct', '--ci', 'skip', '--simplify', 'false');
  assert.equal(out.profile.integrate, 'direct');
  at(r, '#1', 'integrating');
  r.refused(/delivered needs a merge SHA/, 'stage', 'delivered', '#1');
  r.ok('merge', '#1', SHA1);
  r.ok('stage', 'delivered', '#1');
});

// ---- assignments and resuming ------------------------------------------------------------------------------------

test('assignments, agent ids, extension, release and timeout reassignment', (t) => {
  const r = run(t);
  const rec = r.file('rec.json', deadlineOut(r, ['record', '--expansions', '#1=0', '--expansions', '#2=1', '--limit', '15', '--now', NOW]));
  r.ok('add', '#1', '#2', '--line', LINE);
  r.ok('stage', 'expanding', '#1', '#2');
  assert.equal(r.cmd('assign', '#1', '--record', rec, '--type', 'x', '--worktree', r.dir).code, 2);
  r.refused(/no assignment in flight/, 'agent', '#1', '--id', 'a1');
  r.ok('assign', '#1', '#2', '--record', rec, '--type', 'sorry-matt:expander');
  r.ok('agent', '#1', '#2', '--id', 'a1');
  r.refused(/already belongs to a1/, 'agent', '#1', '--id', 'a2');
  r.ok('extend', '#1', '#2', '--deadline', '2026-03-10T12:30:00Z');
  r.refused(/already extended once/, 'extend', '#1', '--deadline', '2026-03-10T12:45:00Z');
  r.ok('release', '#1', '#2', '--stopped');
  r.refused(/no assignment in flight/, 'release', '#1');
  r.ok('assign', '#1', '--record', rec, '--type', 'sorry-matt:expander', '--reassign');
  r.refused(/already reassigned for a timeout in expanding/, 'assign', '#1', '--record', rec, '--type', 'x', '--reassign');
  const s = r.state();
  assert.equal(s.tickets['#1'].timeoutReassignments.expanding, 1);
  assert.equal(s.tickets['#1'].assignment.agentId, null);
  assert.equal(s.usage.timeoutExtensions, 1);
  assert.equal(s.usage.timeoutStops, 1);
  r.ok('add', '#3', '--line', LINE);
  r.refused(/a timeout reassignment is for implementing, fixing, expanding; it is candidate/, 'assign', '#3', '--record', rec, '--type', 'x', '--reassign');
});

test('#144: a line holds its own assignment (the ci-fix of a red light that maps to no ticket)', (t) => {
  const r = run(t);
  const rec = r.file('rec.json', deadlineOut(r, ['record', '--worktree', process.cwd(), '--limit', '20', '--now', NOW]));
  r.ok('add', '#1', '--line', LINE);
  assert.equal(r.state().lines[LINE].assignment, null, 'a new line holds no assignment');
  r.refused(/not an integration branch of this run/, 'assign', '--line', 'run-1/nowhere', '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd());
  assert.equal(r.cmd('assign', '#1', '--line', LINE, '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd()).code, 2, 'tickets or a line, not both');
  r.refused(/no assignment in flight/, 'agent', '--line', LINE, '--id', 'c1');
  r.ok('assign', '--line', LINE, '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd());
  r.ok('agent', '--line', LINE, '--id', 'c1');
  r.refused(/already belongs to c1/, 'agent', '--line', LINE, '--id', 'c2');
  r.ok('extend', '--line', LINE, '--deadline', '2026-03-10T12:40:00Z');
  r.refused(/already extended once/, 'extend', '--line', LINE, '--deadline', '2026-03-10T12:50:00Z');
  const a = r.state().lines[LINE].assignment;
  assert.deepEqual([a.agentId, a.type, a.limit, a.deadline, a.extended], ['c1', 'general-purpose', 20, '2026-03-10T12:40:00Z', 'yes']);
  assert.equal(r.state().tickets['#1'].assignment, null, 'no ticket holds it');
  const res = r.ok('resume');
  assert.deepEqual(res.inFlight.map((x) => [x.id, x.tickets, x.line]), [['c1', [], LINE]]);
  r.ok('release', '--line', LINE, '--stopped');
  r.refused(/no assignment in flight/, 'release', '--line', LINE);
  const s = r.state();
  assert.equal(s.lines[LINE].assignment.deadline, null);
  assert.equal(s.usage.timeoutExtensions, 1);
  assert.equal(s.usage.timeoutStops, 1);
  // an expansion record is for tickets only
  const ex = r.file('ex.json', deadlineOut(r, ['record', '--expansions', '#1=0', '--limit', '15', '--now', NOW]));
  assert.equal(r.cmd('assign', '--line', LINE, '--record', ex, '--type', 'general-purpose').code, 2);
});

test('resume rebuilds the open tickets, their agents and a deadline scan plan from the state file alone', (t) => {
  const r = run(t);
  // #1 implementing with agent i1 in a worktree, #2 and #3 expanding under one agent, #4 delivered, #5 assigned
  // but not yet named, #6 stuck
  at(r, '#1', 'implementing');
  const wt = r.file('wt-rec.json', deadlineOut(r, ['record', '--worktree', process.cwd(), '--limit', '30', '--now', NOW]));
  r.ok('assign', '#1', '--record', wt, '--type', 'general-purpose', '--worktree', process.cwd());
  r.ok('agent', '#1', '--id', 'i1');
  r.ok('add', '#2', '#3', '--line', 'run-1/line-b');
  r.ok('stage', 'expanding', '#2', '#3');
  const ex = r.file('ex-rec.json', deadlineOut(r, ['record', '--expansions', '#2=0', '--expansions', '#3=0', '--limit', '15', '--now', NOW]));
  r.ok('assign', '#2', '#3', '--record', ex, '--type', 'sorry-matt:expander');
  r.ok('agent', '#2', '#3', '--id', 'e1');
  at(r, '#4', 'delivered');
  at(r, '#5', 'implementing');
  r.ok('assign', '#5', '--record', wt, '--type', 'general-purpose', '--worktree', process.cwd());
  r.ok('add', '#6', '--line', LINE);
  r.ok('stage', 'stuck', '#6');

  const res = r.ok('resume');
  assert.deepEqual(
    res.open.map((o) => [o.id, o.stage, o.agent && o.agent.id]),
    [['#1', 'implementing', 'i1'], ['#2', 'expanding', 'e1'], ['#3', 'expanding', 'e1'], ['#5', 'implementing', null]],
  );
  assert.deepEqual(res.terminal, { delivered: ['#4'], stuck: ['#6'], 'awaiting-ruling': [] });
  assert.deepEqual(res.unnamed, ['#5']);
  assert.deepEqual(res.inFlight.map((a) => [a.id, a.tickets]), [['i1', ['#1']], ['e1', ['#2', '#3']]]);
  assert.equal(res.inFlight[0].deadline, '2026-03-10T12:30:00Z');

  // The in-flight list is a deadline.mjs scan plan once the expansion agent gets its current counts.
  const agents = res.inFlight.map((a) => (a.id === 'e1' ? { ...a, expansions: { '#2': 1, '#3': 0 } } : a));
  const plan = r.file('scan.json', { agents });
  const scan = JSON.parse(deadlineOut(r, ['scan', plan, '--now', '2026-03-10T12:20:00Z']));
  assert.deepEqual(scan.agents.map((a) => [a.id, a.overdue, a.action]), [['i1', false, null], ['e1', true, 'extend']]);
});

// ---- lines: CI, local verification ---------------------------------------------------------------------------------

test('two dispatch points with an empty run list, and a branch that never ran, settle CI not covering it', (t) => {
  const r = run(t);
  r.ok('line', LINE, '--lines', 'line-a,line-c', '--tip', SHA1);
  const verdict = (v, reason = null) => r.file(`v-${v}.json`, { format: 'sorry-matt/ci@1', command: 'verdict', branch: LINE, sha: SHA1, verdict: v, reason, error: null, runs: [], rerun: [] });
  const empty = verdict('no-run', 'empty');
  const round = (n) => {
    const p = r.file(`p${n}.json`, { previous: null, tips: { [LINE]: SHA1 }, terminal: [], noProgress: 0, usage: { rounds: n - 1, spawns: 0, hours: 0 }, limits: { rounds: 40, spawns: 200, hours: 12, 'no-progress': 3 } });
    r.ok('progress', '--from', r.file(`po${n}.json`, deadlineOut(r, ['progress', p])));
  };
  round(1);
  assert.equal(r.ok('ci', LINE, '--from', empty, '--dispatch').noRun, 1);
  assert.equal(r.ok('ci', LINE, '--from', empty, '--dispatch').noRun, 1, 'the same dispatch point counts once');
  assert.equal(r.ok('ci', LINE, '--from', empty).noRun, 1, 'a read outside a dispatch point does not count');
  round(2);
  const second = r.ok('ci', LINE, '--from', empty, '--dispatch');
  assert.deepEqual([second.noRun, second.branchCheckNeeded, second.ciNotCovering], [2, true, false]);
  const ran = r.ok('ci', LINE, '--from', empty, '--dispatch', '--branch-runs', '1');
  assert.equal(ran.ciNotCovering, false);
  const settled = r.ok('ci', LINE, '--from', empty, '--dispatch', '--branch-runs', '0');
  assert.deepEqual([settled.ciNotCovering, settled.branchCheckNeeded], [true, false]);
  r.refused(/settled as CI not covering it/, 'ci', LINE, '--from', verdict('green'));
  assert.equal(r.ok('resume').lines[LINE].ciNotCovering, true);
});

test('any other verdict resets the empty-run count; a verdict for another branch is bad input', (t) => {
  const r = run(t);
  r.ok('line', LINE);
  const v = (verdict, reason = null, branch = LINE) => r.file(`v-${verdict}-${reason}-${branch.length}.json`, { format: 'sorry-matt/ci@1', command: 'verdict', branch, sha: SHA1, verdict, reason });
  r.ok('ci', LINE, '--from', v('no-run', 'empty'), '--dispatch');
  assert.equal(r.ok('ci', LINE, '--from', v('no-run', 'no-success')).noRun, 0);
  assert.equal(r.state().lines[LINE].ci.verdict, 'no-run');
  assert.equal(r.cmd('ci', LINE, '--from', v('green', null, 'other/branch')).code, 2);
});

test('local verification records: one per SHA, rendered as ledger lines', (t) => {
  const r = run(t);
  r.ok('line', LINE);
  const out = r.ok('local', LINE, SHA1, 'red', 'no-origin');
  assert.equal(out.line, `local: ${LINE} ${SHA1} red no-origin`);
  r.refused(/already has a local verification record \(red, no-origin\); reuse it/, 'local', LINE, SHA1, 'green', 'no-origin');
  r.ok('local', LINE, SHA2, 'green', 'no-verdict');
  assert.deepEqual(r.ok('resume').lines[LINE].local, [`local: ${LINE} ${SHA1} red no-origin`, `local: ${LINE} ${SHA2} green no-verdict`]);
  assert.equal(r.cmd('local', LINE, 'abc1234', 'green', 'no-origin').code, 2, 'a short SHA is bad input');
  r.refused(/not an integration branch/, 'local', 'nope', SHA1, 'green', 'no-origin');
});

// ---- usage and stopping ------------------------------------------------------------------------------------------

test('usage: start once, waiting time, hook spawn count, counters and hours', (t) => {
  const r = run(t);
  r.ok('usage', '--started', '2026-03-10T10:00:00Z', '--spawns', '4');
  assert.equal(r.state().usage.spawnsSource, 'host');
  r.refused(/the start is already 2026-03-10T10:00:00Z/, 'usage', '--started', '2026-03-10T11:00:00Z');
  writeFileSync(join(r.dir, 'run-1.counters.json'), JSON.stringify({ spawns: 7, agents: [] }));
  const out = r.ok('usage', '--wait', '1800', '--add', 'fullVerifications=1', '--add', 'compactions=2', '--sleep-task', 'b1', '--tokens', 'unknown', '--spawns', '99');
  assert.equal(out.usage.spawns, 7, 'the hook count wins over --spawns');
  assert.equal(out.usage.spawnsSource, 'counters');
  assert.deepEqual(out.progressUsage, { rounds: 0, spawns: 7, hours: 1.5 });
  assert.deepEqual([out.usage.fullVerifications, out.usage.compactions, out.usage.sleepTask, out.usage.tokens], [1, 2, 'b1', null]);
  assert.equal(r.ok('usage', '--sleep-task', 'none').usage.sleepTask, null);
  assert.equal(r.cmd('usage', '--add', 'reviewRounds=1').code, 2, 'counters the script keeps are not added by hand');
});

test('progress records the snapshot and rounds, then a stop, after which no dispatch point is recorded', (t) => {
  const r = run(t);
  r.ok('usage', '--started', '2026-03-10T11:00:00Z');
  const plan = (n, rounds) => r.file(`p${n}.json`, { previous: null, tips: { [LINE]: SHA1 }, terminal: ['#1'], noProgress: 0, usage: { rounds, spawns: 0, hours: 0 }, limits: { rounds: 2, spawns: 200, hours: 12, 'no-progress': 3 } });
  const first = r.ok('progress', '--from', r.file('o1.json', deadlineOut(r, ['progress', plan(1, 0)])));
  assert.equal(first.usage.rounds, 1);
  assert.deepEqual(first.usage.snapshot, { tips: { [LINE]: SHA1 }, terminal: ['#1'] });
  const stop = r.ok('progress', '--from', r.file('o2.json', deadlineOut(r, ['progress', plan(2, 2)])), '--note', 'hit rounds');
  assert.deepEqual(stop.stop, { at: NOW, stoppedBy: ['rounds'], usage: { rounds: 1, spawns: 0, hours: 1 }, note: 'hit rounds' });
  r.refused(/the run stopped at .* \(rounds\); there are no more dispatch points/, 'progress', '--from', r.file('o3.json', deadlineOut(r, ['progress', plan(3, 0)])));
});

// ---- import ----------------------------------------------------------------------------------------------------------

test('import takes over a ledger: seed rows, local lines from the ledger, the start note', (t) => {
  const r = run(t, { init: false });
  const seed = r.file('seed.json', {
    run: 'run-1',
    tickets: {
      '#1': { line: LINE, stage: 'delivered', merges: [SHA1] },
      '#2': { line: LINE, stage: 'queued', reviews: [{ mode: 'initial', verdict: 'pass' }] },
      '#3': { line: 'run-1/line-b', stage: 'implementing', snapshotSha256: SNAP },
    },
    usage: { rounds: 3 },
  });
  const ledger = r.file('run-1.md', [
    '<!-- sorry-matt:run active -->',
    `- local: ${LINE} ${SHA1} green no-origin`,
    `\`local: ${LINE} ${SHA1} red no-origin\``,
    `local: ${LINE} ${SHA2} red no-verdict`,
    'rule: /x/SKILL.md',
    'budget: spawns 200',
  ].join('\r\n'));
  const out = r.ok('import', '--from', seed, '--ledger', ledger);
  assert.deepEqual([out.tickets, out.lines, out.localRecords], [3, 2, 2]);
  const s = r.state();
  assert.deepEqual(s.lines[LINE].local.map((l) => [l.sha, l.result]), [[SHA1, 'green'], [SHA2, 'red']], 'the first record of a SHA wins');
  assert.equal(s.imported, NOW);
  assert.equal(s.usage.started, NOW);
  assert.match(s.usage.startedNote, /not counted/);
  assert.equal(s.usage.rounds, 3);
  r.ok('stage', 'integrating', '#2');
  r.ok('stage', 'in-review', '#3');
  r.refused(/already exists/, 'import', '--from', seed);
});

test('import refuses rows the guards would refuse', (t) => {
  for (const [ticket, re] of [
    [{ line: LINE, stage: 'queued' }, /queued needs a review recorded/],
    [{ line: LINE, stage: 'integrating', reviews: [{ mode: 'initial', verdict: 'fix' }] }, /latest review verdict to be pass; it is fix/],
    [{ line: LINE, stage: 'delivered' }, /delivered needs a merge SHA/],
  ]) {
    const r = run(t, { init: false });
    const out = r.cmd('import', '--from', r.file('seed.json', { run: 'run-1', tickets: { '#1': ticket } }));
    assert.equal(out.code, 3, out.err);
    assert.match(out.err, re);
    assert.equal(existsSync(r.path), false);
  }
  const r = run(t, { init: false });
  const relaxed = r.file('seed.json', { run: 'run-1', profile: { recheck: false }, tickets: { '#1': { line: LINE, stage: 'queued', reviews: [{ mode: 'initial', verdict: 'fix', findings: ['F1'] }], fixReports: [{ fixed: ['F1'], unfixed: [] }] } } });
  r.ok('import', '--from', relaxed);
  assert.equal(r.state().profile.recheck, false);
});

// ---- the file --------------------------------------------------------------------------------------------------------

test('a missing or corrupt state exits 1; bad arguments exit 2; nothing is printed', (t) => {
  const r = run(t, { init: false });
  for (const [code, setup, argv] of [
    [1, () => {}, ['show']],
    [1, () => writeFileSync(r.path, '{nope'), ['show']],
    [1, () => writeFileSync(r.path, JSON.stringify({ format: 'other' })), ['add', '#1', '--line', LINE]],
    [2, () => {}, ['nope']],
    [2, () => {}, ['stage', 'flying', '#1']],
    [2, () => {}, ['add', '#1', '--line', LINE, '--bogus', 'x']],
  ]) {
    setup();
    const out = r.cmd(...argv);
    assert.equal(out.code, code, `${argv.join(' ')}: ${out.err}`);
    assert.equal(out.out, '');
  }
});

test('keys a later script adds are kept on every write', (t) => {
  const r = run(t);
  r.ok('add', '#1', '--line', LINE);
  const s = r.state();
  s.checks = [{ gate: 'x' }];
  s.tickets['#1'].verifiedSha = SHA1;
  writeFileSync(r.path, JSON.stringify(s));
  r.ok('set', '#1', '--branch', 'run-1/01-x');
  const after = r.state();
  assert.deepEqual(after.checks, [{ gate: 'x' }]);
  assert.equal(after.tickets['#1'].verifiedSha, SHA1);
});

test('parallel writers through the CLI lose no update and leave no lock or temp file', async (t) => {
  const r = run(t);
  const N = 8;
  const one = () =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, [SCRIPT, 'usage', r.path, '--wait', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? done() : fail(new Error(`exit ${code}: ${err}`))));
    });
  await Promise.all(Array.from({ length: N }, one));
  const s = r.state();
  assert.equal(s.usage.waitingSeconds, N);
  assert.equal(s.revision, N);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(r.dir).sort(), ['run-1.state.json']);
});
