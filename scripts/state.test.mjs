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

test('review minimal: a minimal review passes; no review still blocks; the default needs a prove-it review', (t) => {
  const strict = run(t);
  at(strict, '#1', 'in-review');
  strict.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal');
  strict.refused(/needs a prove-it review \(profile review: full\), or a minimal review of a ticket whose review tier is light; the latest is a minimal review$/m, 'stage', 'queued', '#1');

  const r = run(t);
  r.ok('profile', '--review', 'minimal');
  at(r, '#1', 'in-review');
  r.refused(/queued needs a review recorded/, 'stage', 'queued', '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal');
  r.ok('stage', 'queued', '#1');
});

test('#139: under review: full a minimal review recorded with tier light lets the ticket queue; one of another tier does not', (t) => {
  const light = run(t);
  at(light, '#1', 'in-review');
  const out = light.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal', '--tier', 'light');
  assert.deepEqual(out.tickets['#1'].reviews.map((x) => [x.kind, x.tier, x.verdict]), [['minimal', 'light', 'pass']]);
  light.ok('stage', 'queued', '#1');

  for (const tier of ['standard', 'full']) {
    const r = run(t);
    at(r, '#1', 'in-review');
    r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--kind', 'minimal', '--tier', tier);
    r.refused(new RegExp(`or a minimal review of a ticket whose review tier is light; the latest is a minimal review \\(review tier ${tier}\\)`), 'stage', 'queued', '#1');
  }
  // a prove-it review records its tier too; without --tier it is null
  const full = run(t);
  at(full, '#1', 'in-review');
  assert.equal(full.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--tier', 'standard').tickets['#1'].reviews[0].tier, 'standard');
  const none = run(t);
  at(none, '#1', 'in-review');
  assert.equal(none.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass').tickets['#1'].reviews[0].tier, null);
  assert.equal(none.cmd('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--tier', 'huge').code, 2);
});

test('#142: review records the observations and pre-existing counts; without them both are 0', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1', '--observations', '2', '--pre-existing', '1');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass');
  const counts = r.state().tickets['#1'].reviews.map((x) => [x.mode, x.observations, x.preExisting]);
  assert.deepEqual(counts, [['initial', 2, 1], ['recheck', 0, 0]]);
  for (const bad of ['-1', 'two', '1.5']) {
    const out = r.cmd('review', '#1', '--mode', 'recheck', '--verdict', 'pass', '--observations', bad);
    assert.equal(out.code, 2, `--observations ${bad}`);
    assert.match(out.err, /--observations: expected a whole number/);
  }
  const out = r.cmd('review', '#1', '--mode', 'recheck', '--verdict', 'pass', '--pre-existing', 'x');
  assert.equal(out.code, 2);
  assert.match(out.err, /--pre-existing: expected a whole number/);
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

// ---- #188: the run's tracker, integrate ticket-pr, a ticket's own PR ---------------------------------------------

/** A fresh run whose init carries `--tracker <tracker>` (none: no flag). */
function tracked(t, tracker) {
  const r = run(t, { init: false });
  r.ok('init', '--run', 'run-1', ...(tracker ? ['--tracker', tracker] : []));
  return r;
}

test('#188: init records the tracker; without --tracker, and in an older file without the key, it is unknown', (t) => {
  assert.equal(tracked(t, 'github').state().tracker, 'github');
  const local = tracked(t, 'local');
  assert.equal(local.state().tracker, 'local');
  assert.equal(local.ok('resume').tracker, 'local');
  const none = tracked(t);
  assert.equal(none.state().tracker, null);
  assert.equal(none.ok('resume').tracker, null);
  assert.equal(run(t, { init: false }).cmd('init', '--run', 'run-1', '--tracker', 'gitlab').code, 2);

  const old = run(t);
  const s = old.state();
  delete s.tracker;
  writeFileSync(old.path, JSON.stringify(s));
  assert.equal(old.ok('show').tracker, null);
  assert.equal(old.ok('resume').tracker, null);
  old.ok('add', '#1', '--line', LINE);
  assert.equal('tracker' in old.state(), false, 'a write keeps an older file as it was');
});

test('#188: integrate ticket-pr is written on a github run only; local and unknown are refused (3) pointing to aggregate-pr', (t) => {
  const gh = tracked(t, 'github');
  assert.equal(gh.ok('profile', '--integrate', 'ticket-pr').profile.integrate, 'ticket-pr');
  assert.equal(gh.ok('resume').profile.integrate, 'ticket-pr');

  tracked(t, 'local').refused(/ticket-pr.*tracker is local.*aggregate-pr/, 'profile', '--integrate', 'ticket-pr');
  const none = tracked(t);
  none.refused(/ticket-pr.*tracker is unknown.*aggregate-pr/, 'profile', '--integrate', 'ticket-pr', '--review', 'minimal');
  assert.equal(none.state().profile, null);
  const old = run(t);
  const s = old.state();
  delete s.tracker;
  writeFileSync(old.path, JSON.stringify(s));
  old.refused(/tracker is unknown.*aggregate-pr/, 'profile', '--integrate', 'ticket-pr');

  // #201: the default follows the tracker — ticket-pr on GitHub; Local Markdown and an unknown tracker keep aggregate-pr
  for (const [tracker, want] of [['github', 'ticket-pr'], ['local', 'aggregate-pr']]) {
    const r = tracked(t, tracker);
    assert.equal(r.ok('resume').profile.integrate, want);
    assert.equal(r.ok('profile', '--review', 'minimal').profile.integrate, want);
  }
  const unknown = run(t);
  const u = unknown.state();
  delete u.tracker;
  writeFileSync(unknown.path, JSON.stringify(u));
  assert.equal(unknown.ok('resume').profile.integrate, 'aggregate-pr', 'a state from before #188 keeps aggregate-pr');
  assert.equal(tracked(t, 'github').ok('profile', '--integrate', 'aggregate-pr').profile.integrate, 'aggregate-pr', 'a GitHub run can still choose aggregate-pr');
  assert.equal(tracked(t, 'local').ok('profile', '--integrate', 'direct').profile.integrate, 'direct');
});

test('#188: import takes the tracker from the seed and judges a ticket-pr profile by it', (t) => {
  const seed = (r, body) => r.file('seed.json', { run: 'run-1', ...body });
  const gh = run(t, { init: false });
  gh.ok('import', '--from', seed(gh, { tracker: 'github', profile: { integrate: 'ticket-pr' } }));
  assert.deepEqual([gh.state().tracker, gh.state().profile.integrate], ['github', 'ticket-pr']);

  for (const [body, re] of [
    [{ tracker: 'local', profile: { integrate: 'ticket-pr' } }, /seed: .*ticket-pr.*tracker is local.*aggregate-pr/],
    [{ profile: { integrate: 'ticket-pr' } }, /seed: .*ticket-pr.*tracker is unknown.*aggregate-pr/],
  ]) {
    const r = run(t, { init: false });
    const out = r.cmd('import', '--from', seed(r, body));
    assert.equal(out.code, 3, out.err);
    assert.match(out.err, re);
    assert.equal(existsSync(r.path), false);
  }
  const bad = run(t, { init: false });
  assert.equal(bad.cmd('import', '--from', seed(bad, { tracker: 'gitlab' })).code, 2);
  assert.equal(existsSync(bad.path), false);

  const plain = run(t, { init: false });
  plain.ok('import', '--from', seed(plain, { tracker: 'local' }));
  assert.deepEqual([plain.state().tracker, plain.ok('resume').profile.integrate], ['local', 'aggregate-pr']);
  const none = run(t, { init: false });
  none.ok('import', '--from', seed(none, {}));
  assert.equal(none.state().tracker, null);
});

test('#188: set records a ticket PR, its stack parent and the tickets it waits on; show and resume list them', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '#3', '--line', LINE);
  assert.deepEqual(['pr', 'stackParent', 'waitingOn'].map((k) => r.state().tickets['#1'][k]), [null, null, []]);
  r.ok('set', '#2', '--pr', '42', '--stack-parent', '#1', '--waiting-on', '#1,#3');
  const t2 = r.state().tickets['#2'];
  assert.deepEqual([t2.pr, t2.stackParent, t2.waitingOn], [42, '#1', ['#1', '#3']]);
  const open = Object.fromEntries(r.ok('resume').open.map((o) => [o.id, [o.pr, o.stackParent, o.waitingOn]]));
  assert.deepEqual(open, { '#1': [null, null, []], '#2': [42, '#1', ['#1', '#3']], '#3': [null, null, []] });
  const shown = r.ok('show').tickets['#2'];
  assert.deepEqual([shown.pr, shown.stackParent, shown.waitingOn], [42, '#1', ['#1', '#3']]);
  r.ok('set', '#2', '--stack-parent', 'none', '--waiting-on', 'none');
  const cleared = r.state().tickets['#2'];
  assert.deepEqual([cleared.pr, cleared.stackParent, cleared.waitingOn], [42, null, []]);

  // each must be another ticket of this run: refused (3), the file unchanged
  r.refused(/#2: stackParent names #9, which is not a ticket of this run/, 'set', '#2', '--stack-parent', '#9');
  r.refused(/#2: stackParent names the ticket itself/, 'set', '#2', '--stack-parent', '#2');
  r.refused(/#2: waitingOn names the ticket itself/, 'set', '#2', '--waiting-on', '#1,#2');
  r.refused(/#2: waitingOn names #9, which is not a ticket of this run/, 'set', '#2', '--waiting-on', '#1,#9', '--pr', '7');
  for (const argv of [['--pr', '0'], ['--pr', 'abc'], ['--pr', '4.5'], ['--waiting-on', '#1,#1'], ['--waiting-on', ','], ['--stack-parent', 'a b']]) {
    const out = r.cmd('set', '#2', ...argv);
    assert.equal(out.code, 2, `${argv.join(' ')}: ${out.err}`);
  }
  assert.equal(r.state().tickets['#2'].pr, 42);
});

test('#188: an older file without the PR fields reads them as null, null and []; bad values are not a state file', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '--line', LINE);
  const s = r.state();
  for (const k of ['pr', 'stackParent', 'waitingOn']) delete s.tickets['#1'][k];
  writeFileSync(r.path, JSON.stringify(s));
  const shown = r.ok('show').tickets['#1'];
  assert.deepEqual([shown.pr, shown.stackParent, shown.waitingOn], [null, null, []]);
  const open = r.ok('resume').open.find((o) => o.id === '#1');
  assert.deepEqual([open.pr, open.stackParent, open.waitingOn], [null, null, []]);
  r.ok('set', '#1', '--pr', '5');
  assert.equal(r.state().tickets['#1'].pr, 5);

  for (const [k, v] of [['pr', 'x'], ['pr', 0], ['stackParent', '#9'], ['stackParent', '#1'], ['waitingOn', '#2'], ['waitingOn', ['#2', '#2']], ['waitingOn', ['#7']]]) {
    const bad = structuredClone(s);
    bad.tickets['#1'][k] = v;
    writeFileSync(r.path, JSON.stringify(bad));
    const out = r.cmd('show');
    assert.equal(out.code, 1, `${k} ${JSON.stringify(v)}: ${out.err}`);
    assert.match(out.err, /tickets\.#1/);
  }
});

// ---- assignments and resuming ------------------------------------------------------------------------------------

test('#156: review records the finding counts and the tier reasons; without them both are null', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--tier', 'full', '--tier-reason', 'sensitive', '--tier-reason', 'over-lines', '--findings', 'F1', '--candidates', '7', '--confirmed', '3', '--invalid', '4', '--blocking', '1');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass');
  const reviews = r.state().tickets['#1'].reviews.map((x) => [x.mode, x.tierReasons, x.findingCounts]);
  assert.deepEqual(reviews, [
    ['initial', ['sensitive', 'over-lines'], { candidates: 7, confirmed: 3, invalid: 4, blocking: 1 }],
    ['recheck', null, null],
  ]);
  // the four counts go together, each a whole number; the reasons go with the tier they explain
  const bad = (args, re) => {
    const out = r.cmd('review', '#1', '--mode', 'recheck', '--verdict', 'pass', ...args);
    assert.equal(out.code, 2, args.join(' '));
    assert.match(out.err, re);
  };
  bad(['--candidates', '1', '--confirmed', '1'], /--candidates, --confirmed, --invalid and --blocking go together/);
  bad(['--candidates', '-1', '--confirmed', '0', '--invalid', '0', '--blocking', '0'], /--candidates: expected a whole number/);
  bad(['--tier-reason', 'default'], /--tier-reason goes with --tier/);
  assert.equal(r.state().tickets['#1'].reviews.length, 2, 'nothing more recorded');
});

test('#173: --tier-reason is given once per reason and kept whole; the old comma-joined --tier-reasons is gone', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  const before = readFileSync(r.path, 'utf8');
  const bad = (args, re) => {
    const out = r.cmd('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--tier', 'full', ...args);
    assert.equal(out.code, 2, args.join(' '));
    assert.match(out.err, re);
    assert.equal(readFileSync(r.path, 'utf8'), before, 'the state file is unchanged');
  };
  bad(['--tier-reasons', 'sensitive,default'], /unknown flag --tier-reasons/);
  bad(['--tier-reason', 'sensitive', '--tier-reason', ''], /--tier-reason: expected a reason/);
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--tier', 'full', '--tier-reason', 'sensitive', '--tier-reason', 'src/x.mjs#a b', '--tier-reason', 'c,d');
  assert.deepEqual(r.state().tickets['#1'].reviews[0].tierReasons, ['sensitive', 'src/x.mjs#a b', 'c,d']);
  assert.deepEqual(r.ok('show').tickets['#1'].reviews[0].tierReasons, ['sensitive', 'src/x.mjs#a b', 'c,d'], 'and it loads back');
});

test('#173: review refuses finding counts that cannot add up (2, the file unchanged); equal bounds are recorded', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  const counts = (candidates, confirmed, invalid, blocking) => ['--candidates', `${candidates}`, '--confirmed', `${confirmed}`, '--invalid', `${invalid}`, '--blocking', `${blocking}`];
  const before = readFileSync(r.path, 'utf8');
  const bad = (args, re) => {
    const out = r.cmd('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1', ...args);
    assert.equal(out.code, 2, args.join(' '));
    assert.equal(out.out, '');
    assert.match(out.err, re);
    assert.equal(readFileSync(r.path, 'utf8'), before, 'the state file is unchanged');
  };
  bad(counts(5, 3, 3, 1), /confirmed \+ invalid \(3 \+ 3\) is more than candidates \(5\)/);
  bad(counts(5, 2, 2, 3), /blocking \(3\) is more than confirmed \(2\)/);
  bad(counts(0, 0, 1, 0), /confirmed \+ invalid \(0 \+ 1\) is more than candidates \(0\)/);
  // at the bounds: every candidate ruled on, every confirmed finding blocking (a recheck's candidates=confirmed=blocking)
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1', ...counts(5, 2, 3, 2));
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'fix', '--findings', 'F1', ...counts(1, 1, 0, 1));
  assert.deepEqual(r.state().tickets['#1'].reviews.map((x) => x.findingCounts), [
    { candidates: 5, confirmed: 2, invalid: 3, blocking: 2 },
    { candidates: 1, confirmed: 1, invalid: 0, blocking: 1 },
  ]);
});

test('#173: a state file holding finding counts that cannot add up is not a state file (1), naming the review', (t) => {
  const r = run(t);
  at(r, '#1', 'in-review');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'fix', '--findings', 'F1', '--candidates', '4', '--confirmed', '2', '--invalid', '2', '--blocking', '1');
  r.ok('stage', 'fixing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass', '--candidates', '0', '--confirmed', '0', '--invalid', '0', '--blocking', '0');
  const good = r.state();
  const edited = (i, findingCounts) => {
    const s = structuredClone(good);
    s.tickets['#1'].reviews[i].findingCounts = findingCounts;
    writeFileSync(r.path, JSON.stringify(s));
  };
  for (const [i, findingCounts, re] of [
    [0, { candidates: 3, confirmed: 2, invalid: 2, blocking: 1 }, /tickets\.#1\.reviews\[0\] has findingCounts where confirmed \+ invalid \(2 \+ 2\) is more than candidates \(3\)/],
    [1, { candidates: 1, confirmed: 0, invalid: 0, blocking: 1 }, /tickets\.#1\.reviews\[1\] has findingCounts where blocking \(1\) is more than confirmed \(0\)/],
  ]) {
    edited(i, findingCounts);
    for (const out of [r.cmd('show'), r.cmd('stage', 'queued', '#1')]) {
      assert.equal(out.code, 1, out.err);
      assert.equal(out.out, '');
      assert.match(out.err, re);
    }
  }
  // the bounds themselves are a state file
  edited(1, { candidates: 2, confirmed: 2, invalid: 0, blocking: 2 });
  assert.equal(r.cmd('show').code, 0);
});

test('#156: an extension counts on each ticket it covers; a ticket never extended has 0', (t) => {
  const r = run(t);
  const rec = r.file('rec.json', deadlineOut(r, ['record', '--expansions', '#1=0', '--expansions', '#2=1', '--limit', '15', '--now', NOW]));
  r.ok('add', '#1', '#2', '#3', '--line', LINE);
  r.ok('stage', 'expanding', '#1', '#2');
  r.ok('assign', '#1', '#2', '--record', rec, '--type', 'sorry-matt:expander');
  r.ok('extend', '#1', '#2', '--deadline', '2026-03-10T12:30:00Z');
  r.ok('release', '#1', '#2', '--stopped');
  r.ok('assign', '#1', '--record', rec, '--type', 'sorry-matt:expander', '--reassign');
  r.ok('extend', '#1', '--deadline', '2026-03-10T12:50:00Z');
  const s = r.state();
  assert.deepEqual(['#1', '#2', '#3'].map((id) => s.tickets[id].timeoutExtensions), [2, 1, 0]);
  assert.equal(s.usage.timeoutExtensions, 2, 'one per agent');
  assert.equal(r.ok('show').revision, s.revision, 'the state still checks');
});

test('#171: extend leaves an imported ticket with no count of its own without one; a seeded count goes up by one', (t) => {
  const r = run(t, { init: false });
  const seed = r.file('seed.json', { run: 'run-1', usage: { timeoutExtensions: 2 }, tickets: { '#1': { line: LINE, stage: 'expanding' }, '#2': { line: LINE, stage: 'expanding', timeoutExtensions: 1 } } });
  r.ok('import', '--from', seed);
  const rec = r.file('rec.json', deadlineOut(r, ['record', '--expansions', '#1=0', '--expansions', '#2=0', '--limit', '15', '--now', NOW]));
  r.ok('assign', '#1', '#2', '--record', rec, '--type', 'sorry-matt:expander');
  r.ok('extend', '#1', '#2', '--deadline', '2026-03-10T12:30:00Z');
  const s = r.state();
  assert.equal('timeoutExtensions' in s.tickets['#1'], false, 'the seed gave no count for #1: still none');
  assert.equal(s.tickets['#2'].timeoutExtensions, 2);
  assert.equal(s.usage.timeoutExtensions, 3, 'the run counts the extension either way');
  assert.equal(r.ok('show').revision, s.revision, 'the state still checks');
});

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
  r.refused(/a timeout reassignment is for implementing, fixing, expanding, in-review; it is candidate/, 'assign', '#3', '--record', rec, '--type', 'x', '--reassign');
});

test('#143: a review host is reassigned once for a timeout in in-review; a state from before the count reads it as 0', (t) => {
  const r = run(t);
  const rec = r.file('rec.json', deadlineOut(r, ['record', '--worktree', process.cwd(), '--limit', '60', '--now', NOW]));
  at(r, '#1', 'in-review');
  assert.equal(r.state().tickets['#1'].timeoutReassignments['in-review'], 0, 'a new ticket counts in-review too');
  // a state written before in-review was counted: the key is missing, and the file still loads
  const s = r.state();
  delete s.tickets['#1'].timeoutReassignments['in-review'];
  writeFileSync(r.path, JSON.stringify(s));
  r.ok('assign', '#1', '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd());
  r.ok('agent', '#1', '--id', 'rv1');
  r.ok('release', '#1', '--stopped');
  r.ok('assign', '#1', '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd(), '--reassign');
  assert.equal(r.state().tickets['#1'].timeoutReassignments['in-review'], 1);
  r.ok('release', '#1', '--stopped');
  r.refused(/already reassigned for a timeout in in-review/, 'assign', '#1', '--record', rec, '--type', 'general-purpose', '--worktree', process.cwd(), '--reassign');
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
  // #156: a line's extension counts for the run only, on no line or ticket
  assert.equal(r.state().lines[LINE].timeoutExtensions, undefined);
  assert.equal(r.state().tickets['#1'].timeoutExtensions, 0);
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

// ---- bundles (#205) ------------------------------------------------------------------------------------------------

test('bundle folds members into the lead; a member is then named by its lead', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '#3', '--line', LINE);
  const out = r.ok('bundle', '#1', '#3', '#2');
  assert.deepEqual(out.tickets['#1'].members, ['#3', '#2']);
  assert.deepEqual(Object.keys(r.state().tickets), ['#1']);
  r.refused(/member of bundle #1: name its lead/, 'stage', 'implementing', '#2');
  r.refused(/already a member of bundle #1/, 'add', '#3', '--line', LINE);
  const res = r.ok('resume');
  assert.deepEqual(res.bundles, { '#1': ['#3', '#2'] });
  assert.deepEqual(res.open[0].members, ['#3', '#2']);
  // the lead goes the whole path for all of them
  r.ok('set', '#1', '--snapshot', SNAP);
  r.ok('stage', 'implementing', '#1');
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'initial', '--verdict', 'pass', '--observations', '1', '--covered', '2');
  assert.equal(r.state().tickets['#1'].reviews[0].covered, 2);
});

test('bundle is refused once a ticket left candidate, across lines, twice, or for an unknown ticket', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '#4', '--line', LINE);
  r.ok('add', '#3', '--line', 'run-1/line-b');
  r.refused(/on run-1\/line-b, the lead on run-1\/line-a/, 'bundle', '#1', '#3');
  r.refused(/not a ticket of this run/, 'bundle', '#1', '#9');
  r.ok('set', '#2', '--snapshot', SNAP);
  r.ok('stage', 'implementing', '#2');
  r.refused(/never left candidate can be bundled; it is implementing/, 'bundle', '#1', '#2');
  r.ok('bundle', '#1', '#4');
  r.ok('add', '#5', '--line', LINE);
  r.refused(/already leads bundle/, 'bundle', '#1', '#5');
  assert.equal(r.cmd('bundle', '#1').code, 2);
  assert.equal(r.cmd('review', '#2', '--mode', 'initial', '--verdict', 'pass', '--covered', 'x').code, 2);
});

test('a state whose members are also tickets, or in two bundles, is not a state file', (t) => {
  const r = run(t);
  r.ok('add', '#1', '#2', '--line', LINE);
  const s = r.state();
  s.tickets['#1'].members = ['#2'];
  writeFileSync(r.path, JSON.stringify(s));
  assert.equal(r.cmd('show').code, 1);
  delete s.tickets['#2'];
  s.tickets['#3'] = { ...s.tickets['#1'], members: ['#2'] };
  writeFileSync(r.path, JSON.stringify(s));
  assert.equal(r.cmd('show').code, 1);
});

// ---- #196: the ticket-pr merge path's stages awaiting-ci and awaiting-merge ----------------------------------------

/** A GitHub run under integrate: ticket-pr (plus any other profile fields). */
function ticketPrRun(t, profileArgs = []) {
  const r = run(t, { init: false });
  r.ok('init', '--run', 'run-1', '--tracker', 'github');
  r.ok('profile', '--integrate', 'ticket-pr', ...profileArgs);
  return r;
}

test('#196: integrating → awaiting-ci → awaiting-merge → delivered, the merge SHA recorded in awaiting-merge', (t) => {
  const r = ticketPrRun(t);
  at(r, '#1', 'integrating');
  r.ok('stage', 'awaiting-ci', '#1');
  r.ok('stage', 'awaiting-merge', '#1');
  r.refused(/delivered needs a merge SHA.*left-for-human/s, 'stage', 'delivered', '#1');
  r.ok('merge', '#1', SHA1);
  const out = r.ok('stage', 'delivered', '#1');
  assert.equal(out.tickets['#1'].stage, 'delivered');
  assert.deepEqual(
    out.tickets['#1'].history.map((h) => h.to),
    ['implementing', 'in-review', 'queued', 'integrating', 'awaiting-ci', 'awaiting-merge', 'delivered'],
  );
});

test('#196: a left-for-human record stands in for the merge SHA under ticket-pr, and `none` clears it', (t) => {
  const r = ticketPrRun(t);
  at(r, '#1', 'integrating');
  r.ok('stage', 'awaiting-ci', '#1');
  r.ok('stage', 'awaiting-merge', '#1');
  r.ok('set', '#1', '--left-for-human', 'PR 11 is ready; a person merges it');
  assert.equal(r.state().tickets['#1'].leftForHuman, 'PR 11 is ready; a person merges it');
  r.ok('set', '#1', '--left-for-human', 'none');
  assert.equal(r.state().tickets['#1'].leftForHuman, null);
  r.refused(/delivered needs a merge SHA/, 'stage', 'delivered', '#1');
  r.ok('set', '#1', '--left-for-human', 'left for a person');
  const out = r.ok('stage', 'delivered', '#1');
  assert.equal(out.tickets['#1'].stage, 'delivered');
  assert.deepEqual(out.tickets['#1'].merges, []);
});

test('#196: awaiting-ci → fixing needs no review verdict (the red PR head is the reason) but still counts the round', (t) => {
  const r = ticketPrRun(t);
  at(r, '#1', 'integrating');
  r.ok('stage', 'awaiting-ci', '#1');
  const out = r.ok('stage', 'fixing', '#1', '--reason', 'the PR head is red');
  assert.equal(out.tickets['#1'].fixRounds, 1);
  // the round goes back through in-review as ever
  r.ok('stage', 'in-review', '#1');
  r.ok('review', '#1', '--mode', 'recheck', '--verdict', 'pass');
  r.ok('stage', 'queued', '#1');
});

test('#196: awaiting-ci → fixing stays under the fix-round cap', (t) => {
  const r = ticketPrRun(t, ['--fixRounds', '0']);
  at(r, '#1', 'integrating');
  r.ok('stage', 'awaiting-ci', '#1');
  r.refused(/0 of 0 fix rounds used/, 'stage', 'fixing', '#1');
});

test('#196: the two waiting stages take awaiting-ruling and stuck, and refuse every non-edge', (t) => {
  const r = ticketPrRun(t);
  at(r, '#1', 'integrating');
  r.ok('stage', 'awaiting-ci', '#1');
  r.refused(/no edge awaiting-ci → delivered/, 'stage', 'delivered', '#1');
  r.refused(/no edge awaiting-ci → queued/, 'stage', 'queued', '#1');
  r.refused(/no edge awaiting-ci → integrating/, 'stage', 'integrating', '#1');
  r.ok('stage', 'awaiting-merge', '#1');
  r.refused(/no edge awaiting-merge → fixing/, 'stage', 'fixing', '#1');
  r.refused(/no edge awaiting-merge → awaiting-ci/, 'stage', 'awaiting-ci', '#1');
  r.ok('stage', 'stuck', '#1', '--reason', 'parked');

  at(r, '#2', 'queued');
  r.refused(/no edge queued → awaiting-ci/, 'stage', 'awaiting-ci', '#2');
  r.refused(/no edge queued → awaiting-merge/, 'stage', 'awaiting-merge', '#2');
  r.ok('stage', 'integrating', '#2');
  r.ok('stage', 'awaiting-ci', '#2');
  const out = r.ok('stage', 'awaiting-ruling', '#2', '--reason', 'ruling');
  assert.equal(out.tickets['#2'].stage, 'awaiting-ruling');
});

test('#196: awaiting-ci and awaiting-merge are refused outside integrate: ticket-pr', (t) => {
  const r = run(t);
  at(r, '#1', 'integrating');
  r.refused(/awaiting-ci is the ticket-pr merge path.*aggregate-pr/, 'stage', 'awaiting-ci', '#1');
});

test('#196: merge is still refused before integrating, and import takes the waiting stages under their guards', (t) => {
  const r = ticketPrRun(t);
  at(r, '#1', 'queued');
  r.refused(/recorded in integrating or awaiting-merge/, 'merge', '#1', SHA1);

  // an imported awaiting-merge ticket passes the queued guard (a passing review) like queued and integrating do
  const gh = run(t, { init: false });
  const seed = gh.file('seed.json', {
    run: 'run-1',
    tracker: 'github',
    profile: { integrate: 'ticket-pr' },
    tickets: {
      '#1': { line: LINE, stage: 'awaiting-merge', snapshotSha256: SNAP, reviews: [{ mode: 'initial', verdict: 'pass' }] },
    },
  });
  gh.ok('import', '--from', seed);
  assert.equal(gh.state().tickets['#1'].stage, 'awaiting-merge');
  const bad = run(t, { init: false });
  const badSeed = bad.file('bad.json', {
    run: 'run-1',
    tracker: 'github',
    profile: { integrate: 'ticket-pr' },
    tickets: { '#1': { line: LINE, stage: 'awaiting-ci', snapshotSha256: SNAP } },
  });
  const res = bad.cmd('import', '--from', badSeed);
  assert.equal(res.code, 3, res.err);
  assert.match(res.err, /queued needs a review/);
});

// ---- #198: waiting-upstream, the wait for unmerged upstreams under ticket-pr ----------------------------------------

test('#198: candidate → waiting-upstream needs waitingOn, and back to candidate only once it is cleared; ticket-pr only', (t) => {
  const r = ticketPrRun(t);
  r.ok('add', '#1', '#2', '--line', LINE);
  r.refused(/waiting-upstream needs the upstreams it waits on recorded/, 'stage', 'waiting-upstream', '#2');
  r.ok('set', '#2', '--waiting-on', '#1');
  const out = r.ok('stage', 'waiting-upstream', '#2');
  assert.equal(out.tickets['#2'].stage, 'waiting-upstream');
  assert.deepEqual(r.cmd('resume').code, 0);
  assert.deepEqual(JSON.parse(r.cmd('resume').out).open.find((x) => x.id === '#2').waitingOn, ['#1'], 'resume shows what it waits on');
  r.refused(/still waits on #1/, 'stage', 'candidate', '#2');
  r.refused(/no edge waiting-upstream → implementing/, 'stage', 'implementing', '#2');
  r.ok('set', '#2', '--waiting-on', 'none');
  assert.equal(r.ok('stage', 'candidate', '#2').tickets['#2'].stage, 'candidate');

  const a = run(t);
  a.ok('add', '#1', '#2', '--line', LINE);
  a.ok('set', '#2', '--waiting-on', '#1');
  a.refused(/waiting-upstream is the ticket-pr merge path/, 'stage', 'waiting-upstream', '#2');
});
