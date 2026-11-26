// node --test scripts/tick-review.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: the prove-it review host: its spawn file, counts, assignment record and time limit (#138, #142, #143).
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { main as tick } from '../src/skills/get-to-work/scripts/tick.mjs';
import { LINE, git, write, TICKETS_DIR, world, distinct, stage, briefOf } from './tick-world.mjs';
// ---- #138: the prove-it review is a spawn with a spawn file brief.mjs review filled -----------------------------------

/** The value lines a review host's spawn file for #1 carries (brief.mjs review's labels), every one filled. */
function reviewHostValues(h, { mode, tag, report, previous }) {
  const st = h.state();
  return [
    `- mode: ${mode}\n`,
    `- repo: ${resolve(h.repo)}\n`,
    '- tracker: GitHub (o/r)\n',
    `- ticket: #1; ticket face (the ticket text with its expansion blocks): ${resolve(h.W, 'tick', 'body', '1.md')}\n`,
    '- status record: the comment on o/r#1 whose first line is `<!-- sorry-matt:status -->`\n',
    `- acceptance snapshot: ${resolve(h.W, 'acceptance', '1.json')}; comparison: ${resolve(h.W, 'tick', 'against', `1-${tag}.json`)}\n`,
    `- fixed point: ${LINE}\n`,
    `- ticket branch: ${st.tickets['#1'].branch}\n`,
    `- targeted checks: source=commands.md; node --test by ${report.meta.agent} → green (commit c-${report.meta.agent} (branch ${st.tickets['#1'].branch}); the agent's report: ${resolve(report.meta.agentReport)})\n`,
    '- CI coverage: covered\n',
    `- previous review block: ${previous}\n`,
    '- reviewer: primary\n',
    `- scratchpad: ${resolve(h.dir, 'wts', 'review', '1')}\n`,
  ];
}

test('#138: a prove-it review is a foreground spawn whose spawn file brief.mjs review filled, at the initial review and the recheck', (t) => {
  const h = world(t);
  h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  assert.equal(h.untilDone().then, 'done');
  const reviews = h.log.filter((a) => a.step === 'review' && a.tickets[0] === '#1');
  assert.deepEqual(reviews.map((a) => [a.kind, a.meta.mode]), [['spawn', 'initial'], ['spawn', 'recheck']], 'no review judge is handed to the host');
  const collects = h.log.filter((a) => a.step === 'collect' && a.tickets[0] === '#1');
  assert.deepEqual(collects.map((a) => a.meta.stage), ['implementing', 'fixing']);
  for (const [k, a] of reviews.entries()) {
    assert.deepEqual(
      { type: a.spawn.subagent_type, background: a.spawn.background, description: a.spawn.description, fallback: a.spawn.fallback ?? null, outcomes: a.outcomes },
      { type: 'general-purpose', background: false, description: 'review #1', fallback: null, outcomes: ['pass', 'fix', 'stuck'] },
    );
    assert.match(a.record, /--agent <agent id> --outcome pass\|fix\|stuck/);
    // the list that first hands it out (a later batch) names what it waits for in that list
    const first = h.wakes.flat().flatMap((o) => o.actions).find((x) => x.id === a.id);
    const brief = h.log.find((x) => x.step === 'brief' && x.argv[2] === 'review' && first.after.includes(x.id));
    assert.ok(brief, `${a.id} waits for brief.mjs review: ${first.after}`);
    // and for the ticket face fetched again: in the same list, or (#139: fetched while the tier is judged) before it
    const body = `body:#1:review:${k + 1}`;
    assert.ok(first.after.includes(body) || h.log.findIndex((x) => x.id === body) < h.log.findIndex((x) => x.id === a.id), 'the ticket face is fetched again before the spawn');
    assert.ok(h.log.some((x) => x.id === body), `${body} ran`);
    const file = readFileSync(briefOf(a), 'utf8');
    assert.doesNotMatch(file, /\{[^{}]*\}/, 'no placeholder is left for the host');
    assert.ok(file.startsWith('你是審查主持 agent：'), 'REVIEWER.md fixed rules first');
    const expected = reviewHostValues(h, { mode: a.meta.mode, tag: k + 1, report: collects[k], previous: k ? 'in the status record' : 'none' });
    for (const line of expected) assert.ok(file.includes(line), `${a.id}: ${JSON.stringify(line)} in\n${file.slice(file.lastIndexOf('\n---\n'))}`);
  }
  // the review host is recorded as an agent of the run with the role word review
  const agents = Object.values(h.state().tick.agents).filter((x) => x.role === 'review');
  assert.equal(agents.length, h.log.filter((a) => a.step === 'review').length);
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => [r.kind, r.mode, r.verdict]), [['full', 'initial', 'fix'], ['full', 'recheck', 'pass']]);
});

test('#142: a review reporting observations or pre-existing gets one raw ticket; the recheck adds its new items to the same one', (t) => {
  const h = world(t);
  h.policy.review = (a) =>
    a.tickets[0] !== '#1' ? 'pass' : a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1', observations: 2, preExisting: 1 } : { outcome: 'pass', observations: 1, preExisting: 0 };
  const filed = [];
  h.policy.observations = (a) => {
    filed.push(a);
    if (a.id === 'observations:#1:2') {
      // the recheck's items go to the raw ticket of the initial review, not to another one
      const other = h.tick('record', h.path, a.id, '--outcome', 'filed', '--value', '#91');
      assert.equal(other.code, 3, 'another issue id is refused');
      assert.match(other.err, /#90/);
    }
    return { outcome: 'filed', value: '#90' };
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(stage(h, '#1'), 'delivered');
  assert.equal(stage(h, '#2'), 'delivered');
  // the counts are in the state, one pair per review
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => [r.mode, r.verdict, r.observations, r.preExisting]), [['initial', 'fix', 2, 1], ['recheck', 'pass', 1, 0]]);
  assert.deepEqual(h.state().tickets['#2'].reviews.map((r) => [r.observations, r.preExisting]), [[0, 0]]);
  // one judge per review with something to file, each handed out once; nothing for #2, whose review had none
  assert.deepEqual(filed.map((a) => [a.kind, a.id, a.tickets]), [['judge', 'observations:#1:1', ['#1']], ['judge', 'observations:#1:2', ['#1']]]);
  assert.equal(h.log.filter((a) => a.step === 'observations').length, 2);
  const [initial, recheck] = filed;
  // the initial review: open one raw ticket from the two sections of the review block in the status record
  assert.match(initial.do, /2 observations and 1 pre-existing/);
  assert.match(initial.do, /one raw ticket/);
  assert.ok(initial.do.includes('the comment on o/r#1 whose first line is `<!-- sorry-matt:status -->`'), initial.do);
  assert.match(initial.do, /`observations` and `pre-existing` sections/);
  assert.match(initial.record, /--outcome filed --value <issue id>$/);
  // the recheck: the new items go into the same raw ticket
  assert.match(recheck.do, /1 observation and 0 pre-existing/);
  assert.ok(recheck.do.includes('#90') && /not another/.test(recheck.do), recheck.do);
  // filing does not hold the ticket up: the initial review's fix round starts in the list that hands the judge out
  const list = h.wakes.flat().find((o) => o.actions.some((a) => a.id === 'observations:#1:1'));
  assert.ok(list.actions.some((a) => a.id.startsWith('stage:#1:fixing') && a.batch === 1), 'the fix round goes on beside it');
  // and the wrap-up comes after every filing
  const steps = h.log.map((a) => a.step);
  assert.ok(steps.lastIndexOf('observations') < steps.indexOf('wrap-up'));
});

test('#142: a prove-it review is recorded with both counts; a minimal review takes neither', (t) => {
  const h = world(t);
  let checked = 0;
  h.policy.review = (a) => {
    if (!checked++) {
      // #143: the template also says how a review host the Agent tool put in the background is recorded
      assert.match(a.record, /--agent <agent id> --outcome pass\|fix\|stuck \[--findings <id>,<id>\] --observations <n> --pre-existing <n> \[--candidates <n> --confirmed <n> --invalid <n> --blocking <n>\] \[--covered <n>\] {3}\(in the background: --agent <agent id> alone\)$/);
      for (const missing of [[], ['--observations', '1'], ['--pre-existing', '0']]) {
        const r = h.tick('record', h.path, a.id, '--agent', 'x', '--outcome', 'pass', ...missing);
        assert.equal(r.code, 2, `without ${missing.length ? 'one' : 'both'}`);
        assert.match(r.err, /--observations <n> --pre-existing <n>/);
      }
      assert.equal(h.state().tickets[a.tickets[0]].reviews.length, 0, 'nothing recorded');
    }
    return 'pass';
  };
  assert.equal(h.untilDone().then, 'done');

  const m = world(t, { profile: { review: 'minimal' } });
  let minimal = 0;
  m.policy.review = (a) => {
    if (!minimal++) {
      assert.doesNotMatch(a.record, /--observations/);
      const r = m.tick('record', m.path, a.id, '--agent', 'x', '--outcome', 'pass', '--observations', '1', '--pre-existing', '0');
      assert.equal(r.code, 2);
      assert.match(r.err, /minimal/);
    }
    return 'pass';
  };
  assert.equal(m.untilDone().then, 'done');
  assert.ok(!m.log.some((a) => a.step === 'observations'));
});

test('#138: record green is refused (3) until the agent report the collect names holds a targeted checks line', (t) => {
  const h = world(t);
  let checked = 0;
  h.policy.collect = (a) => {
    if (a.meta.stage === 'implementing' && a.tickets[0] === '#1' && !checked) {
      assert.ok(a.do.includes(a.meta.agentReport), `the collect names the report file: ${a.do}`);
      const green = () => h.tick('record', h.path, a.id, '--outcome', 'green');
      assert.equal(green().code, 3, 'no report file');
      write(a.meta.agentReport, 'ticket: #1\ncommit: abc\n');
      const r = green();
      assert.equal(r.code, 3, 'a report without its targeted checks line');
      assert.match(r.err, /targeted checks/);
      assert.equal(h.state().tickets['#1'].stage, 'implementing', 'nothing moved');
      checked += 1;
    }
    return { implementing: 'green', expanding: 'reported', fixing: 'fixed', integrating: 'resolved' }[a.meta.stage];
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(checked, 1);
});

test('#138: a ticket in review with no agent report on file gets a judge to write it before the review spawn', (t) => {
  const h = world(t);
  const record = h.record;
  h.record = (id, ...flags) => {
    const r = record(id, ...flags);
    const a = h.log.findLast((x) => x.id === id);
    if (a?.step === 'collect' && a.tickets[0] === '#1' && a.meta.stage === 'implementing') rmSync(a.meta.agentReport); // lost, or a state from before #138
    return r;
  };
  h.policy['agent-report'] = (a) => {
    assert.equal(h.tick('record', h.path, a.id, '--outcome', 'written').code, 3, 'refused while the file is missing');
    write(a.meta.agentReport, h.agentReport({ tickets: a.tickets, meta: { agent: 'a1' } }));
    return 'written';
  };
  assert.equal(h.untilDone().then, 'done');
  const judges = h.log.filter((a) => a.step === 'agent-report');
  assert.deepEqual(judges.map((a) => a.tickets), [['#1']]);
  const review = h.log.find((a) => a.step === 'review' && a.tickets[0] === '#1');
  assert.ok(readFileSync(briefOf(review), 'utf8').includes(`the agent's report: ${resolve(judges[0].meta.agentReport)})`));
});

test('#138: Local Markdown: the status record is the ticket file in the ticket worktree', (t) => {
  const h = world(t, { tracker: 'local' });
  const seen = [];
  const spawn = h.spawn;
  h.spawn = (a) => {
    if (a.step === 'review') seen.push({ a, file: readFileSync(briefOf(a), 'utf8'), wt: h.state().tickets[a.tickets[0]].assignment?.worktree });
    return spawn(a);
  };
  assert.equal(h.untilDone().then, 'done');
  const one = seen.find((x) => x.a.tickets[0] === h.ids[0]);
  assert.equal(one.a.spawn.description, `review ${h.ids[0]}`);
  assert.ok(one.file.includes('- tracker: Local Markdown\n'));
  assert.ok(one.file.includes(`- status record: ${resolve(one.wt, TICKETS_DIR, h.ids[0])}\n`), one.file.slice(one.file.lastIndexOf('\n---\n')));
});

const reviewSpawns = (h, id = '#1') => distinct(h.log).filter((a) => a.kind === 'spawn' && a.step === 'review' && a.tickets[0] === id);

test('#143: the review spawn comes with an assignment record; a review host in the background is in flight, with a fallback wake-up, until its report', (t) => {
  const h = world(t);
  h.reviewBackground = true;
  h.wake();
  const w2 = h.wake();
  const [review] = reviewSpawns(h);
  assert.ok(review, 'the review host is spawned');
  // the assignment record comes before the spawn: deadline.mjs record in the ticket worktree with the review limit
  const first = h.wakes.flat().flatMap((o) => o.actions).find((x) => x.id === review.id);
  const assign = h.log.find((x) => x.step === 'assignment' && x.argv.includes('assign') && first.after.includes(x.id));
  assert.ok(assign, `the review spawn waits for its assignment: ${first.after}`);
  assert.deepEqual(assign.tickets, ['#1']);
  const rec = h.log.find((x) => x.step === 'assignment' && x.tickets[0] === '#1' && basename(x.argv[1]) === 'deadline.mjs' && x.stdout === assign.argv[assign.argv.indexOf('--record') + 1]);
  assert.ok(rec, 'deadline.mjs record writes the record the assign reads');
  assert.equal(rec.argv[rec.argv.indexOf('--limit') + 1], '60', 'timeout-review, 60 minutes by default');
  // in flight: the assignment is the review host's, it is a current agent, and the wake-up ends with a fallback
  const st = h.state();
  const a = st.tickets['#1'].assignment;
  const agent = Object.keys(h.agentOf).find((x) => h.agentOf[x].role === 'review' && h.agentOf[x].tickets[0] === '#1');
  assert.deepEqual([a.agentId, a.type, a.limit, a.extended], [agent, 'general-purpose', 60, 'no']);
  assert.equal(Date.parse(a.deadline) - Date.parse(a.assigned), 60 * 60_000);
  assert.equal(st.tick.agents[agent].status, 'current', 'not marked collected at the spawn record');
  assert.equal(stage(h, '#1'), 'in-review');
  assert.equal(st.tickets['#1'].reviews.length, 0);
  assert.equal(w2.at(-1).then, 'end');
  assert.equal(w2.at(-1).actions.at(-1).step, 'wakeup-end');
  const deadlines = [st.tickets['#1'].assignment.deadline, st.tickets['#2'].assignment.deadline].sort();
  assert.equal(w2.at(-1).fallback?.deadline, deadlines[0], 'the fallback wake-up waits for the earliest review deadline');
  // its report arrives: a collect with the review's outcomes, the verdict recorded, the assignment released
  const w3 = h.wake();
  const collect = h.actions(w3).find((x) => x.step === 'collect' && x.meta?.agent === agent);
  assert.ok(collect, 'the review host report is collected');
  assert.deepEqual([collect.meta.stage, collect.outcomes], ['in-review', ['pass', 'fix', 'stuck', 'incomplete']]);
  assert.match(collect.record, /--outcome pass\|fix\|stuck/);
  const after = h.state();
  assert.equal(after.tick.agents[agent].status, 'collected');
  assert.deepEqual(after.tickets['#1'].reviews.map((r) => [r.kind, r.mode, r.verdict]), [['full', 'initial', 'pass']]);
  assert.equal(stage(h, '#1'), 'delivered');
  assert.equal(h.untilDone().then, 'done');
  assert.equal(reviewSpawns(h).length, 1, 'one review spawn: in flight it is not issued again');
});

test('#143: a review host that returns its report in the foreground is recorded at once: named on the assignment, released, collected', (t) => {
  const h = world(t);
  h.wake();
  h.wake();
  const [review] = reviewSpawns(h);
  const done = h.state().tick.done[review.id];
  const st = h.state();
  assert.equal(st.tickets['#1'].assignment.agentId, done.agent);
  assert.equal(st.tickets['#1'].assignment.deadline, null, 'released with the verdict');
  assert.equal(st.tick.agents[done.agent].status, 'collected');
  assert.equal(st.usage.timeoutStops, 0);
});

test('#142 × #143: a review host in the background brings its counts with the collect: above 0 they get the observations judge; with one missing the collect is refused (2)', (t) => {
  const h = world(t);
  h.reviewBackground = true;
  // the spawn's record of a host in the background has no report yet: the counts are refused there
  const spawn = h.spawn;
  let spawned = 0;
  h.spawn = (a) => {
    const r = spawn(a);
    if (a.step === 'review' && a.tickets[0] === '#1' && !spawned++) {
      const bad = h.tick('record', h.path, a.id, '--agent', r.agent, '--observations', '1', '--pre-existing', '0');
      assert.equal(bad.code, 2, 'counts with --agent alone');
      assert.match(bad.err, /background/);
    }
    return r;
  };
  let checked = 0;
  h.policy.review = (a) => {
    if (a.tickets[0] !== '#1') return 'pass';
    assert.equal(a.step, 'collect', 'in the background the verdict comes by the collect');
    if (!checked++) {
      assert.match(a.record, /--outcome pass\|fix\|stuck \[--findings <id>,<id>\] --observations <n> --pre-existing <n> \[--candidates <n> --confirmed <n> --invalid <n> --blocking <n>\] \| --outcome incomplete$/);
      assert.match(a.do, /--observations <n> --pre-existing <n>/);
      for (const missing of [[], ['--observations', '1'], ['--pre-existing', '0']]) {
        const r = h.tick('record', h.path, a.id, '--outcome', 'pass', ...missing);
        assert.equal(r.code, 2, `without ${missing.length ? 'one' : 'both'}`);
        assert.match(r.err, /--observations <n> --pre-existing <n>/);
      }
      const st = h.state();
      assert.equal(st.tickets['#1'].reviews.length, 0, 'nothing recorded');
      assert.equal(st.tickets['#1'].assignment.agentId, a.meta.agent, 'still in flight');
    }
    return { outcome: 'pass', observations: 2, preExisting: 1 };
  };
  const filed = [];
  h.policy.observations = (a) => {
    filed.push(a);
    return { outcome: 'filed', value: '#90' };
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(spawned, 1);
  assert.equal(checked, 1);
  assert.equal(stage(h, '#1'), 'delivered');
  // the counts are on the review the collect recorded, and they brought the one raw ticket
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => [r.kind, r.mode, r.verdict, r.observations, r.preExisting]), [['full', 'initial', 'pass', 2, 1]]);
  assert.deepEqual(h.state().tickets['#2'].reviews.map((r) => [r.observations, r.preExisting]), [[0, 0]]);
  assert.deepEqual(filed.map((a) => [a.id, a.tickets]), [['observations:#1:1', ['#1']]]);
  assert.match(filed[0].do, /2 observations and 1 pre-existing/);
  const steps = h.log.map((a) => a.step);
  assert.ok(steps.lastIndexOf('observations') < steps.indexOf('wrap-up'));
});

test('#143: a review host past its time limit is found by the deadline scan; the first stop reassigns the review, the second marks it stuck', (t) => {
  const h = world(t);
  h.reviewBackground = true;
  h.wake();
  h.wake();
  const [first] = reviewSpawns(h);
  const agent1 = h.state().tickets['#1'].assignment.agentId;
  h.silent.add(agent1);
  h.reportsNext = h.reportsNext.filter((x) => x !== agent1);
  // not overdue yet: no timeout
  const w3 = h.wake({ minutes: 30 });
  assert.ok(!h.actions(w3).some((x) => x.step === 'timeout' && x.tickets[0] === '#1'));
  assert.ok(w3.at(-1).fallback, 'still in flight: a fallback wake-up');
  // overdue, no progress: the timeout judge, by TIMEOUTS.md; reassign gives a new review spawn with --reassign
  const timeouts = [];
  h.policy.timeout = (a) => {
    timeouts.push(a);
    if (!a.do.includes('already reassigned once')) return 'reassign';
    // stuck as SEND-BACK.md marks it: the worktree and the ticket branch removed
    const t1 = h.state().tickets['#1'];
    git(h.repo, 'worktree', 'remove', '--force', t1.assignment.worktree);
    git(h.repo, 'branch', '-D', t1.branch);
    return 'stuck';
  };
  h.wake({ minutes: 31 });
  assert.equal(timeouts.length, 1);
  assert.deepEqual([timeouts[0].tickets, timeouts[0].meta.stage, timeouts[0].meta.agent], [['#1'], 'in-review', agent1]);
  assert.ok(!timeouts[0].outcomes.includes('send-back'), 'no send back from in-review');
  assert.match(timeouts[0].do, /reassign/);
  const reviews = reviewSpawns(h);
  assert.equal(reviews.length, 2, 'the review is handed out again');
  assert.notEqual(reviews[1].id, first.id);
  assert.ok(h.log.some((x) => x.step === 'assignment' && x.tickets[0] === '#1' && x.argv.includes('--reassign')));
  const st = h.state();
  assert.equal(st.tickets['#1'].timeoutReassignments['in-review'], 1);
  assert.equal(st.usage.timeoutStops, 1);
  const agent2 = st.tickets['#1'].assignment.agentId;
  assert.notEqual(agent2, agent1);
  assert.equal(st.tick.agents[agent1].status, 'stopped');
  // the second one is silent too: stuck
  h.silent.add(agent2);
  h.reportsNext = h.reportsNext.filter((x) => x !== agent2);
  h.wake({ minutes: 61 });
  assert.equal(timeouts.length, 2);
  assert.match(timeouts[1].do, /already reassigned once: stuck/);
  assert.equal(stage(h, '#1'), 'stuck');
  assert.equal(reviewSpawns(h).length, 2);
});

test('#143: a review host that had already finished when its timeout came is collected: its report is taken as a review', (t) => {
  const h = world(t);
  h.reviewBackground = true;
  h.wake();
  h.wake();
  const agent = h.state().tickets['#1'].assignment.agentId;
  h.reportsNext = h.reportsNext.filter((x) => x !== agent); // the notice never came
  h.policy.timeout = () => 'collected';
  h.wake({ minutes: 61 });
  const collect = h.log.find((x) => x.step === 'collect' && x.meta?.agent === agent);
  assert.ok(collect, 'its report is collected after the timeout judge');
  assert.equal(h.state().tickets['#1'].reviews.at(-1)?.verdict, 'pass');
  assert.equal(h.state().usage.timeoutStops, 0, 'not stopped');
  assert.equal(h.untilDone().then, 'done');
});

test('#128 D4: under review: minimal a fix agent reassigned after a timeout is pointed at the report file', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  h.policy.send = () => 'sent'; // the fix agent takes the round and then does nothing: no commit, no report
  h.wake();
  h.wake();
  assert.equal(stage(h, '#1'), 'fixing');
  const w3 = h.wake({ minutes: 31, reported: [] });
  const timeout = h.actions(w3).find((a) => a.step === 'timeout');
  assert.ok(timeout && timeout.tickets[0] === '#1', 'the silent fix agent is stopped and reassigned');
  const respawn = h.log.find((a) => a.kind === 'spawn' && a.step === 'spawn' && a.tickets[0] === '#1' && a.spawn.description === 'fix #1');
  assert.ok(respawn, 'a new fix agent');
  const brief = readFileSync(briefOf(respawn), 'utf8');
  assert.match(brief, /timed out and was stopped/);
  // #130: the record it updates is the status record; the findings of this round are in the reviewer's report
  assert.match(brief, /Update the existing status record in place/);
  assert.ok(brief.includes(`The findings of this fix round are in ${join(h.W, 'tick', 'review', '1-1.report.md')}`), 'the findings are in the reviewer report');
  assert.doesNotMatch(brief, /this ticket's existing record/);
  assert.doesNotMatch(brief, /review block/);
});

// ---- a review host whose turn ends with no report is sent a message at once (batch-2 run: a 55-minute stall) -------

test('a review host in the background whose turn ends with no report is recorded incomplete, nudged by SendMessage at once, and its next report is collected', (t) => {
  const h = world(t);
  h.reviewBackground = true;
  let first = true;
  h.policy.collect = (a) => {
    if (a.meta.stage !== 'in-review') return { implementing: 'green', expanding: 'reported', fixing: 'fixed' }[a.meta.stage] ?? 'logged';
    if (a.tickets[0] === '#1' && first) {
      first = false;
      assert.ok(a.outcomes.includes('incomplete'));
      return 'incomplete';
    }
    return 'pass';
  };
  h.nudges = [];
  h.policy.nudge = (a) => {
    h.nudges.push({ a, wakeup: h.wakes.length });
    h.reportsNext.push(a.meta.agent); // the review host goes on and reports again
    return 'sent';
  };
  for (let i = 0; i < 8 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
  const collects = distinct(h.log).filter((a) => a.step === 'collect' && a.meta?.stage === 'in-review' && a.tickets[0] === '#1');
  assert.equal(collects.length, 2, 'the incomplete report, then the report after the nudge');
  assert.match(collects[1].id, /:n1$/, 'the second report is a new collect');
  assert.equal(h.nudges.length, 1);
  const incompleteAt = h.log.find((a) => a.id === collects[0].id).wakeup;
  assert.equal(h.nudges[0].wakeup, incompleteAt, 'the message goes out in the same wake-up, not at the fallback');
  assert.match(h.nudges[0].a.do, /^SendMessage /);
  assert.ok(!h.log.some((a) => a.step === 'timeout'), 'no timeout, no reassignment');
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => r.verdict), ['pass'], 'one review recorded');
});

test('the fallback wake-up is capped by budget: wake-check (20 minutes by default)', async () => {
  const { capFallback } = await import('../src/skills/get-to-work/scripts/tick.mjs');
  const long = { deadline: '2026-05-01T12:30:00Z', seconds: 9000, scheduleWakeup: 3600 };
  assert.deepEqual(capFallback(long, 20), { ...long, seconds: 1200, scheduleWakeup: 1200, capped: true });
  assert.equal(capFallback({ ...long, seconds: 600, scheduleWakeup: 600 }, 20).seconds, 600, 'a nearer deadline stands');
  assert.equal(capFallback(null, 20), null);
  assert.equal(capFallback(long, 0), long, 'no cap without a positive limit');
});
