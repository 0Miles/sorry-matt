// node --test scripts/tick.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: a plain run, the ledger, reports, red lines, merges, interrupted spawns and the batches (#128 D1, D2, #144).
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as tick, defaultDeps } from '../src/skills/get-to-work/scripts/tick.mjs';
import { main as distTick } from '../skills/get-to-work/scripts/tick.mjs';
import { main as integrateMain } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { REPO, LINE, git, write, numOf, Crash, BASH, NO_BASH, world, ids, distinct, stage, briefOf, unmatchedRed, ciFixSpawns } from './tick-world.mjs';
test('a plain run: dispatch, close-out, finish, in batches', (t) => {
  const h = world(t);
  const w1 = h.wake();
  const a1 = h.actions(w1);
  // the first dispatch point: progress, CI, frontier, acceptance, overlap, then a branch and an agent per ticket
  assert.deepEqual(w1[0].dispatch.reasons, ['first wake-up']);
  const spawns = distinct(a1).filter((a) => a.kind === 'spawn');
  assert.deepEqual(spawns.map((a) => a.spawn.description).sort(), ['implement #1', 'implement #2']);
  assert.ok(spawns.every((a) => a.spawn.subagent_type === 'sorry-matt:implementer' && a.spawn.background));
  // #107: what does not depend on each other goes out in one batch; the assignment record comes before the spawn
  const last = w1.find((o) => o.actions.some((a) => a.kind === 'spawn'));
  const at = Object.fromEntries(last.actions.map((a) => [a.id, a.batch]));
  const branch1 = last.actions.find((a) => a.step === 'ticket-branch' && a.tickets[0] === '#1');
  const branch2 = last.actions.find((a) => a.step === 'ticket-branch' && a.tickets[0] === '#2');
  assert.equal(branch1.batch, 1);
  assert.equal(branch2.batch, 1);
  assert.ok(at['rec:#1:1'] < at['assign:#1:1'] && at['assign:#1:1'] < at['spawn:#1:1']);
  assert.equal(at['spawn:#1:1'], at['spawn:#2:1']);
  assert.equal(w1.at(-1).then, 'end');
  assert.ok(w1.at(-1).fallback, 'agents in flight: a fallback wake-up');
  assert.equal(w1.at(-1).actions.at(-1).step, 'wakeup-end');
  assert.equal(stage(h, '#1'), 'implementing');

  const w2 = h.wake();
  assert.deepEqual(w2[0].reports.map((r) => [r.agent, r.accepted, r.why]), [
    ['a1', true, 'current'],
    ['a2', true, 'current'],
  ]);
  assert.equal(stage(h, '#1'), 'delivered');
  assert.equal(stage(h, '#2'), 'delivered');
  const st = h.state();
  // one --no-ff merge commit per ticket, its SHA recorded, the line's tip at the last one, pushed
  const tip = git(h.intWt, 'rev-parse', 'HEAD');
  assert.equal(st.tickets['#2'].merges[0].sha, tip);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), tip);
  assert.equal(git(h.intWt, 'rev-list', '--first-parent', '--merges', '--count', `main..${LINE}`), '2');
  // the ticket worktrees and branches are gone
  assert.equal(git(h.repo, 'branch', '--list', 'r1/0*'), '');
  // a dispatch point after the integration, which finds nothing left; then the finish, in the same wake-up
  assert.ok(w2.some((o) => o.dispatch?.reasons.includes('a ticket was integrated')));
  const steps = h.actions(w2).map((a) => a.step);
  const order = ['simplify', 'sync-base', 'deliver-line', 'wrap-up'].map((s) => steps.indexOf(s));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `the finish in order: ${order}`);
  assert.deepEqual([h.state().lines[LINE].ci.sha, h.state().lines[LINE].ci.verdict], [git(h.intWt, 'rev-parse', 'HEAD'), 'green'], 'verified at the latest SHA');
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(h.state().lines[LINE].base.synced);
  const w3 = h.wake();
  assert.deepEqual([w3.length, w3[0].then, w3[0].actions], [1, 'done', []]);
  // every action points to what it needs to read
  assert.ok(h.log.every((a) => a.reference.length && a.reference.every((r) => r.path || r.skill)));
});

test("the ledger's limits stop the run at a dispatch point: what was not dispatched awaits a ruling", (t) => {
  const h = world(t);
  const ledger = join(h.dir, 'runs', 'r1.md');
  write(ledger, '<!-- sorry-matt:run active -->\n- `budget: rounds 1`\n- budget: timeout-implement 45\n');
  assert.equal(h.tick('setup', h.path, '--tracker', 'github', '--repo', REPO, '--root', h.repo, '--base', 'main', '--ledger', ledger, '--worktrees', join(h.dir, 'wts')).code, 0);
  h.blockers['#2'] = ['#1'];
  const w1 = h.wake();
  const rec = h.actions(w1).find((a) => a.id === 'rec:#1:1');
  assert.equal(rec.argv[rec.argv.indexOf('--limit') + 1], '45', 'the stage time limit from the ledger');
  assert.equal(stage(h, '#2'), 'candidate', '#2 waits for its blocker');
  h.wake();
  const st = h.state();
  assert.deepEqual(st.stop.stoppedBy, ['rounds']);
  assert.equal(st.tickets['#1'].stage, 'delivered');
  assert.equal(st.tickets['#2'].stage, 'awaiting-ruling');
  assert.match(st.tickets['#2'].reason, /^run stopped at rounds/);
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the finish follows once nothing is in flight');
});

test('the same report delivered twice is taken once', (t) => {
  const h = world(t);
  h.wake();
  h.reportsNext = ['a1']; // #2 stays in flight, so the run goes on
  h.wake();
  assert.equal(stage(h, '#1'), 'delivered');
  const before = h.state().tickets['#1'].history.length;
  const w3 = h.wake({ reported: ['a1'] });
  assert.deepEqual(w3[0].reports, [{ agent: 'a1', accepted: false, tickets: ['#1'], why: 'duplicate' }]);
  assert.ok(!ids(h.actions(w3)).some((x) => x.startsWith('collect:a1') || x.startsWith('ignore:a1')));
  assert.equal(h.state().tickets['#1'].history.length, before);
  // a second delivery inside the same wake-up, before the first is recorded, is one collect
  const h2 = world(t);
  h2.wake();
  const r = JSON.parse(h2.tick('next', h2.path, '--reported', 'a1', '--reported', 'a1').out);
  assert.equal(r.actions.filter((a) => a.step === 'collect').length, 1);
});

test('a report from an agent replaced after a timeout is ignored, not taken', (t) => {
  const h = world(t);
  h.wake();
  // a1 never shows progress or reports; a2 is fine
  h.silent.add('a1');
  h.reportsNext = h.reportsNext.filter((x) => x !== 'a1');
  git(join(h.dir, 'wts', basename(h.state().tickets['#1'].branch)), 'reset', '-q', '--hard', LINE);
  const w2 = h.wake({ minutes: 31, reported: [] });
  const a2 = h.actions(w2);
  const timeout = a2.find((a) => a.step === 'timeout');
  assert.ok(timeout, 'the overdue agent is stopped');
  assert.deepEqual(timeout.tickets, ['#1']);
  assert.match(timeout.do, /reassign/);
  // the steps it sends the host to are TIMEOUTS.md's own (stop, settle, write the record)
  const ref = timeout.reference.find((r) => r.path.endsWith('TIMEOUTS.md'));
  assert.ok(ref, 'the timeout judge points to TIMEOUTS.md');
  const steps = new Set([...readFileSync(ref.path, 'utf8').matchAll(/^(\d+)\. /gm)].map((m) => m[1]));
  const named = [ref.part, timeout.do].flatMap((text) => [...text.matchAll(/\bsteps? (\d+)(?: (?:to|and) (\d+))?/g)].flatMap((m) => m.slice(1).filter(Boolean)));
  assert.ok(named.length, timeout.do);
  for (const n of named) assert.ok(steps.has(n), `TIMEOUTS.md has no step ${n}: ${ref.part} / ${timeout.do}`);
  // TIMEOUTS.md: 1 stop the agent, 2 settle it by the case, 3 write the timeout handling down
  assert.match(timeout.do, /TaskStop it \(TIMEOUTS\.md step 1\).*settle it by step 2 \(.*\(step 3\)/);
  // the reassignment: a new assignment with --reassign and a new agent
  assert.ok(a2.some((a) => a.step === 'assignment' && a.argv.includes('--reassign')));
  const st = h.state();
  const now = st.tickets['#1'].assignment.agentId;
  assert.notEqual(now, 'a1');
  assert.equal(st.tickets['#1'].timeoutReassignments.implementing, 1);
  // the stopped agent reports after all
  const w3 = h.wake({ reported: ['a1'] });
  assert.deepEqual(w3[0].reports.find((r) => r.agent === 'a1'), { agent: 'a1', accepted: false, tickets: ['#1'], why: 'stopped' });
  const a3 = h.actions(w3);
  assert.ok(a3.some((a) => a.id === 'ignore:a1' && a.kind === 'judge'));
  assert.ok(!a3.some((a) => a.id.startsWith('collect:a1')));
  assert.equal(h.state().tickets['#1'].assignment.agentId, now);
  assert.equal(stage(h, '#1'), 'implementing');
});

test('a red line is read every wake-up; its result comes a wake-up late; green reopens dispatching', (t) => {
  const h = world(t);
  const red = git(h.intWt, 'rev-parse', 'HEAD');
  h.ci = (branch, sha) => (sha === red ? 'red' : h.later ?? 'running');
  h.policy['red-light'] = () => {
    // the round's fix: a commit on the integration branch, pushed
    write(join(h.intWt, 'fix.txt'), 'fix\n');
    git(h.intWt, 'add', '-A');
    git(h.intWt, 'commit', '-q', '-m', 'fix the red light');
    git(h.intWt, 'push', '-q', 'origin', LINE);
    return 'handled';
  };
  const w1 = h.wake();
  const a1 = h.actions(w1);
  assert.ok(a1.some((a) => a.step === 'red-light'));
  assert.ok(!a1.some((a) => a.kind === 'spawn'), 'no new ticket on a red line');
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');

  const w2 = h.wake();
  const a2 = h.actions(w2);
  const read = a2.find((a) => a.step === 'ci-read');
  assert.ok(read, 'the red line is read again this wake-up');
  assert.equal(read.argv.at(-1), fixed);
  assert.equal(h.state().lines[LINE].ci.verdict, 'running');
  assert.ok(!a2.some((a) => a.kind === 'spawn'));
  assert.ok(w2.every((o) => o.dispatch === null), 'no dispatch point while the line is still red');

  h.later = 'green';
  const w3 = h.wake();
  const a3 = h.actions(w3);
  assert.ok(w3.some((o) => o.dispatch?.reasons.includes('a red line turned green')));
  assert.deepEqual(distinct(a3).filter((a) => a.kind === 'spawn').map((a) => a.tickets[0]).sort(), ['#1', '#2']);
});

test('#144: a red light that maps to no ticket: tick spawns ci-fix on the integration branch, with the assignment on the line', (t) => {
  const h = world(t);
  const red = unmatchedRed(h);
  const w1 = h.wake();
  const [spawn] = ciFixSpawns(h);
  assert.ok(spawn, 'tick hands out the ci-fix spawn');
  assert.equal(h.redJudges[0].step, 'red-light');
  assert.equal(spawn.spawn.description, `ci-fix ${LINE}`);
  assert.equal(spawn.spawn.subagent_type, 'general-purpose');
  assert.ok(spawn.spawn.background);
  assert.deepEqual([spawn.line, spawn.tickets], [LINE, []]);
  // the brief names the integration worktree, the branch and the failing lines; tick pushes, the agent does not
  const brief = readFileSync(briefOf(spawn), 'utf8');
  assert.ok(brief.includes(resolve(h.intWt)), 'the integration worktree');
  assert.ok(brief.includes(h.redJudges[0].meta.failure), 'the failure output');
  assert.ok(brief.includes(red), 'the red SHA');
  assert.match(brief, /do not push/i);
  assert.match(brief, /no ticket id/i);
  // the assignment record is the line's: its worktree, the fix time limit, the agent that was spawned
  const st = h.state();
  const a = st.lines[LINE].assignment;
  const agent = Object.keys(h.agentOf).find((x) => h.agentOf[x].role === 'ci-fix');
  assert.deepEqual([a.agentId, a.type, a.limit, a.extended], [agent, 'general-purpose', 20, 'no']);
  assert.equal(resolve(a.worktree), resolve(h.intWt));
  assert.equal(a.fingerprint.head, red);
  assert.equal(Date.parse(a.deadline) - Date.parse(a.assigned), 20 * 60_000);
  assert.ok(Object.values(st.tickets).every((x) => x.assignment === null), 'no ticket holds it');
  assert.ok(!h.actions(w1).some((x) => x.kind === 'spawn' && x.spawn.description.startsWith('implement')), 'no new ticket on a red line');
  assert.ok(w1.at(-1).fallback, 'an agent in flight: a fallback wake-up');
  assert.equal(w1.at(-1).fallback.deadline, a.deadline);

  // its report is taken, the line released; tick pushes the fix and reads CI at it; green reopens dispatching
  const w2 = h.wake();
  const a2 = h.actions(w2);
  const collect = a2.find((x) => x.step === 'collect' && x.meta?.agent === agent);
  assert.ok(collect && collect.line === LINE && collect.meta.stage === 'ci-fix');
  assert.equal(h.state().lines[LINE].assignment.deadline, null);
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  assert.notEqual(fixed, red);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), fixed);
  assert.ok(a2.some((x) => x.step === 'ci-read' && x.argv.at(-1) === fixed));
  assert.ok(w2.some((o) => o.dispatch?.reasons.includes('a red line turned green')));
  assert.equal(ciFixSpawns(h).length, 1);
});

test('#144: a ci-fix agent past its time limit goes through the timeout handling; each stop is a fix round, two fail the line', (t) => {
  const h = world(t);
  const red = unmatchedRed(h);
  h.ciFixSilent = true;
  h.policy.timeout = (a) => {
    assert.deepEqual([a.line, a.tickets, a.meta.stage], [LINE, [], 'ci-fix']);
    assert.ok(a.outcomes.includes('stopped'));
    return 'stopped';
  };
  h.wake();
  assert.equal(ciFixSpawns(h).length, 1);
  // not overdue yet: no stop, no second round
  const w2 = h.wake({ minutes: 10 });
  assert.ok(!h.actions(w2).some((x) => x.step === 'timeout'));
  assert.equal(w2.at(-1).fallback.deadline, h.state().lines[LINE].assignment.deadline);
  // overdue with no progress: stopped, the round counted, and the next red-light judge opens round 2
  const w3 = h.wake({ minutes: 11 });
  const a3 = h.actions(w3);
  assert.ok(a3.some((x) => x.step === 'timeout' && x.line === LINE));
  assert.equal(h.state().usage.timeoutStops, 1);
  assert.equal(h.redJudges.length, 2, 'the stopped round is judged again');
  assert.equal(h.redJudges[1].meta.round, 2);
  assert.equal(ciFixSpawns(h).length, 2);
  assert.equal(git(h.intWt, 'rev-parse', 'HEAD'), red);
  // round 2 overdue too: the line fails verification, unmatched is no longer an outcome
  h.wake({ minutes: 21 });
  assert.equal(h.state().usage.timeoutStops, 2);
  assert.equal(h.redJudges.length, 3);
  assert.ok(!h.redJudges[2].outcomes.includes('unmatched'), 'two rounds used: no third');
  assert.ok(h.state().tick.failed[LINE], 'the line failed verification');
  assert.equal(ciFixSpawns(h).length, 2);
  assert.equal(stage(h, '#1'), 'awaiting-ruling');
  assert.equal(stage(h, '#2'), 'awaiting-ruling');
});

test('#144: record unmatched is refused (3) until the failure output is written where the judge says', (t) => {
  const h = world(t);
  const red = git(h.intWt, 'rev-parse', 'HEAD');
  h.ci = (branch, sha) => (sha === red ? 'red' : 'green');
  let judged = null;
  h.policy['red-light'] = (a) => {
    judged = a;
    const r = h.tick('record', h.path, a.id, '--outcome', 'unmatched');
    assert.equal(r.code, 3, r.err);
    assert.match(r.err, /failure/);
    write(a.meta.failure, 'check: test x failed\n');
    return 'unmatched';
  };
  h.wake();
  assert.ok(judged);
  assert.equal(ciFixSpawns(h).length, 1);
});

test('merged but not recorded: the resumed host follows git and does not merge again', (t) => {
  const h = world(t);
  h.wake();
  // the host is interrupted inside integrate.mjs merge, after git merged and before anything was recorded
  h.crashAfter = (a) => {
    if (a.step !== 'stage' || a.argv[4] !== 'integrating') return false;
    git(h.intWt, 'merge', '--no-ff', '--no-edit', h.state().tickets[a.tickets[0]].branch);
    return true;
  };
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const merged = git(h.intWt, 'rev-parse', 'HEAD');
  const st = h.state();
  const [id] = Object.entries(st.tickets).find(([, x]) => x.stage === 'integrating');
  assert.deepEqual(st.tickets[id].merges, []);
  // resume: nothing but the state file, the ledger and git
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.deepEqual(r.reconcile.find((x) => x.ticket === id), { ticket: id, state: 'integrating, no merge SHA recorded', git: `merged into ${LINE} at ${merged}`, follow: 'git' });
  const merges = r.actions.filter((a) => a.step === 'merge');
  assert.deepEqual(ids(merges), [`merge:${id}:@${merged.slice(0, 12)}`], 'integrate.mjs merge once more, to finish what is left');
  h.run(r.actions);
  const out = JSON.parse(readFileSync(merges[0].stdout, 'utf8'));
  assert.deepEqual([out.found, out.merge], ['git', merged], 'it found the merge git has; it did not merge again');
  h.wake({ reported: [] });
  const after = h.state();
  assert.equal(after.tickets[id].stage, 'delivered');
  assert.deepEqual(after.tickets[id].merges.map((m) => m.sha), [merged]);
  assert.equal(git(h.intWt, 'rev-list', '--first-parent', '--merges', '--count', `main..${LINE}`), '2');
});

test('the integration branch moves between wake-ups: the state follows git and CI reads the new tip', (t) => {
  const h = world(t);
  h.wake();
  h.reportsNext = ['a1']; // #2's report comes later
  h.wake();
  assert.equal(stage(h, '#1'), 'delivered');
  const merged1 = h.state().tickets['#1'].merges[0].sha;
  // a host commit on the integration branch between two wake-ups
  write(join(h.intWt, 'note.md'), 'host\n');
  git(h.intWt, 'add', '-A');
  git(h.intWt, 'commit', '-q', '-m', 'host record');
  const moved = git(h.intWt, 'rev-parse', 'HEAD');
  const w3 = h.wake({ reported: ['a2'] });
  assert.deepEqual(w3[0].reconcile.find((x) => x.line === LINE), { line: LINE, state: `tip ${merged1}`, git: `tip ${moved}`, follow: 'git' });
  assert.ok(w3[0].actions.some((a) => a.id === `tip:${LINE}@${moved}`));
  const a3 = h.actions(w3);
  assert.ok(!a3.some((a) => a.step === 'merge' && a.tickets[0] === '#1'), '#1 is not merged again');
  assert.equal(stage(h, '#2'), 'delivered');
  const tip = git(h.intWt, 'rev-parse', 'HEAD');
  assert.equal(git(h.intWt, 'rev-parse', `${tip}^1`), moved, '#2 merged on top of the moved tip');
  const reads = a3.filter((a) => a.step === 'ci-read');
  assert.equal(reads.at(-1).argv.at(-1), tip, 'CI is read at the latest SHA');
  assert.equal(h.state().lines[LINE].tip, tip);
  assert.equal(h.state().tickets['#1'].merges.length, 1);
});

test('a merge that conflicts goes to a merge agent with a time limit, then on through close-out', (t) => {
  const h = world(t);
  // both agents write the same file, which neither prediction names
  const work = h.work;
  h.work = (agent, tid) => {
    const wt = h.state().tickets[tid].assignment?.worktree;
    write(join(wt, 'same.txt'), `${tid}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `work on ${tid}`);
    h.reportsNext.push(agent);
  };
  h.wake();
  h.work = work;
  h.policy['merge-agent'] = (a) => {
    // N1: integrate.mjs aborted the conflict, so the merge agent finds a clean worktree and merges again itself
    assert.throws(() => git(h.intWt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), 'no merge left in progress');
    assert.equal(git(h.intWt, 'status', '--porcelain', '--untracked-files=no'), '');
    const agent = `a${++h.agents}`;
    assert.throws(() => git(h.intWt, 'merge', '--no-ff', '--no-edit', h.state().tickets[a.tickets[0]].branch));
    write(join(h.intWt, 'same.txt'), 'both\n');
    git(h.intWt, 'add', '-A');
    git(h.intWt, 'commit', '-q', '--no-edit');
    h.reportsNext.push(agent);
    return { outcome: 'spawned', agent };
  };
  const w2 = h.wake();
  const a2 = h.actions(w2);
  const conflicted = a2.find((a) => a.step === 'merge-agent');
  assert.ok(conflicted, 'the conflict goes to a merge agent');
  const [id] = conflicted.tickets;
  const merge = a2.find((a) => a.step === 'merge' && a.tickets[0] === id);
  assert.ok(merge.okExit.includes(4), 'integrate.mjs merge exits 4 on a conflict, which is not a failure');
  assert.deepEqual(JSON.parse(readFileSync(merge.stdout, 'utf8')).files, ['same.txt']);
  assert.match(conflicted.do, /same\.txt/, 'the merge agent is told which files conflict');
  assert.ok(a2.some((a) => a.id === `rec:${id}:2` && a.argv.includes('--limit') && a.argv[a.argv.indexOf('--limit') + 1] === '15'), 'the merge stage time limit');
  assert.match(conflicted.do, new RegExp(`merge ${id}`));
  assert.equal(stage(h, id), 'integrating');
  const w3 = h.wake();
  assert.deepEqual(w3[0].reports.map((r) => r.why), ['current']);
  assert.ok(h.actions(w3).some((a) => a.step === 'collect' && a.meta.stage === 'integrating'));
  assert.equal(stage(h, id), 'delivered');
  const sha = h.state().tickets[id].merges[0].sha;
  assert.equal(git(h.intWt, 'rev-list', '--parents', '-n', '1', sha).split(' ').length, 3, 'one merge commit, two parents');
});

test('N3: a spawn interrupted before its record comes back as a check, not as a second spawn', (t) => {
  const h = world(t);
  let crashed = null;
  h.crashAfter = (a) => a.kind === 'spawn' && !crashed && (crashed = a);
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const started = `a${h.agents}`; // the agent the interrupted spawn did start
  const [id] = crashed.tickets;
  const other = id === '#1' ? '#2' : '#1';
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!r.actions.some((a) => a.kind === 'spawn'), 'no blind second spawn');
  const checks = r.actions.filter((a) => a.step === 'spawn-check');
  assert.deepEqual(checks.map((a) => a.meta.of).sort(), [`spawn:${id}:1`, `spawn:${other}:1`].sort());
  assert.ok(checks.every((a) => a.kind === 'judge' && a.outcomes.join() === 'spawned,none'));
  // the interrupted one was spawned: its agent fills the assignment
  h.record(checks.find((a) => a.meta.of === crashed.id).id, '--outcome', 'spawned', '--agent', started);
  assert.equal(h.state().tickets[id].assignment.agentId, started);
  // the other one never went out: none issues the spawn again, once
  h.record(checks.find((a) => a.meta.of !== crashed.id).id, '--outcome', 'none');
  const r2 = JSON.parse(h.tick('next', h.path).out);
  assert.deepEqual(ids(r2.actions.filter((a) => a.kind === 'spawn')), [`spawn:${other}:1`]);
  assert.ok(!r2.actions.some((a) => a.step === 'spawn-check'));
});

test('#128 D1: next makes the directory of every exec stdout before it returns; the command runs as written in bash', (t) => {
  const h = world(t);
  assert.equal(existsSync(join(h.W, 'tick')), false, 'no tick/ directory before the first next');
  // The programs are stubbed as shell functions; the command line itself, its cd and its redirect, run as written.
  // It runs from the test's temporary directory, and only in a bash that reads Windows paths (Git Bash, MSYS, Cygwin)
  // on win32: WSL's bash would flatten them and write the files into the working directory.
  const STUBS = `node() { echo 'stub'; }; gh() { echo 'stub'; }; `;
  // Without such a bash only the directories are checked here; the output says so and why (#130).
  if (!BASH) t.diagnostic(`#128 D1: the bash runs and redirect checks are skipped (${NO_BASH})`);
  const run = h.run;
  const seen = [];
  h.run = (actions) => {
    for (const a of actions.filter((x) => x.kind === 'exec' && x.stdout)) {
      assert.ok(existsSync(dirname(a.stdout)), `${a.id} (batch ${a.batch}): ${dirname(a.stdout)} exists when next returns`);
      if (BASH) {
        const p = spawnSync('bash', ['-c', `${STUBS}${a.command}`], { encoding: 'utf8', cwd: h.dir });
        assert.equal(p.status, 0, `${a.id}: ${p.stderr}`);
        assert.doesNotMatch(p.stderr, /No such file or directory/);
        assert.equal(readFileSync(a.stdout, 'utf8'), 'stub\n', `${a.id}: the redirect wrote ${a.stdout}`);
      }
      seen.push(a);
    }
    run(actions);
  };
  assert.equal(h.untilDone().then, 'done');
  const steps = new Set(seen.map((a) => a.step));
  for (const step of ['progress', 'ci-read', 'frontier', 'acceptance', 'overlap', 'assignment', 'brief', 'body', 'merge', 'acceptance-check'])
    assert.ok(steps.has(step), `an exec of ${step} with its stdout was checked`);
  assert.ok(seen.some((a) => a.batch > 1), 'later batches included');
});

test('#128 D2: the host sends batch 1 of each list and runs next after each record: no spawn-check, on to done', (t) => {
  const h = world(t);
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  const lists = h.wakes.flat();
  assert.ok(!lists.some((o) => o.actions.some((a) => a.step === 'spawn-check')), 'no list carries a spawn-check');
  assert.ok(lists.some((o) => o.actions.some((a) => a.kind === 'spawn' && a.batch > 1)), 'a spawn was listed at a later batch first');
  assert.ok(h.log.every((a) => a.batch === 1), 'the host ran batch 1 only');
  assert.equal(h.log.filter((a) => a.kind === 'spawn' && a.step === 'spawn').length, 2, 'one spawn per ticket');
});

test('#128 D2: a background spawn listed at batch 2 or later and not recorded comes back as the same spawn', (t) => {
  const h = world(t);
  let late = null;
  for (let i = 0; i < 80 && !late; i += 1) {
    const out = JSON.parse(h.tick('next', h.path).out);
    late = out.actions.find((a) => a.kind === 'spawn' && a.batch > 1);
    h.run(out.actions);
  }
  assert.ok(late, 'a list with a spawn at batch 2 or later');
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!r.actions.some((a) => a.step === 'spawn-check'), 'not a check: it was never handed out');
  assert.equal(r.actions.find((a) => a.id === late.id)?.kind, 'spawn', `${late.id} is issued again as a spawn`);
});

// ---- integrate: ticket-pr (#195) -----------------------------------------------------------------------------------

/** #195's ticket-pr replay, through `main` — src's tick.mjs, or dist's, the copy the plugin loads (#222). */
const ticketPrReplay = (main) => (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' }, main });
  const [ID1, ID2] = h.ids;
  // F1 pin: a ref by the line's name is present from the start; stepIntegration must never merge into it
  git(h.repo, 'branch', LINE, 'main');
  const lineSha = git(h.repo, 'rev-parse', LINE);
  // #2's initial review says fix; its fix round commits again and the recheck passes
  h.policy.review = (a) => (a.tickets[0] === ID2 && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'f1' } : 'pass');
  // the first wake-up dispatches: the branch is cut from origin/main (checked before the delivery removes it)
  h.wake();
  const branch = h.state().tickets[ID1].branch;
  assert.equal(git(h.repo, 'merge-base', 'origin/main', branch), git(h.repo, 'rev-parse', 'origin/main'), 'cut from origin/main');
  // #196: the queued tickets walk their own PR merges to delivered
  h.untilDone();
  assert.equal(stage(h, ID1), 'delivered');
  assert.equal(stage(h, ID2), 'delivered');
  const log = distinct(h.log);

  // dispatch: ticket-init with --base, and nothing merges into an integration branch
  const init = log.find((a) => a.step === 'ticket-branch' && a.tickets[0] === ID1);
  assert.equal(init.argv[init.argv.indexOf('--base') + 1], 'main');
  assert.ok(log.every((a) => a.step !== 'merge' && !(a.argv ?? []).includes('merge')), 'no action merges a ticket into an integration branch');

  // pr-open at the first reported commit: once per ticket, not marked host, a draft, the number in the state
  const opens = log.filter((a) => a.step === 'pr-open');
  assert.deepEqual(opens.map((a) => a.tickets[0]).sort(), [ID1, ID2].sort(), 'one pr-open per ticket');
  assert.ok(opens.every((a) => !a.host), 'pr-open is not marked host');
  const pr1 = h.state().tickets[ID1].pr;
  const pr2 = h.state().tickets[ID2].pr;
  assert.ok(Number.isInteger(pr1) && Number.isInteger(pr2) && pr1 !== pr2, 'each ticket has its own PR number in the state');
  assert.ok(h.ghCalls.some((args) => args[0] === 'pr' && args[1] === 'create' && args.includes('--draft')), 'the PR opens as a draft');

  // the review runs beside the PR's CI: the review spawn does not wait for pr-open
  const review1 = log.find((a) => a.step === 'review' && a.tickets[0] === ID1);
  assert.ok(!review1.after.includes(`pr-open:${ID1}`), 'the review does not wait for the PR');

  // the fixed point is origin/<base>, decided per ticket: the tier judge and the review dispatch file both carry it
  const tier1 = log.find((a) => a.step === 'tier' && a.tickets[0] === ID1);
  assert.equal(tier1.argv[tier1.argv.indexOf('--base') + 1], 'origin/main');
  const values = JSON.parse(readFileSync(join(h.W, 'tick', 'review', '1-1.values.json'), 'utf8'));
  assert.equal(values.fixedPoint, 'origin/main');

  // the fix commit goes back to the same PR: pr-push on the same branch, no second pr-open, the same number throughout
  const pushes = log.filter((a) => a.step === 'pr-push');
  assert.ok(pushes.length >= 1 && pushes.every((a) => a.tickets[0] === ID2), "the fix round's commit is pushed back for #2");
  assert.equal(log.filter((a) => a.step === 'pr-open' && a.tickets[0] === ID2).length, 1, 'no second pr-open');
  assert.equal(h.state().tickets[ID2].pr, pr2, 'the same PR number throughout');
  const b2 = h.state().tickets[ID2].branch;
  assert.ok(git(h.repo, 'rev-parse', `origin/${b2}`), 'the remote ticket branch holds the pushed commits (the local one is cleaned at delivery)');

  // F1: the ticket-pr guard of stepIntegration is pinned — the line ref present throughout never saw a merge
  // or a no-worktree judge: the delivery went through the tickets' own pull requests (#196)
  assert.ok(log.every((a) => a.step !== 'no-worktree'), 'no no-worktree judge under ticket-pr');
  assert.equal(git(h.repo, 'rev-parse', LINE), lineSha, 'the ref by the line name is untouched');
};

test('#195: ticket-pr — the ticket cuts from origin/<base>, opens its draft PR at the first reported commit, pushes each fix to the same PR, and nothing merges into an integration branch', ticketPrReplay(tick));

// #222: the F1 pin above holds for the copy the plugin loads too; check-structure.mjs compares the bytes, this the behaviour
test("#195 F1 (#222): the same ticket-pr replay through dist's tick.mjs (skills/get-to-work/scripts)", ticketPrReplay(distTick));

test('#195: ticket-pr — a report carrying no commit opens no PR; the report goes on through the existing rules', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  // the agents commit nothing, and their reports say so
  h.work = (agent) => h.reportsNext.push(agent);
  const report = h.agentReport;
  h.agentReport = (a) => report(a).replace(/^commit: .*$/m, 'commit: none');
  for (let i = 0; i < 5 && !(stage(h, ID1) === 'queued' && stage(h, ID2) === 'queued'); i += 1) h.wake();
  assert.equal(stage(h, ID1), 'queued', 'green with no commit still goes to review and on to queued');
  const log = distinct(h.log);
  assert.ok(log.every((a) => a.step !== 'pr-open' && a.step !== 'pr-push'), 'no PR action was issued');
  assert.equal(h.state().tickets[ID1].pr, null);
  assert.equal(h.ghCalls.length, 0, 'gh was never called');
  // an empty diff is tier light: the minimal review's brief compares with the per-ticket fixed point
  const rev = log.find((a) => a.step === 'review' && a.tickets[0] === ID1);
  assert.equal(rev.meta.kind, 'minimal');
  assert.match(readFileSync(briefOf(rev), 'utf8'), /git diff origin\/main\.\.\./);
});

/**
 * #222: a ticket-pr ticket sent back at its base sync, `via` the send-back judge (the merge agent reports
 * unresolved) or a merge agent's timeout (review F1: the timeout's send-back outcome starts the redo over too).
 */
const ticketPrSendBack = (via) => (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  // both tickets change a.js, though #2 predicted b.txt: the clash shows only when #2's push phase merges the base
  // (#1's merge) into its branch, and the merge agent cannot resolve it
  h.change[ID2] = { path: 'a.js' };
  h.policy.collect = (a) => ({ implementing: 'green', fixing: 'fixed', integrating: 'unresolved' })[a.meta.stage] ?? 'logged';
  h.policy['merge-agent'] = (a) => {
    h.mergeAgent = { ...a, stage: stage(h, a.tickets[0]) };
    const agent = `a${++h.agents}`;
    if (via === 'judge') h.reportsNext.push(agent); // it ran git merge --abort and reports unresolved
    return { outcome: 'spawned', agent }; // via timeout: it never reports, and goes past its time limit
  };
  const sendBack = (a) => {
    const id = a.tickets[0];
    const r = integrateMain(['send-back', h.path, id, '--conflicts', 'a.js', '--predicted', 'b.txt', '--base', 'main', '--repo', h.repo, '--now', h.iso()], { gh: h.gh });
    assert.equal(r.code, 0, r.err);
    const o = JSON.parse(r.out);
    h.sentBack = o;
    write(join(h.W, 'sendback', `${numOf(id)}.md`), `Sent back: the old attempt is at ${o.ref} (${o.sha}); conflicts ${o.conflicts.join(', ')}.\n`);
    write(join(h.W, 'files', `${numOf(id)}.txt`), `${o.predicted.join('\n')}\n`);
  };
  h.policy['send-back'] = (a) => {
    h.sendBackJudge = a;
    sendBack(a);
    return 'sent-back';
  };
  // TIMEOUTS.md step 2 for an overdue merge agent: send back
  h.policy.timeout = (a) => (a.meta.stage === 'integrating' ? (sendBack(a), 'send-back') : 'reassign');
  for (let i = 0; i < 14 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  const s = h.state();
  assert.ok(h.sentBack, 'the ticket was sent back');
  assert.equal(s.tickets[ID2].sendBacks, 1);
  assert.equal(stage(h, ID1), 'delivered');
  assert.equal(stage(h, ID2), 'delivered', 'the redo walks its PR to delivered');
  const log = distinct(h.log);
  // the conflict: one sync, the ticket moved to integrating, and the merge agent handed it (not a sync per pass)
  const sendAt = h.log.findIndex((a) => (via === 'judge' ? a.step === 'send-back' : a.step === 'timeout' && a.meta.stage === 'integrating'));
  assert.ok(sendAt >= 0, `sent back via ${via}`);
  const syncsBefore = distinct(h.log.slice(0, sendAt)).filter((a) => a.step === 'pr-merge' && a.tickets[0] === ID2);
  assert.deepEqual(syncsBefore.map((a) => a.id), [`pr-sync:${ID2}:1`], 'one base sync before the send-back');
  assert.equal(h.mergeAgent?.stage, 'integrating', 'the merge agent is handed the conflict with the ticket at integrating');
  if (via === 'judge') assert.match(h.sendBackJudge.do, /--base main/, 'the send-back is told the base the redo is cut from');
  assert.equal(h.sentBack.lineTip, h.prs[s.tickets[ID1].branch].mergeOid, 'under ticket-pr the tip the redo starts from is origin/main, with #1 merged');
  assert.deepEqual(h.sentBack.touched, ['a.js'], 'what the attempt changed, against origin/main');
  // the redo: cut anew from origin/main (it holds #1's a.js), the PR the same, its head replaced by the redo
  const pr2 = s.tickets[ID2].pr;
  assert.equal(log.filter((a) => a.step === 'pr-open' && a.tickets[0] === ID2).length, 1, 'no second pr-open after the redo');
  const pushes = distinct(h.log.slice(sendAt)).filter((a) => a.step === 'pr-push' && a.tickets[0] === ID2);
  assert.equal(pushes.length, 1, `the redo's commit goes to the same PR with one pr-push: ${pushes.map((a) => a.id)}`);
  // the redo's first base sync is an attempt of its own, not the rerun after the old conflict: no recheck
  const redo = s.tickets[ID2].history.slice(s.tickets[ID2].history.findIndex((x) => x.to === 'candidate') + 1).map((x) => x.to);
  assert.deepEqual(redo, ['implementing', 'in-review', 'queued', 'integrating', 'awaiting-ci', 'awaiting-merge', 'delivered']);
  assert.deepEqual(distinct(h.log.slice(sendAt)).filter((a) => a.step === 'pr-merge' && a.tickets[0] === ID2).map((a) => a.id), [`pr-sync:${ID2}:2`], "the redo's push phase is a new attempt, run once");
  const pushed = JSON.parse(readFileSync(pushes[0].stdout, 'utf8'));
  assert.equal(pushed.pushed, 'git push --force-with-lease', "the old attempt is not in the redo's history: its head is replaced");
  assert.notEqual(pushed.head, h.sentBack.lineTip, "the push waits for the redo's report: the bare rebuilt branch is never pushed");
  assert.equal(git(h.repo, 'rev-parse', `${pushed.head}^`), h.sentBack.lineTip, 'the redo is one commit on origin/main');
  assert.equal(pr2, h.prs[s.tickets[ID2].branch].number, 'the same PR number throughout');
  assert.equal(Object.values(h.prs).filter((p) => p.number === pr2).length, 1);
  assert.ok(h.ghCalls.filter((g) => g[0] === 'pr' && g[1] === 'create').length === 2, 'two PRs in all: one per ticket');
  assert.throws(() => git(h.repo, 'merge-base', '--is-ancestor', h.sentBack.sha, 'origin/main'), 'the old attempt is never merged');
  assert.equal(git(h.repo, 'rev-parse', h.sentBack.ref), h.sentBack.sha, 'it is kept at its sent-back ref');
};

test('#222: ticket-pr — a ticket sent back at its base sync keeps its pull request: the redo is pushed to the same PR, with no second pr-open', ticketPrSendBack('judge'));

test("#222 review F1: ticket-pr — a merge agent's timeout sent back the same way: nothing pushed before the redo reports, no recheck", ticketPrSendBack('timeout'));

// ---- integrate: ticket-pr — the merge path (#196) ------------------------------------------------------------------

test('#196: ticket-pr — pr-merge, awaiting-ci on the PR head, ready + merge-gate, the host merge, delivered, and the open issue closed once', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.issueState[ID1] = 'OPEN'; // `Closes` did not fire for #1; #2's issue closed itself
  h.untilDone();
  assert.equal(stage(h, ID1), 'delivered');
  assert.equal(stage(h, ID2), 'delivered');
  const s = h.state();
  assert.deepEqual(
    s.tickets[ID1].history.map((x) => x.to).slice(-4),
    ['integrating', 'awaiting-ci', 'awaiting-merge', 'delivered'],
    'queued → integrating (pr-merge push) → awaiting-ci → awaiting-merge → delivered',
  );
  const branch1 = s.tickets[ID1].branch;
  assert.equal(s.tickets[ID1].merges.at(-1).sha, h.prs[branch1].mergeOid, "the recorded merge SHA is GitHub's merge commit");
  const log = distinct(h.log);
  // awaiting-ci reads ci.mjs verdict on the PR head: the ticket branch at its pushed SHA
  const read1 = log.find((a) => a.step === 'ci-read' && a.id.startsWith(`pr-ci:${ID1}@`));
  assert.ok(read1, 'CI is read on the PR head');
  assert.ok(read1.argv.includes(branch1), 'the verdict is read for the ticket branch');
  assert.match(read1.argv.at(-1), /^[0-9a-f]{40}$/, 'at the PR head SHA');
  // the ready phase: gh pr ready + merge-gate.mjs, then the merge command with send status host
  assert.ok(h.ghCalls.some((a) => a[0] === 'pr' && a[1] === 'ready' && Number(a[2]) === s.tickets[ID1].pr), 'gh pr ready ran');
  assert.ok(h.ghCalls.some((a) => a[0] === 'api' && a[1] === 'graphql'), 'merge-gate.mjs queried the merge queue');
  const ready1 = JSON.parse(readFileSync(log.find((a) => a.step === 'pr-ready' && a.tickets[0] === ID1).stdout, 'utf8'));
  assert.deepEqual(ready1.send, { status: 'host', command: `gh pr merge ${s.tickets[ID1].pr}` });
  const send1 = log.find((a) => a.step === 'pr-send' && a.tickets[0] === ID1);
  assert.ok(send1.outcomes.includes('sent') && send1.outcomes.includes('left-for-human'), 'the prompting call offers sent and left-for-human');
  assert.match(send1.do, /never --admin, never auto-merge/);
  // the still-open issue gets one idempotent close pointing at the PR; the closed one sees no action
  const closes = log.filter((a) => a.step === 'issue-close');
  assert.deepEqual(closes.map((a) => a.tickets[0]), [ID1], 'only the open issue is closed');
  assert.ok(closes[0].argv.join(' ').includes(`pull request #${s.tickets[ID1].pr}`), 'the comment points at the PR');
  const extra = h.wake();
  assert.ok(h.actions(extra).every((a) => a.step !== 'issue-close' && a.step !== 'issue-state'), 'the close is not issued again');
});

test('#196: ticket-pr — without merge authorization the PR still goes ready; the ticket is recorded left-for-human and delivered', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.policy['pr-send'] = () => ({ outcome: 'left-for-human', value: 'no merge authorization this run: left for a person' });
  h.untilDone();
  const s = h.state();
  for (const id of [ID1, ID2]) {
    assert.equal(s.tickets[id].stage, 'delivered');
    assert.deepEqual(s.tickets[id].merges, [], `${id}: no merge SHA — nothing was merged`);
    assert.equal(s.tickets[id].leftForHuman, 'no merge authorization this run: left for a person');
    assert.equal(h.prs[s.tickets[id].branch].draft, false, `${id}: the PR was taken to ready`);
    assert.ok(!h.prs[s.tickets[id].branch].merged, `${id}: GitHub saw no merge`);
  }
  const log = distinct(h.log);
  assert.ok(log.every((a) => a.step !== 'pr-merged'), 'tick never checks for a merge that was not sent');
  assert.ok(log.every((a) => a.step !== 'issue-close'), "closing the issues goes with the person's merge");
});

test('#196: ticket-pr — awaiting-ci holds its in-flight slot, awaiting-merge does not but its planned files stay occupied; both wait on the fallback wake-up', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  write(join(h.W, 'files', '2.txt'), 'a.txt\n'); // #2 plans #1's file: dispatch file-overlap holds it back
  let ci1 = 'running';
  h.ci = () => ci1;
  h.policy['pr-send'] = () => 'sent'; // sent, but GitHub's merge queue has not merged yet
  for (let i = 0; i < 4 && stage(h, ID1) !== 'awaiting-ci'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'awaiting-ci');
  // one CI read per wake-up, then the wake ends — no polling loop in the action list, the fallback wake-up waits
  const w = h.wake();
  assert.equal(distinct(h.actions(w)).filter((a) => a.step === 'ci-read').length, 1, 'one read per wake-up');
  assert.equal(w.at(-1).then, 'end');
  assert.ok(w.every((o) => o.dispatch === null), 'awaiting-ci holds its in-flight slot: no dispatch point runs');
  assert.equal(stage(h, ID2), 'candidate');
  // green: ready, the merge sent, and the ticket parks at awaiting-merge
  ci1 = 'green';
  h.wake();
  assert.equal(stage(h, ID1), 'awaiting-merge');
  // awaiting-merge holds no slot: the dispatch point runs — but #1's planned files still hold #2 back
  const w2 = h.wake();
  const dispatch = w2.map((o) => o.dispatch).find(Boolean);
  assert.ok(dispatch?.reasons.includes('nothing in flight while candidates remain'), `the dispatch point ran: ${JSON.stringify(w2.map((o) => o.dispatch))}`);
  assert.equal(distinct(h.actions(w2)).filter((a) => a.step === 'pr-merged').length, 1, 'the merge is checked once per wake-up');
  assert.equal(stage(h, ID2), 'candidate', 'the overlap holds #2 back');
  const plan = JSON.parse(readFileSync(join(h.W, 'overlap', `${dispatch.round}.plan.json`), 'utf8'));
  assert.deepEqual(plan.running.map((x) => x.id), [ID1], "the awaiting-merge ticket's planned files stay occupied");
  const out = JSON.parse(readFileSync(join(h.W, 'overlap', `${dispatch.round}.json`), 'utf8'));
  assert.deepEqual(out.wait.map((x) => x.id), [ID2]);
  // the merge lands: #1 is delivered and the file is free — #2 starts
  h.mergePr(ID1);
  h.wake();
  assert.equal(stage(h, ID1), 'delivered');
  if (stage(h, ID2) === 'candidate') h.wake();
  assert.equal(stage(h, ID2), 'implementing');
});

/** #222: holds `id`'s first agent work (its commit and report) until the returned function is called. */
function holdWork(h, id) {
  const work = h.work;
  let held = null;
  h.work = (agent, tid) => {
    if (tid === id && held === null) held = () => work(agent, tid);
    else work(agent, tid);
  };
  return () => held();
}

test("#222: ticket-pr — a dispatch point while a ticket is at awaiting-ci counts its planned files as running: a candidate on them waits", (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  const ID3 = '#3';
  // a third ticket that plans #1's file: the first dispatch point holds it back
  h.S('add', ID3, '--line', h.line);
  h.titles[ID3] = 'Third thing';
  h.change[ID3] = { path: 'c.js' };
  write(join(h.W, 'files', '3.txt'), 'a.txt\n');
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? 'running' : 'green'); // #1's PR head CI never ends here
  const release = holdWork(h, ID2);
  h.wake();
  assert.deepEqual([stage(h, ID1), stage(h, ID2), stage(h, ID3)], ['implementing', 'implementing', 'candidate']);
  for (let i = 0; i < 4 && stage(h, ID1) !== 'awaiting-ci'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'awaiting-ci');
  // #2 reports blocked: it leaves the pipeline, and that opens a dispatch point with #1 still at awaiting-ci
  h.policy.collect = (a) => (a.tickets[0] === ID2 ? { outcome: 'blocked', value: 'blocked: see the status record' } : a.meta.stage === 'implementing' ? 'green' : 'fixed');
  release();
  const w = h.wake();
  assert.equal(stage(h, ID2), 'awaiting-ruling');
  assert.equal(stage(h, ID1), 'awaiting-ci', 'still waiting on its PR head CI');
  const dispatch = w.map((o) => o.dispatch).find((d) => d?.reasons.includes('a ticket left the pipeline'));
  assert.ok(dispatch, `the dispatch point ran: ${JSON.stringify(w.map((o) => o.dispatch))}`);
  const plan = JSON.parse(readFileSync(join(h.W, 'overlap', `${dispatch.round}.plan.json`), 'utf8'));
  assert.deepEqual(plan.running.map((x) => x.id), [ID1], "the awaiting-ci ticket's planned files are running");
  const out = JSON.parse(readFileSync(join(h.W, 'overlap', `${dispatch.round}.json`), 'utf8'));
  assert.deepEqual(out.wait.map((x) => x.id), [ID3]);
  assert.equal(stage(h, ID3), 'candidate', "the overlap with #1's planned files holds #3 back");
});

test('#196 F1: a red PR head goes to a fix round, and the re-queued ticket re-runs the push phase and delivers', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  let red = true;
  h.ci = () => (red ? 'red' : 'green');
  h.policy['pr-red'] = () => {
    red = false; // the fix round turns CI green from here on
    return 'fix';
  };
  h.untilDone();
  assert.equal(stage(h, ID1), 'delivered');
  assert.equal(stage(h, ID2), 'delivered');
  const s = h.state();
  assert.equal(s.tickets[ID1].fixRounds, 1, 'the red PR head cost one fix round');
  assert.deepEqual(
    s.tickets[ID1].history.map((x) => x.to).slice(-8),
    ['awaiting-ci', 'fixing', 'in-review', 'queued', 'integrating', 'awaiting-ci', 'awaiting-merge', 'delivered'],
    'awaiting-ci → fixing → the recheck → queued → the push phase again',
  );
  // the re-queued round is a new pr-sync attempt, not the spent exec id (review F1)
  const syncs = distinct(h.log).filter((a) => a.step === 'pr-merge' && a.tickets[0] === ID1).map((a) => a.id);
  assert.deepEqual(syncs, [`pr-sync:${ID1}:1`, `pr-sync:${ID1}:2`]);
  assert.equal(s.tickets[ID1].merges.at(-1).sha, h.prs[s.tickets[ID1].branch].mergeOid, 'the fixed ticket delivered through its PR');
});

// ---- integrate: ticket-pr — the red-light handling (#197) ----------------------------------------------------------

test('#197: a red PR head saves the failing run with gh run view --log-failed, points the fix round at it, pushes the fix to the same PR and reads the new head; no earliest-red', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1] = h.ids;
  let red = true;
  h.ci = (branch) => {
    if (branch === 'main') return 'green';
    return red && branch === h.state().tickets[ID1].branch ? 'red' : 'green';
  };
  h.policy['pr-red'] = (a) => {
    h.prRedJudge = a;
    red = false; // the fix round turns the PR head green from here on
    return 'fix';
  };
  h.untilDone();
  assert.equal(stage(h, ID1), 'delivered');
  const s = h.state();
  assert.equal(s.tickets[ID1].fixRounds, 1, 'the red PR head cost one fix round, under the ticket fix-round cap');
  const log = h.log;
  const once = distinct(log);

  // the failing run's output is saved first, from the verdict's `failed` ids, before the pr-red judge
  const saves = once.filter((a) => a.step === 'ci-log');
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].argv.slice(0, 5), ['gh', 'run', 'view', '7', '--log-failed']);
  assert.equal(readFileSync(saves[0].stdout, 'utf8'), 'log of run 7\n');
  assert.deepEqual(h.prRedJudge.meta.failure, [saves[0].stdout], 'the judge names the saved output');
  assert.ok(log.findIndex((a) => a.step === 'ci-log') < log.findIndex((a) => a.step === 'pr-red'), 'the save runs before the judge');

  // the fix round goes to the original agent, pointed at the failing output, not at review findings
  const send = once.find((a) => a.step === 'send' && a.tickets[0] === ID1);
  assert.ok(send, 'the fix round is a SendMessage to the original agent');
  assert.match(send.do, /the PR head's CI is red at [0-9a-f]{40}; the failing runs' output is in /);
  assert.ok(send.do.includes(saves[0].stdout), 'the brief names the saved file');
  assert.doesNotMatch(send.do, /review's findings/);
  const rec2 = once.find((a) => a.id === `rec:${ID1}:2`);
  assert.equal(rec2.argv[rec2.argv.indexOf('--limit') + 1], '20', 'the fix round runs under the timeout-fix limit');

  // the fix commit is pushed back to the same pull request (integrate.mjs pr-push), and the verdict read at the new head
  assert.ok(once.some((a) => a.step === 'pr-push' && a.tickets[0] === ID1), 'the fix commit goes back via pr-push');
  assert.equal(once.filter((a) => a.step === 'pr-open' && a.tickets[0] === ID1).length, 1, 'the same PR: no second pr-open');
  const reads = once.filter((a) => a.step === 'ci-read' && a.id.startsWith(`pr-ci:${ID1}@`));
  const heads = [...new Set(reads.map((a) => a.argv.at(-1)))];
  assert.equal(heads.length, 2, 'the verdict is read at the red head and again at the pushed fix head');
  assert.equal(reads.at(-1).argv.at(-1), git(h.repo, 'rev-parse', `origin/${s.tickets[ID1].branch}`), 'the second read is at the pushed head');

  // a PR-head red never invokes ci.mjs earliest-red, and nothing is reverted
  assert.ok(once.every((a) => a.step !== 'base-scan' && a.step !== 'revert' && !(a.argv ?? []).includes('earliest-red')), 'no earliest-red, no revert');
});

test('#197: a base that turns red after a merge maps the red to the causing ticket, opens the revert PR, merges it as a prompting call after its own CI is green, and the dependents await a ruling', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.S('set', ID2, '--waiting-on', ID1);
  h.blockers[ID2] = [ID1];
  const initSha = git(h.repo, 'rev-parse', 'origin/main');
  let reverted = false;
  h.ci = (branch, sha) => {
    if (branch !== 'main') return 'green'; // the ticket PR heads and the revert branch are green
    return !reverted && sha !== initSha && h.state().tickets[ID1].merges.length ? 'red' : 'green';
  };
  h.policy['revert-send'] = (a) => {
    h.revertSend = a;
    h.mergeBranch(a.meta.branch); // the merge of the revert PR
    git(h.repo, 'fetch', '-q', 'origin');
    reverted = true;
    return 'sent';
  };
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends');
  const s = h.state();
  assert.equal(s.tickets[ID1].stage, 'stuck');
  assert.match(s.tickets[ID1].reason, /^base CI red at [0-9a-f]{40}; reverted /);
  assert.equal(s.tickets[ID2].stage, 'awaiting-ruling', 'the dependent gets the upstream-reverted handling');
  assert.match(s.tickets[ID2].reason, /^upstream reverted: #1 \([0-9a-f]{40}\)$/);
  const once = distinct(h.log);

  // the mapping: ci.mjs base read the red, the earliest-red scan ran against the base, and the plan carried the merges
  const scan = once.find((a) => a.step === 'base-scan');
  assert.ok(scan, 'the earliest-red scan runs against the base');
  const plan = JSON.parse(readFileSync(scan.argv.at(-1), 'utf8'));
  assert.equal(plan.line, 'main');
  assert.deepEqual(plan.tickets.map((x) => x.id), [ID1]);
  assert.deepEqual(plan.tickets[0].merges, s.tickets[ID1].merges.map((m) => m.sha), 'the red maps by merge SHA');
  const scanOut = JSON.parse(readFileSync(scan.stdout, 'utf8'));
  assert.equal(scanOut.earliestRed, s.tickets[ID1].merges[0].sha, 'the earliest red is the causing merge');

  // integrate.mjs revert ran with the dependent, opened the revert PR against the base, and never pushed the base
  const revert = once.find((a) => a.step === 'revert');
  assert.ok(revert.argv.includes('--dependent') && revert.argv.includes(ID2));
  assert.equal(revert.argv[revert.argv.indexOf('--base') + 1], 'main');
  const rv = JSON.parse(readFileSync(revert.stdout, 'utf8'));
  assert.deepEqual(rv.push, { status: 'revert-pr', branch: rv.revertBranch });
  assert.equal(h.prs[rv.revertBranch].base, 'main', 'the revert PR targets the base branch');
  assert.equal(rv.pr, h.prs[rv.revertBranch].number);
  assert.deepEqual(rv.dependents.map((d) => [d.ticket, d.treatment, d.stage]), [[ID2, 'in-flight', 'awaiting-ruling']]);

  // ruling 2: the revert PR's own CI is read first; green brings the prompting call, with no review
  assert.ok(h.log.findIndex((a) => a.step === 'ci-read' && a.id.startsWith(`revert-ci:${ID1}@`)) < h.log.findIndex((a) => a.step === 'revert-send'), 'CI green comes before the merge is sent');
  assert.equal(h.revertSend.meta.command, `gh pr merge ${rv.pr}`);
  assert.match(h.revertSend.do, /no review \(ruling 2\)/);
  assert.match(h.revertSend.do, /never --admin, never auto-merge/);
  assert.ok(h.revertSend.outcomes.includes('sent') && h.revertSend.outcomes.includes('left-for-human'));

  // the finish waits for the episode: the wrap-up comes after the merge was sent and the base was read again at the
  // revert's tip (a new read: the read is keyed by the base tip)
  const sendAt = h.log.findIndex((a) => a.step === 'revert-send');
  const reread = h.log.findIndex((a, i) => i > sendAt && a.step === 'base-ci');
  assert.ok(reread > sendAt, 'the base is read again after the revert PR is merged');
  assert.ok(h.log.findIndex((a) => a.id === 'wrap-up') > reread, 'the finish waits for the base-red episode');
  assert.ok(!h.state().tick.baseRed, 'the episode is over once the base reads green');
});

test('#197 review F1: a base still red after the first revert re-opens the episode and reverts the second causing ticket', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  const isAncestor = (a, b) => {
    try {
      git(h.repo, 'merge-base', '--is-ancestor', a, b);
      return true;
    } catch {
      return false;
    }
  };
  // both tickets' merges break the base; a merge stops counting once its revert PR is merged
  h.revertedTickets = new Set();
  const broken = () =>
    [ID1, ID2]
      .filter((id) => !h.revertedTickets.has(id))
      .map((id) => h.state().tickets[id].merges.at(-1)?.sha)
      .filter(Boolean);
  h.ci = (branch, sha) => {
    if (branch !== 'main') return 'green'; // the PR heads and the revert branches are green
    return broken().some((m) => m === sha || isAncestor(m, sha)) ? 'red' : 'green';
  };
  h.policy['revert-send'] = (a) => {
    (h.revertSends ??= []).push(a);
    h.mergeBranch(a.meta.branch); // the merge of the revert PR
    git(h.repo, 'fetch', '-q', 'origin');
    h.revertedTickets.add(a.tickets[0]);
    return 'sent';
  };
  for (let i = 0; i < 14 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends');
  const s = h.state();
  assert.equal(s.tickets[ID1].stage, 'stuck');
  assert.equal(s.tickets[ID2].stage, 'stuck');
  // each breaking merge got its own revert exec and its own revert PR: the episode re-opened at the second red
  const reverts = h.log.filter((a) => a.step === 'revert');
  assert.deepEqual(reverts.map((a) => a.tickets[0]).sort(), [ID1, ID2].sort(), 'both causing tickets are reverted');
  assert.equal((h.revertSends ?? []).length, 2, 'two revert PRs went out');
  const sendIdx = h.log.findIndex((a) => a.step === 'revert-send');
  const firstTicket = h.log.find((a) => a.step === 'revert').tickets[0];
  const secondIdx = h.log.findIndex((a) => a.step === 'revert' && a.tickets[0] !== firstTicket);
  assert.ok(secondIdx > sendIdx, "the second causing ticket's revert comes after the first revert was sent");
  assert.ok(!s.tick.baseRed, 'the episode closes once the base is green');
});

test('#197 review F2+F3: a base already red below the merges goes to the host, not a revert; after settled the base is read until green and the run finishes', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.blockers[ID2] = [ID1]; // #2 starts only after #1 is done: the episode opens while #2 is still open
  let outsideRed = false;
  h.ci = (branch) => (branch === 'main' && outsideRed ? 'red' : 'green');
  h.policy['base-red-unmatched'] = (a) => {
    (h.unmatchedJudges ??= []).push(a);
    return 'settled';
  };
  for (let i = 0; i < 8 && stage(h, ID1) !== 'delivered'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'delivered');
  outsideRed = true; // the base turns red from outside the run: red at every SHA, the lower bound included
  h.wake();
  assert.equal(h.unmatchedJudges.length, 1, 'the pre-existing red goes to the host');
  assert.match(h.unmatchedJudges[0].do, /the base was already red at [0-9a-f]{40}, below this run's oldest merge/);
  assert.ok(h.log.every((a) => a.step !== 'revert'), 'no ticket is reverted for a red that pre-dates the merges (F3)');
  assert.equal(h.state().tickets[ID1].stage, 'delivered', 'the innocent ticket keeps its delivery');
  // settled while still red: the next wake-up reads the base again (F2), and the judge is not issued again
  h.wake();
  assert.equal(h.actions(h.wakes.at(-1)).filter((a) => a.step === 'base-ci').length, 1, 'the base is read again after settled while still red');
  assert.equal(h.unmatchedJudges.length, 1, 'the settled judge is not issued again at the same red');
  // the base turns green: the episode closes, #2 goes on to deliver, and the run finishes
  outsideRed = false;
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run reaches finished once the base is green');
  assert.equal(stage(h, ID2), 'delivered');
  assert.ok(!h.state().tick.baseRed, 'the episode is closed');
  assert.ok(h.log.every((a) => a.step !== 'revert'), 'still no revert');
});

test('#222: an open base-red episode pauses new push phases: a ticket reviewed meanwhile waits at queued until the base is green', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  let outsideRed = false;
  h.ci = (branch) => (branch === 'main' && outsideRed ? 'red' : 'green');
  h.policy['base-red-unmatched'] = () => 'settled';
  const release = holdWork(h, ID2); // #2 reports only once the episode is open
  for (let i = 0; i < 8 && stage(h, ID1) !== 'delivered'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'delivered');
  assert.equal(stage(h, ID2), 'implementing');
  outsideRed = true; // the base turns red: the episode opens, and settled keeps it open while the base stays red
  h.wake();
  assert.ok(h.state().tick.baseRed, 'the episode is open');
  release();
  for (let i = 0; i < 3; i += 1) h.wake();
  assert.equal(stage(h, ID2), 'queued', 'reviewed, then held at queued');
  assert.ok(h.log.every((a) => !(a.step === 'pr-merge' && a.tickets[0] === ID2)), 'no push phase starts while the base is red');
  // the base turns green: the episode closes, and the push phase of #2 runs on to delivery
  outsideRed = false;
  const greenAt = h.log.length;
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(stage(h, ID2), 'delivered');
  assert.ok(h.log.findIndex((a, i) => i >= greenAt && a.step === 'pr-merge' && a.tickets[0] === ID2) >= greenAt, 'the push phase runs once the base is green');
});

test('#197 review observation: a revert PR left for a person does not hold the finish; the merge is on the human-work list', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1] = h.ids;
  const initSha = git(h.repo, 'rev-parse', 'origin/main');
  h.ci = (branch, sha) => (branch === 'main' && sha !== initSha && h.state().tickets[ID1].merges.length ? 'red' : 'green');
  h.policy['revert-send'] = (a) => {
    h.revertSend = a;
    return 'left-for-human';
  };
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends with the revert PR left for a person');
  assert.ok(h.revertSend, 'the revert merge went to the host');
  assert.equal(h.state().tickets[ID1].stage, 'stuck');
  assert.ok(h.state().tick.baseRed.left, 'the episode records the revert as left for a person');
});

// ---- integrate: ticket-pr — upstreams: stacked, or waiting-upstream (#198) ------------------------------------------

/** #198: the freeze's preflight with the gh-stack check passed (#189), as freeze.json records it. */
const freezeWithStack = (h, stack = true) => write(join(h.W, 'freeze.json'), `${JSON.stringify({ preflight: { ok: true, checks: [{ name: 'gh-stack', ok: true, stack }] } })}\n`);

// ---- integrate: ticket-pr — the waiting stages' failure face (#220) ------------------------------------------------

const unreadables = (h) => distinct(h.log).filter((a) => a.step === 'unreadable');

test('#220: a PR head CI read that stays query-failed brings an unreadable judge at the third wake-up in a row; a readable wake-up starts the count again; wait counts again, stuck ends it', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1] = h.ids;
  let ci1 = 'running';
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? ci1 : 'green');
  for (let i = 0; i < 6 && stage(h, ID1) !== 'awaiting-ci'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'awaiting-ci');
  ci1 = 'query-failed';
  h.wake();
  h.wake();
  assert.equal(unreadables(h).length, 0, 'two wake-ups in a row: no judge yet');
  ci1 = 'running'; // a readable wake-up: the condition is gone, the count starts again
  h.wake();
  ci1 = 'query-failed';
  h.wake();
  h.wake();
  assert.equal(unreadables(h).length, 0, 'the count started again after the readable wake-up');
  let answer = 'wait';
  h.policy.unreadable = () => answer;
  h.wake();
  assert.equal(unreadables(h).length, 1, 'the third wake-up in a row brings the judge');
  const [j1] = unreadables(h);
  assert.deepEqual(j1.tickets, [ID1]);
  assert.deepEqual(j1.outcomes, ['wait', 'stuck']);
  assert.deepEqual([j1.meta.subject, j1.meta.kind, j1.meta.n], [ID1, 'query-failed', 3]);
  assert.match(j1.do, /could not read its PR head [0-9a-f]{40}: query-failed/);
  assert.equal(stage(h, ID1), 'awaiting-ci', 'wait goes on waiting');
  h.wake();
  h.wake();
  assert.equal(unreadables(h).length, 1, 'after wait the count starts again: two more wake-ups bring nothing');
  answer = 'stuck';
  h.wake();
  const all = unreadables(h);
  assert.equal(all.length, 2, 'three more wake-ups in a row bring it again');
  assert.notEqual(all[1].id, j1.id, 'a new trigger is a new judge');
  assert.equal(stage(h, ID1), 'stuck');
  // ruling 4: every trigger is in the state, with its outcome
  const log = h.state().tick.judgeLog.filter((x) => x.step === 'unreadable');
  assert.deepEqual(log.map((x) => [x.id, x.kind, x.n, x.outcome]), [[j1.id, 'query-failed', 3, 'wait'], [all[1].id, 'query-failed', 3, 'stuck']]);
  assert.ok(log.every((x) => x.at && x.decided && Number.isInteger(x.wakeup)));
});

test('#220: a ticket branch gone from the repository at awaiting-ci is counted as ref-missing; stuck lets the line go on', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  let ci1 = 'running';
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? ci1 : 'green');
  for (let i = 0; i < 6 && stage(h, ID1) !== 'awaiting-ci'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'awaiting-ci');
  git(h.repo, 'update-ref', '-d', `refs/heads/${h.state().tickets[ID1].branch}`);
  h.policy.unreadable = () => ({ outcome: 'stuck', value: 'the ticket branch is gone' });
  h.wake();
  h.wake();
  assert.equal(unreadables(h).length, 0);
  h.wake();
  const [j] = unreadables(h);
  assert.deepEqual([j.meta.subject, j.meta.kind, j.meta.n], [ID1, 'ref-missing', 3]);
  assert.equal(stage(h, ID1), 'stuck');
  assert.equal(h.state().tickets[ID1].reason, 'the ticket branch is gone');
  ci1 = 'green';
  assert.equal(h.untilDone()?.then, 'done', 'the run goes on and ends');
  assert.equal(stage(h, ID2), 'delivered');
});

test('#220: a ticket branch whose tip stays out of step with origin at awaiting-ci is counted as tip-unsynced; wait, and the merge goes on once it is in step', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1] = h.ids;
  let ci1 = 'running';
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? ci1 : 'green');
  for (let i = 0; i < 6 && stage(h, ID1) !== 'awaiting-ci'; i += 1) h.wake();
  assert.equal(stage(h, ID1), 'awaiting-ci');
  const branch = h.state().tickets[ID1].branch;
  const tip = git(h.repo, 'rev-parse', branch);
  const behind = git(h.repo, 'rev-parse', `${tip}~1`);
  // origin's copy falls one commit behind, and the push that would put it right does not land
  const exec = h.exec;
  h.exec = (a) => (a.step === 'pr-push' && a.tickets[0] === ID1 ? 0 : exec(a));
  git(h.repo, 'update-ref', `refs/remotes/origin/${branch}`, behind);
  h.policy.unreadable = () => 'wait';
  h.wake();
  h.wake();
  assert.equal(unreadables(h).length, 0, 'two wake-ups in a row: no judge yet');
  h.wake();
  const [j] = unreadables(h);
  assert.ok(j, 'the third wake-up in a row brings the judge');
  assert.deepEqual([j.meta.subject, j.meta.kind, j.meta.n], [ID1, 'tip-unsynced', 3]);
  assert.deepEqual(j.tickets, [ID1]);
  assert.ok(j.do.includes(`is at ${tip} here and at ${behind} on origin`), j.do);
  assert.equal(stage(h, ID1), 'awaiting-ci', 'wait goes on waiting');
  // in step again: the count is dropped and the merge path goes on
  h.exec = exec;
  git(h.repo, 'update-ref', `refs/remotes/origin/${branch}`, tip);
  ci1 = 'green';
  h.wake();
  assert.ok(!h.state().tick.unreadable?.[ID1], 'the count is dropped once the tip is in step');
  assert.equal(h.untilDone()?.then, 'done', 'the run goes on and ends');
  assert.equal(stage(h, ID1), 'delivered');
  assert.deepEqual(h.state().tick.judgeLog.filter((x) => x.step === 'unreadable').map((x) => [x.kind, x.outcome]), [['tip-unsynced', 'wait']]);
});

test('#220: a queued ticket that is not stacked with no PR recorded is counted as no-pr, and stuck ends the run', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  // the agents commit nothing: green with no commit opens no PR (#195), and the ticket reaches queued without one
  h.work = (agent) => h.reportsNext.push(agent);
  const report = h.agentReport;
  h.agentReport = (a) => report(a).replace(/^commit: .*$/m, 'commit: none');
  h.policy.unreadable = (a) => ({ outcome: 'stuck', value: `no PR: ${a.tickets[0]}` });
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends instead of waiting in silence');
  const js = unreadables(h);
  assert.deepEqual(js.map((a) => a.tickets[0]).sort(), [ID1, ID2]);
  assert.ok(js.every((a) => a.meta.kind === 'no-pr' && a.meta.n === 3), JSON.stringify(js.map((a) => a.meta)));
  assert.match(js[0].do, /is queued for its merge, but it has no pull request recorded/);
  for (const id of [ID1, ID2]) {
    assert.equal(stage(h, id), 'stuck');
    assert.equal(h.state().tickets[id].reason, `no PR: ${id}`);
  }
  // the judge came at the third wake-up the ticket was seen queued with no PR
  const queuedAt = (id) => h.wakes.findIndex((outs) => outs.some((o) => o.actions.some((a) => a.tickets?.includes(id) && a.step === 'unreadable')));
  const firstQueued = (id) => h.state().tick.judgeLog.find((x) => x.tickets[0] === id).wakeup;
  for (const id of [ID1, ID2]) assert.ok(queuedAt(id) >= 0 && firstQueued(id) >= 3, `${id}: logged at wake-up ${firstQueued(id)}`);
});

test('#220: a PR closed without a merge brings a pr-closed judge apart from the merge queue wait; reopen hands the merge back, stuck ends the ticket', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  const sends = [];
  h.policy['pr-send'] = (a) => {
    const id = a.tickets[0];
    sends.push(id);
    if (sends.filter((x) => x === id).length === 1) {
      h.prs[h.state().tickets[id].branch].closed = true; // someone closes the PR instead of merging it
      return 'sent';
    }
    h.mergePr(id);
    return 'sent';
  };
  const closedJudges = [];
  h.policy['pr-closed'] = (a) => {
    closedJudges.push(a);
    if (a.tickets[0] === ID1) {
      h.prs[h.state().tickets[ID1].branch].closed = false; // the host reopens it
      return 'reopen';
    }
    return { outcome: 'stuck', value: 'closed on purpose' };
  };
  assert.equal(h.untilDone()?.then, 'done');
  assert.equal(stage(h, ID1), 'delivered', 'reopened, merged and delivered');
  assert.equal(stage(h, ID2), 'stuck');
  assert.equal(h.state().tickets[ID2].reason, 'closed on purpose');
  assert.deepEqual(closedJudges.map((a) => a.tickets[0]).sort(), [ID1, ID2], 'one pr-closed judge per closed PR');
  assert.ok(closedJudges.every((a) => a.outcomes.join() === 'reopen,stuck' && a.do.includes(`gh pr reopen ${a.meta.pr}`)));
  assert.equal(sends.filter((x) => x === ID1).length, 2, 'reopen hands the merge back as its prompting call');
  const merged = distinct(h.log).filter((a) => a.step === 'pr-merged');
  assert.ok(merged.every((a) => a.okExit.includes(3) && a.okExit.includes(6)));
  const log = h.state().tick.judgeLog.filter((x) => x.step === 'pr-closed');
  assert.deepEqual(log.map((x) => [x.tickets[0], x.outcome]).sort(), [[ID1, 'reopen'], [ID2, 'stuck']]);
});

test('#220: a fix round that pushes nothing and reads red again at the same head brings the pr-red judge again', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.blockers[ID2] = [ID1]; // #2 starts after #1: the base does not move, so the push phase brings no new head
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? 'red' : 'green');
  let quiet = false;
  const work = h.work;
  h.work = (agent, tid) => (quiet && tid === ID1 ? h.reportsNext.push(agent) : work(agent, tid)); // the fix commits nothing
  const reds = [];
  h.policy['pr-red'] = (a) => {
    reds.push(a);
    if (reds.length === 1) {
      quiet = true;
      return 'fix';
    }
    return { outcome: 'stuck', value: 'red again at the same head' };
  };
  for (let i = 0; i < 10 && reds.length < 2; i += 1) h.wake();
  assert.equal(reds.length, 2, 'the second red at the same head brings the judge again');
  assert.equal(reds[0].meta.sha, reds[1].meta.sha, 'at the same head');
  assert.deepEqual(reds.map((a) => a.id.replace(/@[0-9a-f]{12}/, '@<head>')), [`pr-red:${ID1}@<head>:f0`, `pr-red:${ID1}@<head>:f1`]);
  assert.equal(stage(h, ID1), 'stuck');
  const log = h.state().tick.judgeLog.filter((x) => x.step === 'pr-red');
  assert.deepEqual(log.map((x) => [x.id, x.outcome]), reds.map((a, i) => [a.id, i ? 'stuck' : 'fix']));
});

test('#220: a base-red rev-list that keeps failing brings an unreadable judge on the base at the third wake-up in a row; wait, and the mapping goes on once it reads', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.S('set', ID2, '--waiting-on', ID1);
  h.blockers[ID2] = [ID1];
  const initSha = git(h.repo, 'rev-parse', 'origin/main');
  let reverted = false;
  h.ci = (branch, sha) => {
    if (branch !== 'main') return 'green';
    return !reverted && sha !== initSha && h.state().tickets[ID1].merges.length ? 'red' : 'green';
  };
  h.policy['revert-send'] = (a) => {
    h.mergeBranch(a.meta.branch);
    git(h.repo, 'fetch', '-q', 'origin');
    reverted = true;
    return 'sent';
  };
  // tick's own git: the stretch's rev-list fails until the judge is answered
  let failing = true;
  const failedAt = new Set();
  const deps = defaultDeps();
  const realGit = deps.git;
  const flaky = {
    ...deps,
    git: (cwd, args, env) => {
      if (failing && args[0] === 'rev-list' && args[1] === '--first-parent' && args.length === 3) {
        failedAt.add(h.wakes.length);
        throw new Error('rev-list failed');
      }
      return realGit(cwd, args, env);
    },
  };
  h.tick = (...args) => tick([...args, '--now', h.iso()], flaky);
  h.policy.unreadable = (a) => {
    h.baseJudge = a;
    h.failedBefore = failedAt.size;
    failing = false;
    return 'wait';
  };
  for (let i = 0; i < 12 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends');
  assert.ok(h.baseJudge, 'the unreadable judge on the base came');
  assert.deepEqual([h.baseJudge.meta.subject, h.baseJudge.meta.kind, h.baseJudge.meta.n], ['base', 'rev-list', 3]);
  assert.deepEqual(h.baseJudge.tickets, []);
  assert.equal(h.failedBefore, 3, 'at the third wake-up in a row of the failing rev-list');
  assert.match(h.baseJudge.do, /git could not walk [0-9a-f]{40}\.\.[0-9a-f]{40}/);
  // once rev-list reads, the red is mapped and reverted as ever
  assert.equal(stage(h, ID1), 'stuck');
  assert.ok(h.log.findIndex((a) => a.step === 'revert') > h.log.findIndex((a) => a.step === 'unreadable'), 'the revert follows the judge');
  assert.deepEqual(h.state().tick.judgeLog.filter((x) => x.step === 'unreadable').map((x) => [x.subject, x.outcome]), [['base', 'wait']]);
  assert.ok(!h.state().tick.unreadable?.base, 'the count is dropped once the stretch reads');
});

test('#198: a ticket with one unmerged upstream is stacked on it once it has a branch: cut from the upstream branch, gh stack init + add, the PR via gh stack submit on the upstream branch', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  freezeWithStack(h);
  h.blockers[ID2] = [ID1];
  // #1's PR head CI keeps running: it stays unmerged while #2 builds on it
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch ? 'running' : 'green');
  h.wake(); // the first dispatch point: #1 starts; once its branch is there, #2 is stacked on it at the same point
  let s = h.state();
  assert.equal(s.tickets[ID1].stage, 'implementing');
  assert.equal(s.tickets[ID2].stage, 'implementing', '#2 starts while its upstream is under way');
  assert.ok(s.tickets[ID2].history.some((x) => x.to === 'waiting-upstream'), 'it waited while #1 had no branch');
  assert.equal(s.tickets[ID2].stackParent, ID1);
  assert.deepEqual(s.tickets[ID2].waitingOn, []);
  assert.ok(!h.log.some((a) => a.id === 'gh-stack-missing'), 'gh stack passed the freeze: no install judge');
  const b1 = s.tickets[ID1].branch;
  const b2 = s.tickets[ID2].branch;
  const stackCalls = h.ghCalls.filter((x) => x[0] === 'stack').map((x) => x.slice(0, 3).join(' '));
  assert.ok(stackCalls.includes(`stack init ${b1}`) && stackCalls.includes(`stack add ${b2}`), stackCalls.join('; '));
  for (let i = 0; i < 3; i += 1) h.wake();
  s = h.state();
  assert.equal(s.tickets[ID1].stage, 'awaiting-ci');
  assert.equal(s.tickets[ID2].stage, 'queued', 'the reviewed stacked ticket waits in queued: its merge goes up the stack');
  assert.equal(h.prs[b2].base, b1, "#2's PR is stacked on #1's branch");
  assert.ok(h.ghCalls.some((x) => x[0] === 'stack' && x[1] === 'submit'), 'the stacked PR is opened with gh stack submit --auto');
  assert.ok(!h.ghCalls.some((x) => x[0] === 'pr' && x[1] === 'create' && x.includes(b2)), 'never gh pr create for the stacked ticket');
  // the review tier and the fixed point of the stacked ticket are its upstream branch
  const tier = distinct(h.log).find((a) => a.step === 'tier' && a.tickets[0] === ID2);
  assert.equal(tier.argv[tier.argv.indexOf('--base') + 1], b1);
});

test('#198: without gh stack a ticket with an unmerged upstream waits for it to merge (waiting-upstream), one install judge; then it starts from the new base', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  freezeWithStack(h, false);
  h.blockers[ID2] = [ID1];
  h.untilDone();
  for (let i = 0; i < 6 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
  const s = h.state();
  assert.equal(s.tickets[ID1].stage, 'delivered');
  assert.equal(s.tickets[ID2].stage, 'delivered');
  assert.ok(s.tickets[ID2].history.some((x) => x.to === 'waiting-upstream'), '#2 waited for its upstream');
  assert.equal(s.tickets[ID2].stackParent, null, 'never stacked');
  assert.equal(distinct(h.log).filter((a) => a.id === 'gh-stack-missing').length, 1, 'the install goes on the human-work list once');
  // #2 started only after #1 merged, from the new base: #1's merge is in #2's history
  const startAt = s.tickets[ID2].history.findIndex((x) => x.to === 'implementing');
  assert.ok(s.tickets[ID2].history[startAt].at >= s.tickets[ID1].history.find((x) => x.to === 'delivered').at);
  git(h.repo, 'merge-base', '--is-ancestor', s.tickets[ID1].merges[0].sha, s.tickets[ID2].merges[0].sha);
});

// ---- integrate: ticket-pr — the stack merges from the bottom up (#199) ---------------------------------------------

/** #199: #2 stacked on #1, #1's PR head CI held running until #2 has passed its review. */
function stackedPair(t) {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  freezeWithStack(h);
  h.blockers[ID2] = [ID1];
  h.ci = (branch) => (branch === h.state().tickets[ID1].branch && !['queued', 'integrating', 'awaiting-ci', 'awaiting-merge', 'delivered'].includes(stage(h, ID2)) ? 'running' : 'green');
  h.sends = [];
  h.policy['pr-send'] = (a) => {
    h.sends.push({ ticket: a.tickets[0], command: a.meta.command, upstream: stage(h, ID1) });
    h.mergePr(a.tickets[0]);
    return 'sent';
  };
  return h;
}

test('#199: a stack merges from the bottom up with gh stack merge; the rebase that keeps the patch keeps the review', (t) => {
  const h = stackedPair(t);
  const [ID1, ID2] = h.ids;
  for (let i = 0; i < 10 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends');
  const s = h.state();
  assert.equal(s.tickets[ID1].stage, 'delivered');
  assert.equal(s.tickets[ID2].stage, 'delivered');
  // bottom first: #1's merge is sent while #2 waits in queued; #2's after #1 is merged; both with gh stack merge
  assert.deepEqual(h.sends.map((x) => x.ticket), [ID1, ID2]);
  assert.equal(h.sends[0].command, `gh stack merge ${s.tickets[ID1].pr} --yes --squash`, 'a PR with a stacked PR on it merges with gh stack merge');
  assert.equal(h.sends[1].command, `gh stack merge ${s.tickets[ID2].pr} --yes --squash`);
  assert.equal(h.sends[1].upstream, 'delivered', "#2's merge goes out once #1 is merged");
  // #2's sync (the rebase) came after #1's merge, and its own patch did not change: one review, no recheck
  assert.ok(h.syncs >= 1, 'the stacked ticket was synced');
  assert.equal(s.tickets[ID2].reviews.length, 1, 'the review is kept across the rebase');
  const patches = distinct(h.log).filter((a) => a.step === 'patch-id' && a.tickets[0] === ID2);
  assert.equal(patches.length, 2, 'patch-id at the passed review and after the sync');
  const [p1, p2] = patches.map((a) => JSON.parse(readFileSync(a.stdout, 'utf8')));
  assert.equal(p1.from, s.tickets[ID1].branch, 'at the review: against the upstream branch');
  assert.equal(p2.from, 'origin/main', 'after the upstream merged: against the base');
  assert.ok(p1.patchId && p1.patchId === p2.patchId);
  assert.ok(git(h.repo, 'merge-base', '--is-ancestor', s.tickets[ID1].merges[0].sha, s.tickets[ID2].merges[0].sha) === '', '#2 merged on top of #1');
  // every merged ticket of the stack gets the close check (#196)
  for (const id of [ID1, ID2]) assert.ok(h.log.some((a) => a.id === `issue-state:${id}`), `${id}'s issue is checked`);
});

test('#199: a rebase that changes the stacked ticket\'s own patch sends it to a recheck before CI, with the tier of its initial review', (t) => {
  const h = stackedPair(t);
  const [, ID2] = h.ids;
  h.stackSync = (cwd) => {
    git(cwd, 'fetch', '-q', 'origin');
    git(cwd, 'rebase', '-q', 'origin/main');
    if ((h.resolved = (h.resolved ?? 0) + 1) > 1) return ''; // the first sync changes the patch; a later one nothing
    write(join(cwd, 'b.js'), 'changed while resolving the rebase\n');
    git(cwd, 'commit', '-q', '-am', 'resolve');
    return '';
  };
  for (let i = 0; i < 12 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the run ends');
  const s = h.state();
  assert.equal(s.tickets[ID2].stage, 'delivered');
  assert.equal(s.tickets[ID2].reviews.length, 2, 'the changed patch costs a recheck');
  assert.equal(s.tickets[ID2].reviews[1].mode, 'recheck');
  const back = s.tickets[ID2].history.findIndex((x) => x.from === 'integrating' && x.to === 'in-review');
  assert.ok(back > 0, 'integrating → in-review');
  const tiers = distinct(h.log).filter((a) => a.step === 'tier' && a.tickets[0] === ID2);
  assert.equal(tiers.length, 1, 'the recheck keeps the tier of the initial review');
});

// ---- one record call for a batch's results (the host's calls each read its whole context again) ---------------------

test('record takes several results joined by +: a whole run recorded one batch per call ends as the one-by-one run does', (t) => {
  const one = world(t);
  one.untilDone();
  const many = world(t);
  many.batchRecords = true;
  many.untilDone();
  assert.equal(many.wakes.at(-1).at(-1).then, 'done');
  assert.ok(Math.max(...many.batchedRecords) > 1, 'some batch had several results recorded in one call');
  const ends = (h) => Object.fromEntries(Object.entries(h.state().tickets).map(([id, x]) => [id, [x.stage, x.merges.length, x.reviews.length]]));
  assert.deepEqual(ends(many), ends(one));
  assert.ok(many.batchedRecords.reduce((a, b) => a + b, 0) > many.batchedRecords.length, 'fewer record calls than results');
});

test('record with several results stops at the first refusal; the ones before it are recorded and failed names it', (t) => {
  const h = world(t);
  const out = JSON.parse(h.tick('next', h.path).out);
  const [first] = out.actions.filter((a) => a.kind === 'exec' && a.batch === 1);
  assert.ok(first, 'an exec to record');
  const r = h.tick('record', h.path, first.id, '--exit', '0', '+', 'no-such-action', '--outcome', 'x');
  assert.notEqual(r.code, 0);
  const o = JSON.parse(r.out);
  assert.deepEqual([o.records.length, o.failed], [1, { index: 1, id: 'no-such-action' }]);
  assert.ok(h.state().tick.done[first.id], 'the first is recorded');
});
