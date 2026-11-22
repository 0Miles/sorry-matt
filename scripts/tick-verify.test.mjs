// node --test scripts/tick-verify.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: local verification without origin or CI (#141), failed commands, the implementer type (#126), refused records and the relaxed profile.
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main as tick } from '../src/skills/get-to-work/scripts/tick.mjs';
import { main as ciMain, defaultDeps as ciDeps } from '../src/skills/get-to-work/scripts/ci.mjs';
import { root, LINE, git, write, world, distinct, stage } from './tick-world.mjs';
/** Seeds the line as settled "CI does not cover the integration branch" (state.mjs ci sets it after two empty reads). */
const settleNotCovering = (h) => {
  const st = h.state();
  st.lines[LINE].ciNotCovering = { sha: st.lines[LINE].tip, at: h.iso() };
  writeFileSync(h.path, `${JSON.stringify(st, null, 2)}\n`);
};

for (const [name, reason, setup] of [
  ['no origin', 'no-origin', (h) => git(h.repo, 'remote', 'remove', 'origin')],
  ['CI not covering the line', 'ci-not-covering', settleNotCovering],
]) {
  test(`#141: ${name}: no local verification at the dispatch points; a green finish verifies the latest SHA once`, (t) => {
    const h = world(t);
    setup(h);
    assert.equal(h.untilDone().then, 'done');
    const tip = git(h.intWt, 'rev-parse', 'HEAD');
    const verifies = h.log.filter((a) => a.step === 'verify-local');
    assert.deepEqual(
      verifies.map((a) => [a.argv[a.argv.indexOf('--sha') + 1], a.argv[a.argv.indexOf('--reason') + 1]]),
      [[tip, reason]],
      'one verification, at the finish, of the latest SHA',
    );
    assert.ok(!h.log.some((a) => a.step === 'red-light'), 'green: no red-light handling');
    const L = h.state().lines[LINE];
    assert.deepEqual(L.local.map((x) => [x.sha, x.result]), [[tip, 'green']], 'one per-SHA record: the latest SHA');
    assert.ok(!h.log.some((a) => a.step === 'ci-read'), 'nothing reads CI');
    assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  });
}

for (const [culprit, file] of [
  ['#1', 'a.js'],
  ['#2', 'b.js'],
]) {
  test(`#141: no origin: a red finish verifies the integration SHAs from the oldest; the first red, ${culprit}'s merge, is the earliest red`, (t) => {
    // the Full checks fail once the culprit's file is in the tree: from its merge on
    const h = world(t, { check: `node -e "process.exit(require('fs').existsSync('${file}') ? 1 : 0)"` });
    git(h.repo, 'remote', 'remove', 'origin');
    let handed = null;
    h.policy['red-light'] = (a) => {
      // RED-LIGHT.md step 1: ci.mjs earliest-red on the state's per-SHA records, `ci` false on a line on local verification
      const st = h.state();
      const plan = join(h.W, 'ci', 'line-1.plan.json');
      write(
        plan,
        JSON.stringify({
          worktree: h.intWt,
          line: LINE,
          base: 'main',
          ci: false,
          local: st.lines[LINE].local.map((x) => `local: ${LINE} ${x.sha} ${x.result} ${x.reason}`),
          tickets: Object.entries(st.tickets).map(([id, x]) => ({ id, merges: x.merges.map((m) => m.sha) })),
        }),
      );
      const r = ciMain(['earliest-red', plan], ciDeps());
      assert.equal(r.code, 0, r.err);
      handed = { action: a, logged: h.log.length, earliest: JSON.parse(r.out) };
      return 'failed'; // the line failed verification: on to the delivery
    };
    assert.equal(h.untilDone().then, 'done');
    const st = h.state();
    const tip = git(h.intWt, 'rev-parse', 'HEAD');
    const merges = git(h.intWt, 'rev-list', '--first-parent', '--merges', '--reverse', `main..${LINE}`).split('\n'); // oldest first
    const earliest = st.tickets[culprit].merges[0].sha;
    const scanned = merges.slice(0, merges.indexOf(earliest) + 1).filter((x) => x !== tip);
    const verified = h.log.filter((a) => a.step === 'verify-local').map((a) => a.argv[a.argv.indexOf('--sha') + 1]);
    assert.deepEqual(verified, [tip, ...scanned], 'the finish verifies the tip once; then each integration SHA from the oldest, up to the first red');
    assert.deepEqual(
      st.lines[LINE].local.map((x) => [x.sha, x.result]),
      [[tip, 'red'], ...scanned.map((x) => [x, x === earliest ? 'red' : 'green'])],
    );
    assert.ok(handed, 'the red goes to red-light handling');
    assert.equal(h.log.filter((a) => a.step === 'red-light').length, 1);
    assert.equal(handed.action.meta.earliestRed, earliest);
    assert.match(handed.action.do, new RegExp(`earliest red SHA ${earliest}`));
    assert.ok(h.log.slice(handed.logged).every((a) => a.step !== 'verify-local'), 'every verification came before it');
    assert.equal(handed.earliest.earliestRed, earliest, 'ci.mjs earliest-red on those records finds the same SHA');
    assert.deepEqual(handed.earliest.tickets, [culprit]);
    const trees = git(h.repo, 'worktree', 'list', '--porcelain');
    assert.ok(!scanned.some((x) => trees.includes(x.slice(0, 12))), 'the worktrees of the scan are removed');
    assert.equal(git(h.intWt, 'rev-parse', 'HEAD'), tip, 'the integration worktree stays at the tip');
  });
}

test('#141: no origin: after a fix round the new tip is verified once; green ends the red-light handling', (t) => {
  const h = world(t, { check: `node -e "process.exit(require('fs').existsSync('b.js') ? 1 : 0)"` });
  git(h.repo, 'remote', 'remove', 'origin');
  h.policy['red-light'] = () => {
    git(h.intWt, 'rm', '-q', 'b.js');
    git(h.intWt, 'commit', '-q', '-m', 'fix the red light');
    return 'handled';
  };
  assert.equal(h.untilDone().then, 'done');
  const st = h.state();
  const [m1, m2] = [st.tickets['#1'].merges[0].sha, st.tickets['#2'].merges[0].sha];
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  const verified = h.log.filter((a) => a.step === 'verify-local').map((a) => a.argv[a.argv.indexOf('--sha') + 1]);
  assert.deepEqual(verified, [m2, m1, fixed], 'the red tip, the scan, then the fixed tip: each once');
  assert.equal(st.lines[LINE].local.find((x) => x.sha === fixed).result, 'green');
  assert.equal(h.log.filter((a) => a.step === 'red-light').length, 1);
  assert.ok(h.log.some((a) => a.step === 'deliver-line'), 'the line is delivered');
  assert.equal(st.tick.red[LINE], undefined);
});

test('a failed command comes back as a judge; retry issues it again', (t) => {
  const h = world(t);
  const exec = h.exec;
  let failOnce = true;
  h.exec = (a) => {
    if (a.step === 'frontier' && failOnce) {
      failOnce = false;
      return 1;
    }
    return exec(a);
  };
  h.policy.failed = () => 'retry';
  const w1 = h.wake();
  const a1 = h.actions(w1);
  assert.ok(a1.some((a) => a.id === 'failed:frontier:r1' && a.kind === 'judge'));
  assert.equal(a1.filter((a) => a.id === 'frontier:r1').length, 2, 'issued again after the retry');
  assert.equal(stage(h, '#1'), 'implementing');
});

test('#126: implementation agents spawn as sorry-matt:implementer with a general-purpose fallback; --type re-records the assignment', (t) => {
  const h = world(t);
  const spawn = h.spawn;
  // #2's host has no sorry-matt:implementer: it sends the fallback and records the type it used
  h.spawn = (a) => {
    const r = spawn(a);
    if (a.tickets[0] === '#2') r.flags.push('--type', 'general-purpose');
    return r;
  };
  const spawns = distinct(h.actions(h.wake())).filter((a) => a.kind === 'spawn');
  assert.deepEqual(spawns.map((a) => a.spawn.description).sort(), ['implement #1', 'implement #2']);
  for (const a of spawns) {
    assert.equal(a.spawn.subagent_type, 'sorry-matt:implementer');
    const brief = a.spawn.prompt.match(/^Read (.+) in full and follow it\.$/)[1];
    assert.equal(a.spawn.fallback.subagent_type, 'general-purpose');
    assert.equal(a.spawn.fallback.prompt, `Read ${brief.replace(/\.md$/, '.general-purpose.md')} in full and follow it.`);
    assert.ok(existsSync(brief.replace(/\.md$/, '.general-purpose.md')), 'brief.mjs wrote the fallback');
    assert.match(a.record, /--agent <agent id> \[--type general-purpose\]$/);
  }
  const st = h.state();
  const [one, two] = ['#1', '#2'].map((id) => st.tickets[id].assignment);
  assert.equal(one.type, 'sorry-matt:implementer');
  assert.equal(two.type, 'general-purpose', 'the fallback re-recorded the assignment');
  assert.ok(two.agentId && two.worktree, 'with its agent and worktree');
  assert.equal(st.tick.agents[one.agentId].type, 'sorry-matt:implementer');
  assert.equal(st.tick.agents[two.agentId].type, 'general-purpose');
});

test('record refuses what tick did not issue and a second, different result', (t) => {
  const h = world(t);
  const r = JSON.parse(h.tick('next', h.path).out);
  const usage = r.actions.find((a) => a.step === 'usage');
  assert.equal(h.tick('record', h.path, 'made-up:1', '--exit', '0').code, 3);
  assert.equal(h.tick('record', h.path, usage.id).code, 2, 'an exec needs --exit');
  h.record(usage.id, '--exit', '0');
  assert.equal(JSON.parse(h.tick('record', h.path, usage.id, '--exit', '0').out).already, true);
  assert.equal(h.tick('record', h.path, usage.id, '--exit', '1').code, 3);
  assert.equal(h.tick('next', join(h.dir, 'missing.state.json')).code, 1);
});

// The profile trims the action list and nothing else: the same events under the default and a relaxed profile.
test('a relaxed profile drops exactly the actions it relaxes', (t) => {
  const RELAXED = { review: 'minimal', recheck: false, onUnfixed: 'file-issue', expand: 'skip', ci: 'skip', simplify: false, integrate: 'direct' };
  const play = (profile) => {
    const h = world(t, { profile });
    h.acceptance['#1'] = { items: [], expansions: [] }; // #1 has no criteria yet
    h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1,F2' } : 'pass');
    h.policy.collect = (a) => (a.meta.stage === 'fixing' ? { outcome: 'fixed', fixed: 'F1', unfixed: 'F2' } : { implementing: 'green', expanding: 'reported' }[a.meta.stage]);
    for (let i = 0; i < 8 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
    assert.equal(h.wakes.at(-1).at(-1).then, 'done', `the run under ${profile ? 'the relaxed' : 'the default'} profile finished`);
    const st = h.state();
    assert.deepEqual(Object.values(st.tickets).map((x) => x.stage), ['delivered', 'delivered']);
    return { h, sigs: new Set(h.log.map(signature)) };
  };
  const strict = play(null);
  const relaxed = play(RELAXED);
  // every file a reference names exists; the agents' reports are read from their definitions (#126)
  for (const a of [...strict.h.log, ...relaxed.h.log])
    for (const r of a.reference) if (r.path) assert.ok(existsSync(r.path), `${a.id}: ${r.path} exists`);
  const collected = (stage) => strict.h.log.find((a) => a.step === 'collect' && a.meta.stage === stage).reference.map((r) => r.path);
  assert.ok(collected('implementing').includes(join(root, 'src', 'agents', 'implementer.md')));
  assert.ok(collected('expanding').includes(join(root, 'src', 'agents', 'expander.md')));
  const only = (a, b) => [...a.sigs].filter((x) => !b.sigs.has(x)).sort();
  assert.deepEqual(only(strict, relaxed), [
    'assignment:expand', // expand: skip
    'brief:expand',
    'brief:review', // review: minimal (no review host, so no spawn file from brief.mjs review, #138) …
    'ci-read', // ci: skip
    'ci-record',
    'collect:expanding',
    'deliver-line', // integrate: direct (no aggregate PR) …
    'gate', // … no finish gate (its assertions assume aggregate PRs and a CI read) …
    'review:full:initial', // … no prove-it review …
    'review:full:recheck', // … and recheck: false
    'spawn:general-purpose:simplify', // simplify: false
    'spawn:sorry-matt:expander:expand',
    'stage:expanding',
    'sync-base', // … and no base sync
    'tier', // review: minimal judges no review tier (#139)
  ]);
  assert.deepEqual(only(relaxed, strict), [
    'file-issue', // onUnfixed: file-issue
    'push', // integrate: direct (the base branch is pushed by the host, so the guard hook sees it)
    'review:minimal:initial', // review: minimal
  ]);
  // integrate: direct merged into the base branch itself; the default into the line
  assert.equal(git(relaxed.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '2');
  assert.equal(git(strict.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '0');
  assert.equal(git(relaxed.h.repo, 'rev-parse', 'origin/main'), git(relaxed.h.repo, 'rev-parse', 'main'), 'the host pushed the base branch');
  assert.equal(relaxed.h.state().tickets['#1'].unfixedIssue, '#99');
});

function signature(a) {
  if (a.step === 'review') return `review:${a.meta.kind}:${a.meta.mode}`; // the review host's spawn or the minimal reviewer's
  if (a.kind === 'spawn') return `spawn:${a.spawn.subagent_type}:${a.spawn.description.split(' ')[0]}`;
  if (a.kind === 'exec') {
    if (a.step === 'stage') return `stage:${a.argv[4]}`;
    if (a.step === 'assignment' && a.argv.includes('--expansions')) return 'assignment:expand';
    if (a.step === 'brief') return `brief:${a.argv[2]}`;
    return a.step;
  }
  if (a.step === 'collect') return `collect:${a.meta.stage}`;
  return a.step;
}
