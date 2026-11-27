// node --test scripts/tick-run.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: tick.mjs run: its execs, its output and what it leaves to the host (#129, #146, #147).
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as tick, defaultDeps, bashExecutor, bashUsable } from '../src/skills/get-to-work/scripts/tick.mjs';
import { main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { LINE, git, write, Crash, BASH, NO_BASH, world, ids, distinct, stage, unmatchedRed, ciFixSpawns } from './tick-world.mjs';
// ---- #129: tick.mjs run ----------------------------------------------------------------------------------------------

/** One `run` output, which must have exited 0 with nothing on stderr. */
const runOut = (h, ...args) => {
  const r = h.runTick(...args);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  return JSON.parse(r.out);
};
/** An exec run leaves to the host: one tick marks `host`, a push to a protected branch (#146). */
const leftForHost = (a) => a.kind === 'exec' && a.host === true;

test('#129: run checks its arguments as next does; with no exec to run it lists what next lists, and ran is []', (t) => {
  const h = world(t);
  for (const args of [['--bogus', 'x'], ['--reported'], ['extra.json']]) {
    const r = h.runTick(...args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`);
    assert.equal(r.out, '');
  }
  const none = tick(['run'], { ...defaultDeps(), execute: () => assert.fail('nothing runs') });
  assert.equal(none.code, 2);
  assert.equal(none.out, '');
  // an interrupted spawn: batch 1 is a spawn-check judge, so nothing runs and run lists what next lists
  h.crashAfter = (a) => a.kind === 'spawn';
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const plain = JSON.parse(h.tick('next', h.path).out);
  assert.ok(plain.actions.filter((a) => a.batch === 1).every((a) => a.kind !== 'exec'), 'batch 1 holds no exec');
  h.execute = () => assert.fail('nothing runs');
  const out = runOut(h);
  assert.equal(out.format, 'sorry-matt/tick@1');
  assert.equal(out.command, 'run');
  assert.deepEqual(out.ran, []);
  assert.deepEqual(ids(out.actions), ids(plain.actions));
  for (const k of ['run', 'wakeup', 'now', 'profile', 'reports', 'reconcile', 'dispatch', 'wrote', 'fallback', 'then']) assert.ok(k in out, `${k} is in the output`);
});

test('#129: run goes from the dispatch point to the first implementation spawn, each exec recorded with its exit', (t) => {
  const h = world(t);
  const seen = [];
  h.execute = (a) => {
    seen.push(a.id);
    return { code: h.exec(a) };
  };
  let out = null;
  const ran = [];
  const implement = (o) => o.actions.find((a) => a.kind === 'spawn' && a.batch === 1 && a.spawn.description.startsWith('implement '));
  for (let i = 0; i < 20; i += 1) {
    out = runOut(h);
    ran.push(...out.ran);
    if (implement(out)) break;
    h.run(out.actions); // a judge on the way: the host settles it and runs run again
  }
  assert.ok(ran.length > 5, 'run ran the dispatch point');
  assert.deepEqual(ran.map((x) => x.id), seen, 'in list order, each once');
  const st = h.state();
  for (const x of ran) {
    assert.equal(st.tick.done[x.id].exit, x.exit, `${x.id} recorded with its exit`);
    assert.equal(x.exit, 0);
    assert.equal(dirname(x.log), join(h.W, 'tick', 'run'));
    assert.ok(basename(x.log).endsWith('.log'));
  }
  assert.equal(new Set(ran.map((x) => x.log)).size, ran.length, 'one log per exec');
  const left = new Set(ids(out.actions));
  assert.ok(!out.ran.some((x) => left.has(x.id)), 'no exec it ran is still listed');
  assert.ok(out.actions.filter((a) => a.batch === 1 && a.kind === 'exec').every(leftForHost), 'batch 1 holds no exec but one the guard classifies');
  const spawn = implement(out);
  assert.ok(spawn, 'an implementation spawn');
  assert.equal(spawn.spawn.subagent_type, 'sorry-matt:implementer');
  assert.equal(stage(h, spawn.tickets[0]), 'implementing');
});

test('#129: a spawn at batch 1 stops run after that list; a spawn at batch 2 comes out at batch 1 as a spawn, never a spawn-check', (t) => {
  const h = world(t);
  h.acceptance['#2'] = { items: [], expansions: [] }; // #2's expansion spawn comes up while #1's chain still has execs
  const mixed = []; // batch-1 execs run while a background spawn of the same list was at batch 1, not recorded
  const late = new Set(); // background spawns listed behind an exec run
  h.execute = (a) => {
    const st = h.state().tick;
    for (const [id, x] of Object.entries(st.issued)) {
      if (x.kind !== 'spawn' || x.step !== 'spawn' || st.done[id]) continue;
      if (x.batch === 1) mixed.push({ exec: a.id, spawn: id });
      else late.add(id);
    }
    return { code: h.exec(a) };
  };
  const outs = [];
  for (let i = 0; i < 6 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) outs.push(...h.runWake());
  assert.equal(outs.at(-1).then, 'done');
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  assert.ok(!outs.some((o) => o.actions.some((a) => a.step === 'spawn-check')), 'no output carries a spawn-check');
  assert.ok(mixed.length, 'a list held a spawn and an exec at batch 1');
  for (const m of mixed) {
    const out = outs.find((o) => o.ran.some((x) => x.id === m.exec));
    const spawn = out.actions.find((a) => a.id === m.spawn);
    assert.equal(spawn?.kind, 'spawn', `${m.spawn} is listed as a spawn after ${m.exec} ran`);
    assert.equal(spawn.batch, 1);
    assert.ok(!out.actions.some((x) => x.id === m.exec), `${m.exec}, which run ran, is not listed beside it`);
  }
  assert.ok(late.size, 'a spawn was listed behind an exec');
  for (const id of late) {
    const out = outs.find((o) => o.actions.some((a) => a.id === id && a.batch === 1));
    assert.ok(out, `${id} came out at batch 1`);
    assert.equal(out.actions.find((a) => a.id === id).kind, 'spawn');
  }
  const spawned = h.log.filter((a) => a.kind === 'spawn' && a.step === 'spawn').map((a) => a.spawn.description).sort();
  assert.deepEqual(spawned, ['expand #2', 'implement #1', 'implement #2'], 'each spawn once');
});

test('#129: an exit not in okExit is recorded once and run stops at its failed judge; an okExit exit other than 0 goes on', (t) => {
  const h = world(t);
  const exec = h.exec;
  let failed = 0;
  h.exec = (a) => {
    if (a.step !== 'frontier') return exec(a);
    failed += 1;
    return 1;
  };
  let out = null;
  for (let i = 0; i < 10 && !out?.actions.some((a) => a.step === 'failed'); i += 1) {
    out = runOut(h);
    if (!out.actions.some((a) => a.step === 'failed')) h.run(out.actions);
  }
  const judged = out.actions.find((a) => a.id === 'failed:frontier:r1');
  assert.ok(judged && judged.kind === 'judge' && judged.batch === 1, 'the failed judge is listed');
  const ran = out.ran.filter((x) => x.id === 'frontier:r1');
  assert.equal(ran.length, 1, 'run did not retry it');
  assert.equal(ran[0].exit, 1);
  assert.equal(failed, 1);
  assert.equal(h.state().tick.done['frontier:r1'].exit, 1, 'recorded as it exited');
  assert.ok(judged.do.includes(ran[0].log), 'the judge names the log file');

  // exit 4 of a conflicting merge is in okExit: recorded, and run goes on to the merge agent
  const c = world(t);
  c.work = (agent, tid) => {
    const wt = c.state().tickets[tid].assignment?.worktree;
    write(join(wt, 'same.txt'), `${tid}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `work on ${tid}`);
    c.reportsNext.push(agent);
  };
  c.runWake();
  c.policy['merge-agent'] = () => ({ outcome: 'spawned', agent: `a${++c.agents}` });
  const outs = c.runWake();
  const conflict = outs.flatMap((o) => o.ran).find((x) => x.id.startsWith('merge:') && x.exit === 4);
  assert.ok(conflict, 'a merge exited 4');
  assert.equal(c.state().tick.done[conflict.id].exit, 4);
  const after = outs.find((o) => o.ran.includes(conflict));
  assert.ok(after.actions.some((a) => a.step === 'merge-agent' && a.batch === 1), 'run went on to the list after it: the merge agent');
  assert.ok(!after.actions.some((a) => a.step === 'failed'));
});

test('#129: run stops at then end without recording wakeup-end, and at then done', (t) => {
  const h = world(t);
  let out = null;
  for (let i = 0; i < 20 && out?.then !== 'end'; i += 1) {
    out = runOut(h);
    if (out.then !== 'end') h.run(out.actions);
  }
  assert.equal(out.then, 'end');
  const end = out.actions.at(-1);
  assert.equal(end.step, 'wakeup-end');
  const st = h.state().tick;
  assert.equal(st.done[end.id], undefined, 'wakeup-end is left to the host');
  assert.equal(st.wakeup, 1);
  assert.equal(runOut(h).then, 'end', 'run again: the same end');
  assert.equal(h.state().tick.wakeup, 1);
  h.run(out.actions);
  assert.equal(h.untilDone(h.runWake).then, 'done');
  const done = runOut(h);
  assert.equal(done.then, 'done');
  assert.deepEqual(done.ran, []);
});

// run keeps the git view of one list for the next while the execs run in between leave git as it was (each git process
// costs 120-150 ms on Windows): a list reads git again only after an exec that may have changed it.
const KEEPS_GIT = new Set(['state.mjs', 'deadline.mjs', 'brief.mjs', 'overlap.mjs', 'ci.mjs', 'frontier.mjs', 'acceptance.mjs', 'merge-gate.mjs', 'tier.mjs']);
const keepsGit = (a) => a.argv[0] === 'gh' || (a.argv[0] === 'node' && KEEPS_GIT.has(basename(a.argv[1])));
test('run reads git once for the lists whose execs leave it as it was, and again after an exec that may change it', (t) => {
  const h = world(t);
  const deps = defaultDeps();
  const runs = [];
  h.runTick = (...args) => {
    const seen = { views: 0, changes: new Set() };
    const git = (cwd, gitArgs, env) => {
      if (gitArgs[0] === 'for-each-ref') seen.views += 1; // the one query each git view starts with
      return deps.git(cwd, gitArgs, env);
    };
    const execute = (a) => {
      if (!keepsGit(a)) seen.changes.add(a.id);
      return { code: h.exec(a) };
    };
    const r = tick(['run', h.path, ...args, '--now', h.iso()], { ...deps, git, execute });
    if (r.code === 0) runs.push({ ...seen, lists: JSON.parse(r.out).lists });
    return r;
  };
  h.runWake();
  const lists = runs.reduce((n, x) => n + x.lists.length, 0);
  assert.ok(runs.some((x) => x.changes.size > 0), 'an exec that changes git ran (a ticket branch)');
  for (const [i, x] of runs.entries()) {
    const rebuilt = x.lists.slice(0, -1).filter((l) => l.ran.some((id) => x.changes.has(id))).length;
    assert.equal(x.views, 1 + rebuilt, `run ${i + 1}: one view, and one more after each list that ran an exec that changes git`);
  }
  assert.ok(runs.reduce((n, x) => n + x.views, 0) < lists, `fewer views than the ${lists} lists`);
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['implementing', 'implementing']);
});

test('#129: run leaves a push to the host: integrate: direct lists push:main as an exec, and origin main is not pushed', (t) => {
  const h = world(t, { profile: { integrate: 'direct' } });
  let out = null;
  const hasPush = (o) => o?.actions.some((a) => a.step === 'push');
  for (let i = 0; i < 6 && !hasPush(out); i += 1) {
    const outs = [];
    h.now += 5 * 60_000;
    const reports = h.reportsNext.splice(0);
    for (let k = 0; k < 400; k += 1) {
      out = runOut(h, ...(k === 0 ? reports.flatMap((x) => ['--reported', x]) : []));
      outs.push(out);
      if (hasPush(out)) break;
      h.run(out.actions);
      if (out.then !== 'tick') break;
    }
  }
  assert.ok(hasPush(out), 'a list with a push');
  const push = out.actions.find((a) => a.step === 'push');
  const main = git(h.repo, 'rev-parse', 'main');
  assert.equal(push.id, `push:main:@${main}`);
  assert.equal(push.batch, 1);
  assert.equal(push.kind, 'exec');
  assert.equal(push.host, true, 'marked for the host');
  assert.ok(push.command.includes('push') && push.record.includes('--exit'));
  assert.ok(!out.ran.some((x) => x.id === push.id), 'run did not run it');
  assert.notEqual(git(h.repo, 'rev-parse', 'origin/main'), main, 'origin main is not pushed');
  assert.equal(h.state().tick.done[push.id], undefined);
});

test('#129: run executes through bash, writing each redirect and each log', { skip: NO_BASH ?? false }, (t) => {
  const h = world(t);
  // The programs are stubbed as shell functions; the command line itself, its cd and its redirect, run as written.
  const STUBS = `node() { echo stub; echo stub-err >&2; }; gh() { echo stub; }; `;
  const bash = bashExecutor();
  const ranActions = [];
  h.execute = (a, log) => {
    ranActions.push(a);
    return bash({ ...a, command: `${STUBS}${a.command}` }, log);
  };
  const out = runOut(h);
  assert.ok(out.ran.length, 'something ran');
  const done = h.state().tick.done;
  const withStdout = ranActions.filter((a) => a.stdout && a.argv[0] === 'node');
  const without = ranActions.filter((a) => !a.stdout && a.argv[0] === 'node');
  assert.ok(withStdout.length && without.length, 'execs with and without a stdout file ran');
  for (const a of ranActions) {
    assert.equal(done[a.id].exit, 0, `${a.id} ran in bash`);
    assert.ok(existsSync(done[a.id].log), `${a.id}: ${done[a.id].log} written`);
  }
  for (const a of withStdout) {
    assert.equal(readFileSync(a.stdout, 'utf8'), 'stub\n', `${a.id}: the redirect wrote ${a.stdout}`);
    assert.equal(readFileSync(done[a.id].log, 'utf8'), 'stub-err\n', `${a.id}: its stderr is in the log`);
  }
  for (const a of without) assert.equal(readFileSync(done[a.id].log, 'utf8'), 'stub\nstub-err\n', `${a.id}: stdout and stderr in the log`);
});

test('#130: bashUsable is the one judgement of a usable bash; its why names what uname -s said', () => {
  const wsl = bashUsable({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'win32' });
  assert.deepEqual([wsl.ok, wsl.uname], [false, 'Linux']);
  assert.match(wsl.why, /uname -s: Linux/);
  assert.deepEqual(bashUsable({ spawn: () => ({ status: 0, stdout: 'MINGW64_NT-10.0-26300\n' }), platform: 'win32' }), { ok: true, uname: 'MINGW64_NT-10.0-26300', why: null });
  assert.equal(bashUsable({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'linux' }).ok, true);
  const missing = bashUsable({ spawn: () => ({ error: new Error('spawnSync bash ENOENT'), status: null }) });
  assert.equal(missing.ok, false);
  assert.match(missing.why, /bash could not be started \(spawnSync bash ENOENT\)/);
  // the harness's BASH (tick-world.mjs) is this judgement of the bash on PATH
  assert.equal(BASH, bashUsable().ok);
});

test('#129: a bash that is missing or is not Git Bash / MSYS / Cygwin on win32 ends run with exit 1; what was recorded stays, and stdout says so (#147)', (t) => {
  const h = world(t);
  const log = join(h.dir, 'x.log');
  const wsl = bashExecutor({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'win32' });
  assert.throws(() => wsl({ id: 'x', command: 'true' }, log), /not Git Bash, MSYS or Cygwin/);
  const missing = bashExecutor({ spawn: () => ({ error: new Error('spawnSync bash ENOENT'), status: null }) });
  assert.throws(() => missing({ id: 'x', command: 'true' }, log), /bash could not be started/);
  const calls = [];
  const posix = bashExecutor({ spawn: (cmd, args) => (calls.push(args[1]), { status: args[1] === 'true' ? 3 : 0, stdout: 'Linux\n' }), platform: 'linux' });
  assert.deepEqual(posix({ id: 'x', command: 'true' }, log), { code: 3 });
  assert.deepEqual(calls, ['uname -s', 'true'], 'bash -c <command>, after one check');
  h.execute = wsl;
  const r = h.runTick();
  assert.equal(r.code, 1);
  assert.match(r.err, /WSL/);
  // #147: stdout says what ran (nothing) and the exec run stopped at, before it ran
  const o = JSON.parse(r.out);
  assert.deepEqual([o.command, o.exit, o.ran], ['run', 1, []]);
  assert.match(o.error, /WSL/);
  assert.equal(o.blocked.at, 'execute');
  assert.equal(o.blocked.exit, null);
  assert.equal(h.state().tick.done[o.blocked.id], undefined, 'nothing recorded for it');
  assert.equal(o.do, undefined, 'the exit-3 handling is for exit 3 only');
  // the first exec runs and is recorded, then bash goes missing
  let first = null;
  h.execute = (a, file) => {
    if (first) return missing(a, file);
    first = a.id;
    return { code: h.exec(a) };
  };
  const r2 = h.runTick();
  assert.equal(r2.code, 1);
  assert.equal(h.state().tick.done[first].exit, 0, `${first} stays recorded`);
  const o2 = JSON.parse(r2.out);
  assert.deepEqual(o2.ran.map((x) => [x.id, x.exit]), [[first, 0]]);
  assert.equal(o2.blocked.at, 'execute');
  assert.notEqual(o2.blocked.id, first);
  assert.equal(h.state().tick.done[o2.blocked.id], undefined);
});

test('#129: without --now, run reads the clock again for each list and each record', (t) => {
  const h = world(t);
  h.now += 5 * 60_000;
  const start = h.iso();
  // each exec takes a minute: the clock moves while run runs
  const deps = {
    ...defaultDeps(),
    clock: () => h.now,
    execute: (a) => {
      h.now += 60_000;
      return { code: h.exec(a) };
    },
  };
  const r = tick(['run', h.path], deps);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.ok(out.ran.length > 2, 'execs over more than one list');
  const minute = (k) => new Date(Date.parse(start) + k * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const done = h.state().tick.done;
  out.ran.forEach((x, k) => assert.equal(done[x.id].at, minute(k + 1), `${x.id} recorded at the time it ended`));
  assert.equal(out.now, minute(out.ran.length), 'the last list is made at the time after the last exec');
  assert.notEqual(out.now, start);
});

test('#129: --reported goes to the first next of run only', (t) => {
  const h = world(t);
  h.wake(); // a1 and a2 implement
  h.reportsNext = [];
  // a1's report comes: the host runs next, one list at a time, until a1's collect is recorded
  h.now += 5 * 60_000;
  const collected = () => h.log.some((a) => a.step === 'collect' && a.tickets.includes('#1'));
  for (let i = 0; i < 40 && !collected(); i += 1) {
    const r = h.tick('next', h.path, ...(i === 0 ? ['--reported', 'a1'] : []));
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    if (i === 0) assert.deepEqual(out.reports.map((x) => [x.agent, x.why]), [['a1', 'current']]);
    h.run(out.actions);
  }
  assert.ok(collected(), "a1's collect is recorded");
  // the same report again: the first next of run takes it as a duplicate, the later lists never see it
  const out = runOut(h, '--reported', 'a1');
  // the lists: the acceptance check, the review tier (#139) and the ticket face ran in the first; the review's spawn
  // file (#138) and its deadline record (#143) in the second, its assignment (#143) in the third; the review spawn they
  // lead to is listed by the next after them
  assert.deepEqual(out.ran.map((x) => x.id), ['against:#1:1', 'tier:#1:1', 'body:#1:review:1', 'brief:#1:review-1', 'rec:review:#1:1', 'assign:review:#1:1']);
  assert.ok(out.actions.some((a) => a.step === 'review' && a.tickets[0] === '#1' && a.batch === 1), 'the list after the exec');
  assert.deepEqual(out.reports, [], 'the last list was not handed the report');
  // #147: the first list's take of it is still in the output, beside what that list ran
  assert.deepEqual(out.lists.map((l) => l.reports.map((x) => [x.agent, x.why])), [[['a1', 'duplicate']], [], [], []]);
  assert.deepEqual(out.lists.map((l) => l.ran), [['against:#1:1', 'tier:#1:1', 'body:#1:review:1'], ['brief:#1:review-1', 'rec:review:#1:1'], ['assign:review:#1:1'], []]);
});

// ---- #147: run's output and use -----------------------------------------------------------------------------------------

test('#147: a flag is never taken as the value of the flag before it; --reported with no value is a usage error', (t) => {
  const h = world(t);
  const before = readFileSync(h.path, 'utf8');
  for (const command of ['run', 'next']) {
    for (const args of [['--reported', '--now', h.iso()], ['--reported'], ['--now', '--reported', 'a1']]) {
      const r = tick([command, h.path, ...args], { ...defaultDeps(), execute: () => assert.fail('nothing runs') });
      assert.equal(r.code, 2, `${command} ${args.join(' ')}: ${r.err}`);
      assert.equal(r.out, '');
      assert.match(r.err, new RegExp(`^tick: ${args[0]} needs a value\n`), `${command} ${args.join(' ')}: the missing value is named`);
    }
  }
  const rec = tick(['record', h.path, 'x', '--exit', '--now', h.iso()], defaultDeps());
  assert.equal(rec.code, 2);
  assert.match(rec.err, /^tick: --exit needs a value\n/);
  // a value that only starts with one dash is a value
  const neg = tick(['record', h.path, 'x', '--exit', '-1'], defaultDeps());
  assert.doesNotMatch(neg.err, /needs a value/);
  assert.equal(readFileSync(h.path, 'utf8'), before, 'nothing was written');
});

test('#147: run lists the reports, reconcile, dispatch and wrote of every list it made, not only the last', (t) => {
  const h = world(t);
  // the first run of the run: the dispatch point's list comes before the lists of its execs' results
  const first = runOut(h);
  assert.ok(Array.isArray(first.lists) && first.lists.length > 1, 'more than one list');
  for (const l of first.lists) for (const k of ['now', 'reports', 'reconcile', 'dispatch', 'wrote', 'ran']) assert.ok(k in l, `${k} is in each list`);
  const last = first.lists.at(-1);
  for (const k of ['now', 'reports', 'reconcile', 'dispatch', 'wrote']) assert.deepEqual(last[k], first[k], `the last list's ${k} is the output's`);
  assert.deepEqual(first.lists.flatMap((l) => l.ran), first.ran.map((x) => x.id), 'each exec run under the list that listed it, in order');
  assert.deepEqual(last.ran, [], 'the last list ran nothing: run stopped at it');
  const opened = first.lists.findIndex((l) => l.dispatch?.round === 1);
  assert.ok(opened >= 0 && opened < first.lists.length - 1, 'the dispatch point opened in a list before the last');
  const wrote = first.lists.slice(0, -1).flatMap((l) => l.wrote);
  assert.ok(wrote.length, 'an earlier list wrote files');
  assert.ok(wrote.some((f) => !first.wrote.includes(f)), 'a file only an earlier list wrote is still in the output');

});

test('#147: a refused record ends run with exit 3; stdout lists what ran and the exec it was blocked at, with what to do', (t) => {
  const h = world(t);
  // the host's own record of the second exec lands while run runs it: run's record of it is refused
  let n = 0;
  let second = null;
  h.execute = (a) => {
    const code = h.exec(a);
    if ((n += 1) === 2) {
      second = a;
      h.record(a.id, '--exit', '7');
    }
    return { code };
  };
  const r = h.runTick();
  assert.equal(r.code, 3, r.err);
  assert.match(r.err, /^tick: refused: .*already recorded/);
  const out = JSON.parse(r.out);
  assert.equal(out.format, 'sorry-matt/tick@1');
  assert.equal(out.command, 'run');
  assert.equal(out.exit, 3);
  assert.match(out.error, /already recorded/);
  assert.equal(out.ran.length, 1, 'the exec before it ran and was recorded');
  assert.equal(h.state().tick.done[out.ran[0].id].exit, 0);
  const { log, ...blocked } = out.blocked;
  assert.deepEqual(blocked, { id: second.id, step: second.step, at: 'record', exit: 0, record: second.record }, 'it ran, exit 0; its record was refused');
  assert.equal(dirname(log), join(h.W, 'tick', 'run'));
  assert.notEqual(log, out.ran[0].log);
  assert.match(out.do, /ran/);
  assert.match(out.do, /run `run` again/); // #146: the next run records blocked, it does not run it again
  assert.match(out.do, /not run again/);
  assert.match(out.do, /blocked\.exit/);
  assert.deepEqual(out.lists.flatMap((l) => l.ran), [out.ran[0].id]);
});

// ---- #146: what run's execs leave behind when it fails, and which execs it leaves to the host -------------------------

test('#146: a run that throws does not count the batch-1 spawns of its list as handed out; a run that returns does', (t) => {
  const h = world(t);
  h.acceptance['#2'] = { items: [], expansions: [] }; // #2's expansion spawn comes up while #1's chain still has execs
  let thrown = null;
  h.execute = (a) => {
    const st = h.state().tick;
    const spawn = Object.keys(st.issued).find((id) => st.issued[id].kind === 'spawn' && st.issued[id].batch === 1 && !st.done[id]);
    if (spawn && !thrown) {
      thrown = { exec: a.id, spawn };
      throw new Error('execute broke');
    }
    return { code: h.exec(a) };
  };
  assert.throws(() => h.runWake(), /execute broke/);
  assert.ok(thrown, 'an exec ran beside a batch-1 spawn and threw');
  // the host never saw that list: the next one hands the spawn out again, as a spawn
  const again = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!again.actions.some((a) => a.step === 'spawn-check'), 'no spawn-check for a spawn the host never saw');
  const spawn = again.actions.find((a) => a.id === thrown.spawn);
  assert.equal(spawn?.kind, 'spawn');
  assert.equal(spawn.batch, 1);
  h.run(again.actions); // the host takes that list
  // a run that returns its list hands its batch-1 spawns out: interrupted before their record, they come back as checks
  h.execute = null;
  let out = null;
  for (let i = 0; i < 10 && !out?.actions.some((a) => a.kind === 'spawn' && a.batch === 1); i += 1) {
    out = runOut(h);
    if (!out.actions.some((a) => a.kind === 'spawn' && a.batch === 1)) h.run(out.actions);
  }
  const handed = out.actions.filter((a) => a.kind === 'spawn' && a.batch === 1 && a.spawn.background);
  assert.ok(handed.length, 'run returned a background spawn at batch 1');
  const checks = JSON.parse(h.tick('next', h.path).out).actions.filter((a) => a.step === 'spawn-check');
  assert.deepEqual(checks.map((a) => a.meta.of).sort(), ids(handed).sort());
});

test('#146: an exec killed by a signal is no normal end: exit 128 + the signal number, said in its log, and its failed judge', (t) => {
  const h = world(t);
  const log = join(h.dir, 'killed.log');
  const killedBy = (signal) => bashExecutor({ spawn: (cmd, args) => (args[1] === 'uname -s' ? { status: 0, stdout: 'Linux\n' } : { status: null, signal }), platform: 'linux' });
  assert.deepEqual(killedBy('SIGKILL')({ id: 'x', command: 'true' }, log), { code: 137, signal: 'SIGKILL' });
  assert.match(readFileSync(log, 'utf8'), /killed by SIGKILL/);
  assert.deepEqual(killedBy('SIGTERM')({ id: 'x', command: 'true' }, log), { code: 143, signal: 'SIGTERM' });
  // in run: the first exec is killed; it is recorded as killed, not as exit 1 (which some execs take as a normal end)
  const kill = killedBy('SIGKILL');
  let first = null;
  h.execute = (a, file) => {
    if (first) return { code: h.exec(a) };
    first = a.id;
    return kill(a, file);
  };
  const out = runOut(h);
  assert.deepEqual(out.ran[0], { id: first, exit: 137, signal: 'SIGKILL', log: out.ran[0].log });
  assert.equal(h.state().tick.done[first].exit, 137);
  const judged = out.actions.find((a) => a.id === `failed:${first}`);
  assert.ok(judged && judged.batch === 1, 'its failed judge is listed');
  assert.match(readFileSync(out.ran[0].log, 'utf8'), /killed by SIGKILL/);
});

test('#146: an exec whose record failed is not run again: the next run records it with the exit it had', (t) => {
  const h = world(t);
  const seen = new Set(); // CI runs at each SHA's first read: the finish reads it again, and its record counts a full verification
  h.ci = (branch, sha) => (seen.has(sha) ? 'green' : (seen.add(sha), 'running'));
  // state.mjs refuses the usage write of the finish's CI record once: the exec ran, its record is refused
  const plain = defaultDeps().stateMain;
  let refuse = true;
  const stateMain = (argv) => {
    if (refuse && argv[0] === 'usage' && argv.includes('fullVerifications=1')) {
      refuse = false;
      return { code: 3, out: '', err: 'state: refused: usage is held (test)\n' };
    }
    return plain(argv);
  };
  const counts = {};
  const deps = {
    ...defaultDeps(),
    stateMain,
    execute: (a) => {
      counts[a.id] = (counts[a.id] ?? 0) + 1;
      return { code: h.exec(a) };
    },
  };
  let refused = null;
  let listed = null;
  let after = null;
  const via = (...args) => {
    const r = tick(['run', h.path, ...args, '--now', h.iso()], deps);
    if (r.code !== 3 || refused) return r;
    refused = JSON.parse(r.out);
    // a host on next sees it ran and is pointed at its record, not at its command
    listed = JSON.parse(h.tick('next', h.path).out).actions.find((a) => a.id === refused.blocked.id);
    // the refusal settled (state.mjs no longer says no): run again, as its `do` says
    const again = tick(['run', h.path, '--now', h.iso()], deps);
    after = JSON.parse(again.out);
    return again;
  };
  assert.equal(h.untilDone(() => h.wake({ via })).then, 'done');
  assert.ok(refused, 'a record was refused');
  assert.equal(refused.exit, 3);
  const { blocked } = refused;
  assert.equal(blocked.at, 'record');
  assert.equal(blocked.exit, 0);
  assert.match(refused.do, /run `run` again/);
  assert.doesNotMatch(refused.do, /do not run `run` again/i);
  assert.deepEqual([listed.kind, listed.ran.exit], ['exec', 0], 'next lists it with what it ran');
  assert.match(listed.note, /do not run it again/i);
  assert.equal(counts[blocked.id], 1, `${blocked.id} ran once`);
  assert.deepEqual(after.ran.find((x) => x.id === blocked.id), { id: blocked.id, exit: 0, log: blocked.log }, 'the run after records it with its exit');
  const st = h.state();
  assert.equal(st.tick.done[blocked.id].exit, 0);
  assert.equal(st.tick.ran?.[blocked.id], undefined, 'nothing left to record');
  assert.equal(st.usage.fullVerifications, 1, 'its record applied once');
  assert.ok(Object.values(counts).every((n) => n === 1), 'no exec ran twice');
});

test("#146: run leaves to the host only the execs tick marks host: a push of a line is run, no other exec is marked", (t) => {
  // a push of the integration branch: not a protected branch, so no `host`, and run runs it (#144's ci-fix commit)
  const h = world(t);
  unmatchedRed(h);
  h.runWake();
  assert.equal(ciFixSpawns(h).length, 1, 'the ci-fix spawn');
  const outs = h.runWake();
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  const pushed = outs.flatMap((o) => o.ran).find((x) => x.id === `push:${LINE}:@${fixed}`);
  assert.ok(pushed, 'run pushed the line itself');
  assert.equal(pushed.exit, 0);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), fixed);
  assert.ok(!h.log.some((a) => a.step === 'push'), 'the host was not handed the push');


  // no exec but a push to a protected branch is marked host: everything else run runs itself
  const marked = h.log.concat(outs.flatMap((o) => o.actions)).filter((a) => a.kind === 'exec' && a.host);
  assert.deepEqual(marked, [], 'nothing marked host on a line that only pushes itself');
});

// ---- a chain's next ticket goes to the idle agent of its upstream (batch-2 run: implementers were 72% of tokens) ----

test('the next ticket of a chain is sent to the idle implementation agent of its one upstream, with a spawn file of its own', (t) => {
  const h = world(t);
  const [ID1, ID2] = h.ids;
  h.blockers[ID2] = [ID1];
  h.untilDone();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
  const once = distinct(h.log);
  const implementSpawns = once.filter((a) => a.kind === 'spawn' && a.spawn?.description?.startsWith('implement'));
  assert.deepEqual(implementSpawns.map((a) => a.tickets[0]), [ID1], 'one implementation agent is spawned, for the first ticket');
  const send = once.find((a) => a.step === 'send' && a.tickets[0] === ID2);
  assert.ok(send, '#2 goes to the agent by SendMessage');
  const agent = Object.keys(h.agentOf).find((k) => h.agentOf[k].role === 'implement' && h.agentOf[k].tickets.includes(ID1)); // #1's spawn
  assert.ok(send.do.startsWith(`SendMessage ${agent} (it implemented ${ID1}, upstream of ${ID2}`), send.do);
  const brief = /Read (\S+\.md) in full and follow it as a new assignment/.exec(send.do)?.[1];
  assert.ok(brief && readFileSync(brief, 'utf8').length > 0, 'the message names a spawn file of its own');
  assert.ok(h.log.findIndex((a) => a.step === 'brief' && a.tickets[0] === ID2) < h.log.findIndex((a) => a.id === send.id), 'the spawn file is written first');
  assert.deepEqual(h.state().tick.agents[agent].tickets.sort(), [ID1, ID2].sort(), 'the agent now holds both');
  assert.equal(h.state().tickets[ID2].stage, 'delivered');
});

test('a chain agent is not reused while its upstream has not passed review (it may still need its agent for a fix round)', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  write(join(h.W, 'freeze.json'), `${JSON.stringify({ preflight: { ok: true, checks: [{ name: 'gh-stack', ok: true, stack: true }] } })}\n`);
  h.blockers[ID2] = [ID1];
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? 'running' : 'green');
  h.wake(); // #2 is stacked while #1 is still implementing: #1 may still need its agent, so #2 gets its own
  const once = distinct(h.log);
  assert.deepEqual(once.filter((a) => a.kind === 'spawn' && a.spawn?.description?.startsWith('implement')).map((a) => a.tickets[0]).sort(), [ID1, ID2].sort());
  assert.ok(!once.some((a) => a.step === 'send' && a.tickets[0] === ID2));
});
